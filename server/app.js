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
import { precoParaCentavos } from './catalog.js';
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
  alterarStatusAreaEntrega,
  arquivarAdministrador,
  atualizarAreaEntrega,
  atualizarImpressora,
  atualizarObservacaoComanda,
  atualizarObservacaoComandaAdmin,
  atualizarQuantidadeItemComandaAdmin,
  atualizarStatusImpressora,
  excluirImpressora,
  cancelarComandaAdmin,
  atualizarStatusPedido,
  buscarConfiguracao,
  buscarConfiguracaoPublica,
  buscarFuncionarioPorSenha,
  buscarIndicadoresDashboard,
  autenticarDispositivoImpressao,
  buscarPromocao,
  confirmarPagamento,
  criarAdministrador,
  confirmarTrabalhoImpressao,
  criarAreaEntrega,
  criarMesa,
  criarDispositivoImpressao,
  criarImpressora,
  criarPedidoDelivery,
  desarquivarAdministrador,
  enviarComanda,
  enviarComandaAdmin,
  estornarPagamento,
  falharTrabalhoImpressao,
  excluirAdministrador,
  excluirAreaEntrega,
  excluirFuncionario,
  excluirPromocao,
  finalizarComandaAdmin,
  listarAdministradores,
  listarAreasEntrega,
  listarAreasEntregaPublicas,
  listarDispositivosImpressao,
  listarImpressoras,
  listarTrabalhosImpressao,
  listarDadosAdmin,
  listarDadosGarcom,
  listarDadosPublicos,
  registrarLoginAdmin,
  revalidarCarrinho,
  limparItensNaoLancados,
  limparItensNaoLancadosAdmin,
  removerItemComanda,
  removerItemComandaAdmin,
  rotacionarTokenAcessoGarcom,
  revogarDispositivoImpressao,
  salvarConfiguracao,
  salvarFuncionario,
  salvarPermissoesAdministrador,
  salvarPromocao,
  tokenAcessoGarcomValido
} from './operations.js';
import {
  exigirAlgumaPermissao,
  exigirPermissao,
  limitarConfiguracaoPorPermissao,
  listarPermissoesAdministrador,
  permissaoDaRotaAdmin,
  PERMISSOES_CONFIGURACAO
} from './permissoes.js';
import {
  criarHashToken,
  criarJwt,
  criarSegredoJwtTemporario,
  verificarJwt,
  verificarSenha
} from './security.js';
import {
  alterarSenhaSuperadministrador,
  alternarStatusSuperadministrador,
  arquivarEstabelecimento,
  atualizarEstabelecimentoGerencial,
  buscarEstabelecimentoGerencial,
  criarEstabelecimentoGerencial,
  criarSuperadministrador,
  desarquivarEstabelecimento,
  listarAuditoriaSuperadmin,
  listarEstabelecimentosGerenciais,
  listarSuperadministradores,
  opcoesSuperadmin,
  reativarEstabelecimento,
  redefinirSenhaAdministrador,
  suspenderEstabelecimento
} from './superadmin.js';
import { CODIGO_ESTABELECIMENTO_INDISPONIVEL, resolverEstabelecimento } from './tenant.js';

const LIMITE_CORPO = 2 * 1024 * 1024;
const DURACAO_SESSAO_ADMIN_MS = 12 * 60 * 60 * 1000;
const DURACAO_SESSAO_SUPERADMIN_MS = 8 * 60 * 60 * 1000;
const DURACAO_SESSAO_GARCOM_MS = 8 * 60 * 60 * 1000;
const JANELA_TENTATIVAS_LOGIN_MS = 15 * 60 * 1000;

class ErroHttp extends Error {
  constructor(status, message, codigo = null) {
    super(message);
    this.status = status;
    if (codigo) this.codigo = codigo;
  }
}

/* Senha escolhida por outra pessoa (primeiro administrador ou redefinição pelo
   superadmin): até o administrador definir a própria, o painel só atende a
   troca de senha e o logout. */
const CODIGO_SENHA_TEMPORARIA_PENDENTE = 'senha_temporaria_pendente';

/* Códigos de erro que o navegador trata de forma própria e por isso saem no
   JSON junto de { erro }. Qualquer outro `codigo` interno fica no servidor. */
const CODIGOS_ERRO_PUBLICOS = new Set([
  CODIGO_ESTABELECIMENTO_INDISPONIVEL,
  CODIGO_SENHA_TEMPORARIA_PENDENTE
]);

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

