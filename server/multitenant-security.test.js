import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { criarServidor } from './app.js';
import { checksumMigration } from './db/migration-utils.js';
import {
  COLUNAS_OCULTAS_ESTABELECIMENTO,
  REFERENCIAS_SEM_TENANT,
  TABELAS_DO_ESTABELECIMENTO
} from './exclusaoEstabelecimento.js';
import { criarBancoEmMemoria, lerEsquema, semearLoja } from './testes/bancoEmMemoria.js';
import { buscarAdicional, buscarProduto, criarProduto, listarCatalogo } from './catalog.js';
import {
  acompanharPedido,
  atualizarStatusPedido,
  autenticarDispositivoImpressao,
  confirmarPagamento,
  listarDadosAdmin,
  listarDadosGarcom
} from './operations.js';
import {
  CAMPOS_CONFIGURACAO_POR_PERMISSAO,
  exigirPermissao,
  permissaoDaRotaAdmin,
  PERMISSOES_CONFIGURACAO
} from './permissoes.js';
import { aguardarServidor, fecharServidor } from './runtime.js';
import { criarHashSenha, criarHashToken, criarJwt, verificarSenha } from './security.js';
import { criarEstabelecimentoGerencial, redefinirSenhaAdministrador } from './superadmin.js';
import {
  CODIGO_ESTABELECIMENTO_INDISPONIVEL,
  estabelecimentoLiberado,
  resolverEstabelecimento
} from './tenant.js';
import { CHAVES_PERMISSOES, PERMISSOES_PADRAO_ADMINISTRADOR } from '../src/utils/permissoes.js';

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

test('só o status libera a loja: assinatura e vencimento não bloqueiam, suspenso e arquivado sim', async () => {
  const umDiaMs = 24 * 60 * 60 * 1000;
  const ontem = new Date(Date.now() - umDiaMs);
  const amanha = new Date(Date.now() + umDiaMs);
  const tenants = new Map([
    ['ativa-em-dia', linhaTenant(1, 'ativa-em-dia', { vencimento_assinatura_em: amanha })],
    // Loja ativa continua no ar com qualquer situação de assinatura.
    ['ativa-bloqueada', linhaTenant(2, 'ativa-bloqueada', { status_assinatura: 'bloqueada' })],
    ['ativa-vencida', linhaTenant(3, 'ativa-vencida', { vencimento_assinatura_em: ontem })],
    ['ativa-inadimplente', linhaTenant(4, 'ativa-inadimplente', { status_assinatura: 'inadimplente' })],
    ['ativa-cancelada', linhaTenant(5, 'ativa-cancelada', {
      status_assinatura: 'CANCELADA', vencimento_assinatura_em: ontem
    })],
    // Suspensa ou arquivada fica fora do ar mesmo com assinatura em dia.
    ['suspensa-em-dia', linhaTenant(6, 'suspensa-em-dia', {
      status: 'suspenso', vencimento_assinatura_em: amanha, motivo_suspensao: 'Dívida de R$ 900 com o fornecedor'
    })],
    ['arquivada-em-dia', linhaTenant(7, 'arquivada-em-dia', { status: 'arquivado', vencimento_assinatura_em: amanha })],
    // Valor antigo, anterior à migration 024: não é 'ativo', então não libera.
    ['legado-inativo', linhaTenant(8, 'legado-inativo', { status: 'inativo' })]
  ]);
  const banco = {
    async execute(sql, parametros) {
      assert.match(sql, /FROM estabelecimentos AS e/i);
      return [[tenants.get(parametros[0])].filter(Boolean)];
    }
  };
  const opcoes = { dominioPrincipal: 'exemplo.test' };
  const requisicao = (slug) => ({ headers: { host: `${slug}.exemplo.test` } });

  for (const [slug, id] of [['ativa-em-dia', 1], ['ativa-bloqueada', 2], ['ativa-vencida', 3],
    ['ativa-inadimplente', 4], ['ativa-cancelada', 5]]) {
    assert.equal((await resolverEstabelecimento(banco, requisicao(slug), opcoes)).id, id, slug);
  }

  const mensagens = new Set();
  for (const slug of ['suspensa-em-dia', 'arquivada-em-dia', 'legado-inativo']) {
    const erro = await erroDa(resolverEstabelecimento(banco, requisicao(slug), opcoes));
    assert.equal(erro.status, 403, slug);
    assert.equal(erro.codigo, CODIGO_ESTABELECIMENTO_INDISPONIVEL, slug);
    assert.equal(erro.message.includes('R$ 900'), false);
    mensagens.add(erro.message);
  }
  // Suspensa e arquivada recebem exatamente a mesma resposta.
  assert.equal(mensagens.size, 1);

  // Inexistente continua 404, sem o código de indisponível.
  const desconhecida = await erroDa(resolverEstabelecimento(banco, requisicao('ausente'), opcoes));
  assert.equal(desconhecida.status, 404);
  assert.equal(desconhecida.codigo, undefined);

  // A regra em si: só 'ativo' libera.
  assert.equal(estabelecimentoLiberado({ status: 'ativo', status_assinatura: 'bloqueada' }), true);
  for (const status of ['suspenso', 'arquivado', 'inativo', '', null, undefined]) {
    assert.equal(estabelecimentoLiberado({ status, status_assinatura: 'ativa' }), false, String(status));
  }
  assert.equal(estabelecimentoLiberado(null), false);
});

