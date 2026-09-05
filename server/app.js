import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';

import {
  alternarStatusAdicional,
  alternarStatusCategoria,
  alternarStatusProduto,
  atualizarAdicional,
  atualizarCategoria,
  atualizarProduto,
  buscarProduto,
  criarAdicional,
  criarCategoria,
  criarProduto,
  excluirAdicional,
  excluirProduto,
  listarCatalogo
} from './catalog.js';
import { removerImagemLocal, salvarImagemDataUrl } from './imageStore.js';
import { registrarErro } from './logger.js';
import {
  acompanharPedido,
  adicionarItemComanda,
  adicionarItemComandaAdmin,
  abrirComanda,
  abrirComandaAdmin,
  alternarStatusFuncionario,
  alternarStatusAdministrador,
  alterarSenhaAdministrador,
  atualizarQuantidadeItemComandaAdmin,
  atualizarStatusPedido,
  buscarConfiguracao,
  buscarConfiguracaoPublica,
  buscarFuncionarioPorToken,
  confirmarPagamento,
  criarAdministrador,
  criarMesa,
  criarPedidoDelivery,
  enviarComanda,
  estornarPagamento,
  excluirPromocao,
  fecharComanda,
  finalizarComandaAdmin,
  listarDadosAdmin,
  listarDadosGarcom,
  listarDadosPublicos,
  revalidarCarrinho,
  removerItemComanda,
  removerItemComandaAdmin,
  salvarConfiguracao,
  salvarFuncionario,
  salvarPromocao,
  solicitarConta
} from './operations.js';
import {
  criarHashToken,
  criarJwt,
  criarSegredoJwtTemporario,
  verificarJwt,
  verificarSenha
} from './security.js';
import {
  atualizarEstabelecimentoGerencial,
  buscarEstabelecimentoGerencial,
  criarEstabelecimentoGerencial,
  listarEstabelecimentosGerenciais,
  opcoesSuperadmin
} from './superadmin.js';
import { resolverEstabelecimento } from './tenant.js';

const LIMITE_CORPO = 2 * 1024 * 1024;
const DURACAO_SESSAO_ADMIN_MS = 12 * 60 * 60 * 1000;
const DURACAO_SESSAO_SUPERADMIN_MS = 8 * 60 * 60 * 1000;
const DURACAO_SESSAO_GARCOM_MS = 8 * 60 * 60 * 1000;
const JANELA_TENTATIVAS_LOGIN_MS = 15 * 60 * 1000;

class ErroHttp extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function criarLimitadorTentativas({ limite = 5, janelaMs = JANELA_TENTATIVAS_LOGIN_MS } = {}) {
  const registros = new Map();

  function obter(chave, agora) {
    const registro = registros.get(chave);
    if (!registro || registro.inicio + janelaMs <= agora) {
      registros.delete(chave);
      return null;
    }
    return registro;
  }

  return {
    permite(chave, agora = Date.now()) {
      return (obter(chave, agora)?.tentativas ?? 0) < limite;
    },
    registrarFalha(chave, agora = Date.now()) {
      const registro = obter(chave, agora);
      registros.set(chave, registro
        ? { ...registro, tentativas: registro.tentativas + 1 }
        : { inicio: agora, tentativas: 1 });
    },
    limpar(chave) {
      registros.delete(chave);
    }
  };
}

function chavesTentativa(requisicao, tipo, identificador) {
  const endereco = requisicao.socket.remoteAddress || 'desconhecido';
  const idEstabelecimento = requisicao.estabelecimento?.id ?? 'sem-estabelecimento';
  return [
    `${tipo}:tenant:${idEstabelecimento}:ip:${endereco}`,
    `${tipo}:tenant:${idEstabelecimento}:identificador:${criarHashToken(String(identificador ?? ''))}`
  ];
}

function validarLimiteLogin(limitador, chaves) {
  if (chaves.some((chave) => !limitador.permite(chave))) {
    throw new ErroHttp(429, 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.');
  }
}

function cabecalhosSeguranca(resposta) {
  const producao = Boolean(resposta.configuracaoSeguranca?.producao);
  resposta.setHeader('X-Content-Type-Options', 'nosniff');
  resposta.setHeader('X-Frame-Options', 'DENY');
  resposta.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  resposta.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  resposta.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  resposta.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (producao) {
    resposta.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    resposta.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; upgrade-insecure-requests"
    );
  }
}

function aplicarCors(requisicao, resposta, origensPermitidas) {
  const origem = requisicao.headers.origin;
  if (!origem) return true;
  if (!origensPermitidas.includes(origem)) return false;
  resposta.setHeader('Access-Control-Allow-Origin', origem);
  resposta.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  resposta.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  resposta.setHeader('Vary', 'Origin');
  return true;
}

function responderJson(resposta, status, dados) {
  cabecalhosSeguranca(resposta);
  resposta.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  resposta.end(JSON.stringify(dados));
}

async function lerJson(requisicao) {
  const tamanhoInformado = Number(requisicao.headers['content-length'] || 0);
  if (tamanhoInformado > LIMITE_CORPO) throw new ErroHttp(413, 'O conteúdo enviado é muito grande.');

  const partes = [];
  let tamanho = 0;
  for await (const parte of requisicao) {
    tamanho += parte.length;
    if (tamanho > LIMITE_CORPO) throw new ErroHttp(413, 'O conteúdo enviado é muito grande.');
    partes.push(parte);
  }

  if (!partes.length) return {};
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    throw new ErroHttp(400, 'O corpo da requisição deve ser um JSON válido.');
  }
}

function tokenBearer(requisicao) {
  const cabecalho = requisicao.headers.authorization || '';
  const correspondencia = cabecalho.match(/^Bearer\s+(.+)$/i);
  return correspondencia?.[1] ?? null;
}

function autenticarJwt(requisicao, jwtSecret, perfilEsperado) {
  const token = tokenBearer(requisicao);
  if (!token) throw new ErroHttp(401, 'Faça login para continuar.');
  const identidade = verificarJwt(token, jwtSecret);
  if (!identidade) throw new ErroHttp(401, 'Sua sessão é inválida ou expirou. Entre novamente.');
  if (identidade.perfil !== perfilEsperado) {
    throw new ErroHttp(403, 'Seu perfil não possui permissão para acessar este recurso.');
  }
  const idEstabelecimento = requisicao.estabelecimento.id;
  if (identidade.idEstabelecimento !== idEstabelecimento) {
    throw new ErroHttp(403, 'Esta sessão pertence a outro estabelecimento.');
  }
  return { token, identidade };
}

