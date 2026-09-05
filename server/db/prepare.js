import { config } from '../config.js';
import { fecharBanco, prepararBanco } from '../database.js';

if (!config.administrador.senha) {
  throw new Error('Defina ADMIN_PASSWORD antes de executar npm run db:prepare.');
}
if (config.producao && config.administrador.senha.length < 12) {
  throw new Error('ADMIN_PASSWORD deve ter pelo menos 12 caracteres em produção.');
}

const banco = await prepararBanco({
  mysql: config.mysql,
  administrador: config.administrador,
  incluirDadosDemonstracao: config.incluirDadosDemonstracao,
  senhaFuncionarioDemonstracao: config.senhaFuncionarioDemonstracao,
  slugEstabelecimento: config.tenantDesenvolvimento
});
await fecharBanco(banco);
console.log('Banco preparado explicitamente com a estrutura e os dados iniciais atuais.');
