import { createHash } from 'node:crypto';

function hash(conteudo) {
  return createHash('sha256').update(conteudo).digest('hex');
}

export function normalizarQuebrasMigration(conteudo) {
  return String(conteudo).replace(/\r\n?/g, '\n');
}

export function checksumMigration(conteudo) {
  return hash(normalizarQuebrasMigration(conteudo));
}

export function checksumsCompativeisMigration(conteudo) {
  const normalizado = normalizarQuebrasMigration(conteudo);
  return new Set([
    hash(normalizado),
    hash(normalizado.replaceAll('\n', '\r\n'))
  ]);
}
