import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { criarSegredoJwtTemporario } from './security.js';

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

if (producao && (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME)) {
  throw new Error('Defina DB_HOST, DB_USER, DB_PASSWORD e DB_NAME antes de iniciar o servidor em produção.');
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
  mysql: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hamburgueria',
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
    ssl: process.env.DB_SSL === 'true',
    sslCa: process.env.DB_SSL_CA || '',
    criarBancoSeAusente: !producao && process.env.DB_CREATE_IF_MISSING !== '0'
  },
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
