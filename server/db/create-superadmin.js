import { config } from '../config.js';
import { abrirBanco, fecharBanco } from '../database.js';
import { criarSuperadministradorInicial } from '../superadmin.js';

const credenciais = config.superadministrador;

if (!credenciais.senha) {
  throw new Error('Defina SUPERADMIN_PASSWORD no .env antes de executar este comando.');
}

if (credenciais.senha.length < 12) {
  throw new Error('SUPERADMIN_PASSWORD deve ter pelo menos 12 caracteres.');
}

const banco = await abrirBanco({ mysql: config.mysql });

try {
  await criarSuperadministradorInicial(banco, credenciais);
  console.log('Superadministrador global criado ou verificado com sucesso.');
} finally {
  await fecharBanco(banco);
}
