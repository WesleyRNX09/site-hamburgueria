import { executarTransacao } from './database.js';
import { criarHashSenha } from './security.js';

const PLANOS = new Set(['basico', 'profissional', 'premium']);
const STATUS_ESTABELECIMENTO = new Set(['ativo', 'inativo']);
const STATUS_ASSINATURA = new Set(['ativa', 'inadimplente', 'suspensa', 'bloqueada', 'cancelada']);
const FONTES = new Map([
  ['poppins', 'Poppins'],
  ['arial', 'Arial'],
  ['verdana', 'Verdana'],
  ['tahoma', 'Tahoma'],
  ['trebuchet ms', 'Trebuchet MS'],
  ['georgia', 'Georgia']
]);
const CORES_PADRAO = Object.freeze({
  corPrincipal: '#FFC107',
  corSecundaria: '#0A0A0A',
  corFundo: '#111111',
  corCard: '#181818',
  corTexto: '#FFFFFF'
});

function erroDominio(mensagem, status = 400) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

function texto(valor, limite = 255) {
  return String(valor ?? '').trim().slice(0, limite);
}

function normalizarSlug(valor) {
  const slug = texto(valor, 100).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw erroDominio('Use no slug apenas letras minúsculas, números e hífens.');
  }
  return slug;
}

function normalizarDominio(valor) {
  let dominio = texto(valor, 253).toLowerCase();
  if (!dominio) return null;
  if (/^https?:\/\//.test(dominio)) {
    try {
      const url = new URL(dominio);
      if (url.pathname !== '/' || url.search || url.hash || url.port) throw new Error();
      dominio = url.hostname;
    } catch {
      throw erroDominio('Informe somente um domínio válido, sem caminho, porta ou parâmetros.');
    }
  }
  dominio = dominio.replace(/\.$/, '');
  const rotulos = dominio.split('.');
  const rotuloValido = (rotulo) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(rotulo);
  if (rotulos.length < 2 || !rotulos.every(rotuloValido)) {
    throw erroDominio('Informe um domínio válido, como pedidos.exemplo.com.br.');
  }
  return dominio;
}