test('agente de impressão segue a mesma regra: só o status da loja libera a fila', async () => {
  const umDiaMs = 24 * 60 * 60 * 1000;
  const ontem = new Date(Date.now() - umDiaMs);
  const amanha = new Date(Date.now() + umDiaMs);
  const tokenDe = (n) => `token-dispositivo-${n}-${'x'.repeat(40)}`;
  const lojas = new Map([
    [1, { status: 'ativo', status_assinatura: 'bloqueada', vencimento_assinatura_em: ontem }],
    [2, { status: 'suspenso', status_assinatura: 'ativa', vencimento_assinatura_em: amanha }],
    [3, { status: 'arquivado', status_assinatura: 'ativa', vencimento_assinatura_em: amanha }]
  ]);
  const dispositivos = new Map([1, 2, 3].map((id) => [criarHashToken(tokenDe(id)), {
    id: id * 10, nome: `Balcão ${id}`, id_estabelecimento: id
  }]));
  const contatos = [];
  const banco = {
    async execute(sql, parametros = []) {
      if (sql.includes('FROM dispositivos_impressao d')) {
        // A regra não está no SQL: a consulta devolve a loja com o status e
        // quem decide é estabelecimentoLiberado, a mesma função do host.
        assert.equal(/e\.status\s*=/.test(sql), false);
        const dispositivo = dispositivos.get(parametros[0]);
        return [dispositivo ? [{ ...dispositivo, ...lojas.get(dispositivo.id_estabelecimento) }] : []];
      }
      if (sql.includes('UPDATE dispositivos_impressao')) {
        contatos.push(Number(parametros[1]));
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('FROM trabalhos_impressao t')) {
        assert.equal(parametros[0], 1);
        return [[]];
      }
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };

  assert.equal((await autenticarDispositivoImpressao(banco, tokenDe(1))).idEstabelecimento, 1);
  assert.equal(await autenticarDispositivoImpressao(banco, tokenDe(2)), null);
  assert.equal(await autenticarDispositivoImpressao(banco, tokenDe(3)), null);

  const servidor = criarServidor({
    banco,
    pastaUploads: resolve(pastaProjeto, 'server/uploads'),
    tenantDesenvolvimento: '',
    jwtSecret: segredoJwt
  });
  try {
    await aguardarServidor(servidor, 0);
    const url = `http://127.0.0.1:${servidor.address().port}`;
    const fila = (n) => fetch(`${url}/api/impressao/trabalhos`, {
      headers: { Authorization: `Bearer ${tokenDe(n)}` }
    });
    assert.equal((await fila(1)).status, 200);
    assert.equal((await fila(2)).status, 401);
    assert.equal((await fila(3)).status, 401);
    // Loja fora do ar nem registra o contato do agente.
    assert.deepEqual([...new Set(contatos)], [1]);
  } finally {
    await fecharServidor(servidor);
  }
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
      if (sql.includes('FROM administrador_permissoes ap')) return [[{ permissao: 'pedidos.visualizar' }]];
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
      if (sql.includes('SELECT token_acesso_garcom')) {
        return [[{ token_acesso_garcom: `equipe-${idEsperado}` }]];
      }
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
  // O garçom vê o salão inteiro do próprio estabelecimento — e só dele.
  const consultaComandasGarcom = bancoGarcom.consultas.find(({ sql }) => sql.includes('FROM comandas c'));
  assert.deepEqual(consultaComandasGarcom.parametros, [11]);
});

test('ticket médio e mais vendidos ficam presos ao tenant da sessão, mesmo com parâmetros adulterados', async () => {
  const tenants = new Map([
    ['loja-a', linhaTenant(11, 'loja-a')],
    ['loja-b', linhaTenant(22, 'loja-b')]
  ]);
  const administradorDoTenant = new Map([[11, 101], [22, 202]]);
  const vendas = new Map([
    [11, {
      ticket: { pedidos: 2, receita_centavos: 5000 },
      produtos: [{ produto_id: 1, nome_produto: 'X-Salada da Loja A', quantidade: 3, receita_centavos: 4200 }]
    }],
    [22, {
      ticket: { pedidos: 4, receita_centavos: 99900 },
      produtos: [{ produto_id: 9, nome_produto: 'Segredo da Loja B', quantidade: 40, receita_centavos: 99000 }]
    }]
  ]);
  const consultasIndicadores = [];
  const banco = {
    async execute(sql, parametros = []) {
      if (sql.includes('FROM estabelecimentos AS e')) {
        return [[tenants.get(parametros[0])].filter(Boolean)];
      }
      if (sql.includes('DELETE FROM sessoes_admin')) return [{ affectedRows: 0 }];
      if (sql.includes('FROM administrador_permissoes ap')) {
        return [[{ permissao: 'relatorios.visualizar' }]];
      }
      if (sql.includes('FROM sessoes_admin s')) {
        const idEstabelecimento = Number(parametros[1]);
        const idUsuario = Number(parametros[2]);
        return [[administradorDoTenant.get(idEstabelecimento) === idUsuario ? {
          id: idUsuario,
          nome: `Admin ${idEstabelecimento}`,
          usuario: `admin-${idEstabelecimento}`,
          email: `admin-${idEstabelecimento}@teste.local`,
          id_estabelecimento: idEstabelecimento
        } : null].filter(Boolean)];
      }
      if (sql.includes("pg.status = 'Pago'")) {
        consultasIndicadores.push({ sql, parametros });
        assert.equal(/SELECT\s+\*/i.test(sql), false);
        const tenant = vendas.get(Number(parametros[0]));
        return [sql.includes('FROM pedido_itens itp') ? tenant.produtos : [tenant.ticket]];
      }
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };
  const criarServidorTenant = (slug) => criarServidor({
    banco,
    pastaUploads: resolve(pastaProjeto, 'server/uploads'),
    tenantDesenvolvimento: slug,
    jwtSecret: segredoJwt
  });
  const servidorA = criarServidorTenant('loja-a');
  const servidorB = criarServidorTenant('loja-b');
  const token = (idUsuario, idEstabelecimento) => criarJwt({
    idUsuario,
    perfil: 'administrador',
    idEstabelecimento,
    duracaoMs: 60_000,
    segredo: segredoJwt
  });

  try {
    await Promise.all([aguardarServidor(servidorA, 0), aguardarServidor(servidorB, 0)]);
    const urlA = `http://127.0.0.1:${servidorA.address().port}`;
    const urlB = `http://127.0.0.1:${servidorB.address().port}`;
    const chamar = async (url, consulta, tokenSessao) => {
      const resposta = await fetch(`${url}/api/admin/dashboard/indicadores${consulta}`, {
        headers: tokenSessao ? { Authorization: `Bearer ${tokenSessao}` } : {}
      });
      return { status: resposta.status, corpo: await resposta.json() };
    };

    // A tenta apontar para B pela query string: o servidor ignora e responde A.
    const adulterada = await chamar(
      urlA,
      '?periodo=30dias&id_estabelecimento=22&idEstabelecimento=22&estabelecimento=22&tenant=loja-b',
      token(101, 11)
    );
    assert.equal(adulterada.status, 200);
    assert.deepEqual(adulterada.corpo.ticketMedio, { valor: 25, receita: 50, pedidos: 2 });
    assert.deepEqual(adulterada.corpo.produtosMaisVendidos.map((produto) => produto.nome), ['X-Salada da Loja A']);
    assert.equal(JSON.stringify(adulterada.corpo).includes('Segredo da Loja B'), false);
    assert.equal(consultasIndicadores.length, 2);
    assert.ok(consultasIndicadores.every(({ parametros }) => parametros[0] === 11));

    // Sessão de A no host de B, sessão de B no host de A, usuário de B
    // alegando ser de A, sem sessão e período fora da lista: nenhum consulta.
    assert.equal((await chamar(urlB, '?periodo=30dias', token(101, 11))).status, 403);
    assert.equal((await chamar(urlA, '?periodo=30dias', token(202, 22))).status, 403);
    assert.equal((await chamar(urlA, '?periodo=30dias', token(202, 11))).status, 401);
    assert.equal((await chamar(urlA, '?periodo=30dias')).status, 401);
    assert.equal((await chamar(urlA, '?periodo=365dias', token(101, 11))).status, 400);
    assert.equal(consultasIndicadores.length, 2);

    const lojaB = await chamar(urlB, '?periodo=hoje', token(202, 22));
    assert.equal(lojaB.status, 200);
    assert.equal(lojaB.corpo.produtosMaisVendidos[0].nome, 'Segredo da Loja B');
    assert.ok(consultasIndicadores.slice(2).every(({ parametros }) => parametros[0] === 22));
  } finally {
    await Promise.all([fecharServidor(servidorA), fecharServidor(servidorB)]);
  }
});

/*
  Rotas do painel lidas do próprio app.js, a partir do portão de autenticação:
  uma rota nova que esqueça de declarar permissão aparece aqui.
*/
async function rotasAdministrativasDoApp() {
  const codigo = await readFile(resolve(pastaProjeto, 'server/app.js'), 'utf8');
  const inicio = codigo.indexOf("if (!caminho.startsWith('/api/admin/')) return false;");
  const fim = codigo.indexOf('async function rotaGarcom(');
  assert.ok(inicio > 0 && fim > inicio, 'Trecho das rotas administrativas não encontrado em app.js.');
  const trecho = codigo.slice(inicio, fim);
  const padroes = new Map(
    [...trecho.matchAll(/const (\w+) = caminho\.match\(\/\^(.+?)\$\/\);/g)]
      .map(([, nome, fonte]) => [nome, fonte])
  );
  const exemplo = (fonte) => fonte
    .replaceAll('\\/', '/')
    .replaceAll('(\\d+)', '7')
    .replaceAll('([^/]+)', 'PED0007');
  return [
    ...[...trecho.matchAll(/requisicao\.method === '(\w+)' && caminho === '([^']+)'/g)]
      .map(([, metodo, caminho]) => ({ metodo, caminho })),
    ...[...trecho.matchAll(/requisicao\.method === '(\w+)' && (\w+)\)/g)]
      .filter(([, , nome]) => padroes.has(nome))
      .map(([, metodo, nome]) => ({ metodo, caminho: exemplo(padroes.get(nome)) }))
  ];
}

/* Banco simulado do painel: contas por id, com loja, e permissões por conta. */
function bancoPainelComPermissoes({ contas, permissoes, areas = [] }) {
  const tenants = new Map([
    ['loja-a', linhaTenant(11, 'loja-a')],
    ['loja-b', linhaTenant(22, 'loja-b')]
  ]);
  const consultas = [];
  function responder(sql, parametros = []) {
    consultas.push({ sql, parametros });
    if (sql.includes('FROM estabelecimentos AS e')) return [[tenants.get(parametros[0])].filter(Boolean)];
    if (sql.includes('DELETE FROM sessoes_admin') && sql.includes('expira_em')) return [{ affectedRows: 0 }];
    if (sql.includes('FROM sessoes_admin s')) {
      const tenant = Number(parametros[1]);
      const id = Number(parametros[2]);
      const conta = contas.get(id);
      return [[conta && conta.tenant === tenant && !conta.arquivado ? {
        id,
        nome: conta.nome,
        usuario: conta.usuario,
        email: `${conta.usuario}@teste.local`,
        id_estabelecimento: tenant
      } : null].filter(Boolean)];
    }
    if (sql.includes('FROM administrador_permissoes')) {
      const tenant = Number(parametros[0]);
      const id = Number(parametros[1]);
      return [contas.get(id)?.tenant === tenant
        ? (permissoes.get(id) ?? []).map((permissao) => ({ permissao }))
        : []];
    }
    if (sql.includes('FROM administradores') && sql.includes('FOR UPDATE')) {
      const id = Number(parametros[0]);
      const tenant = Number(parametros[1]);
      const conta = contas.get(id);
      const encontrada = conta && conta.tenant === tenant
        && !(sql.includes('arquivado_em IS NOT NULL') && !conta.arquivado)
        && !(sql.includes('arquivado_em IS NULL') && conta.arquivado);
      return [[encontrada ? {
        id,
        usuario: conta.usuario,
        email: `${conta.usuario}@teste.local`,
        nome: conta.nome,
        arquivado_em: conta.arquivado ? new Date() : null
      } : null].filter(Boolean)];
    }
    if (sql.includes('FROM areas_entrega')) {
      const tenant = Number(parametros[0]);
      const daLoja = areas.filter((area) => area.tenant === tenant);
      if (sql.includes('COUNT(id)')) return [[{ total: daLoja.length }]];
      const id = parametros.length > 1 ? Number(parametros[1]) : null;
      return [daLoja.filter((area) => id === null || area.id === id).map((area) => ({
        id: area.id,
        nome: area.nome,
        taxa_entrega_centavos: 500,
        tempo_estimado_min: 30,
        tempo_estimado_max: 45,
        ativo: 1,
        criado_em: new Date(),
        atualizado_em: new Date()
      }))];
    }
    if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) return [{ affectedRows: 1, insertId: 999 }];
    throw new Error(`Consulta inesperada no teste: ${sql}`);
  }
  const conexao = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, parametros) { return responder(sql, parametros); }
  };
  return {
    consultas,
    banco: {
      async execute(sql, parametros) { return responder(sql, parametros); },
      async getConnection() { return conexao; }
    }
  };
}

async function comServidoresDoPainel(banco, executar) {
  const criar = (slug) => criarServidor({
    banco,
    pastaUploads: resolve(pastaProjeto, 'server/uploads'),
    tenantDesenvolvimento: slug,
    jwtSecret: segredoJwt
  });
  const servidorA = criar('loja-a');
  const servidorB = criar('loja-b');
  try {
    await Promise.all([aguardarServidor(servidorA, 0), aguardarServidor(servidorB, 0)]);
    const urlDe = (servidor) => `http://127.0.0.1:${servidor.address().port}`;
    await executar({ urlA: urlDe(servidorA), urlB: urlDe(servidorB) });
  } finally {
    await Promise.all([fecharServidor(servidorA), fecharServidor(servidorB)]);
  }
}

function tokenAdministrador(idUsuario, idEstabelecimento) {
  return criarJwt({ idUsuario, perfil: 'administrador', idEstabelecimento, duracaoMs: 60_000, segredo: segredoJwt });
}

