import { readdir, readFile } from 'node:fs/promises';
import { randomInt, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import mysql from 'mysql2/promise';

import { criarHashSenha, criarIndiceSenhaGarcom } from './security.js';
import { checksumMigration } from './db/migration-utils.js';
import {
  adicionaisSeed,
  categoriasSeed,
  comandasSeed,
  configuracaoSeed,
  funcionariosSeed,
  mesasSeed,
  pedidosSeed,
  produtosSeed,
  promocoesSeed
} from './seed.js';

const pastaServidor = dirname(fileURLToPath(import.meta.url));
const pastaProjeto = resolve(pastaServidor, '..');
const pastaMigracoes = resolve(pastaProjeto, 'database/migrations');
const padraoMigration = /^\d{3}_[a-z0-9_-]+\.sql$/;
const caminhosEstrutura = [
  resolve(pastaProjeto, 'database/estrutura/001_criar_tabelas.sql'),
  resolve(pastaProjeto, 'database/estrutura/003_criar_indices.sql'),
  resolve(pastaProjeto, 'database/estrutura/002_criar_relacionamentos.sql')
];

function validarNomeBanco(nome) {
  if (!/^[a-zA-Z0-9_]+$/.test(nome)) {
    throw new Error('DB_NAME deve conter apenas letras, números e sublinhado.');
  }
  return nome;
}

function dataMySql(valor = new Date()) {
  return valor.toISOString().slice(0, 23).replace('T', ' ');
}

function separarInstrucoesSql(conteudo) {
  return conteudo
    .split(/;\s*(?:\r?\n|$)/)
    .map((instrucao) => instrucao.trim())
    .filter(Boolean);
}

async function aplicarEstruturaInicial(banco) {
  for (const caminho of caminhosEstrutura) {
    const conteudo = await readFile(caminho, 'utf8');
    for (const instrucao of separarInstrucoesSql(conteudo)) await banco.query(instrucao);
  }
}

async function registrarBaselineMigracoes(banco) {
  const arquivos = (await readdir(pastaMigracoes))
    .filter((arquivo) => padraoMigration.test(arquivo))
    .sort((a, b) => a.localeCompare(b));

  for (const arquivo of arquivos) {
    const conteudo = await readFile(resolve(pastaMigracoes, arquivo), 'utf8');
    const checksum = checksumMigration(conteudo);
    await banco.execute(
      'INSERT INTO schema_migrations (versao, checksum) VALUES (?, ?)',
      [arquivo, checksum]
    );
  }
}

async function carregarSsl(configuracaoMySql) {
  if (!configuracaoMySql.ssl) return undefined;
  const caInformada = String(configuracaoMySql.sslCa ?? '').trim();
  let ca;
  if (caInformada) {
    ca = caInformada.includes('-----BEGIN CERTIFICATE-----')
      ? caInformada.replaceAll('\\n', '\n')
      : await readFile(resolve(pastaProjeto, caInformada), 'utf8');
  }
  return {
    rejectUnauthorized: true,
    ...(ca ? { ca } : {})
  };
}

async function configuracaoBaseMySql(configuracaoMySql) {
  return {
    host: configuracaoMySql.host,
    port: configuracaoMySql.port,
    user: configuracaoMySql.user,
    password: configuracaoMySql.password,
    charset: 'utf8mb4',
    timezone: 'Z',
    decimalNumbers: true,
    ...(configuracaoMySql.ssl ? { ssl: await carregarSsl(configuracaoMySql) } : {})
  };
}

async function revogarCredenciaisDemonstracaoLegadas(banco, idEstabelecimento) {
  const hashesTokensLegados = [
    'eae37569f974549b25e5d60627f12fbef1dafe4f79a950eff455a62b38c7b9c1',
    '816711d2b11be214316287916c7a1f3bd61ca9be413755f8dbb1d51bfac9fb36'
  ];
  const marcadores = hashesTokensLegados.map(() => '?').join(', ');
  const [funcionarios] = await banco.execute(`
    SELECT id FROM funcionarios
    WHERE id_estabelecimento = ? AND SHA2(token_acesso, 256) IN (${marcadores})
  `, [idEstabelecimento, ...hashesTokensLegados]);
  if (funcionarios.length === 0) return;

  await executarTransacao(banco, async (conexao) => {
    for (const funcionario of funcionarios) {
      const pinAleatorio = String(randomInt(100000, 1000000));
      const tokenAleatorio = `garcom-${randomUUID().replaceAll('-', '')}`;
      await conexao.execute(`
        UPDATE funcionarios
        SET pin_hash = ?, senha_busca = NULL, token_acesso = ?, ativo = 0
        WHERE id = ? AND id_estabelecimento = ?
      `, [criarHashSenha(pinAleatorio), tokenAleatorio, funcionario.id, idEstabelecimento]);
      await conexao.execute(`
        DELETE FROM sessoes_garcom
        WHERE funcionario_id = ? AND id_estabelecimento = ?
      `, [funcionario.id, idEstabelecimento]);
    }
  });
}

export async function executarTransacao(banco, operacao) {
  const conexao = await banco.getConnection();
  try {
    await conexao.beginTransaction();
    const resultado = await operacao(conexao);
    await conexao.commit();
    return resultado;
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

export async function criarEstabelecimentoInicial(
  banco,
  { slug = 'estabelecimento-padrao', nomeFantasia = 'Estabelecimento padrão' } = {}
) {
  const slugNormalizado = String(slug).trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugNormalizado)) {
    throw new Error('O slug do estabelecimento inicial é inválido.');
  }
  await banco.execute(`
    INSERT INTO estabelecimentos
      (nome_fantasia, slug, status, plano, status_assinatura)
    SELECT ?, ?, 'ativo', 'basico', 'ativa'
    WHERE NOT EXISTS (
      SELECT 1 FROM estabelecimentos WHERE slug = ?
    )
  `, [nomeFantasia || 'Estabelecimento padrão', slugNormalizado, slugNormalizado]);
  const [linhas] = await banco.execute(`
    SELECT id_estabelecimento
    FROM estabelecimentos
    WHERE slug = ?
    LIMIT 1
  `, [slugNormalizado]);
  const idEstabelecimento = Number(linhas[0]?.id_estabelecimento);
  if (!idEstabelecimento) throw new Error('Não foi possível criar o estabelecimento inicial.');
  await banco.execute(`
    INSERT INTO configuracoes_estabelecimento (id_estabelecimento)
    VALUES (?)
    ON DUPLICATE KEY UPDATE id_estabelecimento = VALUES(id_estabelecimento)
  `, [idEstabelecimento]);
  return idEstabelecimento;
}

export async function criarAdministradorInicial(banco, administrador, idEstabelecimento) {
  const idTenant = Number(idEstabelecimento) || await criarEstabelecimentoInicial(banco);
  const [linhas] = await banco.execute(`
    SELECT id FROM administradores
    WHERE id_estabelecimento = ?
    ORDER BY id LIMIT 1
  `, [idTenant]);
  const existente = linhas[0];
  if (!existente) {
    await banco.execute(`
      INSERT INTO administradores (id_estabelecimento, usuario, email, nome, senha_hash)
      VALUES (?, ?, ?, ?, ?)
    `, [idTenant, administrador.usuario, administrador.email, administrador.nome, criarHashSenha(administrador.senha)]);
    return;
  }

  if (!administrador.sincronizarCredenciais) return;
  await executarTransacao(banco, async (conexao) => {
    await conexao.execute(`
      UPDATE administradores
      SET usuario = ?, email = ?, nome = ?, senha_hash = ?
      WHERE id = ? AND id_estabelecimento = ?
    `, [
      administrador.usuario,
      administrador.email,
      administrador.nome,
      criarHashSenha(administrador.senha),
      existente.id,
      idTenant
    ]);
    await conexao.execute(`
      DELETE FROM sessoes_admin
      WHERE administrador_id = ? AND id_estabelecimento = ?
    `, [existente.id, idTenant]);
  });
}

async function metadadoExiste(banco, chave) {
  const [linhas] = await banco.execute('SELECT 1 FROM metadados WHERE chave = ? LIMIT 1', [chave]);
  return linhas.length > 0;
}

async function marcarMetadado(conexao, chave) {
  await conexao.execute(`
    INSERT INTO metadados (chave, valor) VALUES (?, '1')
    ON DUPLICATE KEY UPDATE valor = VALUES(valor)
  `, [chave]);
}

async function criarCatalogoInicial(banco, idEstabelecimento, incluirDadosDemonstracao) {
  if (await metadadoExiste(banco, 'catalogo_inicial_criado')) return;

  const [[{ total }]] = await banco.execute(`
    SELECT COUNT(*) AS total FROM produtos WHERE id_estabelecimento = ?
  `, [idEstabelecimento]);
  if (Number(total) > 0) {
    await banco.execute("INSERT INTO metadados (chave, valor) VALUES ('catalogo_inicial_criado', '1')");
    return;
  }

  await executarTransacao(banco, async (conexao) => {
    for (const categoria of categoriasSeed) {
      await conexao.execute(`
        INSERT INTO categorias (id_estabelecimento, id, nome, ordem, ativo)
        VALUES (?, ?, ?, ?, 1)
      `, [idEstabelecimento, categoria.id, categoria.nome, categoria.ordem]);
    }
    if (incluirDadosDemonstracao) {
      for (const adicional of adicionaisSeed) {
        await conexao.execute(`
          INSERT INTO adicionais (id_estabelecimento, id, nome, preco_centavos, ativo)
          VALUES (?, ?, ?, ?, 1)
        `, [idEstabelecimento, adicional.id, adicional.nome, adicional.precoCentavos]);
      }
      for (const produto of produtosSeed) {
        await conexao.execute(`
          INSERT INTO produtos
            (id_estabelecimento, id, categoria_id, nome, descricao,
             preco_centavos, imagem_url, destaque, ativo)
          VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1)
        `, [
          idEstabelecimento,
          produto.id,
          produto.categoriaId,
          produto.nome,
          produto.descricao,
          produto.precoCentavos,
          produto.destaque ?? null
        ]);
        for (const adicionalId of produto.adicionaisIds) {
          await conexao.execute(`
            INSERT INTO produto_adicionais (id_estabelecimento, produto_id, adicional_id)
            VALUES (?, ?, ?)
          `, [idEstabelecimento, produto.id, adicionalId]);
        }
      }
    }
    await marcarMetadado(conexao, 'catalogo_inicial_criado');
  });
}

/*
  Demonstração coerente: item de comanda que já foi para a cozinha nasce
  marcado como lançado, com o próprio garçom da comanda como autor. Sem isso
  a instalação de demonstração mostraria "aguardando lançamento" em mesas que
  já estão em preparo.
*/
async function inserirItemComanda(
  conexao,
  idEstabelecimento,
  comandaId,
  item,
  { lancadoPorFuncionarioId = null } = {}
) {
  const [resultado] = await conexao.execute(`
    INSERT INTO comanda_itens
      (id_estabelecimento, comanda_id, produto_id, nome_produto,
       preco_unitario_centavos, quantidade, observacao,
       enviado_em, enviado_por_funcionario_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    idEstabelecimento, comandaId, item.produtoId, item.nome, item.precoCentavos,
    item.quantidade, item.observacao ?? null,
    lancadoPorFuncionarioId == null ? null : dataMySql(new Date()),
    lancadoPorFuncionarioId
  ]);
  for (const adicional of item.adicionais ?? []) {
    await conexao.execute(`
      INSERT INTO comanda_item_adicionais
        (id_estabelecimento, comanda_item_id, adicional_id, nome_adicional, preco_centavos)
      VALUES (?, ?, ?, ?, ?)
    `, [idEstabelecimento, resultado.insertId, adicional.id, adicional.nome, adicional.precoCentavos]);
  }
}

async function inserirItemPedido(conexao, idEstabelecimento, pedidoId, item) {
  const [produtoLinhas] = await conexao.execute(`
    SELECT descricao, imagem_url FROM produtos
    WHERE id = ? AND id_estabelecimento = ?
  `, [item.produtoId, idEstabelecimento]);
  const produto = produtoLinhas[0];
  const [resultado] = await conexao.execute(`
    INSERT INTO pedido_itens
      (id_estabelecimento, pedido_id, produto_id, nome_produto, descricao_produto, imagem_url,
       preco_unitario_centavos, quantidade, observacao)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    idEstabelecimento,
    pedidoId,
    item.produtoId,
    item.nome,
    produto?.descricao ?? '',
    produto?.imagem_url ?? null,
    item.precoCentavos,
    item.quantidade,
    item.observacao ?? null
  ]);
  for (const adicional of item.adicionais ?? []) {
    await conexao.execute(`
      INSERT INTO pedido_item_adicionais
        (id_estabelecimento, pedido_item_id, adicional_id, nome_adicional, preco_centavos)
      VALUES (?, ?, ?, ?, ?)
    `, [idEstabelecimento, resultado.insertId, adicional.id, adicional.nome, adicional.precoCentavos]);
  }
}

