import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHAVE_DADOS_CLIENTE,
  apagarDadosCliente,
  lerDadosCliente,
  normalizarDadosCliente,
  salvarDadosCliente
} from './dadosCliente.js';

function armazenamentoMemoria() {
  const valores = new Map();
  return {
    valores,
    getItem: (chave) => (valores.has(chave) ? valores.get(chave) : null),
    setItem: (chave, valor) => valores.set(chave, String(valor)),
    removeItem: (chave) => valores.delete(chave)
  };
}

test('guarda só contato e endereço, nunca pagamento, troco, token ou e-mail', () => {
  const armazenamento = armazenamentoMemoria();
  assert.equal(salvarDadosCliente({
    nome: 'Ana',
    telefone: '(11) 99999-0000',
    rua: 'Rua A',
    numero: '10',
    bairro: 'Centro',
    complemento: 'Apto 2',
    referencia: 'Perto da praça',
    areaEntregaId: 7,
    email: 'ana@exemplo.com',
    pagamento: 'Pix',
    trocoPara: 50,
    token: 'segredo',
    chaveIdempotencia: 'abc'
  }, armazenamento), true);

  const salvo = JSON.parse(armazenamento.valores.get(CHAVE_DADOS_CLIENTE));
  assert.deepEqual(Object.keys(salvo).sort(), [
    'areaEntregaId', 'bairro', 'complemento', 'nome', 'numero', 'referencia', 'rua', 'telefone'
  ]);
  assert.equal(salvo.areaEntregaId, '7');
  assert.deepEqual(lerDadosCliente(armazenamento), salvo);

  apagarDadosCliente(armazenamento);
  assert.equal(lerDadosCliente(armazenamento), null);
});

test('descarta valores de tipo errado, corta textos longos e aguenta armazenamento quebrado', () => {
  const dados = normalizarDadosCliente({ nome: { html: '<b>x</b>' }, rua: 'r'.repeat(500), areaEntregaId: '12abc' });
  assert.equal(dados.nome, '');
  assert.equal(dados.rua.length, 180);
  assert.equal(dados.areaEntregaId, '');
  assert.deepEqual(normalizarDadosCliente(null), normalizarDadosCliente([]));

  const invalido = armazenamentoMemoria();
  invalido.setItem(CHAVE_DADOS_CLIENTE, '{ não é json');
  assert.equal(lerDadosCliente(invalido), null);

  const bloqueado = {
    getItem() { throw new Error('bloqueado'); },
    setItem() { throw new Error('bloqueado'); },
    removeItem() { throw new Error('bloqueado'); }
  };
  assert.equal(lerDadosCliente(bloqueado), null);
  assert.equal(salvarDadosCliente({ nome: 'Ana' }, bloqueado), false);
  assert.doesNotThrow(() => apagarDadosCliente(bloqueado));
});
