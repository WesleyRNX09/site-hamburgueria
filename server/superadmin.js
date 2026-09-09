import { executarTransacao } from './database.js';
import { criarHashSenha, verificarSenha } from './security.js';

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
const REGEX_USUARIO = /^[a-z0-9._-]{3,80}$/;
const REGEX_EMAIL = /^\S+@\S+\.\S+$/;
const TAMANHO_MINIMO_SENHA = 12;
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
  if (!REGEX_USUARIO.test(usuario)) throw erroDominio('O usuário do administrador é inválido.');
  if (!REGEX_EMAIL.test(email)) throw erroDominio('O e-mail do administrador é inválido.');
  if (senha.length < TAMANHO_MINIMO_SENHA) {
    throw erroDominio(`A senha inicial do administrador deve ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
  }
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

/*
  Troca de senha do próprio superadministrador. Diferente do painel do
  estabelecimento, aqui TODAS as sessões caem — inclusive a que fez a troca —
  seguindo o mesmo padrão de criarSuperadministradorInicial. O escopo é global,
  então uma sessão sobrevivente com a senha antiga é risco alto demais.
*/
export async function alterarSenhaSuperadministrador(banco, superadministradorId, dados) {
  const id = Number(superadministradorId);
  if (!Number.isInteger(id) || id <= 0) throw erroDominio('Superadministrador inválido.');
  const senhaAtual = String(dados?.senhaAtual ?? '');
  const novaSenha = String(dados?.novaSenha ?? '');
  const confirmacao = String(dados?.confirmacaoSenha ?? '');
  if (novaSenha.length < 12) throw erroDominio('A nova senha deve ter pelo menos 12 caracteres.');
  if (novaSenha !== confirmacao) throw erroDominio('A confirmação da nova senha não confere.');
  await executarTransacao(banco, async (conexao) => {
    const [linhas] = await conexao.execute(`
      SELECT senha_hash FROM superadministradores
      WHERE id = ? AND ativo = 1
      FOR UPDATE
    `, [id]);
    if (!linhas[0] || !verificarSenha(senhaAtual, linhas[0].senha_hash)) {
      throw erroDominio('A senha atual está incorreta.', 401);
    }
    if (verificarSenha(novaSenha, linhas[0].senha_hash)) {
      throw erroDominio('A nova senha deve ser diferente da senha atual.');
    }
    await conexao.execute(
      'UPDATE superadministradores SET senha_hash = ? WHERE id = ?',
      [criarHashSenha(novaSenha), id]
    );
    await conexao.execute(
      'DELETE FROM sessoes_superadmin WHERE superadministrador_id = ?',
      [id]
    );
    await registrarAuditoria(conexao, id, null, 'superadministrador.senha_alterada', {});
  });
}

const SELECAO_SUPERADMINISTRADOR = `
  SELECT id, usuario, email, nome, ativo, criado_em, atualizado_em
  FROM superadministradores
`;

function mapearSuperadministrador(linha) {
  return {
    id: Number(linha.id),
    usuario: linha.usuario,
    email: linha.email,
    nome: linha.nome,
    ativo: Boolean(linha.ativo),
    criadoEm: dataIso(linha.criado_em),
    atualizadoEm: dataIso(linha.atualizado_em)
  };
}

export async function listarSuperadministradores(banco) {
  const [linhas] = await banco.execute(`
    ${SELECAO_SUPERADMINISTRADOR}
    ORDER BY ativo DESC, nome
  `, []);
  return linhas.map(mapearSuperadministrador);
}

export async function criarSuperadministrador(banco, dados, superadministradorId) {
  const nome = texto(dados?.nome, 160);
  const usuario = texto(dados?.usuario, 80).toLowerCase();
  const email = texto(dados?.email, 160).toLowerCase();
  const senha = String(dados?.senha ?? '');
  const confirmacao = String(dados?.confirmacaoSenha ?? '');
  if (!nome) throw erroDominio('Informe o nome do superadministrador.');
  if (!REGEX_USUARIO.test(usuario)) throw erroDominio('O usuário do superadministrador é inválido.');
  if (!REGEX_EMAIL.test(email)) throw erroDominio('O e-mail do superadministrador é inválido.');
  if (senha.length < TAMANHO_MINIMO_SENHA) {
    throw erroDominio(`A senha deve ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
  }
  if (senha !== confirmacao) throw erroDominio('A confirmação da senha não confere.');
  const id = await executarTransacao(banco, async (conexao) => {
    const [resultado] = await conexao.execute(`
      INSERT INTO superadministradores (usuario, email, nome, senha_hash, ativo)
      VALUES (?, ?, ?, ?, 1)
    `, [usuario, email, nome, criarHashSenha(senha)]);
    await registrarAuditoria(conexao, superadministradorId, null, 'superadministrador.criado', {
      alvo: Number(resultado.insertId),
      usuario,
      email
    });
    return Number(resultado.insertId);
  });
  const [linhas] = await banco.execute(`${SELECAO_SUPERADMINISTRADOR} WHERE id = ?`, [id]);
  return mapearSuperadministrador(linhas[0]);
}