async function chamarPainel(url, metodo, caminho, token, dados) {
  const comCorpo = metodo !== 'GET';
  const resposta = await fetch(`${url}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(comCorpo ? { 'Content-Type': 'application/json' } : {}) },
    body: comCorpo ? JSON.stringify(dados ?? {}) : undefined
  });
  return { status: resposta.status, corpo: await resposta.json() };
}

// Consultas que o portão faz antes de decidir: host, sessão e permissões.
function consultasAlemDoPortao(consultas) {
  return consultas.filter(({ sql }) => !(
    sql.includes('FROM estabelecimentos AS e')
    || (sql.includes('DELETE FROM sessoes_admin') && sql.includes('expira_em'))
    || sql.includes('FROM sessoes_admin s')
    || sql.includes('FROM administrador_permissoes ap')
  ));
}

test('toda rota administrativa declara a permissão exigida e o conjunto completo abre todas', async () => {
  const rotas = await rotasAdministrativasDoApp();
  assert.ok(rotas.length >= 41, `Esperava ao menos 41 rotas administrativas, encontrei ${rotas.length}.`);
  const administradorCompleto = { permissoes: [...PERMISSOES_PADRAO_ADMINISTRADOR] };
  for (const { metodo, caminho } of rotas) {
    const permissao = permissaoDaRotaAdmin(metodo, caminho);
    assert.notEqual(permissao, undefined, `${metodo} ${caminho} não declara permissão em server/permissoes.js.`);
    assert.ok(permissao === null || CHAVES_PERMISSOES.includes(permissao), `${metodo} ${caminho} exige permissão fora do catálogo.`);
    // Quem existia antes da matriz recebeu o conjunto completo: continua passando em todas.
    assert.doesNotThrow(() => exigirPermissao(administradorCompleto, permissao), `${metodo} ${caminho}`);
  }
  assert.equal(permissaoDaRotaAdmin('GET', '/api/admin/rota-inexistente'), undefined);
});

test('sem a permissão exigida, cada rota administrativa responde 403 antes de qualquer consulta de negócio', async () => {
  const rotas = (await rotasAdministrativasDoApp())
    .map((rota) => ({ ...rota, permissao: permissaoDaRotaAdmin(rota.metodo, rota.caminho) }))
    .filter(({ permissao }) => permissao);
  assert.ok(rotas.length >= 38, `Esperava ao menos 38 rotas com permissão, encontrei ${rotas.length}.`);
  const contas = new Map([[101, { tenant: 11, nome: 'Admin A', usuario: 'admin-a' }]]);
  const permissoes = new Map();
  const { banco, consultas } = bancoPainelComPermissoes({ contas, permissoes });

  await comServidoresDoPainel(banco, async ({ urlA }) => {
    const token = tokenAdministrador(101, 11);
    for (const { metodo, caminho, permissao } of rotas) {
      // Todas as outras permissões, menos exatamente a exigida, e chamada direta à API.
      permissoes.set(101, CHAVES_PERMISSOES.filter((chave) => chave !== permissao));
      consultas.length = 0;
      const resposta = await chamarPainel(urlA, metodo, caminho, token, {
        permissoes: [...CHAVES_PERMISSOES],
        ativo: true,
        nome: 'Tentativa direta'
      });
      assert.equal(resposta.status, 403, `${metodo} ${caminho} sem ${permissao}`);
      assert.deepEqual(consultasAlemDoPortao(consultas), [], `${metodo} ${caminho} consultou dados sem ${permissao}`);
    }

    // Configuração: sem nenhum dos três grupos, nada é lido nem gravado.
    permissoes.set(101, CHAVES_PERMISSOES.filter((chave) => !PERMISSOES_CONFIGURACAO.includes(chave)));
    consultas.length = 0;
    const configuracao = await chamarPainel(urlA, 'PUT', '/api/admin/configuracao', token, { nomeLoja: 'Invadida' });
    assert.equal(configuracao.status, 403);
    assert.deepEqual(consultasAlemDoPortao(consultas), []);
  });
});

test('administrador da loja A não altera, arquiva, desarquiva nem apaga administrador da loja B', async () => {
  const contas = new Map([
    [101, { tenant: 11, nome: 'Admin A', usuario: 'admin-a' }],
    [201, { tenant: 22, nome: 'Admin B', usuario: 'admin-b' }],
    [202, { tenant: 22, nome: 'Arquivada B', usuario: 'arquivada-b', arquivado: true }]
  ]);
  const permissoes = new Map([[101, [...CHAVES_PERMISSOES]], [201, [...CHAVES_PERMISSOES]]]);
  const { banco, consultas } = bancoPainelComPermissoes({ contas, permissoes });
  const escritas = () => consultas.filter(({ sql }) => (
    /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)
    && !(sql.includes('DELETE FROM sessoes_admin') && sql.includes('expira_em'))
  ));

  await comServidoresDoPainel(banco, async ({ urlA, urlB }) => {
    const tokenA = tokenAdministrador(101, 11);
    const tentativas = [
      ['PUT', '/api/admin/administradores/201/permissoes', { permissoes: [] }],
      ['PATCH', '/api/admin/administradores/201/status', { ativo: false }],
      ['POST', '/api/admin/administradores/201/arquivar'],
      ['POST', '/api/admin/administradores/202/desarquivar'],
      ['DELETE', '/api/admin/administradores/201']
    ];
    for (const [metodo, caminho, dados] of tentativas) {
      consultas.length = 0;
      const resposta = await chamarPainel(urlA, metodo, caminho, tokenA, dados);
      assert.equal(resposta.status, 404, `${metodo} ${caminho}`);
      assert.deepEqual(escritas(), [], `${metodo} ${caminho} escreveu em conta de outro estabelecimento`);
      const buscas = consultas.filter(({ sql }) => sql.includes('FROM administradores'));
      assert.ok(buscas.length > 0 && buscas.every(({ parametros }) => parametros.includes(11)), `${metodo} ${caminho}`);
    }

    // A sessão da loja A no host da loja B é recusada antes de consultar sessão ou contas.
    consultas.length = 0;
    const cruzada = await chamarPainel(urlB, 'PUT', '/api/admin/administradores/201/permissoes', tokenA, { permissoes: [] });
    assert.equal(cruzada.status, 403);
    assert.equal(consultas.some(({ sql }) => sql.includes('FROM sessoes_admin s') || sql.includes('FROM administradores')), false);
  });
});

test('administrador não eleva as próprias permissões, não concede o que não possui e não arquiva nem apaga a própria conta', async () => {
  const contas = new Map([
    [101, { tenant: 11, nome: 'Gerente', usuario: 'gerente' }],
    [102, { tenant: 11, nome: 'Atendente', usuario: 'atendente' }]
  ]);
  const permissoes = new Map([
    [101, ['funcionarios.gerenciar', 'pedidos.visualizar']],
    [102, ['pedidos.visualizar']]
  ]);
  const { banco, consultas } = bancoPainelComPermissoes({ contas, permissoes });
  const escreveuEmContas = () => consultas.some(({ sql }) => (
    /INSERT INTO administrador_permissoes|DELETE FROM administrador_permissoes|UPDATE administradores|DELETE FROM administradores/.test(sql)
  ));

  await comServidoresDoPainel(banco, async ({ urlA }) => {
    const token = tokenAdministrador(101, 11);
    const casos = [
      ['PUT', '/api/admin/administradores/101/permissoes', { permissoes: [...CHAVES_PERMISSOES] }, /próprias permissões/],
      ['PUT', '/api/admin/administradores/102/permissoes', { permissoes: ['pedidos.visualizar', 'relatorios.visualizar'] }, /não possui/],
      ['POST', '/api/admin/administradores/101/arquivar', undefined, /própria conta/],
      ['DELETE', '/api/admin/administradores/101', undefined, /própria conta/],
      ['GET', '/api/admin/dashboard/indicadores?periodo=30dias', undefined, /permissão/]
    ];
    for (const [metodo, caminho, dados, mensagem] of casos) {
      consultas.length = 0;
      const resposta = await chamarPainel(urlA, metodo, caminho, token, dados);
      assert.equal(resposta.status, 403, `${metodo} ${caminho}`);
      assert.match(resposta.corpo.erro, mensagem);
      assert.equal(escreveuEmContas(), false, `${metodo} ${caminho} gravou algo`);
    }

    // Dentro do que possui, a edição de outra conta é aceita.
    const permitida = await chamarPainel(urlA, 'PUT', '/api/admin/administradores/102/permissoes', token, { permissoes: [] });
    assert.equal(permitida.status, 200);
    assert.deepEqual(permitida.corpo.administrador, { id: 102, permissoes: [] });
  });
});

test('a migration 017 dá a todo administrador existente o conjunto completo, igual ao catálogo', async () => {
  const listaPermissoes = (texto) => [...texto.matchAll(/'([a-z]+\.[a-z_]+)'/g)].map(([, chave]) => chave);
  const ordenar = (lista) => [...lista].sort();
  const listaDoCheck = (sql, origem) => {
    const bloco = sql.match(/CHECK \(permissao IN \(([\s\S]*?)\)\)/);
    assert.ok(bloco, `CHECK de permissões não encontrado em ${origem}`);
    return listaPermissoes(bloco[1]);
  };

  assert.deepEqual(ordenar(PERMISSOES_PADRAO_ADMINISTRADOR), ordenar(CHAVES_PERMISSOES));
  for (const caminho of [
    'database/migrations/017_permissoes_administradores.sql',
    'database/CRIAR_db.sql',
    'database/estrutura/001_criar_tabelas.sql'
  ]) {
    const sql = await readFile(resolve(pastaProjeto, caminho), 'utf8');
    assert.deepEqual(ordenar(listaDoCheck(sql, caminho)), ordenar(CHAVES_PERMISSOES), caminho);
  }

  const migration = await readFile(resolve(pastaProjeto, 'database/migrations/017_permissoes_administradores.sql'), 'utf8');
  const concessao = migration.match(/INSERT INTO administrador_permissoes[\s\S]*?;/);
  assert.ok(concessao, 'A migration 017 precisa conceder permissões aos administradores existentes.');
  assert.match(concessao[0], /SELECT a\.id_estabelecimento, a\.id, padrao\.permissao\s+FROM administradores a/);
  assert.match(concessao[0], /WHERE a\.id_estabelecimento IS NOT NULL/);
  const padrao = concessao[0].match(/CROSS JOIN \(([\s\S]*?)\) padrao/);
  assert.deepEqual(ordenar(listaPermissoes(padrao[1])), ordenar(PERMISSOES_PADRAO_ADMINISTRADOR));
  // Só acrescenta: não altera nem remove nada que já existia.
  assert.equal(/^\s*(UPDATE|DELETE|DROP|TRUNCATE)\b/im.test(migration), false);
});

test('loja A não lista, edita, ativa, desativa nem exclui áreas de entrega da loja B', async () => {
  const contas = new Map([[101, { tenant: 11, nome: 'Admin A', usuario: 'admin-a' }]]);
  const permissoes = new Map([[101, [...CHAVES_PERMISSOES]]]);
  const areas = [
    { id: 1, tenant: 11, nome: 'Centro' },
    { id: 2, tenant: 22, nome: 'Bairro da loja B' }
  ];
  const { banco, consultas } = bancoPainelComPermissoes({ contas, permissoes, areas });
  const escritas = () => consultas.filter(({ sql }) => (
    /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)
    && !(sql.includes('DELETE FROM sessoes_admin') && sql.includes('expira_em'))
  ));

  await comServidoresDoPainel(banco, async ({ urlA, urlB }) => {
    const token = tokenAdministrador(101, 11);
    const lista = await chamarPainel(urlA, 'GET', '/api/admin/areas-entrega?id_estabelecimento=22', token);
    assert.equal(lista.status, 200);
    assert.deepEqual(lista.corpo.areasEntrega.map((area) => area.id), [1]);

    for (const [metodo, caminho, dados] of [
      ['PUT', '/api/admin/areas-entrega/2', { nome: 'Tomada', taxaEntrega: 0, tempoEstimadoMin: 10, tempoEstimadoMax: 20 }],
      ['PATCH', '/api/admin/areas-entrega/2/status', { ativo: false }],
      ['DELETE', '/api/admin/areas-entrega/2']
    ]) {
      consultas.length = 0;
      const resposta = await chamarPainel(urlA, metodo, caminho, token, dados);
      assert.equal(resposta.status, 404, `${metodo} ${caminho}`);
      assert.deepEqual(escritas(), [], `${metodo} ${caminho} escreveu em área de outro estabelecimento`);
      const buscas = consultas.filter(({ sql }) => sql.includes('FROM areas_entrega'));
      assert.ok(buscas.length > 0 && buscas.every(({ parametros }) => Number(parametros[0]) === 11), `${metodo} ${caminho}`);
    }

    // Campos fora do mapeamento, como id_estabelecimento, são ignorados.
    consultas.length = 0;
    const criada = await chamarPainel(urlA, 'POST', '/api/admin/areas-entrega', token, {
      nome: '  Vila Nova ', taxaEntrega: '5,50', tempoEstimadoMin: 20, tempoEstimadoMax: 30,
      id_estabelecimento: 22, idEstabelecimento: 22, id: 2
    });
    assert.equal(criada.status, 201);
    const insercao = consultas.find(({ sql }) => sql.includes('INSERT INTO areas_entrega'));
    assert.deepEqual(insercao.parametros, [11, 'Vila Nova', 550, 20, 30, 1]);

    // Payload inválido é recusado antes de gravar.
    for (const invalida of [
      {},
      { nome: ['Centro'], taxaEntrega: 1, tempoEstimadoMin: 10, tempoEstimadoMax: 20 },
      { nome: 'Área', taxaEntrega: true, tempoEstimadoMin: 10, tempoEstimadoMax: 20 },
      { nome: 'Área', taxaEntrega: 1, tempoEstimadoMin: 0, tempoEstimadoMax: 20 },
      { nome: 'Área', taxaEntrega: 1, tempoEstimadoMin: 10, tempoEstimadoMax: 601 },
      { nome: 'Área', taxaEntrega: 1, tempoEstimadoMin: 20, tempoEstimadoMax: 10 }
    ]) {
      consultas.length = 0;
      assert.equal((await chamarPainel(urlA, 'POST', '/api/admin/areas-entrega', token, invalida)).status, 400);
      assert.deepEqual(escritas(), []);
    }

    // Sessão da loja A no host da loja B: recusada antes de tocar nas áreas.
    consultas.length = 0;
    const cruzada = await chamarPainel(urlB, 'DELETE', '/api/admin/areas-entrega/2', token);
    assert.equal(cruzada.status, 403);
    assert.equal(consultas.some(({ sql }) => sql.includes('FROM areas_entrega')), false);

    // Público: cada host vê só as próprias áreas, sem aceitar tenant da URL.
    const publicoB = await fetch(`${urlB}/api/publico/areas-entrega?id_estabelecimento=11`);
    assert.equal(publicoB.status, 200);
    assert.deepEqual((await publicoB.json()).areasEntrega.map((area) => area.id), [2]);
  });
});

test('pedido guarda a área com chave estrangeira presa ao estabelecimento e a migration 019 não apaga nada', async () => {
  const chaveComposta = /FOREIGN KEY \(id_estabelecimento, area_entrega_id\)\s+REFERENCES areas_entrega\(id_estabelecimento, id\) ON DELETE RESTRICT/;
  for (const caminho of [
    'database/migrations/019_areas_entrega.sql',
    'database/CRIAR_db.sql',
    'database/estrutura/002_criar_relacionamentos.sql'
  ]) {
    assert.match(await readFile(resolve(pastaProjeto, caminho), 'utf8'), chaveComposta, caminho);
  }
  for (const caminho of ['database/migrations/019_areas_entrega.sql', 'database/CRIAR_db.sql', 'database/estrutura/001_criar_tabelas.sql']) {
    const sql = await readFile(resolve(pastaProjeto, caminho), 'utf8');
    assert.match(sql, /UNIQUE KEY uk_areas_entrega_estabelecimento_nome \(id_estabelecimento, nome\)/, caminho);
    assert.match(sql, /CHECK \(tempo_estimado_min > 0 AND tempo_estimado_max >= tempo_estimado_min\)/, caminho);
  }
  const migration = await readFile(resolve(pastaProjeto, 'database/migrations/019_areas_entrega.sql'), 'utf8');
  assert.equal(/^\s*(UPDATE|DELETE|DROP|TRUNCATE)\b|DROP COLUMN/im.test(migration), false);
});

test('cada campo da configuração pertence a exatamente um grupo de permissão', async () => {
  const codigo = await readFile(resolve(pastaProjeto, 'server/operations.js'), 'utf8');
  const inicio = codigo.indexOf('export async function salvarConfiguracao(');
  const fim = codigo.indexOf('function mapearPromocao(', inicio);
  assert.ok(inicio > 0 && fim > inicio, 'salvarConfiguracao não encontrada em operations.js.');
  const lidos = new Set([...codigo.slice(inicio, fim).matchAll(/dados\.(\w+)/g)].map(([, campo]) => campo));
  const porGrupo = Object.values(CAMPOS_CONFIGURACAO_POR_PERMISSAO).flat();
  assert.equal(new Set(porGrupo).size, porGrupo.length, 'Um campo aparece em mais de um grupo.');
  assert.deepEqual([...lidos].sort(), [...porGrupo].sort());
  assert.deepEqual([...PERMISSOES_CONFIGURACAO].sort(), ['configuracoes.editar', 'delivery.editar', 'personalizacao.editar']);
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
  /*
    Sintaxe que só existe em um dos dois motores. Produção roda MariaDB e o
    desenvolvimento roda MySQL, então uma migration escrita no dialeto errado
    passa limpa aqui e só quebra no deploy — que é o pior lugar para descobrir.
    Este teste é o que substitui não ter um MariaDB para rodar os testes.
  */
  const dialetoProibido = [
    [/\bDROP\s+CHECK\b/i, 'DROP CHECK é do MySQL 8.0.16+ e não existe no MariaDB; use DROP CONSTRAINT'],
    [/\bANY_VALUE\s*\(/i, 'ANY_VALUE não existe no MariaDB'],
    [/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b/i, 'CREATE INDEX IF NOT EXISTS é do MariaDB e não existe no MySQL'],
    [/\bADD\s+(?:COLUMN|INDEX|KEY|CONSTRAINT)\s+IF\s+NOT\s+EXISTS\b/i, 'ADD ... IF NOT EXISTS é do MariaDB e não existe no MySQL'],
    [/\bDROP\s+(?:COLUMN|INDEX|KEY|CONSTRAINT|FOREIGN\s+KEY)\s+IF\s+EXISTS\b/i, 'DROP ... IF EXISTS é do MariaDB e não existe no MySQL']
  ];

  for (const migration of migracoes) {
    const conteudo = await readFile(resolve(pastaMigracoes, migration), 'utf8');
    assert.equal(/\bDROP\s+TABLE\b/i.test(conteudo), false, `DROP TABLE encontrado em ${migration}`);
    assert.equal(/\bTRUNCATE\b/i.test(conteudo), false, `TRUNCATE encontrado em ${migration}`);
    assert.equal(/\bDELETE\s+FROM\b/i.test(conteudo), false, `DELETE FROM encontrado em ${migration}`);
    assert.equal(/SELECT\s+\*/i.test(conteudo), false, `SELECT * encontrado em ${migration}`);
    // Comentário explicando o porquê da escolha não conta como uso.
    const semComentarios = conteudo.replace(/^\s*--.*$/gm, '');
    for (const [padrao, motivo] of dialetoProibido) {
      assert.equal(padrao.test(semComentarios), false, `${migration}: ${motivo}.`);
    }
  }

  // Uma instalação nova por CRIAR_db.sql já contém a estrutura final, então
  // ele precisa registrar o checksum de TODA migration. Sem isso o runner
  // reaplica ALTERs sobre colunas que já existem e a migração quebra.
  const checksumsRegistrados = new Map(
    [...sqlCriacao.matchAll(/\('(\d{3}_[a-z0-9_-]+\.sql)',\s*'([0-9a-f]{64})'\)/g)]
      .map((ocorrencia) => [ocorrencia[1], ocorrencia[2]])
  );
  for (const migration of migracoes) {
    const conteudo = await readFile(resolve(pastaMigracoes, migration), 'utf8');
    assert.equal(
      checksumsRegistrados.get(migration),
      checksumMigration(conteudo),
      `database/CRIAR_db.sql precisa registrar ${migration} com o checksum atual em schema_migrations.`
    );
  }

  /*
    Arquivo de exemplo documenta o nome da variável, nunca o valor. Já
    aconteceu de um token de dispositivo real ser colado aqui e ir junto no
    commit; a heurística abaixo separa um segredo gerado (maiúscula, minúscula
    e dígito misturados, como o base64url que o painel emite) de um
    placeholder escrito por gente ("troque-por-uma-senha-local-segura").
  */
  const pareceSegredoGerado = (valor) => (
    valor.length >= 24
    && /[a-z]/.test(valor)
    && /[A-Z]/.test(valor)
    && /\d/.test(valor)
    && !/\s/.test(valor)
  );
  for (const exemplo of ['env.example', 'agente-impressao/env.example']) {
    const conteudo = await readFile(resolve(pastaProjeto, exemplo), 'utf8');
    for (const [, chave, valor] of conteudo.matchAll(/^(\w*(?:TOKEN|SECRET|PASSWORD|SENHA)\w*)\s*=\s*(\S+)\s*$/gim)) {
      assert.equal(
        pareceSegredoGerado(valor),
        false,
        `${exemplo}: ${chave} parece conter um segredo real. O valor vai no .env, não no exemplo versionado.`
      );
    }
  }

  const testesApi = await readFile(resolve(pastaProjeto, 'server/api.test.js'), 'utf8');
  assert.match(testesApi, /process\.env\.RUN_MYSQL_TESTS\s*===\s*'1'/);
  assert.equal(
    /Boolean\(process\.env\.DB_PASSWORD\)/.test(testesApi),
    false,
    'A presença de senha no .env não pode autorizar testes que criam ou removem banco.'
  );
});

/*
  Banco em memória para o ciclo de vida do estabelecimento. Guarda duas lojas,
  as sessões abertas de cada uma e a auditoria, e responde exatamente às
  consultas que o login do superadmin, as ações de ciclo de vida e a validação
  de sessão de admin e garçom fazem. Consulta fora dessa lista derruba o teste.
*/
function bancoCicloDeVida() {
  const lojas = new Map([
    [11, linhaTenant(11, 'loja-a', {
      suspenso_em: null, motivo_suspensao: null, arquivado_em: null, arquivado_por: null
    })],
    [22, linhaTenant(22, 'loja-b', {
      suspenso_em: null, motivo_suspensao: null, arquivado_em: null, arquivado_por: null
    })]
  ]);
  const tokens = {
    adminA: criarJwt({ idUsuario: 101, perfil: 'administrador', idEstabelecimento: 11, duracaoMs: 60_000, segredo: segredoJwt }),
    garcomA: criarJwt({ idUsuario: 201, perfil: 'garcom', idEstabelecimento: 11, duracaoMs: 60_000, segredo: segredoJwt }),
    adminB: criarJwt({ idUsuario: 102, perfil: 'administrador', idEstabelecimento: 22, duracaoMs: 60_000, segredo: segredoJwt }),
    garcomB: criarJwt({ idUsuario: 202, perfil: 'garcom', idEstabelecimento: 22, duracaoMs: 60_000, segredo: segredoJwt })
  };
  const sessoesAdmin = [
    { token_hash: criarHashToken(tokens.adminA), id_estabelecimento: 11, administrador_id: 101 },
    { token_hash: criarHashToken(tokens.adminB), id_estabelecimento: 22, administrador_id: 102 }
  ];
  const sessoesGarcom = [
    { token_hash: criarHashToken(tokens.garcomA), id_estabelecimento: 11, funcionario_id: 201 },
    { token_hash: criarHashToken(tokens.garcomB), id_estabelecimento: 22, funcionario_id: 202 }
  ];
  const auditoria = [];
  const escritas = [];

  function removerSessoes(lista, idEstabelecimento) {
    const antes = lista.length;
    for (let indice = lista.length - 1; indice >= 0; indice -= 1) {
      if (lista[indice].id_estabelecimento === idEstabelecimento) lista.splice(indice, 1);
    }
    return antes - lista.length;
  }

  function responder(sql, parametros = []) {
    if (/^\s*(UPDATE|DELETE|INSERT)/i.test(sql)) escritas.push({ sql, parametros });
    if (sql.includes('FROM superadministradores') && sql.includes('senha_hash')) {
      return [[{
        id: 1, nome: 'Super', usuario: 'super', email: 'super@teste.local',
        senha_hash: criarHashSenha('senha-global-segura')
      }]];
    }
    if (sql.includes('INSERT INTO sessoes_superadmin')) return [{ affectedRows: 1 }];
    if (sql.includes('DELETE FROM sessoes_superadmin')) return [{ affectedRows: 0 }];
    if (sql.includes('FROM sessoes_superadmin ss')) {
      return [[{ id: 1, nome: 'Super', usuario: 'super', email: 'super@teste.local' }]];
    }
    if (sql.includes('FROM estabelecimentos AS e')) {
      return [[...lojas.values()].filter((loja) => loja.slug === parametros[0])];
    }
    if (sql.includes('FOR UPDATE') && sql.includes('FROM estabelecimentos')) {
      const loja = lojas.get(Number(parametros[0]));
      return [loja ? [{ ...loja }] : []];
    }
    if (sql.includes('FROM estabelecimentos e')) {
      const loja = lojas.get(Number(parametros[0]));
      return [loja ? [{ ...loja, total_administradores: 1 }] : []];
    }
    if (sql.includes('UPDATE estabelecimentos')) {
      const id = Number(parametros.at(-1));
      const loja = lojas.get(id);
      const origem = sql.match(/AND status = '(\w+)'/)?.[1];
      const destino = sql.match(/SET status = '(\w+)'/)?.[1];
      if (!loja || loja.status !== origem) return [{ affectedRows: 0 }];
      if (destino === 'suspenso' && origem === 'ativo') {
        Object.assign(loja, { status: 'suspenso', suspenso_em: new Date(), motivo_suspensao: parametros[0] });
      } else if (destino === 'ativo') {
        Object.assign(loja, { status: 'ativo', suspenso_em: null, motivo_suspensao: null });
      } else if (destino === 'arquivado') {
        Object.assign(loja, { status: 'arquivado', arquivado_em: new Date(), arquivado_por: parametros[0] });
      } else {
        Object.assign(loja, { status: 'suspenso', arquivado_em: null, arquivado_por: null });
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('DELETE FROM sessoes_admin') && sql.includes('expira_em')) return [{ affectedRows: 0 }];
    if (sql.includes('DELETE FROM sessoes_garcom') && sql.includes('expira_em')) return [{ affectedRows: 0 }];
    if (sql.includes('DELETE FROM sessoes_admin')) {
      return [{ affectedRows: removerSessoes(sessoesAdmin, Number(parametros[0])) }];
    }
    if (sql.includes('DELETE FROM sessoes_garcom')) {
      return [{ affectedRows: removerSessoes(sessoesGarcom, Number(parametros[0])) }];
    }
    if (sql.includes('INSERT INTO auditoria_superadmin')) {
      auditoria.push({
        superadministradorId: parametros[0],
        idEstabelecimento: parametros[1],
        acao: parametros[2],
        detalhes: JSON.parse(parametros[3])
      });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM administrador_permissoes ap')) return [[{ permissao: 'pedidos.visualizar' }]];
    if (sql.includes('FROM sessoes_admin s')) {
      const [hash, idEstabelecimento, idUsuario] = parametros;
      const sessao = sessoesAdmin.find((item) => item.token_hash === hash
        && item.id_estabelecimento === Number(idEstabelecimento)
        && item.administrador_id === Number(idUsuario));
      return [sessao ? [{
        id: sessao.administrador_id, nome: 'Admin', usuario: 'admin', email: 'admin@teste.local',
        id_estabelecimento: sessao.id_estabelecimento
      }] : []];
    }
    if (sql.includes('FROM sessoes_garcom s')) {
      const [hash, idEstabelecimento, idUsuario] = parametros;
      const sessao = sessoesGarcom.find((item) => item.token_hash === hash
        && item.id_estabelecimento === Number(idEstabelecimento)
        && item.funcionario_id === Number(idUsuario));
      return [sessao ? [{
        id: sessao.funcionario_id, nome: 'Garçom', cargo: 'Garçom',
        id_estabelecimento: sessao.id_estabelecimento
      }] : []];
    }
    throw new Error(`Consulta inesperada no teste: ${sql}`);
  }

  const conexao = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, parametros) { return responder(sql, parametros); }
  };
  return {
    lojas,
    tokens,
    sessoesAdmin,
    sessoesGarcom,
    auditoria,
    escritas,
    banco: {
      async getConnection() { return conexao; },
      async execute(sql, parametros) { return responder(sql, parametros); }
    }
  };
}

async function servidoresCicloDeVida(banco) {
  const servidores = ['loja-a', 'loja-b'].map((slug) => criarServidor({
    banco,
    pastaUploads: resolve(pastaProjeto, 'server/uploads'),
    tenantDesenvolvimento: slug,
    jwtSecret: segredoJwt
  }));
  await Promise.all(servidores.map((servidor) => aguardarServidor(servidor, 0)));
  const [urlA, urlB] = servidores.map((servidor) => `http://127.0.0.1:${servidor.address().port}`);
  const login = await fetch(`${urlA}/api/superadmin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'super', senha: 'senha-global-segura' })
  });
  assert.equal(login.status, 200);
  const { token: tokenSuperadmin } = await login.json();
  return {
    urlA,
    urlB,
    tokenSuperadmin,
    fechar: () => Promise.all(servidores.map((servidor) => fecharServidor(servidor)))
  };
}

test('suspender e arquivar a loja A derruba só as sessões da A, não mexe na B, e reativar não as devolve', async () => {
  const { banco, lojas, tokens, sessoesAdmin, sessoesGarcom, auditoria } = bancoCicloDeVida();
  const { urlA, urlB, tokenSuperadmin, fechar } = await servidoresCicloDeVida(banco);
  const acao = (id, nome, corpo = {}) => fetch(`${urlA}/api/superadmin/estabelecimentos/${id}/${nome}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSuperadmin}` },
    body: JSON.stringify(corpo)
  });
  const sessao = (url, perfil, token) => fetch(`${url}/api/${perfil}/sessao`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  try {
    // Antes: as quatro sessões valem, cada uma no próprio host.
    assert.equal((await sessao(urlA, 'admin', tokens.adminA)).status, 200);
    assert.equal((await sessao(urlA, 'garcom', tokens.garcomA)).status, 200);
    assert.equal((await sessao(urlB, 'admin', tokens.adminB)).status, 200);
    assert.equal((await sessao(urlB, 'garcom', tokens.garcomB)).status, 200);

    const suspensao = await acao(11, 'suspender', { motivo: 'Mensalidade em aberto' });
    assert.equal(suspensao.status, 200);
    assert.equal((await suspensao.json()).estabelecimento.status, 'suspenso');

    // A loja A perdeu todas as sessões; a B ficou intacta, status e sessões.
    assert.deepEqual(sessoesAdmin.map((item) => item.id_estabelecimento), [22]);
    assert.deepEqual(sessoesGarcom.map((item) => item.id_estabelecimento), [22]);
    assert.equal(lojas.get(22).status, 'ativo');
    assert.equal(lojas.get(22).motivo_suspensao, null);
    assert.equal((await sessao(urlB, 'admin', tokens.adminB)).status, 200);
    assert.equal((await sessao(urlB, 'garcom', tokens.garcomB)).status, 200);

    // Suspensa, a loja A recusa até a validação de sessão.
    assert.equal((await sessao(urlA, 'admin', tokens.adminA)).status, 403);

    // Reativar não recria sessão: o token antigo do admin e do garçom da A
    // continua sem valer mesmo com a loja de volta ao ar.
    assert.equal((await acao(11, 'reativar')).status, 200);
    assert.equal(lojas.get(11).status, 'ativo');
    assert.equal((await sessao(urlA, 'admin', tokens.adminA)).status, 401);
    assert.equal((await sessao(urlA, 'garcom', tokens.garcomA)).status, 401);

    // Arquivar também derruba sessão — inclusive uma aberta depois da reativação.
    sessoesAdmin.push({ token_hash: criarHashToken(tokens.adminA), id_estabelecimento: 11, administrador_id: 101 });
    assert.equal((await acao(11, 'suspender', { motivo: 'Cliente pediu o encerramento' })).status, 200);
    sessoesAdmin.push({ token_hash: criarHashToken(tokens.adminA), id_estabelecimento: 11, administrador_id: 101 });
    const arquivamento = await acao(11, 'arquivar', { confirmacaoSlug: 'loja-a' });
    assert.equal(arquivamento.status, 200);
    assert.equal(lojas.get(11).status, 'arquivado');
    assert.equal(lojas.get(11).arquivado_por, 1);
    assert.deepEqual(sessoesAdmin.map((item) => item.id_estabelecimento), [22]);
    assert.equal(lojas.get(22).status, 'ativo');
    assert.equal(lojas.get(22).arquivado_em, null);

    // Desarquivar volta para suspenso, sem sessão nenhuma recriada.
    assert.equal((await acao(11, 'desarquivar')).status, 200);
    assert.equal(lojas.get(11).status, 'suspenso');
    assert.deepEqual(sessoesAdmin.map((item) => item.id_estabelecimento), [22]);

    // Toda ação ficou na auditoria da própria loja A, com o autor.
    assert.equal(auditoria.every((registro) => registro.idEstabelecimento === 11), true);
    assert.equal(auditoria.every((registro) => registro.superadministradorId === 1), true);
    assert.deepEqual(auditoria.map((registro) => registro.acao), [
      'estabelecimento.suspenso',
      'estabelecimento.reativado',
      'estabelecimento.suspenso',
      'estabelecimento.arquivado',
      'estabelecimento.desarquivado'
    ]);
    assert.deepEqual(auditoria[0].detalhes.sessoesEncerradas, { administradores: 1, garcons: 1 });
  } finally {
    await fechar();
  }
});

test('só o superadministrador suspende, reativa, arquiva ou desarquiva um estabelecimento', async () => {
  const { banco, lojas, tokens, sessoesAdmin, sessoesGarcom, auditoria, escritas } = bancoCicloDeVida();
  const { urlA, tokenSuperadmin, fechar } = await servidoresCicloDeVida(banco);
  const corpos = {
    suspender: { motivo: 'Tentativa sem permissão' },
    reativar: {},
    arquivar: { confirmacaoSlug: 'loja-a' },
    desarquivar: {}
  };

  try {
    for (const token of [tokens.adminA, tokens.garcomA, tokens.adminB]) {
      for (const [nome, corpo] of Object.entries(corpos)) {
        for (const id of [11, 22]) {
          const resposta = await fetch(`${urlA}/api/superadmin/estabelecimentos/${id}/${nome}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(corpo)
          });
          assert.equal(resposta.status, 403, `${nome} com token de loja deveria ser 403`);
        }
      }
    }
    const semToken = await fetch(`${urlA}/api/superadmin/estabelecimentos/11/suspender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpos.suspender)
    });
    assert.equal(semToken.status, 401);

    // Nada foi gravado: status, sessões e auditoria como antes.
    assert.equal(escritas.some(({ sql }) => /estabelecimentos|sessoes_admin|sessoes_garcom|auditoria/.test(sql)
      && !/sessoes_superadmin/.test(sql)), false);
    assert.equal(lojas.get(11).status, 'ativo');
    assert.equal(lojas.get(22).status, 'ativo');
    assert.equal(sessoesAdmin.length, 2);
    assert.equal(sessoesGarcom.length, 2);
    assert.equal(auditoria.length, 0);

    // O mesmo pedido com o token global passa.
    const suspensao = await fetch(`${urlA}/api/superadmin/estabelecimentos/22/suspender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSuperadmin}` },
      body: JSON.stringify(corpos.suspender)
    });
    assert.equal(suspensao.status, 200);
    assert.equal(lojas.get(22).status, 'suspenso');
    assert.equal(lojas.get(11).status, 'ativo');
  } finally {
    await fechar();
  }
});

test('ação em andamento é cortada na requisição seguinte à suspensão, só na loja suspensa', async () => {
  const { banco, tokens, escritas } = bancoCicloDeVida();
  const { urlA, urlB, tokenSuperadmin, fechar } = await servidoresCicloDeVida(banco);
  const chamar = (url, caminho, { metodo = 'GET', token, corpo } = {}) => fetch(`${url}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });

  try {
    // Garçom e admin da loja A no meio do turno, com sessão válida.
    assert.equal((await chamar(urlA, '/api/garcom/sessao', { token: tokens.garcomA })).status, 200);
    assert.equal((await chamar(urlA, '/api/admin/sessao', { token: tokens.adminA })).status, 200);

    const suspensao = await chamar(urlA, '/api/superadmin/estabelecimentos/11/suspender', {
      metodo: 'POST',
      token: tokenSuperadmin,
      corpo: { motivo: 'Motivo interno que não pode vazar' }
    });
    assert.equal(suspensao.status, 200);

    // A próxima ação de cada um já cai no bloqueio da loja, antes de qualquer
    // consulta de comanda, pagamento ou pedido.
    const pedidos = [
      ['/api/garcom/comandas/1/itens', { metodo: 'POST', token: tokens.garcomA, corpo: { produtoId: 1, quantidade: 1 } }],
      ['/api/garcom/comandas/1/enviar', { metodo: 'POST', token: tokens.garcomA, corpo: {} }],
      ['/api/admin/comandas/1/finalizar', { metodo: 'POST', token: tokens.adminA, corpo: { pagamento: 'Dinheiro' } }],
      ['/api/pedidos', { metodo: 'POST', corpo: { itens: [] } }],
      ['/api/catalogo', {}]
    ];
    for (const [caminho, opcoes] of pedidos) {
      const resposta = await chamar(urlA, caminho, opcoes);
      assert.equal(resposta.status, 403, caminho);
      const corpo = await resposta.json();
      assert.equal(corpo.codigo, 'estabelecimento_indisponivel', caminho);
      assert.equal(JSON.stringify(corpo).includes('Motivo interno'), false, caminho);
    }
    assert.equal(escritas.some(({ sql }) => /comanda|pedido|pagamento/i.test(sql)), false);

    // Loja B segue atendendo normalmente, com as mesmas sessões.
    assert.equal((await chamar(urlB, '/api/garcom/sessao', { token: tokens.garcomB })).status, 200);
    assert.equal((await chamar(urlB, '/api/admin/sessao', { token: tokens.adminB })).status, 200);

    // Arquivada, a loja A continua bloqueada do mesmo jeito, e a B intacta.
    assert.equal((await chamar(urlA, '/api/superadmin/estabelecimentos/11/arquivar', {
      metodo: 'POST', token: tokenSuperadmin, corpo: { confirmacaoSlug: 'loja-a' }
    })).status, 200);
    const arquivada = await chamar(urlA, '/api/catalogo');
    assert.equal(arquivada.status, 403);
    assert.equal((await arquivada.json()).codigo, 'estabelecimento_indisponivel');
    assert.equal((await chamar(urlB, '/api/admin/sessao', { token: tokens.adminB })).status, 200);
  } finally {
    await fechar();
  }
});