async function criarOperacaoInicial(
  banco,
  idEstabelecimento,
  incluirDadosDemonstracao,
  senhaFuncionarioDemonstracao
) {
  if (await metadadoExiste(banco, 'operacao_inicial_criada')) return;

  const [[{ total }]] = await banco.execute(`
    SELECT COUNT(*) AS total
    FROM funcionarios
    WHERE id_estabelecimento = ?
  `, [idEstabelecimento]);
  if (Number(total) > 0) {
    await banco.execute("INSERT INTO metadados (chave, valor) VALUES ('operacao_inicial_criada', '1')");
    return;
  }

  await executarTransacao(banco, async (conexao) => {
    for (const mesa of mesasSeed) {
      await conexao.execute(`
        INSERT INTO mesas (id_estabelecimento, id, numero, lugares, ativo)
        VALUES (?, ?, ?, ?, 1)
      `, [idEstabelecimento, mesa.id, mesa.numero, mesa.lugares]);
    }

    if (incluirDadosDemonstracao) {
      for (const promocao of promocoesSeed) {
        await conexao.execute(`
          INSERT INTO promocoes
            (id_estabelecimento, id, produto_id, nome, categoria, descricao, preco_anterior_centavos,
             preco_centavos, destaque, tipo, ativo)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [
          idEstabelecimento,
          promocao.id,
          promocao.produtoId,
          promocao.nome,
          promocao.categoria,
          promocao.descricao,
          promocao.precoAnteriorCentavos,
          promocao.precoCentavos,
          promocao.destaque,
          promocao.tipo
        ]);
      }

      for (const funcionario of funcionariosSeed) {
        /* O garçom entra digitando só a senha, então duas senhas iguais na
           mesma equipe se anulariam: o sufixo com o id mantém cada uma única,
           inclusive quando DEMO_WAITER_PASSWORD fixa a base para os testes.
           Sem a variável, a senha do ambiente de demonstração é aleatória. */
        const senha = `${senhaFuncionarioDemonstracao || `garcom${randomInt(100000, 1000000)}`}${funcionario.id}`;
        const token = `garcom-${randomUUID().replaceAll('-', '')}`;
        await conexao.execute(`
          INSERT INTO funcionarios
            (id_estabelecimento, id, nome, cargo, usuario, pin_hash, senha_busca,
             token_acesso, senha_definida_em, ativo)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
        `, [
          idEstabelecimento,
          funcionario.id,
          funcionario.nome,
          funcionario.cargo,
          funcionario.usuario,
          criarHashSenha(senha),
          criarIndiceSenhaGarcom(idEstabelecimento, senha),
          token
        ]);
      }

      for (const comanda of comandasSeed) {
        await conexao.execute(`
          INSERT INTO comandas
            (id_estabelecimento, id, mesa_id, funcionario_id, status, aberta_em)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          idEstabelecimento,
          comanda.id,
          comanda.mesaId,
          comanda.funcionarioId,
          comanda.status,
          dataMySql(new Date(comanda.abertaEm))
        ]);
        const jaLancada = comanda.status === 'Na cozinha' || comanda.status === 'Conta solicitada';
        for (const item of comanda.itens) {
          await inserirItemComanda(conexao, idEstabelecimento, comanda.id, item, {
            lancadoPorFuncionarioId: jaLancada ? comanda.funcionarioId : null
          });
        }
      }

      for (const pedido of pedidosSeed) {
        await conexao.execute(`
          INSERT INTO pedidos
            (id_estabelecimento, id, origem, cliente, telefone, email, status, pagamento, rua, numero,
             bairro, complemento, referencia, taxa_entrega_centavos,
             total_centavos, comanda_id, mesa_id, funcionario_id, criado_em)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          idEstabelecimento,
          pedido.id,
          pedido.origem,
          pedido.cliente,
          pedido.telefone,
          pedido.email ?? null,
          pedido.status,
          pedido.pagamento,
          pedido.rua ?? null,
          pedido.numero ?? null,
          pedido.bairro ?? null,
          pedido.complemento ?? null,
          pedido.referencia ?? null,
          pedido.taxaEntregaCentavos,
          pedido.totalCentavos,
          pedido.comandaId ?? null,
          pedido.mesaId ?? null,
          pedido.funcionarioId ?? null,
          dataMySql(new Date(pedido.criadoEm))
        ]);
        for (const item of pedido.itens) {
          await inserirItemPedido(conexao, idEstabelecimento, pedido.id, item);
        }
        await conexao.execute(`
          INSERT INTO pagamentos
            (id_estabelecimento, pedido_id, comanda_id, forma, status, valor_centavos, pago_em)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          idEstabelecimento,
          pedido.id,
          pedido.comandaId ?? null,
          pedido.pagamento,
          pedido.origem === 'mesa'
            ? 'Pago'
            : pedido.pagamento === 'Pix' ? 'Aguardando pagamento' : 'Pagamento na entrega',
          pedido.totalCentavos,
          pedido.origem === 'mesa' ? dataMySql(new Date(pedido.criadoEm)) : null
        ]);
      }
    }

    const configuracaoInicial = incluirDadosDemonstracao
      ? configuracaoSeed
      : {
          nomeLoja: '',
          telefone: '',
          email: '',
          endereco: '',
          taxaEntregaCentavos: 0,
          tempoEntrega: '',
          pedidoMinimoCentavos: 0,
          lojaAberta: false
        };
    await conexao.execute(`
      UPDATE estabelecimentos
      SET nome_fantasia = ?
      WHERE id_estabelecimento = ?
    `, [configuracaoInicial.nomeLoja || 'Estabelecimento padrão', idEstabelecimento]);
    await conexao.execute(`
      INSERT INTO configuracoes_estabelecimento
        (id_estabelecimento, telefone, email, endereco, taxa_entrega_centavos,
         tempo_entrega, pedido_minimo_centavos, loja_aberta, entrega_ativa,
         retirada_ativa, atendimento_garcom_ativo, aceita_cartao, aceita_dinheiro)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        telefone = VALUES(telefone),
        email = VALUES(email),
        endereco = VALUES(endereco),
        taxa_entrega_centavos = VALUES(taxa_entrega_centavos),
        tempo_entrega = VALUES(tempo_entrega),
        pedido_minimo_centavos = VALUES(pedido_minimo_centavos),
        loja_aberta = VALUES(loja_aberta),
        entrega_ativa = VALUES(entrega_ativa),
        retirada_ativa = VALUES(retirada_ativa),
        atendimento_garcom_ativo = VALUES(atendimento_garcom_ativo),
        aceita_cartao = VALUES(aceita_cartao),
        aceita_dinheiro = VALUES(aceita_dinheiro)
    `, [
      idEstabelecimento,
      configuracaoInicial.telefone,
      configuracaoInicial.email,
      configuracaoInicial.endereco,
      configuracaoInicial.taxaEntregaCentavos,
      configuracaoInicial.tempoEntrega,
      configuracaoInicial.pedidoMinimoCentavos,
      configuracaoInicial.lojaAberta ? 1 : 0,
      incluirDadosDemonstracao ? 1 : 0,
      incluirDadosDemonstracao ? 1 : 0,
      incluirDadosDemonstracao ? 1 : 0,
      incluirDadosDemonstracao ? 1 : 0,
      incluirDadosDemonstracao ? 1 : 0
    ]);
    await marcarMetadado(conexao, 'operacao_inicial_criada');
  });
}

