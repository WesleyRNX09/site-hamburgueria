/*
  Testes do recibo em ESC/POS. Não precisam de banco nem de rede: montam o
  recibo e leem os bytes que sairiam no papel.

  O que estes testes protegem: o texto do salão chegar legível na impressora
  (acento e pontuação transliterados, nunca lixo), o cabeçalho enxuto que a
  cozinha usa, e o negrito ficar só no título.
*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { montarRecibo } from './escpos.js';

const NEGRITO_LIGADO = '\x1bE\x01';

/* O agente escreve em latin1 depois de transliterar; ler de volta do mesmo
   jeito é o que mostra o que a impressora receberia. */
function papel(conteudo, id = 1) {
  return montarRecibo({ id, conteudo }).toString('latin1');
}

/* Uma linha de item é o caminho mais curto para ver um texto qualquer
   atravessar a transliteração inteira. */
function comoSaiNoPapel(texto) {
  const linhas = papel({
    origem: 'comanda',
    cabecalho: { numeroMesa: '1' },
    itens: [{ quantidade: 1, nome: texto }]
  }).split('\n');
  return linhas.find((linha) => linha.startsWith('1x '))?.slice(3) ?? '';
}

test('troca acento por letra sem acento, em maiúscula e minúscula', () => {
  assert.equal(comoSaiNoPapel('Ação'), 'Acao');
  assert.equal(comoSaiNoPapel('Pãozinho Crème Brûlée'), 'Paozinho Creme Brulee');
  assert.equal(comoSaiNoPapel('AÇAÍ ÓTIMO ÜBER'), 'ACAI OTIMO UBER');
  assert.equal(comoSaiNoPapel('Jalapeño'), 'Jalapeno');
});

test('texto que chega decomposto (NFD) sai igual ao composto (NFC)', () => {
  // Fora do teste isso vem de teclado ou sistema que guarda o acento separado
  // da letra; antes virava "Ac?a?o".
  const composto = 'Ação'.normalize('NFC');
  const decomposto = 'Ação'.normalize('NFD');
  assert.notEqual(composto, decomposto);
  assert.equal(comoSaiNoPapel(decomposto), 'Acao');
  assert.equal(comoSaiNoPapel(decomposto), comoSaiNoPapel(composto));
});

test('acento fora do português também é resolvido, sem tabela própria', () => {
  assert.equal(comoSaiNoPapel('Tōkyō'), 'Tokyo');
  assert.equal(comoSaiNoPapel('Łukasz Dvořák'), '?ukasz Dvorak');
});

test('pontuação tipográfica vira o equivalente em ASCII', () => {
  // O travessão é o caso que aparecia no papel como "?".
  assert.equal(comoSaiNoPapel('Ana — alergia'), 'Ana - alergia');
  assert.equal(comoSaiNoPapel('Ana – alergia'), 'Ana - alergia');
  assert.equal(comoSaiNoPapel('aspas “curvas” e ‘simples’'), 'aspas "curvas" e \'simples\'');
  assert.equal(comoSaiNoPapel('do cliente’s'), "do cliente's");
  assert.equal(comoSaiNoPapel('esperar…'), 'esperar...');
  assert.equal(comoSaiNoPapel('1º andar, 2ª rua'), '1o andar, 2a rua');
  assert.equal(comoSaiNoPapel('2 × 100 g ± 5'), '2 x 100 g +/- 5');
  assert.equal(comoSaiNoPapel('carne a 60° e ½ porção'), 'carne a 60o e 1/2 porcao');
});

test('espaço especial vira espaço comum e o de largura zero some', () => {
  assert.equal(comoSaiNoPapel('sem cebola'), 'sem cebola');
  assert.equal(comoSaiNoPapel('sem​cebola'), 'semcebola');
});

test('caractere sem equivalente vira um único "?", não lixo binário', () => {
  // Emoji ocupa dois code units em UTF-16: contar por ponto de código evita
  // que um só emoji vire "??" no papel.
  assert.equal(comoSaiNoPapel('mesa 🎉 festa'), 'mesa ? festa');
  assert.equal(comoSaiNoPapel('中'), '?');
});

