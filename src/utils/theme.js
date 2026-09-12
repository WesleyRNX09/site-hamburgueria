import { configuracaoInicial } from '../data/initialData.js';
import { estaAbertoNoHorario, normalizarHorarios } from './horarios.js';

const FONTES = new Map([
  ['poppins', { nome: 'Poppins', css: '"Poppins", Arial, sans-serif' }],
  ['arial', { nome: 'Arial', css: 'Arial, sans-serif' }],
  ['verdana', { nome: 'Verdana', css: 'Verdana, sans-serif' }],
  ['tahoma', { nome: 'Tahoma', css: 'Tahoma, sans-serif' }],
  ['trebuchet ms', { nome: 'Trebuchet MS', css: '"Trebuchet MS", sans-serif' }],
  ['georgia', { nome: 'Georgia', css: 'Georgia, serif' }]
]);

function texto(valor, limite = 2000) {
  return typeof valor === 'string' ? valor.trim().slice(0, limite) : '';
}

function cor(valor, padrao) {
  const candidata = texto(valor, 7);
  return /^#[0-9A-Fa-f]{6}$/.test(candidata) ? candidata.toUpperCase() : padrao;
}

function urlPublica(valor) {
  const candidata = texto(valor, 500);
  if (!candidata || /[\s"'()\\]/.test(candidata)) return '';
  if (/^\/(?!\/)/.test(candidata)) return candidata;
  try {
    const url = new URL(candidata);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function numeroNaoNegativo(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? numero : 0;
}

function normalizarFonte(valor) {
  return FONTES.get(texto(valor, 80).toLowerCase()) ?? FONTES.get('poppins');
}

const BANNER_DESTINOS_PERMITIDOS = new Set(['cardapio', 'promocoes', 'sobre']);

function normalizarDestinoBanner(valor) {
  const destino = texto(valor, 20).toLowerCase();
  return BANNER_DESTINOS_PERMITIDOS.has(destino) ? destino : '';
}

function corDeContraste(corHexadecimal) {
  const vermelho = Number.parseInt(corHexadecimal.slice(1, 3), 16);
  const verde = Number.parseInt(corHexadecimal.slice(3, 5), 16);
  const azul = Number.parseInt(corHexadecimal.slice(5, 7), 16);
  return ((vermelho * 299) + (verde * 587) + (azul * 114)) / 1000 >= 145
    ? '#0A0A0A'
    : '#FFFFFF';
}

const PALETA_CLARA = {
  corSecundaria: '#FFFFFF',
  corFundo: '#FFFFFF',
  corCard: '#F5F4F1',
  corTexto: '#1A1A19'
};

/* O tema claro vale só para o cardápio e o checkout. Painel, garçom e
   superadmin têm fundos escuros fixos no CSS e ficariam ilegíveis.
   A mesma regra está no index.html, que marca a área no primeiro quadro. */
export function ehAreaPublica(caminho = '') {
  return !/^\/(admin|superadmin|garcom)(\/|$)/.test(caminho);
}

export function normalizarConfiguracaoPublica(recebida = {}) {
  const fonte = normalizarFonte(recebida.fonte);
  const corPrincipal = cor(recebida.corPrincipal, configuracaoInicial.corPrincipal);
  const horarios = normalizarHorarios(recebida.horarios);
  const funcionamentoAutomatico = recebida.funcionamentoAutomatico === true;
  return {
    nomeLoja: texto(recebida.nomeLoja, 160),
    slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(texto(recebida.slug, 100)) ? texto(recebida.slug, 100) : '',
    logo: urlPublica(recebida.logo),
    banner: urlPublica(recebida.banner),
    bannerTitulo: texto(recebida.bannerTitulo, 160),
    bannerSubtitulo: texto(recebida.bannerSubtitulo, 280),
    bannerBotaoTexto: texto(recebida.bannerBotaoTexto, 60),
    bannerBotaoDestino: normalizarDestinoBanner(recebida.bannerBotaoDestino),
    tituloCardapio: texto(recebida.tituloCardapio, 160),
    textoApresentacao: texto(recebida.textoApresentacao, 280),
    tituloSobre: texto(recebida.tituloSobre, 160),
    textoSobre: texto(recebida.textoSobre, 600),
    mensagemRodape: texto(recebida.mensagemRodape, 280),
    corPrincipal,
    corSecundaria: cor(recebida.corSecundaria, configuracaoInicial.corSecundaria),
    corFundo: cor(recebida.corFundo, configuracaoInicial.corFundo),
    corCard: cor(recebida.corCard, configuracaoInicial.corCard),
    corTexto: cor(recebida.corTexto, configuracaoInicial.corTexto),
    fonte: fonte.nome,
    telefone: texto(recebida.telefone, 40),
    whatsapp: texto(recebida.whatsapp, 40),
    email: texto(recebida.email, 160),
    endereco: texto(recebida.endereco, 255),
    horarioFuncionamento: texto(recebida.horarioFuncionamento),
    instagramUrl: urlPublica(recebida.instagramUrl),
    facebookUrl: urlPublica(recebida.facebookUrl),
    taxaEntrega: numeroNaoNegativo(recebida.taxaEntrega),
    tempoEntrega: texto(recebida.tempoEntrega, 60),
    pedidoMinimo: numeroNaoNegativo(recebida.pedidoMinimo),
    horarios,
    funcionamentoAutomatico,
    lojaAbertaManual: recebida.lojaAbertaManual === true,
    /* Com o horário automático ligado, o próprio navegador recalcula: quem
      deixou o cardápio aberto às 18h50 vê a loja abrir às 19h. */
    lojaAberta: funcionamentoAutomatico
      ? estaAbertoNoHorario(horarios)
      : recebida.lojaAberta === true,
    pixChave: texto(recebida.pixChave, 180),
    pixBeneficiario: texto(recebida.pixBeneficiario, 160),
    pixCidade: texto(recebida.pixCidade, 60),
    entregaAtiva: recebida.entregaAtiva === true,
    retiradaAtiva: recebida.retiradaAtiva === true,
    atendimentoGarcomAtivo: recebida.atendimentoGarcomAtivo === true,
    aceitaCartao: recebida.aceitaCartao === true,
    aceitaDinheiro: recebida.aceitaDinheiro === true,
    formasPagamento: Array.isArray(recebida.formasPagamento)
      ? recebida.formasPagamento.filter((item) => typeof item === 'string').slice(0, 20)
      : [],
    areasEntrega: Array.isArray(recebida.areasEntrega)
      ? recebida.areasEntrega.filter((area) => area && typeof area.bairro === 'string').slice(0, 200)
      : [],
    politicaCancelamento: texto(recebida.politicaCancelamento),
    informacoesLegais: texto(recebida.informacoesLegais),
    corSobrePrincipal: corDeContraste(corPrincipal)
  };
}

/* No tema claro as cores do estabelecimento continuam mandando na marca, mas
   os neutros (fundo, card, texto) passam a ser os claros: as cores escolhidas
   no painel são escuras e não teriam como ser lidas sobre branco. */
export function criarVariaveisTema(configuracao, temaClaro = false) {
  const segura = normalizarConfiguracaoPublica(configuracao);
  const neutros = temaClaro ? PALETA_CLARA : segura;
  return {
    '--cor-principal': segura.corPrincipal,
    '--cor-secundaria': neutros.corSecundaria,
    '--cor-fundo': neutros.corFundo,
    '--cor-card': neutros.corCard,
    '--cor-texto': neutros.corTexto,
    '--cor-sobre-principal': segura.corSobrePrincipal,
    /* Nos dois temas o texto usa a própria cor da marca, sem escurecer: o
       amarelo escurecido vira marrom e deixa de parecer a cor da loja. */
    '--cor-principal-texto': segura.corPrincipal,
    '--fonte-principal': normalizarFonte(segura.fonte).css
  };
}

export function aplicarTema(elemento, configuracao, temaClaro = false) {
  if (!elemento?.style?.setProperty) return;
  Object.entries(criarVariaveisTema(configuracao, temaClaro)).forEach(([propriedade, valor]) => {
    elemento.style.setProperty(propriedade, valor);
  });
}
