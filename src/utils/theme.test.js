import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aplicarTema,
  criarVariaveisTema,
  normalizarConfiguracaoPublica
} from './theme.js';

test('normaliza o tema público e rejeita valores configuráveis inseguros', () => {
  const configuracao = normalizarConfiguracaoPublica({
    nomeLoja: '  Loja A  ',
    slug: 'loja-a',
    logo: 'javascript:alert(1)',
    banner: '/uploads/estabelecimentos/11/banner.webp',
    corPrincipal: '#a1b2c3',
    corSecundaria: 'azul',
    corFundo: '#121212',
    corCard: '#232323',
    corTexto: '#fefefe',
    fonte: 'Georgia',
    lojaAberta: true,
    entregaAtiva: 'true',
    areasEntrega: [null, { bairro: 'Centro', taxa: 5 }],
    formasPagamento: ['Pix', { nome: 'inseguro' }],
    bannerTitulo: '  O Verdadeiro Hambúrguer  ',
    bannerBotaoTexto: 'Peça agora',
    bannerBotaoDestino: 'javascript:alert(1)'
  });

  assert.equal(configuracao.nomeLoja, 'Loja A');
  assert.equal(configuracao.bannerTitulo, 'O Verdadeiro Hambúrguer');
  assert.equal(configuracao.bannerBotaoDestino, '');
  assert.equal(configuracao.logo, '');
  assert.equal(configuracao.banner, '/uploads/estabelecimentos/11/banner.webp');
  assert.equal(configuracao.corPrincipal, '#A1B2C3');
  assert.equal(configuracao.corSecundaria, '#0A0A0A');
  assert.equal(configuracao.fonte, 'Georgia');
  assert.equal(configuracao.lojaAberta, true);
  assert.equal(configuracao.entregaAtiva, false);
  assert.deepEqual(configuracao.areasEntrega, [{ bairro: 'Centro', taxa: 5 }]);
  assert.deepEqual(configuracao.formasPagamento, ['Pix']);
  assert.equal('css' in configuracao, false);
  assert.equal('javascript' in configuracao, false);
});

test('gera e aplica somente as variáveis CSS permitidas', () => {
  const valores = new Map();
  const elemento = {
    style: {
      setProperty(propriedade, valor) {
        valores.set(propriedade, valor);
      }
    }
  };
  const configuracao = {
    corPrincipal: '#101010',
    corSecundaria: '#202020',
    corFundo: '#303030',
    corCard: '#404040',
    corTexto: '#F0F0F0',
    fonte: 'Verdana',
    '--propriedade-arbitraria': 'red'
  };

  aplicarTema(elemento, configuracao);
  assert.deepEqual(Object.fromEntries(valores), criarVariaveisTema(configuracao));
  assert.equal(valores.get('--cor-principal'), '#101010');
  assert.equal(valores.get('--cor-sobre-principal'), '#FFFFFF');
  assert.equal(valores.get('--fonte-principal'), 'Verdana, sans-serif');
  assert.equal(valores.has('--propriedade-arbitraria'), false);
});