/*
  Banco em memória da senha temporária: duas lojas, um administrador em cada,
  sessões e auditorias. Responde só às consultas do login, da validação da
  sessão, da troca de senha, do reset pelo superadmin, do logout e da lista de
  áreas de entrega (a rota comum usada para provar o acesso liberado).
*/
function bancoSenhaTemporaria() {
  const lojas = new Map([
    ['loja-a', linhaTenant(10, 'loja-a')],
    ['loja-b', linhaTenant(20, 'loja-b')]
  ]);
  const administradores = new Map([
    [100, {
      id: 100, id_estabelecimento: 10, usuario: 'admin-a', nome: 'Admin A', email: 'a@loja.local',
      senha_hash: criarHashSenha('senha-temporaria-a1'), trocar_senha_em_proximo_acesso: 1, ativo: 1
    }],
    [200, {
      id: 200, id_estabelecimento: 20, usuario: 'admin-b', nome: 'Admin B', email: 'b@loja.local',
      senha_hash: criarHashSenha('senha-definitiva-b1'), trocar_senha_em_proximo_acesso: 0, ativo: 1
    }]
  ]);
  const sessoes = [];
  const consultasDeNegocio = [];

  function administradorDaLoja(id, idEstabelecimento) {
    const administrador = administradores.get(Number(id));
    return administrador && administrador.id_estabelecimento === Number(idEstabelecimento) ? administrador : null;
  }

  function responder(sql, parametros = []) {
    if (sql.includes('FROM estabelecimentos AS e')) {
      return [[lojas.get(parametros[0])].filter(Boolean)];
    }
    if (sql.includes('FROM administradores') && sql.includes('LOWER(usuario)')) {
      const [idEstabelecimento, identificador] = parametros;
      const administrador = [...administradores.values()].find((item) => item.id_estabelecimento === idEstabelecimento
        && item.ativo === 1 && [item.usuario, item.email].includes(String(identificador).toLowerCase()));
      return [administrador ? [{ ...administrador }] : []];
    }
    if (sql.includes('INSERT INTO sessoes_admin')) {
      const [tokenHash, idEstabelecimento, administradorId] = parametros;
      sessoes.push({ token_hash: tokenHash, id_estabelecimento: idEstabelecimento, administrador_id: Number(administradorId) });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('INSERT INTO auditoria_admin') || sql.includes('INSERT INTO auditoria_superadmin')) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('DELETE FROM sessoes_admin')) {
      const antes = sessoes.length;
      let manter;
      if (sql.includes('expira_em')) manter = () => true;
      else if (sql.includes('token_hash <> ?')) {
        const [administradorId, idEstabelecimento, tokenHash] = parametros;
        manter = (item) => !(item.administrador_id === Number(administradorId)
          && item.id_estabelecimento === Number(idEstabelecimento) && item.token_hash !== tokenHash);
      } else if (sql.includes('token_hash = ?')) {
        const [tokenHash, idEstabelecimento] = parametros;
        manter = (item) => !(item.token_hash === tokenHash && item.id_estabelecimento === Number(idEstabelecimento));
      } else {
        const [administradorId, idEstabelecimento] = parametros;
        manter = (item) => !(item.administrador_id === Number(administradorId)
          && item.id_estabelecimento === Number(idEstabelecimento));
      }
      const restantes = sessoes.filter(manter);
      sessoes.splice(0, sessoes.length, ...restantes);
      return [{ affectedRows: antes - sessoes.length }];
    }
    if (sql.includes('FROM sessoes_admin s')) {
      const [tokenHash, idEstabelecimento, administradorId] = parametros;
      const sessao = sessoes.find((item) => item.token_hash === tokenHash
        && item.id_estabelecimento === Number(idEstabelecimento)
        && item.administrador_id === Number(administradorId));
      const administrador = sessao && administradorDaLoja(administradorId, idEstabelecimento);
      return [administrador?.ativo === 1 ? [{ ...administrador }] : []];
    }
    if (sql.includes('FROM administrador_permissoes ap')) {
      return [[{ permissao: 'delivery.editar' }, { permissao: 'funcionarios.gerenciar' }]];
    }
    // Administrador criado no painel (criarAdministrador): as colunas e os
    // valores vêm do próprio INSERT, inclusive a marca de senha temporária.
    if (sql.includes('INSERT INTO administradores')) {
      const [, colunas, valores] = sql.match(/\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/);
      const parametrosRestantes = [...parametros];
      const linha = Object.fromEntries(colunas.split(',').map((coluna, indice) => {
        const valor = valores.split(',')[indice].trim();
        return [coluna.trim(), valor === '?' ? parametrosRestantes.shift() : Number(valor)];
      }));
      const id = Math.max(...administradores.keys()) + 1;
      administradores.set(id, { trocar_senha_em_proximo_acesso: 0, ...linha, id });
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (sql.includes('INSERT INTO administrador_permissoes')) return [{ affectedRows: 1 }];
    if (sql.includes('SELECT id, usuario, email, nome, ativo, criado_em')) {
      const administrador = administradorDaLoja(parametros[0], parametros[1]);
      return [administrador ? [{ ...administrador, criado_em: new Date() }] : []];
    }
    if (sql.includes('FROM areas_entrega')) {
      consultasDeNegocio.push(Number(parametros[0]));
      return [[]];
    }
    if (sql.includes('SELECT senha_hash FROM administradores')) {
      const administrador = administradorDaLoja(parametros[0], parametros[1]);
      return [administrador ? [{ senha_hash: administrador.senha_hash }] : []];
    }
    if (sql.includes('SELECT id, usuario, nome FROM administradores')) {
      const administrador = administradorDaLoja(parametros[0], parametros[1]);
      return [administrador ? [{ id: administrador.id, usuario: administrador.usuario, nome: administrador.nome }] : []];
    }
    if (sql.includes('UPDATE administradores SET senha_hash')) {
      const [hash, id, idEstabelecimento] = parametros;
      const administrador = administradorDaLoja(id, idEstabelecimento);
      if (!administrador) return [{ affectedRows: 0 }];
      administrador.senha_hash = hash;
      administrador.trocar_senha_em_proximo_acesso = Number(sql.match(/trocar_senha_em_proximo_acesso = (\d)/)[1]);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Consulta inesperada no teste: ${sql}`);
  }

  const conexao = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, parametros) { return responder(sql, parametros); }
  };
  return {
    administradores,
    sessoes,
    consultasDeNegocio,
    banco: {
      async getConnection() { return conexao; },
      async execute(sql, parametros) { return responder(sql, parametros); }
    }
  };
}

async function servidorDaLoja(banco, slug) {
  const servidor = criarServidor({
    banco,
    pastaUploads: resolve(pastaProjeto, 'server/uploads'),
    tenantDesenvolvimento: slug,
    jwtSecret: segredoJwt
  });
  await aguardarServidor(servidor, 0);
  const url = `http://127.0.0.1:${servidor.address().port}`;
  const chamar = async (caminho, { metodo = 'GET', token, corpo } = {}) => {
    const resposta = await fetch(`${url}${caminho}`, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo)
    });
    const texto = await resposta.text();
    return { status: resposta.status, texto, corpo: texto ? JSON.parse(texto) : {} };
  };
  const entrar = (usuario, senha) => chamar('/api/admin/login', { metodo: 'POST', corpo: { usuario, senha } });
  return { servidor, chamar, entrar };
}

