import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { criarServidor } from './app.js';
import { checksumMigration } from './db/migration-utils.js';
import { buscarAdicional, buscarProduto, criarProduto } from './catalog.js';
import {
  acompanharPedido,
  atualizarStatusPedido,
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
import { criarJwt } from './security.js';
import { resolverEstabelecimento } from './tenant.js';
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

test('todo status de assinatura bloqueado e o vencimento no passado recusam o acesso público', async () => {
  const umDiaMs = 24 * 60 * 60 * 1000;
  const ontem = new Date(Date.now() - umDiaMs);
  const amanha = new Date(Date.now() + umDiaMs);
  const tenants = new Map([
    ['liberada', linhaTenant(1, 'liberada')],
    ['liberada-em-dia', linhaTenant(2, 'liberada-em-dia', { vencimento_assinatura_em: amanha })],
    ['inadimplente', linhaTenant(3, 'inadimplente', { status_assinatura: 'inadimplente' })],
    ['suspensa', linhaTenant(4, 'suspensa', { status_assinatura: 'suspensa' })],
    ['bloqueada', linhaTenant(5, 'bloqueada', { status_assinatura: 'bloqueada' })],
    ['cancelada', linhaTenant(6, 'cancelada', { status_assinatura: 'cancelada' })],
    ['maiuscula', linhaTenant(7, 'maiuscula', { status_assinatura: 'BLOQUEADA' })],
    ['vencida', linhaTenant(8, 'vencida', { vencimento_assinatura_em: ontem })],
    ['vencida-e-ativa', linhaTenant(9, 'vencida-e-ativa', {
      status_assinatura: 'ativa',
      vencimento_assinatura_em: ontem
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

  // Assinatura em dia continua atendendo o público normalmente.
  assert.equal((await resolverEstabelecimento(banco, requisicao('liberada'), opcoes)).id, 1);
  assert.equal((await resolverEstabelecimento(banco, requisicao('liberada-em-dia'), opcoes)).id, 2);

  for (const slug of ['inadimplente', 'suspensa', 'bloqueada', 'cancelada', 'maiuscula',
    'vencida', 'vencida-e-ativa']) {
    const erro = await erroDa(resolverEstabelecimento(banco, requisicao(slug), opcoes));
    assert.equal(erro.status, 403, `O tenant "${slug}" deveria ter sido recusado com 403.`);
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
function bancoPainelComPermissoes({ contas, permissoes }) {
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
    if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) return [{ affectedRows: 1 }];
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
  for (const migration of migracoes) {
    const conteudo = await readFile(resolve(pastaMigracoes, migration), 'utf8');
    assert.equal(/\bDROP\s+TABLE\b/i.test(conteudo), false, `DROP TABLE encontrado em ${migration}`);
    assert.equal(/\bTRUNCATE\b/i.test(conteudo), false, `TRUNCATE encontrado em ${migration}`);
    assert.equal(/\bDELETE\s+FROM\b/i.test(conteudo), false, `DELETE FROM encontrado em ${migration}`);
    assert.equal(/SELECT\s+\*/i.test(conteudo), false, `SELECT * encontrado em ${migration}`);
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

  const testesApi = await readFile(resolve(pastaProjeto, 'server/api.test.js'), 'utf8');
  assert.match(testesApi, /process\.env\.RUN_MYSQL_TESTS\s*===\s*'1'/);
  assert.equal(
    /Boolean\(process\.env\.DB_PASSWORD\)/.test(testesApi),
    false,
    'A presença de senha no .env não pode autorizar testes que criam ou removem banco.'
  );
});
