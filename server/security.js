import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const TAMANHO_HASH = 64;
const EMISSOR_JWT = 'site-hamburgueria';
const PERFIS_JWT = new Set(['administrador', 'garcom', 'superadministrador']);

export function criarHashSenha(senha) {
  const salt = randomBytes(16);
  const hash = scryptSync(senha, salt, TAMANHO_HASH);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verificarSenha(senha, valorSalvo) {
  const [algoritmo, saltHex, hashHex] = String(valorSalvo).split(':');
  if (algoritmo !== 'scrypt' || !saltHex || !hashHex) return false;

  try {
    const hashSalvo = Buffer.from(hashHex, 'hex');
    const hashInformado = scryptSync(senha, Buffer.from(saltHex, 'hex'), hashSalvo.length);
    return hashSalvo.length === hashInformado.length && timingSafeEqual(hashSalvo, hashInformado);
  } catch {
    return false;
  }
}

/*
  Índice de busca da senha do garçom. O garçom entra digitando só a senha, então
  o login precisa achar o cadastro sem testar o `pin_hash` de toda a equipe — e
  um sal aleatório por linha não permitiria essa busca.

  O sal vem do estabelecimento: a mesma senha em lojas diferentes gera índices
  diferentes, o que impede comparar equipes de tenants distintos e mantém a
  unicidade da senha restrita ao próprio estabelecimento. Continua sendo scrypt,
  então o índice não é mais barato de atacar que o hash em si, e quem autentica
  de fato é `verificarSenha` sobre o `pin_hash`.
*/
export function criarIndiceSenhaGarcom(idEstabelecimento, senha) {
  const sal = createHash('sha256').update(`garcom:${Number(idEstabelecimento)}`).digest();
  return scryptSync(senha, sal, 32).toString('hex');
}

export function criarHashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function codificarJsonBase64Url(valor) {
  return Buffer.from(JSON.stringify(valor), 'utf8').toString('base64url');
}

function assinarJwt(conteudo, segredo) {
  return createHmac('sha256', segredo).update(conteudo).digest('base64url');
}

function segredoJwtValido(segredo) {
  return typeof segredo === 'string' && Buffer.byteLength(segredo, 'utf8') >= 32;
}

export function criarSegredoJwtTemporario() {
  return randomBytes(48).toString('base64url');
}

export function criarJwt({
  idUsuario,
  perfil,
  idEstabelecimento = null,
  superadministrador = false,
  duracaoMs,
  segredo,
  agoraMs = Date.now()
}) {
  if (!segredoJwtValido(segredo)) {
    throw new Error('JWT_SECRET deve possuir pelo menos 32 bytes.');
  }
  const perfilNormalizado = String(perfil ?? '').toLowerCase();
  if (!PERFIS_JWT.has(perfilNormalizado)) throw new Error('Perfil JWT inválido.');
  const usuarioId = Number(idUsuario);
  const tenantId = idEstabelecimento == null ? null : Number(idEstabelecimento);
  const duracao = Number(duracaoMs);
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) throw new Error('Usuário JWT inválido.');
  if (perfilNormalizado !== 'superadministrador'
      && (!Number.isInteger(tenantId) || tenantId <= 0)) {
    throw new Error('Estabelecimento JWT inválido.');
  }
  if (perfilNormalizado === 'superadministrador' && tenantId !== null) {
    throw new Error('O superadministrador JWT deve possuir escopo global.');
  }
  if (perfilNormalizado !== 'superadministrador' && superadministrador) {
    throw new Error('A indicação de superadministrador não corresponde ao perfil JWT.');
  }
  if (!Number.isSafeInteger(duracao) || duracao <= 0) throw new Error('Duração JWT inválida.');

  const emitidoEm = Math.floor(agoraMs / 1000);
  const expiraEm = Math.floor((agoraMs + duracao) / 1000);
  const cabecalho = codificarJsonBase64Url({ alg: 'HS256', typ: 'JWT' });
  const carga = codificarJsonBase64Url({
    iss: EMISSOR_JWT,
    sub: String(usuarioId),
    perfil: perfilNormalizado,
    id_estabelecimento: tenantId,
    superadministrador: Boolean(superadministrador || perfilNormalizado === 'superadministrador'),
    jti: randomBytes(16).toString('base64url'),
    iat: emitidoEm,
    nbf: emitidoEm,
    exp: expiraEm
  });
  const conteudo = `${cabecalho}.${carga}`;
  return `${conteudo}.${assinarJwt(conteudo, segredo)}`;
}

function decodificarParteJwt(parte) {
  const texto = Buffer.from(parte, 'base64url').toString('utf8');
  const valor = JSON.parse(texto);
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error();
  return valor;
}

export function verificarJwt(token, segredo, { agoraMs = Date.now() } = {}) {
  if (!segredoJwtValido(segredo)) return null;
  const tokenInformado = String(token ?? '');
  if (tokenInformado.length > 4096) return null;
  const partes = tokenInformado.split('.');
  if (partes.length !== 3 || partes.some((parte) => !parte)) return null;
  try {
    const [cabecalhoCodificado, cargaCodificada, assinaturaInformada] = partes;
    const cabecalho = decodificarParteJwt(cabecalhoCodificado);
    if (cabecalho.alg !== 'HS256' || cabecalho.typ !== 'JWT') return null;
    const conteudo = `${cabecalhoCodificado}.${cargaCodificada}`;
    const assinaturaEsperada = Buffer.from(assinarJwt(conteudo, segredo), 'base64url');
    const assinaturaRecebida = Buffer.from(assinaturaInformada, 'base64url');
    if (assinaturaEsperada.length !== assinaturaRecebida.length
        || !timingSafeEqual(assinaturaEsperada, assinaturaRecebida)) return null;

    const carga = decodificarParteJwt(cargaCodificada);
    const agora = Math.floor(agoraMs / 1000);
    const idUsuario = Number(carga.sub);
    const idEstabelecimento = carga.id_estabelecimento == null
      ? null
      : Number(carga.id_estabelecimento);
    if (carga.iss !== EMISSOR_JWT
        || !PERFIS_JWT.has(carga.perfil)
        || !Number.isInteger(idUsuario) || idUsuario <= 0
        || typeof carga.jti !== 'string' || carga.jti.length < 16
        || !Number.isInteger(carga.iat)
        || !Number.isInteger(carga.nbf)
        || !Number.isInteger(carga.exp)
        || carga.iat > agora + 30
        || carga.nbf > agora + 30
        || carga.exp <= agora
        || carga.exp <= carga.iat) return null;
    if (carga.perfil !== 'superadministrador'
        && (!Number.isInteger(idEstabelecimento) || idEstabelecimento <= 0)) return null;
    if (carga.perfil === 'superadministrador' && idEstabelecimento !== null) return null;
    if (carga.superadministrador !== (carga.perfil === 'superadministrador')) return null;

    return {
      idUsuario,
      perfil: carga.perfil,
      idEstabelecimento,
      superadministrador: carga.superadministrador,
      idToken: carga.jti,
      emitidoEm: carga.iat,
      expiraEm: carga.exp
    };
  } catch {
    return null;
  }
}
