/*
  Camada fina sobre o `pg` (PostgreSQL / Supabase).

  O backend inteiro foi escrito sobre a interface do mysql2 — `execute(sql,
  parametros)` devolvendo `[linhas]` num SELECT e `[{ insertId,
  affectedRows }]` numa escrita, `getConnection()` para transações e códigos
  de erro `ER_*`. Em vez de reescrever cada uma das ~300 consultas, esta camada
  oferece a mesma interface e faz a tradução num lugar só:

  - marcadores `?` viram `$1, $2...` (fora de strings, identificadores entre
    aspas, comentários e blocos `$$`);
  - parâmetros: `true/false` viram 1/0 (as flags são SMALLINT, como o
    TINYINT(1) de antes), `Date` vira ISO em UTC e `undefined` é recusado, igual
    ao mysql2 — `undefined` virando NULL em silêncio esconderia bug;
  - INSERT numa tabela com id gerado ganha `RETURNING <id>` para preencher
    `insertId`;
  - BIGINT/COUNT e NUMERIC voltam como Number (o `pg` devolve texto);
  - violações de integridade ganham o código `ER_*` equivalente, que é o que
    o tratamento de erro da API compara. O código original do PostgreSQL fica
    em `erro.sqlState`.

  Toda conexão do pool roda `SET TIME ZONE 'UTC'` antes da primeira consulta:
  as colunas são TIMESTAMPTZ, mas o backend também envia datas como texto sem
  fuso ('2026-01-31 12:00:00.000', em UTC), e é a sessão que as interpreta.
*/
import pg from 'pg';

const { Pool, types } = pg;

/* Tabelas com chave gerada pelo banco e o nome da coluna. Um INSERT nelas
   devolve o id em `insertId`, como o AUTO_INCREMENT do MySQL fazia. O teste de
   segurança confere esta lista contra o `database/CRIAR_db.sql`. */
export const COLUNAS_IDENTIDADE = Object.freeze({
  estabelecimentos: 'id_estabelecimento',
  superadministradores: 'id',
  auditoria_superadmin: 'id',
  administradores: 'id',
  auditoria_admin: 'id',
  impressoras: 'id',
  categorias: 'id',
  adicionais: 'id',
  produtos: 'id',
  promocoes: 'id',
  funcionarios: 'id',
  mesas: 'id',
  comandas: 'id',
  comanda_itens: 'id',
  areas_entrega: 'id',
  pedidos: 'id',
  pedido_itens: 'id',
  pagamentos: 'id',
  dispositivos_impressao: 'id',
  trabalhos_impressao: 'id'
});

const OID_INT8 = 20;
const OID_NUMERIC = 1700;

function paraNumero(valor) {
  return valor === null ? null : Number(valor);
}

const tiposDoPool = {
  getTypeParser(oid, formato) {
    if (oid === OID_INT8 || oid === OID_NUMERIC) return paraNumero;
    return types.getTypeParser(oid, formato);
  }
};

const cacheMarcadores = new Map();
const LIMITE_CACHE_MARCADORES = 2000;

/* Troca cada `?` por `$n`, ignorando o que está dentro de '...', "...",
   comentários (-- e /* *\/) e corpos $tag$...$tag$. */
export function converterMarcadores(sql) {
  const emCache = cacheMarcadores.get(sql);
  if (emCache) return emCache;

  let saida = '';
  let total = 0;
  let i = 0;
  while (i < sql.length) {
    const caractere = sql[i];
    const proximo = sql[i + 1];

    if (caractere === "'" || caractere === '"') {
      let fim = i + 1;
      while (fim < sql.length) {
        if (sql[fim] === caractere) {
          if (sql[fim + 1] === caractere) {
            fim += 2;
            continue;
          }
          break;
        }
        fim += 1;
      }
      saida += sql.slice(i, fim + 1);
      i = fim + 1;
      continue;
    }

    if (caractere === '-' && proximo === '-') {
      const fim = sql.indexOf('\n', i);
      const corte = fim === -1 ? sql.length : fim;
      saida += sql.slice(i, corte);
      i = corte;
      continue;
    }

    if (caractere === '/' && proximo === '*') {
      const fim = sql.indexOf('*/', i + 2);
      const corte = fim === -1 ? sql.length : fim + 2;
      saida += sql.slice(i, corte);
      i = corte;
      continue;
    }

    if (caractere === '$') {
      const etiqueta = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (etiqueta) {
        const fim = sql.indexOf(etiqueta[0], i + etiqueta[0].length);
        const corte = fim === -1 ? sql.length : fim + etiqueta[0].length;
        saida += sql.slice(i, corte);
        i = corte;
        continue;
      }
    }

    if (caractere === '?') {
      total += 1;
      saida += `$${total}`;
      i += 1;
      continue;
    }

    saida += caractere;
    i += 1;
  }

  const resultado = { texto: saida, total };
  if (cacheMarcadores.size >= LIMITE_CACHE_MARCADORES) cacheMarcadores.clear();
  cacheMarcadores.set(sql, resultado);
  return resultado;
}

export function normalizarParametro(valor) {
  if (valor === undefined) {
    throw new TypeError(
      'Parâmetros de consulta não podem conter undefined. Para gravar NULL, informe null.'
    );
  }
  if (typeof valor === 'boolean') return valor ? 1 : 0;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) throw new TypeError('Data inválida em parâmetro de consulta.');
    return valor.toISOString();
  }
  return valor;
}

