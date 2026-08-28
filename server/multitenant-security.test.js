import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { criarServidor } from './app.js';
import { buscarAdicional, buscarProduto, criarProduto } from './catalog.js';
import {
  acompanharPedido,
  atualizarStatusPedido,
  confirmarPagamento,
  listarDadosAdmin,
  listarDadosGarcom
} from './operations.js';
import { aguardarServidor, fecharServidor } from './runtime.js';
import { criarJwt } from './security.js';
import { resolverEstabelecimento } from './tenant.js';

const pastaProjeto = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const segredoJwt = 'segredo-exclusivo-da-etapa-11-com-mais-de-32-bytes';

function linhaTenant(id, slug, sobrescritas = {}) {
  return {
    id_estabelecimento: id,
    nome_fantasia: `Loja ${slug}`,
    slug,
    dominio_personalizado: null,
    status: 'ativo',
    plano: 'basico',
    status_assinatura: 'ativa',
    vencimento_assinatura_em: null,
    ...sobrescritas
  };
}

async function erroDa(promessa) {
  try {
    await promessa;
  } catch (erro) {
    return erro;
  }
  assert.fail('A operação deveria ter sido recusada.');
}

test('recusa domínio desconhecido, loja desativada e assinatura bloqueada ou vencida', async () => {
  const tenants = new Map([
    ['ativa', linhaTenant(1, 'ativa')],
    ['inativa', linhaTenant(2, 'inativa', { status: 'inativo' })],
    ['bloqueada', linhaTenant(3, 'bloqueada', { status_assinatura: 'bloqueada' })],
    ['vencida', linhaTenant(4, 'vencida', {
      vencimento_assinatura_em: new Date('2000-01-01T00:00:00.000Z')
    })]
  ]);
  const banco = {
    async execute(sql, parametros) {
      assert.match(sql, /FROM estabelecimentos AS e/i);
      return [[tenants.get(parametros[0])].filter(Boolean)];
    }
  };
  const opcoes = { dominioPrincipal: 'exemplo.test' };
  const requisicao = (slug) => ({ headers: { host: `${slug}.exemplo.test` } });

  assert.equal((await resolverEstabelecimento(banco, requisicao('ativa'), opcoes)).id, 1);

  const desconhecida = await erroDa(resolverEstabelecimento(banco, requisicao('ausente'), opcoes));
  assert.equal(desconhecida.status, 404);
  const inativa = await erroDa(resolverEstabelecimento(banco, requisicao('inativa'), opcoes));
  assert.equal(inativa.status, 403);
  const bloqueada = await erroDa(resolverEstabelecimento(banco, requisicao('bloqueada'), opcoes));
  assert.equal(bloqueada.status, 403);
  const vencida = await erroDa(resolverEstabelecimento(banco, requisicao('vencida'), opcoes));
  assert.equal(vencida.status, 403);
});