/*
  Desativação em vez de exclusão: o histórico de auditoria aponta para o id do
  superadministrador, então apagar a linha cegaria os registros passados. Os
  dois travamentos abaixo existem porque aqui não há outro nível acima para
  socorrer: sem eles dá para trancar a plataforma inteira em um clique.
*/
export async function alternarStatusSuperadministrador(banco, id, ativo, superadministradorId) {
  const alvoId = Number(id);
  if (!Number.isInteger(alvoId) || alvoId <= 0) return null;
  if (!ativo && alvoId === Number(superadministradorId)) {
    throw erroDominio('Você não pode desativar o próprio acesso.', 409);
  }
  return executarTransacao(banco, async (conexao) => {
    const [alvos] = await conexao.execute(
      'SELECT id FROM superadministradores WHERE id = ? FOR UPDATE',
      [alvoId]
    );
    if (!alvos[0]) return null;
    if (!ativo) {
      const [contagens] = await conexao.execute(
        'SELECT COUNT(id) AS total FROM superadministradores WHERE ativo = 1 FOR UPDATE',
        []
      );
      if (Number(contagens[0].total) <= 1) {
        throw erroDominio('Mantenha ao menos um superadministrador ativo.', 409);
      }
    }
    await conexao.execute(
      'UPDATE superadministradores SET ativo = ? WHERE id = ?',
      [ativo ? 1 : 0, alvoId]
    );
    if (!ativo) {
      await conexao.execute(
        'DELETE FROM sessoes_superadmin WHERE superadministrador_id = ?',
        [alvoId]
      );
    }
    await registrarAuditoria(
      conexao,
      superadministradorId,
      null,
      ativo ? 'superadministrador.ativado' : 'superadministrador.desativado',
      { alvo: alvoId }
    );
    const [linhas] = await conexao.execute(`${SELECAO_SUPERADMINISTRADOR} WHERE id = ?`, [alvoId]);
    return mapearSuperadministrador(linhas[0]);
  });
}