test('senha temporária: o painel só atende a troca de senha e o logout até o administrador trocar', async () => {
  const { banco, administradores, sessoes, consultasDeNegocio } = bancoSenhaTemporaria();
  const { servidor, chamar, entrar } = await servidorDaLoja(banco, 'loja-a');
  const pendente = (resposta, rotulo) => {
    assert.equal(resposta.status, 403, rotulo);
    assert.equal(resposta.corpo.codigo, 'senha_temporaria_pendente', rotulo);
  };

  try {
    // 1º login: entra, mas a resposta avisa que a senha precisa ser trocada.
    const login = await entrar('admin-a', 'senha-temporaria-a1');
    assert.equal(login.status, 200);
    assert.equal(login.corpo.trocarSenhaNoProximoAcesso, true);
    assert.equal(login.texto.includes('senha-temporaria-a1'), false);
    assert.equal(login.texto.includes('scrypt'), false);
    const { token } = login.corpo;

    // Qualquer outra rota autenticada: 403 com o código, antes de consultar dados.
    pendente(await chamar('/api/admin/sessao', { token }), 'sessao');
    pendente(await chamar('/api/admin/areas-entrega', { token }), 'areas-entrega');
    pendente(await chamar('/api/admin/dados', { token }), 'dados');
    pendente(await chamar('/api/admin/categorias', { metodo: 'POST', token, corpo: { nome: 'Nova' } }), 'categorias');
    pendente(await chamar('/api/admin/configuracao', { metodo: 'PUT', token, corpo: {} }), 'configuracao');
    assert.deepEqual(consultasDeNegocio, []);

    // A troca de senha é atendida (com as validações de sempre).
    assert.equal((await chamar('/api/admin/senha', {
      metodo: 'PUT', token, corpo: { senhaAtual: 'errada', novaSenha: 'minha-senha-nova-a1', confirmacaoSenha: 'minha-senha-nova-a1' }
    })).status, 401);
    assert.equal((await chamar('/api/admin/senha', {
      metodo: 'PUT', token, corpo: { senhaAtual: 'senha-temporaria-a1', novaSenha: 'curta', confirmacaoSenha: 'curta' }
    })).status, 400);
    assert.equal(administradores.get(100).trocar_senha_em_proximo_acesso, 1);

    const troca = await chamar('/api/admin/senha', {
      metodo: 'PUT', token, corpo: { senhaAtual: 'senha-temporaria-a1', novaSenha: 'minha-senha-nova-a1', confirmacaoSenha: 'minha-senha-nova-a1' }
    });
    assert.equal(troca.status, 200);
    assert.equal(administradores.get(100).trocar_senha_em_proximo_acesso, 0);

    // Mesma sessão, agora liberada.
    const sessao = await chamar('/api/admin/sessao', { token });
    assert.equal(sessao.status, 200);
    assert.equal(sessao.corpo.admin.id, 100);
    assert.equal((await chamar('/api/admin/areas-entrega', { token })).status, 200);
    assert.deepEqual(consultasDeNegocio, [10]);

    // A senha temporária não entra mais; a nova entra sem pedir troca.
    assert.equal((await entrar('admin-a', 'senha-temporaria-a1')).status, 401);
    const novoLogin = await entrar('admin-a', 'minha-senha-nova-a1');
    assert.equal(novoLogin.status, 200);
    assert.equal(novoLogin.corpo.trocarSenhaNoProximoAcesso, false);

    // Reset pelo superadmin: liga a marca de novo e derruba as sessões abertas.
    await redefinirSenhaAdministrador(banco, 10, 100, {
      novaSenha: 'senha-redefinida-a12', confirmacaoSenha: 'senha-redefinida-a12'
    }, 1);
    assert.equal(administradores.get(100).trocar_senha_em_proximo_acesso, 1);
    assert.equal((await chamar('/api/admin/sessao', { token: novoLogin.corpo.token })).status, 401);
    const loginRedefinido = await entrar('admin-a', 'senha-redefinida-a12');
    assert.equal(loginRedefinido.corpo.trocarSenhaNoProximoAcesso, true);
    pendente(await chamar('/api/admin/sessao', { token: loginRedefinido.corpo.token }), 'sessao após reset');

    // O logout continua funcionando com a troca pendente.
    const saida = await chamar('/api/admin/sessao', { metodo: 'DELETE', token: loginRedefinido.corpo.token });
    assert.equal(saida.status, 200);
    assert.equal(sessoes.some((item) => item.administrador_id === 100), false);
  } finally {
    await fecharServidor(servidor);
  }
});

