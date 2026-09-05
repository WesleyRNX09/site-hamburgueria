export const categoriasSeed = [
  { id: 1, nome: 'Hambúrgueres', ordem: 1 },
  { id: 2, nome: 'Combos', ordem: 2 },
  { id: 3, nome: 'Porções', ordem: 3 },
  { id: 4, nome: 'Bebidas', ordem: 4 }
];

export const adicionaisSeed = [
  { id: 1, nome: 'Bacon extra', precoCentavos: 500 },
  { id: 2, nome: 'Cheddar extra', precoCentavos: 400 },
  { id: 3, nome: 'Hambúrguer extra', precoCentavos: 1000 },
  { id: 4, nome: 'Ovo', precoCentavos: 300 },
  { id: 5, nome: 'Cebola caramelizada', precoCentavos: 400 },
  { id: 6, nome: 'Catupiry', precoCentavos: 600 }
];

export const produtosSeed = [
  {
    id: 1,
    nome: 'X-Bacon',
    categoriaId: 1,
    descricao: 'Pão brioche, hambúrguer artesanal, cheddar cremoso, bacon crocante, alface e tomate.',
    precoCentavos: 3490,
    destaque: 'Mais vendido',
    adicionaisIds: [1, 2, 3, 4, 5, 6]
  },
  {
    id: 2,
    nome: 'X-Salada',
    categoriaId: 1,
    descricao: 'Pão brioche, hambúrguer artesanal, queijo, alface, tomate e molho especial da casa.',
    precoCentavos: 2990,
    adicionaisIds: [1, 2, 3, 4, 5, 6]
  },
  {
    id: 3,
    nome: 'Duplo Bacon',
    categoriaId: 1,
    descricao: 'Dois hambúrgueres artesanais, cheddar duplo, bacon crocante e molho especial.',
    precoCentavos: 4290,
    destaque: 'Recomendado',
    adicionaisIds: [1, 2, 3, 4, 5, 6]
  },
  {
    id: 4,
    nome: 'X-Tudo',
    categoriaId: 1,
    descricao: 'Hambúrguer artesanal, queijo, bacon, ovo, presunto, alface, tomate e maionese.',
    precoCentavos: 3990,
    adicionaisIds: [1, 2, 3, 4, 5, 6]
  },
  {
    id: 5,
    nome: 'Combo X-Bacon',
    categoriaId: 2,
    descricao: 'X-Bacon acompanhado de batata frita e refrigerante.',
    precoCentavos: 4990,
    adicionaisIds: [1, 2, 3, 5, 6]
  },
  {
    id: 6,
    nome: 'Batata com Cheddar',
    categoriaId: 3,
    descricao: 'Batata frita crocante com cheddar cremoso e bacon.',
    precoCentavos: 2490,
    adicionaisIds: [1, 2, 6]
  },
  {
    id: 7,
    nome: 'Refrigerante',
    categoriaId: 4,
    descricao: 'Refrigerante gelado disponível em diversos sabores.',
    precoCentavos: 700,
    adicionaisIds: []
  }
];

export const promocoesSeed = [
  {
    id: 101,
    produtoId: 5,
    nome: 'Combo X-Bacon',
    categoria: 'Combos',
    descricao: 'X-Bacon artesanal + batata frita crocante + refrigerante.',
    precoAnteriorCentavos: 4990,
    precoCentavos: 4240,
    destaque: '15% OFF',
    tipo: 'COMBO ESPECIAL'
  },
  {
    id: 102,
    produtoId: 3,
    nome: 'Combo Duplo',
    categoria: 'Combos',
    descricao: '2 hambúrgueres artesanais + porção de fritas + 2 refrigerantes.',
    precoAnteriorCentavos: 7990,
    precoCentavos: 6990,
    destaque: 'MAIS PEDIDO',
    tipo: 'PARA COMPARTILHAR'
  },
  {
    id: 103,
    produtoId: 1,
    nome: 'X-Bacon em Dobro',
    categoria: 'Combos',
    descricao: 'Dois X-Bacon artesanais com muito cheddar e bacon crocante.',
    precoAnteriorCentavos: 7490,
    precoCentavos: 5990,
    destaque: '20% OFF',
    tipo: 'OFERTA DO DIA'
  },
  {
    id: 104,
    produtoId: 5,
    nome: 'Combo Família',
    categoria: 'Combos',
    descricao: '3 hambúrgueres artesanais + fritas grandes + refrigerante.',
    precoAnteriorCentavos: 11990,
    precoCentavos: 9990,
    destaque: 'ECONOMIZE',
    tipo: 'PARA A GALERA'
  },
  {
    id: 105,
    produtoId: 3,
    nome: 'Duplo Cheddar',
    categoria: 'Hambúrgueres',
    descricao: 'Hambúrguer duplo, cheddar cremoso e bacon crocante.',
    precoAnteriorCentavos: 4690,
    precoCentavos: 3990,
    destaque: '15% OFF',
    tipo: 'OFERTA ESPECIAL'
  }
];