async function obterAdministrador(banco, requisicao, jwtSecret) {
  const { token, identidade } = autenticarJwt(requisicao, jwtSecret, 'administrador');
  const idEstabelecimento = requisicao.estabelecimento.id;

  await banco.execute(`
    DELETE FROM sessoes_admin
    WHERE expira_em <= CURRENT_TIMESTAMP(3) AND id_estabelecimento = ?
  `, [idEstabelecimento]);
  const [linhas] = await banco.execute(`
    SELECT a.id, a.nome, a.usuario, a.email, a.id_estabelecimento
    FROM sessoes_admin s
    INNER JOIN administradores a
      ON a.id = s.administrador_id
      AND a.id_estabelecimento = s.id_estabelecimento
    WHERE s.token_hash = ?
      AND s.id_estabelecimento = ?
      AND s.administrador_id = ?
      AND s.expira_em > CURRENT_TIMESTAMP(3)
      AND a.ativo = 1
  `, [criarHashToken(token), idEstabelecimento, identidade.idUsuario]);
  const sessao = linhas[0];
  if (!sessao) throw new ErroHttp(401, 'Sua sessão expirou. Entre novamente.');
  return {
    id: Number(sessao.id),
    nome: sessao.nome,
    usuario: sessao.usuario,
    email: sessao.email,
    idEstabelecimento: Number(sessao.id_estabelecimento),
    perfil: 'Administrador',
    superadministrador: false
  };
}

async function obterSuperadministrador(banco, requisicao, jwtSecret) {
  const token = tokenBearer(requisicao);
  if (!token) throw new ErroHttp(401, 'Faça login para continuar.');
  const identidade = verificarJwt(token, jwtSecret);
  if (!identidade) throw new ErroHttp(401, 'Sua sessão é inválida ou expirou. Entre novamente.');
  if (identidade.perfil !== 'superadministrador' || !identidade.superadministrador
      || identidade.idEstabelecimento !== null) {
    throw new ErroHttp(403, 'Seu perfil não possui permissão para acessar este recurso.');
  }
  await banco.execute('DELETE FROM sessoes_superadmin WHERE expira_em <= CURRENT_TIMESTAMP(3)');
  const [linhas] = await banco.execute(`
    SELECT sa.id, sa.nome, sa.usuario, sa.email
    FROM sessoes_superadmin ss
    INNER JOIN superadministradores sa ON sa.id = ss.superadministrador_id
    WHERE ss.token_hash = ?
      AND ss.superadministrador_id = ?
      AND ss.expira_em > CURRENT_TIMESTAMP(3)
      AND sa.ativo = 1
    LIMIT 1
  `, [criarHashToken(token), identidade.idUsuario]);
  const superadministrador = linhas[0];
  if (!superadministrador) throw new ErroHttp(401, 'Sua sessão expirou. Entre novamente.');
  return {
    id: Number(superadministrador.id),
    nome: superadministrador.nome,
    usuario: superadministrador.usuario,
    email: superadministrador.email,
    perfil: 'Superadministrador',
    idEstabelecimento: null,
    superadministrador: true
  };
}

async function criarSessaoSuperadministrador(banco, jwtSecret, id) {
  const agoraMs = Date.now();
  const expiraEm = new Date(agoraMs + DURACAO_SESSAO_SUPERADMIN_MS);
  const token = criarJwt({
    idUsuario: id,
    perfil: 'superadministrador',
    superadministrador: true,
    duracaoMs: DURACAO_SESSAO_SUPERADMIN_MS,
    segredo: jwtSecret,
    agoraMs
  });
  await banco.execute(`
    INSERT INTO sessoes_superadmin (token_hash, superadministrador_id, expira_em)
    VALUES (?, ?, ?)
  `, [criarHashToken(token), id, expiraEm]);
  return { token, expiraEm: expiraEm.toISOString() };
}

async function obterGarcom(banco, requisicao, jwtSecret) {
  const { token, identidade } = autenticarJwt(requisicao, jwtSecret, 'garcom');
  const idEstabelecimento = requisicao.estabelecimento.id;
  await banco.execute(`
    DELETE FROM sessoes_garcom
    WHERE expira_em <= CURRENT_TIMESTAMP(3) AND id_estabelecimento = ?
  `, [idEstabelecimento]);
  const [linhas] = await banco.execute(`
    SELECT f.id, f.nome, f.cargo, f.id_estabelecimento
    FROM sessoes_garcom s
    INNER JOIN funcionarios f
      ON f.id = s.funcionario_id
      AND f.id_estabelecimento = s.id_estabelecimento
    WHERE s.token_hash = ?
      AND s.id_estabelecimento = ?
      AND s.funcionario_id = ?
      AND s.expira_em > CURRENT_TIMESTAMP(3)
      AND f.ativo = 1
  `, [criarHashToken(token), idEstabelecimento, identidade.idUsuario]);
  const sessao = linhas[0];
  if (!sessao) throw new ErroHttp(401, 'Sua sessão expirou. Leia o QR Code novamente.');
  return {
    id: String(sessao.id),
    nome: sessao.nome,
    cargo: sessao.cargo,
    idEstabelecimento: Number(sessao.id_estabelecimento),
    perfil: 'Garçom',
    superadministrador: false
  };
}

function tratarErroDados(erro) {
  if (erro instanceof ErroHttp || erro.status) throw erro;
  if (erro.code === 'ER_DUP_ENTRY') throw new ErroHttp(409, 'Já existe um cadastro com esses dados.');
  if (['ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2'].includes(erro.code)) {
    throw new ErroHttp(409, 'Este cadastro está vinculado a outro registro e não pode ser alterado.');
  }
  throw erro;
}

async function criarSessao(
  banco,
  jwtSecret,
  idEstabelecimento,
  tabela,
  campoId,
  id,
  perfil,
  duracaoMs
) {
  const agoraMs = Date.now();
  const expiraEm = new Date(agoraMs + duracaoMs);
  const token = criarJwt({
    idUsuario: id,
    perfil,
    idEstabelecimento,
    superadministrador: false,
    duracaoMs,
    segredo: jwtSecret,
    agoraMs
  });
  await banco.execute(`
    INSERT INTO ${tabela} (token_hash, id_estabelecimento, ${campoId}, expira_em)
    VALUES (?, ?, ?, ?)
  `, [criarHashToken(token), idEstabelecimento, id, expiraEm]);
  return { token, expiraEm: expiraEm.toISOString() };
}

