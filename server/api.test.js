import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import mysql from 'mysql2/promise';

import { criarLimitadorTentativas, criarServidor, personalizarIndexHtml } from './app.js';
import { listarCatalogo, precoParaCentavos } from './catalog.js';
import { fecharBanco, prepararBanco } from './database.js';
import { checksumMigration, checksumsCompativeisMigration } from './db/migration-utils.js';
import { removerImagemLocal, salvarImagemDataUrl } from './imageStore.js';
import {
  buscarConfiguracaoPublica,
  buscarItensValidados,
  calcularTotaisPedido,
  salvarConfiguracao
} from './operations.js';
import { aguardarServidor, fecharServidor } from './runtime.js';
import { adicionaisSeed, mesasSeed, pedidosSeed, produtosSeed } from './seed.js';
import { criarHashSenha, criarJwt, verificarJwt } from './security.js';
import {
  criarEstabelecimentoGerencial,
  listarEstabelecimentosGerenciais
} from './superadmin.js';
import {
  extrairHostname,
  identificarEstabelecimentoPeloHost,
  resolverEstabelecimento
} from './tenant.js';

const JWT_SECRET_TESTE = 'segredo-jwt-exclusivo-para-testes-com-mais-de-32-bytes';

test('converte preços brasileiros e decimais para centavos', () => {
  assert.equal(precoParaCentavos('34,90'), 3490);
  assert.equal(precoParaCentavos('1.234,56'), 123456);
  assert.equal(precoParaCentavos(7.9), 790);
});

test('injeta metadados reais da loja no HTML de produção sem permitir markup', () => {
  const modelo = '<title>Anterior</title><meta name="description" content="" /><meta property="og:title" content="" /><meta property="og:description" content="" /><meta property="og:url" content="" /><meta property="og:image" content="" /><meta name="twitter:title" content="" /><meta name="twitter:description" content="" />';
  const html = personalizarIndexHtml(modelo, {
    nomeLoja: 'Loja <Segura>',
    logo: '/uploads/logo.webp'
  }, 'https://pedidos.teste.local/');
  assert.match(html, /Loja &lt;Segura&gt; \| Cardápio e pedidos/);
  assert.match(html, /https:\/\/pedidos\.teste\.local\/uploads\/logo\.webp/);
  assert.equal(html.includes('<Segura>'), false);
});

test('mantém o checksum das migrations estável entre Windows e Linux', () => {
  const conteudoLf = '-- migration\nSELECT 1;\n';
  const conteudoCrlf = conteudoLf.replaceAll('\n', '\r\n');
  const hashEstavel = checksumMigration(conteudoLf);
  assert.equal(checksumMigration(conteudoCrlf), hashEstavel);
  assert.equal(checksumsCompativeisMigration(conteudoLf).has(hashEstavel), true);
  assert.equal(
    checksumsCompativeisMigration(conteudoLf).has(
      'c80b7f806b2e8aa9aacd72ee09f922b2854eb66323e92cff7b0bfe111cdc0e29'
    ),
    false
  );
});

test('isola imagens por estabelecimento e não remove arquivos de outro tenant', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'hamburgueria-banner-'));
  const pngMinimo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  try {
    const url = await salvarImagemDataUrl(pngMinimo, pasta, 11, 'banner');
    assert.match(url, /^\/uploads\/estabelecimentos\/11\/banner-[a-f0-9-]+\.png$/);
    await stat(join(pasta, url.slice('/uploads/'.length)));
    assert.equal(await removerImagemLocal(url, pasta, 22), false);
    await stat(join(pasta, url.slice('/uploads/'.length)));
    assert.equal(await removerImagemLocal(url, pasta, 11), true);
    await assert.rejects(stat(join(pasta, url.slice('/uploads/'.length))), { code: 'ENOENT' });
    await assert.rejects(salvarImagemDataUrl(pngMinimo, pasta, 11, 'script'), /tipo da imagem/);
    await assert.rejects(salvarImagemDataUrl(pngMinimo, pasta, '../12', 'banner'), /estabelecimento/);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test('serve uploads somente no host do estabelecimento proprietário', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'hamburgueria-uploads-tenants-'));
  const pngMinimo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  const urlA = await salvarImagemDataUrl(pngMinimo, pasta, 11, 'logo');
  const urlB = await salvarImagemDataUrl(pngMinimo, pasta, 22, 'produto');
  const nomeLegado = `logo-${randomUUID()}.png`;
  const urlLegada = `/uploads/${nomeLegado}`;
  await writeFile(join(pasta, nomeLegado), Buffer.from('89504e470d0a1a0a', 'hex'));
  const estabelecimentos = new Map([
    ['loja-a', { id_estabelecimento: 11, nome_fantasia: 'Loja A', slug: 'loja-a' }],
    ['loja-b', { id_estabelecimento: 22, nome_fantasia: 'Loja B', slug: 'loja-b' }]
  ]);
  const banco = {
    async execute(sql, parametros) {
      if (sql.includes('FROM estabelecimentos AS e')) {
        const estabelecimento = estabelecimentos.get(parametros[0]);
        return [[estabelecimento && {
          ...estabelecimento,
          dominio_personalizado: null,
          status: 'ativo',
          plano: 'basico',
          status_assinatura: 'ativa',
          vencimento_assinatura_em: null
        }].filter(Boolean)];
      }
      if (sql.includes('FROM configuracoes_estabelecimento ce') && sql.includes('UNION ALL')) {
        const permitido = Number(parametros[0]) === 11 && parametros[1] === urlLegada;
        return [[permitido ? { permitido: 1 } : null].filter(Boolean)];
      }
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };
  const servidorA = criarServidor({ banco, pastaUploads: pasta, tenantDesenvolvimento: 'loja-a' });
  const servidorB = criarServidor({ banco, pastaUploads: pasta, tenantDesenvolvimento: 'loja-b' });

  try {
    await Promise.all([aguardarServidor(servidorA, 0), aguardarServidor(servidorB, 0)]);
    const baseA = `http://127.0.0.1:${servidorA.address().port}`;
    const baseB = `http://127.0.0.1:${servidorB.address().port}`;
    const [propriaA, cruzadaA, propriaB, legadaA, legadaB] = await Promise.all([
      fetch(`${baseA}${urlA}`),
      fetch(`${baseB}${urlA}`),
      fetch(`${baseB}${urlB}`),
      fetch(`${baseA}${urlLegada}`),
      fetch(`${baseB}${urlLegada}`)
    ]);
    assert.equal(propriaA.status, 200);
    assert.equal(propriaA.headers.get('content-type'), 'image/png');
    assert.equal(cruzadaA.status, 404);
    assert.equal(propriaB.status, 200);
    assert.equal(legadaA.status, 200);
    assert.equal(legadaB.status, 404);
  } finally {
    await Promise.all([fecharServidor(servidorA), fecharServidor(servidorB)]);
    await rm(pasta, { recursive: true, force: true });
  }
});

test('identifica o estabelecimento somente pelo host da requisição', () => {
  assert.equal(extrairHostname('Loja-A.Exemplo.com:443'), 'loja-a.exemplo.com');
  assert.deepEqual(
    identificarEstabelecimentoPeloHost('loja-a.exemplo.com', {
      dominioPrincipal: 'exemplo.com'
    }),
    { tipo: 'slug', valor: 'loja-a' }
  );
  assert.deepEqual(
    identificarEstabelecimentoPeloHost('pedidos.loja.com', {
      dominioPrincipal: 'exemplo.com'
    }),
    { tipo: 'dominio', valor: 'pedidos.loja.com' }
  );
  assert.deepEqual(
    identificarEstabelecimentoPeloHost('127.0.0.1:3001', {
      tenantDesenvolvimento: 'estabelecimento-padrao'
    }),
    { tipo: 'slug', valor: 'estabelecimento-padrao' }
  );
});

test('resolve dois tenants independentes pelo domínio sem aceitar ID do cliente', async () => {
  const tenants = new Map([
    ['loja-a', { id_estabelecimento: 11, nome_fantasia: 'Loja A', slug: 'loja-a' }],
    ['loja-b', { id_estabelecimento: 22, nome_fantasia: 'Loja B', slug: 'loja-b' }]
  ]);
  const banco = {
    async execute(sql, parametros) {
      assert.match(sql, /FROM estabelecimentos/i);
      const estabelecimento = tenants.get(parametros[0]);
      return [[estabelecimento && {
        ...estabelecimento,
        dominio_personalizado: null,
        status: 'ativo',
        plano: 'basico',
        status_assinatura: 'ativa',
        vencimento_assinatura_em: null
      }].filter(Boolean)];
    }
  };
  const opcoes = { dominioPrincipal: 'exemplo.com' };
  const lojaA = await resolverEstabelecimento(
    banco,
    { headers: { host: 'loja-a.exemplo.com' }, idEstabelecimento: 22 },
    opcoes
  );
  const lojaB = await resolverEstabelecimento(
    banco,
    { headers: { host: 'loja-b.exemplo.com' }, idEstabelecimento: 11 },
    opcoes
  );
  assert.equal(lojaA.id, 11);
  assert.equal(lojaB.id, 22);
});