const INSERT_EM_TABELA = /^\s*INSERT\s+INTO\s+([a-z_][a-z0-9_]*)/i;

/* Acrescenta RETURNING para o insertId quando a tabela tem id gerado e a
   instrução ainda não pede retorno. */
export function prepararInsercao(sql) {
  const tabela = INSERT_EM_TABELA.exec(sql)?.[1]?.toLowerCase();
  const coluna = tabela ? COLUNAS_IDENTIDADE[tabela] : null;
  if (!coluna || /\bRETURNING\b/i.test(sql)) return { sql, coluna: null };
  return { sql: `${sql.replace(/[\s;]+$/, '')}\nRETURNING ${coluna}`, coluna };
}

/* Códigos do PostgreSQL para os nomes que o backend já trata. */
export function traduzirErro(erro, sql = '') {
  if (!erro || typeof erro.code !== 'string' || erro.sqlState) return erro;
  erro.sqlState = erro.code;
  const comando = /^\s*(\w+)/.exec(sql)?.[1]?.toUpperCase();
  if (erro.code === '23505') {
    erro.code = 'ER_DUP_ENTRY';
  } else if (erro.code === '23503') {
    const pai = comando === 'DELETE'
      || (comando !== 'INSERT' && /still referenced|ainda .* referenciad/i.test(erro.detail ?? ''));
    erro.code = pai ? 'ER_ROW_IS_REFERENCED_2' : 'ER_NO_REFERENCED_ROW_2';
  } else if (erro.code === '23514') {
    erro.code = 'ER_CHECK_CONSTRAINT_VIOLATED';
  }
  return erro;
}

function formatarResultado(resultado, coluna) {
  if (Array.isArray(resultado)) return [resultado.map((item) => formatarResultado(item, null)[0])];
  if (['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(resultado.command)) {
    const primeiro = resultado.rows?.[0];
    return [{
      affectedRows: resultado.rowCount ?? 0,
      insertId: coluna && primeiro ? Number(primeiro[coluna]) : 0
    }];
  }
  return [resultado.rows ?? [], resultado.fields ?? []];
}

async function executarNoCliente(cliente, sqlOriginal, parametros) {
  const { sql, coluna } = prepararInsercao(String(sqlOriginal));
  const valores = Array.isArray(parametros) ? parametros : [];
  try {
    if (valores.length === 0 && !sql.includes('?')) {
      // Protocolo simples: aceita várias instruções (estrutura e migrations).
      return formatarResultado(await cliente.query(sql), coluna);
    }
    const { texto } = converterMarcadores(sql);
    const resultado = await cliente.query({ text: texto, values: valores.map(normalizarParametro) });
    return formatarResultado(resultado, coluna);
  } catch (erro) {
    throw traduzirErro(erro, sql);
  }
}

const clientesPreparados = new WeakSet();

async function prepararCliente(cliente, schema) {
  if (clientesPreparados.has(cliente)) return;
  await cliente.query("SET TIME ZONE 'UTC'");
  // Nome já validado como [a-zA-Z0-9_]+ por quem monta a configuração.
  if (schema) await cliente.query(`SET search_path TO ${schema}`);
  clientesPreparados.add(cliente);
}

class ConexaoPostgres {
  constructor(cliente) {
    this.cliente = cliente;
    this.liberada = false;
  }

  execute(sql, parametros) {
    return executarNoCliente(this.cliente, sql, parametros);
  }

  query(sql, parametros) {
    return executarNoCliente(this.cliente, sql, parametros);
  }

  async beginTransaction() {
    await this.cliente.query('BEGIN');
  }

  async commit() {
    await this.cliente.query('COMMIT');
  }

  async rollback() {
    try {
      await this.cliente.query('ROLLBACK');
    } catch (erro) {
      // Conexão em estado desconhecido não volta para o pool.
      this.release(erro);
      throw erro;
    }
  }

  release(erro) {
    if (this.liberada) return;
    this.liberada = true;
    this.cliente.release(erro);
  }
}

export class BancoPostgres {
  constructor(pool, { schema = null } = {}) {
    this.pool = pool;
    this.schema = schema;
  }

  async getConnection() {
    const cliente = await this.pool.connect();
    try {
      await prepararCliente(cliente, this.schema);
    } catch (erro) {
      cliente.release(erro);
      throw erro;
    }
    return new ConexaoPostgres(cliente);
  }

  async execute(sql, parametros) {
    const conexao = await this.getConnection();
    try {
      return await conexao.execute(sql, parametros);
    } finally {
      conexao.release();
    }
  }

  query(sql, parametros) {
    return this.execute(sql, parametros);
  }

  end() {
    return this.pool.end();
  }
}

export function criarPoolPostgres(configuracao) {
  const pool = new Pool({
    host: configuracao.host,
    port: configuracao.port,
    user: configuracao.user,
    password: configuracao.password,
    database: configuracao.database,
    max: Number(configuracao.connectionLimit) || 10,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    application_name: 'site-hamburgueria',
    types: tiposDoPool,
    ...(configuracao.ssl ? { ssl: configuracao.ssl } : {})
  });
  /* Conexão ociosa que cai (rede, reinício do Supabase) emite 'error' no pool;
     sem ouvinte o processo inteiro morreria. O pool descarta a conexão sozinho. */
  pool.on('error', (erro) => {
    console.error('Conexão ociosa com o PostgreSQL encerrada:', erro?.code ?? erro?.message ?? erro);
  });
  return new BancoPostgres(pool, { schema: configuracao.schema ?? null });
}
