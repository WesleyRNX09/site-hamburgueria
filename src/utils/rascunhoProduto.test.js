import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  caminhoVoltaProduto,
  chaveRascunho,
  descartarRascunhoProduto,
  recuperarRascunhoProduto,
  salvarRascunhoProduto
} from './rascunhoProduto.js';

function armazenamentoEmMemoria({ limite = Infinity } = {}) {
  const itens = new Map();
  return {
    itens,
    getItem: (chave) => (itens.has(chave) ? itens.get(chave) : null),
    setItem: (chave, valor) => {
      if (valor.length > limite) throw new Error('QuotaExceededError');
      itens.set(chave, valor);
    },
    removeItem: (chave) => itens.delete(chave)
  };
}

test('rascunho do produto sobrevive à ida aos adicionais e vale para uma volta só', () => {
  const armazenamento = armazenamentoEmMemoria();
  const dados = { nome: 'X-Bacon', descricao: 'Pão e bacon', preco: '34,90', adicionaisIds: [3], imagem: 'data:image/webp;base64,AAA' };

  assert.equal(salvarRascunhoProduto(undefined, dados, armazenamento), true);
  assert.deepEqual(recuperarRascunhoProduto(undefined, armazenamento), dados);
  // Lido uma vez, some: abrir o formulário de novo começa vazio.
  assert.equal(recuperarRascunhoProduto(undefined, armazenamento), null);
});

test('produto novo e cada produto em edição têm rascunhos separados', () => {
  const armazenamento = armazenamentoEmMemoria();
  salvarRascunhoProduto(undefined, { nome: 'Novo' }, armazenamento);
  salvarRascunhoProduto('7', { nome: 'Editado' }, armazenamento);
  assert.equal(chaveRascunho(undefined), 'rascunho-produto:novo');
  assert.equal(chaveRascunho('7'), 'rascunho-produto:7');
  assert.equal(recuperarRascunhoProduto('7', armazenamento).nome, 'Editado');
  assert.equal(recuperarRascunhoProduto(undefined, armazenamento).nome, 'Novo');
});

test('cota estourada guarda o rascunho sem a foto e falha total não quebra nada', () => {
  const comLimite = armazenamentoEmMemoria({ limite: 200 });
  const dados = { nome: 'X-Tudo', imagem: `data:image/webp;base64,${'A'.repeat(500)}` };
  assert.equal(salvarRascunhoProduto(undefined, dados, comLimite), true);
  assert.deepEqual(recuperarRascunhoProduto(undefined, comLimite), { nome: 'X-Tudo', imagem: '' });

  const quebrado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } };
  assert.equal(salvarRascunhoProduto(undefined, dados, quebrado), false);
  assert.equal(recuperarRascunhoProduto(undefined, quebrado), null);
  assert.doesNotThrow(() => descartarRascunhoProduto(undefined, quebrado));
  assert.equal(salvarRascunhoProduto(undefined, dados, null), false);
});

test('conteúdo inválido no armazenamento é ignorado', () => {
  const armazenamento = armazenamentoEmMemoria();
  for (const lixo of ['{quebrado', '"texto"', '[1,2]', 'null']) {
    armazenamento.setItem(chaveRascunho(undefined), lixo);
    assert.equal(recuperarRascunhoProduto(undefined, armazenamento), null, lixo);
  }
});

test('a volta dos adicionais só aceita o formulário de produto', () => {
  assert.equal(caminhoVoltaProduto('/admin/cardapio/novo'), '/admin/cardapio/novo');
  assert.equal(caminhoVoltaProduto('/admin/cardapio/12/editar'), '/admin/cardapio/12/editar');
  for (const invalido of ['/admin/cardapio', '/superadmin', 'https://exemplo.com/admin/cardapio/novo', '//exemplo.com', null, undefined, 42]) {
    assert.equal(caminhoVoltaProduto(invalido), null, String(invalido));
  }
});
