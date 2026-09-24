import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aplicarTema,
  areaDoTema,
  criarVariaveisTema,
  ehAreaPublica,
  usaTemaClaro,
  normalizarConfiguracaoPublica
} from './theme.js';

test('usa o tema claro no cardápio, no painel e no garçom, e o escuro no superadmin', () => {
  assert.equal(usaTemaClaro('/'), true);
  assert.equal(usaTemaClaro('/finalizar-pedido'), true);
  assert.equal(usaTemaClaro('/admin/dashboard'), true);
  assert.equal(usaTemaClaro('/admin/login'), true);
  assert.equal(usaTemaClaro('/garcom/mesas'), true);
  assert.equal(usaTemaClaro('/superadmin/estabelecimentos'), false);
  assert.equal(usaTemaClaro('/administrativo'), true);
  assert.equal(ehAreaPublica('/admin/dashboard'), false);
  assert.equal(ehAreaPublica('/'), true);
});

test('marca a área de cada rota para o CSS', () => {
  assert.equal(areaDoTema('/'), 'publica');
  assert.equal(areaDoTema('/garcomzinho'), 'publica');
  assert.equal(areaDoTema('/admin/pedidos'), 'admin');
  assert.equal(areaDoTema('/garcom/acesso'), 'garcom');
  assert.equal(areaDoTema('/garcom/comanda/5'), 'garcom');
  assert.equal(areaDoTema('/superadmin/login'), 'painel');
});

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
    entregaPorArea: 'true',
    pedidoMinimo: 30,
    areasEntrega: [
      null,
      { id: 3, nome: '  Centro ', bairro: 'Centro', taxa: 5, tempoEstimadoMin: 30, tempoEstimadoMax: 45 },
      { id: 'x', nome: 'Sem id', taxa: 5, tempoEstimadoMin: 30, tempoEstimadoMax: 45 },
      { id: 4, nome: 'Tempo invertido', taxa: 5, tempoEstimadoMin: 50, tempoEstimadoMax: 40 },
      { id: 5, nome: '<b>Taxa negativa</b>', taxa: -3, tempoEstimadoMin: 10, tempoEstimadoMax: 10 }
    ],
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
  // Texto continua texto: o React escapa o nome ao renderizar.
  assert.deepEqual(configuracao.areasEntrega, [
    { id: 3, nome: 'Centro', taxa: 5, tempoEstimadoMin: 30, tempoEstimadoMax: 45 },
    { id: 5, nome: '<b>Taxa negativa</b>', taxa: 0, tempoEstimadoMin: 10, tempoEstimadoMax: 10 }
  ]);
  assert.equal(configuracao.entregaPorArea, false);
  assert.equal('pedidoMinimo' in configuracao, false);
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