test('mantém o catálogo de dois tenants separado em todas as consultas', async () => {
  const nomes = new Map([[11, 'Produto A'], [22, 'Produto B']]);
  const banco = {
    async execute(sql, parametros) {
      const idEstabelecimento = Number(parametros[0]);
      assert.ok(nomes.has(idEstabelecimento));
      if (sql.includes('FROM categorias')) {
        return [[{ id: idEstabelecimento, nome: `Categoria ${idEstabelecimento}`, ordem: 1, ativo: 1 }]];
      }
      if (sql.includes('FROM adicionais')) return [[]];
      if (sql.includes('FROM produtos p')) {
        return [[{
          id: idEstabelecimento,
          categoria_id: idEstabelecimento,
          nome: nomes.get(idEstabelecimento),
          categoria: `Categoria ${idEstabelecimento}`,
          descricao: 'Descrição',
          preco_centavos: 1000,
          imagem_url: null,
          destaque: null,
          ativo: 1
        }]];
      }
      if (sql.includes('FROM produto_adicionais')) return [[]];
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };
  const [catalogoA, catalogoB] = await Promise.all([
    listarCatalogo(banco, 11),
    listarCatalogo(banco, 22)
  ]);
  assert.equal(catalogoA.produtos[0].nome, 'Produto A');
  assert.equal(catalogoB.produtos[0].nome, 'Produto B');
});

test('publica somente configurações seguras do tenant resolvido pelo domínio', async () => {
  const estabelecimentos = new Map([
    ['loja-a', {
      id_estabelecimento: 11,
      nome_fantasia: 'Loja A',
      slug: 'loja-a',
      status: 'ativo'
    }],
    ['loja-b', {
      id_estabelecimento: 22,
      nome_fantasia: 'Loja B',
      slug: 'loja-b',
      status: 'ativo'
    }],
    ['loja-inativa', {
      id_estabelecimento: 33,
      nome_fantasia: 'Loja inativa',
      slug: 'loja-inativa',
      status: 'inativo'
    }]
  ]);
  const configuracoes = new Map([
    [11, {
      nome_loja: 'Loja A',
      slug: 'loja-a',
      logo_url: '/uploads/loja-a/logo.webp',
      banner_url: 'https://cdn.exemplo.com/loja-a/banner.webp',
      banner_titulo: 'O Verdadeiro Hambúrguer Artesanal',
      banner_subtitulo: 'Carne grelhada na hora, sempre fresca.',
      banner_botao_texto: 'Peça agora',
      banner_botao_destino: 'cardapio',
      titulo_cardapio: 'Nosso cardápio',
      texto_apresentacao: 'Escolha o seu hambúrguer favorito.',
      titulo_sobre: 'Hambúrguer de verdade, feito do nosso jeito.',
      texto_sobre: 'Ingredientes selecionados e preparo na hora.',
      mensagem_rodape: 'Feito com carinho para você.',
      cor_principal: '#a1b2c3',
      cor_secundaria: '#0A0A0A',
      cor_fundo: '#111111',
      cor_card: '#181818',
      cor_texto: '#FFFFFF',
      fonte: 'Georgia',
      telefone: '(11) 4000-0000',
      whatsapp: '(11) 98888-0000',
      email: 'contato@loja-a.local',
      endereco: 'Rua A, 10',
      horario_funcionamento: 'Todos os dias, das 18h às 23h',
      instagram_url: 'https://instagram.com/loja-a',
      facebook_url: '',
      loja_aberta: 1,
      pedido_minimo_centavos: 2500,
      taxa_entrega_centavos: 700,
      tempo_entrega: '30–45 min',
      pix_chave: 'pix-loja-a',
      pix_beneficiario: 'LOJA A',
      pix_cidade: 'SAO PAULO',
      entrega_ativa: 1,
      retirada_ativa: 1,
      atendimento_garcom_ativo: 0,
      aceita_cartao: 1,
      aceita_dinheiro: 1,
      areas_entrega_json: JSON.stringify([
        { bairro: 'Centro', taxaCentavos: 500 },
        null,
        { bairro: 'Taxa inválida', taxaCentavos: -1 },
        { bairro: 'centro', taxaCentavos: 900 }
      ]),
      formas_pagamento_json: JSON.stringify(['Pix', 'Dinheiro', 'Pix', 'Pagamento arbitrário']),
      politica_cancelamento: 'Cancelamentos devem ser solicitados antes do preparo.',
      informacoes_legais: 'Informações legais da Loja A.',
      segredo_interno: 'não publicar'
    }],
    [22, {
      nome_loja: 'Loja B',
      slug: 'loja-b',
      logo_url: 'javascript:alert(1)',
      banner_url: '//dominio-inseguro.exemplo/banner.webp',
      banner_titulo: null,
      banner_subtitulo: null,
      banner_botao_texto: 'Clique aqui',
      banner_botao_destino: 'javascript:alert(1)',
      titulo_cardapio: null,
      texto_apresentacao: null,
      titulo_sobre: null,
      texto_sobre: null,
      mensagem_rodape: null,
      cor_principal: 'amarelo',
      cor_secundaria: null,
      cor_fundo: null,
      cor_card: null,
      cor_texto: null,
      fonte: 'Fonte não permitida',
      telefone: '',
      whatsapp: '',
      email: '',
      endereco: '',
      horario_funcionamento: '',
      instagram_url: 'javascript:alert(1)',
      facebook_url: '',
      loja_aberta: 0,
      pedido_minimo_centavos: 0,
      taxa_entrega_centavos: 0,
      tempo_entrega: '',
      pix_chave: null,
      pix_beneficiario: null,
      pix_cidade: null,
      entrega_ativa: 0,
      retirada_ativa: 1,
      atendimento_garcom_ativo: 1,
      aceita_cartao: 0,
      aceita_dinheiro: 1,
      areas_entrega_json: 'JSON inválido',
      formas_pagamento_json: null,
      politica_cancelamento: null,
      informacoes_legais: null
    }]
  ]);
  let consultasConfiguracaoInativa = 0;
  const banco = {
    async execute(sql, parametros) {
      if (sql.includes('FROM estabelecimentos AS e')) {
        const estabelecimento = estabelecimentos.get(parametros[0]);
        return [[estabelecimento && {
          ...estabelecimento,
          dominio_personalizado: null,
          plano: 'basico',
          status_assinatura: 'ativa',
          vencimento_assinatura_em: null
        }].filter(Boolean)];
      }
      if (sql.includes('INNER JOIN configuracoes_estabelecimento ce')) {
        assert.equal(/SELECT\s+\*/i.test(sql), false);
        const idEstabelecimento = Number(parametros[0]);
        if (idEstabelecimento === 33) consultasConfiguracaoInativa += 1;
        return [[configuracoes.get(idEstabelecimento)].filter(Boolean)];
      }
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };
  const servidores = [
    criarServidor({ banco, pastaUploads: tmpdir(), tenantDesenvolvimento: 'loja-a' }),
    criarServidor({ banco, pastaUploads: tmpdir(), tenantDesenvolvimento: 'loja-b' }),
    criarServidor({ banco, pastaUploads: tmpdir(), tenantDesenvolvimento: 'loja-inativa' })
  ];

  try {
    await Promise.all(servidores.map((servidor) => aguardarServidor(servidor, 0)));
    const urls = servidores.map((servidor) => `http://127.0.0.1:${servidor.address().port}`);
    const [respostaA, respostaB, respostaInativa] = await Promise.all([
      fetch(`${urls[0]}/api/publico/configuracao?id_estabelecimento=22`),
      fetch(`${urls[1]}/api/publico/configuracao`),
      fetch(`${urls[2]}/api/publico/configuracao`)
    ]);
    const configuracaoA = (await respostaA.json()).configuracao;
    const configuracaoB = (await respostaB.json()).configuracao;

    assert.equal(respostaA.status, 200);
    assert.equal(respostaA.headers.get('cache-control'), 'no-store');
    assert.equal(configuracaoA.nomeLoja, 'Loja A');
    assert.equal(configuracaoA.slug, 'loja-a');
    assert.equal(configuracaoA.corPrincipal, '#A1B2C3');
    assert.equal(configuracaoA.fonte, 'Georgia');
    assert.deepEqual(configuracaoA.formasPagamento, ['Pix', 'Dinheiro']);
    assert.deepEqual(configuracaoA.areasEntrega, [{ bairro: 'Centro', taxa: 5 }]);
    assert.equal('segredoInterno' in configuracaoA, false);
    assert.equal('idEstabelecimento' in configuracaoA, false);
    assert.equal(configuracaoA.bannerTitulo, 'O Verdadeiro Hambúrguer Artesanal');
    assert.equal(configuracaoA.bannerBotaoTexto, 'Peça agora');
    assert.equal(configuracaoA.bannerBotaoDestino, 'cardapio');
    assert.equal(configuracaoA.tituloSobre, 'Hambúrguer de verdade, feito do nosso jeito.');

    assert.equal(respostaB.status, 200);
    assert.equal(configuracaoB.nomeLoja, 'Loja B');
    assert.equal(configuracaoB.logo, '');
    assert.equal(configuracaoB.banner, '');
    assert.equal(configuracaoB.instagramUrl, '');
    assert.equal(configuracaoB.corPrincipal, '#FFC107');
    assert.equal(configuracaoB.fonte, 'Poppins');
    assert.deepEqual(configuracaoB.formasPagamento, ['Dinheiro']);
    assert.deepEqual(configuracaoB.areasEntrega, []);
    assert.equal(configuracaoB.bannerBotaoTexto, 'Clique aqui');
    assert.equal(configuracaoB.bannerBotaoDestino, '');
    assert.equal(configuracaoB.bannerTitulo, '');

    assert.equal(respostaInativa.status, 403);
    assert.equal(consultasConfiguracaoInativa, 0);
  } finally {
    await Promise.all(servidores.map(fecharServidor));
  }

  const configuracaoDireta = await buscarConfiguracaoPublica(banco, 11);
  assert.equal(configuracaoDireta.nomeLoja, 'Loja A');
  assert.equal('segredo_interno' in configuracaoDireta, false);
});

test('salva toda a configuração somente no tenant autenticado e valida o tema', async () => {
  const comandos = [];
  let conexoesAbertas = 0;
  const conexao = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, parametros) {
      comandos.push({ sql, parametros });
      return [{ affectedRows: 1 }];
    }
  };
  const linhaSalva = {
    nome_loja: 'Loja A renovada',
    slug: 'loja-a',
    logo_url: '/uploads/logo-segura.webp',
    banner_url: '/uploads/banner-seguro.webp',
    banner_titulo: 'O Verdadeiro Hambúrguer Artesanal',
    banner_subtitulo: 'Carne grelhada na hora, sempre fresca.',
    banner_botao_texto: 'Peça agora',
    banner_botao_destino: 'cardapio',
    titulo_cardapio: 'Nosso cardápio',
    texto_apresentacao: 'Escolha o seu hambúrguer favorito.',
    titulo_sobre: 'Hambúrguer de verdade, feito do nosso jeito.',
    texto_sobre: 'Ingredientes selecionados e preparo na hora.',
    mensagem_rodape: 'Feito com carinho para você.',
    cor_principal: '#E95420',
    cor_secundaria: '#120B0B',
    cor_fundo: '#1C1010',
    cor_card: '#2A1717',
    cor_texto: '#FFF7F3',
    fonte: 'Georgia',
    telefone: '(11) 4000-0000',
    whatsapp: '(11) 98888-0000',
    email: 'contato@loja-a.local',
    endereco: 'Rua A, 10',
    horario_funcionamento: 'Todos os dias, das 18h às 23h',
    instagram_url: 'https://instagram.com/loja-a',
    facebook_url: null,
    loja_aberta: 1,
    pedido_minimo_centavos: 2500,
    taxa_entrega_centavos: 700,
    tempo_entrega: '30–45 min',
    pix_chave: null,
    pix_beneficiario: null,
    pix_cidade: null,
    entrega_ativa: 1,
    retirada_ativa: 1,
    atendimento_garcom_ativo: 1,
    aceita_cartao: 1,
    aceita_dinheiro: 1,
    areas_entrega_json: JSON.stringify([{ bairro: 'Centro', taxaCentavos: 500 }]),
    formas_pagamento_json: JSON.stringify(['Cartão', 'Dinheiro']),
    politica_cancelamento: 'Cancelamento antes do preparo.',
    informacoes_legais: 'Informações legais da Loja A.'
  };
  const banco = {
    async getConnection() {
      conexoesAbertas += 1;
      return conexao;
    },
    async execute(sql, parametros) {
      assert.match(sql, /INNER JOIN configuracoes_estabelecimento ce/i);
      assert.deepEqual(parametros, [11]);
      return [[linhaSalva]];
    }
  };
  const dados = {
    nomeLoja: linhaSalva.nome_loja,
    logo: linhaSalva.logo_url,
    banner: linhaSalva.banner_url,
    bannerTitulo: linhaSalva.banner_titulo,
    bannerSubtitulo: linhaSalva.banner_subtitulo,
    bannerBotaoTexto: linhaSalva.banner_botao_texto,
    bannerBotaoDestino: linhaSalva.banner_botao_destino,
    tituloCardapio: linhaSalva.titulo_cardapio,
    textoApresentacao: linhaSalva.texto_apresentacao,
    tituloSobre: linhaSalva.titulo_sobre,
    textoSobre: linhaSalva.texto_sobre,
    mensagemRodape: linhaSalva.mensagem_rodape,
    corPrincipal: linhaSalva.cor_principal,
    corSecundaria: linhaSalva.cor_secundaria,
    corFundo: linhaSalva.cor_fundo,
    corCard: linhaSalva.cor_card,
    corTexto: linhaSalva.cor_texto,
    fonte: linhaSalva.fonte,
    telefone: linhaSalva.telefone,
    whatsapp: linhaSalva.whatsapp,
    email: linhaSalva.email,
    endereco: linhaSalva.endereco,
    horarioFuncionamento: linhaSalva.horario_funcionamento,
    instagramUrl: linhaSalva.instagram_url,
    facebookUrl: '',
    lojaAberta: true,
    pedidoMinimo: 25,
    taxaEntrega: 7,
    tempoEntrega: linhaSalva.tempo_entrega,
    pixChave: '',
    pixBeneficiario: '',
    pixCidade: '',
    entregaAtiva: true,
    retiradaAtiva: true,
    atendimentoGarcomAtivo: true,
    aceitaCartao: true,
    aceitaDinheiro: true,
    areasEntrega: [{ bairro: 'Centro', taxa: 5 }],
    formasPagamento: ['forma arbitrária'],
    politicaCancelamento: linhaSalva.politica_cancelamento,
    informacoesLegais: linhaSalva.informacoes_legais,
    idEstabelecimento: 22
  };

  const configuracao = await salvarConfiguracao(banco, 11, dados, 7);
  assert.equal(configuracao.nomeLoja, 'Loja A renovada');
  assert.equal(configuracao.atendimentoGarcomAtivo, true);
  assert.deepEqual(configuracao.formasPagamento, ['Cartão', 'Dinheiro']);
  assert.equal(configuracao.bannerTitulo, 'O Verdadeiro Hambúrguer Artesanal');
  assert.equal(configuracao.bannerBotaoDestino, 'cardapio');
  assert.equal(configuracao.tituloSobre, 'Hambúrguer de verdade, feito do nosso jeito.');

  const gravacao = comandos.find(({ sql }) => sql.includes('INSERT INTO configuracoes_estabelecimento'));
  assert.ok(gravacao);
  assert.equal(/SELECT\s+\*/i.test(gravacao.sql), false);
  assert.equal(gravacao.parametros[0], 11);
  assert.equal(gravacao.parametros.includes(22), false);
  assert.equal(gravacao.parametros[12], '/uploads/banner-seguro.webp');
  assert.equal(gravacao.parametros[13], 'O Verdadeiro Hambúrguer Artesanal');
  assert.equal(gravacao.parametros[14], 'Carne grelhada na hora, sempre fresca.');
  assert.equal(gravacao.parametros[15], 'Peça agora');
  assert.equal(gravacao.parametros[16], 'cardapio');
  assert.equal(gravacao.parametros[17], 'Nosso cardápio');
  assert.equal(gravacao.parametros[18], 'Escolha o seu hambúrguer favorito.');
  assert.equal(gravacao.parametros[19], 'Hambúrguer de verdade, feito do nosso jeito.');
  assert.equal(gravacao.parametros[20], 'Ingredientes selecionados e preparo na hora.');
  assert.equal(gravacao.parametros[21], 'Feito com carinho para você.');
  assert.deepEqual(JSON.parse(gravacao.parametros[38]), ['Cartão', 'Dinheiro']);
  assert.equal(gravacao.parametros[39], 'Cancelamento antes do preparo.');
  assert.equal(gravacao.parametros[40], 'Informações legais da Loja A.');

  const auditoria = comandos.find(({ sql }) => sql.includes('INSERT INTO auditoria_admin'));
  assert.deepEqual(auditoria.parametros.slice(0, 5), [11, 7, 'configuracao.atualizada', 'configuracao', '11']);

  await assert.rejects(
    salvarConfiguracao(banco, 11, { ...dados, corPrincipal: 'vermelho' }, 7),
    /cores válidas/
  );
  await assert.rejects(
    salvarConfiguracao(banco, 11, { ...dados, fonte: 'Comic Sans' }, 7),
    /fonte permitida/
  );
  await assert.rejects(
    salvarConfiguracao(banco, 11, { ...dados, bannerBotaoDestino: 'https://externo.exemplo/' }, 7),
    /destino válido/
  );
  await assert.rejects(
    salvarConfiguracao(banco, 11, { ...dados, bannerBotaoTexto: '' }, 7),
    /texto e o destino do botão/
  );
  await assert.rejects(
    salvarConfiguracao(banco, 11, { ...dados, bannerBotaoDestino: '' }, 7),
    /texto e o destino do botão/
  );
  await salvarConfiguracao(banco, 11, { ...dados, bannerBotaoTexto: '', bannerBotaoDestino: '' }, 7);
  const gravacoes = comandos.filter(({ sql }) => sql.includes('INSERT INTO configuracoes_estabelecimento'));
  const ultimaGravacao = gravacoes[gravacoes.length - 1];
  assert.equal(ultimaGravacao.parametros[15], null);
  assert.equal(ultimaGravacao.parametros[16], null);
  assert.equal(conexoesAbertas, 2);
});