test('a transliteração não muda o que já é ASCII', () => {
  const original = 'X-Bacon (2x) - R$ 25,00 #12 @mesa';
  assert.equal(comoSaiNoPapel(original), original);
});

test('a largura do papel conta o texto já transliterado', () => {
  /* "…" ocupa uma coluna antes da troca e três depois. Com 28 letras a linha
     fecharia em exatamente 42 colunas se a conta fosse feita antes — então a
     quebra aqui prova que ela é feita depois, e nada estoura o papel. */
  const palavra = 'a'.repeat(28);
  const ticket = papel({
    origem: 'comanda',
    cabecalho: { numeroMesa: '1', observacaoComanda: `${palavra}…` }
  });
  assert.ok(ticket.includes('OBS DA MESA:\n'), ticket);
  assert.ok(ticket.includes(`  ${palavra}...\n`), ticket);
});

test('o título da comanda leva o número da mesa e é o único negrito', () => {
  const ticket = papel({
    origem: 'comanda',
    cabecalho: { numeroMesa: '07', mesa: 'Mesa 07', garcom: 'Ana', observacaoComanda: 'alergia' },
    itens: [{ quantidade: 2, nome: 'X-Bacon', observacao: 'sem cebola' }]
  });
  assert.ok(ticket.includes(`${NEGRITO_LIGADO}COMANDA 07`), ticket);
  assert.equal(ticket.split(NEGRITO_LIGADO).length - 1, 1, ticket);
  // Cabeçalho enxuto: nada de linha "Comanda #", "Mesa", "Setor" ou "Trabalho".
  assert.equal(ticket.includes('Comanda #'), false, ticket);
  assert.equal(/^Mesa /m.test(ticket), false, ticket);
  assert.equal(ticket.includes('Setor:'), false, ticket);
  assert.equal(ticket.includes('Trabalho #'), false, ticket);
  // O que a cozinha precisa continua lá.
  assert.ok(ticket.includes('Garcom: Ana'), ticket);
  assert.ok(ticket.includes('OBS DA MESA: alergia'), ticket);
  assert.ok(ticket.includes('2x X-Bacon'), ticket);
  assert.ok(ticket.includes('OBS: sem cebola'), ticket);
});

test('sem número da mesa o título continua sendo COMANDA', () => {
  // Trabalho gravado antes desta mudança e ainda na fila.
  const ticket = papel({ origem: 'comanda', cabecalho: { mesa: 'Mesa 9' }, itens: [] });
  assert.ok(ticket.includes(`${NEGRITO_LIGADO}COMANDA\n`), ticket);
});

test('o recibo de delivery não leva pagamento nem setor', () => {
  const ticket = papel({
    origem: 'delivery',
    impressora: 'Cozinha',
    cabecalho: {
      pedido: '#PED0042',
      modalidade: 'Entrega',
      cliente: 'Cliente Teste',
      telefone: '(11) 90000-0000',
      endereco: 'Rua do Teste, 10 - Centro',
      pagamento: 'Cartão na entrega'
    },
    itens: [{ quantidade: 1, nome: 'X-Salada' }]
  });
  // Mesmo com o campo antigo no JSON, ele não vai para o papel.
  assert.equal(/Pagamento/i.test(ticket), false, ticket);
  assert.equal(ticket.includes('Setor:'), false, ticket);
  assert.equal(ticket.split(NEGRITO_LIGADO).length - 1, 1, ticket);
  assert.ok(ticket.includes(`${NEGRITO_LIGADO}PEDIDO`), ticket);
  assert.ok(ticket.includes('Cliente: Cliente Teste'), ticket);
});

test('nenhum recibo leva preço: quem monta o prato não cobra', () => {
  const ticket = papel({
    origem: 'comanda',
    cabecalho: { numeroMesa: '3' },
    itens: [{ quantidade: 1, nome: 'X-Bacon', adicionais: ['Cheddar'] }]
  });
  assert.equal(/R\$|\d+,\d{2}/.test(ticket), false, ticket);
});