/*
  Reset de senha do administrador de um estabelecimento, feito pelo superadmin.

  O id do administrador NUNCA é usado sozinho: toda leitura e toda escrita
  filtram por `id = ? AND id_estabelecimento = ?`, com o tenant vindo da própria
  rota. Um administrador do estabelecimento A informado junto do id do
  estabelecimento B simplesmente não é encontrado, e a função devolve null (404)
  em vez de trocar a senha de quem não deveria.
*/
export async function redefinirSenhaAdministrador(
  banco,
  idEstabelecimento,
  idAdministrador,
  dados,
  superadministradorId
) {
  const tenantId = Number(idEstabelecimento);
  const alvoId = Number(idAdministrador);
  if (!Number.isInteger(tenantId) || tenantId <= 0) return null;
  if (!Number.isInteger(alvoId) || alvoId <= 0) return null;
  const novaSenha = String(dados?.novaSenha ?? '');
  const confirmacao = String(dados?.confirmacaoSenha ?? '');
  if (novaSenha.length < TAMANHO_MINIMO_SENHA) {
    throw erroDominio(`A nova senha deve ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
  }
  if (novaSenha !== confirmacao) throw erroDominio('A confirmação da nova senha não confere.');
  return executarTransacao(banco, async (conexao) => {
    const [alvos] = await conexao.execute(`
      SELECT id, usuario, nome FROM administradores
      WHERE id = ? AND id_estabelecimento = ?
      FOR UPDATE
    `, [alvoId, tenantId]);
    if (!alvos[0]) return null;
    await conexao.execute(`
      UPDATE administradores SET senha_hash = ?
      WHERE id = ? AND id_estabelecimento = ?
    `, [criarHashSenha(novaSenha), alvoId, tenantId]);
    // A senha antiga deixou de valer: nenhuma sessão daquele admin sobrevive.
    await conexao.execute(`
      DELETE FROM sessoes_admin
      WHERE administrador_id = ? AND id_estabelecimento = ?
    `, [alvoId, tenantId]);
    await registrarAuditoria(
      conexao,
      superadministradorId,
      tenantId,
      'administrador.senha_redefinida',
      { administrador: alvoId, usuario: alvos[0].usuario }
    );
    return { id: alvoId, usuario: alvos[0].usuario, nome: alvos[0].nome };
  });
}

const LIMITE_AUDITORIA_PADRAO = 50;
const LIMITE_AUDITORIA_MAXIMO = 200;

/*
  Filtro de período. A coluna é DATETIME, então comparamos com o texto
  'YYYY-MM-DD HH:MM:SS' em vez de um objeto Date: assim o recorte usa o mesmo
  relógio gravado no banco, sem conversão de fuso pelo driver.
*/
function dataFiltro(valor, fimDoDia) {
  const informada = texto(valor, 10);
  if (!informada) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(informada)) throw erroDominio('Informe uma data válida no filtro.');
  const data = new Date(`${informada}T00:00:00.000Z`);
  if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== informada) {
    throw erroDominio('Informe uma data válida no filtro.');
  }
  return `${informada} ${fimDoDia ? '23:59:59' : '00:00:00'}`;
}

function inteiroPositivo(valor, padrao, maximo = 0) {
  const numero = Number(texto(valor, 12));
  if (!Number.isInteger(numero) || numero <= 0) return padrao;
  return maximo > 0 ? Math.min(numero, maximo) : numero;
}

function detalhesAuditoria(valor) {
  if (!valor) return null;
  if (typeof valor === 'string') {
    try {
      return JSON.parse(valor);
    } catch {
      return null;
    }
  }
  return valor;
}

function mapearAuditoria(linha) {
  return {
    id: Number(linha.id),
    acao: linha.acao,
    criadoEm: dataIso(linha.criado_em),
    superadministrador: linha.superadministrador_id
      ? {
        id: Number(linha.superadministrador_id),
        nome: linha.superadministrador_nome ?? '',
        usuario: linha.superadministrador_usuario ?? ''
      }
      : null,
    estabelecimento: linha.id_estabelecimento
      ? {
        id: Number(linha.id_estabelecimento),
        nomeFantasia: linha.estabelecimento_nome ?? '',
        slug: linha.estabelecimento_slug ?? ''
      }
      : null,
    detalhes: detalhesAuditoria(linha.detalhes_json)
  };
}

export async function listarAuditoriaSuperadmin(banco, filtros = {}) {
  const condicoes = [];
  const parametros = [];
  const idEstabelecimento = inteiroPositivo(filtros.estabelecimento, 0);
  if (idEstabelecimento > 0) {
    condicoes.push('a.id_estabelecimento = ?');
    parametros.push(idEstabelecimento);
  }
  const de = dataFiltro(filtros.de, false);
  if (de) {
    condicoes.push('a.criado_em >= ?');
    parametros.push(de);
  }
  const ate = dataFiltro(filtros.ate, true);
  if (ate) {
    condicoes.push('a.criado_em <= ?');
    parametros.push(ate);
  }
  const restricao = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  const [contagens] = await banco.execute(`
    SELECT COUNT(a.id) AS total
    FROM auditoria_superadmin a
    ${restricao}
  `, parametros);
  const total = Number(contagens[0]?.total ?? 0);

  const limite = inteiroPositivo(filtros.limite, LIMITE_AUDITORIA_PADRAO, LIMITE_AUDITORIA_MAXIMO);
  const paginas = Math.max(1, Math.ceil(total / limite));
  const pagina = Math.min(inteiroPositivo(filtros.pagina, 1), paginas);
  const deslocamento = (pagina - 1) * limite;

  /* LIMIT/OFFSET entram interpolados porque o protocolo preparado do MySQL não
     aceita placeholder nessa posição. Os dois passam por inteiroPositivo antes,
     então chegam aqui como inteiros já validados, nunca como texto do usuário. */
  const [linhas] = await banco.execute(`
    SELECT a.id, a.superadministrador_id, a.id_estabelecimento, a.acao,
           a.detalhes_json, a.criado_em,
           sa.nome AS superadministrador_nome, sa.usuario AS superadministrador_usuario,
           e.nome_fantasia AS estabelecimento_nome, e.slug AS estabelecimento_slug
    FROM auditoria_superadmin a
    LEFT JOIN superadministradores sa ON sa.id = a.superadministrador_id
    LEFT JOIN estabelecimentos e ON e.id_estabelecimento = a.id_estabelecimento
    ${restricao}
    ORDER BY a.criado_em DESC, a.id DESC
    LIMIT ${limite} OFFSET ${deslocamento}
  `, parametros);

  return {
    registros: linhas.map(mapearAuditoria),
    paginacao: { pagina, limite, total, paginas }
  };
}

export async function criarSuperadministradorInicial(banco, dados) {
  const nome = texto(dados.nome, 160);
  const usuario = texto(dados.usuario, 80).toLowerCase();
  const email = texto(dados.email, 160).toLowerCase();
  const senha = String(dados.senha ?? '');
  if (!nome || !REGEX_USUARIO.test(usuario) || !REGEX_EMAIL.test(email)) {
    throw new Error('Preencha nome, usuário e e-mail válidos para o superadministrador.');
  }
  if (senha.length < TAMANHO_MINIMO_SENHA) {
    throw new Error(`SUPERADMIN_PASSWORD deve ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
  }
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