test('impede sessões de administrador e garçom de atravessarem o host do tenant', async () => {
  const tenants = new Map([
    ['loja-a', linhaTenant(11, 'loja-a')],
    ['loja-b', linhaTenant(22, 'loja-b')]
  ]);
  let consultasDeSessao = 0;
  const banco = {
    async execute(sql, parametros = []) {
      if (sql.includes('FROM estabelecimentos AS e')) {
        return [[tenants.get(parametros[0])].filter(Boolean)];
      }
      if (sql.includes('DELETE FROM sessoes_admin') || sql.includes('DELETE FROM sessoes_garcom')) {
        return [{ affectedRows: 0 }];
      }
      if (sql.includes('FROM sessoes_admin s')) {
        consultasDeSessao += 1;
        const idEstabelecimento = Number(parametros[1]);
        const idUsuario = Number(parametros[2]);
        return [[idEstabelecimento === 11 && idUsuario === 101 ? {
          id: 101,
          nome: 'Admin A',
          usuario: 'admin-a',
          email: 'admin-a@teste.local',
          id_estabelecimento: 11
        } : null].filter(Boolean)];
      }
      if (sql.includes('FROM sessoes_garcom s')) {
        consultasDeSessao += 1;
        const idEstabelecimento = Number(parametros[1]);
        const idUsuario = Number(parametros[2]);
        return [[idEstabelecimento === 11 && idUsuario === 201 ? {
          id: 201,
          nome: 'Garçom A',
          cargo: 'Garçom',
          id_estabelecimento: 11
        } : null].filter(Boolean)];
      }
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };
  const servidorA = criarServidor({
    banco,
    pastaUploads: resolve(pastaProjeto, 'server/uploads'),
    tenantDesenvolvimento: 'loja-a',
    jwtSecret: segredoJwt
  });
  const servidorB = criarServidor({
    banco,
    pastaUploads: resolve(pastaProjeto, 'server/uploads'),
    tenantDesenvolvimento: 'loja-b',
    jwtSecret: segredoJwt
  });
  const tokenAdminA = criarJwt({
    idUsuario: 101,
    perfil: 'administrador',
    idEstabelecimento: 11,
    duracaoMs: 60_000,
    segredo: segredoJwt
  });
  const tokenGarcomA = criarJwt({
    idUsuario: 201,
    perfil: 'garcom',
    idEstabelecimento: 11,
    duracaoMs: 60_000,
    segredo: segredoJwt
  });

  try {
    await Promise.all([aguardarServidor(servidorA, 0), aguardarServidor(servidorB, 0)]);
    const urlA = `http://127.0.0.1:${servidorA.address().port}`;
    const urlB = `http://127.0.0.1:${servidorB.address().port}`;
    const chamar = (url, caminho, token) => fetch(`${url}${caminho}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal((await chamar(urlA, '/api/admin/sessao', tokenAdminA)).status, 200);
    assert.equal((await chamar(urlA, '/api/garcom/sessao', tokenGarcomA)).status, 200);
    assert.equal(consultasDeSessao, 2);

    assert.equal((await chamar(urlB, '/api/admin/sessao', tokenAdminA)).status, 403);
    assert.equal((await chamar(urlB, '/api/garcom/sessao', tokenGarcomA)).status, 403);
    assert.equal(consultasDeSessao, 2);
  } finally {
    await Promise.all([fecharServidor(servidorA), fecharServidor(servidorB)]);
  }
});

test('não encontra produto, categoria ou adicional pertencente a outro estabelecimento', async () => {
  const produtos = new Map([['11:501', {
    id: 501,
    categoria_id: 301,
    nome: 'Produto A',
    descricao: 'Somente da Loja A',
    preco_centavos: 2500,
    imagem_url: null,
    destaque: null,
    ativo: 1,
    categoria: 'Categoria A'
  }]]);
  const adicionais = new Map([['11:701', {
    id: 701,
    nome: 'Adicional A',
    preco_centavos: 300,
    ativo: 1
  }]]);
  const categorias = new Set(['11:301', '22:302']);
  const banco = {
    async execute(sql, parametros = []) {
      if (sql.includes('FROM produtos p') && sql.includes('WHERE p.id = ?')) {
        return [[produtos.get(`${Number(parametros[1])}:${Number(parametros[0])}`)].filter(Boolean)];
      }
      if (sql.includes('FROM produto_adicionais')) return [[]];
      if (sql.includes('FROM adicionais') && sql.includes('WHERE id = ?')) {
        return [[adicionais.get(`${Number(parametros[1])}:${Number(parametros[0])}`)].filter(Boolean)];
      }
      if (sql.includes('FROM categorias') && sql.includes('WHERE id = ?')) {
        return [[categorias.has(`${Number(parametros[1])}:${Number(parametros[0])}`)
          ? { id: Number(parametros[0]) }
          : null].filter(Boolean)];
      }
      if (sql.includes('SELECT COUNT(*) AS total FROM adicionais')) {
        const [idEstabelecimento, ...ids] = parametros.map(Number);
        const total = ids.filter((id) => adicionais.has(`${idEstabelecimento}:${id}`)).length;
        return [[{ total }]];
      }
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    },
    async getConnection() {
      assert.fail('A validação deveria impedir a abertura da transação.');
    }
  };

  assert.equal((await buscarProduto(banco, 11, 501)).nome, 'Produto A');
  assert.equal(await buscarProduto(banco, 22, 501), null);
  assert.equal((await buscarAdicional(banco, 11, 701)).nome, 'Adicional A');
  assert.equal(await buscarAdicional(banco, 22, 701), null);

  const dadosProduto = {
    nome: 'Produto inseguro',
    descricao: 'Tentativa com recursos de outro tenant',
    preco: 20,
    ativo: true
  };
  await assert.rejects(
    criarProduto(banco, 11, { ...dadosProduto, categoriaId: 302, adicionaisIds: [] }, null),
    /categoria válida/i
  );
  await assert.rejects(
    criarProduto(banco, 22, { ...dadosProduto, categoriaId: 302, adicionaisIds: [701] }, null),
    /adicionais não existem/i
  );
});

test('pedido de outro tenant não pode ser acompanhado, alterado ou pago por ID', async () => {
  const comandos = [];
  const conexao = {
    async beginTransaction() { comandos.push('BEGIN'); },
    async commit() { comandos.push('COMMIT'); },
    async rollback() { comandos.push('ROLLBACK'); },
    release() { comandos.push('RELEASE'); },
    async execute(sql, parametros = []) {
      comandos.push({ sql, parametros });
      if (sql.includes('FROM pedidos')) return [[]];
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };
  const banco = {
    execute: conexao.execute.bind(conexao),
    async getConnection() { return conexao; }
  };

  assert.equal(await acompanharPedido(banco, 22, '#PED0041', 'token-da-loja-a'), null);
  assert.equal(await atualizarStatusPedido(banco, 22, '#PED0041', 'Em preparo', 9), null);
  const pagamento = await erroDa(confirmarPagamento(banco, 22, '#PED0041', 9));
  assert.equal(pagamento.status, 404);

  const consultas = comandos.filter((comando) => typeof comando === 'object');
  assert.ok(consultas.length >= 3);
  assert.ok(consultas.every(({ parametros }) => parametros.includes(22)));
  assert.equal(consultas.some(({ sql }) => /^\s*UPDATE\s+/i.test(sql)), false);
  assert.equal(comandos.includes('ROLLBACK'), true);
});

function bancoLeituraTenant(idEsperado, nomeLoja) {
  const consultas = [];
  return {
    consultas,
    async execute(sql, parametros = []) {
      consultas.push({ sql, parametros });
      assert.equal(Number(parametros[0]), idEsperado);
      assert.equal(/SELECT\s+\*/i.test(sql), false);
      if (sql.includes('INNER JOIN configuracoes_estabelecimento ce')) {
        return [[{
          nome_loja: nomeLoja,
          slug: nomeLoja.toLowerCase().replaceAll(' ', '-'),
          loja_aberta: 1
        }]];
      }
      return [[]];
    }
  };
}

test('painel, relatórios e dados do garçom consultam somente o tenant autenticado', async () => {
  const bancoA = bancoLeituraTenant(11, 'Loja A');
  const bancoB = bancoLeituraTenant(22, 'Loja B');
  const bancoGarcom = bancoLeituraTenant(11, 'Loja A');

  const [painelA, painelB, painelGarcom] = await Promise.all([
    listarDadosAdmin(bancoA, 11),
    listarDadosAdmin(bancoB, 22),
    listarDadosGarcom(bancoGarcom, 11, 201)
  ]);

  assert.equal(painelA.configuracao.nomeLoja, 'Loja A');
  assert.equal(painelB.configuracao.nomeLoja, 'Loja B');
  assert.equal(painelGarcom.configuracao.nomeLoja, 'Loja A');
  assert.ok(bancoA.consultas.length >= 9);
  assert.ok(bancoB.consultas.length >= 9);
  const consultaComandasGarcom = bancoGarcom.consultas.find(({ sql }) => sql.includes('FROM comandas c'));
  assert.deepEqual(consultaComandasGarcom.parametros, [11, 201]);
});

test('configuração de conexão muda somente por variáveis do ambiente', async () => {
  const valores = {
    NODE_ENV: 'production',
    DB_HOST: 'mysql-a.interno',
    DB_PORT: '3307',
    DB_USER: 'aplicacao_a',
    DB_PASSWORD: 'senha-usada-somente-no-processo-do-teste',
    DB_NAME: 'hamburgueria_a',
    DB_CONNECTION_LIMIT: '17',
    DB_SSL: 'true',
    DB_SSL_CA: 'certificados/mysql-ca.pem',
    JWT_SECRET: 'segredo-de-producao-para-teste-com-mais-de-32-bytes',
    TENANT_DESENVOLVIMENTO: 'loja-a'
  };
  const anteriores = new Map(Object.keys(valores).map((chave) => [chave, process.env[chave]]));
  Object.assign(process.env, valores);

  try {
    const modulo = new URL('./config.js', import.meta.url);
    modulo.searchParams.set('etapa11', String(Date.now()));
    const { config } = await import(modulo.href);
    assert.deepEqual(config.mysql, {
      host: 'mysql-a.interno',
      port: 3307,
      user: 'aplicacao_a',
      password: valores.DB_PASSWORD,
      database: 'hamburgueria_a',
      connectionLimit: 17,
      ssl: true,
      sslCa: 'certificados/mysql-ca.pem',
      criarBancoSeAusente: false
    });
    assert.equal(config.tenantDesenvolvimento, 'loja-a');
  } finally {
    for (const [chave, valor] of anteriores) {
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
  }
});

async function listarArquivosJavaScript(pasta) {
  const arquivos = [];
  for (const item of await readdir(pasta, { withFileTypes: true })) {
    const caminho = resolve(pasta, item.name);
    if (item.isDirectory()) arquivos.push(...await listarArquivosJavaScript(caminho));
    else if (item.name.endsWith('.js') && !item.name.endsWith('.test.js')) arquivos.push(caminho);
  }
  return arquivos;
}

function tabelasCriadas(sql) {
  return [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z0-9_]+)/gi)]
    .map((correspondencia) => correspondencia[1].toLowerCase())
    .sort();
}

test('código do servidor e SQLs mantêm as restrições permanentes de segurança', async () => {
  const arquivosServidor = await listarArquivosJavaScript(resolve(pastaProjeto, 'server'));
  for (const arquivo of arquivosServidor) {
    const conteudo = await readFile(arquivo, 'utf8');
    assert.equal(/SELECT\s+\*/i.test(conteudo), false, `SELECT * encontrado em ${arquivo}`);
    assert.equal(
      /rejectUnauthorized\s*:\s*false/i.test(conteudo),
      false,
      `Validação SSL desativada em ${arquivo}`
    );
  }

  const caminhoCriacao = resolve(pastaProjeto, 'database/CRIAR_db.sql');
  const sqlCriacao = await readFile(caminhoCriacao, 'utf8');
  for (const proibido of [
    /\bCREATE\s+DATABASE\b/i,
    /^\s*USE\s+/im,
    /\bSOURCE\b/i,
    /\bDROP\s+TABLE\b/i,
    /\bTRUNCATE\b/i,
    /SELECT\s+\*/i
  ]) {
    assert.equal(proibido.test(sqlCriacao), false, `Comando proibido encontrado em ${caminhoCriacao}`);
  }
  assert.equal(/INSERT\s+INTO\s+(?:superadministradores|administradores)\b/i.test(sqlCriacao), false);

  const pastaEstrutura = resolve(pastaProjeto, 'database/estrutura');
  const sqlEstrutura = (await Promise.all(
    (await readdir(pastaEstrutura))
      .filter((arquivo) => arquivo.endsWith('.sql'))
      .sort()
      .map((arquivo) => readFile(resolve(pastaEstrutura, arquivo), 'utf8'))
  )).join('\n');
  assert.deepEqual(tabelasCriadas(sqlCriacao), tabelasCriadas(sqlEstrutura));

  const pastaMigracoes = resolve(pastaProjeto, 'database/migrations');
  const migracoes = (await readdir(pastaMigracoes))
    .filter((arquivo) => /^\d{3}_[a-z0-9_-]+\.sql$/.test(arquivo))
    .sort();
  assert.deepEqual(
    migracoes.map((arquivo) => Number(arquivo.slice(0, 3))),
    Array.from({ length: migracoes.length }, (_, indice) => indice + 1)
  );
  for (const migration of migracoes) {
    const conteudo = await readFile(resolve(pastaMigracoes, migration), 'utf8');
    assert.equal(/\bDROP\s+TABLE\b/i.test(conteudo), false, `DROP TABLE encontrado em ${migration}`);
    assert.equal(/\bTRUNCATE\b/i.test(conteudo), false, `TRUNCATE encontrado em ${migration}`);
    assert.equal(/\bDELETE\s+FROM\b/i.test(conteudo), false, `DELETE FROM encontrado em ${migration}`);
    assert.equal(/SELECT\s+\*/i.test(conteudo), false, `SELECT * encontrado em ${migration}`);
  }

  const testesApi = await readFile(resolve(pastaProjeto, 'server/api.test.js'), 'utf8');
  assert.match(testesApi, /process\.env\.RUN_MYSQL_TESTS\s*===\s*'1'/);
  assert.equal(
    /Boolean\(process\.env\.DB_PASSWORD\)/.test(testesApi),
    false,
    'A presença de senha no .env não pode autorizar testes que criam ou removem banco.'
  );
});
