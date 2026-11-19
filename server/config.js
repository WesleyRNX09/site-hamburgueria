import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { criarSegredoJwtTemporario } from './security.js';
import { normalizarHostsSuperadmin } from './tenant.js';

const pastaProjeto = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const producao = process.env.NODE_ENV === 'production';
const senhaAdmin = process.env.ADMIN_PASSWORD || '';
const senhaSuperadmin = process.env.SUPERADMIN_PASSWORD || '';
const jwtSecretInformado = process.env.JWT_SECRET || '';

function listaAmbiente(valor) {
  return String(valor ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function caminhoConfigurado(valor, padrao) {
  const caminho = valor || padrao;
  return isAbsolute(caminho) ? caminho : resolve(pastaProjeto, caminho);
}

/*
  Conexão com o PostgreSQL (Supabase). Duas formas, nesta ordem:
  1. DATABASE_URL — a "connection string" do painel do Supabase
     (postgresql://usuario:senha@host:5432/postgres);
  2. DB_HOST, DB_PORT, DB_USER, DB_PASSWORD e DB_NAME separados.
  Parâmetros da URL como `sslmode` são ignorados: quem liga o TLS é DB_SSL
  (ou um sslmode=require/verify-full na própria URL), e o certificado é sempre
  validado. A mensagem de erro nunca repete a URL, porque ela contém a senha.
*/
export function lerConfiguracaoBanco(ambiente = process.env) {
  const url = String(ambiente.DATABASE_URL ?? '').trim();
  let partes = {};
  let sslPelaUrl = false;
  if (url) {
    let endereco;
    try {
      endereco = new URL(url);
    } catch {
      throw new Error('DATABASE_URL inválida. Use o formato postgresql://usuario:senha@host:5432/banco.');
    }
    if (!['postgres:', 'postgresql:'].includes(endereco.protocol)) {
      throw new Error('DATABASE_URL deve começar com postgresql://.');
    }
    partes = {
      host: endereco.hostname,
      port: endereco.port,
      user: decodeURIComponent(endereco.username),
      password: decodeURIComponent(endereco.password),
      database: decodeURIComponent(endereco.pathname.replace(/^\//, ''))
    };
    sslPelaUrl = ['require', 'verify-ca', 'verify-full'].includes(endereco.searchParams.get('sslmode') ?? '');
  }
  const ssl = ambiente.DB_SSL === undefined || ambiente.DB_SSL === ''
    ? sslPelaUrl
    : ambiente.DB_SSL === 'true';
  return {
    host: partes.host || ambiente.DB_HOST || '127.0.0.1',
    port: Number(partes.port || ambiente.DB_PORT) || 5432,
    user: partes.user || ambiente.DB_USER || 'postgres',
    password: partes.password || ambiente.DB_PASSWORD || '',
    database: partes.database || ambiente.DB_NAME || 'hamburgueria',
    connectionLimit: Number(ambiente.DB_CONNECTION_LIMIT) || 10,
    ssl,
    sslCa: ambiente.DB_SSL_CA || ''
  };
}

const bancoInformado = Boolean(String(process.env.DATABASE_URL ?? '').trim())
  || Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME);
if (producao && !bancoInformado) {
  throw new Error(
    'Defina DATABASE_URL (ou DB_HOST, DB_USER, DB_PASSWORD e DB_NAME) antes de iniciar o servidor em produção.'
  );
}
if (jwtSecretInformado && Buffer.byteLength(jwtSecretInformado, 'utf8') < 32) {
  throw new Error('JWT_SECRET deve possuir pelo menos 32 bytes.');
}
if (producao && !jwtSecretInformado) {
  throw new Error('Defina JWT_SECRET com pelo menos 32 bytes antes de iniciar o servidor em produção.');
}

export const config = {
  porta: Number(process.env.PORT) || 3001,
  producao,
  incluirDadosDemonstracao: process.env.SEED_DEMO_DATA === '1',
  senhaFuncionarioDemonstracao: process.env.DEMO_WAITER_PASSWORD || null,
  publicSiteUrl: process.env.PUBLIC_SITE_URL || '',
  dominioPrincipal: process.env.DOMINIO_PRINCIPAL || '',
  tenantDesenvolvimento: process.env.TENANT_DESENVOLVIMENTO || (!producao ? 'estabelecimento-padrao' : ''),
  jwtSecret: jwtSecretInformado || criarSegredoJwtTemporario(),
  corsOrigins: listaAmbiente(process.env.CORS_ORIGINS),
  // null = sem restrição (dev e localhost); lista = só esses hosts atendem /api/superadmin/*.
  superadminHosts: normalizarHostsSuperadmin(process.env.SUPERADMIN_HOSTS),
  banco: lerConfiguracaoBanco(),
  pastaUploads: caminhoConfigurado(process.env.UPLOADS_PATH, 'server/uploads'),
  pastaDist: resolve(pastaProjeto, 'dist'),
  administrador: {
    usuario: process.env.ADMIN_USER || 'admin',
    email: process.env.ADMIN_EMAIL || 'admin@hamburgueria.com',
    nome: process.env.ADMIN_NAME || 'Administrador',
    senha: senhaAdmin,
    sincronizarCredenciais: process.env.SYNC_ADMIN_CREDENTIALS === '1'
  },
  superadministrador: {
    usuario: process.env.SUPERADMIN_USER || 'superadmin',
    email: process.env.SUPERADMIN_EMAIL || 'superadmin@exemplo.com',
    nome: process.env.SUPERADMIN_NAME || 'Superadministrador',
    senha: senhaSuperadmin,
    sincronizarCredenciais: process.env.SYNC_SUPERADMIN_CREDENTIALS === '1'
  }
};
