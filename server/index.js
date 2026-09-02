import { criarServidor } from './app.js';
import { config } from './config.js';
import { abrirBanco, fecharBanco } from './database.js';
import { aguardarServidor, fecharServidor } from './runtime.js';

let banco = null;
let servidor = null;

async function iniciar() {
  banco = await abrirBanco({
    mysql: config.mysql
  });

  servidor = criarServidor({
    banco,
    pastaUploads: config.pastaUploads,
    pastaDist: config.pastaDist,
    producao: config.producao,
    corsOrigins: config.corsOrigins,
    publicSiteUrl: config.publicSiteUrl,
    dominioPrincipal: config.dominioPrincipal,
    tenantDesenvolvimento: config.tenantDesenvolvimento,
    jwtSecret: config.jwtSecret
  });

  await aguardarServidor(
    servidor,
    config.porta
  );

  console.log(
    `Backend da hamburgueria disponível na porta ${config.porta}`
  );
}

async function encerrar() {
  try {
    if (servidor) {
      await fecharServidor(servidor);
    }

    if (banco) {
      await fecharBanco(banco);
    }
  } catch (erro) {
    console.error('Erro ao encerrar o servidor:', erro);
  }
}

process.once('SIGINT', () => {
  encerrar().finally(() => process.exit(0));
});

process.once('SIGTERM', () => {
  encerrar().finally(() => process.exit(0));
});

iniciar().catch((erro) => {
  console.error('Erro ao iniciar o backend:', erro);
  process.exit(1);
});