test('senha temporária do administrador da loja A não afeta o administrador da loja B', async () => {
  const { banco, administradores, consultasDeNegocio } = bancoSenhaTemporaria();
  const lojaA = await servidorDaLoja(banco, 'loja-a');
  const lojaB = await servidorDaLoja(banco, 'loja-b');

  try {
    const loginA = await lojaA.entrar('admin-a', 'senha-temporaria-a1');
    const loginB = await lojaB.entrar('admin-b', 'senha-definitiva-b1');
    assert.equal(loginA.corpo.trocarSenhaNoProximoAcesso, true);
    assert.equal(loginB.corpo.trocarSenhaNoProximoAcesso, false);

    assert.equal((await lojaA.chamar('/api/admin/areas-entrega', { token: loginA.corpo.token })).status, 403);
    assert.equal((await lojaB.chamar('/api/admin/sessao', { token: loginB.corpo.token })).status, 200);
    assert.equal((await lojaB.chamar('/api/admin/areas-entrega', { token: loginB.corpo.token })).status, 200);
    assert.deepEqual(consultasDeNegocio, [20]);

    // O token pendente de A não vale na loja B nem para trocar senha lá.
    const cruzado = await lojaB.chamar('/api/admin/senha', {
      metodo: 'PUT', token: loginA.corpo.token,
      corpo: { senhaAtual: 'senha-temporaria-a1', novaSenha: 'tentativa-cruzada-1', confirmacaoSenha: 'tentativa-cruzada-1' }
    });
    assert.equal(cruzado.status, 403);
    assert.notEqual(cruzado.corpo.codigo, 'senha_temporaria_pendente');

    // Reset com o par loja/administrador trocado não encontra ninguém.
    assert.equal(await redefinirSenhaAdministrador(banco, 20, 100, {
      novaSenha: 'senha-cruzada-12x', confirmacaoSenha: 'senha-cruzada-12x'
    }, 1), null);
    assert.equal(await redefinirSenhaAdministrador(banco, 10, 200, {
      novaSenha: 'senha-cruzada-12x', confirmacaoSenha: 'senha-cruzada-12x'
    }, 1), null);
    assert.equal(administradores.get(200).trocar_senha_em_proximo_acesso, 0);
    assert.equal(verificarSenha('senha-definitiva-b1', administradores.get(200).senha_hash), true);

    // Resetar o de A só mexe em A.
    await redefinirSenhaAdministrador(banco, 10, 100, {
      novaSenha: 'senha-redefinida-a12', confirmacaoSenha: 'senha-redefinida-a12'
    }, 1);
    assert.equal(administradores.get(200).trocar_senha_em_proximo_acesso, 0);
    assert.equal((await lojaB.chamar('/api/admin/sessao', { token: loginB.corpo.token })).status, 200);
  } finally {
    await Promise.all([fecharServidor(lojaA.servidor), fecharServidor(lojaB.servidor)]);
  }
});

