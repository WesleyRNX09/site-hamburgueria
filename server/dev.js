/*
  Ambiente de desenvolvimento: Vite no processo principal e a API em um
  processo separado, iniciado com `--watch-path=./server`.

  A separação é o que faz o backend reiniciar sozinho a cada alteração em
  `server/` sem derrubar o Vite. Rodar os dois no mesmo processo vigiado não
  funciona: o Vite grava o próprio cache dentro de `node_modules` ao subir, o
  watcher entende isso como mudança de dependência e reinicia em ciclo — e o
  processo anterior ainda segura a porta da API (EADDRINUSE).
*/
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer as criarServidorVite } from 'vite';

import { config } from './config.js';

const pastaServidor = dirname(fileURLToPath(import.meta.url));

/*
  Um `npm run dev` encerrado à força pode deixar a API órfã segurando a porta.
  Descobrir isso antes de subir o Vite evita um stack trace de EADDRINUSE no
  meio do log e já diz o que fazer.
*/
function portaOcupada(porta) {
  return new Promise((resolver) => {
    const socket = createConnection({ port: porta, host: '127.0.0.1' });
    const encerrar = (ocupada) => {
      socket.destroy();
      resolver(ocupada);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => encerrar(true));
    socket.once('timeout', () => encerrar(false));
    socket.once('error', () => encerrar(false));
  });
}

if (await portaOcupada(config.porta)) {
  console.error(
    `A porta ${config.porta} já está em uso — provavelmente por outro "npm run dev" `
    + 'ou por uma API que ficou aberta depois de um encerramento à força.'
    + `\nDescubra o processo com: netstat -ano | findstr :${config.porta}`
    + '\ne encerre-o com: taskkill /PID <pid> /T /F'
  );
  process.exit(1);
}

const vite = await criarServidorVite();
await vite.listen();

// A API herda o ambiente já carregado aqui (inclusive o .env do script npm).
const api = spawn(
  process.execPath,
  ['--watch-path=./server', resolve(pastaServidor, 'index.js')],
  { stdio: 'inherit', env: process.env }
);

console.log(`Backend da hamburgueria disponível em http://localhost:${config.porta}`);
console.log('API em modo watch: alterações em server/ reiniciam o backend sozinhas.');
vite.printUrls();

let encerrando = false;

async function encerrar(codigo = 0) {
  if (encerrando) return;
  encerrando = true;
  if (!api.killed) api.kill();
  await vite.close().catch(() => {});
  process.exit(codigo);
}

// Se a API morrer de vez (e não apenas reiniciar), o Vite sozinho não serve
// para nada: o comando inteiro se encerra junto.
api.on('exit', (codigo) => {
  if (!encerrando) encerrar(codigo ?? 0);
});

process.once('SIGINT', () => { encerrar(0); });
process.once('SIGTERM', () => { encerrar(0); });

// Última rede de proteção: qualquer saída do processo principal leva a API
// junto, para não deixar a porta presa por um processo órfão.
process.on('exit', () => {
  if (!api.killed) api.kill();
});