async function processarImagemNova(imagem, pastaUploads, idEstabelecimento, prefixo = 'produto') {
  if (!String(imagem ?? '').startsWith('data:')) return null;
  return salvarImagemDataUrl(imagem, pastaUploads, idEstabelecimento, prefixo);
}

async function processarImagemAtualizada(
  imagem,
  imagemAnterior,
  pastaUploads,
  idEstabelecimento,
  prefixo = 'produto'
) {
  if (String(imagem ?? '').startsWith('data:')) {
    return salvarImagemDataUrl(imagem, pastaUploads, idEstabelecimento, prefixo);
  }
  if (imagem === null || imagem === '') return null;
  return imagemAnterior ?? null;
}

async function rotaPublica({ banco, requisicao, resposta, caminho, url, limitadorPedidos }) {
  if (requisicao.method === 'GET' && caminho === '/api/saude') {
    await banco.query('SELECT 1');
    responderJson(resposta, 200, { status: 'ok', banco: 'mysql-conectado' });
    return true;
  }

  const idEstabelecimento = requisicao.estabelecimento.id;

  if (requisicao.method === 'GET' && caminho === '/api/catalogo') {
    resposta.setHeader('Cache-Control', 'no-store');
    responderJson(resposta, 200, await listarCatalogo(banco, idEstabelecimento));
    return true;
  }

  if (requisicao.method === 'GET' && caminho === '/api/publico/inicial') {
    resposta.setHeader('Cache-Control', 'no-store');
    responderJson(resposta, 200, await listarDadosPublicos(banco, idEstabelecimento));
    return true;
  }

  if (requisicao.method === 'GET' && caminho === '/api/publico/configuracao') {
    resposta.setHeader('Cache-Control', 'no-store');
    responderJson(resposta, 200, {
      configuracao: await buscarConfiguracaoPublica(banco, idEstabelecimento)
    });
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/pedidos') {
    const chaveLimite = `pedido:tenant:${idEstabelecimento}:ip:${requisicao.socket.remoteAddress || 'desconhecido'}`;
    if (!limitadorPedidos.permite(chaveLimite)) {
      throw new ErroHttp(429, 'Muitas tentativas de pedido. Aguarde um minuto e tente novamente.');
    }
    limitadorPedidos.registrarFalha(chaveLimite);
    const dados = await lerJson(requisicao);
    try {
      const pedido = await criarPedidoDelivery(banco, idEstabelecimento, dados);
      responderJson(resposta, 201, { pedido });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/carrinho/validar') {
    const dados = await lerJson(requisicao);
    responderJson(resposta, 200, await revalidarCarrinho(banco, idEstabelecimento, dados.itens));
    return true;
  }

  const acompanhamento = caminho.match(/^\/api\/pedidos\/([^/]+)$/);
  if (requisicao.method === 'GET' && acompanhamento) {
    const pedido = await acompanharPedido(
      banco,
      idEstabelecimento,
      acompanhamento[1],
      url.searchParams.get('token')
    );
    if (!pedido) throw new ErroHttp(404, 'Pedido não encontrado ou link de acompanhamento inválido.');
    responderJson(resposta, 200, { pedido });
    return true;
  }

  return false;
}

async function rotaSuperadmin({
  banco,
  requisicao,
  resposta,
  caminho,
  url,
  limitadorSuperadmin,
  jwtSecret
}) {
  if (!caminho.startsWith('/api/superadmin/')) return false;

  if (requisicao.method === 'POST' && caminho === '/api/superadmin/login') {
    const dados = await lerJson(requisicao);
    const identificador = String(dados.usuario ?? '').trim();
    const chaves = chavesTentativa(requisicao, 'superadmin', identificador);
    validarLimiteLogin(limitadorSuperadmin, chaves);
    const [linhas] = await banco.execute(`
      SELECT id, nome, usuario, email, senha_hash
      FROM superadministradores
      WHERE (LOWER(usuario) = LOWER(?) OR LOWER(email) = LOWER(?))
        AND ativo = 1
      LIMIT 1
    `, [identificador, identificador]);
    const superadministrador = linhas[0];
    if (!superadministrador || !verificarSenha(String(dados.senha ?? ''), superadministrador.senha_hash)) {
      chaves.forEach((chave) => limitadorSuperadmin.registrarFalha(chave));
      throw new ErroHttp(401, 'Usuário ou senha incorretos.');
    }
    chaves.forEach((chave) => limitadorSuperadmin.limpar(chave));
    const sessao = await criarSessaoSuperadministrador(banco, jwtSecret, Number(superadministrador.id));
    responderJson(resposta, 200, {
      token: sessao.token,
      expiraEm: sessao.expiraEm,
      superadmin: {
        id: Number(superadministrador.id),
        nome: superadministrador.nome,
        perfil: 'Superadministrador',
        idEstabelecimento: null,
        superadministrador: true
      }
    });
    return true;
  }

  if (requisicao.method === 'GET' && caminho === '/api/superadmin/sessao') {
    responderJson(resposta, 200, {
      superadmin: await obterSuperadministrador(banco, requisicao, jwtSecret)
    });
    return true;
  }

  if (requisicao.method === 'DELETE' && caminho === '/api/superadmin/sessao') {
    const token = tokenBearer(requisicao);
    if (token) {
      await obterSuperadministrador(banco, requisicao, jwtSecret);
      await banco.execute(
        'DELETE FROM sessoes_superadmin WHERE token_hash = ?',
        [criarHashToken(token)]
      );
    }
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }

  const superadministrador = await obterSuperadministrador(banco, requisicao, jwtSecret);
  if (requisicao.method === 'GET' && caminho === '/api/superadmin/estabelecimentos') {
    const estabelecimentos = await listarEstabelecimentosGerenciais(banco, {
      busca: url.searchParams.get('busca'),
      status: url.searchParams.get('status'),
      statusAssinatura: url.searchParams.get('statusAssinatura'),
      plano: url.searchParams.get('plano')
    });
    responderJson(resposta, 200, { estabelecimentos, opcoes: opcoesSuperadmin });
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/superadmin/estabelecimentos') {
    try {
      const estabelecimento = await criarEstabelecimentoGerencial(
        banco,
        await lerJson(requisicao),
        superadministrador.id
      );
      responderJson(resposta, 201, { estabelecimento });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  const estabelecimentoId = caminho.match(/^\/api\/superadmin\/estabelecimentos\/(\d+)$/);
  if (requisicao.method === 'GET' && estabelecimentoId) {
    const estabelecimento = await buscarEstabelecimentoGerencial(banco, estabelecimentoId[1]);
    if (!estabelecimento) throw new ErroHttp(404, 'Estabelecimento não encontrado.');
    responderJson(resposta, 200, { estabelecimento });
    return true;
  }
  if (requisicao.method === 'PUT' && estabelecimentoId) {
    try {
      const estabelecimento = await atualizarEstabelecimentoGerencial(
        banco,
        estabelecimentoId[1],
        await lerJson(requisicao),
        superadministrador.id
      );
      if (!estabelecimento) throw new ErroHttp(404, 'Estabelecimento não encontrado.');
      responderJson(resposta, 200, { estabelecimento });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  return false;
}

async function rotaAdmin({
  banco,
  pastaUploads,
  requisicao,
  resposta,
  caminho,
  limitadorAdmin,
  jwtSecret
}) {
  const idEstabelecimento = requisicao.estabelecimento.id;
  if (requisicao.method === 'POST' && caminho === '/api/admin/login') {
    const dados = await lerJson(requisicao);
    const identificador = String(dados.usuario ?? '').trim();
    const chaves = chavesTentativa(requisicao, 'admin', identificador);
    validarLimiteLogin(limitadorAdmin, chaves);
    const [linhas] = await banco.execute(`
      SELECT id, nome, usuario, email, senha_hash
      FROM administradores
      WHERE id_estabelecimento = ?
        AND (LOWER(usuario) = LOWER(?) OR LOWER(email) = LOWER(?))
        AND ativo = 1
      LIMIT 1
    `, [idEstabelecimento, identificador, identificador]);
    const administrador = linhas[0];
    if (!administrador || !verificarSenha(String(dados.senha ?? ''), administrador.senha_hash)) {
      chaves.forEach((chave) => limitadorAdmin.registrarFalha(chave));
      throw new ErroHttp(401, 'Usuário ou senha incorretos.');
    }
    chaves.forEach((chave) => limitadorAdmin.limpar(chave));
    const sessao = await criarSessao(
      banco,
      jwtSecret,
      idEstabelecimento,
      'sessoes_admin',
      'administrador_id',
      administrador.id,
      'administrador',
      DURACAO_SESSAO_ADMIN_MS
    );
    responderJson(resposta, 200, {
      token: sessao.token,
      expiraEm: sessao.expiraEm,
      admin: {
        id: Number(administrador.id),
        nome: administrador.nome,
        perfil: 'Administrador',
        idEstabelecimento,
        superadministrador: false
      }
    });
    return true;
  }

  if (requisicao.method === 'GET' && caminho === '/api/admin/sessao') {
    responderJson(resposta, 200, {
      admin: await obterAdministrador(banco, requisicao, jwtSecret)
    });
    return true;
  }

  if (requisicao.method === 'DELETE' && caminho === '/api/admin/sessao') {
    const token = tokenBearer(requisicao);
    if (token) {
      autenticarJwt(requisicao, jwtSecret, 'administrador');
      await banco.execute(`
        DELETE FROM sessoes_admin
        WHERE token_hash = ? AND id_estabelecimento = ?
      `, [criarHashToken(token), idEstabelecimento]);
    }
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }

  if (!caminho.startsWith('/api/admin/')) return false;
  const administradorAutenticado = await obterAdministrador(banco, requisicao, jwtSecret);

  if (requisicao.method === 'GET' && caminho === '/api/admin/dados') {
    responderJson(resposta, 200, await listarDadosAdmin(banco, idEstabelecimento));
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/admin/categorias') {
    try {
      responderJson(resposta, 201, {
        categoria: await criarCategoria(banco, idEstabelecimento, await lerJson(requisicao))
      });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }
  const categoriaStatus = caminho.match(/^\/api\/admin\/categorias\/(\d+)\/status$/);
  if (requisicao.method === 'PATCH' && categoriaStatus) {
    const dados = await lerJson(requisicao);
    const categoria = await alternarStatusCategoria(
      banco,
      idEstabelecimento,
      Number(categoriaStatus[1]),
      Boolean(dados.ativo)
    );
    if (!categoria) throw new ErroHttp(404, 'Categoria não encontrada.');
    responderJson(resposta, 200, { categoria });
    return true;
  }
  const categoriaId = caminho.match(/^\/api\/admin\/categorias\/(\d+)$/);
  if (requisicao.method === 'PUT' && categoriaId) {
    try {
      const categoria = await atualizarCategoria(
        banco,
        idEstabelecimento,
        Number(categoriaId[1]),
        await lerJson(requisicao)
      );
      if (!categoria) throw new ErroHttp(404, 'Categoria não encontrada.');
      responderJson(resposta, 200, { categoria });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/admin/administradores') {
    try {
      const dados = await lerJson(requisicao);
      responderJson(resposta, 201, {
        administrador: await criarAdministrador(
          banco,
          idEstabelecimento,
          dados,
          administradorAutenticado.id
        )
      });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }
  const administradorStatus = caminho.match(/^\/api\/admin\/administradores\/(\d+)\/status$/);
  if (requisicao.method === 'PATCH' && administradorStatus) {
    const dados = await lerJson(requisicao);
    const administrador = await alternarStatusAdministrador(
      banco,
      idEstabelecimento,
      administradorStatus[1],
      Boolean(dados.ativo),
      administradorAutenticado.id
    );
    if (!administrador) throw new ErroHttp(404, 'Administrador não encontrado.');
    responderJson(resposta, 200, { administrador });
    return true;
  }
  if (requisicao.method === 'PUT' && caminho === '/api/admin/senha') {
    await alterarSenhaAdministrador(
      banco,
      idEstabelecimento,
      administradorAutenticado.id,
      await lerJson(requisicao),
      tokenBearer(requisicao)
    );
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/admin/mesas') {
    try {
      responderJson(resposta, 201, {
        mesa: await criarMesa(banco, idEstabelecimento, await lerJson(requisicao))
      });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/admin/comandas') {
    const dados = await lerJson(requisicao);
    try {
      responderJson(resposta, 201, {
        comanda: await abrirComandaAdmin(
          banco,
          idEstabelecimento,
          dados.mesaId,
          dados.funcionarioId,
          administradorAutenticado.id
        )
      });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  const itemComandaAdmin = caminho.match(/^\/api\/admin\/comandas\/(\d+)\/itens\/(\d+)$/);
  if (requisicao.method === 'PATCH' && itemComandaAdmin) {
    const dados = await lerJson(requisicao);
    await atualizarQuantidadeItemComandaAdmin(
      banco,
      idEstabelecimento,
      itemComandaAdmin[1],
      itemComandaAdmin[2],
      dados.quantidade
    );
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }
  if (requisicao.method === 'DELETE' && itemComandaAdmin) {
    await removerItemComandaAdmin(banco, idEstabelecimento, itemComandaAdmin[1], itemComandaAdmin[2]);
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }
  const itensComandaAdmin = caminho.match(/^\/api\/admin\/comandas\/(\d+)\/itens$/);
  if (requisicao.method === 'POST' && itensComandaAdmin) {
    await adicionarItemComandaAdmin(
      banco,
      idEstabelecimento,
      itensComandaAdmin[1],
      await lerJson(requisicao)
    );
    responderJson(resposta, 201, { sucesso: true });
    return true;
  }
  const finalizarComanda = caminho.match(/^\/api\/admin\/comandas\/(\d+)\/finalizar$/);
  if (requisicao.method === 'POST' && finalizarComanda) {
    const dados = await lerJson(requisicao);
    await finalizarComandaAdmin(
      banco,
      idEstabelecimento,
      finalizarComanda[1],
      String(dados.pagamento ?? ''),
      administradorAutenticado.id
    );
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/admin/produtos') {
    const dados = await lerJson(requisicao);
    let imagemUrl = null;
    try {
      imagemUrl = await processarImagemNova(dados.imagem, pastaUploads, idEstabelecimento);
      const produto = await criarProduto(banco, idEstabelecimento, dados, imagemUrl);
      responderJson(resposta, 201, { produto });
    } catch (erro) {
      if (imagemUrl) await removerImagemLocal(imagemUrl, pastaUploads, idEstabelecimento);
      tratarErroDados(erro);
    }
    return true;
  }

  const produtoStatus = caminho.match(/^\/api\/admin\/produtos\/(\d+)\/status$/);
  if (requisicao.method === 'PATCH' && produtoStatus) {
    const dados = await lerJson(requisicao);
    const produto = await alternarStatusProduto(
      banco,
      idEstabelecimento,
      Number(produtoStatus[1]),
      Boolean(dados.ativo)
    );
    if (!produto) throw new ErroHttp(404, 'Produto não encontrado.');
    responderJson(resposta, 200, { produto });
    return true;
  }

  const produtoId = caminho.match(/^\/api\/admin\/produtos\/(\d+)$/);
  if (requisicao.method === 'PUT' && produtoId) {
    const id = Number(produtoId[1]);
    const anterior = await buscarProduto(banco, idEstabelecimento, id);
    if (!anterior) throw new ErroHttp(404, 'Produto não encontrado.');
    const dados = await lerJson(requisicao);
    let imagemUrl;
    let novaImagem = null;
    try {
      imagemUrl = await processarImagemAtualizada(
        dados.imagem,
        anterior.imagem,
        pastaUploads,
        idEstabelecimento
      );
      if (imagemUrl !== anterior.imagem) novaImagem = imagemUrl;
      const produto = await atualizarProduto(banco, idEstabelecimento, id, dados, imagemUrl);
      if (anterior.imagem && anterior.imagem !== imagemUrl) {
        await removerImagemLocal(anterior.imagem, pastaUploads, idEstabelecimento);
      }
      responderJson(resposta, 200, { produto });
    } catch (erro) {
      if (novaImagem) await removerImagemLocal(novaImagem, pastaUploads, idEstabelecimento);
      tratarErroDados(erro);
    }
    return true;
  }

  if (requisicao.method === 'DELETE' && produtoId) {
    const id = Number(produtoId[1]);
    const produto = await buscarProduto(banco, idEstabelecimento, id);
    if (!produto) throw new ErroHttp(404, 'Produto não encontrado.');
    await excluirProduto(banco, idEstabelecimento, id);
    await removerImagemLocal(produto.imagem, pastaUploads, idEstabelecimento);
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/admin/adicionais') {
    const dados = await lerJson(requisicao);
    try {
      responderJson(resposta, 201, {
        adicional: await criarAdicional(banco, idEstabelecimento, dados)
      });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  const adicionalStatus = caminho.match(/^\/api\/admin\/adicionais\/(\d+)\/status$/);
  if (requisicao.method === 'PATCH' && adicionalStatus) {
    const dados = await lerJson(requisicao);
    const adicional = await alternarStatusAdicional(
      banco,
      idEstabelecimento,
      Number(adicionalStatus[1]),
      Boolean(dados.ativo)
    );
    if (!adicional) throw new ErroHttp(404, 'Adicional não encontrado.');
    responderJson(resposta, 200, { adicional });
    return true;
  }

  const adicionalId = caminho.match(/^\/api\/admin\/adicionais\/(\d+)$/);
  if (requisicao.method === 'PUT' && adicionalId) {
    const dados = await lerJson(requisicao);
    try {
      const adicional = await atualizarAdicional(
        banco,
        idEstabelecimento,
        Number(adicionalId[1]),
        dados
      );
      if (!adicional) throw new ErroHttp(404, 'Adicional não encontrado.');
      responderJson(resposta, 200, { adicional });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  if (requisicao.method === 'DELETE' && adicionalId) {
    if (!await excluirAdicional(banco, idEstabelecimento, Number(adicionalId[1]))) {
      throw new ErroHttp(404, 'Adicional não encontrado.');
    }
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/admin/promocoes') {
    const promocao = await salvarPromocao(banco, idEstabelecimento, await lerJson(requisicao));
    responderJson(resposta, 201, { promocao });
    return true;
  }
  const promocaoId = caminho.match(/^\/api\/admin\/promocoes\/(\d+)$/);
  if (requisicao.method === 'PUT' && promocaoId) {
    responderJson(resposta, 200, {
      promocao: await salvarPromocao(
        banco,
        idEstabelecimento,
        await lerJson(requisicao),
        promocaoId[1]
      )
    });
    return true;
  }
  if (requisicao.method === 'DELETE' && promocaoId) {
    if (!await excluirPromocao(banco, idEstabelecimento, promocaoId[1])) {
      throw new ErroHttp(404, 'Promoção não encontrada.');
    }
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/admin/funcionarios') {
    responderJson(resposta, 201, {
      funcionario: await salvarFuncionario(banco, idEstabelecimento, await lerJson(requisicao))
    });
    return true;
  }
  const funcionarioStatus = caminho.match(/^\/api\/admin\/funcionarios\/(\d+)\/status$/);
  if (requisicao.method === 'PATCH' && funcionarioStatus) {
    const dados = await lerJson(requisicao);
    const funcionario = await alternarStatusFuncionario(
      banco,
      idEstabelecimento,
      funcionarioStatus[1],
      Boolean(dados.ativo)
    );
    if (!funcionario) throw new ErroHttp(404, 'Funcionário não encontrado.');
    responderJson(resposta, 200, { funcionario });
    return true;
  }
  const funcionarioId = caminho.match(/^\/api\/admin\/funcionarios\/(\d+)$/);
  if (requisicao.method === 'PUT' && funcionarioId) {
    responderJson(resposta, 200, {
      funcionario: await salvarFuncionario(
        banco,
        idEstabelecimento,
        await lerJson(requisicao),
        funcionarioId[1]
      )
    });
    return true;
  }

  const pedidoStatus = caminho.match(/^\/api\/admin\/pedidos\/([^/]+)\/status$/);
  if (requisicao.method === 'PATCH' && pedidoStatus) {
    const dados = await lerJson(requisicao);
    const pedido = await atualizarStatusPedido(
      banco,
      idEstabelecimento,
      pedidoStatus[1],
      dados.status,
      administradorAutenticado.id
    );
    if (!pedido) throw new ErroHttp(404, 'Pedido não encontrado.');
    responderJson(resposta, 200, { pedido });
    return true;
  }

  const confirmarPagamentoPedido = caminho.match(/^\/api\/admin\/pedidos\/([^/]+)\/pagamento\/confirmar$/);
  if (requisicao.method === 'POST' && confirmarPagamentoPedido) {
    const pedido = await confirmarPagamento(
      banco,
      idEstabelecimento,
      confirmarPagamentoPedido[1],
      administradorAutenticado.id
    );
    if (!pedido) throw new ErroHttp(404, 'Pedido não encontrado.');
    responderJson(resposta, 200, { pedido });
    return true;
  }
  const estornarPagamentoPedido = caminho.match(/^\/api\/admin\/pedidos\/([^/]+)\/pagamento\/estornar$/);
  if (requisicao.method === 'POST' && estornarPagamentoPedido) {
    const pedido = await estornarPagamento(
      banco,
      idEstabelecimento,
      estornarPagamentoPedido[1],
      administradorAutenticado.id
    );
    if (!pedido) throw new ErroHttp(404, 'Pedido não encontrado.');
    responderJson(resposta, 200, { pedido });
    return true;
  }

  if (requisicao.method === 'PUT' && caminho === '/api/admin/configuracao') {
    const anterior = await buscarConfiguracao(banco, idEstabelecimento);
    const dados = await lerJson(requisicao);
    let logo;
    let banner;
    let novaLogo = null;
    let novoBanner = null;
    try {
      logo = await processarImagemAtualizada(
        dados.logo,
        anterior.logo,
        pastaUploads,
        idEstabelecimento,
        'logo'
      );
      if (logo !== anterior.logo) novaLogo = logo;
      banner = await processarImagemAtualizada(
        dados.banner,
        anterior.banner,
        pastaUploads,
        idEstabelecimento,
        'banner'
      );
      if (banner !== anterior.banner) novoBanner = banner;
      const configuracao = await salvarConfiguracao(
        banco,
        idEstabelecimento,
        { ...dados, logo, banner },
        administradorAutenticado.id
      );
      await Promise.allSettled([
        anterior.logo && anterior.logo !== logo
          ? removerImagemLocal(anterior.logo, pastaUploads, idEstabelecimento)
          : Promise.resolve(),
        anterior.banner && anterior.banner !== banner
          ? removerImagemLocal(anterior.banner, pastaUploads, idEstabelecimento)
          : Promise.resolve()
      ]);
      responderJson(resposta, 200, { configuracao });
    } catch (erro) {
      if (novaLogo) await removerImagemLocal(novaLogo, pastaUploads, idEstabelecimento);
      if (novoBanner) await removerImagemLocal(novoBanner, pastaUploads, idEstabelecimento);
      tratarErroDados(erro);
    }
    return true;
  }

  return false;
}

async function rotaGarcom({
  banco,
  requisicao,
  resposta,
  caminho,
  limitadorGarcom,
  jwtSecret
}) {
  const idEstabelecimento = requisicao.estabelecimento.id;
  if (requisicao.method === 'POST' && caminho === '/api/garcom/login') {
    const dados = await lerJson(requisicao);
    const tokenAcesso = String(dados.token ?? '');
    const chaves = chavesTentativa(requisicao, 'garcom', tokenAcesso);
    validarLimiteLogin(limitadorGarcom, chaves);
    const funcionario = await buscarFuncionarioPorToken(banco, idEstabelecimento, tokenAcesso);
    if (!funcionario || !verificarSenha(String(dados.pin ?? ''), funcionario.pin_hash)) {
      chaves.forEach((chave) => limitadorGarcom.registrarFalha(chave));
      throw new ErroHttp(401, 'Não foi possível autenticar com os dados informados.');
    }
    chaves.forEach((chave) => limitadorGarcom.limpar(chave));
    const sessao = await criarSessao(
      banco,
      jwtSecret,
      idEstabelecimento,
      'sessoes_garcom',
      'funcionario_id',
      funcionario.id,
      'garcom',
      DURACAO_SESSAO_GARCOM_MS
    );
    responderJson(resposta, 200, {
      token: sessao.token,
      expiraEm: sessao.expiraEm,
      garcom: {
        id: String(funcionario.id),
        nome: funcionario.nome,
        cargo: funcionario.cargo,
        perfil: 'Garçom',
        idEstabelecimento,
        superadministrador: false
      }
    });
    return true;
  }

  if (requisicao.method === 'GET' && caminho === '/api/garcom/sessao') {
    responderJson(resposta, 200, {
      garcom: await obterGarcom(banco, requisicao, jwtSecret)
    });
    return true;
  }

  if (requisicao.method === 'DELETE' && caminho === '/api/garcom/sessao') {
    const token = tokenBearer(requisicao);
    if (token) {
      autenticarJwt(requisicao, jwtSecret, 'garcom');
      await banco.execute(`
        DELETE FROM sessoes_garcom
        WHERE token_hash = ? AND id_estabelecimento = ?
      `, [criarHashToken(token), idEstabelecimento]);
    }
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }

  if (!caminho.startsWith('/api/garcom/')) return false;
  const garcom = await obterGarcom(banco, requisicao, jwtSecret);

  if (requisicao.method === 'GET' && caminho === '/api/garcom/dados') {
    responderJson(resposta, 200, await listarDadosGarcom(banco, idEstabelecimento, garcom.id));
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/garcom/comandas') {
    const dados = await lerJson(requisicao);
    responderJson(resposta, 201, {
      comanda: await abrirComanda(banco, idEstabelecimento, Number(dados.mesaId), garcom.id)
    });
    return true;
  }

  const itemComanda = caminho.match(/^\/api\/garcom\/comandas\/(\d+)\/itens\/(\d+)$/);
  if (requisicao.method === 'DELETE' && itemComanda) {
    await removerItemComanda(banco, idEstabelecimento, itemComanda[1], itemComanda[2], garcom.id);
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }
  const itensComanda = caminho.match(/^\/api\/garcom\/comandas\/(\d+)\/itens$/);
  if (requisicao.method === 'POST' && itensComanda) {
    await adicionarItemComanda(
      banco,
      idEstabelecimento,
      itensComanda[1],
      garcom.id,
      await lerJson(requisicao)
    );
    responderJson(resposta, 201, { sucesso: true });
    return true;
  }
  const enviar = caminho.match(/^\/api\/garcom\/comandas\/(\d+)\/enviar$/);
  if (requisicao.method === 'POST' && enviar) {
    await enviarComanda(banco, idEstabelecimento, enviar[1], garcom.id);
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }
  const conta = caminho.match(/^\/api\/garcom\/comandas\/(\d+)\/conta$/);
  if (requisicao.method === 'POST' && conta) {
    await solicitarConta(banco, idEstabelecimento, conta[1], garcom.id);
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }
  const fechar = caminho.match(/^\/api\/garcom\/comandas\/(\d+)\/fechar$/);
  if (requisicao.method === 'POST' && fechar) {
    const dados = await lerJson(requisicao);
    await fecharComanda(
      banco,
      idEstabelecimento,
      fechar[1],
      garcom.id,
      String(dados.pagamento ?? '')
    );
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }

  return false;
}

async function rotaApi(parametros) {
  const { banco, requisicao, resposta, dominioPrincipal, tenantDesenvolvimento } = parametros;
  if (requisicao.method === 'OPTIONS') {
    cabecalhosSeguranca(resposta);
    resposta.writeHead(204, { Allow: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' });
    resposta.end();
    return true;
  }
  if (parametros.caminho.startsWith('/api/superadmin/')) {
    return rotaSuperadmin(parametros);
  }
  if (!(requisicao.method === 'GET' && parametros.caminho === '/api/saude')) {
    requisicao.estabelecimento = await resolverEstabelecimento(banco, requisicao, {
      dominioPrincipal,
      tenantDesenvolvimento
    });
  }
  return await rotaPublica(parametros)
    || await rotaAdmin(parametros)
    || await rotaGarcom(parametros);
}

const TIPOS_CONTEUDO = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

async function enviarArquivo(resposta, caminhoArquivo, cacheControl) {
  try {
    const informacoes = await stat(caminhoArquivo);
    if (!informacoes.isFile()) return false;
    const conteudo = await readFile(caminhoArquivo);
    cabecalhosSeguranca(resposta);
    resposta.writeHead(200, {
      'Content-Type': TIPOS_CONTEUDO[extname(caminhoArquivo).toLowerCase()] || 'application/octet-stream',
      'Content-Length': conteudo.length,
      'Cache-Control': cacheControl
    });
    resposta.end(conteudo);
    return true;
  } catch (erro) {
    if (erro.code === 'ENOENT') return false;
    throw erro;
  }
}

async function imagemLegadaPertenceAoEstabelecimento(banco, idEstabelecimento, imagemUrl) {
  const [linhas] = await banco.execute(`
    SELECT 1 AS permitido
    FROM configuracoes_estabelecimento ce
    WHERE ce.id_estabelecimento = ?
      AND (ce.logo_url = ? OR ce.banner_url = ?)
    UNION ALL
    SELECT 1 AS permitido
    FROM produtos p
    WHERE p.id_estabelecimento = ? AND p.imagem_url = ?
    UNION ALL
    SELECT 1 AS permitido
    FROM promocoes pr
    WHERE pr.id_estabelecimento = ? AND pr.imagem_url = ?
    UNION ALL
    SELECT 1 AS permitido
    FROM configuracoes c
    WHERE c.id_estabelecimento = ? AND c.logo_url = ?
    LIMIT 1
  `, [
    idEstabelecimento,
    imagemUrl,
    imagemUrl,
    idEstabelecimento,
    imagemUrl,
    idEstabelecimento,
    imagemUrl,
    idEstabelecimento,
    imagemUrl
  ]);
  return Boolean(linhas[0]);
}

async function servirUploadIsolado({
  banco,
  requisicao,
  resposta,
  caminho,
  pastaUploads,
  dominioPrincipal,
  tenantDesenvolvimento
}) {
  const estabelecimento = await resolverEstabelecimento(banco, requisicao, {
    dominioPrincipal,
    tenantDesenvolvimento
  });
  requisicao.estabelecimento = estabelecimento;

  const isolado = caminho.match(
    /^\/uploads\/estabelecimentos\/([1-9]\d*)\/((?:produto|logo|banner)-[a-f0-9-]+\.(?:jpg|png|webp))$/
  );
  if (isolado) {
    if (Number(isolado[1]) !== estabelecimento.id) {
      throw new ErroHttp(404, 'Arquivo não encontrado.');
    }
    return enviarArquivo(
      resposta,
      resolve(pastaUploads, 'estabelecimentos', isolado[1], isolado[2]),
      'public, max-age=31536000, immutable'
    );
  }

  const legado = caminho.match(
    /^\/uploads\/((?:produto|logo|banner)-[a-f0-9-]+\.(?:jpg|png|webp))$/
  );
  if (!legado || !await imagemLegadaPertenceAoEstabelecimento(
    banco,
    estabelecimento.id,
    caminho
  )) {
    throw new ErroHttp(404, 'Arquivo não encontrado.');
  }
  return enviarArquivo(
    resposta,
    resolve(pastaUploads, legado[1]),
    'public, max-age=31536000, immutable'
  );
}

function escaparHtml(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function personalizarIndexHtml(modelo, configuracao, publicSiteUrl = '') {
  const nome = configuracao.nomeLoja?.trim();
  const titulo = nome ? `${nome} | Cardápio e pedidos` : 'Cardápio e pedidos online';
  const descricao = nome
    ? `Consulte o cardápio e faça seu pedido online na ${nome}.`
    : 'Cardápio e pedidos online para entrega ou retirada.';
  const origem = String(publicSiteUrl ?? '').replace(/\/$/, '');
  const imagem = origem && configuracao.logo?.startsWith('/') ? `${origem}${configuracao.logo}` : '';
  return modelo
    .replace(/<title>.*?<\/title>/, `<title>${escaparHtml(titulo)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(" \/>)/, `$1${escaparHtml(descricao)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(" \/>)/, `$1${escaparHtml(titulo)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(" \/>)/, `$1${escaparHtml(descricao)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(" \/>)/, `$1${escaparHtml(origem)}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(" \/>)/, `$1${escaparHtml(imagem)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(" \/>)/, `$1${escaparHtml(titulo)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(" \/>)/, `$1${escaparHtml(descricao)}$2`);
}

async function enviarIndexDinamico(
  requisicao,
  resposta,
  caminhoArquivo,
  banco,
  publicSiteUrl,
  dominioPrincipal,
  tenantDesenvolvimento
) {
  try {
    const estabelecimento = requisicao.estabelecimento || await resolverEstabelecimento(banco, requisicao, {
      dominioPrincipal,
      tenantDesenvolvimento
    });
    requisicao.estabelecimento = estabelecimento;
    const [modelo, configuracao] = await Promise.all([
      readFile(caminhoArquivo, 'utf8'),
      buscarConfiguracao(banco, estabelecimento.id)
    ]);
    const conteudo = personalizarIndexHtml(modelo, configuracao, publicSiteUrl);
    const corpo = Buffer.from(conteudo);
    cabecalhosSeguranca(resposta);
    resposta.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': corpo.length,
      'Cache-Control': 'no-cache'
    });
    resposta.end(corpo);
    return true;
  } catch (erro) {
    if (erro.code === 'ENOENT') return false;
    throw erro;
  }
}

async function servirFrontend({
  requisicao,
  resposta,
  caminho,
  pastaUploads,
  pastaDist,
  banco,
  publicSiteUrl,
  dominioPrincipal,
  tenantDesenvolvimento
}) {
  if (!['GET', 'HEAD'].includes(requisicao.method)) return false;
  if (caminho.startsWith('/uploads/')) {
    return servirUploadIsolado({
      banco,
      requisicao,
      resposta,
      caminho,
      pastaUploads,
      dominioPrincipal,
      tenantDesenvolvimento
    });
  }
  if (!pastaDist) return false;
  if (caminho === '/superadmin' || caminho.startsWith('/superadmin/')) {
    return enviarArquivo(resposta, resolve(pastaDist, 'index.html'), 'no-cache');
  }
  const caminhoRelativo = caminho === '/' ? 'index.html' : caminho.replace(/^\//, '');
  const arquivo = resolve(pastaDist, caminhoRelativo);
  const relativoAoDist = relative(resolve(pastaDist), arquivo);
  const estaDentroDoDist = relativoAoDist && !relativoAoDist.startsWith('..') && !isAbsolute(relativoAoDist);
  if (estaDentroDoDist && caminhoRelativo === 'index.html') {
    return enviarIndexDinamico(
      requisicao,
      resposta,
      arquivo,
      banco,
      publicSiteUrl,
      dominioPrincipal,
      tenantDesenvolvimento
    );
  }
  if (estaDentroDoDist && await enviarArquivo(resposta, arquivo, 'public, max-age=3600')) return true;
  return enviarIndexDinamico(
    requisicao,
    resposta,
    resolve(pastaDist, 'index.html'),
    banco,
    publicSiteUrl,
    dominioPrincipal,
    tenantDesenvolvimento
  );
}

export function criarServidor({
  banco,
  pastaUploads,
  pastaDist = null,
  limitePedidosPorMinuto = 30,
  producao = false,
  corsOrigins = [],
  publicSiteUrl = '',
  dominioPrincipal = '',
  tenantDesenvolvimento = 'estabelecimento-padrao',
  jwtSecret = criarSegredoJwtTemporario()
}) {
  const limitadorAdmin = criarLimitadorTentativas({ limite: 10 });
  const limitadorSuperadmin = criarLimitadorTentativas({ limite: 8 });
  const limitadorGarcom = criarLimitadorTentativas({ limite: 5 });
  const limitadorPedidos = criarLimitadorTentativas({ limite: limitePedidosPorMinuto, janelaMs: 60 * 1000 });
  const origensPermitidas = [...new Set([
    ...corsOrigins,
    ...(!producao ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : [])
  ])];
  return createServer(async (requisicao, resposta) => {
    try {
      resposta.configuracaoSeguranca = { producao };
      if (!aplicarCors(requisicao, resposta, origensPermitidas)) {
        throw new ErroHttp(403, 'Origem não autorizada.');
      }
      const url = new URL(requisicao.url, 'http://localhost');
      let caminho;
      try {
        caminho = decodeURIComponent(url.pathname);
      } catch {
        throw new ErroHttp(400, 'A URL informada é inválida.');
      }
      if (caminho.startsWith('/api/')) {
        const atendida = await rotaApi({
          banco,
          pastaUploads,
          requisicao,
          resposta,
          caminho,
          url,
          limitadorAdmin,
          limitadorSuperadmin,
          limitadorGarcom,
          limitadorPedidos,
          dominioPrincipal,
          tenantDesenvolvimento,
          jwtSecret
        });
        if (!atendida) responderJson(resposta, 404, { erro: 'Rota da API não encontrada.' });
        return;
      }
      if (await servirFrontend({
        requisicao,
        resposta,
        caminho,
        pastaUploads,
        pastaDist,
        banco,
        publicSiteUrl,
        dominioPrincipal,
        tenantDesenvolvimento
      })) return;
      responderJson(resposta, 404, { erro: 'Página não encontrada.' });
    } catch (erro) {
      const erroDuplicado = erro.code === 'ER_DUP_ENTRY';
      const erroRelacionamento = ['ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2'].includes(erro.code);
      const status = Number(erro.status) || (erroDuplicado || erroRelacionamento ? 409 : 500);
      if (status >= 500) registrarErro(erro, {
        metodo: requisicao.method,
        caminho: requisicao.url?.split('?')[0],
        status
      });
      const mensagem = erroDuplicado
        ? 'Já existe um cadastro com esses dados.'
        : erroRelacionamento
          ? 'Este cadastro está vinculado a outro registro.'
          : erro.message;
      responderJson(resposta, status, { erro: status >= 500 ? 'Erro interno do servidor.' : mensagem });
    }
  });
}