function urlPublica(valor, campo) {
  const url = texto(valor, 500);
  if (!url) return null;
  if (/^\/(?!\/)[^\s"'()\\]*$/.test(url)) return url;
  try {
    const analisada = new URL(url);
    if (!['http:', 'https:'].includes(analisada.protocol)) throw new Error();
    return analisada.href;
  } catch {
    throw erroDominio(`Informe uma URL segura para ${campo}.`);
  }
}

function cor(valor, padrao) {
  const informada = texto(valor, 7);
  if (!informada) return padrao;
  if (!/^#[0-9A-Fa-f]{6}$/.test(informada)) throw erroDominio('Informe cores válidas no formato hexadecimal.');
  return informada.toUpperCase();
}

function fontePermitida(valor) {
  const informada = texto(valor, 80);
  if (!informada) return 'Poppins';
  const fonte = FONTES.get(informada.toLowerCase());
  if (!fonte) throw erroDominio('Selecione uma fonte permitida.');
  return fonte;
}

function dataVencimento(valor) {
  const recebida = texto(valor, 30);
  if (!recebida) return null;
  const informada = recebida.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(informada)) throw erroDominio('Informe uma data de vencimento válida.');
  const data = new Date(`${informada}T23:59:59.000Z`);
  if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== informada) {
    throw erroDominio('Informe uma data de vencimento válida.');
  }
  return data;
}

function valorPermitido(valor, permitidos, campo) {
  const normalizado = texto(valor, 50).toLowerCase();
  if (!permitidos.has(normalizado)) throw erroDominio(`Selecione um valor válido para ${campo}.`);
  return normalizado;
}

function validarAdministrador(dados) {
  const nome = texto(dados?.nome, 160);
  const usuario = texto(dados?.usuario, 80).toLowerCase();
  const email = texto(dados?.email, 160).toLowerCase();
  const senha = String(dados?.senha ?? '');
  if (!nome || !usuario || !email || !senha) throw erroDominio('Preencha os dados do primeiro administrador.');
  if (!/^[a-z0-9._-]{3,80}$/.test(usuario)) throw erroDominio('O usuário do administrador é inválido.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw erroDominio('O e-mail do administrador é inválido.');
  if (senha.length < 12) throw erroDominio('A senha inicial do administrador deve ter pelo menos 12 caracteres.');
  return { nome, usuario, email, senhaHash: criarHashSenha(senha) };
}

function dadosNormalizados(dados, atual = {}) {
  const nomeFantasia = texto(dados.nomeFantasia ?? atual.nomeFantasia, 160);
  if (!nomeFantasia) throw erroDominio('Informe o nome do estabelecimento.');
  return {
    nomeFantasia,
    slug: normalizarSlug(dados.slug ?? atual.slug),
    dominioPersonalizado: normalizarDominio(dados.dominioPersonalizado ?? atual.dominioPersonalizado),
    status: valorPermitido(dados.status ?? atual.status ?? 'ativo', STATUS_ESTABELECIMENTO, 'o status'),
    plano: valorPermitido(dados.plano ?? atual.plano ?? 'basico', PLANOS, 'o plano'),
    statusAssinatura: valorPermitido(
      dados.statusAssinatura ?? atual.statusAssinatura ?? 'ativa',
      STATUS_ASSINATURA,
      'o status da assinatura'
    ),
    vencimentoAssinatura: dataVencimento(dados.vencimentoAssinatura ?? atual.vencimentoAssinatura),
    logo: urlPublica(dados.logo ?? atual.logo, 'a logo'),
    banner: urlPublica(dados.banner ?? atual.banner, 'o banner'),
    corPrincipal: cor(dados.corPrincipal ?? atual.corPrincipal, CORES_PADRAO.corPrincipal),
    corSecundaria: cor(dados.corSecundaria ?? atual.corSecundaria, CORES_PADRAO.corSecundaria),
    corFundo: cor(dados.corFundo ?? atual.corFundo, CORES_PADRAO.corFundo),
    corCard: cor(dados.corCard ?? atual.corCard, CORES_PADRAO.corCard),
    corTexto: cor(dados.corTexto ?? atual.corTexto, CORES_PADRAO.corTexto),
    fonte: fontePermitida(dados.fonte ?? atual.fonte)
  };
}

function dataIso(valor) {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

function mapearEstabelecimento(linha) {
  return {
    id: Number(linha.id_estabelecimento),
    nomeFantasia: linha.nome_fantasia,
    slug: linha.slug,
    dominioPersonalizado: linha.dominio_personalizado ?? '',
    status: linha.status,
    plano: linha.plano,
    statusAssinatura: linha.status_assinatura,
    vencimentoAssinatura: dataIso(linha.vencimento_assinatura_em),
    criadoEm: dataIso(linha.criado_em),
    atualizadoEm: dataIso(linha.atualizado_em),
    logo: linha.logo_url ?? '',
    banner: linha.banner_url ?? '',
    corPrincipal: linha.cor_principal ?? CORES_PADRAO.corPrincipal,
    corSecundaria: linha.cor_secundaria ?? CORES_PADRAO.corSecundaria,
    corFundo: linha.cor_fundo ?? CORES_PADRAO.corFundo,
    corCard: linha.cor_card ?? CORES_PADRAO.corCard,
    corTexto: linha.cor_texto ?? CORES_PADRAO.corTexto,
    fonte: linha.fonte ?? 'Poppins',
    totalAdministradores: Number(linha.total_administradores ?? 0)
  };
}

const SELECAO_ESTABELECIMENTO = `
  SELECT e.id_estabelecimento, e.nome_fantasia, e.slug, e.dominio_personalizado,
         e.status, e.plano, e.status_assinatura, e.vencimento_assinatura_em,
         e.criado_em, e.atualizado_em, ce.logo_url, ce.banner_url,
         ce.cor_principal, ce.cor_secundaria, ce.cor_fundo, ce.cor_card,
         ce.cor_texto, ce.fonte,
         (SELECT COUNT(a.id) FROM administradores a
          WHERE a.id_estabelecimento = e.id_estabelecimento) AS total_administradores
  FROM estabelecimentos e
  LEFT JOIN configuracoes_estabelecimento ce
    ON ce.id_estabelecimento = e.id_estabelecimento
`;

export async function listarEstabelecimentosGerenciais(banco, filtros = {}) {
  const condicoes = [];
  const parametros = [];
  const busca = texto(filtros.busca, 120);
  if (busca) {
    condicoes.push(`(
      LOWER(e.nome_fantasia) LIKE LOWER(?)
      OR LOWER(e.slug) LIKE LOWER(?)
      OR LOWER(COALESCE(e.dominio_personalizado, '')) LIKE LOWER(?)
    )`);
    parametros.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
  }
  const status = texto(filtros.status, 30).toLowerCase();
  if (STATUS_ESTABELECIMENTO.has(status)) {
    condicoes.push('e.status = ?');
    parametros.push(status);
  }
  const statusAssinatura = texto(filtros.statusAssinatura, 30).toLowerCase();
  if (STATUS_ASSINATURA.has(statusAssinatura)) {
    condicoes.push('e.status_assinatura = ?');
    parametros.push(statusAssinatura);
  }
  const plano = texto(filtros.plano, 50).toLowerCase();
  if (PLANOS.has(plano)) {
    condicoes.push('e.plano = ?');
    parametros.push(plano);
  }
  const [linhas] = await banco.execute(`
    ${SELECAO_ESTABELECIMENTO}
    ${condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''}
    ORDER BY e.criado_em DESC, e.id_estabelecimento DESC
    LIMIT 200
  `, parametros);
  return linhas.map(mapearEstabelecimento);
}

export async function buscarEstabelecimentoGerencial(banco, id) {
  const [linhas] = await banco.execute(`
    ${SELECAO_ESTABELECIMENTO}
    WHERE e.id_estabelecimento = ?
    LIMIT 1
  `, [Number(id)]);
  return linhas[0] ? mapearEstabelecimento(linhas[0]) : null;
}

async function registrarAuditoria(conexao, superadministradorId, estabelecimentoId, acao, detalhes) {
  await conexao.execute(`
    INSERT INTO auditoria_superadmin
      (superadministrador_id, id_estabelecimento, acao, detalhes_json)
    VALUES (?, ?, ?, ?)
  `, [superadministradorId, estabelecimentoId, acao, JSON.stringify(detalhes)]);
}

async function salvarConfiguracaoVisual(conexao, idEstabelecimento, dados) {
  await conexao.execute(`
    INSERT INTO configuracoes_estabelecimento
      (id_estabelecimento, logo_url, banner_url, cor_principal, cor_secundaria,
       cor_fundo, cor_card, cor_texto, fonte)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      logo_url = VALUES(logo_url), banner_url = VALUES(banner_url),
      cor_principal = VALUES(cor_principal), cor_secundaria = VALUES(cor_secundaria),
      cor_fundo = VALUES(cor_fundo), cor_card = VALUES(cor_card),
      cor_texto = VALUES(cor_texto), fonte = VALUES(fonte)
  `, [
    idEstabelecimento,
    dados.logo,
    dados.banner,
    dados.corPrincipal,
    dados.corSecundaria,
    dados.corFundo,
    dados.corCard,
    dados.corTexto,
    dados.fonte
  ]);
}

export async function criarEstabelecimentoGerencial(banco, dados, superadministradorId) {
  const estabelecimento = dadosNormalizados(dados);
  const administrador = validarAdministrador(dados.primeiroAdministrador);
  const idEstabelecimento = await executarTransacao(banco, async (conexao) => {
    const [resultado] = await conexao.execute(`
      INSERT INTO estabelecimentos
        (nome_fantasia, slug, dominio_personalizado, status, plano,
         status_assinatura, vencimento_assinatura_em)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      estabelecimento.nomeFantasia,
      estabelecimento.slug,
      estabelecimento.dominioPersonalizado,
      estabelecimento.status,
      estabelecimento.plano,
      estabelecimento.statusAssinatura,
      estabelecimento.vencimentoAssinatura
    ]);
    const id = Number(resultado.insertId);
    await salvarConfiguracaoVisual(conexao, id, estabelecimento);
    await conexao.execute(`
      INSERT INTO administradores
        (id_estabelecimento, usuario, email, nome, senha_hash, ativo)
      VALUES (?, ?, ?, ?, ?, 1)
    `, [id, administrador.usuario, administrador.email, administrador.nome, administrador.senhaHash]);
    await registrarAuditoria(conexao, superadministradorId, id, 'estabelecimento.criado', {
      slug: estabelecimento.slug,
      plano: estabelecimento.plano,
      statusAssinatura: estabelecimento.statusAssinatura
    });
    return id;
  });
  return buscarEstabelecimentoGerencial(banco, idEstabelecimento);
}

export async function atualizarEstabelecimentoGerencial(banco, id, dados, superadministradorId) {
  const idEstabelecimento = Number(id);
  if (!Number.isInteger(idEstabelecimento) || idEstabelecimento <= 0) return null;
  const atual = await buscarEstabelecimentoGerencial(banco, idEstabelecimento);
  if (!atual) return null;
  const estabelecimento = dadosNormalizados(dados, atual);
  await executarTransacao(banco, async (conexao) => {
    await conexao.execute(`
      UPDATE estabelecimentos
      SET nome_fantasia = ?, slug = ?, dominio_personalizado = ?, status = ?,
          plano = ?, status_assinatura = ?, vencimento_assinatura_em = ?
      WHERE id_estabelecimento = ?
    `, [
      estabelecimento.nomeFantasia,
      estabelecimento.slug,
      estabelecimento.dominioPersonalizado,
      estabelecimento.status,
      estabelecimento.plano,
      estabelecimento.statusAssinatura,
      estabelecimento.vencimentoAssinatura,
      idEstabelecimento
    ]);
    await salvarConfiguracaoVisual(conexao, idEstabelecimento, estabelecimento);
    await registrarAuditoria(conexao, superadministradorId, idEstabelecimento, 'estabelecimento.atualizado', {
      status: estabelecimento.status,
      plano: estabelecimento.plano,
      statusAssinatura: estabelecimento.statusAssinatura
    });
  });
  return buscarEstabelecimentoGerencial(banco, idEstabelecimento);
}

export async function criarSuperadministradorInicial(banco, dados) {
  const nome = texto(dados.nome, 160);
  const usuario = texto(dados.usuario, 80).toLowerCase();
  const email = texto(dados.email, 160).toLowerCase();
  const senha = String(dados.senha ?? '');
  if (!nome || !/^[a-z0-9._-]{3,80}$/.test(usuario) || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('Preencha nome, usuário e e-mail válidos para o superadministrador.');
  }
  if (senha.length < 12) throw new Error('SUPERADMIN_PASSWORD deve ter pelo menos 12 caracteres.');
  const [linhas] = await banco.execute(`
    SELECT id FROM superadministradores
    WHERE LOWER(usuario) = LOWER(?) OR LOWER(email) = LOWER(?)
    ORDER BY id LIMIT 1
  `, [usuario, email]);
  if (!linhas[0]) {
    await banco.execute(`
      INSERT INTO superadministradores (usuario, email, nome, senha_hash)
      VALUES (?, ?, ?, ?)
    `, [usuario, email, nome, criarHashSenha(senha)]);
    return;
  }
  if (!dados.sincronizarCredenciais) return;
  await executarTransacao(banco, async (conexao) => {
    await conexao.execute(`
      UPDATE superadministradores
      SET usuario = ?, email = ?, nome = ?, senha_hash = ?, ativo = 1
      WHERE id = ?
    `, [usuario, email, nome, criarHashSenha(senha), linhas[0].id]);
    await conexao.execute(
      'DELETE FROM sessoes_superadmin WHERE superadministrador_id = ?',
      [linhas[0].id]
    );
  });
}

export const opcoesSuperadmin = Object.freeze({
  planos: [...PLANOS],
  statusEstabelecimento: [...STATUS_ESTABELECIMENTO],
  statusAssinatura: [...STATUS_ASSINATURA],
  fontes: [...FONTES.values()]
});
