import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../config.js';
import { abrirBanco, executarTransacao, fecharBanco } from '../database.js';
import { checksumMigration, checksumsCompativeisMigration } from './migration-utils.js';

const pastaProjeto = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pastaMigracoes = resolve(pastaProjeto, 'database/migrations');
const padraoMigration = /^\d{3}_[a-z0-9_-]+\.sql$/;

let banco;
try {
  banco = await abrirBanco({ banco: config.banco });
  await banco.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      versao VARCHAR(255) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      executado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const arquivos = (await readdir(pastaMigracoes))
    .filter((arquivo) => padraoMigration.test(arquivo))
    .sort((a, b) => a.localeCompare(b));
  const [registradas] = await banco.query(`
    SELECT versao, checksum, executado_em
    FROM schema_migrations
    ORDER BY versao
  `);
  const aplicadas = new Map(registradas.map((registro) => [registro.versao, registro.checksum]));
  let totalAplicado = 0;

  for (const arquivo of arquivos) {
    const conteudo = await readFile(resolve(pastaMigracoes, arquivo), 'utf8');
    const hash = checksumMigration(conteudo);
    if (aplicadas.has(arquivo)) {
      const hashRegistrado = aplicadas.get(arquivo);
      if (!checksumsCompativeisMigration(conteudo).has(hashRegistrado)) {
        throw new Error(`A migration já aplicada ${arquivo} foi modificada.`);
      }
      if (hashRegistrado !== hash) {
        await banco.execute(
          'UPDATE schema_migrations SET checksum = ? WHERE versao = ? AND checksum = ?',
          [hash, arquivo, hashRegistrado]
        );
        console.log(`Checksum normalizado: ${arquivo}`);
      }
      continue;
    }

    /* No PostgreSQL DDL é transacional: o arquivo inteiro e o registro em
       schema_migrations entram juntos ou nada entra. O arquivo vai numa única
       chamada (protocolo simples), o que preserva blocos $$ ... $$ intactos. */
    await executarTransacao(banco, async (conexao) => {
      await conexao.query(conteudo);
      await conexao.execute(
        'INSERT INTO schema_migrations (versao, checksum) VALUES (?, ?)',
        [arquivo, hash]
      );
    });
    totalAplicado += 1;
    console.log(`Migration aplicada: ${arquivo}`);
  }

  console.log(totalAplicado
    ? `${totalAplicado} migration(s) aplicada(s) com sucesso.`
    : 'Nenhuma migration pendente.');
} catch (erro) {
  console.error(`Falha ao aplicar migrations: ${erro.message}`);
  process.exitCode = 1;
} finally {
  if (banco) await fecharBanco(banco);
}