export const funcionariosSeed = [
  { id: 1, nome: 'Carlos Silva', cargo: 'Garçom' },
  { id: 2, nome: 'Ana Souza', cargo: 'Garçonete' }
];

export const mesasSeed = Array.from({ length: 50 }, (_, indice) => ({
  id: indice + 1,
  numero: String(indice + 1).padStart(2, '0'),
  lugares: indice % 3 === 0 ? 6 : 4
}));

export const comandasSeed = [
  {
    id: 3,
    mesaId: 3,
    funcionarioId: 2,
    status: 'Na cozinha',
    abertaEm: '2026-08-18T18:42:00.000Z',
    itens: [
      { produtoId: 3, nome: 'Duplo Bacon', quantidade: 1, precoCentavos: 4290, adicionais: [] }
    ]
  },
  {
    id: 7,
    mesaId: 7,
    funcionarioId: 1,
    status: 'Aguardando',
    abertaEm: '2026-08-18T19:10:00.000Z',
    itens: [
      { produtoId: 5, nome: 'Combo X-Bacon', quantidade: 1, precoCentavos: 4990, adicionais: [] },
      { produtoId: 7, nome: 'Refrigerante', quantidade: 1, precoCentavos: 700, adicionais: [] }
    ]
  }
];

export const pedidosSeed = [
  {
    id: 1025,
    origem: 'mesa',
    cliente: 'Mesa 03',
    telefone: 'Atendimento presencial',
    status: 'Pronto',
    pagamento: 'Pix',
    taxaEntregaCentavos: 0,
    totalCentavos: 4290,
    comandaId: 3,
    mesaId: 3,
    funcionarioId: 2,
    criadoEm: '2026-08-18T18:58:00.000Z',
    itens: [
      { produtoId: 3, nome: 'Duplo Bacon', quantidade: 1, precoCentavos: 4290, adicionais: [] }
    ]
  },
  {
    id: 1026,
    origem: 'delivery',
    cliente: 'Marcos Lima',
    telefone: '(11) 99543-2340',
    email: 'marcos@email.com',
    status: 'Saiu para entrega',
    pagamento: 'Dinheiro',
    rua: 'Av. Central',
    numero: '450',
    bairro: 'Jardim América',
    taxaEntregaCentavos: 790,
    totalCentavos: 3780,
    criadoEm: '2026-08-18T18:42:00.000Z',
    itens: [
      { produtoId: 2, nome: 'X-Salada', quantidade: 1, precoCentavos: 2990, adicionais: [] }
    ]
  },
  {
    id: 1027,
    origem: 'mesa',
    cliente: 'Mesa 07',
    telefone: 'Atendimento presencial',
    status: 'Recebido',
    pagamento: 'Pix',
    taxaEntregaCentavos: 0,
    totalCentavos: 5690,
    comandaId: 7,
    mesaId: 7,
    funcionarioId: 1,
    criadoEm: '2026-08-18T19:28:00.000Z',
    itens: [
      { produtoId: 5, nome: 'Combo X-Bacon', quantidade: 1, precoCentavos: 4990, adicionais: [] },
      { produtoId: 7, nome: 'Refrigerante', quantidade: 1, precoCentavos: 700, adicionais: [] }
    ]
  },
  {
    id: 1028,
    origem: 'delivery',
    cliente: 'Rafael Oliveira',
    telefone: '(11) 98765-4321',
    email: 'rafael@email.com',
    status: 'Em preparo',
    pagamento: 'Cartão na entrega',
    rua: 'Rua das Palmeiras',
    numero: '123',
    bairro: 'Centro',
    taxaEntregaCentavos: 790,
    totalCentavos: 6770,
    criadoEm: '2026-08-18T19:32:00.000Z',
    itens: [
      { produtoId: 1, nome: 'X-Bacon', quantidade: 1, precoCentavos: 3490, adicionais: [] },
      { produtoId: 6, nome: 'Batata com Cheddar', quantidade: 1, precoCentavos: 2490, adicionais: [] }
    ]
  }
];

export const configuracaoSeed = {
  nomeLoja: '',
  telefone: '',
  email: '',
  endereco: '',
  taxaEntregaCentavos: 790,
  tempoEntrega: '35–45 min',
  pedidoMinimoCentavos: 2000,
  lojaAberta: true
};
