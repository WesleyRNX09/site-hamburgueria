import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
  buscarIndicadoresDashboard,
  buscarItensValidados,
  calcularTotaisPedido,
  criarPedidoDelivery,
  buscarImpressoraDeCaixa,
  intervaloIndicadores,
  salvarConfiguracao
} from './operations.js';
import { concederPermissoesPadrao } from './permissoes.js';
import { aguardarServidor, fecharServidor } from './runtime.js';
import { adicionaisSeed, mesasSeed, pedidosSeed, produtosSeed } from './seed.js';
import { criarHashSenha, criarJwt, verificarJwt, verificarSenha } from './security.js';
import {
  alternarStatusSuperadministrador,
  arquivarEstabelecimento,
  atualizarEstabelecimentoGerencial,
  criarEstabelecimentoGerencial,
  desarquivarEstabelecimento,
  listarEstabelecimentosGerenciais,
  reativarEstabelecimento,
  SLUGS_RESERVADOS,
  suspenderEstabelecimento
} from './superadmin.js';
import {
  extrairHostname,
  identificarEstabelecimentoPeloHost,
  resolverEstabelecimento
} from './tenant.js';
import { montarRecibo } from '../agente-impressao/escpos.js';
import { CHAVES_PERMISSOES } from '../src/utils/permissoes.js';

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
    // A foto da promoção usa o mesmo isolamento por estabelecimento da do produto.
    const urlPromocao = await salvarImagemDataUrl(pngMinimo, pasta, 11, 'promocao');
    assert.match(urlPromocao, /^\/uploads\/estabelecimentos\/11\/promocao-[a-f0-9-]+\.png$/);
    assert.equal(await removerImagemLocal(urlPromocao, pasta, 22), false);
    await stat(join(pasta, urlPromocao.slice('/uploads/'.length)));
    assert.equal(await removerImagemLocal(urlPromocao, pasta, 11), true);
    await assert.rejects(stat(join(pasta, urlPromocao.slice('/uploads/'.length))), { code: 'ENOENT' });
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
  const urlPromocaoA = await salvarImagemDataUrl(pngMinimo, pasta, 11, 'promocao');
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
    const [propriaA, cruzadaA, propriaB, legadaA, legadaB, promocaoA, promocaoCruzada] = await Promise.all([
      fetch(`${baseA}${urlA}`),
      fetch(`${baseB}${urlA}`),
      fetch(`${baseB}${urlB}`),
      fetch(`${baseA}${urlLegada}`),
      fetch(`${baseB}${urlLegada}`),
      fetch(`${baseA}${urlPromocaoA}`),
      fetch(`${baseB}${urlPromocaoA}`)
    ]);
    assert.equal(propriaA.status, 200);
    assert.equal(propriaA.headers.get('content-type'), 'image/png');
    assert.equal(cruzadaA.status, 404);
    assert.equal(propriaB.status, 200);
    assert.equal(legadaA.status, 200);
    assert.equal(legadaB.status, 404);
    // A foto da promoção é servida para a própria loja e continua isolada das outras.
    assert.equal(promocaoA.status, 200);
    assert.equal(promocaoCruzada.status, 404);
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
      formas_pagamento_json: null,
      politica_cancelamento: null,
      informacoes_legais: null
    }]
  ]);
  const areasPorLoja = new Map([
    [11, [
      { id: 3, nome: 'Centro', taxa_entrega_centavos: 500, tempo_estimado_min: 30, tempo_estimado_max: 45, ativo: 1 },
      { id: 4, nome: 'Desativada', taxa_entrega_centavos: 900, tempo_estimado_min: 50, tempo_estimado_max: 70, ativo: 0 }
    ]]
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
      if (sql.includes('FROM areas_entrega')) {
        assert.equal(/SELECT\s+\*/i.test(sql), false);
        return [areasPorLoja.get(Number(parametros[0])) ?? []];
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
    // Só áreas ativas saem para o público; a desativada ainda conta como cadastro.
    assert.deepEqual(configuracaoA.areasEntrega, [
      { id: 3, nome: 'Centro', bairro: 'Centro', taxa: 5, tempoEstimadoMin: 30, tempoEstimadoMax: 45 }
    ]);
    assert.equal(configuracaoA.entregaPorArea, true);
    assert.equal('pedidoMinimo' in configuracaoA, false);
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
    assert.equal(configuracaoB.entregaPorArea, false);
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
    lojaAbertaManual: true,
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
  assert.equal(gravacao.parametros[11], '/uploads/banner-seguro.webp');
  assert.equal(gravacao.parametros[12], 'O Verdadeiro Hambúrguer Artesanal');
  assert.equal(gravacao.parametros[13], 'Carne grelhada na hora, sempre fresca.');
  assert.equal(gravacao.parametros[14], 'Peça agora');
  assert.equal(gravacao.parametros[15], 'cardapio');
  assert.equal(gravacao.parametros[16], 'Nosso cardápio');
  assert.equal(gravacao.parametros[17], 'Escolha o seu hambúrguer favorito.');
  assert.equal(gravacao.parametros[18], 'Hambúrguer de verdade, feito do nosso jeito.');
  assert.equal(gravacao.parametros[19], 'Ingredientes selecionados e preparo na hora.');
  assert.equal(gravacao.parametros[20], 'Feito com carinho para você.');
  assert.deepEqual(JSON.parse(gravacao.parametros[30]), ['Cartão', 'Dinheiro']);
  assert.equal(gravacao.parametros[31], 'Cancelamento antes do preparo.');
  assert.equal(gravacao.parametros[32], 'Informações legais da Loja A.');
  // Pedido mínimo e a lista antiga de bairros saíram: mesmo enviados, nada é gravado.
  assert.equal(/pedido_minimo_centavos|areas_entrega_json/.test(gravacao.sql), false);
  assert.equal(gravacao.parametros.length, 35);
  // Cores e fonte pertencem ao superadministrador: o painel do estabelecimento
  // não pode gravar essas colunas nem enviando os campos na requisição.
  assert.equal(/cor_principal|cor_secundaria|cor_fundo|cor_card|cor_texto|fonte/i.test(gravacao.sql), false);
  assert.equal(gravacao.parametros.includes('#E95420'), false);
  assert.equal(gravacao.parametros.includes('Georgia'), false);
  // O funcionamento manual só muda por lojaAbertaManual, campo mapeado à parte.
  assert.equal(gravacao.parametros[6], 1);
  assert.equal(gravacao.parametros[33], null);
  assert.equal(gravacao.parametros[34], 0);

  const auditoria = comandos.find(({ sql }) => sql.includes('INSERT INTO auditoria_admin'));
  assert.deepEqual(auditoria.parametros.slice(0, 5), [11, 7, 'configuracao.atualizada', 'configuracao', '11']);

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
  assert.equal(ultimaGravacao.parametros[14], null);
  assert.equal(ultimaGravacao.parametros[15], null);
  assert.equal(conexoesAbertas, 2);

  // Horário automático: a grade vira a fonte do texto público e do estado.
  await salvarConfiguracao(banco, 11, {
    ...dados,
    lojaAbertaManual: false,
    funcionamentoAutomatico: true,
    horarios: [{ dia: 1, aberto: true, abre: '19:00', fecha: '23:00' }]
  }, 7);
  const comHorario = comandos
    .filter(({ sql }) => sql.includes('INSERT INTO configuracoes_estabelecimento'))
    .at(-1);
  assert.equal(comHorario.parametros[34], 1);
  assert.equal(comHorario.parametros[6], 0);
  assert.equal(comHorario.parametros[22], 'Segunda-feira: 19:00 às 23:00');
  assert.deepEqual(
    JSON.parse(comHorario.parametros[33])[1],
    { dia: 1, aberto: true, abre: '19:00', fecha: '23:00' }
  );
  await assert.rejects(
    salvarConfiguracao(banco, 11, { ...dados, funcionamentoAutomatico: true, horarios: [] }, 7),
    /ao menos um dia/
  );
  await assert.rejects(
    salvarConfiguracao(banco, 11, {
      ...dados,
      horarios: [{ dia: 1, aberto: true, abre: '19:00', fecha: '19:00' }]
    }, 7),
    /diferentes/
  );
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
      if (sql.includes('INSERT INTO administradores')) return [{ insertId: 91 }];
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
  const insertPermissoes = comandos.find(({ sql }) => sql.includes('INSERT INTO administrador_permissoes'));
  assert.equal(insertPermissoes.parametros.length, 13 * 3);
  assert.deepEqual([...new Set(insertPermissoes.parametros.filter((_, indice) => indice % 3 === 0))], [44]);
  assert.deepEqual([...new Set(insertPermissoes.parametros.filter((_, indice) => indice % 3 === 1))], [91]);
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
      if (sql.includes('FROM administrador_permissoes ap')) return [[{ permissao: 'pedidos.visualizar' }]];
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

test('recorta o período dos indicadores no fuso da loja e trata período sem vendas', async () => {
  // 13/09/2026, 23h30 em São Paulo: no UTC já é dia 14.
  const agora = new Date('2026-09-14T02:30:00.000Z');
  const inicio = (periodo) => intervaloIndicadores(periodo, agora).inicio.toISOString();
  assert.equal(inicio('hoje'), '2026-09-13T03:00:00.000Z');
  assert.equal(inicio('7dias'), '2026-09-07T03:00:00.000Z');
  assert.equal(inicio('30dias'), '2026-08-15T03:00:00.000Z');
  assert.equal(inicio('mes'), '2026-09-01T03:00:00.000Z');
  assert.equal(intervaloIndicadores('mes', agora).fim.toISOString(), '2026-09-14T03:00:00.000Z');
  assert.throws(() => intervaloIndicadores('1ano', agora), (erro) => erro.status === 400);

  const consultas = [];
  const bancoSemVendas = {
    async execute(sql, parametros) {
      consultas.push({ sql, parametros });
      return [sql.includes('FROM pedido_itens itp') ? [] : [{ pedidos: 0, receita_centavos: 0 }]];
    }
  };
  const vazio = await buscarIndicadoresDashboard(bancoSemVendas, 7, undefined, agora);
  assert.equal(vazio.periodo, '30dias');
  assert.deepEqual(vazio.ticketMedio, { valor: null, receita: 0, pedidos: 0 });
  assert.deepEqual(vazio.produtosMaisVendidos, []);
  assert.equal(consultas.length, 2);
  for (const { sql, parametros } of consultas) {
    assert.deepEqual(parametros, [7, '2026-08-15 03:00:00', '2026-09-14 03:00:00']);
    assert.match(sql, /p\.status <> 'Cancelado'/);
    assert.match(sql, /pg\.status = 'Pago'/);
    assert.equal(/SELECT\s+\*/i.test(sql), false);
  }

  const bancoComVendas = {
    async execute(sql) {
      return [sql.includes('FROM pedido_itens itp')
        ? [
          { produto_id: 3, nome_produto: 'X-Bacon', quantidade: 4, receita_centavos: 12000 },
          { produto_id: null, nome_produto: 'Produto excluído do cardápio', quantidade: 4, receita_centavos: 8000 }
        ]
        : [{ pedidos: 3, receita_centavos: 10000 }]];
    }
  };
  const comVendas = await buscarIndicadoresDashboard(bancoComVendas, 7, 'hoje', agora);
  assert.deepEqual(comVendas.ticketMedio, { valor: 33.33, receita: 100, pedidos: 3 });
  assert.deepEqual(comVendas.produtosMaisVendidos, [
    { posicao: 1, produtoId: 3, nome: 'X-Bacon', quantidade: 4, receita: 120 },
    { posicao: 2, produtoId: null, nome: 'Produto excluído do cardápio', quantidade: 4, receita: 80 }
  ]);
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

/* Banco simulado do fechamento de pedido: loja 11, produto 5 a R$ 49,90 e as
   áreas informadas (de qualquer loja). Guarda o que foi gravado em pedidos. */
function bancoPedidoComAreas({ areas = [], taxaUnicaCentavos = 700 } = {}) {
  const estado = { pedido: null };
  const catalogo = conexaoCatalogo();
  const conexao = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, parametros = []) {
      assert.equal(/SELECT\s+\*/i.test(sql), false);
      if (sql.includes('FROM configuracoes_estabelecimento')) {
        return [[{
          loja_aberta: 1, funcionamento_automatico: 0, horarios_json: null,
          entrega_ativa: 1, retirada_ativa: 1, aceita_cartao: 1, aceita_dinheiro: 1,
          pix_chave: null, pix_beneficiario: null, pix_cidade: null,
          taxa_entrega_centavos: taxaUnicaCentavos
        }]];
      }
      if (sql.includes('FROM produtos p')) return catalogo.execute(sql, parametros);
      if (sql.includes('FROM areas_entrega')) {
        assert.equal(Number(parametros[0]), 11, 'área consultada fora da loja do pedido');
        const daLoja = areas.filter((area) => area.tenant === Number(parametros[0]));
        if (sql.includes('COUNT(id)')) {
          return [[{ total: daLoja.length, ativas: String(daLoja.filter((area) => area.ativo).length) }]];
        }
        const porId = sql.includes('AND id = ?');
        const area = daLoja.find((item) => item.ativo && (porId
          ? item.id === Number(parametros[1])
          : item.nome.toLowerCase() === String(parametros[1]).toLowerCase()));
        return [[area && { id: area.id, nome: area.nome, taxa_entrega_centavos: area.taxaCentavos }].filter(Boolean)];
      }
      if (sql.includes('INSERT INTO pedidos')) {
        estado.pedido = parametros;
        return [{ insertId: 900 }];
      }
      if (/^\s*INSERT\b/i.test(sql)) return [{ insertId: 1 }];
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };
  const banco = {
    async getConnection() { return conexao; },
    async execute(sql) {
      if (sql.includes('FROM pedidos p') && estado.pedido) {
        const p = estado.pedido;
        return [[{
          id: 900, origem: p[3], cliente: p[4], telefone: p[5], email: null, status: 'Recebido',
          pagamento: p[6], rua: p[7], numero: p[8], bairro: p[9], area_entrega_id: p[10],
          complemento: p[11], referencia: p[12], taxa_entrega_centavos: p[13], total_centavos: p[14],
          comanda_id: null, mesa_id: null, funcionario_id: null, criado_em: new Date(),
          pagamento_status: 'Pagamento na entrega', sem_troco: null, troco_para_centavos: null
        }]];
      }
      if (/^\s*SELECT\b/i.test(sql)) return [[]];
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };
  return { banco, estado };
}

function pedidoDeliveryTeste(sobrescritas = {}) {
  return {
    nome: 'Cliente',
    telefone: '(11) 90000-0000',
    rua: 'Rua A',
    numero: '10',
    bairro: 'Centro',
    modalidade: 'delivery',
    pagamento: 'Cartão na entrega',
    chaveIdempotencia: randomUUID(),
    itens: [{ produtoId: 5, quantidade: 1 }],
    ...sobrescritas
  };
}

test('fecha o pedido com a taxa da área escolhida e ignora taxa e total enviados pelo navegador', async () => {
  const areas = [
    { id: 1, tenant: 11, nome: 'Centro', taxaCentavos: 500, ativo: true },
    { id: 2, tenant: 11, nome: 'Bairro Sul', taxaCentavos: 850, ativo: true },
    { id: 77, tenant: 22, nome: 'Área da loja B', taxaCentavos: 0, ativo: true }
  ];
  const { banco, estado } = bancoPedidoComAreas({ areas });
  const pedido = await criarPedidoDelivery(banco, 11, pedidoDeliveryTeste({
    areaEntregaId: 2,
    bairro: 'Centro',
    taxaEntrega: 0,
    taxaEntregaCentavos: 0,
    total: 0.01,
    email: 'nao-deve-ser-gravado@teste.local'
  }));
  assert.equal(pedido.taxaEntrega, 8.5);
  assert.equal(pedido.total, 58.4);
  assert.equal(pedido.areaEntregaId, 2);
  // Grava o id da área, o nome dela como bairro e a taxa do momento.
  assert.equal(estado.pedido[9], 'Bairro Sul');
  assert.equal(estado.pedido[10], 2);
  assert.equal(estado.pedido[13], 850);
  assert.equal(estado.pedido[14], 5840);
  // O e-mail saiu do checkout: nem a coluna nem o valor enviado entram no INSERT.
  assert.equal(estado.pedido.length, 15);
  assert.equal(estado.pedido.includes('nao-deve-ser-gravado@teste.local'), false);

  const peloNome = bancoPedidoComAreas({ areas });
  assert.equal((await criarPedidoDelivery(peloNome.banco, 11, pedidoDeliveryTeste({ bairro: 'bairro sul' }))).taxaEntrega, 8.5);

  // Área de outra loja, id que não existe e bairro fora da cobertura.
  for (const dados of [{ areaEntregaId: 77 }, { areaEntregaId: 999 }, { areaEntregaId: undefined, bairro: 'Longe' }]) {
    const simulado = bancoPedidoComAreas({ areas });
    await assert.rejects(criarPedidoDelivery(simulado.banco, 11, pedidoDeliveryTeste(dados)), (erro) => erro.status === 409);
    assert.equal(simulado.estado.pedido, null);
  }
  for (const areaEntregaId of ['abc', -2, 1.5, true, { id: 2 }]) {
    await assert.rejects(
      criarPedidoDelivery(bancoPedidoComAreas({ areas }).banco, 11, pedidoDeliveryTeste({ areaEntregaId })),
      (erro) => erro.status === 400 && /área de entrega válida/i.test(erro.message)
    );
  }
});

test('sem áreas cadastradas o pedido usa a taxa única; com todas desativadas o delivery é recusado', async () => {
  const semAreas = bancoPedidoComAreas({ taxaUnicaCentavos: 700 });
  const pedido = await criarPedidoDelivery(semAreas.banco, 11, pedidoDeliveryTeste({ bairro: 'Qualquer Bairro', taxaEntrega: 0 }));
  assert.equal(pedido.taxaEntrega, 7);
  assert.equal(pedido.total, 56.9);
  assert.equal(pedido.areaEntregaId, null);
  assert.equal(semAreas.estado.pedido[9], 'Qualquer Bairro');

  const desativadas = bancoPedidoComAreas({ areas: [{ id: 1, tenant: 11, nome: 'Centro', taxaCentavos: 500, ativo: false }] });
  await assert.rejects(
    criarPedidoDelivery(desativadas.banco, 11, pedidoDeliveryTeste()),
    (erro) => erro.status === 409 && /Nenhuma área de entrega disponível/.test(erro.message)
  );
  assert.equal(desativadas.estado.pedido, null);

  // Retirada não passa por área nenhuma, nem valida o id enviado.
  const retirada = await criarPedidoDelivery(desativadas.banco, 11, pedidoDeliveryTeste({
    modalidade: 'retirada',
    pagamento: 'Cartão na retirada',
    areaEntregaId: 'abc'
  }));
  assert.equal(retirada.taxaEntrega, 0);
  assert.equal(desativadas.estado.pedido[10], null);
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

test('CORS libera subdomínio do domínio principal e domínio personalizado cadastrado, mas recusa origem alheia', async () => {
  const banco = {
    async query() { return [[{ 1: 1 }]]; },
    async execute(sql, parametros = []) {
      if (sql.includes('FROM estabelecimentos')) {
        const encontrado = parametros[0] === 'proprio.cliente.com.br';
        return [encontrado ? [{ id_estabelecimento: 1 }] : []];
      }
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };
  const servidor = criarServidor({
    banco,
    pastaUploads: tmpdir(),
    dominioPrincipal: 'exemplo.com',
    corsOrigins: ['https://painel-fixo.exemplo.org']
  });
  await aguardarServidor(servidor, 0);
  const base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    const doSubdominio = await fetch(`${base}/api/saude`, {
      headers: { Origin: 'https://loja1.exemplo.com' }
    });
    assert.equal(doSubdominio.status, 200);
    assert.equal(doSubdominio.headers.get('access-control-allow-origin'), 'https://loja1.exemplo.com');

    const doDominioPersonalizado = await fetch(`${base}/api/saude`, {
      headers: { Origin: 'https://proprio.cliente.com.br' }
    });
    assert.equal(doDominioPersonalizado.status, 200);

    const daListaFixa = await fetch(`${base}/api/saude`, {
      headers: { Origin: 'https://painel-fixo.exemplo.org' }
    });
    assert.equal(daListaFixa.status, 200);

    const semOrigin = await fetch(`${base}/api/saude`);
    assert.equal(semOrigin.status, 200);

    const deOrigemAlheia = await fetch(`${base}/api/saude`, {
      headers: { Origin: 'https://site-nao-relacionado.com' }
    });
    assert.equal(deOrigemAlheia.status, 403);
    assert.match((await deOrigemAlheia.json()).erro, /Origem não autorizada/);
  } finally {
    await fecharServidor(servidor);
  }
});


test('superadministrador troca a própria senha e derruba as sessões antigas', async () => {
  const SENHA_ANTIGA = 'senha-super-antiga-1';
  const SENHA_NOVA = 'senha-super-nova-2026';
  const comandos = [];
  let senhaHashAtual = criarHashSenha(SENHA_ANTIGA);
  let sessoesValidas = true;

  const responderExecucao = (sql) => {
    if (sql.includes('FROM superadministradores') && sql.includes('senha_hash')) {
      return [[{
        id: 1,
        nome: 'Super Teste',
        usuario: 'superteste',
        email: 'super@teste.local',
        senha_hash: senhaHashAtual
      }]];
    }
    if (sql.includes('UPDATE superadministradores SET senha_hash')) return [{ affectedRows: 1 }];
    if (sql.includes('INSERT INTO sessoes_superadmin')) {
      sessoesValidas = true;
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('DELETE FROM sessoes_superadmin WHERE superadministrador_id')) {
      sessoesValidas = false;
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('DELETE FROM sessoes_superadmin')) return [{ affectedRows: 0 }];
    if (sql.includes('FROM sessoes_superadmin ss')) {
      return [sessoesValidas
        ? [{ id: 1, nome: 'Super Teste', usuario: 'superteste', email: 'super@teste.local' }]
        : []];
    }
    if (sql.includes('INSERT INTO auditoria_superadmin')) return [{ affectedRows: 1 }];
    throw new Error(`Consulta inesperada no teste: ${sql}`);
  };

  const conexao = {
    async beginTransaction() { comandos.push({ sql: 'BEGIN', parametros: [] }); },
    async commit() { comandos.push({ sql: 'COMMIT', parametros: [] }); },
    async rollback() { comandos.push({ sql: 'ROLLBACK', parametros: [] }); },
    release() { comandos.push({ sql: 'RELEASE', parametros: [] }); },
    async execute(sql, parametros = []) {
      comandos.push({ sql, parametros });
      if (sql.includes('UPDATE superadministradores SET senha_hash')) {
        senhaHashAtual = parametros[0];
      }
      return responderExecucao(sql);
    }
  };
  const banco = {
    async getConnection() { return conexao; },
    async execute(sql, parametros = []) {
      comandos.push({ sql, parametros });
      return responderExecucao(sql);
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
  const entrar = (senha) => fetch(`${baseUrl}/api/superadmin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Host: 'host-sem-tenant.teste' },
    body: JSON.stringify({ usuario: 'superteste', senha })
  });
  const trocarSenha = (token, dados) => fetch(`${baseUrl}/api/superadmin/senha`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Host: 'host-sem-tenant.teste'
    },
    body: JSON.stringify(dados)
  });

  try {
    const login = await entrar(SENHA_ANTIGA);
    assert.equal(login.status, 200);
    const { token } = await login.json();

    // Sem sessão nenhuma a rota não pode nem chegar na validação de senha.
    const semSessao = await fetch(`${baseUrl}/api/superadmin/senha`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Host: 'host-sem-tenant.teste' },
      body: JSON.stringify({ senhaAtual: SENHA_ANTIGA, novaSenha: SENHA_NOVA, confirmacaoSenha: SENHA_NOVA })
    });
    assert.equal(semSessao.status, 401);

    const senhaAtualErrada = await trocarSenha(token, {
      senhaAtual: 'senha-que-nao-e-a-atual',
      novaSenha: SENHA_NOVA,
      confirmacaoSenha: SENHA_NOVA
    });
    assert.equal(senhaAtualErrada.status, 401);
    assert.equal(comandos.some(({ sql }) => sql.includes('UPDATE superadministradores')), false);
    assert.equal(comandos.some(({ sql }) => sql === 'ROLLBACK'), true);

    const curta = await trocarSenha(token, {
      senhaAtual: SENHA_ANTIGA,
      novaSenha: 'curta123',
      confirmacaoSenha: 'curta123'
    });
    assert.equal(curta.status, 400);

    const semConfirmacao = await trocarSenha(token, {
      senhaAtual: SENHA_ANTIGA,
      novaSenha: SENHA_NOVA,
      confirmacaoSenha: 'outra-coisa-qualquer'
    });
    assert.equal(semConfirmacao.status, 400);
    assert.equal(comandos.some(({ sql }) => sql.includes('UPDATE superadministradores')), false);

    const trocada = await trocarSenha(token, {
      senhaAtual: SENHA_ANTIGA,
      novaSenha: SENHA_NOVA,
      confirmacaoSenha: SENHA_NOVA
    });
    assert.equal(trocada.status, 200);

    const update = comandos.find(({ sql }) => sql.includes('UPDATE superadministradores SET senha_hash'));
    assert.notEqual(update.parametros[0], SENHA_NOVA);
    assert.match(update.parametros[0], /^scrypt:/);
    assert.equal(
      comandos.some(({ sql }) => sql.includes('DELETE FROM sessoes_superadmin WHERE superadministrador_id')),
      true
    );
    const auditoria = comandos.find(({ sql }) => sql.includes('INSERT INTO auditoria_superadmin'));
    assert.equal(auditoria.parametros[2], 'superadministrador.senha_alterada');
    assert.equal(JSON.stringify(auditoria.parametros).includes(SENHA_NOVA), false);
    assert.equal(comandos.some(({ sql }) => sql === 'COMMIT'), true);

    // O token que fez a troca também morre: escopo global não mantém sessão antiga.
    const sessaoAntiga = await fetch(`${baseUrl}/api/superadmin/sessao`, {
      headers: { Authorization: `Bearer ${token}`, Host: 'host-sem-tenant.teste' }
    });
    assert.equal(sessaoAntiga.status, 401);

    assert.equal((await entrar(SENHA_ANTIGA)).status, 401);
    assert.equal((await entrar(SENHA_NOVA)).status, 200);
    assert.equal(comandos.some(({ sql }) => /SELECT\s+\*/i.test(sql)), false);
  } finally {
    await fecharServidor(servidor);
  }
});


/*
  Banco falso com a tabela de superadministradores e as sessões em memória.
  A busca de sessão respeita `sa.ativo = 1` igual ao SQL real, que é o ponto
  central deste teste: desativar precisa derrubar quem já estava logado.
*/
function bancoSuperadministradores() {
  const agora = new Date('2026-09-01T00:00:00.000Z');
  const registros = new Map([[1, {
    id: 1,
    usuario: 'super-a',
    email: 'super-a@teste.local',
    nome: 'Super A',
    senha_hash: criarHashSenha('senha-super-a-2026'),
    ativo: 1,
    criado_em: agora,
    atualizado_em: agora
  }]]);
  const sessoes = new Map();
  const comandos = [];
  let proximoId = 2;

  function responder(sql, parametros = []) {
    if (sql.includes('INSERT INTO superadministradores')) {
      const [usuario, email, nome, senhaHash] = parametros;
      const duplicado = [...registros.values()]
        .some((item) => item.usuario === usuario || item.email === email);
      if (duplicado) {
        const erro = new Error('Duplicate entry');
        erro.code = 'ER_DUP_ENTRY';
        throw erro;
      }
      const id = proximoId;
      proximoId += 1;
      registros.set(id, {
        id, usuario, email, nome, senha_hash: senhaHash, ativo: 1,
        criado_em: agora, atualizado_em: agora
      });
      return [{ insertId: id }];
    }
    if (sql.includes('INSERT INTO sessoes_superadmin')) {
      sessoes.set(parametros[0], Number(parametros[1]));
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('INSERT INTO auditoria_superadmin')) return [{ affectedRows: 1 }];
    if (sql.includes('UPDATE superadministradores SET ativo')) {
      const registro = registros.get(Number(parametros[1]));
      if (registro) registro.ativo = Number(parametros[0]);
      return [{ affectedRows: registro ? 1 : 0 }];
    }
    if (sql.includes('DELETE FROM sessoes_superadmin WHERE superadministrador_id')) {
      for (const [chave, dono] of sessoes) {
        if (dono === Number(parametros[0])) sessoes.delete(chave);
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('DELETE FROM sessoes_superadmin')) return [{ affectedRows: 0 }];
    if (sql.includes('FROM sessoes_superadmin ss')) {
      const registro = registros.get(sessoes.get(parametros[0]));
      if (!registro || registro.ativo !== 1 || registro.id !== Number(parametros[1])) return [[]];
      const { id, nome, usuario, email } = registro;
      return [[{ id, nome, usuario, email }]];
    }
    if (sql.includes('LOWER(usuario)')) {
      const identificador = String(parametros[0]).toLowerCase();
      const achado = [...registros.values()].find((item) => item.ativo === 1
        && (item.usuario === identificador || item.email === identificador));
      return [achado ? [achado] : []];
    }
    if (sql.includes('SELECT COUNT(id) AS total')) {
      const total = [...registros.values()].filter((item) => item.ativo === 1).length;
      return [[{ total }]];
    }
    if (sql.includes('SELECT id FROM superadministradores WHERE id = ?')) {
      const registro = registros.get(Number(parametros[0]));
      return [registro ? [{ id: registro.id }] : []];
    }
    if (sql.includes('FROM superadministradores')) {
      const lista = sql.includes('WHERE id = ?')
        ? [registros.get(Number(parametros[0]))].filter(Boolean)
        : [...registros.values()].sort((a, b) => b.ativo - a.ativo
          || a.nome.localeCompare(b.nome));
      // Espelha exatamente as colunas que SELECAO_SUPERADMINISTRADOR pede.
      return [lista.map((item) => ({
        id: item.id,
        usuario: item.usuario,
        email: item.email,
        nome: item.nome,
        ativo: item.ativo,
        criado_em: item.criado_em,
        atualizado_em: item.atualizado_em
      }))];
    }
    throw new Error(`Consulta inesperada no teste: ${sql}`);
  }

  const conexao = {
    async beginTransaction() { comandos.push({ sql: 'BEGIN', parametros: [] }); },
    async commit() { comandos.push({ sql: 'COMMIT', parametros: [] }); },
    async rollback() { comandos.push({ sql: 'ROLLBACK', parametros: [] }); },
    release() {},
    async execute(sql, parametros = []) {
      comandos.push({ sql, parametros });
      return responder(sql, parametros);
    }
  };
  return {
    comandos,
    registros,
    banco: {
      async getConnection() { return conexao; },
      async execute(sql, parametros = []) {
        comandos.push({ sql, parametros });
        return responder(sql, parametros);
      }
    }
  };
}

test('superadministrador cria, lista e desativa outras contas globais', async () => {
  const { banco, comandos, registros } = bancoSuperadministradores();
  const servidor = criarServidor({
    banco,
    pastaUploads: tmpdir(),
    tenantDesenvolvimento: '',
    jwtSecret: JWT_SECRET_TESTE
  });
  await aguardarServidor(servidor, 0);
  const baseUrl = `http://127.0.0.1:${servidor.address().port}`;
  const cabecalhos = (token) => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    Host: 'host-sem-tenant.teste'
  });
  const entrar = (usuario, senha) => fetch(`${baseUrl}/api/superadmin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Host: 'host-sem-tenant.teste' },
    body: JSON.stringify({ usuario, senha })
  });
  const criar = (token, dados) => fetch(`${baseUrl}/api/superadmin/superadministradores`, {
    method: 'POST', headers: cabecalhos(token), body: JSON.stringify(dados)
  });
  const alterarStatus = (token, id, ativo) => fetch(
    `${baseUrl}/api/superadmin/superadministradores/${id}/status`,
    { method: 'PATCH', headers: cabecalhos(token), body: JSON.stringify({ ativo }) }
  );

  try {
    const login = await entrar('super-a', 'senha-super-a-2026');
    assert.equal(login.status, 200);
    const { token: tokenA } = await login.json();

    const listaInicial = await fetch(`${baseUrl}/api/superadmin/superadministradores`, {
      headers: cabecalhos(tokenA)
    });
    assert.equal(listaInicial.status, 200);
    const { superadministradores: iniciais } = await listaInicial.json();
    assert.equal(iniciais.length, 1);
    assert.equal(iniciais[0].usuario, 'super-a');
    assert.equal(Object.hasOwn(iniciais[0], 'senha_hash'), false);
    assert.equal(Object.hasOwn(iniciais[0], 'senhaHash'), false);

    const dadosB = {
      nome: 'Super B',
      usuario: 'super-b',
      email: 'super-b@teste.local',
      senha: 'senha-super-b-2026',
      confirmacaoSenha: 'senha-super-b-2026'
    };

    const curta = { ...dadosB, senha: 'curta123', confirmacaoSenha: 'curta123' };
    assert.equal((await criar(tokenA, curta)).status, 400);
    assert.equal((await criar(tokenA, { ...dadosB, usuario: 'AB' })).status, 400);
    assert.equal((await criar(tokenA, { ...dadosB, email: 'sem-arroba' })).status, 400);
    assert.equal((await criar(tokenA, { ...dadosB, confirmacaoSenha: 'outra-senha-2026' })).status, 400);
    assert.equal(registros.size, 1);

    const criado = await criar(tokenA, dadosB);
    assert.equal(criado.status, 201);
    const { superadministrador: novo } = await criado.json();
    assert.equal(novo.usuario, 'super-b');
    assert.equal(novo.ativo, true);
    const insercao = comandos.find(({ sql }) => sql.includes('INSERT INTO superadministradores'));
    assert.notEqual(insercao.parametros[3], dadosB.senha);
    assert.match(insercao.parametros[3], /^scrypt:/);

    // Usuário repetido cai no índice único e vira 409, não 500.
    assert.equal((await criar(tokenA, dadosB)).status, 409);

    const auditoriaCriacao = comandos.find(({ sql, parametros }) => sql.includes('INSERT INTO auditoria_superadmin')
      && parametros[2] === 'superadministrador.criado');
    assert.ok(auditoriaCriacao);
    assert.equal(JSON.stringify(auditoriaCriacao.parametros).includes(dadosB.senha), false);

    // A conta nova entra e recebe sessão própria.
    const loginB = await entrar('super-b', dadosB.senha);
    assert.equal(loginB.status, 200);
    const { token: tokenB } = await loginB.json();
    const sessaoB = await fetch(`${baseUrl}/api/superadmin/sessao`, { headers: cabecalhos(tokenB) });
    assert.equal(sessaoB.status, 200);

    // Ninguém pode desativar o próprio acesso nem uma conta inexistente.
    assert.equal((await alterarStatus(tokenA, novo.id + 90, false)).status, 404);
    assert.equal((await alterarStatus(tokenA, 1, false)).status, 409);
    assert.equal(registros.get(1).ativo, 1);

    const desativado = await alterarStatus(tokenA, novo.id, false);
    assert.equal(desativado.status, 200);
    assert.equal((await desativado.json()).superadministrador.ativo, false);
    assert.equal(registros.get(novo.id).ativo, 0);
    // Preservação de dados: a linha continua no banco, só muda o `ativo`.
    assert.equal(registros.size, 2);

    const auditoriaDesativacao = comandos.find(({ sql, parametros }) => sql.includes('INSERT INTO auditoria_superadmin')
      && parametros[2] === 'superadministrador.desativado');
    assert.ok(auditoriaDesativacao);

    // O essencial: a sessão viva morre na hora e o login deixa de funcionar.
    const sessaoMorta = await fetch(`${baseUrl}/api/superadmin/sessao`, { headers: cabecalhos(tokenB) });
    assert.equal(sessaoMorta.status, 401);
    const usoAposDesativar = await criar(tokenB, { ...dadosB, usuario: 'super-c', email: 'c@teste.local' });
    assert.equal(usoAposDesativar.status, 401);
    assert.equal((await entrar('super-b', dadosB.senha)).status, 401);
    assert.equal((await entrar('super-b@teste.local', dadosB.senha)).status, 401);

    // Reativação devolve o acesso sem recriar a conta.
    assert.equal((await alterarStatus(tokenA, novo.id, true)).status, 200);
    assert.equal((await entrar('super-b', dadosB.senha)).status, 200);

    assert.equal(comandos.some(({ sql }) => /SELECT\s+\*/i.test(sql)), false);
  } finally {
    await fecharServidor(servidor);
  }
});

test('a desativação nunca deixa a plataforma sem superadministrador ativo', async () => {
  const comandos = [];
  const conexao = {
    async beginTransaction() {},
    async commit() {},
    async rollback() { comandos.push({ sql: 'ROLLBACK', parametros: [] }); },
    release() {},
    async execute(sql, parametros = []) {
      comandos.push({ sql, parametros });
      if (sql.includes('SELECT id FROM superadministradores')) return [[{ id: 9 }]];
      if (sql.includes('SELECT COUNT(id) AS total')) return [[{ total: 1 }]];
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    }
  };
  const banco = { async getConnection() { return conexao; } };

  await assert.rejects(
    alternarStatusSuperadministrador(banco, 9, false, 4),
    /ao menos um superadministrador ativo/
  );
  assert.equal(comandos.some(({ sql }) => sql.includes('UPDATE superadministradores')), false);
  assert.equal(comandos.some(({ sql }) => sql === 'ROLLBACK'), true);
});


/*
  Dois estabelecimentos com um administrador cada. O banco falso só devolve o
  administrador quando o par (id, id_estabelecimento) bate, exatamente como o
  índice/filtro do SQL real — é isso que o teste de isolamento precisa provar.
*/
function bancoResetDeSenha() {
  const agora = new Date('2026-09-01T00:00:00.000Z');
  const administradores = new Map([
    [100, {
      id: 100,
      id_estabelecimento: 10,
      usuario: 'admin-loja-a',
      email: 'admin-a@teste.local',
      nome: 'Admin Loja A',
      senha_hash: criarHashSenha('senha-original-loja-a'),
      ativo: 1,
      criado_em: agora
    }],
    [200, {
      id: 200,
      id_estabelecimento: 20,
      usuario: 'admin-loja-b',
      email: 'admin-b@teste.local',
      nome: 'Admin Loja B',
      senha_hash: criarHashSenha('senha-original-loja-b'),
      ativo: 1,
      criado_em: agora
    }]
  ]);
  const estabelecimentos = new Map([
    [10, { id_estabelecimento: 10, nome_fantasia: 'Loja A', slug: 'loja-a' }],
    [20, { id_estabelecimento: 20, nome_fantasia: 'Loja B', slug: 'loja-b' }]
  ]);
  const comandos = [];

  function responder(sql, parametros = []) {
    if (sql.includes('LOWER(usuario)')) {
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
    if (sql.includes('INSERT INTO auditoria_superadmin')) return [{ affectedRows: 1 }];
    if (sql.includes('FROM estabelecimentos e')) {
      const registro = estabelecimentos.get(Number(parametros[0]));
      if (!registro) return [[]];
      return [[{
        ...registro,
        dominio_personalizado: null,
        status: 'ativo',
        plano: 'basico',
        status_assinatura: 'ativa',
        vencimento_assinatura_em: null,
        criado_em: agora,
        atualizado_em: agora,
        total_administradores: 1
      }]];
    }
    if (sql.includes('UPDATE administradores SET senha_hash')) {
      // Só altera quando id E id_estabelecimento batem, igual ao WHERE real.
      const registro = administradores.get(Number(parametros[1]));
      if (!registro || registro.id_estabelecimento !== Number(parametros[2])) {
        return [{ affectedRows: 0 }];
      }
      registro.senha_hash = parametros[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('DELETE FROM sessoes_admin')) return [{ affectedRows: 1 }];
    if (sql.includes('FROM administradores')) {
      if (sql.includes('WHERE id = ? AND id_estabelecimento = ?')) {
        const registro = administradores.get(Number(parametros[0]));
        if (!registro || registro.id_estabelecimento !== Number(parametros[1])) return [[]];
        const { id, usuario, nome } = registro;
        return [[{ id, usuario, nome }]];
      }
      const lista = [...administradores.values()]
        .filter((item) => item.id_estabelecimento === Number(parametros[0]))
        .map(({ id, usuario, email, nome, ativo, criado_em: criadoEm }) => ({
          id, usuario, email, nome, ativo, criado_em: criadoEm
        }));
      return [lista];
    }
    throw new Error(`Consulta inesperada no teste: ${sql}`);
  }

  const conexao = {
    async beginTransaction() { comandos.push({ sql: 'BEGIN', parametros: [] }); },
    async commit() { comandos.push({ sql: 'COMMIT', parametros: [] }); },
    async rollback() { comandos.push({ sql: 'ROLLBACK', parametros: [] }); },
    release() {},
    async execute(sql, parametros = []) {
      comandos.push({ sql, parametros });
      return responder(sql, parametros);
    }
  };
  return {
    comandos,
    administradores,
    banco: {
      async getConnection() { return conexao; },
      async execute(sql, parametros = []) {
        comandos.push({ sql, parametros });
        return responder(sql, parametros);
      }
    }
  };
}

test('superadmin reseta a senha do admin somente dentro do estabelecimento informado', async () => {
  const { banco, comandos, administradores } = bancoResetDeSenha();
  const servidor = criarServidor({
    banco,
    pastaUploads: tmpdir(),
    tenantDesenvolvimento: '',
    jwtSecret: JWT_SECRET_TESTE
  });
  await aguardarServidor(servidor, 0);
  const baseUrl = `http://127.0.0.1:${servidor.address().port}`;
  const NOVA_SENHA = 'senha-redefinida-2026';

  try {
    const login = await fetch(`${baseUrl}/api/superadmin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'host-sem-tenant.teste' },
      body: JSON.stringify({ usuario: 'superteste', senha: 'senha-global-segura' })
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const cabecalhos = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Host: 'host-sem-tenant.teste'
    };
    const resetar = (idEstabelecimento, idAdministrador, corpo) => fetch(
      `${baseUrl}/api/superadmin/estabelecimentos/${idEstabelecimento}/administradores/${idAdministrador}/senha`,
      { method: 'PUT', headers: cabecalhos, body: JSON.stringify(corpo) }
    );
    const senhas = { novaSenha: NOVA_SENHA, confirmacaoSenha: NOVA_SENHA };

    // A listagem por estabelecimento não vaza administrador do outro tenant.
    const listaA = await fetch(`${baseUrl}/api/superadmin/estabelecimentos/10/administradores`, {
      headers: cabecalhos
    });
    assert.equal(listaA.status, 200);
    const { administradores: doTenantA } = await listaA.json();
    assert.equal(doTenantA.length, 1);
    assert.equal(doTenantA[0].id, 100);
    assert.equal(Object.hasOwn(doTenantA[0], 'senha_hash'), false);
    assert.equal((await fetch(`${baseUrl}/api/superadmin/estabelecimentos/77/administradores`, {
      headers: cabecalhos
    })).status, 404);

    const hashOriginalB = administradores.get(200).senha_hash;

    // O CENTRO DO PASSO: admin da loja B pedido com o id da loja A vira 404.
    const cruzado = await resetar(10, 200, senhas);
    assert.equal(cruzado.status, 404);
    // E nada foi escrito: nem UPDATE, nem sessão derrubada, nem auditoria.
    assert.equal(comandos.some(({ sql }) => sql.includes('UPDATE administradores')), false);
    assert.equal(comandos.some(({ sql }) => sql.includes('DELETE FROM sessoes_admin')), false);
    assert.equal(comandos.some(({ sql }) => sql.includes('INSERT INTO auditoria_superadmin')), false);
    assert.equal(administradores.get(200).senha_hash, hashOriginalB);
    assert.equal(verificarSenha('senha-original-loja-b', administradores.get(200).senha_hash), true);
    assert.equal(verificarSenha(NOVA_SENHA, administradores.get(200).senha_hash), false);

    // O caminho inverso também: admin da loja A pedido com o id da loja B.
    assert.equal((await resetar(20, 100, senhas)).status, 404);
    assert.equal(verificarSenha('senha-original-loja-a', administradores.get(100).senha_hash), true);

    assert.equal((await resetar(10, 999, senhas)).status, 404);
    assert.equal((await resetar(77, 100, senhas)).status, 404);

    const curta = { novaSenha: 'curta123', confirmacaoSenha: 'curta123' };
    assert.equal((await resetar(10, 100, curta)).status, 400);
    assert.equal((await resetar(10, 100, { novaSenha: NOVA_SENHA, confirmacaoSenha: 'outra' })).status, 400);
    assert.equal(comandos.some(({ sql }) => sql.includes('UPDATE administradores')), false);

    // Par correto: a troca acontece.
    const correto = await resetar(10, 100, senhas);
    assert.equal(correto.status, 200);
    const { administrador } = await correto.json();
    assert.equal(administrador.id, 100);
    assert.equal(administrador.usuario, 'admin-loja-a');
    assert.equal(verificarSenha(NOVA_SENHA, administradores.get(100).senha_hash), true);
    assert.equal(verificarSenha('senha-original-loja-a', administradores.get(100).senha_hash), false);

    // Toda escrita levou o tenant junto do id, nunca o id sozinho.
    const update = comandos.find(({ sql }) => sql.includes('UPDATE administradores SET senha_hash'));
    assert.match(update.sql, /id = \? AND id_estabelecimento = \?/);
    assert.deepEqual(update.parametros.slice(1), [100, 10]);
    assert.match(update.parametros[0], /^scrypt:/);
    const remocao = comandos.find(({ sql }) => sql.includes('DELETE FROM sessoes_admin'));
    assert.deepEqual(remocao.parametros, [100, 10]);

    const auditoria = comandos.find(({ sql }) => sql.includes('INSERT INTO auditoria_superadmin'));
    assert.equal(auditoria.parametros[0], 1);
    assert.equal(auditoria.parametros[1], 10);
    assert.equal(auditoria.parametros[2], 'administrador.senha_redefinida');
    assert.equal(JSON.stringify(auditoria.parametros).includes(NOVA_SENHA), false);
    assert.equal(comandos.some(({ sql }) => sql === 'COMMIT'), true);
    assert.equal(comandos.some(({ sql }) => /SELECT\s+\*/i.test(sql)), false);

    // Sessão de administrador não abre essas rotas: elas são só do superadmin.
    const tokenAdmin = criarJwt({
      idUsuario: 100,
      perfil: 'administrador',
      idEstabelecimento: 10,
      duracaoMs: 60_000,
      segredo: JWT_SECRET_TESTE
    });
    const proibido = await fetch(
      `${baseUrl}/api/superadmin/estabelecimentos/10/administradores/100/senha`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
        body: JSON.stringify(senhas)
      }
    );
    assert.equal(proibido.status, 403);
  } finally {
    await fecharServidor(servidor);
  }
});


test('a rota de auditoria pagina, filtra por estabelecimento e por período', async () => {
  const consultas = [];
  const banco = {
    async execute(sql, parametros = []) {
      consultas.push({ sql, parametros });
      if (sql.includes('LOWER(usuario)')) {
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
      if (sql.includes('SELECT COUNT(a.id) AS total')) return [[{ total: 7 }]];
      if (sql.includes('FROM auditoria_superadmin a')) {
        return [[
          {
            id: 42,
            superadministrador_id: 1,
            id_estabelecimento: 10,
            acao: 'administrador.senha_redefinida',
            detalhes_json: '{"administrador":100,"usuario":"admin-loja-a"}',
            criado_em: new Date('2026-09-05T12:00:00.000Z'),
            superadministrador_nome: 'Super Teste',
            superadministrador_usuario: 'superteste',
            estabelecimento_nome: 'Loja A',
            estabelecimento_slug: 'loja-a'
          },
          {
            id: 41,
            superadministrador_id: 1,
            id_estabelecimento: null,
            acao: 'superadministrador.criado',
            detalhes_json: { alvo: 2, usuario: 'super-b' },
            criado_em: new Date('2026-09-04T12:00:00.000Z'),
            superadministrador_nome: 'Super Teste',
            superadministrador_usuario: 'superteste',
            estabelecimento_nome: null,
            estabelecimento_slug: null
          }
        ]];
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
    const { token } = await login.json();
    const cabecalhos = { Authorization: `Bearer ${token}`, Host: 'host-sem-tenant.teste' };
    const auditoria = (consulta) => fetch(`${baseUrl}/api/superadmin/auditoria${consulta}`, {
      headers: cabecalhos
    });

    const semFiltro = await auditoria('');
    assert.equal(semFiltro.status, 200);
    const corpo = await semFiltro.json();
    assert.equal(corpo.registros.length, 2);
    assert.deepEqual(corpo.paginacao, { pagina: 1, limite: 50, total: 7, paginas: 1 });

    // Registro com estabelecimento traz o tenant resolvido e o JSON já lido.
    assert.equal(corpo.registros[0].acao, 'administrador.senha_redefinida');
    assert.equal(corpo.registros[0].estabelecimento.nomeFantasia, 'Loja A');
    assert.equal(corpo.registros[0].superadministrador.usuario, 'superteste');
    assert.equal(corpo.registros[0].detalhes.usuario, 'admin-loja-a');
    // Ação global não tem estabelecimento, e o JSON já vem como objeto do driver.
    assert.equal(corpo.registros[1].estabelecimento, null);
    assert.equal(corpo.registros[1].detalhes.usuario, 'super-b');

    const listagemSemFiltro = consultas.at(-1);
    assert.equal(listagemSemFiltro.sql.includes('WHERE'), false);
    assert.deepEqual(listagemSemFiltro.parametros, []);
    assert.match(listagemSemFiltro.sql, /LIMIT 50 OFFSET 0/);

    // Filtro por estabelecimento e por período viram parâmetros, não texto no SQL.
    const filtrada = await auditoria('?estabelecimento=10&de=2026-09-01&ate=2026-09-05&pagina=2&limite=3');
    assert.equal(filtrada.status, 200);
    const { paginacao } = await filtrada.json();
    assert.deepEqual(paginacao, { pagina: 2, limite: 3, total: 7, paginas: 3 });

    const listagemFiltrada = consultas.at(-1);
    assert.match(listagemFiltrada.sql, /a\.id_estabelecimento = \?/);
    assert.match(listagemFiltrada.sql, /a\.criado_em >= \?/);
    assert.match(listagemFiltrada.sql, /a\.criado_em <= \?/);
    assert.deepEqual(listagemFiltrada.parametros, [10, '2026-09-01 00:00:00', '2026-09-05 23:59:59']);
    assert.match(listagemFiltrada.sql, /LIMIT 3 OFFSET 3/);

    // O limite tem teto e a página não passa da última existente.
    await auditoria('?limite=9999&pagina=9999');
    assert.match(consultas.at(-1).sql, /LIMIT 200 OFFSET 0/);

    // Entrada inválida é recusada antes de virar consulta.
    assert.equal((await auditoria('?de=ontem')).status, 400);
    assert.equal((await auditoria('?ate=2026-13-45')).status, 400);
    // Texto no lugar do número cai no padrão, sem quebrar nem filtrar errado.
    assert.equal((await auditoria('?estabelecimento=abc')).status, 200);
    assert.deepEqual(consultas.at(-1).parametros, []);

    assert.equal(consultas.some(({ sql }) => /SELECT\s+\*/i.test(sql)), false);

    // Sessão de administrador não enxerga a auditoria global.
    const tokenAdmin = criarJwt({
      idUsuario: 7,
      perfil: 'administrador',
      idEstabelecimento: 10,
      duracaoMs: 60_000,
      segredo: JWT_SECRET_TESTE
    });
    const proibido = await fetch(`${baseUrl}/api/superadmin/auditoria`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` }
    });
    assert.equal(proibido.status, 403);
    const semSessao = await fetch(`${baseUrl}/api/superadmin/auditoria`);
    assert.equal(semSessao.status, 401);
  } finally {
    await fecharServidor(servidor);
  }
});

/*
  Banco em memória das ações do superadmin sobre o cadastro do estabelecimento.
  Registra cada comando e emula só as consultas que listagem, edição e ciclo
  de vida fazem, respeitando o estado de origem que cada UPDATE exige.
*/
function bancoCadastroEstabelecimentos(linhasIniciais) {
  const lojas = new Map(linhasIniciais.map((linha) => [linha.id_estabelecimento, {
    dominio_personalizado: null,
    status: 'ativo',
    suspenso_em: null,
    motivo_suspensao: null,
    arquivado_em: null,
    arquivado_por: null,
    plano: 'basico',
    status_assinatura: 'ativa',
    vencimento_assinatura_em: null,
    criado_em: new Date('2026-09-01T00:00:00.000Z'),
    atualizado_em: new Date('2026-09-01T00:00:00.000Z'),
    ...linha
  }]));
  const comandos = [];
  const auditoria = [];

  function responder(sql, parametros = []) {
    comandos.push({ sql, parametros });
    if (sql.includes('FOR UPDATE') && sql.includes('FROM estabelecimentos')) {
      const loja = lojas.get(Number(parametros[0]));
      return [loja ? [{ ...loja }] : []];
    }
    if (sql.includes('FROM estabelecimentos e')) {
      if (sql.includes('WHERE e.id_estabelecimento = ?')) {
        const loja = lojas.get(Number(parametros[0]));
        return [loja ? [{ ...loja, total_administradores: 1 }] : []];
      }
      let lista = [...lojas.values()];
      if (sql.includes("e.status <> 'arquivado'")) lista = lista.filter((loja) => loja.status !== 'arquivado');
      if (sql.includes('e.status = ?')) lista = lista.filter((loja) => loja.status === parametros[0]);
      return [lista.map((loja) => ({ ...loja, total_administradores: 1 }))];
    }
    if (sql.includes('UPDATE estabelecimentos') && sql.includes('nome_fantasia = ?')) {
      const [nomeFantasia, slug, dominio, plano, statusAssinatura, vencimento, id] = parametros;
      Object.assign(lojas.get(Number(id)), {
        nome_fantasia: nomeFantasia,
        slug,
        dominio_personalizado: dominio,
        plano,
        status_assinatura: statusAssinatura,
        vencimento_assinatura_em: vencimento
      });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('UPDATE estabelecimentos')) {
      const loja = lojas.get(Number(parametros.at(-1)));
      const origem = sql.match(/AND status = '(\w+)'/)?.[1];
      const destino = sql.match(/SET status = '(\w+)'/)?.[1];
      if (!loja || loja.status !== origem) return [{ affectedRows: 0 }];
      if (destino === 'suspenso' && origem === 'ativo') {
        Object.assign(loja, { status: 'suspenso', suspenso_em: new Date(), motivo_suspensao: parametros[0] });
      } else if (destino === 'ativo') {
        Object.assign(loja, { status: 'ativo', suspenso_em: null, motivo_suspensao: null });
      } else if (destino === 'arquivado') {
        Object.assign(loja, { status: 'arquivado', arquivado_em: new Date(), arquivado_por: parametros[0] });
      } else {
        Object.assign(loja, { status: 'suspenso', arquivado_em: null, arquivado_por: null });
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('INSERT INTO configuracoes_estabelecimento')) return [{ affectedRows: 1 }];
    if (sql.includes('DELETE FROM sessoes_admin') || sql.includes('DELETE FROM sessoes_garcom')) {
      return [{ affectedRows: 0 }];
    }
    if (sql.includes('INSERT INTO auditoria_superadmin')) {
      auditoria.push({
        superadministradorId: parametros[0],
        idEstabelecimento: parametros[1],
        acao: parametros[2],
        detalhes: JSON.parse(parametros[3])
      });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Consulta inesperada no teste: ${sql}`);
  }

  const conexao = {
    async beginTransaction() { comandos.push({ sql: 'BEGIN', parametros: [] }); },
    async commit() { comandos.push({ sql: 'COMMIT', parametros: [] }); },
    async rollback() { comandos.push({ sql: 'ROLLBACK', parametros: [] }); },
    release() {},
    async execute(sql, parametros) { return responder(sql, parametros); }
  };
  return {
    lojas,
    comandos,
    auditoria,
    banco: {
      async getConnection() { return conexao; },
      async execute(sql, parametros) { return responder(sql, parametros); }
    }
  };
}

async function statusDoErro(promessa) {
  try {
    await promessa;
  } catch (erro) {
    return { status: erro.status, mensagem: erro.message };
  }
  assert.fail('A operação deveria ter sido recusada.');
}

test('ciclo de vida só aceita as transições previstas e responde 409 às demais', async () => {
  const { banco, lojas, comandos, auditoria } = bancoCadastroEstabelecimentos([
    { id_estabelecimento: 11, nome_fantasia: 'Loja A', slug: 'loja-a' }
  ]);
  const loja = lojas.get(11);
  const escritasDeStatus = () => comandos.filter(({ sql }) => /UPDATE estabelecimentos\s+SET status/.test(sql)).length;

  // Motivo obrigatório, com trim, de 1 a 280 caracteres: 400 sem abrir transação.
  for (const motivo of [undefined, '', '   ', 'x'.repeat(281)]) {
    assert.equal((await statusDoErro(suspenderEstabelecimento(banco, 11, { motivo }, 1))).status, 400);
  }
  assert.equal(comandos.length, 0);

  // Arquivar sem estar suspenso.
  const semSuspender = await statusDoErro(arquivarEstabelecimento(banco, 11, { confirmacaoSlug: 'loja-a' }, 1));
  assert.equal(semSuspender.status, 409);
  assert.match(semSuspender.mensagem, /Suspenda/);
  assert.equal((await statusDoErro(reativarEstabelecimento(banco, 11, 1))).status, 409);
  assert.equal((await statusDoErro(desarquivarEstabelecimento(banco, 11, 1))).status, 409);
  assert.equal(escritasDeStatus(), 0);

  // ativo -> suspenso, com o motivo sem espaços nas pontas.
  const suspenso = await suspenderEstabelecimento(banco, 11, { motivo: `  ${'m'.repeat(280)}  ` }, 1);
  assert.equal(suspenso.status, 'suspenso');
  assert.equal(suspenso.motivoSuspensao, 'm'.repeat(280));
  assert.ok(suspenso.suspensoEm);

  // Suspender o que já está suspenso.
  const deNovo = await statusDoErro(suspenderEstabelecimento(banco, 11, { motivo: 'outra vez' }, 1));
  assert.equal(deNovo.status, 409);
  assert.match(deNovo.mensagem, /já está suspenso/);
  assert.equal(loja.motivo_suspensao, 'm'.repeat(280));

  // Arquivar pede o slug exato.
  assert.equal((await statusDoErro(arquivarEstabelecimento(banco, 11, {}, 1))).status, 400);
  assert.equal((await statusDoErro(arquivarEstabelecimento(banco, 11, { confirmacaoSlug: 'loja-b' }, 1))).status, 400);
  assert.equal(loja.status, 'suspenso');

  // suspenso -> ativo limpa data e motivo.
  const reativado = await reativarEstabelecimento(banco, 11, 1);
  assert.equal(reativado.status, 'ativo');
  assert.equal(loja.suspenso_em, null);
  assert.equal(loja.motivo_suspensao, null);

  // suspenso -> arquivado grava data e autor.
  await suspenderEstabelecimento(banco, 11, { motivo: 'Encerramento do contrato' }, 1);
  const arquivado = await arquivarEstabelecimento(banco, 11, { confirmacaoSlug: ' loja-a ' }, 7);
  assert.equal(arquivado.status, 'arquivado');
  assert.equal(arquivado.arquivadoPor, 7);
  assert.ok(arquivado.arquivadoEm);

  // Arquivado não reativa, não suspende e não arquiva de novo.
  const reativarArquivado = await statusDoErro(reativarEstabelecimento(banco, 11, 1));
  assert.equal(reativarArquivado.status, 409);
  assert.match(reativarArquivado.mensagem, /Desarquive/);
  assert.equal((await statusDoErro(suspenderEstabelecimento(banco, 11, { motivo: 'x' }, 1))).status, 409);
  assert.equal((await statusDoErro(arquivarEstabelecimento(banco, 11, { confirmacaoSlug: 'loja-a' }, 1))).status, 409);

  // arquivado -> suspenso limpa o arquivamento e mantém a suspensão original.
  const desarquivado = await desarquivarEstabelecimento(banco, 11, 1);
  assert.equal(desarquivado.status, 'suspenso');
  assert.equal(loja.arquivado_em, null);
  assert.equal(loja.arquivado_por, null);
  assert.equal(loja.motivo_suspensao, 'Encerramento do contrato');

  // Id inexistente: null, que a rota transforma em 404.
  assert.equal(await suspenderEstabelecimento(banco, 999, { motivo: 'x' }, 1), null);
  assert.equal(await reativarEstabelecimento(banco, 999, 1), null);

  // Um evento por ação bem-sucedida, com antes/depois, motivo e autor.
  assert.deepEqual(auditoria.map(({ acao, detalhes }) => [acao, detalhes.status.antes, detalhes.status.depois]), [
    ['estabelecimento.suspenso', 'ativo', 'suspenso'],
    ['estabelecimento.reativado', 'suspenso', 'ativo'],
    ['estabelecimento.suspenso', 'ativo', 'suspenso'],
    ['estabelecimento.arquivado', 'suspenso', 'arquivado'],
    ['estabelecimento.desarquivado', 'arquivado', 'suspenso']
  ]);
  assert.equal(auditoria[0].detalhes.motivo, 'm'.repeat(280));
  assert.equal(auditoria[2].detalhes.motivo, 'Encerramento do contrato');
  assert.equal(Object.hasOwn(auditoria[1].detalhes, 'motivo'), false);
  assert.equal(auditoria[3].superadministradorId, 7);
  assert.equal(auditoria.every(({ idEstabelecimento }) => idEstabelecimento === 11), true);
  // Só suspender e arquivar encerram sessões.
  assert.deepEqual(auditoria.map(({ detalhes }) => Boolean(detalhes.sessoesEncerradas)), [true, false, true, true, false]);

  // Toda leitura do estado travou a linha, e nenhuma consulta usou SELECT *.
  assert.equal(comandos.some(({ sql }) => /SELECT\s+\*/i.test(sql)), false);
  assert.equal(comandos.filter(({ sql }) => sql.includes('FOR UPDATE')).length > 0, true);
});

test('edição ignora status, recusa arquivado e audita o antes/depois do cadastro', async () => {
  const { banco, lojas, comandos, auditoria } = bancoCadastroEstabelecimentos([
    { id_estabelecimento: 11, nome_fantasia: 'Loja A', slug: 'loja-a', plano: 'basico' },
    { id_estabelecimento: 12, nome_fantasia: 'Loja Arquivada', slug: 'loja-arquivada', status: 'arquivado' }
  ]);

  const editado = await atualizarEstabelecimentoGerencial(banco, 11, {
    nomeFantasia: 'Loja A Nova',
    slug: 'loja-a-nova',
    plano: 'premium',
    vencimentoAssinatura: '2027-03-31',
    status: 'arquivado',
    suspensoEm: '2020-01-01',
    arquivadoPor: 99
  }, 1);
  assert.equal(editado.status, 'ativo');
  assert.equal(lojas.get(11).status, 'ativo');
  assert.equal(lojas.get(11).arquivado_por, null);
  const update = comandos.find(({ sql }) => sql.includes('UPDATE estabelecimentos'));
  assert.equal(/\bstatus\s*=/.test(update.sql.replace('status_assinatura', '')), false);
  assert.equal(update.parametros.includes('arquivado'), false);

  const [registro] = auditoria;
  assert.equal(registro.acao, 'estabelecimento.atualizado');
  assert.deepEqual(registro.detalhes.alteracoes, {
    nomeFantasia: { antes: 'Loja A', depois: 'Loja A Nova' },
    slug: { antes: 'loja-a', depois: 'loja-a-nova' },
    plano: { antes: 'basico', depois: 'premium' },
    vencimentoAssinatura: { antes: null, depois: '2027-03-31T23:59:59.000Z' }
  });

  // Arquivado não é editado: 409 antes de qualquer escrita.
  const totalAntes = comandos.length;
  const recusa = await statusDoErro(atualizarEstabelecimentoGerencial(banco, 12, { nomeFantasia: 'Outro' }, 1));
  assert.equal(recusa.status, 409);
  assert.equal(comandos.slice(totalAntes).some(({ sql }) => sql.includes('UPDATE')), false);
  assert.equal(lojas.get(12).nome_fantasia, 'Loja Arquivada');
  assert.equal(auditoria.length, 1);
});

test('slug reservado é recusado na criação e na troca, sem travar tenant antigo', async () => {
  assert.equal(SLUGS_RESERVADOS.has('www'), true);
  assert.equal(SLUGS_RESERVADOS.has('superadmin'), true);
  assert.equal(SLUGS_RESERVADOS.size, 30);

  const administrador = {
    nome: 'Admin', usuario: 'admin-novo', email: 'admin@teste.local', senha: 'senha-admin-segura'
  };
  const bancoQueNaoDeveSerUsado = {
    async getConnection() { throw new Error('Slug reservado não pode abrir transação.'); },
    async execute() { throw new Error('Slug reservado não pode consultar o banco.'); }
  };
  for (const slug of ['www', 'api', 'superadmin', 'webhooks']) {
    const recusa = await statusDoErro(criarEstabelecimentoGerencial(bancoQueNaoDeveSerUsado, {
      nomeFantasia: 'Nova', slug, primeiroAdministrador: administrador
    }, 1));
    assert.equal(recusa.status, 400);
    assert.match(recusa.mensagem, /reservado/);
  }

  const { banco, lojas } = bancoCadastroEstabelecimentos([
    { id_estabelecimento: 11, nome_fantasia: 'Loja A', slug: 'loja-a' },
    // Tenant criado antes da regra, com um slug que hoje é reservado.
    { id_estabelecimento: 12, nome_fantasia: 'Loja App', slug: 'app' }
  ]);
  const troca = await statusDoErro(atualizarEstabelecimentoGerencial(banco, 11, { slug: 'admin' }, 1));
  assert.equal(troca.status, 400);
  assert.equal(lojas.get(11).slug, 'loja-a');

  const antigo = await atualizarEstabelecimentoGerencial(banco, 12, { nomeFantasia: 'Loja App Renomeada' }, 1);
  assert.equal(antigo.slug, 'app');
  assert.equal(antigo.nomeFantasia, 'Loja App Renomeada');
});

test('listagem esconde arquivados por padrão e mostra quando pedido explicitamente', async () => {
  const { banco } = bancoCadastroEstabelecimentos([
    { id_estabelecimento: 11, nome_fantasia: 'Ativa', slug: 'ativa' },
    { id_estabelecimento: 12, nome_fantasia: 'Suspensa', slug: 'suspensa', status: 'suspenso' },
    { id_estabelecimento: 13, nome_fantasia: 'Arquivada', slug: 'arquivada', status: 'arquivado' }
  ]);
  const slugs = (lista) => lista.map((item) => item.slug).sort();

  assert.deepEqual(slugs(await listarEstabelecimentosGerenciais(banco, {})), ['ativa', 'suspensa']);
  assert.deepEqual(slugs(await listarEstabelecimentosGerenciais(banco, { status: 'arquivado' })), ['arquivada']);
  assert.deepEqual(slugs(await listarEstabelecimentosGerenciais(banco, { status: 'suspenso' })), ['suspensa']);
  assert.deepEqual(
    slugs(await listarEstabelecimentosGerenciais(banco, { incluirArquivados: '1' })),
    ['arquivada', 'ativa', 'suspensa']
  );
  // Valor fora da lista não vira filtro nem libera arquivados.
  assert.deepEqual(slugs(await listarEstabelecimentosGerenciais(banco, { status: 'inativo' })), ['ativa', 'suspensa']);
});

test('rotas de ciclo de vida respondem 404, 409 e 400 com a mensagem do servidor', async () => {
  const { banco: bancoCadastro, lojas } = bancoCadastroEstabelecimentos([
    { id_estabelecimento: 11, nome_fantasia: 'Loja A', slug: 'loja-a' }
  ]);
  const banco = {
    async getConnection() { return bancoCadastro.getConnection(); },
    async execute(sql, parametros = []) {
      if (sql.includes('FROM superadministradores') && sql.includes('senha_hash')) {
        return [[{
          id: 1, nome: 'Super', usuario: 'super', email: 'super@teste.local',
          senha_hash: criarHashSenha('senha-global-segura')
        }]];
      }
      if (sql.includes('INSERT INTO sessoes_superadmin')) return [{ affectedRows: 1 }];
      if (sql.includes('DELETE FROM sessoes_superadmin')) return [{ affectedRows: 0 }];
      if (sql.includes('FROM sessoes_superadmin ss')) {
        return [[{ id: 1, nome: 'Super', usuario: 'super', email: 'super@teste.local' }]];
      }
      return bancoCadastro.execute(sql, parametros);
    }
  };
  const servidor = criarServidor({ banco, pastaUploads: tmpdir(), tenantDesenvolvimento: '', jwtSecret: JWT_SECRET_TESTE });
  await aguardarServidor(servidor, 0);
  const baseUrl = `http://127.0.0.1:${servidor.address().port}`;

  try {
    const login = await fetch(`${baseUrl}/api/superadmin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: 'super', senha: 'senha-global-segura' })
    });
    const { token } = await login.json();
    const chamar = async (metodo, caminho, corpo) => {
      const resposta = await fetch(`${baseUrl}/api/superadmin/estabelecimentos${caminho}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: corpo === undefined ? undefined : JSON.stringify(corpo)
      });
      return { status: resposta.status, corpo: await resposta.json() };
    };

    assert.equal((await chamar('POST', '/999/suspender', { motivo: 'x' })).status, 404);
    assert.equal((await chamar('POST', '/999/reativar')).status, 404);

    const semMotivo = await chamar('POST', '/11/suspender', { motivo: '  ' });
    assert.equal(semMotivo.status, 400);
    assert.match(semMotivo.corpo.erro, /motivo/);

    const arquivarAtivo = await chamar('POST', '/11/arquivar', { confirmacaoSlug: 'loja-a' });
    assert.equal(arquivarAtivo.status, 409);
    assert.match(arquivarAtivo.corpo.erro, /Suspenda/);

    // Do corpo só o motivo é lido: status, id e tenant enviados são ignorados.
    const suspensao = await chamar('POST', '/11/suspender', {
      motivo: 'Inadimplência', status: 'arquivado', id_estabelecimento: 22, arquivado_por: 99
    });
    assert.equal(suspensao.status, 200);
    assert.equal(suspensao.corpo.estabelecimento.status, 'suspenso');
    assert.equal(suspensao.corpo.estabelecimento.motivoSuspensao, 'Inadimplência');
    assert.equal(lojas.get(11).arquivado_por, null);

    const repetida = await chamar('POST', '/11/suspender', { motivo: 'De novo' });
    assert.equal(repetida.status, 409);
    assert.match(repetida.corpo.erro, /já está suspenso/);

    // PUT com status no corpo não muda o status.
    const edicao = await chamar('PUT', '/11', { nomeFantasia: 'Loja A', status: 'ativo' });
    assert.equal(edicao.status, 200);
    assert.equal(edicao.corpo.estabelecimento.status, 'suspenso');

    assert.equal((await chamar('POST', '/11/arquivar', { confirmacaoSlug: 'loja-a' })).status, 200);
    const edicaoArquivado = await chamar('PUT', '/11', { nomeFantasia: 'Outro nome' });
    assert.equal(edicaoArquivado.status, 409);
    assert.match(edicaoArquivado.corpo.erro, /arquivado/);

    // A listagem padrão não traz o arquivado; o filtro explícito traz.
    assert.equal((await chamar('GET', '')).corpo.estabelecimentos.length, 0);
    assert.equal((await chamar('GET', '?status=arquivado')).corpo.estabelecimentos.length, 1);
    assert.equal((await chamar('GET', '?incluirArquivados=1')).corpo.estabelecimentos.length, 1);
    assert.deepEqual((await chamar('GET', '')).corpo.opcoes.statusEstabelecimento, ['ativo', 'suspenso', 'arquivado']);
  } finally {
    await fecharServidor(servidor);
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
  let acessoEquipe;
  let tokenSessaoGarcom;
  let idGarcomDemonstracao;
  let tokenAdmin;
  let tokenDispositivoImpressao;
  let idImpressoraCozinha;
  let idImpressoraBar;

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
    lojaAbertaManual: true,
    entregaAtiva: true,
    aceitaCartao: true,
    aceitaDinheiro: true,
    pixChave: '',
    pixBeneficiario: '',
    pixCidade: '',
    retiradaAtiva: true,
    logo: ''
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
      senhaFuncionarioDemonstracao: 'demo'
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
    // QR Code único da equipe: mesmo token para todos os garçons do tenant.
    acessoEquipe = dados.corpo.acessoGarcom;
    assert.ok(acessoEquipe);
    tokenAdmin = login.corpo.token;

    const configurada = await salvarConfiguracaoTeste();
    assert.equal(configurada.status, 200);
    const publico = await chamar('/api/publico/inicial');
    assert.equal(publico.corpo.configuracao.nomeLoja, 'Hambúrguer Teste');
    assert.equal(publico.corpo.configuracao.whatsapp, '(11) 98888-7777');
    assert.equal(publico.corpo.configuracao.entregaPorArea, false);

    for (const area of [
      { nome: 'Centro', taxaEntrega: 5, tempoEstimadoMin: 30, tempoEstimadoMax: 45 },
      { nome: 'Bairro Sul', taxaEntrega: '8,50', tempoEstimadoMin: '40', tempoEstimadoMax: 60 }
    ]) {
      const criada = await chamar('/api/admin/areas-entrega', { metodo: 'POST', token: tokenAdmin, dados: area });
      assert.equal(criada.status, 201);
    }
    const comAreas = await chamar('/api/publico/inicial');
    assert.equal(comAreas.corpo.configuracao.entregaPorArea, true);
    assert.deepEqual(
      comAreas.corpo.configuracao.areasEntrega.map(({ nome, bairro, taxa, tempoEstimadoMin, tempoEstimadoMax }) => (
        { nome, bairro, taxa, tempoEstimadoMin, tempoEstimadoMax }
      )),
      [
        { nome: 'Bairro Sul', bairro: 'Bairro Sul', taxa: 8.5, tempoEstimadoMin: 40, tempoEstimadoMax: 60 },
        { nome: 'Centro', bairro: 'Centro', taxa: 5, tempoEstimadoMin: 30, tempoEstimadoMax: 45 }
      ]
    );
  });

  test('cria delivery com preços recalculados e acompanhamento protegido', async () => {
    const criado = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: {
        nome: 'Cliente Teste',
        telefone: '(11) 90000-0000',
        // Enviado por um cliente antigo: o servidor ignora.
        email: 'ignorado@teste.local',
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
    const [[gravado]] = await banco.execute(
      'SELECT email FROM pedidos WHERE id = ?',
      [Number(criado.corpo.pedido.id.replace('#PED', ''))]
    );
    assert.equal(gravado.email, null);
    assert.equal(criado.corpo.pedido.taxaEntrega, 5);
    assert.equal(criado.corpo.pedido.total, 44.9);
    assert.equal(criado.corpo.pedido.pagamentoStatus, 'Pagamento na entrega');
    assert.ok(criado.corpo.pedido.tokenAcompanhamento);

    const pixIndisponivel = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: {
        nome: 'Cliente Pix',
        telefone: '(11) 91111-1111',
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

  test('bloqueia pedido com loja fechada e não exige mais pedido mínimo', async () => {
    const fechadaConfigurada = await salvarConfiguracaoTeste({ lojaAbertaManual: false });
    assert.equal(fechadaConfigurada.status, 200);
    const fechada = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido()
    });
    assert.equal(fechada.status, 409);
    assert.match(fechada.corpo.erro, /fechada/i);

    // O campo antigo é ignorado: um pedido pequeno continua sendo aceito.
    const minimoConfigurado = await salvarConfiguracaoTeste({ pedidoMinimo: 100 });
    assert.equal(minimoConfigurado.status, 200);
    assert.equal('pedidoMinimo' in minimoConfigurado.corpo.configuracao, false);
    const pequeno = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido()
    });
    assert.equal(pequeno.status, 201);

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

  /* Áreas de entrega. Os pedidos saem por um servidor próprio para não
     disputar o limite de pedidos por minuto com os outros testes. */
  async function comServidorDePedidos(executar) {
    const servidorPedidos = criarServidor({ banco, pastaUploads, jwtSecret: JWT_SECRET_TESTE, limitePedidosPorMinuto: 1000 });
    await aguardarServidor(servidorPedidos, 0);
    try {
      const baseUrl = `http://127.0.0.1:${servidorPedidos.address().port}`;
      await executar((dados) => chamar('/api/pedidos', { metodo: 'POST', dados, baseUrl }));
    } finally {
      await fecharServidor(servidorPedidos);
    }
  }

  async function areaPeloNome(nome) {
    const lista = await chamar('/api/admin/areas-entrega', { token: tokenAdmin });
    assert.equal(lista.status, 200);
    return lista.corpo.areasEntrega.find((area) => area.nome === nome);
  }

  test('recalcula a taxa pela área escolhida, ignora a taxa adulterada e preserva o histórico', async () => {
    const sul = await areaPeloNome('Bairro Sul');
    await comServidorDePedidos(async (pedir) => {
      const criado = await pedir(dadosPedido({
        areaEntregaId: sul.id,
        bairro: 'Centro',
        taxaEntrega: 0,
        taxaEntregaCentavos: 0,
        total: 0.01
      }));
      assert.equal(criado.status, 201);
      assert.equal(criado.corpo.pedido.taxaEntrega, 8.5);
      assert.equal(criado.corpo.pedido.areaEntregaId, sul.id);
      assert.match(criado.corpo.pedido.endereco, /Bairro Sul/);

      const idPedido = Number(criado.corpo.pedido.id.replace('#PED', ''));
      const lerPedido = async () => (await banco.execute(
        'SELECT area_entrega_id, bairro, taxa_entrega_centavos, total_centavos FROM pedidos WHERE id = ?',
        [idPedido]
      ))[0][0];
      const gravado = await lerPedido();
      assert.equal(Number(gravado.area_entrega_id), sul.id);
      assert.equal(Number(gravado.taxa_entrega_centavos), 850);

      // Mudar a taxa e o nome da área depois não altera o pedido já feito.
      const alterada = await chamar(`/api/admin/areas-entrega/${sul.id}`, {
        metodo: 'PUT',
        token: tokenAdmin,
        dados: { nome: 'Bairro Sul Novo', taxaEntrega: 12, tempoEstimadoMin: 50, tempoEstimadoMax: 70 }
      });
      assert.equal(alterada.status, 200);
      assert.equal(alterada.corpo.areaEntrega.taxaEntrega, 12);
      assert.deepEqual(await lerPedido(), gravado);
      const restaurada = await chamar(`/api/admin/areas-entrega/${sul.id}`, {
        metodo: 'PUT',
        token: tokenAdmin,
        dados: { nome: 'Bairro Sul', taxaEntrega: 8.5, tempoEstimadoMin: 40, tempoEstimadoMax: 60, ativo: true }
      });
      assert.equal(restaurada.status, 200);

      // Área de outra loja e id em formato inválido.
      const idTenantB = await idDaLoja('loja-b');
      const [areaB] = await banco.execute(`
        INSERT INTO areas_entrega (id_estabelecimento, nome, taxa_entrega_centavos, tempo_estimado_min, tempo_estimado_max)
        VALUES (?, 'Área só da loja B', 0, 10, 20)
      `, [idTenantB]);
      try {
        assert.equal((await pedir(dadosPedido({ areaEntregaId: Number(areaB.insertId) }))).status, 409);
      } finally {
        await banco.execute('DELETE FROM areas_entrega WHERE id = ? AND id_estabelecimento = ?', [areaB.insertId, idTenantB]);
      }
      assert.equal((await pedir(dadosPedido({ areaEntregaId: 'abc' }))).status, 400);
    });
  });

  test('valida a área, não exclui área já usada e sem área ativa bloqueia o delivery', async () => {
    const centro = await areaPeloNome('Centro');
    const sul = await areaPeloNome('Bairro Sul');
    const criar = (dados) => chamar('/api/admin/areas-entrega', { metodo: 'POST', token: tokenAdmin, dados });
    const status = (id, ativo) => chamar(`/api/admin/areas-entrega/${id}/status`, { metodo: 'PATCH', token: tokenAdmin, dados: { ativo } });

    for (const invalida of [
      { nome: '   ', taxaEntrega: 1, tempoEstimadoMin: 10, tempoEstimadoMax: 20 },
      { nome: 'x'.repeat(121), taxaEntrega: 1, tempoEstimadoMin: 10, tempoEstimadoMax: 20 },
      { nome: 'Negativa', taxaEntrega: -1, tempoEstimadoMin: 10, tempoEstimadoMax: 20 },
      { nome: 'Cara demais', taxaEntrega: 10000.01, tempoEstimadoMin: 10, tempoEstimadoMax: 20 },
      { nome: 'Invertida', taxaEntrega: 1, tempoEstimadoMin: 30, tempoEstimadoMax: 20 },
      { nome: 'Fracionada', taxaEntrega: 1, tempoEstimadoMin: 10.5, tempoEstimadoMax: 20 },
      { nome: 'Ativo em texto', taxaEntrega: 1, tempoEstimadoMin: 10, tempoEstimadoMax: 20, ativo: 'sim' }
    ]) {
      assert.equal((await criar(invalida)).status, 400, invalida.nome);
    }
    const repetida = await criar({ nome: 'CENTRO', taxaEntrega: 1, tempoEstimadoMin: 10, tempoEstimadoMax: 20 });
    assert.equal(repetida.status, 409);
    assert.equal((await status(centro.id, 'false')).status, 400);

    const contarArea = async (id) => Number((await banco.execute('SELECT COUNT(id) AS total FROM areas_entrega WHERE id = ?', [id]))[0][0].total);
    const usada = await chamar(`/api/admin/areas-entrega/${sul.id}`, { metodo: 'DELETE', token: tokenAdmin });
    assert.equal(usada.status, 409);
    assert.match(usada.corpo.erro, /Desative/);
    assert.equal(await contarArea(sul.id), 1);

    const nova = await criar({ nome: 'Área sem pedidos', taxaEntrega: 3, tempoEstimadoMin: 15, tempoEstimadoMax: 25 });
    assert.equal(nova.status, 201);
    assert.equal((await chamar(`/api/admin/areas-entrega/${nova.corpo.areaEntrega.id}`, { metodo: 'DELETE', token: tokenAdmin })).status, 200);
    assert.equal(await contarArea(nova.corpo.areaEntrega.id), 0);

    await comServidorDePedidos(async (pedir) => {
      try {
        const desativada = await status(sul.id, false);
        assert.equal(desativada.status, 200);
        assert.equal(desativada.corpo.areaEntrega.ativo, false);
        const publico = await chamar('/api/publico/areas-entrega');
        assert.equal(publico.corpo.entregaPorArea, true);
        assert.deepEqual(publico.corpo.areasEntrega.map((area) => area.id), [centro.id]);
        assert.equal((await pedir(dadosPedido({ areaEntregaId: sul.id }))).status, 409);

        assert.equal((await status(centro.id, false)).status, 200);
        const semAtivas = await chamar('/api/publico/areas-entrega');
        assert.deepEqual(semAtivas.corpo, { entregaPorArea: true, areasEntrega: [] });
        const bloqueado = await pedir(dadosPedido());
        assert.equal(bloqueado.status, 409);
        assert.match(bloqueado.corpo.erro, /Nenhuma área de entrega disponível/);

        const retirada = await pedir(dadosPedido({ modalidade: 'retirada', pagamento: 'Cartão na retirada' }));
        assert.equal(retirada.status, 201);
        assert.equal(retirada.corpo.pedido.taxaEntrega, 0);
      } finally {
        await status(sul.id, true);
        await status(centro.id, true);
      }
    });
  });

  test('administrador da loja A não lista, edita, ativa nem exclui áreas de entrega da loja B', async () => {
    const idTenantA = await idDaLoja('estabelecimento-padrao');
    const idTenantB = await idDaLoja('loja-b');
    const [criadaB] = await banco.execute(`
      INSERT INTO areas_entrega (id_estabelecimento, nome, taxa_entrega_centavos, tempo_estimado_min, tempo_estimado_max)
      VALUES (?, 'Exclusiva da loja B', 400, 20, 30)
    `, [idTenantB]);
    const idAreaB = Number(criadaB.insertId);
    try {
      const listaA = await chamar('/api/admin/areas-entrega', { token: tokenAdmin });
      assert.equal(listaA.corpo.areasEntrega.some((area) => area.id === idAreaB), false);
      for (const [metodo, caminho, dados] of [
        ['PUT', `/api/admin/areas-entrega/${idAreaB}`, { nome: 'Tomada', taxaEntrega: 0, tempoEstimadoMin: 1, tempoEstimadoMax: 2 }],
        ['PATCH', `/api/admin/areas-entrega/${idAreaB}/status`, { ativo: false }],
        ['DELETE', `/api/admin/areas-entrega/${idAreaB}`]
      ]) {
        assert.equal((await chamar(caminho, { metodo, token: tokenAdmin, dados })).status, 404, `${metodo} ${caminho}`);
      }
      const cruzada = await chamar(`/api/admin/areas-entrega/${idAreaB}`, { metodo: 'DELETE', token: tokenAdmin, baseUrl: urlBaseTenantB });
      assert.equal(cruzada.status, 403);

      const [[areaB]] = await banco.execute(
        'SELECT nome, taxa_entrega_centavos, ativo FROM areas_entrega WHERE id = ? AND id_estabelecimento = ?',
        [idAreaB, idTenantB]
      );
      assert.deepEqual({ ...areaB, taxa_entrega_centavos: Number(areaB.taxa_entrega_centavos), ativo: Number(areaB.ativo) },
        { nome: 'Exclusiva da loja B', taxa_entrega_centavos: 400, ativo: 1 });

      const publicoA = await chamar('/api/publico/areas-entrega');
      const publicoB = await chamar('/api/publico/areas-entrega', { baseUrl: urlBaseTenantB });
      assert.equal(publicoA.corpo.areasEntrega.some((area) => area.id === idAreaB), false);
      assert.deepEqual(publicoB.corpo.areasEntrega.map((area) => area.id), [idAreaB]);

      // id_estabelecimento no corpo é ignorado: a área nasce na loja da sessão.
      const intrusa = await chamar('/api/admin/areas-entrega', {
        metodo: 'POST',
        token: tokenAdmin,
        dados: { nome: 'Enviada para B', taxaEntrega: 1, tempoEstimadoMin: 5, tempoEstimadoMax: 10, id_estabelecimento: idTenantB, idEstabelecimento: idTenantB }
      });
      assert.equal(intrusa.status, 201);
      const [[dono]] = await banco.execute('SELECT id_estabelecimento FROM areas_entrega WHERE id = ?', [intrusa.corpo.areaEntrega.id]);
      assert.equal(Number(dono.id_estabelecimento), idTenantA);
      assert.equal((await chamar(`/api/admin/areas-entrega/${intrusa.corpo.areaEntrega.id}`, { metodo: 'DELETE', token: tokenAdmin })).status, 200);
    } finally {
      await banco.execute('DELETE FROM areas_entrega WHERE id = ? AND id_estabelecimento = ?', [idAreaB, idTenantB]);
    }
  });

  test('estabelecimento sem áreas cadastradas fecha o pedido normalmente com a taxa única', async () => {
    const idTenantB = await idDaLoja('loja-b');
    await banco.execute(`
      UPDATE configuracoes_estabelecimento
      SET aceita_dinheiro = 1, taxa_entrega_centavos = 600, tempo_entrega = '20–30 min'
      WHERE id_estabelecimento = ?
    `, [idTenantB]);
    const [[produtoB]] = await banco.execute('SELECT id FROM produtos WHERE id_estabelecimento = ? ORDER BY id LIMIT 1', [idTenantB]);
    const publicoB = await chamar('/api/publico/areas-entrega', { baseUrl: urlBaseTenantB });
    assert.deepEqual(publicoB.corpo, { entregaPorArea: false, areasEntrega: [] });

    const criado = await chamar('/api/pedidos', {
      metodo: 'POST',
      baseUrl: urlBaseTenantB,
      dados: dadosPedido({
        bairro: 'Bairro Qualquer',
        pagamento: 'Dinheiro',
        semTroco: true,
        taxaEntrega: 0,
        itens: [{ id: Number(produtoB.id), quantidade: 1 }]
      })
    });
    assert.equal(criado.status, 201);
    assert.equal(criado.corpo.pedido.taxaEntrega, 6);
    assert.equal(criado.corpo.pedido.total, 31);
    assert.equal(criado.corpo.pedido.areaEntregaId, null);
    assert.match(criado.corpo.pedido.endereco, /Bairro Qualquer/);
  });

  test('migration 019 copia os bairros do JSON antigo com o tempo lido do texto', async () => {
    const idTenantB = await idDaLoja('loja-b');
    const migration = await readFile(new URL('../database/migrations/019_areas_entrega.sql', import.meta.url), 'utf8');
    const copia = migration
      .split(/;\s*(?:\r?\n|$)/)
      .map((instrucao) => instrucao.trim())
      .find((instrucao) => instrucao.startsWith('INSERT INTO areas_entrega'));
    assert.ok(copia);
    const areasB = async () => (await banco.execute(`
      SELECT nome, taxa_entrega_centavos, tempo_estimado_min, tempo_estimado_max, ativo
      FROM areas_entrega WHERE id_estabelecimento = ? ORDER BY nome
    `, [idTenantB]))[0].map((linha) => [
      linha.nome, Number(linha.taxa_entrega_centavos), Number(linha.tempo_estimado_min), Number(linha.tempo_estimado_max), Number(linha.ativo)
    ]);
    const jsonAntigo = JSON.stringify([
      { bairro: 'Centro', taxaCentavos: 500 },
      { bairro: '  Vila Nova ', taxaCentavos: 750 },
      { bairro: 'centro', taxaCentavos: 900 },
      null,
      { bairro: 'Sem taxa' },
      { bairro: '', taxaCentavos: 100 },
      { bairro: 'Taxa quebrada', taxaCentavos: 'abc' }
    ]);
    async function aplicar(tempoEntrega) {
      await banco.execute('DELETE FROM areas_entrega WHERE id_estabelecimento = ?', [idTenantB]);
      await banco.execute(
        'UPDATE configuracoes_estabelecimento SET areas_entrega_json = ?, tempo_entrega = ? WHERE id_estabelecimento = ?',
        [jsonAntigo, tempoEntrega, idTenantB]
      );
      await banco.query(copia);
      return areasB();
    }
    try {
      assert.deepEqual(await aplicar('35–50 min'), [['Centro', 500, 35, 50, 1], ['Vila Nova', 750, 35, 50, 1]]);
      // Rodar de novo não duplica nem altera.
      await banco.query(copia);
      assert.deepEqual(await areasB(), [['Centro', 500, 35, 50, 1], ['Vila Nova', 750, 35, 50, 1]]);
      for (const tempo of ['Rápido', '40 min', '50–40 min', '0–20 min', null]) {
        assert.deepEqual((await aplicar(tempo)).map(([, , minimo, maximo]) => [minimo, maximo]), [[30, 45], [30, 45]], String(tempo));
      }
    } finally {
      await banco.execute('DELETE FROM areas_entrega WHERE id_estabelecimento = ?', [idTenantB]);
      await banco.execute(
        "UPDATE configuracoes_estabelecimento SET areas_entrega_json = NULL, tempo_entrega = '20–30 min' WHERE id_estabelecimento = ?",
        [idTenantB]
      );
    }
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
    const nome = `Cliente duplicado ${randomUUID().slice(0, 8)}`;
    const dados = dadosPedido({ chaveIdempotencia, nome });
    const [primeiro, segundo] = await Promise.all([
      chamar('/api/pedidos', { metodo: 'POST', dados }),
      chamar('/api/pedidos', { metodo: 'POST', dados })
    ]);
    assert.equal(primeiro.status, 201);
    assert.equal(segundo.status, 201);
    assert.equal(segundo.corpo.pedido.id, primeiro.corpo.pedido.id);
    assert.equal(segundo.corpo.pedido.tokenAcompanhamento, chaveIdempotencia);

    const [[contagem]] = await banco.execute('SELECT COUNT(*) AS total FROM pedidos WHERE cliente = ?', [nome]);
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

  test('indicadores do dashboard batem com a receita confirmada e ignoram o tenant B', async (t) => {
    const [[tenantA]] = await banco.execute(
      "SELECT id_estabelecimento FROM estabelecimentos WHERE slug = 'estabelecimento-padrao'"
    );
    const [[tenantB]] = await banco.execute(
      "SELECT id_estabelecimento FROM estabelecimentos WHERE slug = 'loja-b'"
    );
    const idTenantA = Number(tenantA.id_estabelecimento);
    const idTenantB = Number(tenantB.id_estabelecimento);

    // Venda grande e paga em B, que não pode contaminar os números de A.
    const [[produtoB]] = await banco.execute(
      'SELECT id, nome FROM produtos WHERE id_estabelecimento = ? LIMIT 1',
      [idTenantB]
    );
    const [pedidoB] = await banco.execute(`
      INSERT INTO pedidos
        (id_estabelecimento, origem, cliente, telefone, status, pagamento, taxa_entrega_centavos, total_centavos)
      VALUES (?, 'retirada', 'Cliente B', '11900000000', 'Retirado', 'Dinheiro', 0, 999900)
    `, [idTenantB]);
    await banco.execute(`
      INSERT INTO pedido_itens
        (id_estabelecimento, pedido_id, produto_id, nome_produto, preco_unitario_centavos, quantidade)
      VALUES (?, ?, ?, ?, 2500, 400)
    `, [idTenantB, pedidoB.insertId, produtoB.id, produtoB.nome]);
    await banco.execute(`
      INSERT INTO pagamentos
        (id_estabelecimento, pedido_id, forma, status, valor_centavos, pago_em)
      VALUES (?, ?, 'Dinheiro', 'Pago', 999900, CURRENT_TIMESTAMP)
    `, [idTenantB, pedidoB.insertId]);

    // Garante ao menos um pedido pago em A dentro do período.
    const pedidoA = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido({ modalidade: 'retirada', pagamento: 'Cartão na retirada', rua: '', numero: '', bairro: '' })
    });
    assert.equal(pedidoA.status, 201);
    const confirmado = await chamar(
      `/api/admin/pedidos/${encodeURIComponent(pedidoA.corpo.pedido.id)}/pagamento/confirmar`,
      { metodo: 'POST', token: tokenAdmin }
    );
    assert.equal(confirmado.status, 200);

    const resposta = await chamar(
      `/api/admin/dashboard/indicadores?periodo=30dias&id_estabelecimento=${idTenantB}`,
      { token: tokenAdmin }
    );
    assert.equal(resposta.status, 200);
    const { ticketMedio, produtosMaisVendidos, inicio, fim } = resposta.corpo;
    assert.ok(ticketMedio.pedidos >= 1);
    assert.equal(produtosMaisVendidos.some((produto) => produto.nome === produtoB.nome), false);
    assert.ok(produtosMaisVendidos.length <= 5);

    // Consulta independente: último pagamento de cada pedido por tabela derivada.
    const dataSql = (iso) => iso.slice(0, 19).replace('T', ' ');
    const [[independente]] = await banco.execute(`
      SELECT COUNT(p.id) AS pedidos, COALESCE(SUM(p.total_centavos), 0) AS receita_centavos
      FROM pedidos p
      INNER JOIN (
        SELECT pedido_id, MAX(id) AS ultimo_id
        FROM pagamentos
        WHERE id_estabelecimento = ?
        GROUP BY pedido_id
      ) ultimo ON ultimo.pedido_id = p.id
      INNER JOIN pagamentos pg ON pg.id = ultimo.ultimo_id
      WHERE p.id_estabelecimento = ?
        AND p.status <> 'Cancelado'
        AND pg.status = 'Pago'
        AND p.criado_em >= ? AND p.criado_em < ?
    `, [idTenantA, idTenantA, dataSql(inicio), dataSql(fim)]);
    const pedidosIndependente = Number(independente.pedidos);
    const receitaIndependente = Number(independente.receita_centavos);

    // A mesma regra do card "Receita confirmada", aplicada aos pedidos do painel.
    const dados = await chamar('/api/admin/dados', { token: tokenAdmin });
    const pagosNoPeriodo = dados.corpo.pedidos.filter((pedido) => pedido.pagamentoStatus === 'Pago'
      && pedido.criadoEm >= inicio && pedido.criadoEm < fim);
    const receitaCard = Math.round(pagosNoPeriodo.reduce((soma, pedido) => soma + pedido.total, 0) * 100);

    assert.equal(ticketMedio.pedidos, pedidosIndependente);
    assert.equal(Math.round(ticketMedio.receita * 100), receitaIndependente);
    assert.equal(ticketMedio.pedidos, pagosNoPeriodo.length);
    assert.equal(Math.round(ticketMedio.receita * 100), receitaCard);
    assert.equal(ticketMedio.valor, Math.round(receitaIndependente / pedidosIndependente) / 100);
    t.diagnostic(`API: ticket médio ${ticketMedio.valor} (receita ${ticketMedio.receita} ÷ ${ticketMedio.pedidos} pedidos)`);
    t.diagnostic(`Independente: ${receitaIndependente / 100} ÷ ${pedidosIndependente} = ${(receitaIndependente / pedidosIndependente / 100).toFixed(4)}`);
  });

  test('admin cria acessos adicionais e o histórico lista somente logins', async () => {
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
    assert.ok(dados.corpo.auditoria.length > 0);
    assert.ok(dados.corpo.auditoria.every((item) => item.acao === 'administrador.login'));
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
      dados: { token: acessoEquipe, senha: 'demo1' }
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

  test('compartilha o salão entre a equipe e exige a sequência operacional', async () => {
    const dados = await chamar('/api/garcom/dados', { token: tokenSessaoGarcom });
    assert.equal(dados.status, 200);
    assert.ok(dados.corpo.comandas.length > 0);
    // A mesa atendida por outro garçom aparece para toda a equipe.
    assert.equal(dados.corpo.comandas.some((comanda) => comanda.garcom === 'Ana Souza'), true);

    const comanda = dados.corpo.comandas.find((item) => item.mesaId === 1);
    assert.ok(comanda);
    // Fechar a conta é do caixa: a rota não existe mais para o garçom.
    const contaPeloGarcom = await chamar(`/api/garcom/comandas/${comanda.id}/conta`, {
      metodo: 'POST',
      token: tokenSessaoGarcom
    });
    assert.equal(contaPeloGarcom.status, 404);

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
      dados: { token: acessoEquipe, senha: 'demo2' }
    });
    assert.equal(loginAna.status, 200);
    // Outro garçom da mesma equipe continua o atendimento da mesma comanda.
    const outroGarcom = await chamar(`/api/garcom/comandas/${comanda.id}/itens`, {
      metodo: 'POST',
      token: loginAna.corpo.token,
      dados: { produtoId: 1, quantidade: 1, adicionais: [] }
    });
    assert.equal(outroGarcom.status, 201);

    // A comanda segue creditada a quem a abriu, e o item guarda quem o lançou.
    const compartilhada = await chamar('/api/garcom/dados', { token: loginAna.corpo.token });
    const comandaCompartilhada = compartilhada.corpo.comandas.find((item) => item.id === comanda.id);
    assert.equal(comandaCompartilhada.funcionarioId, idGarcomDemonstracao);
    const enviarPelaAna = await chamar(`/api/garcom/comandas/${comanda.id}/enviar`, {
      metodo: 'POST',
      token: loginAna.corpo.token
    });
    assert.equal(enviarPelaAna.status, 200);
    const conferencia = await chamar('/api/garcom/dados', { token: tokenSessaoGarcom });
    const comandaConferida = conferencia.corpo.comandas.find((item) => item.id === comanda.id);
    assert.equal(comandaConferida.itens.at(-1).enviadoPor.nome, 'Ana Souza');
  });

  test('garçom salva, relê e apaga a observação geral da própria comanda', async () => {
    const dados = await chamar('/api/garcom/dados', { token: tokenSessaoGarcom });
    const comanda = dados.corpo.comandas.find((item) => item.mesaId === 1);
    assert.ok(comanda);
    // Comanda sem recado chega como string vazia, nunca como null: é o que
    // deixa o campo do formulário nascer controlado nas duas telas.
    assert.equal(comanda.observacao, '');

    const salva = await chamar(`/api/garcom/comandas/${comanda.id}/observacao`, {
      metodo: 'PUT',
      token: tokenSessaoGarcom,
      dados: { observacao: '  Mesa com alergia a amendoim.  ' }
    });
    assert.equal(salva.status, 200);
    assert.equal(salva.corpo.observacao, 'Mesa com alergia a amendoim.');

    const relida = await chamar('/api/garcom/dados', { token: tokenSessaoGarcom });
    assert.equal(
      relida.corpo.comandas.find((item) => item.id === comanda.id).observacao,
      'Mesa com alergia a amendoim.'
    );
    // Mesma comanda, mesmo recado: o caixa lê pelo painel, sem rota própria.
    const noPainel = await chamar('/api/admin/dados', { token: tokenAdmin });
    assert.equal(
      noPainel.corpo.comandas.find((item) => item.id === comanda.id).observacao,
      'Mesa com alergia a amendoim.'
    );

    const longa = await chamar(`/api/garcom/comandas/${comanda.id}/observacao`, {
      metodo: 'PUT',
      token: tokenSessaoGarcom,
      dados: { observacao: 'a'.repeat(501) }
    });
    assert.equal(longa.status, 400);
    assert.match(longa.corpo.erro, /500 caracteres/);
    // Recusado é recusado: o texto anterior continua inteiro no banco.
    const intacta = await chamar('/api/garcom/dados', { token: tokenSessaoGarcom });
    assert.equal(
      intacta.corpo.comandas.find((item) => item.id === comanda.id).observacao,
      'Mesa com alergia a amendoim.'
    );

    // Apagar o recado é salvar o campo vazio.
    const limpa = await chamar(`/api/garcom/comandas/${comanda.id}/observacao`, {
      metodo: 'PUT',
      token: tokenSessaoGarcom,
      dados: { observacao: '   ' }
    });
    assert.equal(limpa.status, 200);
    assert.equal(limpa.corpo.observacao, '');
    const [[noBanco]] = await banco.execute(
      'SELECT observacao FROM comandas WHERE id = ?',
      [comanda.id]
    );
    assert.equal(noBanco.observacao, null);
  });

  test('observação de comanda de outro estabelecimento não é alcançada nem pelo garçom nem pelo caixa', async () => {
    const [[lojaB]] = await banco.execute(
      'SELECT id_estabelecimento FROM estabelecimentos WHERE slug = ?',
      ['loja-b']
    );
    const idTenantB = Number(lojaB.id_estabelecimento);
    const [mesaB] = await banco.execute(`
      INSERT INTO mesas (id_estabelecimento, numero, ativo)
      VALUES (?, 901, 1)
    `, [idTenantB]);
    const [comandaB] = await banco.execute(`
      INSERT INTO comandas (id_estabelecimento, mesa_id, status, observacao)
      VALUES (?, ?, 'Aberta', 'Recado da Loja B')
    `, [idTenantB, mesaB.insertId]);
    const idComandaB = Number(comandaB.insertId);

    try {
      // A loja A conhece o id, mas não a comanda: o tenant vem da sessão, e
      // nem o garçom nem o administrador saem do próprio estabelecimento.
      const peloGarcom = await chamar(`/api/garcom/comandas/${idComandaB}/observacao`, {
        metodo: 'PUT',
        token: tokenSessaoGarcom,
        dados: { observacao: 'Invasão pelo salão' }
      });
      assert.equal(peloGarcom.status, 404);

      const peloCaixa = await chamar(`/api/admin/comandas/${idComandaB}/observacao`, {
        metodo: 'PUT',
        token: tokenAdmin,
        dados: { observacao: 'Invasão pelo caixa' }
      });
      assert.equal(peloCaixa.status, 404);

      // Sessão da loja A apontada para o domínio da loja B também não passa:
      // a sessão é da loja A e não vira credencial da loja B.
      const trocandoODominio = await chamar(`/api/garcom/comandas/${idComandaB}/observacao`, {
        metodo: 'PUT',
        token: tokenSessaoGarcom,
        dados: { observacao: 'Invasão pelo domínio' },
        baseUrl: urlBaseTenantB
      });
      assert.equal(trocandoODominio.status, 403);

      const [[intacta]] = await banco.execute(
        'SELECT observacao FROM comandas WHERE id = ? AND id_estabelecimento = ?',
        [idComandaB, idTenantB]
      );
      assert.equal(intacta.observacao, 'Recado da Loja B');
      // E a comanda da loja B não aparece no painel da loja A.
      const painelA = await chamar('/api/admin/dados', { token: tokenAdmin });
      assert.equal(painelA.corpo.comandas.some((item) => item.id === String(idComandaB)), false);
    } finally {
      await banco.execute('DELETE FROM comandas WHERE id = ? AND id_estabelecimento = ?', [idComandaB, idTenantB]);
      await banco.execute('DELETE FROM mesas WHERE id = ? AND id_estabelecimento = ?', [mesaB.insertId, idTenantB]);
    }
  });

  test('separa o cardápio do salão do cardápio online', async () => {
    const categoriaSalao = await chamar('/api/admin/categorias', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: 'Chopp', ordem: 90, canal: 'salao' }
    });
    assert.equal(categoriaSalao.status, 201);
    assert.equal(categoriaSalao.corpo.categoria.canal, 'salao');

    const soNoSalao = await chamar('/api/admin/produtos', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: {
        nome: 'Chopp 300ml',
        categoriaId: categoriaSalao.corpo.categoria.id,
        descricao: 'Tirado na hora, só na mesa.',
        preco: '12,00',
        adicionaisIds: []
      }
    });
    assert.equal(soNoSalao.status, 201);
    const idChopp = soNoSalao.corpo.produto.id;

    // Produto 'online' dentro de categoria que aparece nos dois lugares.
    const soOnline = await chamar('/api/admin/produtos', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: {
        nome: 'Combo Entrega',
        categoria: 'Hambúrgueres',
        descricao: 'Combo exclusivo do delivery.',
        preco: '59,90',
        canal: 'online',
        adicionaisIds: []
      }
    });
    assert.equal(soOnline.status, 201);
    assert.equal(soOnline.corpo.produto.canal, 'online');
    const idComboEntrega = soOnline.corpo.produto.id;

    // O painel administra os dois cardápios e enxerga tudo.
    const painel = await chamar('/api/admin/dados', { token: tokenAdmin });
    assert.ok(painel.corpo.produtos.some((produto) => produto.id === idChopp));
    assert.ok(painel.corpo.produtos.some((produto) => produto.id === idComboEntrega));

    // O site não recebe nada do salão.
    const publico = await chamar('/api/publico/inicial');
    assert.equal(publico.corpo.categorias.some((item) => item.nome === 'Chopp'), false);
    assert.equal(publico.corpo.produtos.some((produto) => produto.id === idChopp), false);
    assert.ok(publico.corpo.produtos.some((produto) => produto.id === idComboEntrega));

    // O garçom recebe o cardápio do salão, sem o que é exclusivo do site.
    const salao = await chamar('/api/garcom/dados', { token: tokenSessaoGarcom });
    assert.ok(salao.corpo.categorias.some((item) => item.nome === 'Chopp'));
    assert.ok(salao.corpo.produtos.some((produto) => produto.id === idChopp));
    assert.equal(salao.corpo.produtos.some((produto) => produto.id === idComboEntrega), false);

    // Mandar o id direto na requisição não fura o recorte, dos dois lados.
    const pedidoComItemDoSalao = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido({ itens: [{ id: idChopp, quantidade: 1 }] })
    });
    assert.equal(pedidoComItemDoSalao.status, 409);

    const comandaDoSalao = salao.corpo.comandas.find((item) => item.mesaId === 1);
    assert.ok(comandaDoSalao);
    const itemSoOnline = await chamar(`/api/garcom/comandas/${comandaDoSalao.id}/itens`, {
      metodo: 'POST',
      token: tokenSessaoGarcom,
      dados: { produtoId: idComboEntrega, quantidade: 1, adicionais: [] }
    });
    assert.equal(itemSoOnline.status, 409);

    const itemDoSalao = await chamar(`/api/garcom/comandas/${comandaDoSalao.id}/itens`, {
      metodo: 'POST',
      token: tokenSessaoGarcom,
      dados: { produtoId: idChopp, quantidade: 1, adicionais: [] }
    });
    assert.equal(itemDoSalao.status, 201);

    // Promoção é vitrine do site: produto só do salão não pode ser anunciado.
    const promocaoInvalida = await chamar('/api/admin/promocoes', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: {
        produtoId: idChopp,
        nome: 'Chopp em dobro',
        descricao: 'Promoção de teste.',
        precoAntigo: '12,00',
        preco: '9,00'
      }
    });
    assert.equal(promocaoInvalida.status, 409);

    // A mesma promoção passa quando o produto aparece no cardápio online.
    const promocaoValida = await chamar('/api/admin/promocoes', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: {
        produtoId: 1,
        nome: 'Promoção de teste do canal',
        descricao: 'Produto que aparece no site.',
        precoAntigo: '29,90',
        preco: '24,90'
      }
    });
    assert.equal(promocaoValida.status, 201);
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

  test('administrador salva e relê a observação geral da comanda pela rota do painel', async () => {
    const mesaLivre = (await chamar('/api/admin/dados', { token: tokenAdmin }))
      .corpo.mesas.find((mesa) => mesa.status === 'Livre');
    assert.ok(mesaLivre);

    const aberta = await chamar('/api/admin/comandas', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { mesaId: mesaLivre.id }
    });
    assert.equal(aberta.status, 201);
    const comandaId = aberta.corpo.comanda.id;
    assert.equal(aberta.corpo.comanda.observacao, '');

    const salva = await chamar(`/api/admin/comandas/${comandaId}/observacao`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { observacao: '  Aniversário: bolo às 21h.  ' }
    });
    assert.equal(salva.status, 200);
    assert.equal(salva.corpo.observacao, 'Aniversário: bolo às 21h.');

    const painel = await chamar('/api/admin/dados', { token: tokenAdmin });
    assert.equal(
      painel.corpo.comandas.find((item) => item.id === comandaId).observacao,
      'Aniversário: bolo às 21h.'
    );
    // O garçom lê o mesmo recado no app, sem precisar salvá-lo de novo.
    const salao = await chamar('/api/garcom/dados', { token: tokenSessaoGarcom });
    assert.equal(
      salao.corpo.comandas.find((item) => item.id === comandaId).observacao,
      'Aniversário: bolo às 21h.'
    );

    const longa = await chamar(`/api/admin/comandas/${comandaId}/observacao`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { observacao: 'a'.repeat(501) }
    });
    assert.equal(longa.status, 400);

    // Alteração feita pelo painel fica na auditoria, sem copiar o recado.
    const [[registro]] = await banco.execute(`
      SELECT detalhes_json FROM auditoria_admin
      WHERE acao = 'comanda.observacao_alterada' AND entidade_id = ?
      ORDER BY id DESC LIMIT 1
    `, [comandaId]);
    assert.ok(registro);
    const detalhes = typeof registro.detalhes_json === 'string'
      ? JSON.parse(registro.detalhes_json)
      : registro.detalhes_json;
    assert.equal(detalhes.preenchida, true);
    assert.equal('observacao' in detalhes, false);

    const cancelada = await chamar(`/api/admin/comandas/${comandaId}/cancelar`, {
      metodo: 'POST',
      token: tokenAdmin
    });
    assert.equal(cancelada.status, 200);
    // Comanda fechada não recebe mais recado.
    const depoisDeFechar = await chamar(`/api/admin/comandas/${comandaId}/observacao`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { observacao: 'Tarde demais' }
    });
    assert.equal(depoisDeFechar.status, 409);
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

  test('cadastra garçom com senha e entra só com ela pelo QR único da equipe', async () => {
    const cadastrado = await chamar('/api/admin/funcionarios', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: 'Bruno Lima', cargo: 'Garçom', senha: 'bruno' }
    });
    assert.equal(cadastrado.status, 201);
    assert.equal(cadastrado.corpo.funcionario.senhaDefinida, true);
    // O token pessoal do QR antigo não aparece mais no painel.
    assert.equal('token' in cadastrado.corpo.funcionario, false);

    // Senha curta demais não passa na validação do servidor.
    const curta = await chamar('/api/admin/funcionarios', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: 'Curta Silva', cargo: 'Garçom', senha: 'abc' }
    });
    assert.equal(curta.status, 400);

    // A senha identifica a pessoa, então não pode se repetir na mesma equipe.
    const repetida = await chamar('/api/admin/funcionarios', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: 'Outro Bruno', cargo: 'Garçom', senha: 'bruno' }
    });
    assert.equal(repetida.status, 409);

    // O mesmo QR da equipe serve para o garçom recém-cadastrado.
    const convite = await chamar(`/api/garcom/acesso/${acessoEquipe}`);
    assert.equal(convite.status, 200);
    assert.equal(convite.corpo.valido, true);

    const login = await chamar('/api/garcom/login', {
      metodo: 'POST',
      dados: { token: acessoEquipe, senha: 'bruno' }
    });
    assert.equal(login.status, 200);
    assert.equal(login.corpo.garcom.nome, 'Bruno Lima');

    // Maiúsculas do teclado do celular não derrubam o acesso.
    const comMaiuscula = await chamar('/api/garcom/login', {
      metodo: 'POST',
      dados: { token: acessoEquipe, senha: 'Bruno' }
    });
    assert.equal(comMaiuscula.status, 200);

    // Sem o QR da equipe a senha sozinha não abre sessão.
    const semQr = await chamar('/api/garcom/login', {
      metodo: 'POST',
      dados: { token: 'equipe-inexistente', senha: 'bruno' }
    });
    assert.equal(semQr.status, 404);

    // Trocar a senha pelo painel derruba a sessão aberta e mata a senha antiga.
    const trocada = await chamar(`/api/admin/funcionarios/${cadastrado.corpo.funcionario.id}`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { nome: 'Bruno Lima', cargo: 'Garçom', senha: 'bruno2' }
    });
    assert.equal(trocada.status, 200);
    const sessaoDerrubada = await chamar('/api/garcom/sessao', { token: login.corpo.token });
    assert.equal(sessaoDerrubada.status, 401);
    const senhaAntiga = await chamar('/api/garcom/login', {
      metodo: 'POST',
      dados: { token: acessoEquipe, senha: 'bruno' }
    });
    assert.equal(senhaAntiga.status, 401);
    const senhaNova = await chamar('/api/garcom/login', {
      metodo: 'POST',
      dados: { token: acessoEquipe, senha: 'bruno2' }
    });
    assert.equal(senhaNova.status, 200);

    // Editar sem informar senha mantém a que já existe.
    const semSenha = await chamar(`/api/admin/funcionarios/${cadastrado.corpo.funcionario.id}`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { nome: 'Bruno Lima Souza', cargo: 'Garçom' }
    });
    assert.equal(semSenha.status, 200);
    const aindaEntra = await chamar('/api/garcom/login', {
      metodo: 'POST',
      dados: { token: acessoEquipe, senha: 'bruno2' }
    });
    assert.equal(aindaEntra.status, 200);

    // Excluir encerra o acesso e some da equipe; o histórico permanece.
    const excluido = await chamar(`/api/admin/funcionarios/${cadastrado.corpo.funcionario.id}`, {
      metodo: 'DELETE',
      token: tokenAdmin
    });
    assert.equal(excluido.status, 200);
    const reexcluir = await chamar(`/api/admin/funcionarios/${cadastrado.corpo.funcionario.id}`, {
      metodo: 'DELETE',
      token: tokenAdmin
    });
    assert.equal(reexcluir.status, 404);
    const depoisDaExclusao = await chamar('/api/garcom/login', {
      metodo: 'POST',
      dados: { token: acessoEquipe, senha: 'bruno2' }
    });
    assert.equal(depoisDaExclusao.status, 401);
    const equipe = await chamar('/api/admin/dados', { token: tokenAdmin });
    assert.equal(
      equipe.corpo.funcionarios.some((item) => item.id === cadastrado.corpo.funcionario.id),
      false
    );
  });

  test('trocar o QR da equipe invalida o código anterior', async () => {
    const novo = await chamar('/api/admin/acesso-garcom', {
      metodo: 'POST',
      token: tokenAdmin
    });
    assert.equal(novo.status, 200);
    assert.notEqual(novo.corpo.acessoGarcom, acessoEquipe);

    const anterior = await chamar(`/api/garcom/acesso/${acessoEquipe}`);
    assert.equal(anterior.status, 404);
    const atual = await chamar(`/api/garcom/acesso/${novo.corpo.acessoGarcom}`);
    assert.equal(atual.status, 200);

    const loginComAntigo = await chamar('/api/garcom/login', {
      metodo: 'POST',
      dados: { token: acessoEquipe, senha: 'demo1' }
    });
    assert.equal(loginComAntigo.status, 404);

    acessoEquipe = novo.corpo.acessoGarcom;
    const loginComNovo = await chamar('/api/garcom/login', {
      metodo: 'POST',
      dados: { token: acessoEquipe, senha: 'demo1' }
    });
    assert.equal(loginComNovo.status, 200);
  });

  test('bloqueia novas tentativas após repetidas senhas inválidas', async () => {
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      const resposta = await chamar('/api/garcom/login', {
        metodo: 'POST',
        dados: { token: acessoEquipe, senha: 'senha-que-nao-existe' }
      });
      assert.equal(resposta.status, 401);
    }
    const bloqueado = await chamar('/api/garcom/login', {
      metodo: 'POST',
      dados: { token: acessoEquipe, senha: 'senha-que-nao-existe' }
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

  /* Permissões por administrador. Ficam por último porque criam contas e
     provocam logins recusados de propósito. */
  async function criarAdministradorPeloPainel(prefixo, senha) {
    const usuario = `${prefixo}-${randomUUID().slice(0, 8)}`;
    const criado = await chamar('/api/admin/administradores', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: `Conta ${usuario}`, usuario, email: `${usuario}@teste.local`, senha, confirmacaoSenha: senha }
    });
    assert.equal(criado.status, 201);
    return { id: criado.corpo.administrador.id, usuario };
  }

  function entrarComo(usuario, senha) {
    return chamar('/api/admin/login', { metodo: 'POST', dados: { usuario, senha } });
  }

  async function permissoesNoBanco(administradorId) {
    const [linhas] = await banco.execute(
      'SELECT permissao FROM administrador_permissoes WHERE administrador_id = ?',
      [administradorId]
    );
    return linhas.map((linha) => linha.permissao).sort();
  }

  async function idDaLoja(slug) {
    const [[linha]] = await banco.execute('SELECT id_estabelecimento FROM estabelecimentos WHERE slug = ?', [slug]);
    return Number(linha.id_estabelecimento);
  }

  const todasAsPermissoes = [...CHAVES_PERMISSOES].sort();

  test('toda conexão do pool trabalha em UTC, qualquer que seja o relógio do servidor', async () => {
    /*
      `timezone: 'Z'` só diz ao mysql2 como converter Date <-> DATETIME; quem
      resolve CURRENT_TIMESTAMP é o servidor. Sem fixar a sessão, o horário
      gravado seguia o relógio da máquina do banco — em produção (MariaDB em
      UTC) dava certo e em desenvolvimento (MySQL em Brasília) não.
    */
    const [[sessao]] = await banco.query(
      'SELECT @@session.time_zone AS fuso, NOW() AS agora, UTC_TIMESTAMP() AS utc'
    );
    assert.equal(sessao.fuso, '+00:00');
    assert.equal(new Date(sessao.agora).toISOString(), new Date(sessao.utc).toISOString());
    // O relógio do banco e o do Node precisam concordar, senão o que for
    // gravado por CURRENT_TIMESTAMP sai deslocado do que o app calcula.
    assert.ok(
      Math.abs(new Date(sessao.agora) - new Date()) < 60_000,
      `NOW() do banco está longe do relógio do Node: ${sessao.agora}`
    );

    // Vale para toda conexão, não só para a primeira que o pool abriu.
    const fusos = await Promise.all(
      [1, 2, 3].map(() => banco.query('SELECT @@session.time_zone AS fuso'))
    );
    assert.deepEqual(fusos.map(([linhas]) => linhas[0].fuso), ['+00:00', '+00:00', '+00:00']);

    // E o que o servidor grava sozinho volta no mesmo relógio do aplicativo.
    const antes = Date.now();
    const [gravado] = await banco.execute(`
      INSERT INTO auditoria_admin (id_estabelecimento, acao, entidade)
      VALUES (?, 'teste.fuso', 'teste')
    `, [await idDaLoja('estabelecimento-padrao')]);
    try {
      const [[linha]] = await banco.execute(
        'SELECT criado_em FROM auditoria_admin WHERE id = ?',
        [gravado.insertId]
      );
      const distancia = Math.abs(new Date(linha.criado_em) - antes);
      assert.ok(distancia < 60_000, `criado_em saiu deslocado do relógio do app: ${linha.criado_em}`);
    } finally {
      await banco.execute('DELETE FROM auditoria_admin WHERE id = ?', [gravado.insertId]);
    }
  });

  test('migration 017: conta criada antes das permissões volta a ter exatamente o acesso completo', async () => {
    const idTenantA = await idDaLoja('estabelecimento-padrao');
    const usuario = `legado-${randomUUID().slice(0, 8)}`;
    const senha = 'senha-legada-segura';
    // Conta como existia antes da migration: a linha em administradores, sem nenhuma permissão.
    const [criado] = await banco.execute(`
      INSERT INTO administradores (id_estabelecimento, usuario, email, nome, senha_hash)
      VALUES (?, ?, ?, 'Conta legada', ?)
    `, [idTenantA, usuario, `${usuario}@teste.local`, criarHashSenha(senha)]);
    const idLegado = Number(criado.insertId);
    assert.deepEqual(await permissoesNoBanco(idLegado), []);

    const login = await entrarComo(usuario, senha);
    assert.equal(login.status, 200);
    const tokenLegado = login.corpo.token;
    assert.equal((await chamar('/api/admin/dashboard/indicadores?periodo=30dias', { token: tokenLegado })).status, 403);

    // Aplica a concessão exatamente como está escrita na migration.
    const migration = await readFile(new URL('../database/migrations/017_permissoes_administradores.sql', import.meta.url), 'utf8');
    const concessao = migration
      .split(/;\s*(?:\r?\n|$)/)
      .map((instrucao) => instrucao.trim())
      .find((instrucao) => instrucao.startsWith('INSERT INTO administrador_permissoes'));
    assert.ok(concessao);
    await banco.query(concessao);

    assert.deepEqual(await permissoesNoBanco(idLegado), todasAsPermissoes);
    // Mesmo token, sem novo login: o acesso volta na hora.
    const sessao = await chamar('/api/admin/sessao', { token: tokenLegado });
    assert.deepEqual([...sessao.corpo.admin.permissoes].sort(), todasAsPermissoes);
    assert.equal((await chamar('/api/admin/dashboard/indicadores?periodo=30dias', { token: tokenLegado })).status, 200);
    const painel = await chamar('/api/admin/dados', { token: tokenLegado });
    assert.equal(painel.status, 200);
    assert.ok(painel.corpo.administradores.length > 0);
    assert.ok(painel.corpo.acessoGarcom);
    assert.ok(painel.corpo.mesas.length > 0);

    // Todo administrador em uso fica com o conjunto completo, sem nada a mais.
    const [contagens] = await banco.execute(`
      SELECT a.id, COUNT(ap.permissao) AS total
      FROM administradores a
      LEFT JOIN administrador_permissoes ap
        ON ap.administrador_id = a.id AND ap.id_estabelecimento = a.id_estabelecimento
      WHERE a.id_estabelecimento IS NOT NULL AND a.arquivado_em IS NULL
      GROUP BY a.id
    `);
    assert.ok(contagens.length > 0);
    assert.ok(contagens.every((linha) => Number(linha.total) === CHAVES_PERMISSOES.length));
  });

  test('administrador da loja A não altera, arquiva, desarquiva nem apaga administrador da loja B', async () => {
    const idTenantB = await idDaLoja('loja-b');
    const usuarioB = `admin-b-${randomUUID().slice(0, 8)}`;
    const [criadoB] = await banco.execute(`
      INSERT INTO administradores (id_estabelecimento, usuario, email, nome, senha_hash)
      VALUES (?, ?, ?, 'Administrador da loja B', ?)
    `, [idTenantB, usuarioB, `${usuarioB}@teste.local`, criarHashSenha('senha-da-loja-b-segura')]);
    const idAdminB = Number(criadoB.insertId);
    await concederPermissoesPadrao(banco, idTenantB, idAdminB);

    for (const [metodo, caminho, dados] of [
      ['PUT', `/api/admin/administradores/${idAdminB}/permissoes`, { permissoes: [] }],
      ['PATCH', `/api/admin/administradores/${idAdminB}/status`, { ativo: false }],
      ['POST', `/api/admin/administradores/${idAdminB}/arquivar`],
      ['POST', `/api/admin/administradores/${idAdminB}/desarquivar`],
      ['DELETE', `/api/admin/administradores/${idAdminB}`]
    ]) {
      const resposta = await chamar(caminho, { metodo, token: tokenAdmin, dados });
      assert.equal(resposta.status, 404, `${metodo} ${caminho}`);
    }
    const cruzada = await chamar(`/api/admin/administradores/${idAdminB}/permissoes`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { permissoes: [] },
      baseUrl: urlBaseTenantB
    });
    assert.equal(cruzada.status, 403);

    const [[contaB]] = await banco.execute(
      'SELECT ativo, arquivado_em FROM administradores WHERE id = ? AND id_estabelecimento = ?',
      [idAdminB, idTenantB]
    );
    assert.equal(Number(contaB.ativo), 1);
    assert.equal(contaB.arquivado_em, null);
    assert.deepEqual(await permissoesNoBanco(idAdminB), todasAsPermissoes);
    const painelA = await chamar('/api/admin/dados', { token: tokenAdmin });
    assert.equal(painelA.corpo.administradores.some((item) => item.id === idAdminB), false);
  });

  test('administrador não eleva as próprias permissões nem concede o que não possui, mesmo chamando a API direto', async () => {
    const senha = 'senha-do-limitado-segura';
    const limitado = await criarAdministradorPeloPainel('limitado', senha);
    const alvo = await criarAdministradorPeloPainel('alvo', 'senha-do-alvo-segura');
    const definir = (id, permissoes) => chamar(`/api/admin/administradores/${id}/permissoes`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { permissoes }
    });
    assert.equal((await definir(limitado.id, ['funcionarios.gerenciar', 'pedidos.visualizar'])).status, 200);
    assert.equal((await definir(alvo.id, ['pedidos.visualizar'])).status, 200);

    const login = await entrarComo(limitado.usuario, senha);
    assert.equal(login.status, 200);
    const tokenLimitado = login.corpo.token;

    const propria = await chamar(`/api/admin/administradores/${limitado.id}/permissoes`, {
      metodo: 'PUT',
      token: tokenLimitado,
      dados: { permissoes: [...CHAVES_PERMISSOES] }
    });
    assert.equal(propria.status, 403);
    const concessao = await chamar(`/api/admin/administradores/${alvo.id}/permissoes`, {
      metodo: 'PUT',
      token: tokenLimitado,
      dados: { permissoes: ['pedidos.visualizar', 'relatorios.visualizar'] }
    });
    assert.equal(concessao.status, 403);
    assert.deepEqual(await permissoesNoBanco(limitado.id), ['funcionarios.gerenciar', 'pedidos.visualizar']);
    assert.deepEqual(await permissoesNoBanco(alvo.id), ['pedidos.visualizar']);

    // Rotas sem a permissão, chamadas direto: recusadas e nada muda no banco.
    const idTenantA = await idDaLoja('estabelecimento-padrao');
    const lerProduto = async () => (await banco.execute(
      'SELECT id, ativo FROM produtos WHERE id_estabelecimento = ? ORDER BY id LIMIT 1',
      [idTenantA]
    ))[0][0];
    const produtoAntes = await lerProduto();
    const produto = await chamar(`/api/admin/produtos/${produtoAntes.id}/status`, {
      metodo: 'PATCH',
      token: tokenLimitado,
      dados: { ativo: !produtoAntes.ativo }
    });
    assert.equal(produto.status, 403);
    assert.equal(Number((await lerProduto()).ativo), Number(produtoAntes.ativo));
    assert.equal((await chamar('/api/admin/dashboard/indicadores?periodo=30dias', { token: tokenLimitado })).status, 403);
    assert.equal((await chamar('/api/admin/configuracao', {
      metodo: 'PUT',
      token: tokenLimitado,
      dados: { nomeLoja: 'Invadida' }
    })).status, 403);

    // /dados só traz o que a conta pode usar.
    const painel = await chamar('/api/admin/dados', { token: tokenLimitado });
    assert.equal(painel.status, 200);
    assert.deepEqual(painel.corpo.mesas, []);
    assert.deepEqual(painel.corpo.promocoes, []);

    // Quem possui concede, e a permissão vale sem novo login.
    assert.equal((await definir(limitado.id, ['funcionarios.gerenciar', 'pedidos.visualizar', 'relatorios.visualizar'])).status, 200);
    assert.equal((await chamar('/api/admin/dashboard/indicadores?periodo=30dias', { token: tokenLimitado })).status, 200);
  });

  test('arquivar tira o acesso, desarquivar devolve a conta desativada e sem permissões, e apagar remove a conta', async () => {
    const senha = 'senha-arquivavel-segura';
    const conta = await criarAdministradorPeloPainel('arquivavel', senha);
    const primeiroLogin = await entrarComo(conta.usuario, senha);
    assert.equal(primeiroLogin.status, 200);

    const idAdmin = (await chamar('/api/admin/sessao', { token: tokenAdmin })).corpo.admin.id;
    assert.equal((await chamar(`/api/admin/administradores/${idAdmin}/arquivar`, { metodo: 'POST', token: tokenAdmin })).status, 403);
    assert.equal((await chamar(`/api/admin/administradores/${idAdmin}`, { metodo: 'DELETE', token: tokenAdmin })).status, 403);

    const lerConta = async () => (await banco.execute(
      'SELECT usuario, ativo, arquivado_em FROM administradores WHERE id = ?',
      [conta.id]
    ))[0][0];

    // Arquivar.
    assert.equal((await chamar(`/api/admin/administradores/${conta.id}/arquivar`, { metodo: 'POST', token: tokenAdmin })).status, 200);
    assert.equal((await chamar('/api/admin/sessao', { token: primeiroLogin.corpo.token })).status, 401);
    assert.equal((await entrarComo(conta.usuario, senha)).status, 401);
    const arquivada = await lerConta();
    assert.equal(arquivada.usuario, conta.usuario);
    assert.equal(Number(arquivada.ativo), 0);
    assert.ok(arquivada.arquivado_em);
    assert.deepEqual(await permissoesNoBanco(conta.id), []);
    const painelComArquivada = await chamar('/api/admin/dados', { token: tokenAdmin });
    assert.equal(painelComArquivada.corpo.administradores.find((item) => item.id === conta.id)?.arquivado, true);
    const duplicada = await chamar('/api/admin/administradores', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: 'Outra conta', usuario: conta.usuario, email: `outra-${conta.usuario}@teste.local`, senha, confirmacaoSenha: senha }
    });
    assert.equal(duplicada.status, 409);
    assert.equal((await chamar(`/api/admin/administradores/${conta.id}/permissoes`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { permissoes: ['pedidos.visualizar'] }
    })).status, 404);
    assert.equal((await chamar(`/api/admin/administradores/${conta.id}/status`, {
      metodo: 'PATCH',
      token: tokenAdmin,
      dados: { ativo: true }
    })).status, 404);

    // Desarquivar: volta desativada e sem permissões.
    assert.equal((await chamar(`/api/admin/administradores/${conta.id}/desarquivar`, { metodo: 'POST', token: tokenAdmin })).status, 200);
    const desarquivada = await lerConta();
    assert.equal(desarquivada.arquivado_em, null);
    assert.equal(Number(desarquivada.ativo), 0);
    assert.deepEqual(await permissoesNoBanco(conta.id), []);
    assert.equal((await entrarComo(conta.usuario, senha)).status, 401);

    // Reativada, entra, mas sem permissões não abre nada protegido.
    assert.equal((await chamar(`/api/admin/administradores/${conta.id}/status`, {
      metodo: 'PATCH',
      token: tokenAdmin,
      dados: { ativo: true }
    })).status, 200);
    const reativada = await entrarComo(conta.usuario, senha);
    assert.equal(reativada.status, 200);
    assert.equal((await chamar('/api/admin/dashboard/indicadores?periodo=30dias', { token: reativada.corpo.token })).status, 403);

    // Apagar.
    assert.equal((await chamar(`/api/admin/administradores/${conta.id}`, { metodo: 'DELETE', token: tokenAdmin })).status, 200);
    const [restantes] = await banco.execute('SELECT id FROM administradores WHERE id = ?', [conta.id]);
    assert.equal(restantes.length, 0);
    assert.deepEqual(await permissoesNoBanco(conta.id), []);
    assert.equal((await entrarComo(conta.usuario, senha)).status, 401);
    const historico = await chamar('/api/admin/dados', { token: tokenAdmin });
    const loginDaContaApagada = historico.corpo.auditoria.find((item) => item.usuario === conta.usuario);
    assert.equal(loginDaContaApagada?.administrador, 'Conta apagada');
  });

  /*
    Impressão automática: roteamento por categoria, exceção por produto e fila
    consumida pelo agente local. O que estes testes protegem, em ordem:
    isolamento entre lojas, produto sem impressora não bloquear nada, reenvio
    da comanda não reimprimir, e dispositivo revogado perder o acesso na hora.
  */
  async function filaDoDispositivo(token, baseUrl = urlBase) {
    const resposta = await fetch(`${baseUrl}/api/impressao/trabalhos`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
    });
    return { status: resposta.status, corpo: await resposta.json() };
  }

  /* ESC E 1: liga o negrito. É o prefixo que prova que a linha saiu
     destacada no papel, e não como texto comum. */
  const NEGRITO_LIGADO = '\x1bE\x01';

  /* O que realmente sai no papel: o agente monta o recibo em ESC/POS,
     transliterando acentos e escrevendo em latin1. Ler de volta do mesmo
     jeito é o que deixa o teste conferir o ticket, e não só o JSON. */
  function ticketDoTrabalho(trabalho) {
    return montarRecibo(trabalho).toString('latin1');
  }

  async function confirmarFila(token = tokenDispositivoImpressao) {
    const { corpo } = await filaDoDispositivo(token);
    for (const trabalho of corpo.trabalhos) {
      await chamar(`/api/impressao/trabalhos/${trabalho.id}/confirmar`, { metodo: 'POST', token });
    }
  }

  test('produto sem impressora configurada não gera trabalho e não impede pedido nem comanda', async () => {
    // Nenhuma impressora cadastrada ainda: é o estado de quem acabou de instalar.
    const dispositivo = await chamar('/api/admin/impressao/dispositivos', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: 'PC da cozinha' }
    });
    assert.equal(dispositivo.status, 201);
    assert.match(dispositivo.corpo.token, /^[A-Za-z0-9_-]{32,128}$/);
    tokenDispositivoImpressao = dispositivo.corpo.token;

    // O token em texto puro sai só na criação; a listagem nunca o devolve.
    const painel = await chamar('/api/admin/impressoras', { token: tokenAdmin });
    assert.equal(painel.status, 200);
    assert.equal(JSON.stringify(painel.corpo).includes(tokenDispositivoImpressao), false);

    const pedido = await chamar('/api/pedidos', { metodo: 'POST', dados: dadosPedido() });
    assert.equal(pedido.status, 201, JSON.stringify(pedido.corpo));

    const fila = await filaDoDispositivo(tokenDispositivoImpressao);
    assert.equal(fila.status, 200);
    assert.deepEqual(fila.corpo.trabalhos, []);
  });

  test('roteia o pedido para a impressora da categoria e respeita a exceção do produto', async () => {
    const cozinha = await chamar('/api/admin/impressoras', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: 'Cozinha', host: '192.168.0.50', porta: 9100 }
    });
    assert.equal(cozinha.status, 201);
    assert.equal(cozinha.corpo.impressora.porta, 9100);
    idImpressoraCozinha = cozinha.corpo.impressora.id;

    const bar = await chamar('/api/admin/impressoras', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: 'Bar', host: 'impressora-bar.local' }
    });
    assert.equal(bar.status, 201);
    // Sem porta informada, vale a padrão das térmicas de rede.
    assert.equal(bar.corpo.impressora.porta, 9100);
    idImpressoraBar = bar.corpo.impressora.id;

    // Host com protocolo, caminho ou espaço é recusado antes de gravar.
    for (const host of ['http://192.168.0.50', '192.168.0.50/fila', 'impressora da cozinha', '192.168.0.50:9100']) {
      const invalida = await chamar('/api/admin/impressoras', {
        metodo: 'POST',
        token: tokenAdmin,
        dados: { nome: `Inválida ${host}`, host }
      });
      assert.equal(invalida.status, 400, host);
    }

    const dados = await chamar('/api/admin/dados', { token: tokenAdmin });
    const categoriaHamburgueres = dados.corpo.categorias.find((categoria) => categoria.nome === 'Hambúrgueres');
    const categoriaBebidas = dados.corpo.categorias.find((categoria) => categoria.nome === 'Bebidas');
    assert.ok(categoriaHamburgueres && categoriaBebidas);

    const comImpressora = await chamar(`/api/admin/categorias/${categoriaHamburgueres.id}`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { ...categoriaHamburgueres, impressoraId: idImpressoraCozinha }
    });
    assert.equal(comImpressora.status, 200);
    assert.equal(comImpressora.corpo.categoria.impressoraId, idImpressoraCozinha);

    await chamar(`/api/admin/categorias/${categoriaBebidas.id}`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { ...categoriaBebidas, impressoraId: idImpressoraBar }
    });

    const hamburguer = dados.corpo.produtos.find((produto) => produto.categoriaId === categoriaHamburgueres.id);
    const bebida = dados.corpo.produtos.find((produto) => produto.categoriaId === categoriaBebidas.id);
    assert.ok(hamburguer && bebida);

    const pedido = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido({
        itens: [{ id: hamburguer.id, quantidade: 2 }, { id: bebida.id, quantidade: 1 }]
      })
    });
    assert.equal(pedido.status, 201, JSON.stringify(pedido.corpo));

    const fila = await filaDoDispositivo(tokenDispositivoImpressao);
    assert.equal(fila.status, 200);
    // Um trabalho por impressora envolvida, cada um só com os itens dela.
    assert.equal(fila.corpo.trabalhos.length, 2);
    const naCozinha = fila.corpo.trabalhos.find((trabalho) => trabalho.impressora.nome === 'Cozinha');
    const noBar = fila.corpo.trabalhos.find((trabalho) => trabalho.impressora.nome === 'Bar');
    assert.deepEqual(naCozinha.conteudo.itens.map((item) => item.nome), [hamburguer.nome]);
    assert.equal(naCozinha.conteudo.itens[0].quantidade, 2);
    assert.deepEqual(noBar.conteudo.itens.map((item) => item.nome), [bebida.nome]);
    assert.equal(naCozinha.impressora.host, '192.168.0.50');
    assert.equal(naCozinha.conteudo.origem, 'delivery');
    assert.equal(naCozinha.conteudo.cabecalho.cliente, 'Cliente Teste');

    // Exceção por produto: a bebida passa a sair na cozinha, não no bar.
    const excecao = await chamar(`/api/admin/produtos/${bebida.id}`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { ...bebida, impressoraId: idImpressoraCozinha }
    });
    assert.equal(excecao.status, 200);
    assert.equal(excecao.corpo.produto.impressoraId, idImpressoraCozinha);

    for (const trabalho of fila.corpo.trabalhos) {
      const confirmado = await chamar(`/api/impressao/trabalhos/${trabalho.id}/confirmar`, {
        metodo: 'POST',
        token: tokenDispositivoImpressao
      });
      assert.equal(confirmado.status, 200);
    }

    const pedidoComExcecao = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido({ itens: [{ id: bebida.id, quantidade: 1 }] })
    });
    assert.equal(pedidoComExcecao.status, 201);
    const filaExcecao = await filaDoDispositivo(tokenDispositivoImpressao);
    assert.equal(filaExcecao.corpo.trabalhos.length, 1);
    assert.equal(filaExcecao.corpo.trabalhos[0].impressora.nome, 'Cozinha');

    // Falha mantém o trabalho pendente e só conta a tentativa.
    const falhou = await chamar(`/api/impressao/trabalhos/${filaExcecao.corpo.trabalhos[0].id}/falhar`, {
      metodo: 'POST',
      token: tokenDispositivoImpressao
    });
    assert.equal(falhou.status, 200);
    const filaDepoisDaFalha = await filaDoDispositivo(tokenDispositivoImpressao);
    assert.equal(filaDepoisDaFalha.corpo.trabalhos.length, 1);
    assert.equal(filaDepoisDaFalha.corpo.trabalhos[0].tentativas, 1);

    await chamar(`/api/impressao/trabalhos/${filaDepoisDaFalha.corpo.trabalhos[0].id}/confirmar`, {
      metodo: 'POST',
      token: tokenDispositivoImpressao
    });
    assert.deepEqual((await filaDoDispositivo(tokenDispositivoImpressao)).corpo.trabalhos, []);
  });

  test('reenviar a comanda com item novo imprime só o item novo', async () => {
    const dados = await chamar('/api/admin/dados', { token: tokenAdmin });
    const categoriaHamburgueres = dados.corpo.categorias.find((categoria) => categoria.nome === 'Hambúrgueres');
    const primeiro = dados.corpo.produtos.find((produto) => produto.categoriaId === categoriaHamburgueres.id);
    const segundo = dados.corpo.produtos.find((produto) => (
      produto.categoriaId === categoriaHamburgueres.id && produto.id !== primeiro.id
    ));
    assert.ok(primeiro && segundo);

    const mesa = await chamar('/api/admin/mesas', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { numero: '77' }
    });
    assert.equal(mesa.status, 201);
    const comanda = await chamar('/api/admin/comandas', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { mesaId: mesa.corpo.mesa.id }
    });
    assert.equal(comanda.status, 201);
    const comandaId = comanda.corpo.comanda.id;

    await chamar(`/api/admin/comandas/${comandaId}/itens`, {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { produtoId: primeiro.id, quantidade: 1, adicionais: [], observacao: 'sem cebola' }
    });
    assert.equal((await chamar(`/api/admin/comandas/${comandaId}/lancar`, {
      metodo: 'POST',
      token: tokenAdmin
    })).status, 200);

    const primeiraFila = await filaDoDispositivo(tokenDispositivoImpressao);
    assert.equal(primeiraFila.corpo.trabalhos.length, 1);
    const primeiroTrabalho = primeiraFila.corpo.trabalhos[0];
    assert.equal(primeiroTrabalho.conteudo.origem, 'comanda');
    assert.equal(primeiroTrabalho.conteudo.cabecalho.mesa, 'Mesa 77');
    assert.deepEqual(primeiroTrabalho.conteudo.itens.map((item) => item.nome), [primeiro.nome]);
    assert.equal(primeiroTrabalho.conteudo.itens[0].observacao, 'sem cebola');
    await chamar(`/api/impressao/trabalhos/${primeiroTrabalho.id}/confirmar`, {
      metodo: 'POST',
      token: tokenDispositivoImpressao
    });

    // Cliente pede mais uma coisa e o garçom manda a comanda de novo.
    await chamar(`/api/admin/comandas/${comandaId}/itens`, {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { produtoId: segundo.id, quantidade: 3, adicionais: [] }
    });
    assert.equal((await chamar(`/api/admin/comandas/${comandaId}/lancar`, {
      metodo: 'POST',
      token: tokenAdmin
    })).status, 200);

    const segundaFila = await filaDoDispositivo(tokenDispositivoImpressao);
    assert.equal(segundaFila.corpo.trabalhos.length, 1);
    // A cozinha recebe só o item novo: o primeiro já saiu no envio anterior.
    assert.deepEqual(segundaFila.corpo.trabalhos[0].conteudo.itens.map((item) => item.nome), [segundo.nome]);
    assert.equal(segundaFila.corpo.trabalhos[0].conteudo.itens[0].quantidade, 3);
    await chamar(`/api/impressao/trabalhos/${segundaFila.corpo.trabalhos[0].id}/confirmar`, {
      metodo: 'POST',
      token: tokenDispositivoImpressao
    });
  });

  test('ticket da comanda traz o número da comanda e a observação da mesa, e não quebra sem ela', async () => {
    const dados = await chamar('/api/admin/dados', { token: tokenAdmin });
    const categoriaHamburgueres = dados.corpo.categorias.find((categoria) => categoria.nome === 'Hambúrgueres');
    const produto = dados.corpo.produtos.find((item) => item.categoriaId === categoriaHamburgueres.id);
    assert.ok(produto);

    const mesa = await chamar('/api/admin/mesas', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { numero: '78' }
    });
    assert.equal(mesa.status, 201);
    const comanda = await chamar('/api/admin/comandas', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { mesaId: mesa.corpo.mesa.id }
    });
    assert.equal(comanda.status, 201);
    const comandaId = comanda.corpo.comanda.id;

    const recado = 'Alergia a amendoim (avó)';
    assert.equal((await chamar(`/api/admin/comandas/${comandaId}/observacao`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { observacao: recado }
    })).status, 200);

    await chamar(`/api/admin/comandas/${comandaId}/itens`, {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { produtoId: produto.id, quantidade: 1, adicionais: [] }
    });
    assert.equal((await chamar(`/api/admin/comandas/${comandaId}/lancar`, {
      metodo: 'POST',
      token: tokenAdmin
    })).status, 200);

    const fila = await filaDoDispositivo(tokenDispositivoImpressao);
    assert.equal(fila.corpo.trabalhos.length, 1);
    const trabalho = fila.corpo.trabalhos[0];
    assert.equal(trabalho.conteudo.cabecalho.numeroMesa, '78');
    assert.equal(trabalho.conteudo.cabecalho.observacaoComanda, recado);
    // `mesa` continua no registro do trabalho, mesmo sem ir para o papel.
    assert.equal(trabalho.conteudo.cabecalho.mesa, 'Mesa 78');

    const ticket = ticketDoTrabalho(trabalho);
    // A comanda é identificada pela mesa, no próprio título: nada de uma
    // linha "Comanda #" e outra "Mesa" repetindo a mesma informação.
    assert.ok(ticket.includes('COMANDA 78'), ticket);
    assert.equal(ticket.includes('Comanda #'), false, ticket);
    assert.equal(/^Mesa /m.test(ticket), false, ticket);
    // O papel não tem acento: o agente translitera antes de imprimir.
    assert.ok(ticket.includes('OBS DA MESA: Alergia a amendoim (avo)'), ticket);
    // O setor sai da folha: o papel já nasce na impressora daquele setor.
    assert.equal(ticket.includes('Setor:'), false, ticket);
    // O número do trabalho fica no log do agente, não no papel da cozinha.
    assert.equal(ticket.includes('Trabalho #'), false, ticket);
    // Recibo de cozinha não leva preço: o item sai só com quantidade e nome.
    assert.equal(/R\$|\d+,\d{2}/.test(ticket), false, ticket);

    /* Negrito só no título: é o único ESC E 1 do recibo inteiro, e ele vem
       antes de "COMANDA". Recado e itens saem em texto normal. */
    assert.equal(ticket.split(NEGRITO_LIGADO).length - 1, 1, ticket);
    assert.ok(ticket.includes(`${NEGRITO_LIGADO}COMANDA 78`), ticket);
    await confirmarFila();

    // Recado apagado: o ticket seguinte sai sem a linha e sem quebrar.
    assert.equal((await chamar(`/api/admin/comandas/${comandaId}/observacao`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { observacao: '' }
    })).status, 200);
    await chamar(`/api/admin/comandas/${comandaId}/itens`, {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { produtoId: produto.id, quantidade: 1, adicionais: [] }
    });
    assert.equal((await chamar(`/api/admin/comandas/${comandaId}/lancar`, {
      metodo: 'POST',
      token: tokenAdmin
    })).status, 200);

    const semRecado = await filaDoDispositivo(tokenDispositivoImpressao);
    assert.equal(semRecado.corpo.trabalhos.length, 1);
    const trabalhoSemRecado = semRecado.corpo.trabalhos[0];
    assert.equal(trabalhoSemRecado.conteudo.cabecalho.observacaoComanda, null);
    const ticketSemRecado = ticketDoTrabalho(trabalhoSemRecado);
    assert.equal(ticketSemRecado.includes('OBS DA MESA'), false, ticketSemRecado);
    // O número da mesa continua no título, mesmo sem recado.
    assert.ok(ticketSemRecado.includes('COMANDA 78'), ticketSemRecado);
    await confirmarFila();

    // Recado comprido não estoura a largura do papel: quebra em linhas.
    const comprido = ticketDoTrabalho({
      id: 2,
      conteudo: {
        origem: 'comanda',
        cabecalho: {
          numeroMesa: '78',
          mesa: 'Mesa 78',
          observacaoComanda: 'Mesa com alergia grave a amendoim e a frutos do mar, avisar o chef antes'
        },
        itens: []
      }
    });
    /* O recado quebra em 42 colunas e nenhum pedaço some por estourar a
       largura do papel — agora em texto normal, sem negrito. */
    assert.ok(comprido.includes('OBS DA MESA: Mesa com alergia grave a\n'), comprido);
    assert.ok(comprido.includes('  amendoim e a frutos do mar, avisar o chef\n'), comprido);
    assert.ok(comprido.includes('  antes\n'), comprido);
    assert.equal(comprido.split(NEGRITO_LIGADO).length - 1, 1, comprido);

    // Trabalho antigo, gravado antes desta mudança e ainda na fila: sem
    // `numeroMesa` o título volta a ser só "COMANDA", em vez de quebrar.
    const antigo = ticketDoTrabalho({
      id: 1,
      conteudo: { origem: 'comanda', cabecalho: { mesa: 'Mesa 9' }, itens: [] }
    });
    assert.ok(antigo.includes(`${NEGRITO_LIGADO}COMANDA\n`), antigo);
    assert.equal(antigo.includes('Comanda #'), false, antigo);
    assert.equal(antigo.includes('OBS DA MESA'), false, antigo);
  });

  test('ticket de delivery não mostra mais a forma de pagamento', async () => {
    const dados = await chamar('/api/admin/dados', { token: tokenAdmin });
    const categoriaHamburgueres = dados.corpo.categorias.find((categoria) => categoria.nome === 'Hambúrgueres');
    // Produto com impressora resolvida, senão o pedido não gera trabalho nenhum.
    const produto = dados.corpo.produtos.find((item) => item.categoriaId === categoriaHamburgueres.id);
    assert.ok(produto);

    // Fila limpa antes: o que sobrar de outro teste não entra na conferência.
    await confirmarFila();
    const pedido = await chamar('/api/pedidos', {
      metodo: 'POST',
      dados: dadosPedido({
        pagamento: 'Cartão na entrega',
        itens: [{ id: produto.id, quantidade: 1 }]
      })
    });
    assert.equal(pedido.status, 201, JSON.stringify(pedido.corpo));

    const fila = await filaDoDispositivo(tokenDispositivoImpressao);
    assert.ok(fila.corpo.trabalhos.length > 0);
    for (const trabalho of fila.corpo.trabalhos) {
      assert.equal(trabalho.conteudo.origem, 'delivery');
      assert.equal('pagamento' in trabalho.conteudo.cabecalho, false);

      const ticket = ticketDoTrabalho(trabalho);
      assert.equal(/Pagamento/i.test(ticket), false, ticket);
      // O resto do cabeçalho continua lá: é por ele que a cozinha se orienta.
      assert.ok(ticket.includes('Cliente: Cliente Teste'), ticket);
      assert.ok(ticket.includes(`Pedido ${pedido.corpo.pedido.id}`), ticket);
      // Mesma regra visual da comanda: setor e trabalho fora, negrito só no título.
      assert.equal(ticket.includes('Setor:'), false, ticket);
      assert.equal(ticket.includes('Trabalho #'), false, ticket);
      assert.equal(ticket.split(NEGRITO_LIGADO).length - 1, 1, ticket);
      assert.ok(ticket.includes(`${NEGRITO_LIGADO}PEDIDO`), ticket);
    }

    // O dado não foi perdido: sumiu do papel, não do banco.
    assert.equal(pedido.corpo.pedido.pagamento, 'Cartão na entrega');
    const [[gravado]] = await banco.execute(`
      SELECT p.pagamento, g.forma
      FROM pedidos p
      INNER JOIN pagamentos g ON g.pedido_id = p.id AND g.id_estabelecimento = p.id_estabelecimento
      WHERE p.id = ?
    `, [Number(String(pedido.corpo.pedido.id).replace(/\D/g, ''))]);
    assert.equal(gravado.pagamento, 'Cartão na entrega');
    assert.equal(gravado.forma, 'Cartão na entrega');
    await confirmarFila();
  });

  test('marcar uma impressora como caixa desmarca a que estava marcada antes', async () => {
    const [[lojaA]] = await banco.execute(
      'SELECT id_estabelecimento FROM estabelecimentos WHERE slug = ?',
      ['estabelecimento-padrao']
    );
    const idLojaA = Number(lojaA.id_estabelecimento);
    const nomes = (lista) => lista.filter((i) => i.ehCaixa).map((i) => i.nome).sort();
    const listar = async () => (await chamar('/api/admin/impressoras', { token: tokenAdmin })).corpo.impressoras;

    // Nenhuma impressora nasce como caixa: a loja escolhe.
    assert.deepEqual(nomes(await listar()), []);
    assert.equal(await buscarImpressoraDeCaixa(banco, idLojaA), null);

    const marcar = (id, nome, host, ehCaixa) => chamar(`/api/admin/impressoras/${id}`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { nome, host, porta: 9100, ehCaixa }
    });

    const cozinha = await marcar(idImpressoraCozinha, 'Cozinha', '192.168.0.50', true);
    assert.equal(cozinha.status, 200);
    assert.equal(cozinha.corpo.impressora.ehCaixa, true);
    assert.deepEqual(nomes(await listar()), ['Cozinha']);
    assert.equal((await buscarImpressoraDeCaixa(banco, idLojaA)).id, idImpressoraCozinha);

    // Marcar o Bar tira a marca da Cozinha, sem ninguém precisar desmarcá-la.
    const bar = await marcar(idImpressoraBar, 'Bar', 'impressora-bar.local', true);
    assert.equal(bar.status, 200);
    assert.equal(bar.corpo.impressora.ehCaixa, true);
    assert.deepEqual(nomes(await listar()), ['Bar']);
    assert.equal((await buscarImpressoraDeCaixa(banco, idLojaA)).id, idImpressoraBar);

    // Uma impressora nova já nascendo como caixa também desmarca a anterior.
    const balcao = await chamar('/api/admin/impressoras', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: 'Balcao', host: '192.168.0.77', porta: 9100, ehCaixa: true }
    });
    assert.equal(balcao.status, 201);
    assert.equal(balcao.corpo.impressora.ehCaixa, true);
    assert.deepEqual(nomes(await listar()), ['Balcao']);

    /* Nunca mais de uma marcada no banco: é a regra que a aplicação garante
       na transação, já que o MySQL não tem índice único parcial. */
    const contarCaixas = async (idEstabelecimento) => {
      const [[linha]] = await banco.execute(
        'SELECT COUNT(id) AS total FROM impressoras WHERE id_estabelecimento = ? AND eh_caixa = 1',
        [idEstabelecimento]
      );
      return Number(linha.total);
    };
    assert.equal(await contarCaixas(idLojaA), 1);

    // Salvar sem falar de caixa não mexe na marcação (mesmo tratamento de `ativa`).
    const soRenomeia = await chamar(`/api/admin/impressoras/${balcao.corpo.impressora.id}`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { nome: 'Balcao principal', host: '192.168.0.77', porta: 9100 }
    });
    assert.equal(soRenomeia.status, 200);
    assert.equal(soRenomeia.corpo.impressora.ehCaixa, true);
    assert.equal(await contarCaixas(idLojaA), 1);

    // E desmarcar deixa a loja sem impressora de caixa, sem eleger outra.
    const desmarcada = await chamar(`/api/admin/impressoras/${balcao.corpo.impressora.id}`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { nome: 'Balcao principal', host: '192.168.0.77', porta: 9100, ehCaixa: false }
    });
    assert.equal(desmarcada.status, 200);
    assert.equal(desmarcada.corpo.impressora.ehCaixa, false);
    assert.equal(await contarCaixas(idLojaA), 0);
    assert.equal(await buscarImpressoraDeCaixa(banco, idLojaA), null);

    // Valor de outro tipo é recusado antes de gravar.
    const invalida = await chamar(`/api/admin/impressoras/${idImpressoraCozinha}`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { nome: 'Cozinha', host: '192.168.0.50', porta: 9100, ehCaixa: 'sim' }
    });
    assert.equal(invalida.status, 400);
  });

  test('exclui impressora sem uso, mas recusa a que tem histórico ou roteia o cardápio', async () => {
    const [[lojaA]] = await banco.execute(
      'SELECT id_estabelecimento FROM estabelecimentos WHERE slug = ?',
      ['estabelecimento-padrao']
    );
    const idLojaA = Number(lojaA.id_estabelecimento);
    const listar = async () => (await chamar('/api/admin/impressoras', { token: tokenAdmin })).corpo.impressoras;

    // 1. Cadastrada errado: nunca imprimiu, não roteia nada. Some sem drama.
    const errada = await chamar('/api/admin/impressoras', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: 'Cadastrada errado', host: '192.168.0.99', porta: 9100 }
    });
    assert.equal(errada.status, 201);
    const idErrada = errada.corpo.impressora.id;
    assert.equal((await listar()).some((i) => i.id === idErrada), true);

    const apagada = await chamar(`/api/admin/impressoras/${idErrada}`, {
      metodo: 'DELETE',
      token: tokenAdmin
    });
    assert.equal(apagada.status, 200);
    assert.equal((await listar()).some((i) => i.id === idErrada), false);
    const [[sumiu]] = await banco.execute(
      'SELECT COUNT(id) AS total FROM impressoras WHERE id = ? AND id_estabelecimento = ?',
      [idErrada, idLojaA]
    );
    assert.equal(Number(sumiu.total), 0);

    // Apagar duas vezes não inventa sucesso: a segunda é 404.
    assert.equal((await chamar(`/api/admin/impressoras/${idErrada}`, {
      metodo: 'DELETE',
      token: tokenAdmin
    })).status, 404);

    // 2. Ainda roteia o cardápio: recusa, e a mensagem diz o que trocar antes.
    const emUso = await chamar('/api/admin/impressoras', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: 'Rotea o cardapio', host: '192.168.0.98', porta: 9100 }
    });
    assert.equal(emUso.status, 201);
    const idEmUso = emUso.corpo.impressora.id;
    const dadosPainel = await chamar('/api/admin/dados', { token: tokenAdmin });
    const categoria = dadosPainel.corpo.categorias.find((c) => c.nome === 'Bebidas');
    assert.ok(categoria);
    assert.equal((await chamar(`/api/admin/categorias/${categoria.id}`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { ...categoria, impressoraId: idEmUso }
    })).status, 200);

    const recusadaPeloCardapio = await chamar(`/api/admin/impressoras/${idEmUso}`, {
      metodo: 'DELETE',
      token: tokenAdmin
    });
    assert.equal(recusadaPeloCardapio.status, 409);
    assert.match(recusadaPeloCardapio.corpo.erro, /1 categoria do cardapio|1 categoria do cardápio/i);
    // A chave estrangeira é ON DELETE SET NULL: se tivesse apagado, a categoria
    // perderia o roteamento em silêncio. Nada disso aconteceu.
    const [[categoriaIntacta]] = await banco.execute(
      'SELECT impressora_id FROM categorias WHERE id = ? AND id_estabelecimento = ?',
      [categoria.id, idLojaA]
    );
    assert.equal(Number(categoriaIntacta.impressora_id), idEmUso);
    assert.equal((await listar()).some((i) => i.id === idEmUso), true);

    // Solto o roteamento e aí some.
    assert.equal((await chamar(`/api/admin/categorias/${categoria.id}`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { ...categoria, impressoraId: null }
    })).status, 200);
    assert.equal((await chamar(`/api/admin/impressoras/${idEmUso}`, {
      metodo: 'DELETE',
      token: tokenAdmin
    })).status, 200);

    // 3. Já imprimiu: o histórico segura, e a saída é desativar.
    const comHistorico = await chamar(`/api/admin/impressoras/${idImpressoraCozinha}`, {
      metodo: 'DELETE',
      token: tokenAdmin
    });
    assert.equal(comHistorico.status, 409);
    assert.match(comHistorico.corpo.erro, /hist[oó]rico/i);
    assert.equal((await listar()).some((i) => i.id === idImpressoraCozinha), true);
    // Desativar continua funcionando: é a saída que a mensagem indica.
    const desativada = await chamar(`/api/admin/impressoras/${idImpressoraCozinha}/status`, {
      metodo: 'PATCH',
      token: tokenAdmin,
      dados: { ativa: false }
    });
    assert.equal(desativada.status, 200);
    assert.equal(desativada.corpo.impressora.ativa, false);
    await chamar(`/api/admin/impressoras/${idImpressoraCozinha}/status`, {
      metodo: 'PATCH',
      token: tokenAdmin,
      dados: { ativa: true }
    });
  });

  test('uma loja não exclui a impressora da outra', async () => {
    const [[tenantB]] = await banco.execute(
      'SELECT id_estabelecimento FROM estabelecimentos WHERE slug = ?',
      ['loja-b']
    );
    const idTenantB = Number(tenantB.id_estabelecimento);
    const [alvo] = await banco.execute(`
      INSERT INTO impressoras (id_estabelecimento, nome, host, porta, ativa)
      VALUES (?, 'Descartavel da Loja B', '10.0.0.88', 9100, 1)
    `, [idTenantB]);
    const idAlvo = Number(alvo.insertId);

    try {
      // Sem uso nenhum: só o tenant impede. Se vazasse, apagaria de verdade.
      const cruzada = await chamar(`/api/admin/impressoras/${idAlvo}`, {
        metodo: 'DELETE',
        token: tokenAdmin
      });
      assert.equal(cruzada.status, 404);
      const [[continua]] = await banco.execute(
        'SELECT nome FROM impressoras WHERE id = ? AND id_estabelecimento = ?',
        [idAlvo, idTenantB]
      );
      assert.equal(continua.nome, 'Descartavel da Loja B');
    } finally {
      await banco.execute(
        'DELETE FROM impressoras WHERE id = ? AND id_estabelecimento = ?',
        [idAlvo, idTenantB]
      );
    }
  });

  test('a impressora de caixa de uma loja não interfere na da outra', async () => {
    const [[tenantB]] = await banco.execute(
      'SELECT id_estabelecimento FROM estabelecimentos WHERE slug = ?',
      ['loja-b']
    );
    const idTenantB = Number(tenantB.id_estabelecimento);
    const [[lojaA]] = await banco.execute(
      'SELECT id_estabelecimento FROM estabelecimentos WHERE slug = ?',
      ['estabelecimento-padrao']
    );
    const idLojaA = Number(lojaA.id_estabelecimento);
    const [caixaB] = await banco.execute(`
      INSERT INTO impressoras (id_estabelecimento, nome, host, porta, ativa, eh_caixa)
      VALUES (?, 'Caixa da Loja B', '10.0.0.77', 9100, 1, 1)
    `, [idTenantB]);
    const idCaixaB = Number(caixaB.insertId);

    try {
      // Marcar o caixa da loja A não pode encostar na loja B.
      const marcada = await chamar(`/api/admin/impressoras/${idImpressoraCozinha}`, {
        metodo: 'PUT',
        token: tokenAdmin,
        dados: { nome: 'Cozinha', host: '192.168.0.50', porta: 9100, ehCaixa: true }
      });
      assert.equal(marcada.status, 200);
      assert.equal(marcada.corpo.impressora.ehCaixa, true);

      const [[aindaCaixa]] = await banco.execute(
        'SELECT eh_caixa FROM impressoras WHERE id = ? AND id_estabelecimento = ?',
        [idCaixaB, idTenantB]
      );
      assert.equal(Number(aindaCaixa.eh_caixa), 1);

      // Cada loja enxerga a própria, e só a própria.
      const caixaDeA = await buscarImpressoraDeCaixa(banco, idLojaA);
      const caixaDeB = await buscarImpressoraDeCaixa(banco, idTenantB);
      assert.equal(caixaDeA.id, idImpressoraCozinha);
      assert.equal(caixaDeB.id, idCaixaB);
      assert.equal(caixaDeB.nome, 'Caixa da Loja B');

      // A loja A não lista nem edita a impressora da loja B, nem sabendo o id.
      const painelA = await chamar('/api/admin/impressoras', { token: tokenAdmin });
      assert.equal(painelA.corpo.impressoras.some((i) => i.id === idCaixaB), false);
      const cruzada = await chamar(`/api/admin/impressoras/${idCaixaB}`, {
        metodo: 'PUT',
        token: tokenAdmin,
        dados: { nome: 'Invasao', host: '10.0.0.77', porta: 9100, ehCaixa: true }
      });
      assert.equal(cruzada.status, 404);
      const [[intacta]] = await banco.execute(
        'SELECT nome, eh_caixa FROM impressoras WHERE id = ? AND id_estabelecimento = ?',
        [idCaixaB, idTenantB]
      );
      assert.equal(intacta.nome, 'Caixa da Loja B');
      assert.equal(Number(intacta.eh_caixa), 1);
    } finally {
      await banco.execute(
        'DELETE FROM impressoras WHERE id = ? AND id_estabelecimento = ?',
        [idCaixaB, idTenantB]
      );
    }
  });

  test('dois estabelecimentos não enxergam os trabalhos de impressão um do outro', async () => {
    const [[tenantB]] = await banco.execute(
      "SELECT id_estabelecimento FROM estabelecimentos WHERE slug = 'loja-b'"
    );
    const idTenantB = Number(tenantB.id_estabelecimento);
    const [impressoraB] = await banco.execute(`
      INSERT INTO impressoras (id_estabelecimento, nome, host, porta, ativa)
      VALUES (?, 'Cozinha da Loja B', '10.0.0.9', 9100, 1)
    `, [idTenantB]);
    const [categoriasB] = await banco.execute(
      'SELECT id FROM categorias WHERE id_estabelecimento = ? LIMIT 1',
      [idTenantB]
    );
    await banco.execute(
      'UPDATE categorias SET impressora_id = ? WHERE id = ? AND id_estabelecimento = ?',
      [impressoraB.insertId, categoriasB[0].id, idTenantB]
    );

    const dispositivoB = await chamar('/api/admin/impressao/dispositivos', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: 'Tentativa da loja B' },
      baseUrl: urlBaseTenantB
    });
    // A sessão da loja A não vale no host da loja B.
    assert.equal(dispositivoB.status, 403);

    // A loja B nasce sem forma de pagamento habilitada no `before`.
    await banco.execute(
      'UPDATE configuracoes_estabelecimento SET aceita_cartao = 1 WHERE id_estabelecimento = ?',
      [idTenantB]
    );
    const [produtosB] = await banco.execute(
      'SELECT id FROM produtos WHERE id_estabelecimento = ? LIMIT 1',
      [idTenantB]
    );
    const pedidoB = await chamar('/api/pedidos', {
      metodo: 'POST',
      baseUrl: urlBaseTenantB,
      dados: dadosPedido({ itens: [{ id: Number(produtosB[0].id), quantidade: 1 }] })
    });
    assert.equal(pedidoB.status, 201, JSON.stringify(pedidoB.corpo));

    // O dispositivo da loja A não vê nada da loja B, nem no host dela.
    const filaNoHostDeA = await filaDoDispositivo(tokenDispositivoImpressao);
    const filaNoHostDeB = await filaDoDispositivo(tokenDispositivoImpressao, urlBaseTenantB);
    for (const fila of [filaNoHostDeA, filaNoHostDeB]) {
      assert.equal(fila.status, 200);
      // O tenant sai do token, nunca do host: nos dois casos a resposta é a de A.
      assert.equal(fila.corpo.trabalhos.some((trabalho) => (
        trabalho.impressora.nome === 'Cozinha da Loja B'
      )), false);
    }

    // O trabalho da loja B existe, mas só para quem é da loja B.
    const [trabalhosB] = await banco.execute(`
      SELECT id FROM trabalhos_impressao
      WHERE id_estabelecimento = ? AND status = 'pendente'
    `, [idTenantB]);
    assert.ok(trabalhosB.length > 0, 'A loja B precisa ter trabalho pendente para o teste valer.');

    // Confirmar ou falhar um trabalho da loja B com o token de A não funciona.
    for (const acao of ['confirmar', 'falhar']) {
      const cruzada = await chamar(`/api/impressao/trabalhos/${trabalhosB[0].id}/${acao}`, {
        metodo: 'POST',
        token: tokenDispositivoImpressao
      });
      assert.equal(cruzada.status, 404, acao);
    }
    const [[intacto]] = await banco.execute(
      'SELECT status, tentativas FROM trabalhos_impressao WHERE id = ?',
      [trabalhosB[0].id]
    );
    assert.equal(intacto.status, 'pendente');
    assert.equal(Number(intacto.tentativas), 0);

    // Impressora da loja B não pode ser usada como exceção por um produto de A.
    const dadosA = await chamar('/api/admin/dados', { token: tokenAdmin });
    const produtoA = dadosA.corpo.produtos[0];
    const roubo = await chamar(`/api/admin/produtos/${produtoA.id}`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { ...produtoA, impressoraId: Number(impressoraB.insertId) }
    });
    assert.equal(roubo.status, 400);
  });

  /*
    Recibo de fechamento: o papel do caixa, com a conta inteira da mesa.
    Ao contrário do ticket de cozinha, leva preço, total e o consumo todo.
  */
  async function comandaComConsumo(numeroMesa) {
    const painel = await chamar('/api/admin/dados', { token: tokenAdmin });
    const categoria = painel.corpo.categorias.find((c) => c.nome === 'Hambúrgueres');
    const produto = painel.corpo.produtos.find((p) => p.categoriaId === categoria.id);
    const outro = painel.corpo.produtos.find((p) => p.categoriaId === categoria.id && p.id !== produto.id);
    const mesa = await chamar('/api/admin/mesas', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { numero: numeroMesa }
    });
    assert.equal(mesa.status, 201, JSON.stringify(mesa.corpo));
    const comanda = await chamar('/api/admin/comandas', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { mesaId: mesa.corpo.mesa.id }
    });
    assert.equal(comanda.status, 201);
    return { comandaId: comanda.corpo.comanda.id, mesaId: mesa.corpo.mesa.id, numeroMesa, produto, outro };
  }

  async function trabalhosDeConta(comandaId) {
    const [linhas] = await banco.execute(
      "SELECT id FROM trabalhos_impressao WHERE origem = 'conta' AND comanda_id = ?",
      [comandaId]
    );
    return linhas;
  }

  test('sem impressora de caixa, fechar a comanda não gera recibo e não trava o fechamento', async () => {
    // Nenhuma marcada: é o estado de quem ainda não configurou o balcão.
    await banco.execute('UPDATE impressoras SET eh_caixa = 0 WHERE eh_caixa = 1');
    await confirmarFila();

    const { comandaId, produto } = await comandaComConsumo('81');
    await chamar(`/api/admin/comandas/${comandaId}/itens`, {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { produtoId: produto.id, quantidade: 1, adicionais: [] }
    });
    assert.equal((await chamar(`/api/admin/comandas/${comandaId}/lancar`, {
      metodo: 'POST',
      token: tokenAdmin
    })).status, 200);
    await confirmarFila();

    const finalizada = await chamar(`/api/admin/comandas/${comandaId}/finalizar`, {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { pagamento: 'Cartão' }
    });
    // O que importa: a falta de impressora não atrapalha o caixa.
    assert.equal(finalizada.status, 200, JSON.stringify(finalizada.corpo));
    assert.deepEqual(await trabalhosDeConta(comandaId), []);
    const fila = await filaDoDispositivo(tokenDispositivoImpressao);
    assert.equal(fila.corpo.trabalhos.some((t) => t.conteudo.origem === 'conta'), false);
  });

  test('com impressora de caixa, o fechamento gera o recibo com o consumo inteiro e o total certo', async () => {
    const caixa = await chamar(`/api/admin/impressoras/${idImpressoraCozinha}`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { nome: 'Cozinha', host: '192.168.0.50', porta: 9100, ehCaixa: true }
    });
    assert.equal(caixa.status, 200);
    assert.equal(caixa.corpo.impressora.ehCaixa, true);
    await confirmarFila();

    const { comandaId, numeroMesa, produto, outro } = await comandaComConsumo('82');
    const recado = 'Cliente com pressa';
    assert.equal((await chamar(`/api/admin/comandas/${comandaId}/observacao`, {
      metodo: 'PUT',
      token: tokenAdmin,
      dados: { observacao: recado }
    })).status, 200);

    // Item já lançado e impresso na cozinha antes do fechamento...
    await chamar(`/api/admin/comandas/${comandaId}/itens`, {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { produtoId: produto.id, quantidade: 2, adicionais: [] }
    });
    assert.equal((await chamar(`/api/admin/comandas/${comandaId}/lancar`, {
      metodo: 'POST',
      token: tokenAdmin
    })).status, 200);
    await confirmarFila();

    // ...e outro acrescentado depois. A conta cobra os dois, então o recibo
    // precisa mostrar os dois.
    await chamar(`/api/admin/comandas/${comandaId}/itens`, {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { produtoId: outro.id, quantidade: 1, adicionais: [] }
    });

    const finalizada = await chamar(`/api/admin/comandas/${comandaId}/finalizar`, {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { pagamento: 'Dinheiro', valorRecebido: '500,00' }
    });
    assert.equal(finalizada.status, 200, JSON.stringify(finalizada.corpo));

    const fila = await filaDoDispositivo(tokenDispositivoImpressao);
    const conta = fila.corpo.trabalhos.find((t) => t.conteudo.origem === 'conta');
    assert.ok(conta, 'Esperava um trabalho de fechamento na fila.');
    assert.equal(conta.impressora.nome, 'Cozinha');
    assert.equal(String(conta.comandaId ?? conta.conteudo.comandaId ?? comandaId), String(comandaId));

    const { cabecalho, itens, totalCentavos } = conta.conteudo;
    assert.equal(cabecalho.numeroMesa, numeroMesa);
    assert.equal(cabecalho.observacaoComanda, recado);

    // O item já impresso na cozinha continua na conta: o recibo é o histórico
    // inteiro, não o incremento que a cozinha recebeu.
    assert.equal(itens.length, 2);
    const impressoAntes = itens.find((i) => i.nome === produto.nome);
    const acrescentadoDepois = itens.find((i) => i.nome === outro.nome);
    assert.ok(impressoAntes && acrescentadoDepois);
    assert.equal(impressoAntes.quantidade, 2);
    assert.equal(acrescentadoDepois.quantidade, 1);
    for (const item of itens) {
      assert.match(item.hora, /^\d{2}:\d{2}$/);
      assert.ok(Number.isInteger(item.precoUnitarioCentavos) && item.precoUnitarioCentavos > 0);
      assert.equal(item.totalCentavos, item.precoUnitarioCentavos * item.quantidade);
    }

    /* A trava que mais importa: o total impresso é o mesmo que foi cobrado.
       Se algum dia alguém somar de outro jeito num dos dois lados, quebra. */
    const somaDosItens = itens.reduce((soma, item) => soma + item.totalCentavos, 0);
    assert.equal(totalCentavos, somaDosItens);
    assert.equal(totalCentavos, finalizada.corpo.pagamento.totalCentavos);

    const ticket = ticketDoTrabalho(conta);
    assert.ok(ticket.includes('FECHAMENTO DE CONTA'), ticket);
    assert.ok(ticket.includes(`Mesa ${numeroMesa}`), ticket);
    assert.ok(ticket.includes(`OBS DA MESA: ${recado}`), ticket);
    // Linha de item: hora, quantidade, nome e valor colado na margem direita.
    const linhaDoItem = ticket.split('\n').find((l) => l.includes(produto.nome) && l.includes('R$'));
    assert.ok(linhaDoItem, ticket);
    assert.match(linhaDoItem, /^\d{2}:\d{2} 2x .*\.+R\$ /);
    assert.equal(linhaDoItem.length, 42, linhaDoItem);
    // Total em corpo dobrado e negrito, como o título.
    const reais = (centavos) => (centavos / 100).toFixed(2).replace('.', ',');
    assert.ok(ticket.includes(`TOTAL: R$ ${reais(totalCentavos)}`), ticket);
    assert.ok(ticket.includes(`${NEGRITO_LIGADO}TOTAL: R$`), ticket);

    await confirmarFila();
  });

  test('recibo de fechamento de uma loja não aparece para o dispositivo da outra', async () => {
    const [[tenantB]] = await banco.execute(
      'SELECT id_estabelecimento FROM estabelecimentos WHERE slug = ?',
      ['loja-b']
    );
    const idTenantB = Number(tenantB.id_estabelecimento);
    const [impressoraB] = await banco.execute(`
      INSERT INTO impressoras (id_estabelecimento, nome, host, porta, ativa, eh_caixa)
      VALUES (?, 'Caixa da Loja B', '10.0.0.55', 9100, 1, 1)
    `, [idTenantB]);
    const [mesaB] = await banco.execute(
      'INSERT INTO mesas (id_estabelecimento, numero, ativo) VALUES (?, 902, 1)',
      [idTenantB]
    );
    const [comandaB] = await banco.execute(`
      INSERT INTO comandas (id_estabelecimento, mesa_id, status)
      VALUES (?, ?, 'Encerrada')
    `, [idTenantB, mesaB.insertId]);
    const [trabalhoB] = await banco.execute(`
      INSERT INTO trabalhos_impressao
        (id_estabelecimento, impressora_id, origem, comanda_id, conteudo_json, status)
      VALUES (?, ?, 'conta', ?, ?, 'pendente')
    `, [
      idTenantB,
      impressoraB.insertId,
      comandaB.insertId,
      JSON.stringify({
        origem: 'conta',
        cabecalho: { numeroMesa: '902' },
        itens: [{ nome: 'Segredo da Loja B', quantidade: 1, totalCentavos: 1234, hora: '20:00' }],
        totalCentavos: 1234
      })
    ]);

    try {
      // O tenant sai do token do dispositivo, nunca do host: nos dois
      // endereços a resposta é a da loja A.
      for (const baseUrl of [urlBase, urlBaseTenantB]) {
        const fila = await filaDoDispositivo(tokenDispositivoImpressao, baseUrl);
        assert.equal(fila.status, 200);
        assert.equal(fila.corpo.trabalhos.some((t) => t.id === Number(trabalhoB.insertId)), false);
        assert.equal(
          JSON.stringify(fila.corpo.trabalhos).includes('Segredo da Loja B'),
          false,
          `conteúdo da loja B vazou em ${baseUrl}`
        );
      }

      // E não consegue confirmar nem falhar o trabalho alheio.
      for (const acao of ['confirmar', 'falhar']) {
        const cruzada = await chamar(`/api/impressao/trabalhos/${trabalhoB.insertId}/${acao}`, {
          metodo: 'POST',
          token: tokenDispositivoImpressao
        });
        assert.equal(cruzada.status, 404, acao);
      }
      const [[intacto]] = await banco.execute(
        'SELECT status, tentativas FROM trabalhos_impressao WHERE id = ?',
        [trabalhoB.insertId]
      );
      assert.equal(intacto.status, 'pendente');
      assert.equal(Number(intacto.tentativas), 0);
    } finally {
      await banco.execute('DELETE FROM trabalhos_impressao WHERE id = ?', [trabalhoB.insertId]);
      await banco.execute('DELETE FROM comandas WHERE id = ?', [comandaB.insertId]);
      await banco.execute('DELETE FROM mesas WHERE id = ?', [mesaB.insertId]);
      await banco.execute('DELETE FROM impressoras WHERE id = ?', [impressoraB.insertId]);
    }
  });

  test('dispositivo revogado não busca mais trabalhos', async () => {
    const dispositivo = await chamar('/api/admin/impressao/dispositivos', {
      metodo: 'POST',
      token: tokenAdmin,
      dados: { nome: 'Tablet do balcão' }
    });
    assert.equal(dispositivo.status, 201);
    const tokenTemporario = dispositivo.corpo.token;
    assert.equal((await filaDoDispositivo(tokenTemporario)).status, 200);

    const revogado = await chamar(`/api/admin/impressao/dispositivos/${dispositivo.corpo.dispositivo.id}`, {
      metodo: 'DELETE',
      token: tokenAdmin
    });
    assert.equal(revogado.status, 200);

    // O token perde o acesso na hora, sem precisar mexer no computador da loja.
    assert.equal((await filaDoDispositivo(tokenTemporario)).status, 401);
    const confirmarRevogado = await chamar('/api/impressao/trabalhos/1/confirmar', {
      metodo: 'POST',
      token: tokenTemporario
    });
    assert.equal(confirmarRevogado.status, 401);

    // Token inexistente, vazio ou mal formado também não resolvem loja nenhuma.
    for (const invalido of ['', 'nao-e-um-token', 'x'.repeat(200)]) {
      assert.equal((await filaDoDispositivo(invalido)).status, 401, invalido.slice(0, 20));
    }
    // O dispositivo que continua válido segue funcionando.
    assert.equal((await filaDoDispositivo(tokenDispositivoImpressao)).status, 200);
  });
}