test('cardápio de exemplo fica só na loja criada com a caixinha marcada', async () => {
  const categorias = [];
  const produtos = [];
  let proximaLoja = 44;
  let proximoId = 1;
  function responder(sql, parametros = []) {
    if (sql.includes('INSERT INTO estabelecimentos')) return [{ insertId: proximaLoja++ }];
    if (sql.includes('INSERT INTO categorias')) {
      const [idEstabelecimento, nome, ordem] = parametros;
      categorias.push({ id: proximoId, id_estabelecimento: idEstabelecimento, nome, ordem, canal: 'ambos', impressora_id: null, ativo: 1 });
      return [{ insertId: proximoId++ }];
    }
    if (sql.includes('INSERT INTO produtos')) {
      const [idEstabelecimento, categoriaId, nome, descricao, precoCentavos] = parametros;
      produtos.push({
        id: proximoId, id_estabelecimento: idEstabelecimento, categoria_id: categoriaId, nome, descricao,
        preco_centavos: precoCentavos, imagem_url: null, destaque: null, ativo: 1, canal: 'ambos', impressora_id: null
      });
      return [{ insertId: proximoId++ }];
    }
    if (sql.includes('INSERT INTO')) return [{ insertId: proximoId++, affectedRows: 1 }];
    if (sql.includes('FROM estabelecimentos e')) {
      return [[{ ...linhaTenant(Number(parametros[0]), `loja-${parametros[0]}`), criado_em: new Date(), atualizado_em: new Date(), total_administradores: 1 }]];
    }
    // Leitura do cardápio (listarCatalogo), sempre filtrada pela loja pedida.
    if (sql.includes('FROM produtos p')) {
      return [produtos.filter((produto) => produto.id_estabelecimento === parametros[0]).map((produto) => ({
        ...produto,
        categoria: categorias.find((categoria) => categoria.id === produto.categoria_id
          && categoria.id_estabelecimento === produto.id_estabelecimento)?.nome
      }))];
    }
    if (sql.includes('FROM categorias')) return [categorias.filter((categoria) => categoria.id_estabelecimento === parametros[0])];
    if (sql.includes('FROM adicionais') || sql.includes('FROM produto_adicionais')) return [[]];
    throw new Error(`Consulta inesperada no teste: ${sql}`);
  }
  const conexao = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, parametros) { return responder(sql, parametros); }
  };
  const banco = { async getConnection() { return conexao; }, async execute(sql, parametros) { return responder(sql, parametros); } };
  const dados = (slug) => ({
    nomeFantasia: `Loja ${slug}`,
    slug,
    primeiroAdministrador: { nome: 'Admin', usuario: `admin-${slug}`, email: `${slug}@loja.local`, senha: 'senha-inicial-segura' }
  });

  const comExemplo = await criarEstabelecimentoGerencial(banco, { ...dados('com-exemplo'), criarCatalogoExemplo: true }, 1);
  const semExemplo = await criarEstabelecimentoGerencial(banco, dados('sem-exemplo'), 1);

  const cardapioComExemplo = await listarCatalogo(banco, comExemplo.id, { administrativo: true });
  assert.deepEqual(cardapioComExemplo.categorias.map((categoria) => categoria.nome), ['Hambúrgueres', 'Bebidas', 'Sobremesas']);
  assert.deepEqual(
    cardapioComExemplo.produtos.map((produto) => [produto.nome, produto.categoria, produto.ativo]),
    [
      ['X-Burger', 'Hambúrgueres', true],
      ['X-Bacon', 'Hambúrgueres', true],
      ['Refrigerante lata', 'Bebidas', true],
      ['Suco natural', 'Bebidas', true],
      ['Milkshake', 'Sobremesas', true]
    ]
  );
  const cardapioSemExemplo = await listarCatalogo(banco, semExemplo.id, { administrativo: true });
  assert.deepEqual(cardapioSemExemplo.categorias, []);
  assert.deepEqual(cardapioSemExemplo.produtos, []);
  // Todo registro do exemplo pertence à loja que o pediu.
  assert.equal([...categorias, ...produtos].every((item) => item.id_estabelecimento === comExemplo.id), true);
});

test('administrador criado por outro administrador nasce com senha temporária e fica barrado até trocar', async () => {
  const { banco, administradores, consultasDeNegocio } = bancoSenhaTemporaria();
  const lojaB = await servidorDaLoja(banco, 'loja-b');

  try {
    // Quem cria é o admin da loja B, que já usa a própria senha.
    const criador = await lojaB.entrar('admin-b', 'senha-definitiva-b1');
    assert.equal(criador.corpo.trocarSenhaNoProximoAcesso, false);
    const criado = await lojaB.chamar('/api/admin/administradores', {
      metodo: 'POST',
      token: criador.corpo.token,
      corpo: {
        nome: 'Gerente B', usuario: 'gerente-b', email: 'gerente@loja-b.local',
        senha: 'senha-escolhida-pelo-colega', confirmacaoSenha: 'senha-escolhida-pelo-colega',
        // Tentativa de desligar a marca pelo corpo: não é lida.
        trocar_senha_em_proximo_acesso: 0, trocarSenhaNoProximoAcesso: false
      }
    });
    assert.equal(criado.status, 201);
    const novo = administradores.get(criado.corpo.administrador.id);
    assert.equal(novo.id_estabelecimento, 20);
    assert.equal(novo.trocar_senha_em_proximo_acesso, 1);

    // Primeiro login do novo: a marca vem na resposta e o painel fica fechado.
    const login = await lojaB.entrar('gerente-b', 'senha-escolhida-pelo-colega');
    assert.equal(login.status, 200);
    assert.equal(login.corpo.trocarSenhaNoProximoAcesso, true);
    const { token } = login.corpo;
    for (const [caminho, opcoes] of [
      ['/api/admin/sessao', {}],
      ['/api/admin/areas-entrega', {}],
      ['/api/admin/administradores', { metodo: 'POST', corpo: { nome: 'X', usuario: 'x-b', email: 'x@b.local', senha: 'qualquer-senha-12', confirmacaoSenha: 'qualquer-senha-12' } }]
    ]) {
      const resposta = await lojaB.chamar(caminho, { ...opcoes, token });
      assert.equal(resposta.status, 403, caminho);
      assert.equal(resposta.corpo.codigo, 'senha_temporaria_pendente', caminho);
    }
    assert.deepEqual(consultasDeNegocio, []);

    // Troca com o mínimo único de 12: 11 caracteres não passa, 12 passa.
    assert.equal((await lojaB.chamar('/api/admin/senha', {
      metodo: 'PUT', token, corpo: { senhaAtual: 'senha-escolhida-pelo-colega', novaSenha: 'onze-caract', confirmacaoSenha: 'onze-caract' }
    })).status, 400);
    const troca = await lojaB.chamar('/api/admin/senha', {
      metodo: 'PUT', token, corpo: { senhaAtual: 'senha-escolhida-pelo-colega', novaSenha: 'doze-caracts', confirmacaoSenha: 'doze-caracts' }
    });
    assert.equal(troca.status, 200);
    assert.equal(novo.trocar_senha_em_proximo_acesso, 0);
    assert.equal((await lojaB.chamar('/api/admin/areas-entrega', { token })).status, 200);
    assert.deepEqual(consultasDeNegocio, [20]);

    // Nada disso tocou a loja A.
    assert.equal(administradores.get(100).trocar_senha_em_proximo_acesso, 1);
    assert.equal(administradores.get(100).id_estabelecimento, 10);
  } finally {
    await fecharServidor(lojaB.servidor);
  }
});