test('assina JWT com perfil e tenant e rejeita adulteração ou expiração', () => {
  const agoraMs = Date.UTC(2026, 7, 26, 12, 0, 0);
  const token = criarJwt({
    idUsuario: 7,
    perfil: 'administrador',
    idEstabelecimento: 11,
    duracaoMs: 60_000,
    segredo: JWT_SECRET_TESTE,
    agoraMs
  });
  const identidade = verificarJwt(token, JWT_SECRET_TESTE, { agoraMs: agoraMs + 30_000 });
  assert.match(identidade.idToken, /^[A-Za-z0-9_-]{16,}$/);
  assert.deepEqual({ ...identidade, idToken: undefined }, {
    idUsuario: 7,
    perfil: 'administrador',
    idEstabelecimento: 11,
    superadministrador: false,
    idToken: undefined,
    emitidoEm: Math.floor(agoraMs / 1000),
    expiraEm: Math.floor((agoraMs + 60_000) / 1000)
  });
  const partes = token.split('.');
  const carga = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
  carga.id_estabelecimento = 22;
  const adulterado = `${partes[0]}.${Buffer.from(JSON.stringify(carga)).toString('base64url')}.${partes[2]}`;
  assert.equal(verificarJwt(adulterado, JWT_SECRET_TESTE, { agoraMs: agoraMs + 30_000 }), null);
  assert.equal(verificarJwt(token, `${JWT_SECRET_TESTE}-outro`, { agoraMs: agoraMs + 30_000 }), null);
  assert.equal(verificarJwt(token, JWT_SECRET_TESTE, { agoraMs: agoraMs + 60_000 }), null);
});

test('JWT de superadministrador é global e explicitamente identificado', () => {
  const token = criarJwt({
    idUsuario: 1,
    perfil: 'superadministrador',
    superadministrador: true,
    duracaoMs: 60_000,
    segredo: JWT_SECRET_TESTE
  });
  const identidade = verificarJwt(token, JWT_SECRET_TESTE);
  assert.equal(identidade.perfil, 'superadministrador');
  assert.equal(identidade.idEstabelecimento, null);
  assert.equal(identidade.superadministrador, true);
});

