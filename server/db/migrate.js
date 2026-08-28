import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../config.js';
import { abrirBanco, fecharBanco } from '../database.js';
import { checksumMigration, checksumsCompativeisMigration } from './migration-utils.js';

const pastaProjeto = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pastaMigracoes = resolve(pastaProjeto, 'database/migrations');
const padraoMigration = /^\d{3}_[a-z0-9_-]+\.sql$/;

function separarInstrucoesSql(conteudo) {
  return conteudo
    .split(/;\s*(?:\r?\n|$)/)
    .map((instrucao) => instrucao.trim())
    .filter(Boolean);
}

let banco;
try {
  banco = await abrirBanco({ mysql: config.mysql });
  await banco.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      versao VARCHAR(255) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      executado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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

    const conexao = await banco.getConnection();
    try {
      for (const instrucao of separarInstrucoesSql(conteudo)) await conexao.query(instrucao);
      await conexao.execute(
        'INSERT INTO schema_migrations (versao, checksum) VALUES (?, ?)',
        [arquivo, hash]
      );
      totalAplicado += 1;
      console.log(`Migration aplicada: ${arquivo}`);
    } finally {
      conexao.release();
    }
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