/* Duas lojas completas: A arquivada há 61 dias (a excluir) e B ativa. */
async function duasLojasParaExclusao() {
  const memoria = criarBancoEmMemoria();
  const agora = Date.now();
  semearLoja(memoria, {
    id: 11, nome: 'Loja A Arquivada', slug: 'loja-a', status: 'arquivado', base: 1100,
    arquivadoEm: new Date(agora - 61 * 24 * 60 * 60 * 1000)
  });
  semearLoja(memoria, { id: 22, nome: 'Loja B', slug: 'loja-b', base: 2200 });
  const pastaUploads = await mkdtemp(join(tmpdir(), 'hamburgueria-exclusao-seguranca-'));
  for (const [id, arquivo] of [[11, 'logo-a.png'], [11, 'produto-a.png'], [22, 'logo-b.png']]) {
    await mkdir(join(pastaUploads, 'estabelecimentos', String(id)), { recursive: true });
    await writeFile(join(pastaUploads, 'estabelecimentos', String(id), arquivo), `conteudo-${arquivo}`);
  }
  const servidor = criarServidor({ banco: memoria.banco, pastaUploads, tenantDesenvolvimento: '', jwtSecret: segredoJwt });
  await aguardarServidor(servidor, 0);
  const url = `http://127.0.0.1:${servidor.address().port}`;
  const login = await fetch(`${url}/api/superadmin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'super', senha: 'senha-global-segura' })
  });
  const { token } = await login.json();
  const excluir = (id, corpo, tokenUsado = token) => fetch(`${url}/api/superadmin/estabelecimentos/${id}/excluir-definitivamente`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenUsado}` },
    body: JSON.stringify(corpo)
  });
  return {
    memoria,
    pastaUploads,
    excluir,
    exportar: (id, tokenUsado = token) => fetch(`${url}/api/superadmin/estabelecimentos/${id}/exportar`, {
      method: 'POST', headers: { Authorization: `Bearer ${tokenUsado}` }
    }),
    async encerrar() {
      await fecharServidor(servidor);
      await rm(pastaUploads, { recursive: true, force: true });
    }
  };
}

test('exclusão definitiva apaga tudo da loja A, guarda a auditoria em texto e não toca em nada da loja B', async () => {
  const ambiente = await duasLojasParaExclusao();
  const { memoria, pastaUploads } = ambiente;
  const lojaBAntes = structuredClone(memoria.linhasDaLoja(22));
  try {
    const resposta = await ambiente.excluir(11, { confirmacaoNome: 'Loja A Arquivada', id_estabelecimento: 22 });
    assert.equal(resposta.status, 200);
    assert.equal(resposta.headers.get('content-type'), 'application/zip');
    assert.match(resposta.headers.get('content-disposition'), /exportacao-loja-a-11-/);
    assert.equal(resposta.headers.get('x-limpeza-uploads'), null);
    const zip = Buffer.from(await resposta.arrayBuffer());
    assert.equal(zip.readUInt32LE(0), 0x04034B50);
    // A exportação entregue é da loja A e só dela (nomes das entradas do .zip
    // ficam sem compressão; o conteúdo é conferido em api.test.js).
    assert.equal(zip.includes(Buffer.from('dados.json')), true);
    assert.equal(zip.includes(Buffer.from('uploads/logo-a.png')), true);
    assert.equal(zip.includes(Buffer.from('uploads/produto-a.png')), true);
    assert.equal(zip.includes(Buffer.from('logo-b.png')), false);

    // Loja A: nenhuma linha em nenhuma tabela, nem a de estabelecimentos.
    for (const [tabela, linhas] of Object.entries(memoria.linhasDaLoja(11))) {
      assert.equal(linhas.length, 0, `${tabela} ainda tem linha da loja A`);
    }
    assert.equal(memoria.tabela('estabelecimentos').some((linha) => linha.id_estabelecimento === 11), false);
    await assert.rejects(stat(join(pastaUploads, 'estabelecimentos', '11')), { code: 'ENOENT' });

    // A auditoria sobrevive com id_estabelecimento NULL e os detalhes em JSON.
    const evento = memoria.tabela('auditoria_superadmin').find((linha) => linha.acao === 'estabelecimento.excluido');
    assert.equal(evento.id_estabelecimento, null);
    assert.equal(evento.superadministrador_id, 1);
    assert.equal(evento.detalhes_json.idEstabelecimento, 11);
    assert.equal(evento.detalhes_json.nomeFantasia, 'Loja A Arquivada');
    assert.equal(evento.detalhes_json.slug, 'loja-a');
    assert.equal(evento.detalhes_json.excluidoPor, 1);
    assert.equal(evento.detalhes_json.linhasRemovidas.pedidos, 1);
    assert.equal(evento.detalhes_json.linhasRemovidas.auditoria_admin, 1);
    assert.equal(evento.detalhes_json.linhasRemovidas.estabelecimentos, 1);
    // A auditoria anterior da loja A também fica, só sem o vínculo.
    assert.equal(memoria.tabela('auditoria_superadmin').find((linha) => linha.id === 1118).id_estabelecimento, null);

    // Loja B: exatamente igual, inclusive sessões e uploads.
    assert.deepEqual(memoria.linhasDaLoja(22), lojaBAntes);
    assert.equal(memoria.tabela('sessoes_admin').filter((linha) => linha.id_estabelecimento === 22).length, 1);
    assert.equal(memoria.tabela('sessoes_garcom').filter((linha) => linha.id_estabelecimento === 22).length, 1);
    await stat(join(pastaUploads, 'estabelecimentos', '22', 'logo-b.png'));

    // Depois de excluída, a loja A não existe mais para nada.
    assert.equal((await ambiente.excluir(11, { confirmacaoNome: 'Loja A Arquivada' })).status, 404);
    assert.equal((await ambiente.exportar(11)).status, 404);
  } finally {
    await ambiente.encerrar();
  }
});

test('exclusão definitiva é recusada se outra loja aponta para dados da loja A', async () => {
  const ambiente = await duasLojasParaExclusao();
  const { memoria } = ambiente;
  try {
    // Dado corrompido: um pedido da loja B aponta para o garçom da loja A.
    // Sem a trava, o SET NULL alteraria esse pedido da loja B.
    memoria.tabela('pedidos').find((linha) => linha.id_estabelecimento === 22).funcionario_id = 1109;
    const antes = memoria.fotografia();
    const resposta = await ambiente.excluir(11, { confirmacaoNome: 'Loja A Arquivada' });
    assert.equal(resposta.status, 409);
    assert.match((await resposta.json()).erro, /pedidos\.funcionario_id → funcionarios/);
    assert.deepEqual(memoria.fotografia(), antes);
    assert.equal(memoria.consultas.some(({ sql }) => /^\s*DELETE FROM (?!sessoes_superadmin)/.test(sql)), false);
    await stat(join(ambiente.pastaUploads, 'estabelecimentos', '11', 'logo-a.png'));
  } finally {
    await ambiente.encerrar();
  }
});

test('só o superadministrador exporta ou exclui definitivamente um estabelecimento', async () => {
  const ambiente = await duasLojasParaExclusao();
  try {
    const tokens = [
      criarJwt({ idUsuario: 1101, perfil: 'administrador', idEstabelecimento: 11, duracaoMs: 60_000, segredo: segredoJwt }),
      criarJwt({ idUsuario: 2201, perfil: 'administrador', idEstabelecimento: 22, duracaoMs: 60_000, segredo: segredoJwt }),
      criarJwt({ idUsuario: 1109, perfil: 'garcom', idEstabelecimento: 11, duracaoMs: 60_000, segredo: segredoJwt })
    ];
    const antes = ambiente.memoria.fotografia();
    for (const token of tokens) {
      assert.equal((await ambiente.excluir(11, { confirmacaoNome: 'Loja A Arquivada' }, token)).status, 403);
      assert.equal((await ambiente.exportar(11, token)).status, 403);
    }
    assert.equal((await ambiente.excluir(11, { confirmacaoNome: 'Loja A Arquivada' }, '')).status, 401);
    assert.deepEqual(ambiente.memoria.fotografia(), antes);
  } finally {
    await ambiente.encerrar();
  }
});

test('ordem de remoção, colunas exportadas e travas cruzadas cobrem todo o esquema do CRIAR_db.sql', () => {
  const { colunas, chaves } = lerEsquema();
  const ordem = TABELAS_DO_ESTABELECIMENTO.map(({ tabela }) => tabela);

  // Toda tabela com FK para estabelecimentos entra na remoção, exceto a
  // auditoria global (SET NULL, sobrevive de propósito).
  const dependentes = new Set(chaves.filter((chave) => chave.pai === 'estabelecimentos'
    && chave.colunas.includes('id_estabelecimento')).map((chave) => chave.filho));
  dependentes.add('trabalhos_impressao');
  dependentes.delete('auditoria_superadmin');
  assert.deepEqual([...dependentes].sort(), [...ordem].sort());
  assert.equal(chaves.find((chave) => chave.filho === 'auditoria_superadmin' && chave.pai === 'estabelecimentos').regra, 'SET NULL');

  // Filho sempre antes do pai na ordem de remoção.
  for (const chave of chaves) {
    if (!ordem.includes(chave.filho) || !ordem.includes(chave.pai) || chave.filho === chave.pai) continue;
    assert.ok(ordem.indexOf(chave.filho) < ordem.indexOf(chave.pai), `${chave.filho} precisa sair antes de ${chave.pai}`);
  }

  // Exportação: toda coluna vai, ou é declarada oculta (senha, hash, token).
  for (const { tabela, colunas: exportadas, colunasOcultas = [] } of TABELAS_DO_ESTABELECIMENTO) {
    if (!exportadas) {
      assert.ok(['sessoes_admin', 'sessoes_garcom'].includes(tabela), `${tabela} fora da exportação`);
      continue;
    }
    assert.deepEqual([...exportadas, ...colunasOcultas].sort(), [...colunas.get(tabela)].sort(), tabela);
  }
  assert.deepEqual(COLUNAS_OCULTAS_ESTABELECIMENTO, ['token_acesso_garcom']);

  // Toda FK de uma coluna só entre tabelas da loja (sem o tenant na chave) é
  // conferida contra referência de outra loja antes de apagar.
  const conferidas = new Set(REFERENCIAS_SEM_TENANT.map(([filho, coluna, pai]) => `${filho}.${coluna}>${pai}`));
  for (const chave of chaves) {
    if (chave.colunas.length !== 1 || !ordem.includes(chave.filho) || !ordem.includes(chave.pai)) continue;
    assert.ok(conferidas.has(`${chave.filho}.${chave.colunas[0]}>${chave.pai}`), `${chave.filho}.${chave.colunas[0]} sem trava cruzada`);
  }
});