test('API global autentica e lista estabelecimentos sem resolver tenant pelo host', async () => {
  const consultas = [];
  const banco = {
    async execute(sql, parametros = []) {
      consultas.push({ sql, parametros });
      if (sql.includes('FROM superadministradores') && sql.includes('senha_hash')) {
        return [[{
          id: 1,
          nome: 'Super Teste',
          usuario: 'superteste',
          email: 'super@teste.local',
          senha_hash: criarHashSenha('senha-global-segura')
        }]];
      }
      if (sql.includes('INSERT INTO sessoes_superadmin')) return [{ affectedRows: 1 }];
      if (sql.includes('DELETE FROM sessoes_superadmin')) return [{ affectedRows: 0 }];
      if (sql.includes('FROM sessoes_superadmin ss')) {
        return [[{ id: 1, nome: 'Super Teste', usuario: 'superteste', email: 'super@teste.local' }]];
      }
      if (sql.includes('FROM estabelecimentos e')) {
        return [[{
          id_estabelecimento: 11,
          nome_fantasia: 'Loja Global',
          slug: 'loja-global',
          dominio_personalizado: null,
          status: 'ativo',
          plano: 'profissional',
          status_assinatura: 'ativa',
          vencimento_assinatura_em: null,
          criado_em: new Date('2026-08-28T00:00:00.000Z'),
          atualizado_em: new Date('2026-08-28T00:00:00.000Z'),
          total_administradores: 1
        }]];
      }
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };
  const servidor = criarServidor({
    banco,
    pastaUploads: tmpdir(),
    tenantDesenvolvimento: '',
    jwtSecret: JWT_SECRET_TESTE
  });
  await aguardarServidor(servidor, 0);
  const baseUrl = `http://127.0.0.1:${servidor.address().port}`;

  try {
    const login = await fetch(`${baseUrl}/api/superadmin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'host-sem-tenant.teste' },
      body: JSON.stringify({ usuario: 'superteste', senha: 'senha-global-segura' })
    });
    assert.equal(login.status, 200);
    const { token, superadmin } = await login.json();
    assert.equal(superadmin.idEstabelecimento, null);

    const listagem = await fetch(`${baseUrl}/api/superadmin/estabelecimentos?plano=profissional`, {
      headers: { Authorization: `Bearer ${token}`, Host: 'outro-host-sem-tenant.teste' }
    });
    assert.equal(listagem.status, 200);
    const corpo = await listagem.json();
    assert.equal(corpo.estabelecimentos[0].nomeFantasia, 'Loja Global');
    assert.equal(corpo.opcoes.planos.includes('profissional'), true);
    assert.equal(consultas.some(({ sql }) => /FROM estabelecimentos AS e/i.test(sql)), false);

    const tokenAdministrador = criarJwt({
      idUsuario: 7,
      perfil: 'administrador',
      idEstabelecimento: 11,
      duracaoMs: 60_000,
      segredo: JWT_SECRET_TESTE
    });
    const proibido = await fetch(`${baseUrl}/api/superadmin/estabelecimentos`, {
      headers: { Authorization: `Bearer ${tokenAdministrador}` }
    });
    assert.equal(proibido.status, 403);
  } finally {
    await fecharServidor(servidor);
  }
});

test('cria estabelecimento e primeiro administrador na mesma transação global', async () => {
  const comandos = [];
  const linhaCriada = {
    id_estabelecimento: 44,
    nome_fantasia: 'Loja Quarenta e Quatro',
    slug: 'loja-44',
    dominio_personalizado: 'loja44.exemplo.com.br',
    status: 'ativo',
    plano: 'premium',
    status_assinatura: 'ativa',
    vencimento_assinatura_em: new Date('2027-01-10T23:59:59.000Z'),
    criado_em: new Date('2026-08-28T00:00:00.000Z'),
    atualizado_em: new Date('2026-08-28T00:00:00.000Z'),
    logo_url: null,
    banner_url: null,
    total_administradores: 1
  };
  const conexao = {
    async beginTransaction() { comandos.push({ sql: 'BEGIN', parametros: [] }); },
    async commit() { comandos.push({ sql: 'COMMIT', parametros: [] }); },
    async rollback() { comandos.push({ sql: 'ROLLBACK', parametros: [] }); },
    release() { comandos.push({ sql: 'RELEASE', parametros: [] }); },
    async execute(sql, parametros = []) {
      comandos.push({ sql, parametros });
      if (sql.includes('INSERT INTO estabelecimentos')) return [{ insertId: 44 }];
      return [{ affectedRows: 1 }];
    }
  };
  const banco = {
    async getConnection() { return conexao; },
    async execute(sql, parametros = []) {
      comandos.push({ sql, parametros });
      if (sql.includes('FROM estabelecimentos e')) return [[linhaCriada]];
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };
  const criado = await criarEstabelecimentoGerencial(banco, {
    nomeFantasia: 'Loja Quarenta e Quatro',
    slug: 'loja-44',
    dominioPersonalizado: 'loja44.exemplo.com.br',
    status: 'ativo',
    plano: 'premium',
    statusAssinatura: 'ativa',
    vencimentoAssinatura: '2027-01-10',
    ...{
      corPrincipal: '#FFC107', corSecundaria: '#0A0A0A', corFundo: '#111111',
      corCard: '#181818', corTexto: '#FFFFFF', fonte: 'Poppins'
    },
    primeiroAdministrador: {
      nome: 'Admin Loja 44', usuario: 'admin44', email: 'admin44@teste.local', senha: 'senha-admin-segura'
    }
  }, 1);
  assert.equal(criado.id, 44);
  const insertAdmin = comandos.find(({ sql }) => sql.includes('INSERT INTO administradores'));
  assert.equal(insertAdmin.parametros[0], 44);
  assert.notEqual(insertAdmin.parametros[4], 'senha-admin-segura');
  assert.equal(comandos.some(({ sql }) => sql.includes('INSERT INTO auditoria_superadmin')), true);
  assert.equal(comandos.some(({ sql }) => sql === 'COMMIT'), true);
  assert.equal(comandos.some(({ sql }) => /SELECT\s+\*/i.test(sql)), false);

  await assert.rejects(
    criarEstabelecimentoGerencial(banco, {
      nomeFantasia: 'Inválida', slug: '../outra', primeiroAdministrador: {
        nome: 'Admin', usuario: 'admin', email: 'admin@teste.local', senha: 'senha-admin-segura'
      }
    }, 1),
    /slug/
  );
});

test('filtra listagem global somente por valores permitidos e consultas explícitas', async () => {
  let consulta;
  const banco = {
    async execute(sql, parametros) {
      consulta = { sql, parametros };
      return [[]];
    }
  };
  await listarEstabelecimentosGerenciais(banco, {
    busca: 'burger', status: 'ativo', plano: 'premium', statusAssinatura: 'bloqueada'
  });
  assert.match(consulta.sql, /e\.status = \?/);
  assert.match(consulta.sql, /e\.plano = \?/);
  assert.match(consulta.sql, /e\.status_assinatura = \?/);
  assert.equal(consulta.parametros.at(-1), 'premium');
  assert.equal(/SELECT\s+\*/i.test(consulta.sql), false);
});

test('API bloqueia JWT de perfil ou estabelecimento diferente antes de consultar dados', async () => {
  const banco = {
    async execute(sql) {
      if (sql.includes('FROM estabelecimentos AS e')) {
        return [[{
          id_estabelecimento: 11,
          nome_fantasia: 'Loja A',
          slug: 'loja-a',
          dominio_personalizado: null,
          status: 'ativo',
          plano: 'basico',
          status_assinatura: 'ativa',
          vencimento_assinatura_em: null
        }]];
      }
      if (sql.includes('DELETE FROM sessoes_admin')) return [{ affectedRows: 0 }];
      if (sql.includes('FROM sessoes_admin s')) {
        return [[{
          id: 7,
          nome: 'Administrador A',
          usuario: 'admin-a',
          email: 'admin-a@teste.local',
          id_estabelecimento: 11
        }]];
      }
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };
  const servidor = criarServidor({
    banco,
    pastaUploads: tmpdir(),
    tenantDesenvolvimento: 'loja-a',
    jwtSecret: JWT_SECRET_TESTE
  });
  await aguardarServidor(servidor, 0);
  const baseUrl = `http://127.0.0.1:${servidor.address().port}`;
  const criarToken = (perfil, idEstabelecimento) => criarJwt({
    idUsuario: 7,
    perfil,
    idEstabelecimento,
    duracaoMs: 60_000,
    segredo: JWT_SECRET_TESTE
  });
  const chamarSessao = async (token) => {
    const resposta = await fetch(`${baseUrl}/api/admin/sessao`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return { status: resposta.status, corpo: await resposta.json() };
  };

  try {
    const permitido = await chamarSessao(criarToken('administrador', 11));
    assert.equal(permitido.status, 200);
    assert.equal(permitido.corpo.admin.idEstabelecimento, 11);

    const perfilIncorreto = await chamarSessao(criarToken('garcom', 11));
    assert.equal(perfilIncorreto.status, 403);
    const tenantIncorreto = await chamarSessao(criarToken('administrador', 22));
    assert.equal(tenantIncorreto.status, 403);
    const tokenValido = criarToken('administrador', 11);
    const adulterado = await chamarSessao(`x${tokenValido.slice(1)}`);
    assert.equal(adulterado.status, 401);
  } finally {
    await fecharServidor(servidor);
  }
});

function conexaoCatalogo({ promocao = null } = {}) {
  const produto = {
    id: 5,
    nome: 'Combo X-Bacon',
    descricao: 'Produto do cardápio',
    imagem_url: '/produto.webp',
    preco_centavos: 4990,
    ativo: 1
  };
  return {
    async execute(sql, parametros) {
      if (sql.includes('FROM produtos p') && sql.includes('WHERE p.id')) {
        return [[Number(parametros[0]) === produto.id ? produto : null].filter(Boolean)];
      }
      if (sql.includes('FROM promocoes') && sql.includes('WHERE id')) {
        const corresponde = promocao
          && Number(parametros[0]) === Number(promocao.id)
          && Number(parametros[1]) === Number(promocao.produto_id)
          && Number(parametros[2]) === 1;
        return [[corresponde ? promocao : null].filter(Boolean)];
      }
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };
}

function promocaoTeste(sobrescritas = {}) {
  return {
    id: 101,
    produto_id: 5,
    nome: 'Combo promocional',
    descricao: 'Oferta válida',
    imagem_url: '/promocao.webp',
    preco_centavos: 4240,
    ativo: 1,
    inicio_em: null,
    fim_em: null,
    ...sobrescritas
  };
}

test('recalcula produto normal e ignora preço adulterado pelo navegador', async () => {
  const [item] = await buscarItensValidados(conexaoCatalogo(), 1, [{
    produtoId: 5,
    quantidade: 2,
    preco: 0.01
  }]);
  assert.equal(item.precoCentavos, 4990);
  assert.deepEqual(calcularTotaisPedido([item], 790), {
    subtotalCentavos: 9980,
    totalCentavos: 10770
  });
});

test('aplica promoção vinculada e calcula o total no servidor', async () => {
  const [item] = await buscarItensValidados(conexaoCatalogo({ promocao: promocaoTeste() }), 1, [{
    produtoId: 5,
    promocaoId: 101,
    quantidade: 1,
    preco: 9999
  }]);
  assert.equal(item.promocaoId, 101);
  assert.equal(item.nome, 'Combo promocional');
  assert.equal(item.precoCentavos, 4240);
  assert.equal(calcularTotaisPedido([item], 790).totalCentavos, 5030);
});

test('rejeita promoção vencida', async () => {
  const promocao = promocaoTeste({ fim_em: new Date(Date.now() - 60_000) });
  await assert.rejects(
    buscarItensValidados(conexaoCatalogo({ promocao }), 1, [{ produtoId: 5, promocaoId: 101, quantidade: 1 }]),
    (erro) => erro.status === 409
  );
});

test('rejeita promoção desativada', async () => {
  const promocao = promocaoTeste({ ativo: 0 });
  await assert.rejects(
    buscarItensValidados(conexaoCatalogo({ promocao }), 1, [{ produtoId: 5, promocaoId: 101, quantidade: 1 }]),
    (erro) => erro.status === 409
  );
});

test('rejeita formatos e volumes abusivos antes de persistir o pedido', async () => {
  await assert.rejects(
    buscarItensValidados(conexaoCatalogo(), 1, [null]),
    (erro) => erro.status === 400 && /formato inválido/i.test(erro.message)
  );
  await assert.rejects(
    buscarItensValidados(conexaoCatalogo(), 1, [{ produtoId: 5, quantidade: -1 }]),
    (erro) => erro.status === 400 && /quantidade inválida/i.test(erro.message)
  );
  await assert.rejects(
    buscarItensValidados(conexaoCatalogo(), 1, Array.from({ length: 101 }, () => ({ produtoId: 5, quantidade: 1 }))),
    (erro) => erro.status === 400 && /no máximo 100/i.test(erro.message)
  );
  await assert.rejects(
    buscarItensValidados(conexaoCatalogo(), 1, Array.from({ length: 11 }, () => ({ produtoId: 5, quantidade: 50 }))),
    (erro) => erro.status === 400 && /no máximo 500/i.test(erro.message)
  );
  await assert.rejects(
    buscarItensValidados(conexaoCatalogo(), 1, [{ produtoId: 5, quantidade: 1, adicionais: '1,2' }]),
    (erro) => erro.status === 400 && /lista de adicionais/i.test(erro.message)
  );
  assert.throws(
    () => calcularTotaisPedido([{ precoCentavos: 100_000_000, quantidade: 50 }], 0),
    (erro) => erro.status === 400 && /excede o limite/i.test(erro.message)
  );
});

test('limita tentativas repetidas de autenticação', () => {
  const limitador = criarLimitadorTentativas({ limite: 3, janelaMs: 1000 });
  assert.equal(limitador.permite('acesso', 0), true);
  limitador.registrarFalha('acesso', 0);
  limitador.registrarFalha('acesso', 1);
  limitador.registrarFalha('acesso', 2);
  assert.equal(limitador.permite('acesso', 3), false);
  assert.equal(limitador.permite('acesso', 1000), true);
});

test('não expõe detalhes internos quando o banco falha', async () => {
  const bancoComFalha = {
    async execute() { throw new Error('segredo-interno-do-mysql'); },
    async query() { throw new Error('segredo-interno-do-mysql'); }
  };
  const servidorComFalha = criarServidor({ banco: bancoComFalha, pastaUploads: tmpdir() });
  await aguardarServidor(servidorComFalha, 0);
  const erroOriginal = console.error;
  const errosRegistrados = [];
  console.error = (...argumentos) => errosRegistrados.push(argumentos);
  try {
    const base = `http://127.0.0.1:${servidorComFalha.address().port}`;
    const urlInvalida = await fetch(`${base}/api/%`);
    assert.equal(urlInvalida.status, 400);
    assert.match((await urlInvalida.json()).erro, /URL informada é inválida/i);

    const resposta = await fetch(`${base}/api/publico/inicial`);
    const corpo = await resposta.json();
    assert.equal(resposta.status, 500);
    assert.equal(corpo.erro, 'Erro interno do servidor.');
    assert.equal(JSON.stringify(corpo).includes('segredo-interno-do-mysql'), false);
    assert.ok(errosRegistrados.length > 0);
    assert.equal(JSON.stringify(errosRegistrados).includes('segredo-interno-do-mysql'), false);
  } finally {
    console.error = erroOriginal;
    await fecharServidor(servidorComFalha);
  }
});

const executarIntegracao = process.env.RUN_MYSQL_TESTS === '1';

if (!executarIntegracao) {
  test('integração MySQL', {
    skip: 'Defina RUN_MYSQL_TESTS=1 para autorizar explicitamente os testes em um banco descartável.'
  }, () => {});
} else {
  let banco;
  let servidor;
  let servidorTenantB;
  let pastaTemporaria;
  let pastaUploads;
  let urlBase;
  let urlBaseTenantB;
  let tokenGarcomDemonstracao;
  let tokenGarcomAna;
  let tokenSessaoGarcom;
  let idGarcomDemonstracao;
  let tokenAdmin;

  const configuracaoValida = {
    nomeLoja: 'Hambúrguer Teste',
    telefone: '(11) 4000-1234',
    whatsapp: '(11) 98888-7777',
    email: 'contato@hamburguerteste.local',
    endereco: 'Rua da Integração, 100 - Centro',
    horarioFuncionamento: 'Segunda a domingo: 18h às 23h',
    instagramUrl: 'https://instagram.com/hamburguerteste',
    facebookUrl: '',
    taxaEntrega: 7.9,
    tempoEntrega: '30–45 min',
    pedidoMinimo: 20,
    lojaAberta: true,
    entregaAtiva: true,
    aceitaCartao: true,
    aceitaDinheiro: true,
    pixChave: '',
    pixBeneficiario: '',
    pixCidade: '',
    retiradaAtiva: true,
    logo: '',
    areasEntrega: [
      { bairro: 'Centro', taxa: 5 },
      { bairro: 'Bairro Sul', taxa: 8.5 }
    ]
  };

  const nomeBanco = `${process.env.DB_NAME || 'hamburgueria'}_testes`;
  const configuracaoMySql = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: nomeBanco,
    connectionLimit: 4
  };
  const administrador = {
    usuario: 'admin-teste',
    email: 'admin@teste.local',
    nome: 'Administrador de teste',
    senha: 'senha-segura',
    sincronizarCredenciais: true
  };

  async function chamar(caminho, { metodo = 'GET', dados, token, baseUrl = urlBase } = {}) {
    const resposta = await fetch(`${baseUrl}${caminho}`, {
      method: metodo,
      headers: {
        Accept: 'application/json',
        ...(dados === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: dados === undefined ? undefined : JSON.stringify(dados)
    });
    return { status: resposta.status, corpo: await resposta.json() };
  }

  async function salvarConfiguracaoTeste(sobrescritas = {}) {
    return chamar('/api/admin/configuracao', {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { ...configuracaoValida, ...sobrescritas }
    });
  }

  function dadosPedido(sobrescritas = {}) {
    return {
      nome: 'Cliente Teste',
      telefone: '(11) 90000-0000',
      email: `cliente-${randomUUID()}@teste.local`,
      rua: 'Rua do Teste',
      numero: '10',
      bairro: 'Centro',
      modalidade: 'delivery',
      chaveIdempotencia: randomUUID(),
      pagamento: 'Cartão na entrega',
      itens: [{ id: 1, quantidade: 1 }],
      ...sobrescritas
    };
  }

  before(async () => {
    pastaTemporaria = await mkdtemp(join(tmpdir(), 'hamburgueria-api-'));
    pastaUploads = join(pastaTemporaria, 'uploads');
    banco = await prepararBanco({
      mysql: configuracaoMySql,
      administrador,
      incluirDadosDemonstracao: true,
      pinFuncionarioDemonstracao: '246810'
    });
    const [tenantB] = await banco.execute(`
      INSERT INTO estabelecimentos
        (nome_fantasia, slug, status, plano, status_assinatura)
      VALUES ('Loja B', 'loja-b', 'ativo', 'basico', 'ativa')
    `);
    const idTenantB = Number(tenantB.insertId);
    await banco.execute(`
      INSERT INTO configuracoes_estabelecimento
        (id_estabelecimento, loja_aberta, entrega_ativa, retirada_ativa)
      VALUES (?, 1, 1, 1)
    `, [idTenantB]);
    const [categoriaB] = await banco.execute(`
      INSERT INTO categorias (id_estabelecimento, nome, ordem, ativo)
      VALUES (?, 'Hambúrgueres', 1, 1)
    `, [idTenantB]);
    await banco.execute(`
      INSERT INTO produtos
        (id_estabelecimento, categoria_id, nome, descricao, preco_centavos, ativo)
      VALUES (?, ?, 'Produto exclusivo B', 'Visível somente na Loja B', 2500, 1)
    `, [idTenantB, categoriaB.insertId]);
    servidor = criarServidor({ banco, pastaUploads, jwtSecret: JWT_SECRET_TESTE });
    servidorTenantB = criarServidor({
      banco,
      pastaUploads,
      tenantDesenvolvimento: 'loja-b',
      jwtSecret: JWT_SECRET_TESTE
    });
    await aguardarServidor(servidor, 0);
    await aguardarServidor(servidorTenantB, 0);
    urlBase = `http://127.0.0.1:${servidor.address().port}`;
    urlBaseTenantB = `http://127.0.0.1:${servidorTenantB.address().port}`;
  });

  after(async () => {
    if (servidor) await fecharServidor(servidor);
    if (servidorTenantB) await fecharServidor(servidorTenantB);
    if (banco) await fecharBanco(banco);
    const conexao = await mysql.createConnection({
      host: configuracaoMySql.host,
      port: configuracaoMySql.port,
      user: configuracaoMySql.user,
      password: configuracaoMySql.password
    });
    await conexao.query(`DROP DATABASE IF EXISTS \`${nomeBanco}\``);
    await conexao.end();
    if (pastaTemporaria) await rm(pastaTemporaria, { recursive: true, force: true });
  });

  test('expõe saúde e dados públicos persistidos no MySQL', async () => {
    const respostaSaude = await fetch(`${urlBase}/api/saude`, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(respostaSaude.status, 200);
    assert.equal(respostaSaude.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(respostaSaude.headers.get('x-frame-options'), 'DENY');
    assert.equal(respostaSaude.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(respostaSaude.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal((await respostaSaude.json()).banco, 'mysql-conectado');

    const publico = await chamar('/api/publico/inicial');
    assert.equal(publico.status, 200);
    // O cardápio público mostra o que está ativo no seed; a contagem sai
    // dele para que ampliar a demonstração não quebre o teste.
    assert.equal(
      publico.corpo.produtos.length,
      produtosSeed.filter((produto) => produto.ativo !== false).length
    );
    assert.equal(
      publico.corpo.adicionais.length,
      adicionaisSeed.filter((adicional) => adicional.ativo !== false).length
    );
    assert.equal(publico.corpo.promocoes.length, 5);
    assert.equal('funcionarios' in publico.corpo, false);
  });

  test('isola catálogo e sessão administrativa entre dois tenants', async () => {
    const catalogoA = await chamar('/api/catalogo');
    const catalogoB = await chamar('/api/catalogo', { baseUrl: urlBaseTenantB });
    assert.equal(catalogoA.status, 200);
    assert.equal(catalogoB.status, 200);
    assert.equal(catalogoA.corpo.produtos.some((produto) => produto.nome === 'Produto exclusivo B'), false);
    assert.deepEqual(catalogoB.corpo.produtos.map((produto) => produto.nome), ['Produto exclusivo B']);

    const loginA = await chamar('/api/admin/login', {
      metodo: 'POST',
      dados: { usuario: 'admin-teste', senha: 'senha-segura' }
    });
    assert.equal(loginA.status, 200);
    const sessaoCruzada = await chamar('/api/admin/dados', {
      token: loginA.corpo.token,
      baseUrl: urlBaseTenantB
    });
    assert.equal(sessaoCruzada.status, 403);
  });

  test('autentica o administrador e protege os dados gerenciais', async () => {
    const semSessao = await chamar('/api/admin/dados');
    assert.equal(semSessao.status, 401);

    const login = await chamar('/api/admin/login', {
      metodo: 'POST',
      dados: { usuario: 'admin-teste', senha: 'senha-segura' }
    });
    assert.equal(login.status, 200);
    assert.ok(login.corpo.token);

    const dados = await chamar('/api/admin/dados', { token: login.corpo.token });
    assert.equal(dados.status, 200);
    assert.equal(dados.corpo.pedidos.length, pedidosSeed.length);
    assert.equal(dados.corpo.mesas.length, mesasSeed.length);
    tokenGarcomDemonstracao = dados.corpo.funcionarios.find((item) => item.nome === 'Carlos Silva').token;
    tokenGarcomAna = dados.corpo.funcionarios.find((item) => item.nome === 'Ana Souza').token;
    tokenAdmin = login.corpo.token;

    const configurada = await salvarConfiguracaoTeste();
    assert.equal(configurada.status, 200);
    const publico = await chamar('/api/publico/inicial');
    assert.equal(publico.corpo.configuracao.nomeLoja, 'Hambúrguer Teste');
    assert.equal(publico.corpo.configuracao.whatsapp, '(11) 98888-7777');
    assert.deepEqual(publico.corpo.configuracao.areasEntrega, [
      { bairro: 'Centro', taxa: 5 },
      { bairro: 'Bairro Sul', taxa: 8.5 }
    ]);
  });

  test('cria delivery com preços recalculados e acompanhamento protegido', async () => {
    const criado = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: {
        nome: 'Cliente Teste',
        telefone: '(11) 90000-0000',
        email: 'cliente@teste.local',
        rua: 'Rua do Teste',
        numero: '10',
        bairro: 'Centro',
        modalidade: 'delivery',
        chaveIdempotencia: randomUUID(),
        pagamento: 'Cartão na entrega',
        itens: [{ id: 1, quantidade: 1, adicionais: [{ id: 1 }] }]
      }
    });
    assert.equal(criado.status, 201);
    assert.equal(criado.corpo.pedido.taxaEntrega, 5);
    assert.equal(criado.corpo.pedido.total, 44.9);
    assert.equal(criado.corpo.pedido.pagamentoStatus, 'Pagamento na entrega');
    assert.ok(criado.corpo.pedido.tokenAcompanhamento);

    const pixIndisponivel = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: {
        nome: 'Cliente Pix',
        telefone: '(11) 91111-1111',
        email: 'cliente-pix@teste.local',
        rua: 'Rua do Teste',
        numero: '20',
        bairro: 'Centro',
        modalidade: 'delivery',
        chaveIdempotencia: randomUUID(),
        pagamento: 'Pix',
        itens: [{ id: 1, quantidade: 1 }]
      }
    });
    assert.equal(pixIndisponivel.status, 409);

    const negado = await chamar(`/api/pedidos/${encodeURIComponent(criado.corpo.pedido.id)}?token=invalido`);
    assert.equal(negado.status, 404);

    const acompanhado = await chamar(`/api/pedidos/${encodeURIComponent(criado.corpo.pedido.id)}?token=${encodeURIComponent(criado.corpo.pedido.tokenAcompanhamento)}`);
    assert.equal(acompanhado.status, 200);
    assert.equal(acompanhado.corpo.pedido.status, 'Recebido');
  });

  test('bloqueia pedido com loja fechada e abaixo do mínimo', async () => {
    const fechadaConfigurada = await salvarConfiguracaoTeste({ lojaAberta: false });
    assert.equal(fechadaConfigurada.status, 200);
    const fechada = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido()
    });
    assert.equal(fechada.status, 409);
    assert.match(fechada.corpo.erro, /fechada/i);

    const minimoConfigurado = await salvarConfiguracaoTeste({ pedidoMinimo: 100 });
    assert.equal(minimoConfigurado.status, 200);
    const minimo = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido()
    });
    assert.equal(minimo.status, 409);
    assert.match(minimo.corpo.erro, /pedido mínimo/i);

    assert.equal((await salvarConfiguracaoTeste()).status, 200);
  });

  test('valida telefone e área e aplica a taxa configurada por bairro', async () => {
    const telefoneInvalido = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido({ telefone: '1234' })
    });
    assert.equal(telefoneInvalido.status, 400);
    assert.match(telefoneInvalido.corpo.erro, /telefone válido/i);

    const areaInvalida = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido({ bairro: 'Fora da cobertura' })
    });
    assert.equal(areaInvalida.status, 409);
    assert.match(areaInvalida.corpo.erro, /fora da área/i);

    const areaValida = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido({ bairro: 'bairro sul' })
    });
    assert.equal(areaValida.status, 201);
    assert.equal(areaValida.corpo.pedido.taxaEntrega, 8.5);
    assert.match(areaValida.corpo.pedido.endereco, /Bairro Sul/);
  });

  test('valida troco em dinheiro e persiste a opção escolhida', async () => {
    const semTroco = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido({ pagamento: 'Dinheiro', semTroco: true })
    });
    assert.equal(semTroco.status, 201);
    assert.equal(semTroco.corpo.pedido.semTroco, true);
    assert.equal(semTroco.corpo.pedido.trocoPara, null);

    const trocoValido = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido({ pagamento: 'Dinheiro', trocoPara: 50 })
    });
    assert.equal(trocoValido.status, 201);
    assert.equal(trocoValido.corpo.pedido.semTroco, false);
    assert.equal(trocoValido.corpo.pedido.trocoPara, 50);

    const [[antesDoInvalido]] = await banco.execute('SELECT COUNT(*) AS total FROM pedidos');
    const trocoInvalido = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido({ pagamento: 'Dinheiro', trocoPara: 30 })
    });
    assert.equal(trocoInvalido.status, 409);
    assert.match(trocoInvalido.corpo.erro, /menor que o total/i);
    const [[depoisDoInvalido]] = await banco.execute('SELECT COUNT(*) AS total FROM pedidos');
    assert.equal(Number(depoisDoInvalido.total), Number(antesDoInvalido.total));
  });

  test('reenvio idempotente retorna o mesmo pedido sem duplicar registro', async () => {
    const chaveIdempotencia = randomUUID();
    const email = `duplicado-${randomUUID()}@teste.local`;
    const dados = dadosPedido({ chaveIdempotencia, email });
    const [primeiro, segundo] = await Promise.all([
      chamar('/api/pedidos', { metodo: 'POST', dados }),
      chamar('/api/pedidos', { metodo: 'POST', dados })
    ]);
    assert.equal(primeiro.status, 201);
    assert.equal(segundo.status, 201);
    assert.equal(segundo.corpo.pedido.id, primeiro.corpo.pedido.id);
    assert.equal(segundo.corpo.pedido.tokenAcompanhamento, chaveIdempotencia);

    const [[contagem]] = await banco.execute('SELECT COUNT(*) AS total FROM pedidos WHERE email = ?', [email]);
    assert.equal(Number(contagem.total), 1);
  });

  test('revalida disponibilidade e preço do carrinho no servidor', async () => {
    const [[produtoOriginal]] = await banco.execute('SELECT preco_centavos, ativo FROM produtos WHERE id = 1');
    try {
      await banco.execute('UPDATE produtos SET ativo = 0 WHERE id = 1');
      const removido = await chamar('/api/carrinho/validar', {
        metodo: 'POST',
        dados: { itens: [{ id: 1, quantidade: 1, nome: 'X-Salada', precoFinal: 0.01 }] }
      });
      assert.equal(removido.status, 200);
      assert.equal(removido.corpo.itens.length, 0);
      assert.match(removido.corpo.alteracoes[0].mensagem, /não está mais disponível/i);

      await banco.execute('UPDATE produtos SET ativo = 1, preco_centavos = 3190 WHERE id = 1');
      const atualizado = await chamar('/api/carrinho/validar', {
        metodo: 'POST',
        dados: { itens: [{ id: 1, quantidade: 1, nome: 'X-Salada', precoFinal: 29.9 }] }
      });
      assert.equal(atualizado.status, 200);
      assert.equal(atualizado.corpo.itens[0].precoFinal, 31.9);
      assert.match(atualizado.corpo.alteracoes[0].mensagem, /preço.*atualizado/i);
    } finally {
      await banco.execute('UPDATE produtos SET ativo = ?, preco_centavos = ? WHERE id = 1', [produtoOriginal.ativo, produtoOriginal.preco_centavos]);
    }
  });

  test('admin gerencia categorias e categorias inativas somem do cardápio público', async () => {
    const criada = await chamar('/api/admin/categorias', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: `Sazonais ${randomUUID().slice(0, 8)}`, ordem: 90, ativo: true }
    });
    assert.equal(criada.status, 201);
    const categoriaId = criada.corpo.categoria.id;
    const publicoAtivo = await chamar('/api/publico/inicial');
    assert.ok(publicoAtivo.corpo.categorias.some((categoria) => categoria.id === categoriaId));

    const inativada = await chamar(`/api/admin/categorias/${categoriaId}/status`, {
      metodo: 'PATCH',
      token: tokenAdmin,
      dados: { ativo: false }
    });
    assert.equal(inativada.status, 200);
    assert.equal(inativada.corpo.categoria.ativo, false);
    const publicoInativo = await chamar('/api/publico/inicial');
    assert.equal(publicoInativo.corpo.categorias.some((categoria) => categoria.id === categoriaId), false);
  });

  test('retirada dispensa endereço e taxa, gera Pix e confirma pagamento uma única vez', async () => {
    const pixConfigurado = await salvarConfiguracaoTeste({
      pixChave: 'financeiro@hamburguerteste.local',
      pixBeneficiario: 'Hambúrguer Teste',
      pixCidade: 'São Paulo'
    });
    assert.equal(pixConfigurado.status, 200);

    const criado = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido({
        modalidade: 'retirada',
        pagamento: 'Pix',
        rua: '',
        numero: '',
        bairro: ''
      })
    });
    assert.equal(criado.status, 201);
    assert.equal(criado.corpo.pedido.origem, 'Retirada no balcão');
    assert.equal(criado.corpo.pedido.taxaEntrega, 0);
    assert.equal(criado.corpo.pedido.endereco, null);
    assert.match(criado.corpo.pedido.pixCopiaCola, /^000201/);

    const semAutorizacao = await chamar(`/api/admin/pedidos/${encodeURIComponent(criado.corpo.pedido.id)}/pagamento/confirmar`, { metodo: 'POST' });
    assert.equal(semAutorizacao.status, 401);

    const [[receitaAntes]] = await banco.execute("SELECT COALESCE(SUM(valor_centavos), 0) AS total FROM pagamentos WHERE status = 'Pago'");
    const rotaConfirmacao = `/api/admin/pedidos/${encodeURIComponent(criado.corpo.pedido.id)}/pagamento/confirmar`;
    const [confirmado, confirmadoOutraVez] = await Promise.all([
      chamar(rotaConfirmacao, { metodo: 'POST', token: tokenAdmin }),
      chamar(rotaConfirmacao, { metodo: 'POST', token: tokenAdmin })
    ]);
    assert.equal(confirmado.status, 200);
    assert.equal(confirmado.corpo.pedido.pagamentoStatus, 'Pago');
    assert.equal(confirmado.corpo.pedido.pagamentoConfirmadoPor, administrador.nome);
    assert.ok(confirmado.corpo.pedido.pagamentoConfirmadoEm);
    assert.equal(confirmadoOutraVez.status, 200);
    assert.equal(confirmadoOutraVez.corpo.pedido.pagamentoConfirmadoEm, confirmado.corpo.pedido.pagamentoConfirmadoEm);

    const pedidoNumero = Number(criado.corpo.pedido.id.replace(/\D/g, ''));
    const [[auditoria]] = await banco.execute("SELECT COUNT(*) AS total FROM auditoria_admin WHERE acao = 'pagamento.confirmado' AND entidade_id = ?", [String(pedidoNumero)]);
    assert.equal(Number(auditoria.total), 1);
    const [[receitaDepois]] = await banco.execute("SELECT COALESCE(SUM(valor_centavos), 0) AS total FROM pagamentos WHERE status = 'Pago'");
    assert.equal(Number(receitaDepois.total) - Number(receitaAntes.total), Math.round(criado.corpo.pedido.total * 100));

    const estornado = await chamar(`/api/admin/pedidos/${encodeURIComponent(criado.corpo.pedido.id)}/pagamento/estornar`, {
      metodo: 'POST',
      token: tokenAdmin
    });
    assert.equal(estornado.status, 200);
    assert.equal(estornado.corpo.pedido.pagamentoStatus, 'Estornado');
    assert.equal(estornado.corpo.pedido.pagamentoEstornadoPor, administrador.nome);
    const estornadoOutraVez = await chamar(`/api/admin/pedidos/${encodeURIComponent(criado.corpo.pedido.id)}/pagamento/estornar`, {
      metodo: 'POST',
      token: tokenAdmin
    });
    assert.equal(estornadoOutraVez.status, 200);
    const [[auditoriaEstorno]] = await banco.execute("SELECT COUNT(*) AS total FROM auditoria_admin WHERE acao = 'pagamento.estornado' AND entidade_id = ?", [String(pedidoNumero)]);
    assert.equal(Number(auditoriaEstorno.total), 1);
    assert.equal((await salvarConfiguracaoTeste()).status, 200);
  });

  test('cancelamento cancela cobrança pendente e estorna cobrança já paga', async () => {
    const pendente = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido({ modalidade: 'retirada', pagamento: 'Cartão na retirada', rua: '', numero: '', bairro: '' })
    });
    assert.equal(pendente.status, 201);
    const cancelado = await chamar(`/api/admin/pedidos/${encodeURIComponent(pendente.corpo.pedido.id)}/status`, {
      metodo: 'PATCH',
      token: tokenAdmin,
      dados: { status: 'Cancelado' }
    });
    assert.equal(cancelado.corpo.pedido.pagamentoStatus, 'Cancelado');

    const pago = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido({ modalidade: 'retirada', pagamento: 'Cartão na retirada', rua: '', numero: '', bairro: '' })
    });
    await chamar(`/api/admin/pedidos/${encodeURIComponent(pago.corpo.pedido.id)}/pagamento/confirmar`, { metodo: 'POST', token: tokenAdmin });
    const canceladoPago = await chamar(`/api/admin/pedidos/${encodeURIComponent(pago.corpo.pedido.id)}/status`, {
      metodo: 'PATCH',
      token: tokenAdmin,
      dados: { status: 'Cancelado' }
    });
    assert.equal(canceladoPago.status, 200);
    assert.equal(canceladoPago.corpo.pedido.pagamentoStatus, 'Estornado');
    assert.equal(canceladoPago.corpo.pedido.pagamentoEstornadoPor, administrador.nome);
  });

  test('admin cria acessos adicionais e registra a ação na auditoria', async () => {
    const usuario = `gestor-${randomUUID().slice(0, 8)}`;
    const criado = await chamar('/api/admin/administradores', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: {
        nome: 'Gestor adicional',
        usuario,
        email: `${usuario}@teste.local`,
        senha: 'senha-adicional-segura',
        confirmacaoSenha: 'senha-adicional-segura'
      }
    });
    assert.equal(criado.status, 201);
    assert.equal(criado.corpo.administrador.ativo, true);
    const dados = await chamar('/api/admin/dados', { token: tokenAdmin });
    assert.ok(dados.corpo.auditoria.some((item) => item.acao === 'administrador.criado'));
  });

  test('persiste catálogo e imagens no diretório isolado do tenant', async () => {
    const login = await chamar('/api/admin/login', {
      metodo: 'POST',
      dados: { usuario: 'admin@teste.local', senha: 'senha-segura' }
    });
    const token = login.corpo.token;

    const extra = await chamar('/api/admin/adicionais', {
      metodo: 'POST',
      token,
      dados: { nome: 'Molho da casa', preco: '2,50', ativo: true }
    });
    assert.equal(extra.status, 201);

    const webpMinimo = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([4, 0, 0, 0]),
      Buffer.from('WEBP')
    ]).toString('base64');
    const configuracaoComLogo = await salvarConfiguracaoTeste({
      logo: `data:image/webp;base64,${webpMinimo}`
    });
    assert.equal(configuracaoComLogo.status, 200);
    assert.match(configuracaoComLogo.corpo.configuracao.logo, /^\/uploads\/estabelecimentos\/\d+\/logo-/);
    assert.ok((await stat(join(
      pastaUploads,
      ...configuracaoComLogo.corpo.configuracao.logo.slice('/uploads/'.length).split('/')
    ))).size > 0);

    const produto = await chamar('/api/admin/produtos', {
      metodo: 'POST',
      token,
      dados: {
        nome: 'Burger da API',
        categoria: 'Hambúrgueres',
        descricao: 'Produto criado durante o teste do backend.',
        preco: '28,50',
        imagem: `data:image/webp;base64,${webpMinimo}`,
        adicionaisIds: [extra.corpo.adicional.id],
        destaque: 'Novo',
        ativo: true
      }
    });
    assert.equal(produto.status, 201);
    assert.deepEqual(produto.corpo.produto.adicionaisIds, [extra.corpo.adicional.id]);

    const imagemNoDisco = join(
      pastaUploads,
      ...produto.corpo.produto.imagem.slice('/uploads/'.length).split('/')
    );
    assert.ok((await stat(imagemNoDisco)).size > 0);
    const [imagemNoTenantCorreto, imagemEmOutroTenant] = await Promise.all([
      fetch(`${urlBase}${produto.corpo.produto.imagem}`),
      fetch(`${urlBaseTenantB}${produto.corpo.produto.imagem}`)
    ]);
    assert.equal(imagemNoTenantCorreto.status, 200);
    assert.equal(imagemEmOutroTenant.status, 404);
  });

  test('autentica garçom e abre comanda vinculada automaticamente', async () => {
    const login = await chamar('/api/garcom/login', {
      metodo: 'POST',
      dados: { token: tokenGarcomDemonstracao, pin: '246810' }
    });
    assert.equal(login.status, 200);
    assert.equal(login.corpo.garcom.nome, 'Carlos Silva');
    tokenSessaoGarcom = login.corpo.token;
    idGarcomDemonstracao = login.corpo.garcom.id;

    const sessao = await chamar('/api/garcom/sessao', { token: login.corpo.token });
    assert.equal(sessao.status, 200);
    assert.equal('acessoToken' in sessao.corpo.garcom, false);

    const perfilIncorretoAdmin = await chamar('/api/admin/dados', { token: login.corpo.token });
    assert.equal(perfilIncorretoAdmin.status, 403);
    const perfilIncorretoGarcom = await chamar('/api/garcom/dados', { token: tokenAdmin });
    assert.equal(perfilIncorretoGarcom.status, 403);

    const aberta = await chamar('/api/garcom/comandas', {
      metodo: 'POST',
      token: login.corpo.token,
      dados: { mesaId: 1 }
    });
    assert.equal(aberta.status, 201);
    assert.equal(aberta.corpo.comanda.mesaId, 1);
    assert.equal(aberta.corpo.comanda.funcionarioId, login.corpo.garcom.id);
  });

  test('isola comandas por garçom e exige a sequência operacional', async () => {
    const dados = await chamar('/api/garcom/dados', { token: tokenSessaoGarcom });
    assert.equal(dados.status, 200);
    assert.ok(dados.corpo.comandas.length > 0);
    assert.ok(dados.corpo.comandas.every(
      (comanda) => comanda.funcionarioId === idGarcomDemonstracao || comanda.funcionarioId === null
    ));
    assert.equal(dados.corpo.comandas.some((comanda) => comanda.garcom === 'Ana Souza'), false);

    const comanda = dados.corpo.comandas.find((item) => item.mesaId === 1);
    assert.ok(comanda);
    const contaAntecipada = await chamar(`/api/garcom/comandas/${comanda.id}/conta`, {
      metodo: 'POST',
      token: tokenSessaoGarcom
    });
    assert.equal(contaAntecipada.status, 409);

    const item = await chamar(`/api/garcom/comandas/${comanda.id}/itens`, {
      metodo: 'POST',
      token: tokenSessaoGarcom,
      dados: { produtoId: 1, quantidade: 1, adicionais: [] }
    });
    assert.equal(item.status, 201);

    const pendente = await chamar('/api/garcom/dados', { token: tokenSessaoGarcom });
    const comandaPendente = pendente.corpo.comandas.find((item) => item.id === comanda.id);
    assert.equal(comandaPendente.itens.at(-1).enviado, false);

    const envio = await chamar(`/api/garcom/comandas/${comanda.id}/enviar`, {
      metodo: 'POST',
      token: tokenSessaoGarcom
    });
    assert.equal(envio.status, 200);

    const reenvio = await chamar(`/api/garcom/comandas/${comanda.id}/enviar`, {
      metodo: 'POST',
      token: tokenSessaoGarcom
    });
    assert.equal(reenvio.status, 409);

    const atualizado = await chamar('/api/garcom/dados', { token: tokenSessaoGarcom });
    const comandaAtualizada = atualizado.corpo.comandas.find((item) => item.id === comanda.id);
    assert.ok(comandaAtualizada.itens.every((linha) => linha.enviado));
    assert.equal(comandaAtualizada.itens.at(-1).enviadoPor.tipo, 'funcionario');
    assert.equal(comandaAtualizada.itens.at(-1).enviadoPor.nome, 'Carlos Silva');
    const ultimoItem = comandaAtualizada.itens.at(-1);
    const remocaoLancada = await chamar(`/api/garcom/comandas/${comanda.id}/itens/${ultimoItem.linhaId}`, {
      metodo: 'DELETE',
      token: tokenSessaoGarcom
    });
    assert.equal(remocaoLancada.status, 403);
    assert.match(remocaoLancada.corpo.erro, /já lançado/i);

    const limpezaVazia = await chamar(`/api/garcom/comandas/${comanda.id}/itens-pendentes`, {
      metodo: 'DELETE',
      token: tokenSessaoGarcom
    });
    assert.equal(limpezaVazia.status, 409);

    const novoPendente = await chamar(`/api/garcom/comandas/${comanda.id}/itens`, {
      metodo: 'POST',
      token: tokenSessaoGarcom,
      dados: { produtoId: 1, quantidade: 1, adicionais: [] }
    });
    assert.equal(novoPendente.status, 201);
    const limpeza = await chamar(`/api/garcom/comandas/${comanda.id}/itens-pendentes`, {
      metodo: 'DELETE',
      token: tokenSessaoGarcom
    });
    assert.equal(limpeza.status, 200);
    assert.equal(limpeza.corpo.removidos, 1);

    const semPendentes = await chamar('/api/garcom/dados', { token: tokenSessaoGarcom });
    const comandaLimpa = semPendentes.corpo.comandas.find((item) => item.id === comanda.id);
    assert.ok(comandaLimpa.itens.every((linha) => linha.enviado));

    const fechamentoProibido = await chamar(`/api/garcom/comandas/${comanda.id}/fechar`, {
      metodo: 'POST',
      token: tokenSessaoGarcom,
      dados: { pagamento: 'Dinheiro' }
    });
    assert.equal(fechamentoProibido.status, 404);

    const loginAna = await chamar('/api/garcom/login', {
      metodo: 'POST',
      dados: { token: tokenGarcomAna, pin: '246810' }
    });
    assert.equal(loginAna.status, 200);
    const tentativaIdor = await chamar(`/api/garcom/comandas/${comanda.id}/itens`, {
      metodo: 'POST',
      token: loginAna.corpo.token,
      dados: { produtoId: 1, quantidade: 1, adicionais: [] }
    });
    assert.equal(tentativaIdor.status, 403);
  });

  test('administrador cria mesas, edita itens e finaliza comandas', async () => {
    // Número derivado do seed: acrescentar mesas à demonstração não pode
    // transformar a criação legítima em conflito de número repetido.
    const numeroNovaMesa = String(mesasSeed.length + 1).padStart(2, '0');
    const criada = await chamar('/api/admin/mesas', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { numero: numeroNovaMesa }
    });
    assert.equal(criada.status, 201);
    assert.equal(criada.corpo.mesa.numero, numeroNovaMesa);

    const duplicada = await chamar('/api/admin/mesas', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { numero: numeroNovaMesa }
    });
    assert.equal(duplicada.status, 409);

    const dados = await chamar('/api/admin/dados', { token: tokenAdmin });
    const comanda = dados.corpo.comandas.find((item) => item.itens.length > 0);
    assert.ok(comanda);

    const adicionado = await chamar(`/api/admin/comandas/${comanda.id}/itens`, {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { produtoId: 1, quantidade: 1, adicionais: [] }
    });
    assert.equal(adicionado.status, 201);

    const comItem = await chamar('/api/admin/dados', { token: tokenAdmin });
    const atualizada = comItem.corpo.comandas.find((item) => item.id === comanda.id);
    const itemNovo = atualizada.itens.at(-1);
    const quantidade = await chamar(`/api/admin/comandas/${comanda.id}/itens/${itemNovo.linhaId}`, {
      metodo: 'PATCH',
      token: tokenAdmin,
      dados: { quantidade: 2 }
    });
    assert.equal(quantidade.status, 200);

    const lancada = await chamar(`/api/admin/comandas/${comanda.id}/lancar`, {
      metodo: 'POST',
      token: tokenAdmin
    });
    assert.equal(lancada.status, 200);

    const aposLancar = await chamar('/api/admin/dados', { token: tokenAdmin });
    const comandaLancada = aposLancar.corpo.comandas.find((item) => item.id === comanda.id);
    assert.ok(comandaLancada.itens.every((linha) => linha.enviado));
    assert.equal(comandaLancada.status, 'Na cozinha');
    // O item que o painel acabou de lançar fica com a autoria do administrador;
    // o que o garçom já tinha lançado antes mantém a autoria dele.
    const linhaDoAdmin = comandaLancada.itens.find((linha) => linha.linhaId === itemNovo.linhaId);
    assert.equal(linhaDoAdmin.enviadoPor.tipo, 'admin');
    assert.equal(linhaDoAdmin.enviadoPor.nome, 'Administrador de teste');

    const semPendente = await chamar(`/api/admin/comandas/${comanda.id}/lancar`, {
      metodo: 'POST',
      token: tokenAdmin
    });
    assert.equal(semPendente.status, 409);

    const trocoInsuficiente = await chamar(`/api/admin/comandas/${comanda.id}/finalizar`, {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { pagamento: 'Dinheiro', valorRecebido: '0,50' }
    });
    assert.equal(trocoInsuficiente.status, 400);

    const finalizada = await chamar(`/api/admin/comandas/${comanda.id}/finalizar`, {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { pagamento: 'Cartão' }
    });
    assert.equal(finalizada.status, 200);
    assert.equal(finalizada.corpo.pagamento.provedor, 'manual');
    assert.equal(finalizada.corpo.pagamento.trocoCentavos, null);

    const depois = await chamar('/api/admin/dados', { token: tokenAdmin });
    assert.equal(depois.corpo.comandas.some((item) => item.id === comanda.id), false);
    const pedido = depois.corpo.pedidos.find((item) => item.comandaId === comanda.id);
    assert.equal(pedido.status, 'Entregue na mesa');
    assert.equal(pedido.pagamentoStatus, 'Pago');
  });

  test('administrador limpa itens pendentes e cancela a comanda liberando a mesa', async () => {
    const mesaLivre = (await chamar('/api/admin/dados', { token: tokenAdmin }))
      .corpo.mesas.find((mesa) => mesa.status === 'Livre');
    assert.ok(mesaLivre);
    const funcionario = (await chamar('/api/admin/dados', { token: tokenAdmin }))
      .corpo.funcionarios.find((item) => item.status === 'Ativo');
    assert.ok(funcionario);

    const aberta = await chamar('/api/admin/comandas', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { mesaId: mesaLivre.id }
    });
    assert.equal(aberta.status, 201);
    assert.equal(aberta.corpo.comanda.funcionarioId, null);
    assert.equal(aberta.corpo.comanda.abertaPor.tipo, 'admin');
    assert.equal(aberta.corpo.comanda.abertaPor.nome, 'Administrador de teste');
    const comandaId = aberta.corpo.comanda.id;

    // Clicar de novo na mesma mesa devolve a comanda aberta em vez de erro.
    const repetida = await chamar('/api/admin/comandas', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { mesaId: mesaLivre.id }
    });
    assert.equal(repetida.status, 201);
    assert.equal(repetida.corpo.comanda.id, comandaId);

    for (let vez = 0; vez < 2; vez += 1) {
      const adicionado = await chamar(`/api/admin/comandas/${comandaId}/itens`, {
        metodo: 'POST',
        token: tokenAdmin,
        dados: { produtoId: 1, quantidade: 1, adicionais: [] }
      });
      assert.equal(adicionado.status, 201);
    }

    const limpeza = await chamar(`/api/admin/comandas/${comandaId}/itens-pendentes`, {
      metodo: 'DELETE',
      token: tokenAdmin
    });
    assert.equal(limpeza.status, 200);
    assert.equal(limpeza.corpo.removidos, 2);

    const semItens = await chamar('/api/admin/dados', { token: tokenAdmin });
    assert.equal(semItens.corpo.comandas.find((item) => item.id === comandaId).itens.length, 0);

    const cancelada = await chamar(`/api/admin/comandas/${comandaId}/cancelar`, {
      metodo: 'POST',
      token: tokenAdmin
    });
    assert.equal(cancelada.status, 200);

    const depois = await chamar('/api/admin/dados', { token: tokenAdmin });
    assert.equal(depois.corpo.comandas.some((item) => item.id === comandaId), false);
    assert.equal(
      depois.corpo.mesas.find((mesa) => mesa.id === mesaLivre.id).status,
      'Livre'
    );

    const recancelar = await chamar(`/api/admin/comandas/${comandaId}/cancelar`, {
      metodo: 'POST',
      token: tokenAdmin
    });
    assert.equal(recancelar.status, 409);
  });

  test('bloqueia novas tentativas após repetidos PINs inválidos', async () => {
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      const resposta = await chamar('/api/garcom/login', {
        metodo: 'POST',
        dados: { token: 'acesso-invalido', pin: '0000' }
      });
      assert.equal(resposta.status, 401);
    }
    const bloqueado = await chamar('/api/garcom/login', {
      metodo: 'POST',
      dados: { token: 'acesso-invalido', pin: '0000' }
    });
    assert.equal(bloqueado.status, 429);
  });

  test('limita spam de criação de pedidos por endereço de origem', async () => {
    const servidorLimitado = criarServidor({ banco, pastaUploads, limitePedidosPorMinuto: 2 });
    await aguardarServidor(servidorLimitado, 0);
    const baseLimitada = `http://127.0.0.1:${servidorLimitado.address().port}`;
    try {
      for (let tentativa = 0; tentativa < 2; tentativa += 1) {
        const resposta = await fetch(`${baseLimitada}/api/pedidos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dadosPedido({ telefone: 'invalido' }))
        });
        assert.equal(resposta.status, 400);
      }
      const bloqueada = await fetch(`${baseLimitada}/api/pedidos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dadosPedido())
      });
      assert.equal(bloqueada.status, 429);
    } finally {
      await fecharServidor(servidorLimitado);
    }
  });
}