async function criarPool(configuracaoMySql) {
  const nomeBanco = validarNomeBanco(configuracaoMySql.database);
  const configuracaoBase = await configuracaoBaseMySql(configuracaoMySql);
  return mysql.createPool({
    ...configuracaoBase,
    database: nomeBanco,
    waitForConnections: true,
    connectionLimit: Number(configuracaoMySql.connectionLimit) || 10,
    queueLimit: 0
  });
}

export async function abrirBanco({ mysql: configuracaoMySql }) {
  const banco = await criarPool(configuracaoMySql);
  try {
    await banco.query('SELECT 1 AS conexao');
    return banco;
  } catch (erro) {
    await banco.end();
    throw erro;
  }
}

export async function prepararBanco({
  mysql: configuracaoMySql,
  administrador,
  incluirDadosDemonstracao = false,
  senhaFuncionarioDemonstracao = null,
  slugEstabelecimento = 'estabelecimento-padrao'
}) {
  if (!administrador?.senha) throw new Error('Defina ADMIN_PASSWORD para preparar o banco.');
  if (senhaFuncionarioDemonstracao && !/^[a-z0-9][a-z0-9._-]{2,20}$/.test(senhaFuncionarioDemonstracao)) {
    throw new Error(
      'DEMO_WAITER_PASSWORD deve ter de 3 a 21 caracteres, usando letras minúsculas, números, ponto, hífen ou _.'
    );
  }
  const nomeBanco = validarNomeBanco(configuracaoMySql.database);
  const configuracaoBase = await configuracaoBaseMySql(configuracaoMySql);

  if (configuracaoMySql.criarBancoSeAusente !== false) {
    const inicial = await mysql.createConnection(configuracaoBase);
    try {
      await inicial.query(`CREATE DATABASE IF NOT EXISTS \`${nomeBanco}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    } finally {
      await inicial.end();
    }
  }

  const banco = await criarPool(configuracaoMySql);
  try {
    const [tabelasExistentes] = await banco.query(`
      SELECT COUNT(*) AS total
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
    `);
    if (Number(tabelasExistentes[0]?.total) > 0) {
      throw new Error(
        'O preparo inicial exige um banco vazio. Para um banco existente, use npm run db:migrate.'
      );
    }
    await aplicarEstruturaInicial(banco);
    await registrarBaselineMigracoes(banco);
    const idEstabelecimento = await criarEstabelecimentoInicial(banco, {
      slug: slugEstabelecimento,
      nomeFantasia: incluirDadosDemonstracao
        ? configuracaoSeed.nomeLoja || 'Estabelecimento padrão'
        : 'Estabelecimento padrão'
    });
    await revogarCredenciaisDemonstracaoLegadas(banco, idEstabelecimento);
    await criarAdministradorInicial(banco, administrador, idEstabelecimento);
    await criarCatalogoInicial(banco, idEstabelecimento, incluirDadosDemonstracao);
    await criarOperacaoInicial(
      banco,
      idEstabelecimento,
      incluirDadosDemonstracao,
      senhaFuncionarioDemonstracao
    );
    return banco;
  } catch (erro) {
    await banco.end();
    throw erro;
  }
}

export async function fecharBanco(banco) {
  await banco.end();
}