function hostnameDaOrigem(origem) {
  try {
    return new URL(origem).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function origemDoDominioPrincipal(host, dominioPrincipal) {
  const base = String(dominioPrincipal ?? '').trim().toLowerCase();
  if (!base || !host) return false;
  return host === base || host.endsWith(`.${base}`);
}

async function origemComDominioPersonalizado(banco, host) {
  if (!host) return false;
  const [linhas] = await banco.execute(`
    SELECT id_estabelecimento FROM estabelecimentos
    WHERE LOWER(dominio_personalizado) = ?
    LIMIT 1
  `, [host]);
  return Boolean(linhas[0]);
}

/*
  Além da lista fixa em CORS_ORIGINS, qualquer subdomínio do DOMINIO_PRINCIPAL e
  qualquer dominio_personalizado já cadastrado são aceitos automaticamente. Sem
  isso, todo estabelecimento novo exigiria editar variável de ambiente e reiniciar
  o processo só para login e pedidos pararem de cair em "Origem não autorizada" —
  o navegador manda Origin mesmo em requisição de mesma origem quando o método
  não é GET/HEAD, então esse bloqueio pega justamente login, carrinho e pedido.
*/
async function aplicarCors(requisicao, resposta, { origensPermitidas, dominioPrincipal, banco }) {
  const origem = requisicao.headers.origin;
  if (!origem) return true;
  const host = hostnameDaOrigem(origem);
  const permitida = origensPermitidas.includes(origem)
    || origemDoDominioPrincipal(host, dominioPrincipal)
    || await origemComDominioPersonalizado(banco, host);
  if (!permitida) return false;
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

/*
  Ponto único de validação da sessão do administrador. Com senha temporária
  pendente, a sessão existe, mas só serve para trocar a senha: quem chama
  precisa dizer explicitamente que aceita esse caso (permitirSenhaTemporaria).
*/
async function obterAdministrador(banco, requisicao, jwtSecret, { permitirSenhaTemporaria = false } = {}) {
  const { token, identidade } = autenticarJwt(requisicao, jwtSecret, 'administrador');
  const idEstabelecimento = requisicao.estabelecimento.id;

  await banco.execute(`
    DELETE FROM sessoes_admin
    WHERE expira_em <= CURRENT_TIMESTAMP(3) AND id_estabelecimento = ?
  `, [idEstabelecimento]);
  const [linhas] = await banco.execute(`
    SELECT a.id, a.nome, a.usuario, a.email, a.id_estabelecimento,
           a.trocar_senha_em_proximo_acesso
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
  // Lida do banco a cada requisição: a troca de senha libera o painel na hora.
  if (Number(sessao.trocar_senha_em_proximo_acesso) === 1 && !permitirSenhaTemporaria) {
    throw new ErroHttp(
      403,
      'Defina uma nova senha para continuar usando o painel.',
      CODIGO_SENHA_TEMPORARIA_PENDENTE
    );
  }
  // Autorização: as permissões são lidas a cada requisição, depois da sessão
  // validada, então uma alteração vale na hora.
  const permissoes = await listarPermissoesAdministrador(banco, idEstabelecimento, Number(sessao.id));
  return {
    id: Number(sessao.id),
    nome: sessao.nome,
    usuario: sessao.usuario,
    email: sessao.email,
    idEstabelecimento: Number(sessao.id_estabelecimento),
    perfil: 'Administrador',
    superadministrador: false,
    permissoes
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
    responderJson(resposta, 200, await listarCatalogo(banco, idEstabelecimento, { canal: 'online' }));
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

  if (requisicao.method === 'GET' && caminho === '/api/publico/areas-entrega') {
    resposta.setHeader('Cache-Control', 'no-store');
    responderJson(resposta, 200, await listarAreasEntregaPublicas(banco, idEstabelecimento));
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

  if (requisicao.method === 'PUT' && caminho === '/api/superadmin/senha') {
    try {
      await alterarSenhaSuperadministrador(
        banco,
        superadministrador.id,
        await lerJson(requisicao)
      );
      responderJson(resposta, 200, { sucesso: true });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  if (requisicao.method === 'GET' && caminho === '/api/superadmin/auditoria') {
    try {
      responderJson(resposta, 200, await listarAuditoriaSuperadmin(banco, {
        estabelecimento: url.searchParams.get('estabelecimento'),
        de: url.searchParams.get('de'),
        ate: url.searchParams.get('ate'),
        pagina: url.searchParams.get('pagina'),
        limite: url.searchParams.get('limite')
      }));
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  if (requisicao.method === 'GET' && caminho === '/api/superadmin/superadministradores') {
    responderJson(resposta, 200, {
      superadministradores: await listarSuperadministradores(banco)
    });
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/superadmin/superadministradores') {
    try {
      responderJson(resposta, 201, {
        superadministrador: await criarSuperadministrador(
          banco,
          await lerJson(requisicao),
          superadministrador.id
        )
      });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  const superadministradorStatus = caminho
    .match(/^\/api\/superadmin\/superadministradores\/(\d+)\/status$/);
  if (requisicao.method === 'PATCH' && superadministradorStatus) {
    try {
      const dados = await lerJson(requisicao);
      const alvo = await alternarStatusSuperadministrador(
        banco,
        superadministradorStatus[1],
        Boolean(dados.ativo),
        superadministrador.id
      );
      if (!alvo) throw new ErroHttp(404, 'Superadministrador não encontrado.');
      responderJson(resposta, 200, { superadministrador: alvo });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  if (requisicao.method === 'GET' && caminho === '/api/superadmin/estabelecimentos') {
    const estabelecimentos = await listarEstabelecimentosGerenciais(banco, {
      busca: url.searchParams.get('busca'),
      status: url.searchParams.get('status'),
      statusAssinatura: url.searchParams.get('statusAssinatura'),
      plano: url.searchParams.get('plano'),
      incluirArquivados: url.searchParams.get('incluirArquivados')
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

  /* Ciclo de vida: cada ação tem a própria rota e lê do corpo só o campo que
     usa (motivo ou confirmacaoSlug). O id vem da URL e o estado atual é
     conferido no banco, com a linha travada, antes de qualquer escrita. */
  const cicloDeVida = caminho
    .match(/^\/api\/superadmin\/estabelecimentos\/(\d+)\/(suspender|reativar|arquivar|desarquivar)$/);
  if (requisicao.method === 'POST' && cicloDeVida) {
    try {
      const [, idEstabelecimento, acao] = cicloDeVida;
      const dados = await lerJson(requisicao);
      let estabelecimento;
      if (acao === 'suspender') {
        estabelecimento = await suspenderEstabelecimento(
          banco,
          idEstabelecimento,
          { motivo: dados?.motivo },
          superadministrador.id
        );
      } else if (acao === 'arquivar') {
        estabelecimento = await arquivarEstabelecimento(
          banco,
          idEstabelecimento,
          { confirmacaoSlug: dados?.confirmacaoSlug },
          superadministrador.id
        );
      } else if (acao === 'reativar') {
        estabelecimento = await reativarEstabelecimento(banco, idEstabelecimento, superadministrador.id);
      } else {
        estabelecimento = await desarquivarEstabelecimento(banco, idEstabelecimento, superadministrador.id);
      }
      if (!estabelecimento) throw new ErroHttp(404, 'Estabelecimento não encontrado.');
      responderJson(resposta, 200, { estabelecimento });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  const administradoresDoEstabelecimento = caminho
    .match(/^\/api\/superadmin\/estabelecimentos\/(\d+)\/administradores$/);
  if (requisicao.method === 'GET' && administradoresDoEstabelecimento) {
    const estabelecimento = await buscarEstabelecimentoGerencial(
      banco,
      administradoresDoEstabelecimento[1]
    );
    if (!estabelecimento) throw new ErroHttp(404, 'Estabelecimento não encontrado.');
    responderJson(resposta, 200, {
      administradores: await listarAdministradores(banco, estabelecimento.id)
    });
    return true;
  }

  const senhaAdministrador = caminho
    .match(/^\/api\/superadmin\/estabelecimentos\/(\d+)\/administradores\/(\d+)\/senha$/);
  if (requisicao.method === 'PUT' && senhaAdministrador) {
    try {
      const administrador = await redefinirSenhaAdministrador(
        banco,
        senhaAdministrador[1],
        senhaAdministrador[2],
        await lerJson(requisicao),
        superadministrador.id
      );
      if (!administrador) {
        throw new ErroHttp(404, 'Administrador não encontrado neste estabelecimento.');
      }
      responderJson(resposta, 200, { administrador });
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
  url,
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
      SELECT id, nome, usuario, email, senha_hash, trocar_senha_em_proximo_acesso
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
    // Histórico de acessos da tela administrativa: um registro por login válido.
    await registrarLoginAdmin(banco, idEstabelecimento, administrador.id, administrador.usuario);
    responderJson(resposta, 200, {
      token: sessao.token,
      expiraEm: sessao.expiraEm,
      // Senha temporária: o token vale, mas só para a troca de senha e o logout.
      trocarSenhaNoProximoAcesso: Number(administrador.trocar_senha_em_proximo_acesso) === 1,
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
  // Com senha temporária pendente, a troca de senha é a única rota atendida
  // (o logout acima nem passa por aqui); todas as outras recebem 403.
  const administradorAutenticado = await obterAdministrador(banco, requisicao, jwtSecret, {
    permitirSenhaTemporaria: requisicao.method === 'PUT' && caminho === '/api/admin/senha'
  });
  // Portão único de autorização: cada rota declara sua permissão em
  // server/permissoes.js, e rota não declarada não é atendida.
  const permissaoExigida = permissaoDaRotaAdmin(requisicao.method, caminho);
  if (permissaoExigida === undefined) return false;
  exigirPermissao(administradorAutenticado, permissaoExigida);

  if (requisicao.method === 'GET' && caminho === '/api/admin/dados') {
    responderJson(resposta, 200, await listarDadosAdmin(
      banco,
      idEstabelecimento,
      administradorAutenticado.permissoes
    ));
    return true;
  }

  // O estabelecimento vem só da sessão validada acima; da query string sai
  // apenas o período, validado contra a lista fixa.
  if (requisicao.method === 'GET' && caminho === '/api/admin/dashboard/indicadores') {
    responderJson(resposta, 200, await buscarIndicadoresDashboard(
      banco,
      idEstabelecimento,
      url.searchParams.get('periodo')
    ));
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
  const permissoesAdministrador = caminho.match(/^\/api\/admin\/administradores\/(\d+)\/permissoes$/);
  if (requisicao.method === 'PUT' && permissoesAdministrador) {
    // Do corpo só a lista `permissoes` é lida; qualquer outro campo é ignorado.
    const dados = await lerJson(requisicao);
    const administrador = await salvarPermissoesAdministrador(
      banco,
      idEstabelecimento,
      permissoesAdministrador[1],
      { permissoes: dados?.permissoes },
      administradorAutenticado
    );
    if (!administrador) throw new ErroHttp(404, 'Administrador não encontrado.');
    responderJson(resposta, 200, { administrador });
    return true;
  }
  const arquivamentoAdministrador = caminho.match(/^\/api\/admin\/administradores\/(\d+)\/arquivar$/);
  if (requisicao.method === 'POST' && arquivamentoAdministrador) {
    const administrador = await arquivarAdministrador(
      banco,
      idEstabelecimento,
      arquivamentoAdministrador[1],
      administradorAutenticado.id
    );
    if (!administrador) throw new ErroHttp(404, 'Administrador não encontrado.');
    responderJson(resposta, 200, { administrador });
    return true;
  }
  const desarquivamentoAdministrador = caminho.match(/^\/api\/admin\/administradores\/(\d+)\/desarquivar$/);
  if (requisicao.method === 'POST' && desarquivamentoAdministrador) {
    const administrador = await desarquivarAdministrador(
      banco,
      idEstabelecimento,
      desarquivamentoAdministrador[1],
      administradorAutenticado.id
    );
    if (!administrador) throw new ErroHttp(404, 'Administrador arquivado não encontrado.');
    responderJson(resposta, 200, { administrador });
    return true;
  }
  const exclusaoAdministrador = caminho.match(/^\/api\/admin\/administradores\/(\d+)$/);
  if (requisicao.method === 'DELETE' && exclusaoAdministrador) {
    const administrador = await excluirAdministrador(
      banco,
      idEstabelecimento,
      exclusaoAdministrador[1],
      administradorAutenticado.id
    );
    if (!administrador) throw new ErroHttp(404, 'Administrador não encontrado.');
    responderJson(resposta, 200, { sucesso: true });
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
          dados.funcionarioId ?? null,
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
  const observacaoComandaAdmin = caminho.match(/^\/api\/admin\/comandas\/(\d+)\/observacao$/);
  if (requisicao.method === 'PUT' && observacaoComandaAdmin) {
    const dados = await lerJson(requisicao);
    try {
      const observacao = await atualizarObservacaoComandaAdmin(
        banco,
        idEstabelecimento,
        observacaoComandaAdmin[1],
        administradorAutenticado.id,
        dados.observacao
      );
      responderJson(resposta, 200, { sucesso: true, observacao });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }
  const lancarComandaAdmin = caminho.match(/^\/api\/admin\/comandas\/(\d+)\/lancar$/);
  if (requisicao.method === 'POST' && lancarComandaAdmin) {
    await enviarComandaAdmin(
      banco,
      idEstabelecimento,
      lancarComandaAdmin[1],
      administradorAutenticado.id
    );
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }
  const pendentesComandaAdmin = caminho.match(/^\/api\/admin\/comandas\/(\d+)\/itens-pendentes$/);
  if (requisicao.method === 'DELETE' && pendentesComandaAdmin) {
    const removidos = await limparItensNaoLancadosAdmin(
      banco,
      idEstabelecimento,
      pendentesComandaAdmin[1],
      administradorAutenticado.id
    );
    responderJson(resposta, 200, { sucesso: true, removidos });
    return true;
  }
  const cancelarComanda = caminho.match(/^\/api\/admin\/comandas\/(\d+)\/cancelar$/);
  if (requisicao.method === 'POST' && cancelarComanda) {
    await cancelarComandaAdmin(
      banco,
      idEstabelecimento,
      cancelarComanda[1],
      administradorAutenticado.id
    );
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }
  const finalizarComanda = caminho.match(/^\/api\/admin\/comandas\/(\d+)\/finalizar$/);
  if (requisicao.method === 'POST' && finalizarComanda) {
    const dados = await lerJson(requisicao);
    // O valor recebido chega como texto do caixa; o servidor converte,
    // valida e é quem calcula o troco.
    const recebidoCentavos = dados.valorRecebido === undefined || dados.valorRecebido === null || dados.valorRecebido === ''
      ? null
      : precoParaCentavos(dados.valorRecebido);
    if (recebidoCentavos !== null && !Number.isSafeInteger(recebidoCentavos)) {
      responderJson(resposta, 400, { erro: 'Informe um valor recebido válido.' });
      return true;
    }
    const pagamento = await finalizarComandaAdmin(
      banco,
      idEstabelecimento,
      finalizarComanda[1],
      { forma: String(dados.pagamento ?? ''), valorRecebidoCentavos: recebidoCentavos },
      administradorAutenticado.id
    );
    responderJson(resposta, 200, { sucesso: true, pagamento });
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
    const dados = await lerJson(requisicao);
    let imagemUrl = null;
    try {
      imagemUrl = await processarImagemNova(dados.imagem, pastaUploads, idEstabelecimento, 'promocao');
      const promocao = await salvarPromocao(banco, idEstabelecimento, dados, null, imagemUrl);
      responderJson(resposta, 201, { promocao });
    } catch (erro) {
      if (imagemUrl) await removerImagemLocal(imagemUrl, pastaUploads, idEstabelecimento);
      tratarErroDados(erro);
    }
    return true;
  }
  const promocaoId = caminho.match(/^\/api\/admin\/promocoes\/(\d+)$/);
  if (requisicao.method === 'PUT' && promocaoId) {
    const id = Number(promocaoId[1]);
    const anterior = await buscarPromocao(banco, idEstabelecimento, id);
    if (!anterior) throw new ErroHttp(404, 'Promoção não encontrada.');
    const dados = await lerJson(requisicao);
    let imagemUrl;
    let novaImagem = null;
    try {
      imagemUrl = await processarImagemAtualizada(
        dados.imagem,
        anterior.imagem,
        pastaUploads,
        idEstabelecimento,
        'promocao'
      );
      if (imagemUrl !== anterior.imagem) novaImagem = imagemUrl;
      const promocao = await salvarPromocao(banco, idEstabelecimento, dados, id, imagemUrl);
      if (anterior.imagem && anterior.imagem !== imagemUrl) {
        await removerImagemLocal(anterior.imagem, pastaUploads, idEstabelecimento);
      }
      responderJson(resposta, 200, { promocao });
    } catch (erro) {
      if (novaImagem) await removerImagemLocal(novaImagem, pastaUploads, idEstabelecimento);
      tratarErroDados(erro);
    }
    return true;
  }
  if (requisicao.method === 'DELETE' && promocaoId) {
    const id = Number(promocaoId[1]);
    const promocao = await buscarPromocao(banco, idEstabelecimento, id);
    if (!promocao || !await excluirPromocao(banco, idEstabelecimento, id)) {
      throw new ErroHttp(404, 'Promoção não encontrada.');
    }
    await removerImagemLocal(promocao.imagem, pastaUploads, idEstabelecimento);
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
  /* QR Code único da equipe: trocá-lo invalida os códigos já impressos, sem
     mexer em nenhum cadastro. */
  if (requisicao.method === 'POST' && caminho === '/api/admin/acesso-garcom') {
    responderJson(resposta, 200, {
      acessoGarcom: await rotacionarTokenAcessoGarcom(banco, idEstabelecimento)
    });
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
  if (requisicao.method === 'DELETE' && funcionarioId) {
    if (!await excluirFuncionario(banco, idEstabelecimento, funcionarioId[1])) {
      throw new ErroHttp(404, 'Funcionário não encontrado.');
    }
    responderJson(resposta, 200, { sucesso: true });
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
    exigirAlgumaPermissao(administradorAutenticado, PERMISSOES_CONFIGURACAO);
    const anterior = await buscarConfiguracao(banco, idEstabelecimento);
    const dados = limitarConfiguracaoPorPermissao(
      anterior,
      await lerJson(requisicao),
      administradorAutenticado.permissoes
    );
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

  if (requisicao.method === 'GET' && caminho === '/api/admin/impressoras') {
    responderJson(resposta, 200, {
      impressoras: await listarImpressoras(banco, idEstabelecimento),
      dispositivos: await listarDispositivosImpressao(banco, idEstabelecimento)
    });
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/admin/impressoras') {
    const dados = await lerJson(requisicao);
    try {
      responderJson(resposta, 201, {
        impressora: await criarImpressora(banco, idEstabelecimento, dados, administradorAutenticado.id)
      });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  const impressoraStatus = caminho.match(/^\/api\/admin\/impressoras\/(\d+)\/status$/);
  if (requisicao.method === 'PATCH' && impressoraStatus) {
    const dados = await lerJson(requisicao);
    const impressora = await atualizarStatusImpressora(
      banco,
      idEstabelecimento,
      Number(impressoraStatus[1]),
      dados?.ativa,
      administradorAutenticado.id
    );
    if (!impressora) throw new ErroHttp(404, 'Impressora não encontrada.');
    responderJson(resposta, 200, { impressora });
    return true;
  }

  const impressoraId = caminho.match(/^\/api\/admin\/impressoras\/(\d+)$/);
  if (requisicao.method === 'PUT' && impressoraId) {
    const dados = await lerJson(requisicao);
    try {
      const impressora = await atualizarImpressora(
        banco,
        idEstabelecimento,
        Number(impressoraId[1]),
        dados,
        administradorAutenticado.id
      );
      if (!impressora) throw new ErroHttp(404, 'Impressora não encontrada.');
      responderJson(resposta, 200, { impressora });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }
  if (requisicao.method === 'DELETE' && impressoraId) {
    try {
      const excluida = await excluirImpressora(
        banco,
        idEstabelecimento,
        Number(impressoraId[1]),
        administradorAutenticado.id
      );
      if (!excluida) throw new ErroHttp(404, 'Impressora não encontrada.');
      responderJson(resposta, 200, { sucesso: true });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  /* Pareamento do agente local: o token vai em texto puro só nesta resposta,
     porque o servidor guarda apenas o hash e não consegue mostrá-lo de novo. */
  if (requisicao.method === 'POST' && caminho === '/api/admin/impressao/dispositivos') {
    const dados = await lerJson(requisicao);
    try {
      const { dispositivo, token } = await criarDispositivoImpressao(
        banco,
        idEstabelecimento,
        dados,
        administradorAutenticado.id
      );
      responderJson(resposta, 201, { dispositivo, token });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  const dispositivoImpressaoId = caminho.match(/^\/api\/admin\/impressao\/dispositivos\/(\d+)$/);
  if (requisicao.method === 'DELETE' && dispositivoImpressaoId) {
    const dispositivo = await revogarDispositivoImpressao(
      banco,
      idEstabelecimento,
      Number(dispositivoImpressaoId[1]),
      administradorAutenticado.id
    );
    if (!dispositivo) throw new ErroHttp(404, 'Dispositivo de impressão não encontrado.');
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }

  if (requisicao.method === 'GET' && caminho === '/api/admin/areas-entrega') {
    responderJson(resposta, 200, { areasEntrega: await listarAreasEntrega(banco, idEstabelecimento) });
    return true;
  }

  if (requisicao.method === 'POST' && caminho === '/api/admin/areas-entrega') {
    const dados = await lerJson(requisicao);
    try {
      responderJson(resposta, 201, {
        areaEntrega: await criarAreaEntrega(banco, idEstabelecimento, dados, administradorAutenticado.id)
      });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  const areaEntregaStatus = caminho.match(/^\/api\/admin\/areas-entrega\/(\d+)\/status$/);
  if (requisicao.method === 'PATCH' && areaEntregaStatus) {
    const dados = await lerJson(requisicao);
    const areaEntrega = await alterarStatusAreaEntrega(
      banco,
      idEstabelecimento,
      Number(areaEntregaStatus[1]),
      dados?.ativo,
      administradorAutenticado.id
    );
    if (!areaEntrega) throw new ErroHttp(404, 'Área de entrega não encontrada.');
    responderJson(resposta, 200, { areaEntrega });
    return true;
  }

  const areaEntregaId = caminho.match(/^\/api\/admin\/areas-entrega\/(\d+)$/);
  if (requisicao.method === 'PUT' && areaEntregaId) {
    const dados = await lerJson(requisicao);
    try {
      const areaEntrega = await atualizarAreaEntrega(
        banco,
        idEstabelecimento,
        Number(areaEntregaId[1]),
        dados,
        administradorAutenticado.id
      );
      if (!areaEntrega) throw new ErroHttp(404, 'Área de entrega não encontrada.');
      responderJson(resposta, 200, { areaEntrega });
    } catch (erro) {
      tratarErroDados(erro);
    }
    return true;
  }

  if (requisicao.method === 'DELETE' && areaEntregaId) {
    try {
      if (!await excluirAreaEntrega(banco, idEstabelecimento, Number(areaEntregaId[1]), administradorAutenticado.id)) {
        throw new ErroHttp(404, 'Área de entrega não encontrada.');
      }
      responderJson(resposta, 200, { sucesso: true });
    } catch (erro) {
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
  /* QR Code único da equipe: a tela só confirma que o código ainda vale antes
     de pedir a senha. Não devolve nada sobre o estabelecimento nem sobre a
     equipe, e mesmo assim conta como tentativa, para o token não poder ser
     varrido às cegas. */
  const acessoEquipe = caminho.match(/^\/api\/garcom\/acesso\/([\w.-]{1,160})$/);
  if (requisicao.method === 'GET' && acessoEquipe) {
    const chaves = chavesTentativa(requisicao, 'garcom', acessoEquipe[1]);
    validarLimiteLogin(limitadorGarcom, chaves);
    if (!await tokenAcessoGarcomValido(banco, idEstabelecimento, acessoEquipe[1])) {
      chaves.forEach((chave) => limitadorGarcom.registrarFalha(chave));
      throw new ErroHttp(404, 'Este QR Code não vale mais. Peça o código atual ao gerente.');
    }
    responderJson(resposta, 200, { valido: true });
    return true;
  }

  /* Login do garçom: só a senha, para o acesso no meio do salão ser rápido. O
     QR Code da equipe entra junto como segunda condição — sem ele a senha
     curta ficaria sozinha protegendo a conta. */
  if (requisicao.method === 'POST' && caminho === '/api/garcom/login') {
    const dados = await lerJson(requisicao);
    const tokenEquipe = String(dados.token ?? '');
    const chaves = chavesTentativa(requisicao, 'garcom', tokenEquipe);
    validarLimiteLogin(limitadorGarcom, chaves);
    if (!await tokenAcessoGarcomValido(banco, idEstabelecimento, tokenEquipe)) {
      chaves.forEach((chave) => limitadorGarcom.registrarFalha(chave));
      throw new ErroHttp(404, 'Este QR Code não vale mais. Peça o código atual ao gerente.');
    }
    const funcionario = await buscarFuncionarioPorSenha(
      banco,
      idEstabelecimento,
      String(dados.senha ?? '')
    );
    if (!funcionario) {
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
    responderJson(resposta, 200, await listarDadosGarcom(banco, idEstabelecimento));
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
    await removerItemComanda(
      banco,
      idEstabelecimento,
      itemComanda[1],
      itemComanda[2],
      garcom.id,
      { somenteNaoLancados: true }
    );
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }
  const pendentesComanda = caminho.match(/^\/api\/garcom\/comandas\/(\d+)\/itens-pendentes$/);
  if (requisicao.method === 'DELETE' && pendentesComanda) {
    const removidos = await limparItensNaoLancados(
      banco,
      idEstabelecimento,
      pendentesComanda[1],
      { funcionarioId: garcom.id }
    );
    responderJson(resposta, 200, { sucesso: true, removidos });
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
  const observacaoComanda = caminho.match(/^\/api\/garcom\/comandas\/(\d+)\/observacao$/);
  if (requisicao.method === 'PUT' && observacaoComanda) {
    const dados = await lerJson(requisicao);
    const observacao = await atualizarObservacaoComanda(
      banco,
      idEstabelecimento,
      observacaoComanda[1],
      garcom.id,
      dados.observacao
    );
    responderJson(resposta, 200, { sucesso: true, observacao });
    return true;
  }
  const enviar = caminho.match(/^\/api\/garcom\/comandas\/(\d+)\/enviar$/);
  if (requisicao.method === 'POST' && enviar) {
    await enviarComanda(banco, idEstabelecimento, enviar[1], garcom.id);
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }
  return false;
}

/*
  Fila de impressão consumida pelo agente local da loja.

  Esquema de autenticação próprio: nem JWT de painel, nem sessão de garçom. O
  agente manda o token do dispositivo e o servidor resolve o estabelecimento a
  partir dele — o tenant nunca vem do host nem de nada que o agente informe, e
  token revogado não resolve loja nenhuma. Por isso estas rotas não passam por
  `resolverEstabelecimento`: um agente apontado para o domínio principal
  continua atendendo a loja certa, a do próprio token.
*/
async function rotaImpressao({ banco, requisicao, resposta, caminho, limitadorImpressao }) {
  if (!caminho.startsWith('/api/impressao/')) return false;

  const endereco = requisicao.socket.remoteAddress || 'desconhecido';
  const chaveLimite = `impressao:ip:${endereco}`;
  if (!limitadorImpressao.permite(chaveLimite)) {
    throw new ErroHttp(429, 'Muitas requisições de impressão. Aguarde um minuto e tente novamente.');
  }
  limitadorImpressao.registrarFalha(chaveLimite);

  const dispositivo = await autenticarDispositivoImpressao(banco, tokenBearer(requisicao));
  if (!dispositivo) throw new ErroHttp(401, 'Dispositivo de impressão não autorizado.');
  const idEstabelecimento = dispositivo.idEstabelecimento;

  if (requisicao.method === 'GET' && caminho === '/api/impressao/trabalhos') {
    resposta.setHeader('Cache-Control', 'no-store');
    responderJson(resposta, 200, {
      dispositivo: { id: dispositivo.id, nome: dispositivo.nome },
      trabalhos: await listarTrabalhosImpressao(banco, idEstabelecimento)
    });
    return true;
  }

  const trabalhoConfirmado = caminho.match(/^\/api\/impressao\/trabalhos\/(\d+)\/confirmar$/);
  if (requisicao.method === 'POST' && trabalhoConfirmado) {
    if (!await confirmarTrabalhoImpressao(banco, idEstabelecimento, Number(trabalhoConfirmado[1]))) {
      throw new ErroHttp(404, 'Trabalho de impressão não encontrado ou já concluído.');
    }
    responderJson(resposta, 200, { sucesso: true });
    return true;
  }

  /* Falha mantém o trabalho pendente de propósito: a impressora pode estar sem
     papel ou fora da rede, e o recibo precisa sair quando ela voltar. */
  const trabalhoFalhou = caminho.match(/^\/api\/impressao\/trabalhos\/(\d+)\/falhar$/);
  if (requisicao.method === 'POST' && trabalhoFalhou) {
    if (!await falharTrabalhoImpressao(banco, idEstabelecimento, Number(trabalhoFalhou[1]))) {
      throw new ErroHttp(404, 'Trabalho de impressão não encontrado ou já concluído.');
    }
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
  if (parametros.caminho.startsWith('/api/impressao/')) {
    return rotaImpressao(parametros);
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
    /^\/uploads\/estabelecimentos\/([1-9]\d*)\/((?:produto|promocao|logo|banner)-[a-f0-9-]+\.(?:jpg|png|webp))$/
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

/*
  Página de loja fora do ar (suspensa ou arquivada, sem distinguir). Texto fixo
  e sem nenhum dado do estabelecimento — nem nome, nem identidade visual, nem
  motivo —, com o tema padrão da plataforma. Só CSS inline (a CSP permite
  estilo inline e bloqueia script) e sem cache, para a loja voltar a aparecer
  assim que for reativada.
*/
const PAGINA_ESTABELECIMENTO_INDISPONIVEL = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Estabelecimento indisponível</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { display: grid; min-height: 100vh; margin: 0; place-items: center; background: #111111; padding: 16px; color: #FFFFFF; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  main { width: min(440px, 100%); border: 1px solid #2A2A2A; border-top: 4px solid #FFC107; border-radius: 16px; background: #181818; padding: 32px 24px; text-align: center; }
  .icone { display: grid; width: 56px; height: 56px; margin: 0 auto 18px; place-items: center; border: 1px solid rgba(255, 193, 7, .4); border-radius: 50%; background: #141414; color: #FFC107; font-size: 26px; font-weight: 800; }
  h1 { margin: 0 0 10px; font-size: 22px; line-height: 1.25; }
  p { margin: 0; color: #C8C8C8; font-size: 15px; line-height: 1.55; }
</style>
</head>
<body>
<main>
  <div class="icone" aria-hidden="true">!</div>
  <h1>Estabelecimento indisponível</h1>
  <p>Este estabelecimento não está disponível no momento. Tente novamente mais tarde.</p>
</main>
</body>
</html>
`;

function enviarPaginaIndisponivel(resposta) {
  const corpo = Buffer.from(PAGINA_ESTABELECIMENTO_INDISPONIVEL);
  cabecalhosSeguranca(resposta);
  resposta.writeHead(403, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': corpo.length,
    'Cache-Control': 'no-store'
  });
  resposta.end(corpo);
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
    let estabelecimento = requisicao.estabelecimento;
    if (!estabelecimento) {
      try {
        estabelecimento = await resolverEstabelecimento(banco, requisicao, {
          dominioPrincipal,
          tenantDesenvolvimento
        });
      } catch (erro) {
        // Loja existente mas fora do ar: quem abre o endereço no navegador vê
        // uma página, não o JSON do 403. Loja inexistente segue no 404 de sempre.
        if (erro.codigo !== CODIGO_ESTABELECIMENTO_INDISPONIVEL) throw erro;
        enviarPaginaIndisponivel(resposta);
        return true;
      }
    }
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
  /* O agente consulta a fila a cada poucos segundos e confirma um trabalho por
     vez; o teto é generoso para não travar uma loja com várias impressoras. */
  const limitadorImpressao = criarLimitadorTentativas({ limite: 120, janelaMs: 60 * 1000 });
  const origensPermitidas = [...new Set([
    ...corsOrigins,
    ...(!producao ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : [])
  ])];
  return createServer(async (requisicao, resposta) => {
    try {
      resposta.configuracaoSeguranca = { producao };
      if (!(await aplicarCors(requisicao, resposta, { origensPermitidas, dominioPrincipal, banco }))) {
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
          limitadorImpressao,
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
      // `codigo` só acompanha erros que o navegador trata de forma própria
      // (CODIGOS_ERRO_PUBLICOS); o formato { erro } continua o mesmo.
      responderJson(resposta, status, {
        erro: status >= 500 ? 'Erro interno do servidor.' : mensagem,
        ...(status < 500 && CODIGOS_ERRO_PUBLICOS.has(erro.codigo) ? { codigo: erro.codigo } : {})
      });
    }
  });
}
