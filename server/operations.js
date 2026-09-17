import { randomBytes, randomUUID } from 'node:crypto';

import { filtroCanal, formatarPreco, listarCatalogo, precoParaCentavos } from './catalog.js';
import { executarTransacao } from './database.js';
import { prepararPagamentoComanda } from './payments.js';
/* Regra de horário compartilhada com o site público: o servidor decide o
  pedido, o navegador decide o que mostrar, e os dois usam o mesmo cálculo. */
import {
  algumDiaAberto,
  erroNosHorarios,
  estaAbertoNoHorario,
  FUSO_HORARIO_LOJA,
  normalizarHorarios,
  resumoHorarios
} from '../src/utils/horarios.js';
import { normalizarPermissoes } from '../src/utils/permissoes.js';
import { concederPermissoesPadrao } from './permissoes.js';
import {
  criarHashSenha,
  criarHashToken,
  criarIndiceSenhaGarcom,
  verificarSenha
} from './security.js';

const PAGAMENTOS = new Set(['Pix', 'Cartão na entrega', 'Cartão na retirada', 'Cartão', 'Dinheiro', 'A definir']);
const PAGAMENTOS_DELIVERY = new Set(['Pix', 'Cartão na entrega', 'Dinheiro']);
const PAGAMENTOS_RETIRADA = new Set(['Pix', 'Cartão na retirada', 'Dinheiro']);
const STATUS_DELIVERY = new Set(['Recebido', 'Em preparo', 'Saiu para entrega', 'Entregue', 'Cancelado']);
const STATUS_RETIRADA = new Set(['Recebido', 'Em preparo', 'Pronto', 'Retirado', 'Cancelado']);
const STATUS_MESA = new Set(['Recebido', 'Em preparo', 'Pronto', 'Entregue na mesa', 'Cancelado']);
const PAGAMENTO_AGUARDANDO = 'Aguardando pagamento';
const PAGAMENTO_ENTREGA = 'Pagamento na entrega';
const PAGAMENTO_PAGO = 'Pago';
const PAGAMENTO_CANCELADO = 'Cancelado';
const PAGAMENTO_ESTORNADO = 'Estornado';
/* Recorte do cardápio online, compartilhado por quem valida carrinho e
   promoção: produto e categoria precisam aparecer no site. */
const VISIBILIDADE_ONLINE = filtroCanal('online', { aliasProduto: 'p', aliasCategoria: 'c' });

const MAX_LINHAS_PEDIDO = 100;
const MAX_UNIDADES_PEDIDO = 500;
const MAX_ADICIONAIS_POR_ITEM = 50;
const MAX_OBSERVACAO_COMANDA = 500;
const MAX_TOTAL_CENTAVOS = 4_294_967_295;
const STATUS_TERMINAIS = new Set(['Entregue', 'Entregue na mesa', 'Retirado', 'Cancelado']);
// Uma comanda sai do salão tanto quando é paga ("Encerrada") quanto quando o
// administrador a cancela ("Cancelada"): nos dois casos a mesa fica livre e a
// comanda não aceita mais alteração.
const COMANDAS_FECHADAS = new Set(['Encerrada', 'Cancelada']);
const CORES_PADRAO = Object.freeze({
  corPrincipal: '#FFC107',
  corSecundaria: '#0A0A0A',
  corFundo: '#111111',
  corCard: '#181818',
  corTexto: '#FFFFFF'
});
const FONTES_PERMITIDAS = new Map([
  ['poppins', 'Poppins'],
  ['arial', 'Arial'],
  ['verdana', 'Verdana'],
  ['tahoma', 'Tahoma'],
  ['trebuchet ms', 'Trebuchet MS'],
  ['georgia', 'Georgia']
]);
const BANNER_DESTINOS_PERMITIDOS = new Set(['cardapio', 'promocoes', 'sobre']);
const PAGAMENTOS_PUBLICOS = new Map([
  ['pix', 'Pix'],
  ['cartão', 'Cartão'],
  ['cartao', 'Cartão'],
  ['cartão na entrega', 'Cartão na entrega'],
  ['cartao na entrega', 'Cartão na entrega'],
  ['cartão na retirada', 'Cartão na retirada'],
  ['cartao na retirada', 'Cartão na retirada'],
  ['dinheiro', 'Dinheiro']
]);

function erroDominio(mensagem, status = 400) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

function texto(valor, limite = 255) {
  return String(valor ?? '').trim().slice(0, limite);
}

function dataIso(valor) {
  if (!valor) return null;
  return new Date(valor).toISOString();
}

function dataOpcional(valor, campo) {
  if (!valor) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) throw erroDominio(`Informe uma data válida para ${campo}.`);
  return data;
}

function promocaoDisponivel(linha, agora = new Date()) {
  if (!linha || !linha.ativo) return false;
  const inicio = linha.inicio_em ? new Date(linha.inicio_em) : null;
  const fim = linha.fim_em ? new Date(linha.fim_em) : null;
  return (!inicio || inicio <= agora) && (!fim || fim >= agora);
}

function normalizarStatusPagamento(status, forma) {
  if (status === 'Pendente') return forma === 'Pix' ? PAGAMENTO_AGUARDANDO : PAGAMENTO_ENTREGA;
  return status || (forma === 'Pix' ? PAGAMENTO_AGUARDANDO : PAGAMENTO_ENTREGA);
}

function horaPtBr(valor) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo'
  }).format(new Date(valor));
}

function codigoPedido(id) {
  return `#PED${String(id).padStart(4, '0')}`;
}

function idPedidoPeloCodigo(codigo) {
  const correspondencia = String(codigo ?? '').match(/PED(\d+)/i);
  return correspondencia ? Number(correspondencia[1]) : null;
}

function normalizarToken(nome) {
  const base = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'funcionario';
  return `${base}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function lerListaTextos(valor, limiteItens = 20, limiteTexto = 80) {
  if (!valor) return [];
  try {
    const lista = typeof valor === 'string' ? JSON.parse(valor) : valor;
    if (!Array.isArray(lista)) return [];
    return [...new Set(lista
      .slice(0, limiteItens)
      .filter((item) => typeof item === 'string')
      .map((item) => texto(item, limiteTexto))
      .filter(Boolean))];
  } catch {
    return [];
  }
}

function normalizarCor(valor, padrao) {
  const cor = texto(valor, 7);
  return /^#[0-9A-Fa-f]{6}$/.test(cor) ? cor.toUpperCase() : padrao;
}

function normalizarFonte(valor) {
  return FONTES_PERMITIDAS.get(texto(valor, 80).toLowerCase()) ?? 'Poppins';
}

function normalizarUrlPublica(valor) {
  const url = texto(valor, 500);
  if (!url) return '';
  if (/^\/(?!\/)[^\s\\]*$/.test(url)) return url;
  try {
    const analisada = new URL(url);
    return ['http:', 'https:'].includes(analisada.protocol) ? url : '';
  } catch {
    return '';
  }
}

function centavosParaNumero(valor) {
  const centavos = Number(valor);
  return Number.isInteger(centavos) && centavos >= 0 && centavos <= MAX_TOTAL_CENTAVOS
    ? centavos / 100
    : 0;
}

function validarUrlOpcional(valor, campo) {
  const url = texto(valor, 500);
  if (!url) return '';
  try {
    const analisada = new URL(url);
    if (!['http:', 'https:'].includes(analisada.protocol)) throw new Error();
  } catch {
    throw erroDominio(`Informe uma URL válida para ${campo}.`);
  }
  return url;
}

function campoPix(id, valor) {
  const conteudo = String(valor ?? '');
  return `${id}${String(conteudo.length).padStart(2, '0')}${conteudo}`;
}

function textoPix(valor, limite) {
  return texto(valor, limite)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 $%*+\-./:]/g, '')
    .toUpperCase()
    .slice(0, limite);
}

function crc16Pix(valor) {
  let crc = 0xffff;
  for (const caractere of Buffer.from(valor, 'utf8')) {
    crc ^= caractere << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function gerarPixCopiaCola({ chave, beneficiario, cidade, valorCentavos, txid }) {
  if (!chave || !beneficiario || !cidade) return null;
  const conta = campoPix('00', 'BR.GOV.BCB.PIX') + campoPix('01', chave);
  const valor = (Number(valorCentavos) / 100).toFixed(2);
  const dadosAdicionais = campoPix('05', textoPix(txid, 25) || '***');
  const semCrc = [
    campoPix('00', '01'),
    campoPix('01', '11'),
    campoPix('26', conta),
    campoPix('52', '0000'),
    campoPix('53', '986'),
    campoPix('54', valor),
    campoPix('58', 'BR'),
    campoPix('59', textoPix(beneficiario, 25)),
    campoPix('60', textoPix(cidade, 15)),
    campoPix('62', dadosAdicionais),
    '6304'
  ].join('');
  return `${semCrc}${crc16Pix(semCrc)}`;
}

async function registrarAuditoria(
  conexao,
  idEstabelecimento,
  administradorId,
  acao,
  entidade,
  entidadeId,
  detalhes = null
) {
  await conexao.execute(`
    INSERT INTO auditoria_admin
      (id_estabelecimento, administrador_id, acao, entidade, entidade_id, detalhes_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [idEstabelecimento, administradorId ?? null, acao, entidade, entidadeId == null ? null : String(entidadeId), detalhes ? JSON.stringify(detalhes) : null]);
}

function mapearConfiguracao(linha) {
  const formasPagamentoCadastradas = [...new Set(lerListaTextos(linha.formas_pagamento_json)
    .map((forma) => PAGAMENTOS_PUBLICOS.get(forma.toLowerCase()))
    .filter(Boolean))];
  const formasPagamento = formasPagamentoCadastradas.length
    ? formasPagamentoCadastradas
    : [
        linha.pix_chave ? 'Pix' : null,
        linha.aceita_cartao ? 'Cartão' : null,
        linha.aceita_dinheiro ? 'Dinheiro' : null
      ].filter(Boolean);
  const horarios = normalizarHorarios(linha.horarios_json);
  const funcionamentoAutomatico = Boolean(linha.funcionamento_automatico);
  return {
    nomeLoja: linha.nome_loja ?? '',
    slug: linha.slug ?? '',
    telefone: linha.telefone ?? '',
    email: linha.email ?? '',
    endereco: linha.endereco ?? '',
    taxaEntrega: centavosParaNumero(linha.taxa_entrega_centavos),
    tempoEntrega: linha.tempo_entrega ?? '',
    horarios,
    funcionamentoAutomatico,
    lojaAbertaManual: Boolean(linha.loja_aberta),
    lojaAberta: funcionamentoAutomatico
      ? estaAbertoNoHorario(horarios)
      : Boolean(linha.loja_aberta),
    pixChave: linha.pix_chave ?? '',
    pixBeneficiario: linha.pix_beneficiario ?? '',
    pixCidade: linha.pix_cidade ?? '',
    logo: normalizarUrlPublica(linha.logo_url),
    banner: normalizarUrlPublica(linha.banner_url),
    bannerTitulo: texto(linha.banner_titulo ?? '', 160),
    bannerSubtitulo: texto(linha.banner_subtitulo ?? '', 280),
    bannerBotaoTexto: texto(linha.banner_botao_texto ?? '', 60),
    bannerBotaoDestino: BANNER_DESTINOS_PERMITIDOS.has(linha.banner_botao_destino) ? linha.banner_botao_destino : '',
    tituloCardapio: texto(linha.titulo_cardapio ?? '', 160),
    textoApresentacao: texto(linha.texto_apresentacao ?? '', 280),
    tituloSobre: texto(linha.titulo_sobre ?? '', 160),
    textoSobre: texto(linha.texto_sobre ?? '', 600),
    mensagemRodape: texto(linha.mensagem_rodape ?? '', 280),
    corPrincipal: normalizarCor(linha.cor_principal, CORES_PADRAO.corPrincipal),
    corSecundaria: normalizarCor(linha.cor_secundaria, CORES_PADRAO.corSecundaria),
    corFundo: normalizarCor(linha.cor_fundo, CORES_PADRAO.corFundo),
    corCard: normalizarCor(linha.cor_card, CORES_PADRAO.corCard),
    corTexto: normalizarCor(linha.cor_texto, CORES_PADRAO.corTexto),
    fonte: normalizarFonte(linha.fonte),
    whatsapp: linha.whatsapp ?? '',
    horarioFuncionamento: linha.horario_funcionamento ?? '',
    instagramUrl: normalizarUrlPublica(linha.instagram_url),
    facebookUrl: normalizarUrlPublica(linha.facebook_url),
    entregaAtiva: Boolean(linha.entrega_ativa),
    retiradaAtiva: Boolean(linha.retirada_ativa),
    atendimentoGarcomAtivo: Boolean(linha.atendimento_garcom_ativo),
    aceitaCartao: Boolean(linha.aceita_cartao),
    aceitaDinheiro: Boolean(linha.aceita_dinheiro),
    formasPagamento,
    politicaCancelamento: linha.politica_cancelamento ?? '',
    informacoesLegais: linha.informacoes_legais ?? ''
  };
}

export async function buscarConfiguracao(banco, idEstabelecimento) {
  const [linhas] = await banco.execute(`
    SELECT
      e.nome_fantasia AS nome_loja,
      e.slug,
      ce.logo_url,
      ce.banner_url,
      ce.banner_titulo,
      ce.banner_subtitulo,
      ce.banner_botao_texto,
      ce.banner_botao_destino,
      ce.titulo_cardapio,
      ce.texto_apresentacao,
      ce.titulo_sobre,
      ce.texto_sobre,
      ce.mensagem_rodape,
      ce.cor_principal,
      ce.cor_secundaria,
      ce.cor_fundo,
      ce.cor_card,
      ce.cor_texto,
      ce.fonte,
      ce.telefone,
      ce.email,
      ce.endereco,
      ce.taxa_entrega_centavos,
      ce.tempo_entrega,
      ce.loja_aberta,
      ce.pix_chave,
      ce.pix_beneficiario,
      ce.pix_cidade,
      ce.whatsapp,
      ce.horario_funcionamento,
      ce.horarios_json,
      ce.funcionamento_automatico,
      ce.instagram_url,
      ce.facebook_url,
      ce.entrega_ativa,
      ce.retirada_ativa,
      ce.atendimento_garcom_ativo,
      ce.aceita_cartao,
      ce.aceita_dinheiro,
      ce.formas_pagamento_json,
      ce.politica_cancelamento,
      ce.informacoes_legais
    FROM estabelecimentos e
    INNER JOIN configuracoes_estabelecimento ce
      ON ce.id_estabelecimento = e.id_estabelecimento
    WHERE e.id_estabelecimento = ?
    LIMIT 1
  `, [idEstabelecimento]);
  if (!linhas[0]) throw erroDominio('As configurações da loja ainda não foram cadastradas.', 500);
  return mapearConfiguracao(linhas[0]);
}

export function selecionarConfiguracaoPublica(configuracao) {
  return {
    nomeLoja: configuracao.nomeLoja,
    slug: configuracao.slug,
    logo: configuracao.logo,
    banner: configuracao.banner,
    bannerTitulo: configuracao.bannerTitulo,
    bannerSubtitulo: configuracao.bannerSubtitulo,
    bannerBotaoTexto: configuracao.bannerBotaoTexto,
    bannerBotaoDestino: configuracao.bannerBotaoDestino,
    tituloCardapio: configuracao.tituloCardapio,
    textoApresentacao: configuracao.textoApresentacao,
    tituloSobre: configuracao.tituloSobre,
    textoSobre: configuracao.textoSobre,
    mensagemRodape: configuracao.mensagemRodape,
    corPrincipal: configuracao.corPrincipal,
    corSecundaria: configuracao.corSecundaria,
    corFundo: configuracao.corFundo,
    corCard: configuracao.corCard,
    corTexto: configuracao.corTexto,
    fonte: configuracao.fonte,
    telefone: configuracao.telefone,
    whatsapp: configuracao.whatsapp,
    email: configuracao.email,
    endereco: configuracao.endereco,
    horarioFuncionamento: configuracao.horarioFuncionamento,
    horarios: configuracao.horarios,
    funcionamentoAutomatico: configuracao.funcionamentoAutomatico,
    instagramUrl: configuracao.instagramUrl,
    facebookUrl: configuracao.facebookUrl,
    lojaAberta: configuracao.lojaAberta,
    taxaEntrega: configuracao.taxaEntrega,
    tempoEntrega: configuracao.tempoEntrega,
    entregaAtiva: configuracao.entregaAtiva,
    retiradaAtiva: configuracao.retiradaAtiva,
    atendimentoGarcomAtivo: configuracao.atendimentoGarcomAtivo,
    aceitaCartao: configuracao.aceitaCartao,
    aceitaDinheiro: configuracao.aceitaDinheiro,
    formasPagamento: configuracao.formasPagamento,
    pixChave: configuracao.pixChave,
    pixBeneficiario: configuracao.pixBeneficiario,
    pixCidade: configuracao.pixCidade,
    politicaCancelamento: configuracao.politicaCancelamento,
    informacoesLegais: configuracao.informacoesLegais
  };
}

export async function buscarConfiguracaoPublica(banco, idEstabelecimento) {
  const [configuracao, areas] = await Promise.all([
    buscarConfiguracao(banco, idEstabelecimento),
    listarAreasEntregaPublicas(banco, idEstabelecimento)
  ]);
  return { ...selecionarConfiguracaoPublica(configuracao), ...areas };
}

/*
  Áreas de entrega (bairro ou região), cada uma com taxa e tempo estimado.

  Loja sem nenhuma área cadastrada continua com a taxa única da configuração.
  Com áreas cadastradas, o delivery só atende as ativas, e o servidor é quem
  decide a taxa do pedido pela área escolhida.
*/
const MAX_AREAS_ENTREGA = 200;
const MAX_TAXA_AREA_CENTAVOS = 1_000_000;
const MAX_TEMPO_ESTIMADO_MINUTOS = 600;

function mapearAreaEntrega(linha) {
  return {
    id: Number(linha.id),
    nome: linha.nome,
    taxaEntrega: centavosParaNumero(linha.taxa_entrega_centavos),
    tempoEstimadoMin: Number(linha.tempo_estimado_min),
    tempoEstimadoMax: Number(linha.tempo_estimado_max),
    ativo: Boolean(linha.ativo),
    criadoEm: dataIso(linha.criado_em),
    atualizadoEm: dataIso(linha.atualizado_em)
  };
}

async function consultarAreasEntrega(banco, idEstabelecimento, { id = null } = {}) {
  const parametros = [idEstabelecimento];
  let filtro = '';
  if (id !== null) {
    filtro = 'AND id = ?';
    parametros.push(id);
  }
  const [linhas] = await banco.execute(`
    SELECT id, nome, taxa_entrega_centavos, tempo_estimado_min, tempo_estimado_max,
      ativo, criado_em, atualizado_em
    FROM areas_entrega
    WHERE id_estabelecimento = ?
    ${filtro}
    ORDER BY nome, id
    LIMIT ${MAX_AREAS_ENTREGA}
  `, parametros);
  return linhas.map(mapearAreaEntrega);
}

export function listarAreasEntrega(banco, idEstabelecimento) {
  return consultarAreasEntrega(banco, idEstabelecimento);
}

/* `entregaPorArea` diz se a loja cadastrou áreas, mesmo com todas desativadas:
   nesse caso o checkout não volta para a taxa única, o delivery fica bloqueado. */
export async function listarAreasEntregaPublicas(banco, idEstabelecimento) {
  const areas = await consultarAreasEntrega(banco, idEstabelecimento);
  return {
    entregaPorArea: areas.length > 0,
    areasEntrega: areas
      .filter((area) => area.ativo)
      .map((area) => ({
        id: area.id,
        nome: area.nome,
        // `bairro` e `taxa` mantêm o formato que o checkout já lia.
        bairro: area.nome,
        taxa: area.taxaEntrega,
        tempoEstimadoMin: area.tempoEstimadoMin,
        tempoEstimadoMax: area.tempoEstimadoMax
      }))
  };
}

function minutosInteiros(valor) {
  if (typeof valor === 'number') return Number.isInteger(valor) ? valor : Number.NaN;
  if (typeof valor === 'string' && /^\s*\d{1,4}\s*$/.test(valor)) return Number(valor);
  return Number.NaN;
}

function validarAtivoAreaEntrega(ativo) {
  if (typeof ativo !== 'boolean') throw erroDominio('Informe se a área de entrega está ativa.');
  return ativo;
}

/* Só estes campos são lidos do corpo; qualquer outro (inclusive
   id_estabelecimento) é ignorado. */
function validarAreaEntrega(dados) {
  const recebidos = dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
  const nome = typeof recebidos.nome === 'string' ? recebidos.nome.trim() : '';
  if (!nome) throw erroDominio('Informe o nome da área de entrega.');
  if (nome.length > 120) throw erroDominio('O nome da área de entrega pode ter no máximo 120 caracteres.');
  const taxaCentavos = ['number', 'string'].includes(typeof recebidos.taxaEntrega)
    ? precoParaCentavos(recebidos.taxaEntrega)
    : Number.NaN;
  if (!Number.isInteger(taxaCentavos) || taxaCentavos < 0 || taxaCentavos > MAX_TAXA_AREA_CENTAVOS) {
    throw erroDominio('Informe uma taxa de entrega entre R$ 0,00 e R$ 10.000,00.');
  }
  const tempoMin = minutosInteiros(recebidos.tempoEstimadoMin);
  const tempoMax = minutosInteiros(recebidos.tempoEstimadoMax);
  if (![tempoMin, tempoMax].every((tempo) => tempo >= 1 && tempo <= MAX_TEMPO_ESTIMADO_MINUTOS)) {
    throw erroDominio(`Informe o tempo estimado em minutos inteiros, de 1 a ${MAX_TEMPO_ESTIMADO_MINUTOS}.`);
  }
  if (tempoMax < tempoMin) throw erroDominio('O tempo estimado máximo não pode ser menor que o mínimo.');
  const ativo = recebidos.ativo === undefined ? null : validarAtivoAreaEntrega(recebidos.ativo);
  return { nome, taxaCentavos, tempoMin, tempoMax, ativo };
}

function recusarNomeRepetido(erro) {
  if (erro?.code === 'ER_DUP_ENTRY') {
    throw erroDominio('Já existe uma área de entrega com esse nome.', 409);
  }
  throw erro;
}

async function travarAreaEntrega(conexao, idEstabelecimento, id) {
  const [linhas] = await conexao.execute(`
    SELECT id, nome, taxa_entrega_centavos, tempo_estimado_min, tempo_estimado_max, ativo
    FROM areas_entrega
    WHERE id_estabelecimento = ? AND id = ?
    FOR UPDATE
  `, [idEstabelecimento, id]);
  return linhas[0] ?? null;
}

export async function criarAreaEntrega(banco, idEstabelecimento, dados, administradorId = null) {
  const area = validarAreaEntrega(dados);
  let id;
  try {
    id = await executarTransacao(banco, async (conexao) => {
      const [[cadastradas]] = await conexao.execute(
        'SELECT COUNT(id) AS total FROM areas_entrega WHERE id_estabelecimento = ?',
        [idEstabelecimento]
      );
      if (Number(cadastradas.total) >= MAX_AREAS_ENTREGA) {
        throw erroDominio(`O limite é de ${MAX_AREAS_ENTREGA} áreas de entrega por loja.`, 409);
      }
      const [resultado] = await conexao.execute(`
        INSERT INTO areas_entrega
          (id_estabelecimento, nome, taxa_entrega_centavos, tempo_estimado_min, tempo_estimado_max, ativo)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [idEstabelecimento, area.nome, area.taxaCentavos, area.tempoMin, area.tempoMax, area.ativo === false ? 0 : 1]);
      await registrarAuditoria(conexao, idEstabelecimento, administradorId, 'area_entrega.criada', 'area_entrega', resultado.insertId, {
        nome: area.nome,
        taxaCentavos: area.taxaCentavos,
        tempoMin: area.tempoMin,
        tempoMax: area.tempoMax
      });
      return Number(resultado.insertId);
    });
  } catch (erro) {
    recusarNomeRepetido(erro);
  }
  const [criada] = await consultarAreasEntrega(banco, idEstabelecimento, { id });
  return criada;
}

export async function atualizarAreaEntrega(banco, idEstabelecimento, id, dados, administradorId = null) {
  const area = validarAreaEntrega(dados);
  let encontrada;
  try {
    encontrada = await executarTransacao(banco, async (conexao) => {
      const anterior = await travarAreaEntrega(conexao, idEstabelecimento, id);
      if (!anterior) return false;
      await conexao.execute(`
        UPDATE areas_entrega
        SET nome = ?, taxa_entrega_centavos = ?, tempo_estimado_min = ?, tempo_estimado_max = ?, ativo = ?
        WHERE id_estabelecimento = ? AND id = ?
      `, [
        area.nome,
        area.taxaCentavos,
        area.tempoMin,
        area.tempoMax,
        area.ativo === null ? Number(anterior.ativo) : Number(area.ativo),
        idEstabelecimento,
        id
      ]);
      await registrarAuditoria(conexao, idEstabelecimento, administradorId, 'area_entrega.atualizada', 'area_entrega', id, {
        nomeAnterior: anterior.nome,
        nome: area.nome,
        taxaAnteriorCentavos: Number(anterior.taxa_entrega_centavos),
        taxaCentavos: area.taxaCentavos,
        tempoMin: area.tempoMin,
        tempoMax: area.tempoMax
      });
      return true;
    });
  } catch (erro) {
    recusarNomeRepetido(erro);
  }
  if (!encontrada) return null;
  const [atualizada] = await consultarAreasEntrega(banco, idEstabelecimento, { id });
  return atualizada;
}

export async function alterarStatusAreaEntrega(banco, idEstabelecimento, id, ativo, administradorId = null) {
  validarAtivoAreaEntrega(ativo);
  const encontrada = await executarTransacao(banco, async (conexao) => {
    const anterior = await travarAreaEntrega(conexao, idEstabelecimento, id);
    if (!anterior) return false;
    await conexao.execute(
      'UPDATE areas_entrega SET ativo = ? WHERE id_estabelecimento = ? AND id = ?',
      [ativo ? 1 : 0, idEstabelecimento, id]
    );
    await registrarAuditoria(conexao, idEstabelecimento, administradorId, 'area_entrega.status_alterado', 'area_entrega', id, {
      nome: anterior.nome,
      ativo
    });
    return true;
  });
  if (!encontrada) return null;
  const [atualizada] = await consultarAreasEntrega(banco, idEstabelecimento, { id });
  return atualizada;
}

/* Área que já apareceu em pedido não é apagada: o histórico aponta para ela.
   A chave estrangeira RESTRICT de pedidos garante o mesmo no banco. */
export async function excluirAreaEntrega(banco, idEstabelecimento, id, administradorId = null) {
  return executarTransacao(banco, async (conexao) => {
    const area = await travarAreaEntrega(conexao, idEstabelecimento, id);
    if (!area) return false;
    const [usos] = await conexao.execute(
      'SELECT id FROM pedidos WHERE id_estabelecimento = ? AND area_entrega_id = ? LIMIT 1',
      [idEstabelecimento, id]
    );
    if (usos[0]) {
      throw erroDominio('Esta área já foi usada em pedidos e não pode ser excluída. Desative-a para tirá-la do checkout.', 409);
    }
    await conexao.execute('DELETE FROM areas_entrega WHERE id_estabelecimento = ? AND id = ?', [idEstabelecimento, id]);
    await registrarAuditoria(conexao, idEstabelecimento, administradorId, 'area_entrega.excluida', 'area_entrega', id, {
      nome: area.nome
    });
    return true;
  });
}

/*
  Impressão automática de comandas e pedidos.

  O roteamento é por categoria, com exceção por produto: a impressora efetiva de
  um item é `produtos.impressora_id`, ou a da categoria quando o produto não tem
  exceção. As duas podem ser NULL — produto sem impressora configurada é o
  estado normal de quem está começando, e nesse caso o item só não é impresso.

  Regra que não se negocia: gerar trabalho de impressão nunca pode derrubar a
  criação do pedido nem o envio da comanda. Por isso aqui não há nenhuma
  validação que rejeite o pedido; o que não dá para imprimir fica simplesmente
  de fora da fila.
*/
const MAX_IMPRESSORAS = 50;
const MAX_DISPOSITIVOS_IMPRESSAO = 20;
const MAX_TRABALHOS_IMPRESSAO_LOTE = 50;
const ORIGENS_IMPRESSAO = new Set(['comanda', 'delivery']);

function mapearImpressora(linha) {
  return {
    id: Number(linha.id),
    nome: linha.nome,
    host: linha.host,
    porta: Number(linha.porta),
    ativa: Boolean(linha.ativa),
    ehCaixa: Boolean(linha.eh_caixa),
    criadoEm: dataIso(linha.criado_em),
    atualizadoEm: dataIso(linha.atualizado_em)
  };
}

async function consultarImpressoras(banco, idEstabelecimento, { id = null } = {}) {
  const parametros = [idEstabelecimento];
  let filtro = '';
  if (id !== null) {
    filtro = 'AND id = ?';
    parametros.push(id);
  }
  const [linhas] = await banco.execute(`
    SELECT id, nome, host, porta, ativa, eh_caixa, criado_em, atualizado_em
    FROM impressoras
    WHERE id_estabelecimento = ?
    ${filtro}
    ORDER BY nome, id
    LIMIT ${MAX_IMPRESSORAS}
  `, parametros);
  return linhas.map(mapearImpressora);
}

/*
  A impressora do balcão da loja, ou `null` quando ninguém marcou nenhuma.
  Recebe a conexão (e não o pool) para poder ser chamada de dentro de uma
  transação em curso, junto com o que a originou.
*/
export async function buscarImpressoraDeCaixa(conexao, idEstabelecimento) {
  const [linhas] = await conexao.execute(`
    SELECT id, nome, host, porta, ativa, eh_caixa, criado_em, atualizado_em
    FROM impressoras
    WHERE id_estabelecimento = ? AND eh_caixa = 1
    ORDER BY id
    LIMIT 1
  `, [idEstabelecimento]);
  return linhas[0] ? mapearImpressora(linhas[0]) : null;
}

export function listarImpressoras(banco, idEstabelecimento) {
  return consultarImpressoras(banco, idEstabelecimento);
}

function validarAtivaImpressora(ativa) {
  if (typeof ativa !== 'boolean') throw erroDominio('Informe se a impressora está ativa.');
  return ativa;
}

/*
  `host` é endereço de rede local — IP ou hostname —, nunca URL: aceitar
  "http://..." ou um caminho abriria espaço para apontar o agente local para
  outro destino a partir do cadastro.
*/
function validarHostImpressora(valor) {
  const host = typeof valor === 'string' ? valor.trim() : '';
  if (!host) throw erroDominio('Informe o endereço (IP ou nome de rede) da impressora.');
  if (host.length > 255) throw erroDominio('O endereço da impressora pode ter no máximo 255 caracteres.');
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)) {
    throw erroDominio('Informe apenas o IP ou o nome de rede da impressora, sem "http://", porta, barra ou espaços.');
  }
  return host;
}

function inteiroSimples(valor) {
  if (typeof valor === 'number') return Number.isInteger(valor) ? valor : Number.NaN;
  if (typeof valor === 'string' && /^\s*\d{1,6}\s*$/.test(valor)) return Number(valor);
  return Number.NaN;
}

/* Só estes campos saem do corpo; id_estabelecimento e afins são ignorados. */
function validarImpressora(dados) {
  const recebidos = dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
  const nome = typeof recebidos.nome === 'string' ? recebidos.nome.trim() : '';
  if (!nome) throw erroDominio('Informe o nome da impressora.');
  if (nome.length > 120) throw erroDominio('O nome da impressora pode ter no máximo 120 caracteres.');
  const host = validarHostImpressora(recebidos.host);
  const porta = recebidos.porta === undefined || recebidos.porta === null || recebidos.porta === ''
    ? 9100
    : inteiroSimples(recebidos.porta);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    throw erroDominio('Informe uma porta entre 1 e 65535. A porta padrão das impressoras de rede é 9100.');
  }
  const ativa = recebidos.ativa === undefined ? null : validarAtivaImpressora(recebidos.ativa);
  if (recebidos.ehCaixa !== undefined && typeof recebidos.ehCaixa !== 'boolean') {
    throw erroDominio('Informe se esta é a impressora do caixa.');
  }
  const ehCaixa = recebidos.ehCaixa === undefined ? null : recebidos.ehCaixa;
  return { nome, host, porta, ativa, ehCaixa };
}

/*
  Só uma impressora de caixa por loja. Como o MySQL não tem índice único
  parcial, quem garante isso é esta função, sempre chamada dentro da mesma
  transação que grava a impressora: as outras da loja são zeradas antes, então
  não existe instante em que duas fiquem marcadas.

  `exceto` é a impressora que está sendo salva agora, para a atualização não
  desmarcar a si mesma.
*/
async function desmarcarOutrasImpressorasDeCaixa(conexao, idEstabelecimento, exceto = null) {
  const parametros = [idEstabelecimento];
  let filtro = '';
  if (exceto !== null) {
    filtro = 'AND id <> ?';
    parametros.push(exceto);
  }
  await conexao.execute(`
    UPDATE impressoras SET eh_caixa = 0
    WHERE id_estabelecimento = ? AND eh_caixa = 1 ${filtro}
  `, parametros);
}

function recusarImpressoraRepetida(erro) {
  if (erro?.code === 'ER_DUP_ENTRY') {
    throw erroDominio('Já existe uma impressora com esse nome.', 409);
  }
  throw erro;
}

async function travarImpressora(conexao, idEstabelecimento, id) {
  const [linhas] = await conexao.execute(`
    SELECT id, nome, host, porta, ativa, eh_caixa
    FROM impressoras
    WHERE id_estabelecimento = ? AND id = ?
    FOR UPDATE
  `, [idEstabelecimento, id]);
  return linhas[0] ?? null;
}

export async function criarImpressora(banco, idEstabelecimento, dados, administradorId = null) {
  const impressora = validarImpressora(dados);
  let id;
  try {
    id = await executarTransacao(banco, async (conexao) => {
      const [[cadastradas]] = await conexao.execute(
        'SELECT COUNT(id) AS total FROM impressoras WHERE id_estabelecimento = ?',
        [idEstabelecimento]
      );
      if (Number(cadastradas.total) >= MAX_IMPRESSORAS) {
        throw erroDominio(`O limite é de ${MAX_IMPRESSORAS} impressoras por loja.`, 409);
      }
      // Zerar antes de inserir: entre uma coisa e outra ninguém enxerga duas
      // impressoras de caixa, porque as duas acontecem na mesma transação.
      if (impressora.ehCaixa === true) {
        await desmarcarOutrasImpressorasDeCaixa(conexao, idEstabelecimento);
      }
      const [resultado] = await conexao.execute(`
        INSERT INTO impressoras (id_estabelecimento, nome, host, porta, ativa, eh_caixa)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        idEstabelecimento,
        impressora.nome,
        impressora.host,
        impressora.porta,
        impressora.ativa === false ? 0 : 1,
        impressora.ehCaixa === true ? 1 : 0
      ]);
      await registrarAuditoria(conexao, idEstabelecimento, administradorId, 'impressora.criada', 'impressora', resultado.insertId, {
        nome: impressora.nome,
        host: impressora.host,
        porta: impressora.porta,
        ehCaixa: impressora.ehCaixa === true
      });
      return Number(resultado.insertId);
    });
  } catch (erro) {
    recusarImpressoraRepetida(erro);
  }
  const [criada] = await consultarImpressoras(banco, idEstabelecimento, { id });
  return criada;
}

export async function atualizarImpressora(banco, idEstabelecimento, id, dados, administradorId = null) {
  const impressora = validarImpressora(dados);
  let encontrada;
  try {
    encontrada = await executarTransacao(banco, async (conexao) => {
      const anterior = await travarImpressora(conexao, idEstabelecimento, id);
      if (!anterior) return false;
      /* Campo ausente no corpo mantém o valor atual, como já vale para
        `ativa`: atualizar nome e host não muda quem é o caixa. */
      const ehCaixa = impressora.ehCaixa === null
        ? Boolean(anterior.eh_caixa)
        : impressora.ehCaixa;
      if (ehCaixa) await desmarcarOutrasImpressorasDeCaixa(conexao, idEstabelecimento, id);
      await conexao.execute(`
        UPDATE impressoras SET nome = ?, host = ?, porta = ?, ativa = ?, eh_caixa = ?
        WHERE id_estabelecimento = ? AND id = ?
      `, [
        impressora.nome,
        impressora.host,
        impressora.porta,
        impressora.ativa === null ? Number(anterior.ativa) : Number(impressora.ativa),
        ehCaixa ? 1 : 0,
        idEstabelecimento,
        id
      ]);
      await registrarAuditoria(conexao, idEstabelecimento, administradorId, 'impressora.atualizada', 'impressora', id, {
        nomeAnterior: anterior.nome,
        nome: impressora.nome,
        hostAnterior: anterior.host,
        host: impressora.host,
        porta: impressora.porta,
        ehCaixaAnterior: Boolean(anterior.eh_caixa),
        ehCaixa
      });
      return true;
    });
  } catch (erro) {
    recusarImpressoraRepetida(erro);
  }
  if (!encontrada) return null;
  const [atualizada] = await consultarImpressoras(banco, idEstabelecimento, { id });
  return atualizada;
}

export async function atualizarStatusImpressora(banco, idEstabelecimento, id, ativa, administradorId = null) {
  validarAtivaImpressora(ativa);
  const encontrada = await executarTransacao(banco, async (conexao) => {
    const anterior = await travarImpressora(conexao, idEstabelecimento, id);
    if (!anterior) return false;
    await conexao.execute(
      'UPDATE impressoras SET ativa = ? WHERE id_estabelecimento = ? AND id = ?',
      [ativa ? 1 : 0, idEstabelecimento, id]
    );
    await registrarAuditoria(conexao, idEstabelecimento, administradorId, 'impressora.status_alterado', 'impressora', id, {
      nome: anterior.nome,
      ativa
    });
    return true;
  });
  if (!encontrada) return null;
  const [atualizada] = await consultarImpressoras(banco, idEstabelecimento, { id });
  return atualizada;
}

/*
  Dispositivos de impressão: o agente local pareado. O token é sorteado aqui,
  devolvido uma única vez e guardado apenas como hash — o servidor não consegue
  mostrá-lo de novo, exatamente como o token de acesso da equipe.
*/
function mapearDispositivoImpressao(linha) {
  return {
    id: Number(linha.id),
    nome: linha.nome,
    criadoEm: dataIso(linha.criado_em),
    ultimoContatoEm: dataIso(linha.ultimo_contato_em),
    revogadoEm: dataIso(linha.revogado_em),
    ativo: linha.revogado_em == null
  };
}

export async function listarDispositivosImpressao(banco, idEstabelecimento) {
  const [linhas] = await banco.execute(`
    SELECT id, nome, criado_em, ultimo_contato_em, revogado_em
    FROM dispositivos_impressao
    WHERE id_estabelecimento = ?
    ORDER BY revogado_em IS NOT NULL, nome, id
    LIMIT ${MAX_DISPOSITIVOS_IMPRESSAO}
  `, [idEstabelecimento]);
  return linhas.map(mapearDispositivoImpressao);
}

export async function criarDispositivoImpressao(banco, idEstabelecimento, dados, administradorId = null) {
  const recebidos = dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
  const nome = typeof recebidos.nome === 'string' ? recebidos.nome.trim() : '';
  if (!nome) throw erroDominio('Informe um nome para identificar o dispositivo de impressão.');
  if (nome.length > 120) throw erroDominio('O nome do dispositivo pode ter no máximo 120 caracteres.');

  const token = randomBytes(32).toString('base64url');
  const id = await executarTransacao(banco, async (conexao) => {
    const [[cadastrados]] = await conexao.execute(`
      SELECT COUNT(id) AS total FROM dispositivos_impressao
      WHERE id_estabelecimento = ? AND revogado_em IS NULL
    `, [idEstabelecimento]);
    if (Number(cadastrados.total) >= MAX_DISPOSITIVOS_IMPRESSAO) {
      throw erroDominio(`O limite é de ${MAX_DISPOSITIVOS_IMPRESSAO} dispositivos de impressão ativos por loja.`, 409);
    }
    const [resultado] = await conexao.execute(`
      INSERT INTO dispositivos_impressao (id_estabelecimento, nome, token_hash)
      VALUES (?, ?, ?)
    `, [idEstabelecimento, nome, criarHashToken(token)]);
    await registrarAuditoria(conexao, idEstabelecimento, administradorId, 'dispositivo_impressao.criado', 'dispositivo_impressao', resultado.insertId, { nome });
    return Number(resultado.insertId);
  });
  const [linhas] = await banco.execute(`
    SELECT id, nome, criado_em, ultimo_contato_em, revogado_em
    FROM dispositivos_impressao
    WHERE id_estabelecimento = ? AND id = ?
  `, [idEstabelecimento, id]);
  // O token em texto puro só existe neste retorno.
  return { dispositivo: mapearDispositivoImpressao(linhas[0]), token };
}

export async function revogarDispositivoImpressao(banco, idEstabelecimento, id, administradorId = null) {
  return executarTransacao(banco, async (conexao) => {
    const [linhas] = await conexao.execute(`
      SELECT id, nome, revogado_em FROM dispositivos_impressao
      WHERE id_estabelecimento = ? AND id = ?
      FOR UPDATE
    `, [idEstabelecimento, id]);
    const dispositivo = linhas[0];
    if (!dispositivo) return null;
    if (dispositivo.revogado_em == null) {
      await conexao.execute(`
        UPDATE dispositivos_impressao SET revogado_em = CURRENT_TIMESTAMP
        WHERE id_estabelecimento = ? AND id = ?
      `, [idEstabelecimento, id]);
      await registrarAuditoria(conexao, idEstabelecimento, administradorId, 'dispositivo_impressao.revogado', 'dispositivo_impressao', id, {
        nome: dispositivo.nome
      });
    }
    return { id: Number(dispositivo.id), nome: dispositivo.nome };
  });
}

/*
  Autenticação do agente local. Não é JWT nem sessão de painel: o tenant sai do
  próprio token, nunca de nada que o agente informe. Token revogado, de loja
  desativada ou desconhecido não resolve estabelecimento nenhum.
*/
export async function autenticarDispositivoImpressao(banco, token) {
  const informado = typeof token === 'string' ? token.trim() : '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(informado)) return null;
  const [linhas] = await banco.execute(`
    SELECT d.id, d.nome, d.id_estabelecimento
    FROM dispositivos_impressao d
    INNER JOIN estabelecimentos e
      ON e.id_estabelecimento = d.id_estabelecimento
      AND e.status = 'ativo'
    WHERE d.token_hash = ? AND d.revogado_em IS NULL
    LIMIT 1
  `, [criarHashToken(informado)]);
  const dispositivo = linhas[0];
  if (!dispositivo) return null;
  await banco.execute(`
    UPDATE dispositivos_impressao SET ultimo_contato_em = CURRENT_TIMESTAMP
    WHERE id = ? AND id_estabelecimento = ?
  `, [dispositivo.id, dispositivo.id_estabelecimento]);
  return {
    id: Number(dispositivo.id),
    nome: dispositivo.nome,
    idEstabelecimento: Number(dispositivo.id_estabelecimento)
  };
}

/*
  Fila do agente: só os trabalhos pendentes da própria loja, mais antigos
  primeiro e sem corte por idade — o que ficou represado enquanto a impressora
  estava fora do ar precisa sair quando ela voltar.
*/
export async function listarTrabalhosImpressao(banco, idEstabelecimento) {
  const [linhas] = await banco.execute(`
    SELECT t.id, t.origem, t.pedido_id, t.comanda_id, t.conteudo_json, t.tentativas, t.criado_em,
      i.id AS impressora_id, i.nome AS impressora_nome, i.host AS impressora_host,
      i.porta AS impressora_porta
    FROM trabalhos_impressao t
    INNER JOIN impressoras i
      ON i.id = t.impressora_id
      AND i.id_estabelecimento = t.id_estabelecimento
    WHERE t.id_estabelecimento = ? AND t.status = 'pendente' AND i.ativa = 1
    ORDER BY t.id
    LIMIT ${MAX_TRABALHOS_IMPRESSAO_LOTE}
  `, [idEstabelecimento]);
  return linhas.map((linha) => ({
    id: Number(linha.id),
    origem: linha.origem,
    pedidoId: linha.pedido_id == null ? null : Number(linha.pedido_id),
    comandaId: linha.comanda_id == null ? null : Number(linha.comanda_id),
    tentativas: Number(linha.tentativas),
    criadoEm: dataIso(linha.criado_em),
    impressora: {
      id: Number(linha.impressora_id),
      nome: linha.impressora_nome,
      host: linha.impressora_host,
      porta: Number(linha.impressora_porta)
    },
    // mysql2 devolve JSON já convertido; texto (MariaDB) é lido aqui.
    conteudo: typeof linha.conteudo_json === 'string'
      ? JSON.parse(linha.conteudo_json)
      : linha.conteudo_json
  }));
}

export async function confirmarTrabalhoImpressao(banco, idEstabelecimento, id) {
  const [resultado] = await banco.execute(`
    UPDATE trabalhos_impressao
    SET status = 'impresso', impresso_em = CURRENT_TIMESTAMP
    WHERE id = ? AND id_estabelecimento = ? AND status = 'pendente'
  `, [id, idEstabelecimento]);
  return resultado.affectedRows > 0;
}

/* Falha não tira o trabalho da fila: só conta a tentativa, para o agente
   tentar de novo no ciclo seguinte. */
export async function falharTrabalhoImpressao(banco, idEstabelecimento, id) {
  const [resultado] = await banco.execute(`
    UPDATE trabalhos_impressao
    SET tentativas = tentativas + 1
    WHERE id = ? AND id_estabelecimento = ? AND status = 'pendente'
  `, [id, idEstabelecimento]);
  return resultado.affectedRows > 0;
}

/*
  Impressora efetiva de cada item, dentro do estabelecimento. O JOIN prende a
  impressora ao tenant do produto: mesmo que uma coluna apontasse para outra
  loja, a linha não voltaria e o item sairia da fila em vez de vazar.
*/
async function resolverImpressorasDosItens(conexao, idEstabelecimento, produtosIds) {
  const ids = [...new Set(produtosIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return new Map();
  const marcadores = ids.map(() => '?').join(', ');
  const [linhas] = await conexao.execute(`
    SELECT p.id AS produto_id, i.id AS impressora_id, i.nome AS impressora_nome
    FROM produtos p
    INNER JOIN categorias c
      ON c.id = p.categoria_id
      AND c.id_estabelecimento = p.id_estabelecimento
    INNER JOIN impressoras i
      ON i.id = COALESCE(p.impressora_id, c.impressora_id)
      AND i.id_estabelecimento = p.id_estabelecimento
      AND i.ativa = 1
    WHERE p.id_estabelecimento = ? AND p.id IN (${marcadores})
  `, [idEstabelecimento, ...ids]);
  return new Map(linhas.map((linha) => [Number(linha.produto_id), {
    id: Number(linha.impressora_id),
    nome: linha.impressora_nome
  }]));
}

/*
  Monta e enfileira um trabalho por impressora envolvida.

  `itens` traz produtoId, nome, quantidade, observação e adicionais; `contexto`
  é o cabeçalho do recibo (mesa e garçom, ou cliente e endereço). Item cujo
  produto não tem impressora configurada — nem no produto, nem na categoria —
  é ignorado sem erro: é o estado normal de quem ainda não configurou nada.
*/
export async function gerarTrabalhosImpressao(
  conexao,
  idEstabelecimento,
  { origem, pedidoId = null, comandaId = null, itens = [], contexto = {} }
) {
  if (!ORIGENS_IMPRESSAO.has(origem)) throw new Error(`Origem de impressão inválida: ${origem}`);
  if (!Array.isArray(itens) || itens.length === 0) return [];

  const impressoras = await resolverImpressorasDosItens(
    conexao,
    idEstabelecimento,
    itens.map((item) => Number(item.produtoId))
  );
  if (impressoras.size === 0) return [];

  const porImpressora = new Map();
  for (const item of itens) {
    const impressora = impressoras.get(Number(item.produtoId));
    if (!impressora) continue;
    if (!porImpressora.has(impressora.id)) porImpressora.set(impressora.id, { impressora, itens: [] });
    porImpressora.get(impressora.id).itens.push({
      nome: texto(item.nome, 160),
      quantidade: Number(item.quantidade),
      observacao: texto(item.observacao, 1000) || null,
      adicionais: (item.adicionais ?? []).map((adicional) => texto(adicional?.nome ?? adicional, 120))
    });
  }

  const criados = [];
  const emitidoEm = new Date().toISOString();
  for (const [impressoraId, grupo] of porImpressora) {
    const conteudo = {
      origem,
      impressora: grupo.impressora.nome,
      emitidoEm,
      cabecalho: contexto,
      itens: grupo.itens
    };
    const [resultado] = await conexao.execute(`
      INSERT INTO trabalhos_impressao
        (id_estabelecimento, impressora_id, origem, pedido_id, comanda_id, conteudo_json, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pendente')
    `, [
      idEstabelecimento,
      impressoraId,
      origem,
      pedidoId,
      comandaId,
      JSON.stringify(conteudo)
    ]);
    criados.push(Number(resultado.insertId));
  }
  return criados;
}

export async function salvarConfiguracao(banco, idEstabelecimento, dados, administradorId = null) {
  const nomeLoja = texto(dados.nomeLoja, 160);
  const telefone = texto(dados.telefone, 40);
  const email = texto(dados.email, 160);
  const endereco = texto(dados.endereco, 255);
  const tempoEntrega = texto(dados.tempoEntrega, 60);
  const pixChave = texto(dados.pixChave, 180);
  const pixBeneficiario = texto(dados.pixBeneficiario, 160);
  const pixCidade = texto(dados.pixCidade, 60);
  const logo = texto(dados.logo, 500);
  const banner = texto(dados.banner, 500);
  const bannerTitulo = texto(dados.bannerTitulo, 160);
  const bannerSubtitulo = texto(dados.bannerSubtitulo, 280);
  const bannerBotaoTexto = texto(dados.bannerBotaoTexto, 60);
  const bannerBotaoDestinoInformado = texto(dados.bannerBotaoDestino, 20).toLowerCase();
  if (bannerBotaoDestinoInformado && !BANNER_DESTINOS_PERMITIDOS.has(bannerBotaoDestinoInformado)) {
    throw erroDominio('Selecione um destino válido para o botão do banner.');
  }
  const bannerBotaoDestino = BANNER_DESTINOS_PERMITIDOS.has(bannerBotaoDestinoInformado)
    ? bannerBotaoDestinoInformado
    : '';
  if (Boolean(bannerBotaoTexto) !== Boolean(bannerBotaoDestino)) {
    throw erroDominio('Informe o texto e o destino do botão do banner juntos, ou deixe ambos vazios.');
  }
  const tituloCardapio = texto(dados.tituloCardapio, 160);
  const textoApresentacao = texto(dados.textoApresentacao, 280);
  const tituloSobre = texto(dados.tituloSobre, 160);
  const textoSobre = texto(dados.textoSobre, 600);
  const mensagemRodape = texto(dados.mensagemRodape, 280);
  const whatsapp = texto(dados.whatsapp, 40);
  /* A grade da semana é a fonte da verdade quando algum dia está marcado: o
    texto público passa a ser gerado a partir dela, sem cadastro duplicado. */
  const erroHorarios = erroNosHorarios(dados.horarios);
  if (erroHorarios) throw erroDominio(erroHorarios);
  const horarios = normalizarHorarios(dados.horarios);
  const funcionamentoAutomatico = dados.funcionamentoAutomatico === true;
  if (funcionamentoAutomatico && !algumDiaAberto(horarios)) {
    throw erroDominio('Marque ao menos um dia de funcionamento para usar o horário automático.');
  }
  const horarioFuncionamento = algumDiaAberto(horarios)
    ? resumoHorarios(horarios)
    : texto(dados.horarioFuncionamento, 2000);
  const instagramUrl = validarUrlOpcional(dados.instagramUrl, 'o Instagram');
  const facebookUrl = validarUrlOpcional(dados.facebookUrl, 'o Facebook');
  const politicaCancelamento = texto(dados.politicaCancelamento, 2000);
  const informacoesLegais = texto(dados.informacoesLegais, 2000);
  const taxaEntregaCentavos = precoParaCentavos(dados.taxaEntrega);
  const aceitaCartao = dados.aceitaCartao === true;
  const aceitaDinheiro = dados.aceitaDinheiro === true;
  const formasPagamento = [
    pixChave ? 'Pix' : null,
    aceitaCartao ? 'Cartão' : null,
    aceitaDinheiro ? 'Dinheiro' : null
  ].filter(Boolean);

  if (!nomeLoja || !telefone || !email || !endereco || !tempoEntrega || !horarioFuncionamento) {
    throw erroDominio('Preencha todos os dados da lanchonete.');
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) throw erroDominio('Informe um e-mail válido para a loja.');
  if (pixChave && (!pixBeneficiario || !pixCidade)) {
    throw erroDominio('Informe o beneficiário e a cidade da chave Pix ou deixe a configuração Pix vazia.');
  }
  if (pixCidade && !pixChave) {
    throw erroDominio('Cadastre a chave Pix antes de informar a cidade do recebedor.');
  }
  if (!Number.isInteger(taxaEntregaCentavos) || taxaEntregaCentavos < 0) {
    throw erroDominio('Informe um valor válido para a taxa de entrega.');
  }
  if (!pixChave && !aceitaCartao && !aceitaDinheiro) {
    throw erroDominio('Habilite ao menos uma forma de pagamento.');
  }

  await executarTransacao(banco, async (conexao) => {
    await conexao.execute(`
      UPDATE estabelecimentos
      SET nome_fantasia = ?
      WHERE id_estabelecimento = ?
    `, [nomeLoja, idEstabelecimento]);
    await conexao.execute(`
    INSERT INTO configuracoes_estabelecimento
      (id_estabelecimento, telefone, email, endereco, taxa_entrega_centavos,
       tempo_entrega, loja_aberta, pix_chave, pix_beneficiario, pix_cidade,
       logo_url, banner_url, banner_titulo, banner_subtitulo, banner_botao_texto, banner_botao_destino,
       titulo_cardapio, texto_apresentacao, titulo_sobre, texto_sobre, mensagem_rodape,
       whatsapp, horario_funcionamento, instagram_url, facebook_url, entrega_ativa, retirada_ativa,
       atendimento_garcom_ativo, aceita_cartao, aceita_dinheiro,
       formas_pagamento_json, politica_cancelamento, informacoes_legais,
       horarios_json, funcionamento_automatico)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      telefone = VALUES(telefone), email = VALUES(email), endereco = VALUES(endereco),
      taxa_entrega_centavos = VALUES(taxa_entrega_centavos),
      tempo_entrega = VALUES(tempo_entrega),
      loja_aberta = VALUES(loja_aberta), pix_chave = VALUES(pix_chave),
      pix_beneficiario = VALUES(pix_beneficiario), pix_cidade = VALUES(pix_cidade),
      logo_url = VALUES(logo_url), banner_url = VALUES(banner_url),
      banner_titulo = VALUES(banner_titulo), banner_subtitulo = VALUES(banner_subtitulo),
      banner_botao_texto = VALUES(banner_botao_texto), banner_botao_destino = VALUES(banner_botao_destino),
      titulo_cardapio = VALUES(titulo_cardapio), texto_apresentacao = VALUES(texto_apresentacao),
      titulo_sobre = VALUES(titulo_sobre), texto_sobre = VALUES(texto_sobre),
      mensagem_rodape = VALUES(mensagem_rodape),
      whatsapp = VALUES(whatsapp), horario_funcionamento = VALUES(horario_funcionamento),
      instagram_url = VALUES(instagram_url), facebook_url = VALUES(facebook_url),
      entrega_ativa = VALUES(entrega_ativa), retirada_ativa = VALUES(retirada_ativa),
      atendimento_garcom_ativo = VALUES(atendimento_garcom_ativo),
      aceita_cartao = VALUES(aceita_cartao), aceita_dinheiro = VALUES(aceita_dinheiro),
      formas_pagamento_json = VALUES(formas_pagamento_json),
      politica_cancelamento = VALUES(politica_cancelamento),
      informacoes_legais = VALUES(informacoes_legais),
      horarios_json = VALUES(horarios_json),
      funcionamento_automatico = VALUES(funcionamento_automatico)
  `, [
    idEstabelecimento,
    telefone,
    email,
    endereco,
    taxaEntregaCentavos,
    tempoEntrega,
    dados.lojaAbertaManual === true ? 1 : 0,
    pixChave || null,
    pixChave ? pixBeneficiario : null,
    pixChave ? (pixCidade || null) : null,
    logo || null,
    banner || null,
    bannerTitulo || null,
    bannerSubtitulo || null,
    bannerBotaoTexto || null,
    bannerBotaoDestino || null,
    tituloCardapio || null,
    textoApresentacao || null,
    tituloSobre || null,
    textoSobre || null,
    mensagemRodape || null,
    whatsapp || null,
    horarioFuncionamento,
    instagramUrl || null,
    facebookUrl || null,
    dados.entregaAtiva === true ? 1 : 0,
    dados.retiradaAtiva === true ? 1 : 0,
    dados.atendimentoGarcomAtivo === true ? 1 : 0,
    aceitaCartao ? 1 : 0,
    aceitaDinheiro ? 1 : 0,
    JSON.stringify(formasPagamento),
    politicaCancelamento || null,
    informacoesLegais || null,
    algumDiaAberto(horarios) ? JSON.stringify(horarios) : null,
    funcionamentoAutomatico ? 1 : 0
  ]);
    await registrarAuditoria(
      conexao,
      idEstabelecimento,
      administradorId,
      'configuracao.atualizada',
      'configuracao',
      idEstabelecimento,
      { identidadeVisual: true, operacao: true, informacoesPublicas: true, textosPublicos: true }
    );
  });
  return buscarConfiguracao(banco, idEstabelecimento);
}

function mapearPromocao(linha) {
  return {
    id: Number(linha.id),
    produtoId: linha.produto_id ? Number(linha.produto_id) : null,
    nome: linha.nome,
    categoria: linha.categoria,
    descricao: linha.descricao,
    precoAntigo: formatarPreco(linha.preco_anterior_centavos),
    preco: formatarPreco(linha.preco_centavos),
    imagem: linha.imagem_url || linha.imagem_produto || null,
    // Só a foto da própria promoção: o formulário precisa saber se ela existe,
    // já que `imagem` acima pode ser a foto herdada do produto vinculado.
    imagemPropria: linha.imagem_url ?? null,
    destaque: linha.destaque ?? '',
    tipo: linha.tipo ?? '',
    ativo: Boolean(linha.ativo),
    disponivel: promocaoDisponivel(linha),
    inicioEm: dataIso(linha.inicio_em),
    fimEm: dataIso(linha.fim_em)
  };
}

export async function listarPromocoes(banco, idEstabelecimento, { somenteAtivas = false } = {}) {
  const [linhas] = await banco.execute(`
    SELECT
      pr.id,
      pr.produto_id,
      pr.nome,
      pr.categoria,
      pr.descricao,
      pr.preco_anterior_centavos,
      pr.preco_centavos,
      pr.imagem_url,
      pr.destaque,
      pr.tipo,
      pr.ativo,
      pr.inicio_em,
      pr.fim_em,
      p.imagem_url AS imagem_produto
    FROM promocoes pr
    LEFT JOIN produtos p
      ON p.id = pr.produto_id
      AND p.id_estabelecimento = pr.id_estabelecimento
    WHERE pr.id_estabelecimento = ?
    ${somenteAtivas ? `AND pr.ativo = 1
      AND (pr.inicio_em IS NULL OR pr.inicio_em <= CURRENT_TIMESTAMP)
      AND (pr.fim_em IS NULL OR pr.fim_em >= CURRENT_TIMESTAMP)` : ''}
    ORDER BY pr.id
  `, [idEstabelecimento]);
  return linhas.map(mapearPromocao);
}

async function validarPromocao(banco, idEstabelecimento, dados, imagemUrl) {
  const nome = texto(dados.nome, 160);
  const descricao = texto(dados.descricao, 2000);
  const precoAnteriorCentavos = precoParaCentavos(dados.precoAntigo || 0);
  const precoCentavos = precoParaCentavos(dados.preco);
  const inicioEm = dataOpcional(dados.inicioEm, 'o início da promoção');
  const fimEm = dataOpcional(dados.fimEm, 'o fim da promoção');
  if (!nome || !descricao) throw erroDominio('Preencha nome e descrição da promoção.');
  if (!Number.isInteger(precoAnteriorCentavos) || precoAnteriorCentavos < 0
      || !Number.isInteger(precoCentavos) || precoCentavos <= 0) {
    throw erroDominio('Informe preços válidos para a promoção.');
  }
  if (inicioEm && fimEm && inicioEm >= fimEm) {
    throw erroDominio('O fim da promoção deve ser posterior ao início.');
  }

  const produtoId = Number(dados.produtoId) || null;
  if (!produtoId) throw erroDominio('Vincule a promoção a um produto do cardápio.');
  /* A promoção é vitrine do cardápio online, então só aceita produto que
     apareça lá — senão o site anunciaria algo que ninguém consegue pedir. */
  const [produtos] = await banco.execute(`
    SELECT p.id, c.nome AS categoria
    FROM produtos p
    INNER JOIN categorias c
      ON c.id = p.categoria_id
      AND c.id_estabelecimento = p.id_estabelecimento
    WHERE p.id = ? AND p.id_estabelecimento = ? AND p.ativo = 1 AND c.ativo = 1
      ${VISIBILIDADE_ONLINE.sql}
  `, [produtoId, idEstabelecimento, ...VISIBILIDADE_ONLINE.parametros]);
  if (!produtos[0]) {
    throw erroDominio(
      'O produto vinculado à promoção não está disponível no cardápio online.',
      409
    );
  }

  return {
    produtoId,
    nome,
    categoria: produtos[0].categoria,
    descricao,
    precoAnteriorCentavos,
    precoCentavos,
    imagem: texto(imagemUrl, 500) || null,
    destaque: texto(dados.destaque, 100) || null,
    tipo: texto(dados.tipo, 100) || null,
    ativo: dados.ativo === false ? 0 : 1,
    inicioEm,
    fimEm
  };
}

export async function salvarPromocao(banco, idEstabelecimento, dados, id = null, imagemUrl = null) {
  const promocao = await validarPromocao(banco, idEstabelecimento, dados, imagemUrl);
  let promocaoId = Number(id) || null;
  if (promocaoId) {
    const [resultado] = await banco.execute(`
      UPDATE promocoes
      SET produto_id = ?, nome = ?, categoria = ?, descricao = ?, preco_anterior_centavos = ?,
          preco_centavos = ?, imagem_url = ?, destaque = ?, tipo = ?, ativo = ?, inicio_em = ?, fim_em = ?
      WHERE id = ? AND id_estabelecimento = ?
    `, [
      promocao.produtoId, promocao.nome, promocao.categoria, promocao.descricao,
      promocao.precoAnteriorCentavos, promocao.precoCentavos, promocao.imagem,
      promocao.destaque, promocao.tipo, promocao.ativo, promocao.inicioEm, promocao.fimEm,
      promocaoId, idEstabelecimento
    ]);
    if (!resultado.affectedRows) throw erroDominio('Promoção não encontrada.', 404);
  } else {
    const [resultado] = await banco.execute(`
      INSERT INTO promocoes
        (id_estabelecimento, produto_id, nome, categoria, descricao, preco_anterior_centavos,
         preco_centavos, imagem_url, destaque, tipo, ativo, inicio_em, fim_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      idEstabelecimento,
      promocao.produtoId, promocao.nome, promocao.categoria, promocao.descricao,
      promocao.precoAnteriorCentavos, promocao.precoCentavos, promocao.imagem,
      promocao.destaque, promocao.tipo, promocao.ativo, promocao.inicioEm, promocao.fimEm
    ]);
    promocaoId = Number(resultado.insertId);
  }
  const promocoes = await listarPromocoes(banco, idEstabelecimento);
  return promocoes.find((item) => item.id === promocaoId);
}

/*
  Devolve só a foto que pertence à promoção, nunca a herdada do produto: é ela
  que a rota apaga do disco ao trocar ou excluir o registro.
*/
export async function buscarPromocao(banco, idEstabelecimento, id) {
  const [linhas] = await banco.execute(`
    SELECT pr.id, pr.imagem_url
    FROM promocoes pr
    WHERE pr.id = ? AND pr.id_estabelecimento = ?
  `, [id, idEstabelecimento]);
  if (!linhas[0]) return null;
  return { id: Number(linhas[0].id), imagem: linhas[0].imagem_url ?? null };
}

export async function excluirPromocao(banco, idEstabelecimento, id) {
  const [resultado] = await banco.execute(`
    DELETE FROM promocoes WHERE id = ? AND id_estabelecimento = ?
  `, [id, idEstabelecimento]);
  return resultado.affectedRows > 0;
}

function mapearFuncionario(linha) {
  return {
    id: String(linha.id),
    nome: linha.nome,
    cargo: linha.cargo,
    usuario: linha.usuario,
    status: linha.ativo ? 'Ativo' : 'Inativo',
    // O painel precisa distinguir quem já pode entrar de quem ainda espera o
    // administrador definir a senha.
    senhaDefinida: Boolean(linha.senha_definida_em),
    vendas: Number(linha.vendas ?? 0),
    comandas: Number(linha.comandas ?? 0)
  };
}

/*
  A senha é a única coisa que o garçom digita, então ela também é o que o
  identifica. Normalizar antes de gravar e antes de comparar evita que o teclado
  do celular derrube o acesso: o autocorretor costuma mandar "Wesley" onde o
  administrador cadastrou "wesley".
*/
function normalizarSenhaGarcom(valor) {
  return texto(valor, 40)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function validarSenhaGarcom(senha) {
  if (!/^[a-z0-9][a-z0-9._-]{3,31}$/.test(senha)) {
    throw erroDominio(
      'A senha deve ter de 4 a 32 caracteres, usando letras, números, ponto, hífen ou _.'
    );
  }
  return senha;
}

/* O login não usa mais o usuário, mas a coluna continua identificando o
   funcionário nas telas e nos relatórios. Deriva do nome e ganha um sufixo
   quando dois cadastros do mesmo estabelecimento colidem. */
async function reservarUsuarioFuncionario(banco, idEstabelecimento, nome, id) {
  const base = texto(nome, 50)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '') || 'garcom';
  for (let tentativa = 1; tentativa <= 50; tentativa += 1) {
    const usuario = tentativa === 1 ? base : `${base}.${tentativa}`;
    const [conflitos] = await banco.execute(`
      SELECT id FROM funcionarios
      WHERE usuario = ? AND id_estabelecimento = ? AND id <> ?
      LIMIT 1
    `, [usuario, idEstabelecimento, Number(id) || 0]);
    if (conflitos.length === 0) return usuario;
  }
  return `garcom.${randomUUID().slice(0, 8)}`;
}

export async function listarFuncionarios(banco, idEstabelecimento, { somenteAtivos = false } = {}) {
  const [linhas] = await banco.execute(`
    SELECT f.id, f.nome, f.cargo, f.usuario, f.ativo, f.senha_definida_em,
      COUNT(DISTINCT CASE WHEN c.status = 'Encerrada' THEN c.id END) AS comandas,
      COUNT(DISTINCT CASE WHEN p.status IN ('Entregue', 'Entregue na mesa') THEN p.id END) AS vendas
    FROM funcionarios f
    LEFT JOIN comandas c
      ON c.funcionario_id = f.id
      AND c.id_estabelecimento = f.id_estabelecimento
    LEFT JOIN pedidos p
      ON p.funcionario_id = f.id
      AND p.id_estabelecimento = f.id_estabelecimento
    WHERE f.id_estabelecimento = ?
    ${somenteAtivos ? 'AND f.ativo = 1' : ''}
    GROUP BY f.id
    ORDER BY f.nome
  `, [idEstabelecimento]);
  return linhas.map(mapearFuncionario);
}

/*
  QR Code único da equipe. É um só por estabelecimento: o administrador imprime
  uma vez e a equipe inteira usa o mesmo código para chegar à tela de acesso.
  Nasce sob demanda, na primeira vez que o painel o exibe, para atender também
  os estabelecimentos criados antes desta funcionalidade.
*/
export async function obterTokenAcessoGarcom(banco, idEstabelecimento) {
  const [linhas] = await banco.execute(`
    SELECT token_acesso_garcom
    FROM estabelecimentos
    WHERE id_estabelecimento = ?
    LIMIT 1
  `, [idEstabelecimento]);
  if (!linhas[0]) throw erroDominio('Estabelecimento não encontrado.', 404);
  return linhas[0].token_acesso_garcom || rotacionarTokenAcessoGarcom(banco, idEstabelecimento);
}

/* Trocar o token invalida na hora todo QR Code já impresso ou compartilhado. As
   sessões abertas seguem valendo até expirarem: o objetivo é cortar quem ainda
   não entrou, não derrubar o turno em andamento. */
export async function rotacionarTokenAcessoGarcom(banco, idEstabelecimento) {
  const token = `equipe-${randomUUID().replaceAll('-', '')}`;
  const [resultado] = await banco.execute(`
    UPDATE estabelecimentos
    SET token_acesso_garcom = ?
    WHERE id_estabelecimento = ?
  `, [token, idEstabelecimento]);
  if (!resultado.affectedRows) throw erroDominio('Estabelecimento não encontrado.', 404);
  return token;
}

export async function tokenAcessoGarcomValido(banco, idEstabelecimento, token) {
  const informado = texto(token, 160);
  if (!informado) return false;
  const [linhas] = await banco.execute(`
    SELECT 1 AS valido
    FROM estabelecimentos
    WHERE id_estabelecimento = ? AND token_acesso_garcom = ?
    LIMIT 1
  `, [idEstabelecimento, informado]);
  return linhas.length > 0;
}

/*
  Login do garçom: só a senha. O índice determinístico encontra o cadastro em
  uma consulta indexada — sem ele seria preciso testar o hash de cada
  funcionário da equipe a cada tentativa — e o `pin_hash` confirma. O
  estabelecimento entra nas duas pontas: o índice já é derivado do tenant e a
  consulta ainda filtra por ele.
*/
export async function buscarFuncionarioPorSenha(banco, idEstabelecimento, senha) {
  const normalizada = normalizarSenhaGarcom(senha);
  if (!normalizada) return null;
  const [linhas] = await banco.execute(`
    SELECT id, nome, cargo, usuario, pin_hash
    FROM funcionarios
    WHERE senha_busca = ?
      AND id_estabelecimento = ?
      AND ativo = 1
      AND pin_hash IS NOT NULL
    LIMIT 1
  `, [criarIndiceSenhaGarcom(idEstabelecimento, normalizada), idEstabelecimento]);
  const funcionario = linhas[0] ?? null;
  if (!funcionario || !verificarSenha(normalizada, funcionario.pin_hash)) return null;
  return funcionario;
}

/*
  O administrador cadastra nome, cargo e senha. A senha é obrigatória no
  cadastro e opcional na edição: em branco, mantém a atual. Trocar a senha
  derruba as sessões abertas do funcionário — é o caminho de senha esquecida ou
  de troca de aparelho, e a credencial antiga precisa morrer no mesmo momento.
*/
export async function salvarFuncionario(banco, idEstabelecimento, dados, id = null) {
  const nome = texto(dados.nome, 160);
  const cargo = texto(dados.cargo, 80) || 'Garçom';
  const senha = normalizarSenhaGarcom(dados.senha);
  const funcionarioId = Number(id) || null;
  if (!nome) throw erroDominio('Informe o nome do funcionário.');
  if (!funcionarioId || senha) validarSenhaGarcom(senha);

  const usuario = await reservarUsuarioFuncionario(banco, idEstabelecimento, nome, funcionarioId);
  const indiceSenha = senha ? criarIndiceSenhaGarcom(idEstabelecimento, senha) : null;
  if (indiceSenha) {
    const [conflitos] = await banco.execute(`
      SELECT id FROM funcionarios
      WHERE senha_busca = ? AND id_estabelecimento = ? AND id <> ?
      LIMIT 1
    `, [indiceSenha, idEstabelecimento, funcionarioId || 0]);
    if (conflitos.length > 0) {
      throw erroDominio(
        'Essa senha já é de outro funcionário. Como o garçom entra só com a senha, cada um precisa da sua.',
        409
      );
    }
  }

  let idFinal = funcionarioId;
  if (idFinal) {
    const [resultado] = indiceSenha
      ? await banco.execute(`
        UPDATE funcionarios
        SET nome = ?, cargo = ?, usuario = ?, pin_hash = ?, senha_busca = ?,
          senha_definida_em = CURRENT_TIMESTAMP
        WHERE id = ? AND id_estabelecimento = ?
      `, [nome, cargo, usuario, criarHashSenha(senha), indiceSenha, idFinal, idEstabelecimento])
      : await banco.execute(`
        UPDATE funcionarios
        SET nome = ?, cargo = ?, usuario = ?
        WHERE id = ? AND id_estabelecimento = ?
      `, [nome, cargo, usuario, idFinal, idEstabelecimento]);
    if (!resultado.affectedRows) throw erroDominio('Funcionário não encontrado.', 404);
    if (indiceSenha) {
      await banco.execute(`
        DELETE FROM sessoes_garcom
        WHERE funcionario_id = ? AND id_estabelecimento = ?
      `, [idFinal, idEstabelecimento]);
    }
  } else {
    const [resultado] = await banco.execute(`
      INSERT INTO funcionarios
        (id_estabelecimento, nome, cargo, usuario, pin_hash, senha_busca, token_acesso,
         senha_definida_em, ativo)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
    `, [
      idEstabelecimento,
      nome,
      cargo,
      usuario,
      criarHashSenha(senha),
      indiceSenha,
      normalizarToken(nome)
    ]);
    idFinal = Number(resultado.insertId);
  }
  const funcionarios = await listarFuncionarios(banco, idEstabelecimento);
  return funcionarios.find((item) => item.id === String(idFinal));
}

/* Excluir apaga o cadastro e as sessões abertas (ON DELETE CASCADE). As
   comandas e os pedidos que o funcionário atendeu continuam no histórico,
   apenas sem o vínculo com o cadastro (ON DELETE SET NULL). */
export async function excluirFuncionario(banco, idEstabelecimento, id) {
  const [resultado] = await banco.execute(`
    DELETE FROM funcionarios WHERE id = ? AND id_estabelecimento = ?
  `, [id, idEstabelecimento]);
  return resultado.affectedRows > 0;
}

export async function alternarStatusFuncionario(banco, idEstabelecimento, id, ativo) {
  const [resultado] = await banco.execute(`
    UPDATE funcionarios SET ativo = ? WHERE id = ? AND id_estabelecimento = ?
  `, [ativo ? 1 : 0, id, idEstabelecimento]);
  if (!resultado.affectedRows) return null;
  if (!ativo) {
    await banco.execute(`
      DELETE FROM sessoes_garcom
      WHERE funcionario_id = ? AND id_estabelecimento = ?
    `, [id, idEstabelecimento]);
  }
  const funcionarios = await listarFuncionarios(banco, idEstabelecimento);
  return funcionarios.find((item) => item.id === String(id));
}

export async function listarMesas(banco, idEstabelecimento) {
  const [linhas] = await banco.execute(`
    SELECT m.id, m.numero, m.lugares,
      CASE WHEN c.id IS NULL THEN 'Livre' ELSE 'Ocupada' END AS status
    FROM mesas m
    LEFT JOIN comandas c
      ON c.mesa_id = m.id
      AND c.id_estabelecimento = m.id_estabelecimento
      AND c.status NOT IN ('Encerrada', 'Cancelada')
    WHERE m.id_estabelecimento = ? AND m.ativo = 1
    ORDER BY CAST(m.numero AS UNSIGNED), m.numero
  `, [idEstabelecimento]);
  return linhas.map((linha) => ({
    id: Number(linha.id),
    numero: linha.numero,
    lugares: Number(linha.lugares),
    status: linha.status
  }));
}

export async function criarMesa(banco, idEstabelecimento, dados) {
  const numeroInformado = texto(dados?.numero, 10);
  if (!/^\d{1,3}$/.test(numeroInformado) || Number(numeroInformado) < 1) {
    throw erroDominio('Informe um número de mesa entre 1 e 999.');
  }
  const numero = String(Number(numeroInformado)).padStart(2, '0');
  const [resultado] = await banco.execute(`
    INSERT INTO mesas (id_estabelecimento, numero, lugares, ativo)
    VALUES (?, ?, 4, 1)
  `, [idEstabelecimento, numero]);
  const mesas = await listarMesas(banco, idEstabelecimento);
  return mesas.find((mesa) => mesa.id === Number(resultado.insertId));
}

async function listarAdicionaisDeItens(banco, idEstabelecimento, tabela, campo, itensIds) {
  const mapa = new Map();
  if (itensIds.length === 0) return mapa;
  const marcadores = itensIds.map(() => '?').join(', ');
  const [linhas] = await banco.execute(`
    SELECT ${campo} AS item_id, adicional_id, nome_adicional, preco_centavos
    FROM ${tabela}
    WHERE id_estabelecimento = ? AND ${campo} IN (${marcadores})
    ORDER BY nome_adicional
  `, [idEstabelecimento, ...itensIds]);
  for (const linha of linhas) {
    const itemId = Number(linha.item_id);
    if (!mapa.has(itemId)) mapa.set(itemId, []);
    mapa.get(itemId).push({
      id: linha.adicional_id ? Number(linha.adicional_id) : null,
      nome: linha.nome_adicional,
      preco: Number(linha.preco_centavos) / 100
    });
  }
  return mapa;
}

/* O salão inteiro é da equipe: qualquer garçom enxerga e atende qualquer
   comanda do próprio estabelecimento. O recorte que sobra é o do tenant, que
   nunca sai daqui. */
export async function listarComandas(banco, idEstabelecimento) {
  const [comandas] = await banco.execute(`
    SELECT c.id, c.mesa_id, c.funcionario_id, c.aberta_por_admin_id, c.status,
      c.pagamento, c.observacao, c.aberta_em, m.numero AS mesa_numero,
      f.nome AS garcom, a.nome AS aberta_por_admin
    FROM comandas c
    INNER JOIN mesas m
      ON m.id = c.mesa_id
      AND m.id_estabelecimento = c.id_estabelecimento
    LEFT JOIN funcionarios f
      ON f.id = c.funcionario_id
      AND f.id_estabelecimento = c.id_estabelecimento
    LEFT JOIN administradores a
      ON a.id = c.aberta_por_admin_id
      AND a.id_estabelecimento = c.id_estabelecimento
    WHERE c.id_estabelecimento = ? AND c.status NOT IN ('Encerrada', 'Cancelada')
    ORDER BY c.aberta_em DESC
  `, [idEstabelecimento]);
  if (comandas.length === 0) return [];
  const ids = comandas.map((comanda) => Number(comanda.id));
  const marcadores = ids.map(() => '?').join(', ');
  const [itens] = await banco.execute(`
    SELECT ci.id, ci.comanda_id, ci.produto_id, ci.nome_produto,
      ci.preco_unitario_centavos, ci.quantidade, ci.observacao, ci.criado_em,
      ci.enviado_em, fe.nome AS enviado_por_funcionario,
      ae.nome AS enviado_por_admin, p.descricao, p.imagem_url, p.categoria_id
    FROM comanda_itens ci
    LEFT JOIN produtos p
      ON p.id = ci.produto_id
      AND p.id_estabelecimento = ci.id_estabelecimento
    LEFT JOIN funcionarios fe
      ON fe.id = ci.enviado_por_funcionario_id
      AND fe.id_estabelecimento = ci.id_estabelecimento
    LEFT JOIN administradores ae
      ON ae.id = ci.enviado_por_admin_id
      AND ae.id_estabelecimento = ci.id_estabelecimento
    WHERE ci.id_estabelecimento = ? AND ci.comanda_id IN (${marcadores})
    ORDER BY ci.id
  `, [idEstabelecimento, ...ids]);
  const adicionais = await listarAdicionaisDeItens(
    banco,
    idEstabelecimento,
    'comanda_item_adicionais',
    'comanda_item_id',
    itens.map((item) => Number(item.id))
  );
  const itensPorComanda = new Map();
  for (const item of itens) {
    const comandaId = Number(item.comanda_id);
    if (!itensPorComanda.has(comandaId)) itensPorComanda.set(comandaId, []);
    itensPorComanda.get(comandaId).push({
      id: item.produto_id ? Number(item.produto_id) : null,
      linhaId: String(item.id),
      nome: item.nome_produto,
      descricao: item.descricao ?? '',
      imagem: item.imagem_url,
      preco: Number(item.preco_unitario_centavos) / 100,
      quantidade: Number(item.quantidade),
      adicionais: adicionais.get(Number(item.id)) ?? [],
      observacao: item.observacao ?? '',
      lancadoEm: horaPtBr(item.criado_em),
      enviado: Boolean(item.enviado_em),
      enviadoEm: item.enviado_em ? horaPtBr(item.enviado_em) : null,
      enviadoPor: item.enviado_por_admin
        ? { nome: item.enviado_por_admin, tipo: 'admin' }
        : (item.enviado_por_funcionario
          ? { nome: item.enviado_por_funcionario, tipo: 'funcionario' }
          : null)
    });
  }
  return comandas.map((comanda) => ({
    id: String(comanda.id),
    mesaId: Number(comanda.mesa_id),
    funcionarioId: comanda.funcionario_id == null ? null : String(comanda.funcionario_id),
    garcom: comanda.garcom ?? null,
    // Quem abriu a comanda continua registrado mesmo depois de um garçom
    // assumir o atendimento: é a autoria da abertura, não o responsável.
    abertaPor: comanda.aberta_por_admin
      ? { nome: comanda.aberta_por_admin, tipo: 'admin' }
      : (comanda.garcom ? { nome: comanda.garcom, tipo: 'funcionario' } : null),
    status: comanda.status,
    pagamento: comanda.pagamento ?? null,
    // Recado da mesa inteira; string vazia, e não null, para o campo do
    // formulário nascer controlado nas duas telas que o editam.
    observacao: comanda.observacao ?? '',
    abertaEm: horaPtBr(comanda.aberta_em),
    itens: itensPorComanda.get(Number(comanda.id)) ?? []
  }));
}

export async function listarPedidos(banco, idEstabelecimento, { id = null } = {}) {
  const parametros = [idEstabelecimento];
  let filtro = '';
  if (id) {
    filtro = 'AND p.id = ?';
    parametros.push(id);
  }
  const [pedidos] = await banco.execute(`
    SELECT p.id, p.origem, p.cliente, p.telefone, p.email, p.status, p.pagamento,
      p.rua, p.numero, p.bairro, p.area_entrega_id, p.complemento, p.referencia,
      p.taxa_entrega_centavos, p.total_centavos, p.comanda_id, p.mesa_id,
      p.funcionario_id, p.criado_em,
      m.numero AS mesa_numero, f.nome AS garcom,
      pg.id AS pagamento_id, pg.status AS pagamento_status,
      pg.pix_chave, pg.pix_beneficiario, pg.pix_copia_cola,
      pg.sem_troco, pg.troco_para_centavos, pg.pago_em,
      pg.confirmado_em, pg.estornado_em,
      confirmador.nome AS pagamento_confirmado_por,
      estornador.nome AS pagamento_estornado_por
    FROM pedidos p
    LEFT JOIN mesas m
      ON m.id = p.mesa_id AND m.id_estabelecimento = p.id_estabelecimento
    LEFT JOIN funcionarios f
      ON f.id = p.funcionario_id AND f.id_estabelecimento = p.id_estabelecimento
    LEFT JOIN pagamentos pg ON pg.id = (
      SELECT pg2.id FROM pagamentos pg2
      WHERE pg2.pedido_id = p.id AND pg2.id_estabelecimento = p.id_estabelecimento
      ORDER BY pg2.id DESC LIMIT 1
    )
    LEFT JOIN administradores confirmador
      ON confirmador.id = pg.confirmado_por
      AND confirmador.id_estabelecimento = p.id_estabelecimento
    LEFT JOIN administradores estornador
      ON estornador.id = pg.estornado_por
      AND estornador.id_estabelecimento = p.id_estabelecimento
    WHERE p.id_estabelecimento = ?
    ${filtro}
    ORDER BY p.criado_em DESC
    LIMIT 500
  `, parametros);
  if (pedidos.length === 0) return [];
  const ids = pedidos.map((pedido) => Number(pedido.id));
  const marcadores = ids.map(() => '?').join(', ');
  const [itens] = await banco.execute(`
    SELECT id, pedido_id, produto_id, promocao_id, nome_produto, descricao_produto,
      imagem_url, preco_unitario_centavos, quantidade, observacao
    FROM pedido_itens
    WHERE id_estabelecimento = ? AND pedido_id IN (${marcadores})
    ORDER BY id
  `, [idEstabelecimento, ...ids]);
  const adicionais = await listarAdicionaisDeItens(
    banco,
    idEstabelecimento,
    'pedido_item_adicionais',
    'pedido_item_id',
    itens.map((item) => Number(item.id))
  );
  const itensPorPedido = new Map();
  for (const item of itens) {
    const pedidoId = Number(item.pedido_id);
    if (!itensPorPedido.has(pedidoId)) itensPorPedido.set(pedidoId, []);
    itensPorPedido.get(pedidoId).push({
      id: item.produto_id ? Number(item.produto_id) : null,
      promocaoId: item.promocao_id ? Number(item.promocao_id) : null,
      nome: item.nome_produto,
      descricao: item.descricao_produto ?? '',
      imagem: item.imagem_url,
      quantidade: Number(item.quantidade),
      preco: Number(item.preco_unitario_centavos) / 100,
      adicionais: (adicionais.get(Number(item.id)) ?? []).map((adicional) => adicional.nome),
      observacao: item.observacao ?? ''
    });
  }
  return pedidos.map((pedido) => {
    const endereco = pedido.origem === 'delivery'
      ? `${pedido.rua}, ${pedido.numero} - ${pedido.bairro}${pedido.complemento ? `, ${pedido.complemento}` : ''}`
      : null;
    const origem = pedido.origem === 'delivery'
      ? 'Delivery'
      : pedido.origem === 'retirada'
        ? 'Retirada no balcão'
        : `Mesa ${pedido.mesa_numero}`;
    return {
      id: codigoPedido(pedido.id),
      cliente: pedido.cliente,
      telefone: pedido.telefone,
      email: pedido.email ?? '',
      origem,
      modalidade: pedido.origem,
      status: pedido.status,
      pagamento: pedido.pagamento,
      pagamentoStatus: normalizarStatusPagamento(pedido.pagamento_status, pedido.pagamento),
      pixChave: pedido.pix_chave ?? '',
      pixBeneficiario: pedido.pix_beneficiario ?? '',
      pixCopiaCola: pedido.pix_copia_cola ?? '',
      semTroco: pedido.sem_troco === null ? null : Boolean(pedido.sem_troco),
      trocoPara: pedido.troco_para_centavos === null ? null : Number(pedido.troco_para_centavos) / 100,
      pagamentoConfirmadoEm: dataIso(pedido.confirmado_em ?? pedido.pago_em),
      pagamentoConfirmadoPor: pedido.pagamento_confirmado_por ?? '',
      pagamentoEstornadoEm: dataIso(pedido.estornado_em),
      pagamentoEstornadoPor: pedido.pagamento_estornado_por ?? '',
      horario: horaPtBr(pedido.criado_em),
      criadoEm: dataIso(pedido.criado_em),
      endereco,
      referencia: pedido.referencia ?? '',
      itens: itensPorPedido.get(Number(pedido.id)) ?? [],
      taxaEntrega: Number(pedido.taxa_entrega_centavos) / 100,
      areaEntregaId: pedido.area_entrega_id ? Number(pedido.area_entrega_id) : null,
      total: Number(pedido.total_centavos) / 100,
      comandaId: pedido.comanda_id ? String(pedido.comanda_id) : null,
      mesaId: pedido.mesa_id ? Number(pedido.mesa_id) : null,
      funcionarioId: pedido.funcionario_id ? String(pedido.funcionario_id) : null,
      garcom: pedido.garcom ?? null
    };
  });
}

/*
  `canal` decide de qual cardápio o item pode sair: 'online' para o pedido do
  site e 'salao' para a comanda de mesa. Sem esse recorte, o cliente poderia
  pedir pela web um item que só existe no salão mandando o id na requisição.
*/
export async function buscarItensValidados(
  conexao,
  idEstabelecimento,
  itensRecebidos,
  { canal = null } = {}
) {
  const visibilidade = filtroCanal(canal, { aliasProduto: 'p', aliasCategoria: 'c' });
  if (!Array.isArray(itensRecebidos) || itensRecebidos.length === 0) {
    throw erroDominio('Adicione ao menos um produto ao pedido.');
  }
  if (itensRecebidos.length > MAX_LINHAS_PEDIDO) {
    throw erroDominio(`O pedido pode ter no máximo ${MAX_LINHAS_PEDIDO} itens diferentes.`);
  }

  const itens = [];
  let totalUnidades = 0;
  for (const item of itensRecebidos) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw erroDominio('Um item do pedido possui formato inválido.');
    }
    const produtoId = Number(item.produtoId ?? item.id);
    const promocaoId = item.promocaoId == null || item.promocaoId === ''
      ? null
      : Number(item.promocaoId);
    const quantidade = Number(item.quantidade);
    if (!Number.isInteger(produtoId)
        || (promocaoId !== null && (!Number.isInteger(promocaoId) || promocaoId <= 0))
        || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) {
      throw erroDominio('Um item do pedido possui produto ou quantidade inválida.');
    }
    totalUnidades += quantidade;
    if (totalUnidades > MAX_UNIDADES_PEDIDO) {
      throw erroDominio(`O pedido pode ter no máximo ${MAX_UNIDADES_PEDIDO} unidades.`);
    }
    const [produtos] = await conexao.execute(`
      SELECT p.id, p.nome, p.descricao, p.preco_centavos, p.imagem_url
      FROM produtos p
      INNER JOIN categorias c
        ON c.id = p.categoria_id
        AND c.id_estabelecimento = p.id_estabelecimento
      WHERE p.id = ? AND p.id_estabelecimento = ? AND p.ativo = 1 AND c.ativo = 1
        ${visibilidade.sql}
      FOR UPDATE
    `, [produtoId, idEstabelecimento, ...visibilidade.parametros]);
    const produto = produtos[0];
    if (!produto) throw erroDominio('Um produto do pedido não está mais disponível.', 409);

    let promocao = null;
    if (promocaoId !== null) {
      const [promocoes] = await conexao.execute(`
        SELECT id, produto_id, nome, descricao, preco_centavos, imagem_url,
          ativo, inicio_em, fim_em
        FROM promocoes
        WHERE id = ? AND produto_id = ? AND id_estabelecimento = ?
        FOR UPDATE
      `, [promocaoId, produtoId, idEstabelecimento]);
      promocao = promocoes[0];
      if (!promocao || !promocaoDisponivel(promocao)) {
        throw erroDominio('A promoção selecionada não está mais disponível.', 409);
      }
    }

    if (item.adicionais != null && !Array.isArray(item.adicionais)) {
      throw erroDominio('A lista de adicionais de um item é inválida.');
    }
    if ((item.adicionais?.length ?? 0) > MAX_ADICIONAIS_POR_ITEM) {
      throw erroDominio(`Cada item pode ter no máximo ${MAX_ADICIONAIS_POR_ITEM} adicionais.`);
    }
    const adicionaisIds = [...new Set((item.adicionais ?? []).map((adicional) => Number(adicional?.id ?? adicional)))]
      .filter((adicionalId) => Number.isInteger(adicionalId) && adicionalId > 0);
    let adicionais = [];
    if (adicionaisIds.length > 0) {
      const marcadores = adicionaisIds.map(() => '?').join(', ');
      const [linhas] = await conexao.execute(`
        SELECT a.id, a.nome, a.preco_centavos
        FROM adicionais a
        INNER JOIN produto_adicionais pa
          ON pa.adicional_id = a.id
          AND pa.id_estabelecimento = a.id_estabelecimento
          AND pa.produto_id = ?
        WHERE a.id_estabelecimento = ? AND a.id IN (${marcadores}) AND a.ativo = 1
        FOR UPDATE
      `, [produtoId, idEstabelecimento, ...adicionaisIds]);
      if (linhas.length !== adicionaisIds.length) throw erroDominio('Um adicional não está disponível para o produto.', 409);
      adicionais = linhas.map((linha) => ({
        id: Number(linha.id),
        nome: linha.nome,
        precoCentavos: Number(linha.preco_centavos)
      }));
    }
    const precoCentavos = Number(promocao?.preco_centavos ?? produto.preco_centavos)
      + adicionais.reduce((total, adicional) => total + adicional.precoCentavos, 0);
    itens.push({
      produtoId,
      promocaoId,
      nome: promocao?.nome ?? produto.nome,
      descricao: promocao?.descricao ?? produto.descricao,
      imagem: promocao?.imagem_url || produto.imagem_url,
      precoCentavos,
      quantidade,
      observacao: texto(item.observacao, 1000) || null,
      adicionais
    });
  }
  return itens;
}

export async function revalidarCarrinho(banco, idEstabelecimento, itensRecebidos) {
  if (!Array.isArray(itensRecebidos)) throw erroDominio('O carrinho informado é inválido.');
  if (itensRecebidos.length > MAX_LINHAS_PEDIDO) {
    throw erroDominio(`O carrinho pode ter no máximo ${MAX_LINHAS_PEDIDO} itens diferentes.`);
  }

  const itens = [];
  const alteracoes = [];
  for (const [indice, recebido] of itensRecebidos.entries()) {
    if (!recebido || typeof recebido !== 'object' || Array.isArray(recebido)) {
      alteracoes.push({ tipo: 'removido', mensagem: `O item ${indice + 1} tinha formato inválido e foi removido.` });
      continue;
    }
    const produtoId = Number(recebido.produtoId ?? recebido.id);
    const quantidade = Number(recebido.quantidade);
    const carrinhoId = texto(recebido.carrinhoId, 160) || `produto-${produtoId}-${indice}`;
    if (!Number.isInteger(produtoId) || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) {
      alteracoes.push({ carrinhoId, tipo: 'removido', mensagem: 'Um item inválido foi removido do carrinho.' });
      continue;
    }

    const [produtos] = await banco.execute(`
      SELECT p.id, p.nome, p.descricao, p.preco_centavos, p.imagem_url,
        c.nome AS categoria
      FROM produtos p
      INNER JOIN categorias c
        ON c.id = p.categoria_id
        AND c.id_estabelecimento = p.id_estabelecimento
      WHERE p.id = ? AND p.id_estabelecimento = ? AND p.ativo = 1 AND c.ativo = 1
        ${VISIBILIDADE_ONLINE.sql}
    `, [produtoId, idEstabelecimento, ...VISIBILIDADE_ONLINE.parametros]);
    const produto = produtos[0];
    if (!produto) {
      alteracoes.push({ carrinhoId, tipo: 'removido', mensagem: `${texto(recebido.nome, 160) || 'Um produto'} não está mais disponível e foi removido.` });
      continue;
    }

    let promocao = null;
    const promocaoIdRecebida = Number(recebido.promocaoId) || null;
    if (promocaoIdRecebida) {
      const [promocoes] = await banco.execute(`
        SELECT id, produto_id, nome, descricao, preco_centavos, imagem_url,
          ativo, inicio_em, fim_em
        FROM promocoes
        WHERE id = ? AND produto_id = ? AND id_estabelecimento = ?
      `, [promocaoIdRecebida, produtoId, idEstabelecimento]);
      promocao = promocoes[0];
      if (!promocaoDisponivel(promocao)) {
        promocao = null;
        alteracoes.push({ carrinhoId, tipo: 'atualizado', mensagem: `A promoção de ${produto.nome} terminou; o preço normal foi aplicado.` });
      }
    }

    const idsRecebidos = [...new Set((Array.isArray(recebido.adicionais) ? recebido.adicionais : [])
      .map((adicional) => Number(adicional?.id ?? adicional))
      .filter((id) => Number.isInteger(id) && id > 0))];
    let adicionais = [];
    if (idsRecebidos.length > 0) {
      const marcadores = idsRecebidos.map(() => '?').join(', ');
      const [linhas] = await banco.execute(`
        SELECT a.id, a.nome, a.preco_centavos
        FROM adicionais a
        INNER JOIN produto_adicionais pa
          ON pa.adicional_id = a.id
          AND pa.id_estabelecimento = a.id_estabelecimento
          AND pa.produto_id = ?
        WHERE a.id_estabelecimento = ? AND a.id IN (${marcadores}) AND a.ativo = 1
        ORDER BY a.nome
      `, [produtoId, idEstabelecimento, ...idsRecebidos]);
      adicionais = linhas.map((linha) => ({
        id: Number(linha.id),
        nome: linha.nome,
        preco: Number(linha.preco_centavos) / 100
      }));
      if (adicionais.length !== idsRecebidos.length) {
        alteracoes.push({ carrinhoId, tipo: 'atualizado', mensagem: `Adicionais indisponíveis de ${produto.nome} foram removidos.` });
      }
    }

    const precoBaseCentavos = Number(promocao?.preco_centavos ?? produto.preco_centavos);
    const precoFinal = (precoBaseCentavos + adicionais.reduce((total, adicional) => total + Math.round(adicional.preco * 100), 0)) / 100;
    const precoAnterior = Number(recebido.precoFinal ?? String(recebido.preco ?? '').replace(',', '.'));
    if (Number.isFinite(precoAnterior) && Math.abs(precoAnterior - precoFinal) >= 0.005) {
      alteracoes.push({ carrinhoId, tipo: 'atualizado', mensagem: `O preço de ${produto.nome} foi atualizado para R$ ${precoFinal.toFixed(2).replace('.', ',')}.` });
    }

    itens.push({
      id: produtoId,
      produtoId,
      promocaoId: promocao ? Number(promocao.id) : null,
      carrinhoId,
      nome: promocao?.nome ?? produto.nome,
      categoria: produto.categoria,
      descricao: promocao?.descricao ?? produto.descricao,
      imagem: promocao?.imagem_url || produto.imagem_url || null,
      preco: formatarPreco(precoBaseCentavos),
      precoFinal,
      quantidade,
      observacao: texto(recebido.observacao, 1000),
      adicionais
    });
  }
  return { itens, alteracoes };
}

async function inserirItensPedido(conexao, idEstabelecimento, pedidoId, itens) {
  for (const item of itens) {
    const [resultado] = await conexao.execute(`
      INSERT INTO pedido_itens
        (id_estabelecimento, pedido_id, produto_id, promocao_id, nome_produto, descricao_produto, imagem_url,
         preco_unitario_centavos, quantidade, observacao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      idEstabelecimento,
      pedidoId, item.produtoId, item.promocaoId, item.nome, item.descricao, item.imagem,
      item.precoCentavos, item.quantidade, item.observacao
    ]);
    for (const adicional of item.adicionais) {
      await conexao.execute(`
        INSERT INTO pedido_item_adicionais
          (id_estabelecimento, pedido_item_id, adicional_id, nome_adicional, preco_centavos)
        VALUES (?, ?, ?, ?, ?)
      `, [idEstabelecimento, resultado.insertId, adicional.id, adicional.nome, adicional.precoCentavos]);
    }
  }
}

export function calcularTotaisPedido(itens, taxaEntregaCentavos) {
  const subtotalCentavos = itens.reduce(
    (total, item) => total + Number(item.precoCentavos) * Number(item.quantidade),
    0
  );
  const totalCentavos = subtotalCentavos + Number(taxaEntregaCentavos);
  if (!Number.isSafeInteger(subtotalCentavos) || !Number.isSafeInteger(totalCentavos)
      || subtotalCentavos < 0 || totalCentavos < 0 || totalCentavos > MAX_TOTAL_CENTAVOS) {
    throw erroDominio('O valor total do pedido excede o limite permitido.');
  }
  return {
    subtotalCentavos,
    totalCentavos
  };
}

export async function criarPedidoDelivery(banco, idEstabelecimento, dados) {
  const nome = texto(dados.nome, 160);
  const telefone = texto(dados.telefone, 40);
  // O e-mail do cliente não é mais pedido: mesmo enviado, é ignorado.
  const rua = texto(dados.rua, 180);
  const numero = texto(dados.numero, 30);
  const bairro = texto(dados.bairro, 120);
  const pagamento = texto(dados.pagamento, 40);
  const modalidade = texto(dados.modalidade, 20);
  const chaveIdempotencia = texto(dados.chaveIdempotencia, 100);
  const retirada = modalidade === 'retirada';
  // Só o id da área é aceito do navegador; taxa e total vêm sempre do banco.
  const areaEntregaInformada = !retirada
    && dados.areaEntregaId !== undefined && dados.areaEntregaId !== null && dados.areaEntregaId !== '';
  const areaEntregaId = areaEntregaInformada
    && (typeof dados.areaEntregaId === 'number' || /^\d{1,19}$/.test(String(dados.areaEntregaId)))
    ? Number(dados.areaEntregaId)
    : null;
  if (areaEntregaInformada && !(Number.isSafeInteger(areaEntregaId) && areaEntregaId > 0)) {
    throw erroDominio('Selecione uma área de entrega válida.');
  }
  if (!nome || !telefone || (!retirada && (!rua || !numero || (!bairro && !areaEntregaInformada)))) {
    throw erroDominio(retirada
      ? 'Preencha os dados essenciais do cliente.'
      : 'Preencha os dados do cliente e o endereço de entrega.');
  }
  if (!/^\d{10,11}$/.test(telefone.replace(/\D/g, ''))) throw erroDominio('Informe um telefone válido com DDD.');
  if (!['delivery', 'retirada'].includes(modalidade)) throw erroDominio('A modalidade de atendimento informada não está disponível.');
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(chaveIdempotencia)) {
    throw erroDominio('Não foi possível identificar esta tentativa de pedido. Atualize a página e tente novamente.');
  }
  const pagamentosPermitidos = retirada ? PAGAMENTOS_RETIRADA : PAGAMENTOS_DELIVERY;
  if (!pagamentosPermitidos.has(pagamento)) throw erroDominio('Selecione uma forma de pagamento válida.');

  const informouSemTroco = dados.semTroco !== undefined && dados.semTroco !== null;
  const informouTrocoPara = dados.trocoPara !== undefined && dados.trocoPara !== null && dados.trocoPara !== '';
  let semTroco = null;
  let trocoParaCentavos = null;
  if (pagamento === 'Dinheiro') {
    semTroco = dados.semTroco === true;
    if (semTroco === informouTrocoPara) {
      throw erroDominio('Para pagamento em dinheiro, escolha sem troco ou informe o valor entregue.');
    }
    if (informouTrocoPara) {
      trocoParaCentavos = precoParaCentavos(dados.trocoPara);
      if (!Number.isInteger(trocoParaCentavos) || trocoParaCentavos <= 0) {
        throw erroDominio('Informe um valor válido para o troco.');
      }
    }
  } else if (informouSemTroco || informouTrocoPara) {
    throw erroDominio('As opções de troco só podem ser usadas no pagamento em dinheiro.');
  }

  const hashIdempotencia = criarHashToken(chaveIdempotencia);
  const [pedidosExistentes] = await banco.execute(
    'SELECT id FROM pedidos WHERE chave_idempotencia_hash = ? AND id_estabelecimento = ?',
    [hashIdempotencia, idEstabelecimento]
  );
  if (pedidosExistentes[0]) {
    const [pedidoExistente] = await listarPedidos(
      banco,
      idEstabelecimento,
      { id: Number(pedidosExistentes[0].id) }
    );
    return { ...pedidoExistente, tokenAcompanhamento: chaveIdempotencia };
  }

  let pedidoId;
  try {
    pedidoId = await executarTransacao(banco, async (conexao) => {
      const [configuracoes] = await conexao.execute(`
        SELECT loja_aberta, funcionamento_automatico, horarios_json,
          entrega_ativa, retirada_ativa, aceita_cartao,
          aceita_dinheiro, pix_chave, pix_beneficiario, pix_cidade,
          taxa_entrega_centavos
        FROM configuracoes_estabelecimento
        WHERE id_estabelecimento = ?
        FOR UPDATE
      `, [idEstabelecimento]);
      const configuracao = configuracoes[0];
      /* O navegador só decide o que exibir: quem aceita ou recusa o pedido
        fora do horário é o servidor. */
      const lojaAberta = configuracao?.funcionamento_automatico
        ? estaAbertoNoHorario(configuracao.horarios_json)
        : Boolean(configuracao?.loja_aberta);
      if (!lojaAberta) throw erroDominio('A loja está fechada no momento.', 409);
      if (!retirada && !configuracao.entrega_ativa) throw erroDominio('A entrega está indisponível no momento.', 409);
      if (retirada && !configuracao.retirada_ativa) throw erroDominio('A retirada no balcão está indisponível no momento.', 409);
      if (pagamento === 'Pix' && (!texto(configuracao.pix_chave, 180)
          || !texto(configuracao.pix_beneficiario, 160) || !texto(configuracao.pix_cidade, 60))) {
        throw erroDominio('O pagamento por Pix não está disponível no momento.', 409);
      }
      if (['Cartão na entrega', 'Cartão na retirada'].includes(pagamento) && !configuracao.aceita_cartao) {
        throw erroDominio('O pagamento com cartão está indisponível.', 409);
      }
      if (pagamento === 'Dinheiro' && !configuracao.aceita_dinheiro) {
        throw erroDominio('O pagamento em dinheiro está indisponível.', 409);
      }

      const itens = await buscarItensValidados(
        conexao,
        idEstabelecimento,
        dados.itens,
        { canal: 'online' }
      );
      let areaEntrega = null;
      let taxaEntrega = 0;
      if (!retirada) {
        const [[cadastro]] = await conexao.execute(`
          SELECT COUNT(id) AS total, COALESCE(SUM(ativo), 0) AS ativas
          FROM areas_entrega
          WHERE id_estabelecimento = ?
        `, [idEstabelecimento]);
        if (Number(cadastro.total) === 0) {
          // Loja sem áreas cadastradas: taxa única, exatamente como antes.
          if (!bairro) throw erroDominio('Preencha os dados do cliente e o endereço de entrega.');
          taxaEntrega = Number(configuracao.taxa_entrega_centavos);
        } else {
          if (Number(cadastro.ativas) === 0) throw erroDominio('Nenhuma área de entrega disponível.', 409);
          /* Pelo id escolhido no checkout ou, para quem ainda envia só o texto,
            pelo nome (a collation ignora maiúsculas e acentos). A linha fica
            travada até o pedido gravar, para a área não sumir no meio. */
          const [areas] = await conexao.execute(`
            SELECT id, nome, taxa_entrega_centavos
            FROM areas_entrega
            WHERE id_estabelecimento = ? AND ativo = 1 AND ${areaEntregaInformada ? 'id = ?' : 'nome = ?'}
            LIMIT 1
            FOR UPDATE
          `, [idEstabelecimento, areaEntregaInformada ? areaEntregaId : bairro]);
          areaEntrega = areas[0] ?? null;
          if (!areaEntrega) {
            throw erroDominio(areaEntregaInformada
              ? 'A área de entrega escolhida não está disponível. Selecione outra área.'
              : 'O bairro informado está fora da área de entrega.', 409);
          }
          taxaEntrega = Number(areaEntrega.taxa_entrega_centavos);
        }
      }
      const { totalCentavos } = calcularTotaisPedido(itens, taxaEntrega);
      if (trocoParaCentavos !== null && trocoParaCentavos < totalCentavos) {
        throw erroDominio('O valor entregue em dinheiro não pode ser menor que o total do pedido.', 409);
      }

      const statusPagamento = pagamento === 'Pix'
        ? PAGAMENTO_AGUARDANDO
        : retirada ? 'Pagamento na retirada' : PAGAMENTO_ENTREGA;
      const [resultado] = await conexao.execute(`
        INSERT INTO pedidos
          (id_estabelecimento, token_acompanhamento_hash, chave_idempotencia_hash,
           origem, cliente, telefone, status, pagamento,
           rua, numero, bairro, area_entrega_id, complemento, referencia,
           taxa_entrega_centavos, total_centavos)
        VALUES (?, ?, ?, ?, ?, ?, 'Recebido', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        idEstabelecimento,
        hashIdempotencia, hashIdempotencia, modalidade, nome, telefone, pagamento,
        retirada ? null : rua, retirada ? null : numero, retirada ? null : (areaEntrega?.nome ?? bairro),
        areaEntrega ? Number(areaEntrega.id) : null,
        retirada ? null : (texto(dados.complemento, 160) || null),
        texto(dados.referencia, 255) || null, taxaEntrega, totalCentavos
      ]);
      await inserirItensPedido(conexao, idEstabelecimento, resultado.insertId, itens);
      /* Fila de impressão na mesma transação: ou o pedido e as comandas da
        cozinha gravam juntos, ou nada grava. Produto sem impressora
        configurada não entra na fila e não atrapalha o pedido. */
      await gerarTrabalhosImpressao(conexao, idEstabelecimento, {
        origem: 'delivery',
        pedidoId: Number(resultado.insertId),
        itens,
        /* O recibo da cozinha/bar não leva forma de pagamento: quem monta o
          prato não cobra. O dado continua em `pedidos`/`pagamentos`, para o
          caixa e os relatórios. */
        contexto: {
          pedido: codigoPedido(Number(resultado.insertId)),
          modalidade: retirada ? 'Retirada no balcão' : 'Entrega',
          cliente: nome,
          telefone,
          endereco: retirada
            ? null
            : [
                `${rua}, ${numero}`,
                texto(dados.complemento, 160) || null,
                areaEntrega?.nome ?? bairro
              ].filter(Boolean).join(' - ')
        }
      });
      const pixCopiaCola = pagamento === 'Pix'
        ? gerarPixCopiaCola({
            chave: configuracao.pix_chave,
            beneficiario: configuracao.pix_beneficiario,
            cidade: configuracao.pix_cidade,
            valorCentavos: totalCentavos,
            txid: `PED${resultado.insertId}`
          })
        : null;
      await conexao.execute(`
        INSERT INTO pagamentos
          (id_estabelecimento, pedido_id, forma, status, valor_centavos, pix_chave, pix_beneficiario,
           sem_troco, troco_para_centavos, pix_copia_cola)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        idEstabelecimento,
        resultado.insertId,
        pagamento,
        statusPagamento,
        totalCentavos,
        pagamento === 'Pix' ? configuracao.pix_chave : null,
        pagamento === 'Pix' ? configuracao.pix_beneficiario : null,
        pagamento === 'Dinheiro' ? (semTroco ? 1 : 0) : null,
        pagamento === 'Dinheiro' ? trocoParaCentavos : null,
        pixCopiaCola
      ]);
      return Number(resultado.insertId);
    });
  } catch (erro) {
    if (erro.code !== 'ER_DUP_ENTRY') throw erro;
    const [existentes] = await banco.execute(
      'SELECT id FROM pedidos WHERE chave_idempotencia_hash = ? AND id_estabelecimento = ?',
      [hashIdempotencia, idEstabelecimento]
    );
    if (!existentes[0]) throw erro;
    pedidoId = Number(existentes[0].id);
  }

  const [pedido] = await listarPedidos(banco, idEstabelecimento, { id: pedidoId });
  return { ...pedido, tokenAcompanhamento: chaveIdempotencia };
}

export async function acompanharPedido(banco, idEstabelecimento, codigo, token) {
  const id = idPedidoPeloCodigo(codigo);
  if (!id || !token) return null;
  const [linhas] = await banco.execute(`
    SELECT id FROM pedidos
    WHERE id = ? AND id_estabelecimento = ?
      AND origem IN ('delivery', 'retirada') AND token_acompanhamento_hash = ?
  `, [id, idEstabelecimento, criarHashToken(token)]);
  if (!linhas[0]) return null;
  const [pedido] = await listarPedidos(banco, idEstabelecimento, { id });
  return { ...pedido, tokenAcompanhamento: token };
}

export async function atualizarStatusPedido(
  banco,
  idEstabelecimento,
  codigo,
  status,
  administradorId = null
) {
  const id = idPedidoPeloCodigo(codigo);
  if (!id) return null;
  const atualizado = await executarTransacao(banco, async (conexao) => {
    const [linhas] = await conexao.execute(`
      SELECT origem, status FROM pedidos
      WHERE id = ? AND id_estabelecimento = ? FOR UPDATE
    `, [id, idEstabelecimento]);
    if (!linhas[0]) return false;
    const permitidos = linhas[0].origem === 'delivery'
      ? STATUS_DELIVERY
      : linhas[0].origem === 'retirada' ? STATUS_RETIRADA : STATUS_MESA;
    if (!permitidos.has(status)) throw erroDominio('Status inválido para a origem deste pedido.');
    if (STATUS_TERMINAIS.has(linhas[0].status) && status !== linhas[0].status) {
      throw erroDominio('Um pedido concluído ou cancelado não pode voltar para outra etapa.', 409);
    }
    if (status === linhas[0].status) return true;
    await conexao.execute(`
      UPDATE pedidos SET status = ? WHERE id = ? AND id_estabelecimento = ?
    `, [status, id, idEstabelecimento]);
    if (status === 'Cancelado') {
      const [pagamentos] = await conexao.execute(`
        SELECT id, forma, status, valor_centavos
        FROM pagamentos
        WHERE pedido_id = ? AND id_estabelecimento = ?
        ORDER BY id DESC LIMIT 1 FOR UPDATE
      `, [id, idEstabelecimento]);
      const pagamento = pagamentos[0];
      if (pagamento?.status === PAGAMENTO_PAGO) {
        await conexao.execute(`
          UPDATE pagamentos
          SET status = ?, estornado_por = ?, estornado_em = CURRENT_TIMESTAMP
          WHERE id = ? AND id_estabelecimento = ?
        `, [PAGAMENTO_ESTORNADO, administradorId, pagamento.id, idEstabelecimento]);
      } else if (pagamento && ![PAGAMENTO_CANCELADO, PAGAMENTO_ESTORNADO].includes(pagamento.status)) {
        await conexao.execute(`
          UPDATE pagamentos SET status = ? WHERE id = ? AND id_estabelecimento = ?
        `, [PAGAMENTO_CANCELADO, pagamento.id, idEstabelecimento]);
      }
    }
    await registrarAuditoria(conexao, idEstabelecimento, administradorId, status === 'Cancelado' ? 'pedido.cancelado' : 'pedido.status_alterado', 'pedido', id, {
      statusAnterior: linhas[0].status,
      statusNovo: status
    });
    return true;
  });
  if (!atualizado) return null;
  const [pedido] = await listarPedidos(banco, idEstabelecimento, { id });
  return pedido;
}

export async function confirmarPagamento(banco, idEstabelecimento, codigo, administradorId) {
  const id = idPedidoPeloCodigo(codigo);
  if (!id) return null;
  await executarTransacao(banco, async (conexao) => {
    const [pedidos] = await conexao.execute(`
      SELECT id, status FROM pedidos
      WHERE id = ? AND id_estabelecimento = ? FOR UPDATE
    `, [id, idEstabelecimento]);
    if (!pedidos[0]) throw erroDominio('Pedido não encontrado.', 404);
    if (pedidos[0].status === 'Cancelado') throw erroDominio('Não é possível confirmar o pagamento de um pedido cancelado.', 409);
    const [pagamentos] = await conexao.execute(`
      SELECT id, forma, status, valor_centavos
      FROM pagamentos
      WHERE pedido_id = ? AND id_estabelecimento = ?
      ORDER BY id DESC LIMIT 1 FOR UPDATE
    `, [id, idEstabelecimento]);
    const pagamento = pagamentos[0];
    if (!pagamento) throw erroDominio('O pagamento deste pedido não foi encontrado.', 404);
    if (pagamento.status === PAGAMENTO_PAGO) return;
    if ([PAGAMENTO_CANCELADO, PAGAMENTO_ESTORNADO].includes(pagamento.status)) {
      throw erroDominio('Este pagamento não pode mais ser confirmado.', 409);
    }
    await conexao.execute(`
      UPDATE pagamentos
      SET status = ?, pago_em = CURRENT_TIMESTAMP, confirmado_por = ?, confirmado_em = CURRENT_TIMESTAMP,
          estornado_por = NULL, estornado_em = NULL
      WHERE id = ? AND id_estabelecimento = ?
    `, [PAGAMENTO_PAGO, administradorId, pagamento.id, idEstabelecimento]);
    await registrarAuditoria(conexao, idEstabelecimento, administradorId, 'pagamento.confirmado', 'pedido', id, {
      forma: pagamento.forma,
      valorCentavos: Number(pagamento.valor_centavos)
    });
  });
  const [pedido] = await listarPedidos(banco, idEstabelecimento, { id });
  return pedido;
}

export async function estornarPagamento(banco, idEstabelecimento, codigo, administradorId) {
  const id = idPedidoPeloCodigo(codigo);
  if (!id) return null;
  await executarTransacao(banco, async (conexao) => {
    const [pedidos] = await conexao.execute(`
      SELECT id FROM pedidos WHERE id = ? AND id_estabelecimento = ? FOR UPDATE
    `, [id, idEstabelecimento]);
    if (!pedidos[0]) throw erroDominio('Pedido não encontrado.', 404);
    const [pagamentos] = await conexao.execute(`
      SELECT id, forma, status, valor_centavos
      FROM pagamentos
      WHERE pedido_id = ? AND id_estabelecimento = ?
      ORDER BY id DESC LIMIT 1 FOR UPDATE
    `, [id, idEstabelecimento]);
    const pagamento = pagamentos[0];
    if (!pagamento) throw erroDominio('O pagamento deste pedido não foi encontrado.', 404);
    if (pagamento.status === PAGAMENTO_ESTORNADO) return;
    if (pagamento.status !== PAGAMENTO_PAGO) throw erroDominio('Somente pagamentos pagos podem ser estornados.', 409);
    await conexao.execute(`
      UPDATE pagamentos SET status = ?, estornado_por = ?, estornado_em = CURRENT_TIMESTAMP
      WHERE id = ? AND id_estabelecimento = ?
    `, [PAGAMENTO_ESTORNADO, administradorId, pagamento.id, idEstabelecimento]);
    await registrarAuditoria(conexao, idEstabelecimento, administradorId, 'pagamento.estornado', 'pedido', id, {
      forma: pagamento.forma,
      valorCentavos: Number(pagamento.valor_centavos)
    });
  });
  const [pedido] = await listarPedidos(banco, idEstabelecimento, { id });
  return pedido;
}

function mapearAdministrador(linha) {
  return {
    id: Number(linha.id),
    usuario: linha.usuario,
    email: linha.email,
    nome: linha.nome,
    ativo: Boolean(linha.ativo),
    criadoEm: dataIso(linha.criado_em)
  };
}

export async function listarAdministradores(banco, idEstabelecimento) {
  const [linhas] = await banco.execute(`
    SELECT id, usuario, email, nome, ativo, criado_em
    FROM administradores
    WHERE id_estabelecimento = ?
    ORDER BY nome
  `, [idEstabelecimento]);
  return linhas.map(mapearAdministrador);
}

/* Lista do painel do estabelecimento, com as permissões e a marca de arquivada
   de cada conta. O superadministrador continua usando listarAdministradores. */
export async function listarAdministradoresComPermissoes(banco, idEstabelecimento) {
  const [[linhas], [linhasPermissoes]] = await Promise.all([
    banco.execute(`
      SELECT id, usuario, email, nome, ativo, criado_em, arquivado_em
      FROM administradores
      WHERE id_estabelecimento = ?
      ORDER BY nome
    `, [idEstabelecimento]),
    banco.execute(`
      SELECT administrador_id, permissao
      FROM administrador_permissoes
      WHERE id_estabelecimento = ?
    `, [idEstabelecimento])
  ]);
  const permissoesPorAdministrador = new Map();
  for (const linha of linhasPermissoes) {
    const id = Number(linha.administrador_id);
    if (!permissoesPorAdministrador.has(id)) permissoesPorAdministrador.set(id, []);
    permissoesPorAdministrador.get(id).push(linha.permissao);
  }
  return linhas.map((linha) => ({
    ...mapearAdministrador(linha),
    arquivado: Boolean(linha.arquivado_em),
    arquivadoEm: dataIso(linha.arquivado_em),
    permissoes: normalizarPermissoes(permissoesPorAdministrador.get(Number(linha.id)) ?? [])
  }));
}

export async function criarAdministrador(banco, idEstabelecimento, dados, administradorId) {
  const usuario = texto(dados.usuario, 80);
  const email = texto(dados.email, 160).toLowerCase();
  const nome = texto(dados.nome, 160);
  const senha = String(dados.senha ?? '');
  const confirmacao = String(dados.confirmacaoSenha ?? '');
  if (!usuario || !nome || !/^\S+@\S+\.\S+$/.test(email)) throw erroDominio('Informe nome, usuário e e-mail válidos.');
  if (senha.length < 10) throw erroDominio('A senha deve ter pelo menos 10 caracteres.');
  if (senha !== confirmacao) throw erroDominio('A confirmação da senha não confere.');
  const id = await executarTransacao(banco, async (conexao) => {
    const [resultado] = await conexao.execute(`
      INSERT INTO administradores
        (id_estabelecimento, usuario, email, nome, senha_hash, ativo)
      VALUES (?, ?, ?, ?, ?, 1)
    `, [idEstabelecimento, usuario, email, nome, criarHashSenha(senha)]);
    await concederPermissoesPadrao(conexao, idEstabelecimento, resultado.insertId);
    await registrarAuditoria(conexao, idEstabelecimento, administradorId, 'administrador.criado', 'administrador', resultado.insertId, { usuario, email });
    return Number(resultado.insertId);
  });
  const [linhas] = await banco.execute(`
    SELECT id, usuario, email, nome, ativo, criado_em
    FROM administradores
    WHERE id = ? AND id_estabelecimento = ?
  `, [id, idEstabelecimento]);
  return mapearAdministrador(linhas[0]);
}

export async function alternarStatusAdministrador(
  banco,
  idEstabelecimento,
  id,
  ativo,
  administradorId
) {
  const alvoId = Number(id);
  if (!Number.isInteger(alvoId) || alvoId <= 0) return null;
  if (!ativo && alvoId === Number(administradorId)) throw erroDominio('Você não pode desativar o próprio acesso.', 409);
  return executarTransacao(banco, async (conexao) => {
    const [alvos] = await conexao.execute(`
      SELECT id FROM administradores
      WHERE id = ? AND id_estabelecimento = ? AND arquivado_em IS NULL FOR UPDATE
    `, [alvoId, idEstabelecimento]);
    if (!alvos[0]) return null;
    if (!ativo) {
      const [[contagem]] = await conexao.execute(`
        SELECT COUNT(*) AS total FROM administradores
        WHERE id_estabelecimento = ? AND ativo = 1 FOR UPDATE
      `, [idEstabelecimento]);
      if (Number(contagem.total) <= 1) throw erroDominio('Mantenha ao menos um administrador ativo.', 409);
    }
    await conexao.execute(`
      UPDATE administradores SET ativo = ? WHERE id = ? AND id_estabelecimento = ?
    `, [ativo ? 1 : 0, alvoId, idEstabelecimento]);
    if (!ativo) {
      await conexao.execute(`
        DELETE FROM sessoes_admin
        WHERE administrador_id = ? AND id_estabelecimento = ?
      `, [alvoId, idEstabelecimento]);
    }
    await registrarAuditoria(conexao, idEstabelecimento, administradorId, ativo ? 'administrador.ativado' : 'administrador.desativado', 'administrador', alvoId);
    const [linhas] = await conexao.execute(`
      SELECT id, usuario, email, nome, ativo, criado_em
      FROM administradores
      WHERE id = ? AND id_estabelecimento = ?
    `, [alvoId, idEstabelecimento]);
    return mapearAdministrador(linhas[0]);
  });
}

/*
  Permissões de outro administrador do mesmo estabelecimento.

  - Ninguém altera as próprias permissões.
  - Só entram chaves do catálogo; qualquer outra coisa é ignorada.
  - Quem edita não concede o que não possui. As permissões que ele não possui
    ficam como estão no alvo: não dá para concedê-las nem retirá-las.

  Quem edita precisa de `funcionarios.gerenciar` e não edita a si mesmo, então
  a loja nunca fica sem ao menos um administrador capaz de gerenciar acessos.
*/
export async function salvarPermissoesAdministrador(banco, idEstabelecimento, id, dados, autor) {
  const alvoId = Number(id);
  if (!Number.isInteger(alvoId) || alvoId <= 0) return null;
  if (alvoId === Number(autor?.id)) {
    throw erroDominio('Você não pode alterar as próprias permissões.', 403);
  }
  if (!Array.isArray(dados?.permissoes)) throw erroDominio('Informe a lista de permissões.');
  const solicitadas = normalizarPermissoes(dados.permissoes);
  const doAutor = new Set(normalizarPermissoes(autor?.permissoes));

  return executarTransacao(banco, async (conexao) => {
    const [alvos] = await conexao.execute(`
      SELECT id FROM administradores
      WHERE id = ? AND id_estabelecimento = ? AND arquivado_em IS NULL FOR UPDATE
    `, [alvoId, idEstabelecimento]);
    if (!alvos[0]) return null;
    const [linhasAtuais] = await conexao.execute(`
      SELECT permissao FROM administrador_permissoes
      WHERE id_estabelecimento = ? AND administrador_id = ?
    `, [idEstabelecimento, alvoId]);
    const atuais = normalizarPermissoes(linhasAtuais.map((linha) => linha.permissao));
    if (solicitadas.some((permissao) => !doAutor.has(permissao) && !atuais.includes(permissao))) {
      throw erroDominio('Você não pode conceder permissões que não possui.', 403);
    }
    const finais = normalizarPermissoes([
      ...solicitadas.filter((permissao) => doAutor.has(permissao)),
      ...atuais.filter((permissao) => !doAutor.has(permissao))
    ]);
    const removidas = atuais.filter((permissao) => !finais.includes(permissao));
    const adicionadas = finais.filter((permissao) => !atuais.includes(permissao));
    if (removidas.length) {
      await conexao.execute(`
        DELETE FROM administrador_permissoes
        WHERE id_estabelecimento = ? AND administrador_id = ?
          AND permissao IN (${removidas.map(() => '?').join(', ')})
      `, [idEstabelecimento, alvoId, ...removidas]);
    }
    if (adicionadas.length) {
      await conexao.execute(`
        INSERT INTO administrador_permissoes (id_estabelecimento, administrador_id, permissao)
        VALUES ${adicionadas.map(() => '(?, ?, ?)').join(', ')}
      `, adicionadas.flatMap((permissao) => [idEstabelecimento, alvoId, permissao]));
    }
    if (removidas.length || adicionadas.length) {
      await registrarAuditoria(
        conexao,
        idEstabelecimento,
        autor.id,
        'administrador.permissoes_alteradas',
        'administrador',
        alvoId,
        { adicionadas, removidas }
      );
    }
    return { id: alvoId, permissoes: finais };
  });
}

/*
  Arquivar: a conta vai para "Arquivados" e perde acesso, sessões e
  permissões, mas a linha continua no banco para o histórico seguir mostrando
  quem fez cada ação. Usuário e e-mail continuam reservados para ela, então
  desarquivar sempre devolve a mesma conta.
*/
export async function arquivarAdministrador(banco, idEstabelecimento, id, autorId) {
  const alvoId = Number(id);
  if (!Number.isInteger(alvoId) || alvoId <= 0) return null;
  if (alvoId === Number(autorId)) throw erroDominio('Você não pode arquivar a própria conta.', 403);
  return executarTransacao(banco, async (conexao) => {
    const [alvos] = await conexao.execute(`
      SELECT id, usuario, email, nome
      FROM administradores
      WHERE id = ? AND id_estabelecimento = ? AND arquivado_em IS NULL
      FOR UPDATE
    `, [alvoId, idEstabelecimento]);
    const alvo = alvos[0];
    if (!alvo) return null;
    await conexao.execute(`
      UPDATE administradores
      SET ativo = 0, arquivado_em = CURRENT_TIMESTAMP
      WHERE id = ? AND id_estabelecimento = ?
    `, [alvoId, idEstabelecimento]);
    await conexao.execute(`
      DELETE FROM sessoes_admin
      WHERE administrador_id = ? AND id_estabelecimento = ?
    `, [alvoId, idEstabelecimento]);
    await conexao.execute(`
      DELETE FROM administrador_permissoes
      WHERE administrador_id = ? AND id_estabelecimento = ?
    `, [alvoId, idEstabelecimento]);
    await registrarAuditoria(conexao, idEstabelecimento, autorId, 'administrador.arquivado', 'administrador', alvoId, {
      usuario: alvo.usuario,
      email: alvo.email,
      nome: alvo.nome
    });
    return { id: alvoId, arquivado: true };
  });
}

/*
  Desarquivar: a conta volta para a lista desativada e sem nenhuma permissão.
  Quem gerencia acessos marca depois só as permissões que também possui e
  ativa a conta, então desarquivar nunca devolve acesso por conta própria.
*/
export async function desarquivarAdministrador(banco, idEstabelecimento, id, autorId) {
  const alvoId = Number(id);
  if (!Number.isInteger(alvoId) || alvoId <= 0) return null;
  return executarTransacao(banco, async (conexao) => {
    const [alvos] = await conexao.execute(`
      SELECT id, usuario, nome
      FROM administradores
      WHERE id = ? AND id_estabelecimento = ? AND arquivado_em IS NOT NULL
      FOR UPDATE
    `, [alvoId, idEstabelecimento]);
    const alvo = alvos[0];
    if (!alvo) return null;
    await conexao.execute(`
      UPDATE administradores
      SET arquivado_em = NULL, ativo = 0
      WHERE id = ? AND id_estabelecimento = ?
    `, [alvoId, idEstabelecimento]);
    await conexao.execute(`
      DELETE FROM administrador_permissoes
      WHERE administrador_id = ? AND id_estabelecimento = ?
    `, [alvoId, idEstabelecimento]);
    await registrarAuditoria(conexao, idEstabelecimento, autorId, 'administrador.desarquivado', 'administrador', alvoId, {
      usuario: alvo.usuario,
      nome: alvo.nome
    });
    return { id: alvoId, arquivado: false };
  });
}

/*
  Exclusão definitiva. As chaves estrangeiras apagam sessões e permissões e
  deixam vazio o autor nos registros antigos (auditoria, pagamentos, comandas).
  Não dá para desfazer; a auditoria guarda quem foi apagado e por quem.
*/
export async function excluirAdministrador(banco, idEstabelecimento, id, autorId) {
  const alvoId = Number(id);
  if (!Number.isInteger(alvoId) || alvoId <= 0) return null;
  if (alvoId === Number(autorId)) throw erroDominio('Você não pode apagar a própria conta.', 403);
  return executarTransacao(banco, async (conexao) => {
    const [alvos] = await conexao.execute(`
      SELECT id, usuario, email, nome, arquivado_em
      FROM administradores
      WHERE id = ? AND id_estabelecimento = ?
      FOR UPDATE
    `, [alvoId, idEstabelecimento]);
    const alvo = alvos[0];
    if (!alvo) return null;
    await conexao.execute(`
      DELETE FROM administradores
      WHERE id = ? AND id_estabelecimento = ?
    `, [alvoId, idEstabelecimento]);
    await registrarAuditoria(conexao, idEstabelecimento, autorId, 'administrador.excluido', 'administrador', alvoId, {
      usuario: alvo.usuario,
      email: alvo.email,
      nome: alvo.nome,
      estavaArquivado: Boolean(alvo.arquivado_em)
    });
    return { id: alvoId, excluido: true };
  });
}

export async function alterarSenhaAdministrador(
  banco,
  idEstabelecimento,
  administradorId,
  dados,
  tokenAtual
) {
  const senhaAtual = String(dados.senhaAtual ?? '');
  const novaSenha = String(dados.novaSenha ?? '');
  const confirmacao = String(dados.confirmacaoSenha ?? '');
  if (novaSenha.length < 10) throw erroDominio('A nova senha deve ter pelo menos 10 caracteres.');
  if (novaSenha !== confirmacao) throw erroDominio('A confirmação da nova senha não confere.');
  await executarTransacao(banco, async (conexao) => {
    const [linhas] = await conexao.execute(`
      SELECT senha_hash FROM administradores
      WHERE id = ? AND id_estabelecimento = ? FOR UPDATE
    `, [administradorId, idEstabelecimento]);
    if (!linhas[0] || !verificarSenha(senhaAtual, linhas[0].senha_hash)) throw erroDominio('A senha atual está incorreta.', 401);
    if (verificarSenha(novaSenha, linhas[0].senha_hash)) throw erroDominio('A nova senha deve ser diferente da senha atual.');
    await conexao.execute(`
      UPDATE administradores SET senha_hash = ?
      WHERE id = ? AND id_estabelecimento = ?
    `, [criarHashSenha(novaSenha), administradorId, idEstabelecimento]);
    await conexao.execute(`
      DELETE FROM sessoes_admin
      WHERE administrador_id = ? AND id_estabelecimento = ? AND token_hash <> ?
    `, [administradorId, idEstabelecimento, criarHashToken(tokenAtual)]);
    await registrarAuditoria(conexao, idEstabelecimento, administradorId, 'administrador.senha_alterada', 'administrador', administradorId);
  });
}

/* Ação de auditoria gravada a cada login bem-sucedido no painel administrativo.
  O histórico exibido na tela de acessos mostra somente esses registros. */
export const ACAO_LOGIN_ADMIN = 'administrador.login';

export async function registrarLoginAdmin(banco, idEstabelecimento, administradorId, usuario) {
  await registrarAuditoria(
    banco,
    idEstabelecimento,
    administradorId,
    ACAO_LOGIN_ADMIN,
    'administrador',
    administradorId,
    { usuario }
  );
}

export async function listarAuditoriaAdmin(banco, idEstabelecimento, { acao = null } = {}) {
  const [linhas] = await banco.execute(`
    SELECT au.id, au.acao, au.entidade, au.entidade_id, au.detalhes_json,
      au.criado_em, a.nome AS administrador_nome, a.usuario AS administrador_usuario
    FROM auditoria_admin au
    LEFT JOIN administradores a
      ON a.id = au.administrador_id
      AND a.id_estabelecimento = au.id_estabelecimento
    WHERE au.id_estabelecimento = ?
      ${acao ? 'AND au.acao = ?' : ''}
    ORDER BY au.criado_em DESC, au.id DESC
    LIMIT 100
  `, acao ? [idEstabelecimento, acao] : [idEstabelecimento]);
  return linhas.map((linha) => {
    const detalhes = typeof linha.detalhes_json === 'string'
      ? JSON.parse(linha.detalhes_json)
      : (linha.detalhes_json ?? null);
    return {
      id: Number(linha.id),
      // Conta apagada deixa o autor vazio: o usuário gravado no registro
      // separa esse caso de uma ação do próprio sistema.
      administrador: linha.administrador_nome ?? (detalhes?.usuario ? 'Conta apagada' : 'Sistema'),
      // O usuário gravado no momento da ação vale mais que o atual, que muda
      // quando a conta é arquivada.
      usuario: detalhes?.usuario ?? linha.administrador_usuario ?? '',
      acao: linha.acao,
      entidade: linha.entidade,
      entidadeId: linha.entidade_id ?? '',
      detalhes,
      criadoEm: dataIso(linha.criado_em)
    };
  });
}

async function obterComandaDoGarcom(
  conexao,
  idEstabelecimento,
  comandaId,
  funcionarioId,
  { bloquear = false } = {}
) {
  const [linhas] = await conexao.execute(`
    SELECT c.id, c.mesa_id, c.funcionario_id, c.status, c.pagamento,
      c.observacao, c.aberta_em, m.numero AS mesa_numero
    FROM comandas c
    INNER JOIN mesas m
      ON m.id = c.mesa_id
      AND m.id_estabelecimento = c.id_estabelecimento
    WHERE c.id = ? AND c.id_estabelecimento = ? ${bloquear ? 'FOR UPDATE' : ''}
  `, [comandaId, idEstabelecimento]);
  const comanda = linhas[0];
  if (!comanda) throw erroDominio('Comanda não encontrada.', 404);
  if (comanda.funcionario_id == null) {
    /* Comanda aberta no caixa e ainda sem garçom: o primeiro que atende
       assume o atendimento e passa a responder por ela. */
    await conexao.execute(`
      UPDATE comandas SET funcionario_id = ?
      WHERE id = ? AND id_estabelecimento = ? AND funcionario_id IS NULL
    `, [funcionarioId, comandaId, idEstabelecimento]);
    comanda.funcionario_id = funcionarioId;
  }
  /* Comanda de outro garçom não bloqueia: quem estiver perto da mesa atende.
     O responsável registrado continua sendo quem abriu, e cada item guarda
     em `enviado_por_funcionario_id` quem de fato o lançou. */
  if (COMANDAS_FECHADAS.has(comanda.status)) {
    throw erroDominio('Esta comanda já foi encerrada.', 409);
  }
  return comanda;
}

/*
  Versão administrativa da busca acima: o painel responde pelo caixa e pode
  agir na comanda de qualquer funcionário do próprio estabelecimento, mas o
  tenant continua vindo da sessão e nunca do navegador.
*/
async function obterComandaAtiva(conexao, idEstabelecimento, comandaId) {
  const [linhas] = await conexao.execute(`
    SELECT c.id, c.mesa_id, c.funcionario_id, c.status, c.pagamento,
      c.observacao, m.numero AS mesa_numero
    FROM comandas c
    INNER JOIN mesas m
      ON m.id = c.mesa_id
      AND m.id_estabelecimento = c.id_estabelecimento
    WHERE c.id = ? AND c.id_estabelecimento = ? FOR UPDATE
  `, [comandaId, idEstabelecimento]);
  const comanda = linhas[0];
  if (!comanda) throw erroDominio('Comanda não encontrada.', 404);
  if (COMANDAS_FECHADAS.has(comanda.status)) {
    throw erroDominio('Esta comanda já foi encerrada.', 409);
  }
  return comanda;
}

/*
  O status da comanda passa a ser derivado do que ainda não foi lançado:
  enquanto existir item pendente a mesa volta para "Aberta"; quando tudo já
  foi para a cozinha ela retoma "Na cozinha". Um pedido de conta já
  registrado nunca é desfeito por aqui.
*/
async function sincronizarStatusComanda(conexao, idEstabelecimento, comandaId, statusAtual) {
  const [[totais]] = await conexao.execute(`
    SELECT COUNT(*) AS linhas,
      COALESCE(SUM(CASE WHEN enviado_em IS NULL THEN 1 ELSE 0 END), 0) AS pendentes
    FROM comanda_itens
    WHERE comanda_id = ? AND id_estabelecimento = ?
  `, [comandaId, idEstabelecimento]);
  const pendentes = Number(totais.pendentes);
  const linhas = Number(totais.linhas);
  let status = 'Aberta';
  if (pendentes === 0 && linhas > 0) {
    status = statusAtual === 'Conta solicitada' ? 'Conta solicitada' : 'Na cozinha';
  }
  await conexao.execute(`
    UPDATE comandas SET status = ?
    WHERE id = ? AND id_estabelecimento = ?
  `, [status, comandaId, idEstabelecimento]);
  return status;
}

export async function abrirComanda(banco, idEstabelecimento, mesaId, funcionarioId) {
  const id = await executarTransacao(banco, async (conexao) => {
    const [mesas] = await conexao.execute(`
      SELECT id, numero FROM mesas
      WHERE id = ? AND id_estabelecimento = ? AND ativo = 1 FOR UPDATE
    `, [mesaId, idEstabelecimento]);
    if (!mesas[0]) throw erroDominio('Mesa não encontrada.', 404);
    const [existentes] = await conexao.execute(`
      SELECT id, funcionario_id FROM comandas
      WHERE mesa_id = ? AND id_estabelecimento = ?
        AND status NOT IN ('Encerrada', 'Cancelada')
      FOR UPDATE
    `, [mesaId, idEstabelecimento]);
    if (existentes[0]) {
      if (existentes[0].funcionario_id == null) {
        // Aberta no caixa: este garçom assume o atendimento da mesa.
        await conexao.execute(`
          UPDATE comandas SET funcionario_id = ?
          WHERE id = ? AND id_estabelecimento = ? AND funcionario_id IS NULL
        `, [funcionarioId, existentes[0].id, idEstabelecimento]);
      }
      // Já atendida por outro garçom: entra na mesma comanda, sem recusar.
      return Number(existentes[0].id);
    }
    const [resultado] = await conexao.execute(`
      INSERT INTO comandas (id_estabelecimento, mesa_id, funcionario_id, status)
      VALUES (?, ?, ?, 'Aberta')
    `, [idEstabelecimento, mesaId, funcionarioId]);
    return Number(resultado.insertId);
  });
  const comandas = await listarComandas(banco, idEstabelecimento);
  return comandas.find((comanda) => comanda.id === String(id));
}

/*
  Núcleo do lançamento de item, compartilhado pelo app do garçom e pelo
  painel. Quem chama já resolveu quem pode mexer na comanda: aqui só entra
  a comanda validada.
*/
async function inserirItemNaComanda(conexao, idEstabelecimento, comandaId, comanda, dados) {
  const [item] = await buscarItensValidados(conexao, idEstabelecimento, [{
    id: dados.produtoId,
    quantidade: dados.quantidade,
    adicionais: dados.adicionais,
    observacao: dados.observacao
  }], { canal: 'salao' });
  const [[totais]] = await conexao.execute(`
    SELECT COUNT(*) AS linhas, COALESCE(SUM(quantidade), 0) AS unidades
    FROM comanda_itens
    WHERE comanda_id = ? AND id_estabelecimento = ?
  `, [comandaId, idEstabelecimento]);
  if (Number(totais.linhas) >= MAX_LINHAS_PEDIDO
      || Number(totais.unidades) + item.quantidade > MAX_UNIDADES_PEDIDO) {
    throw erroDominio('A comanda atingiu o limite de itens permitido.');
  }
  const [resultado] = await conexao.execute(`
    INSERT INTO comanda_itens
      (id_estabelecimento, comanda_id, produto_id, nome_produto,
       preco_unitario_centavos, quantidade, observacao)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [idEstabelecimento, comandaId, item.produtoId, item.nome, item.precoCentavos, item.quantidade, item.observacao]);
  for (const adicional of item.adicionais) {
    await conexao.execute(`
      INSERT INTO comanda_item_adicionais
        (id_estabelecimento, comanda_item_id, adicional_id, nome_adicional, preco_centavos)
      VALUES (?, ?, ?, ?, ?)
    `, [idEstabelecimento, resultado.insertId, adicional.id, adicional.nome, adicional.precoCentavos]);
  }
  await sincronizarStatusComanda(conexao, idEstabelecimento, comandaId, comanda.status);
}

export async function adicionarItemComanda(
  banco,
  idEstabelecimento,
  comandaId,
  funcionarioId,
  dados
) {
  await executarTransacao(banco, async (conexao) => {
    const comanda = await obterComandaDoGarcom(
      conexao,
      idEstabelecimento,
      comandaId,
      funcionarioId,
      { bloquear: true }
    );
    await inserirItemNaComanda(conexao, idEstabelecimento, comandaId, comanda, dados);
  });
}

/*
  Observação geral da comanda: o recado que vale para a mesa inteira, e não
  para um prato. Fica separada de `comanda_itens.observacao` de propósito —
  "mesa com alergia a amendoim" não pertence a um hambúrguer específico.

  O texto é opcional e apagar o recado é salvar o campo vazio, que volta a
  NULL. O limite é validado aqui, e não truncado em silêncio: um recado de
  cozinha cortado pela metade é pior do que um erro na tela.
*/
function observacaoDaComanda(valor) {
  const limpa = texto(valor, MAX_OBSERVACAO_COMANDA + 1);
  if (limpa.length > MAX_OBSERVACAO_COMANDA) {
    throw erroDominio(
      `A observação da comanda pode ter no máximo ${MAX_OBSERVACAO_COMANDA} caracteres.`
    );
  }
  return limpa || null;
}

async function gravarObservacaoComanda(conexao, idEstabelecimento, comandaId, observacao) {
  await conexao.execute(`
    UPDATE comandas SET observacao = ?
    WHERE id = ? AND id_estabelecimento = ?
  `, [observacao, comandaId, idEstabelecimento]);
  return observacao ?? '';
}

/*
  Mesma porta do lançamento de item: quem valida a comanda é
  `obterComandaDoGarcom`, então o garçom só alcança comanda aberta do próprio
  estabelecimento — e comanda encerrada recusa a edição.
*/
export async function atualizarObservacaoComanda(
  banco,
  idEstabelecimento,
  comandaId,
  funcionarioId,
  observacao
) {
  const limpa = observacaoDaComanda(observacao);
  return executarTransacao(banco, async (conexao) => {
    await obterComandaDoGarcom(
      conexao,
      idEstabelecimento,
      comandaId,
      funcionarioId,
      { bloquear: true }
    );
    return gravarObservacaoComanda(conexao, idEstabelecimento, comandaId, limpa);
  });
}

/*
  `somenteNaoLancados` é o que separa o garçom do caixa: o garçom só apaga o
  que ainda não foi para a cozinha (o clique errado), enquanto o painel
  administrativo continua podendo corrigir um item já lançado.
*/
async function excluirItemDaComanda(
  conexao,
  idEstabelecimento,
  comandaId,
  itemId,
  comanda,
  { somenteNaoLancados = false } = {}
) {
  if (somenteNaoLancados) {
    const [itens] = await conexao.execute(`
      SELECT enviado_em FROM comanda_itens
      WHERE id = ? AND comanda_id = ? AND id_estabelecimento = ?
    `, [itemId, comandaId, idEstabelecimento]);
    if (!itens[0]) throw erroDominio('Item da comanda não encontrado.', 404);
    if (itens[0].enviado_em) {
      throw erroDominio('Item já lançado para a cozinha: peça ao administrador para removê-lo.', 403);
    }
  }
  const [[totais]] = await conexao.execute(`
    SELECT COUNT(*) AS linhas,
      EXISTS(
        SELECT 1 FROM pedidos
        WHERE comanda_id = ? AND id_estabelecimento = ?
      ) AS possui_pedido
    FROM comanda_itens
    WHERE comanda_id = ? AND id_estabelecimento = ?
  `, [comandaId, idEstabelecimento, comandaId, idEstabelecimento]);
  if (Number(totais.possui_pedido) && Number(totais.linhas) <= 1) {
    throw erroDominio('Não é possível remover o último item depois do envio à cozinha.', 409);
  }
  const [resultado] = await conexao.execute(`
    DELETE FROM comanda_itens
    WHERE id = ? AND comanda_id = ? AND id_estabelecimento = ?
  `, [itemId, comandaId, idEstabelecimento]);
  if (!resultado.affectedRows) throw erroDominio('Item da comanda não encontrado.', 404);
  await sincronizarStatusComanda(conexao, idEstabelecimento, comandaId, comanda.status);
}

export async function removerItemComanda(
  banco,
  idEstabelecimento,
  comandaId,
  itemId,
  funcionarioId,
  { somenteNaoLancados = false } = {}
) {
  await executarTransacao(banco, async (conexao) => {
    const comanda = await obterComandaDoGarcom(
      conexao,
      idEstabelecimento,
      comandaId,
      funcionarioId,
      { bloquear: true }
    );
    await excluirItemDaComanda(
      conexao,
      idEstabelecimento,
      comandaId,
      itemId,
      comanda,
      { somenteNaoLancados }
    );
  });
}

/*
  Limpeza em bloco do que ainda não foi lançado. É a saída para o clique
  errado no cardápio: o que já está na cozinha permanece intacto.
  Sem `funcionarioId` a operação é administrativa; com ele, o garçom só
  alcança a própria comanda.
*/
export async function limparItensNaoLancados(
  banco,
  idEstabelecimento,
  comandaId,
  { funcionarioId = null } = {}
) {
  return executarTransacao(banco, async (conexao) => {
    const comanda = funcionarioId == null
      ? await obterComandaAtiva(conexao, idEstabelecimento, comandaId)
      : await obterComandaDoGarcom(
        conexao,
        idEstabelecimento,
        comandaId,
        funcionarioId,
        { bloquear: true }
      );
    const [resultado] = await conexao.execute(`
      DELETE FROM comanda_itens
      WHERE comanda_id = ? AND id_estabelecimento = ? AND enviado_em IS NULL
    `, [comandaId, idEstabelecimento]);
    if (!resultado.affectedRows) {
      throw erroDominio('Não há itens pendentes de lançamento nesta comanda.', 409);
    }
    await sincronizarStatusComanda(conexao, idEstabelecimento, comandaId, comanda.status);
    return resultado.affectedRows;
  });
}

/*
  Abertura pelo painel: o caixa abre a comanda no próprio clique da mesa, sem
  escolher um garçom. A comanda nasce sem responsável e guarda quem a abriu —
  o primeiro garçom que atender a mesa assume o atendimento. Informar um
  funcionário continua sendo possível, e nesse caso ele é validado dentro do
  próprio estabelecimento, nunca aceito como veio do navegador.
  Se a mesa já tiver comanda ativa, ela é devolvida em vez de recusada: o
  clique repetido no painel não pode virar erro.
*/
export async function abrirComandaAdmin(
  banco,
  idEstabelecimento,
  mesaId,
  funcionarioId = null,
  administradorId = null
) {
  const mesa = Number(mesaId);
  if (!Number.isInteger(mesa) || mesa < 1) throw erroDominio('Mesa não encontrada.', 404);

  let funcionario = null;
  if (funcionarioId !== null && funcionarioId !== undefined && funcionarioId !== '') {
    funcionario = Number(funcionarioId);
    if (!Number.isInteger(funcionario) || funcionario < 1) {
      throw erroDominio('Funcionário não encontrado ou inativo neste estabelecimento.', 404);
    }
    const [funcionarios] = await banco.execute(`
      SELECT id FROM funcionarios
      WHERE id = ? AND id_estabelecimento = ? AND ativo = 1
      LIMIT 1
    `, [funcionario, idEstabelecimento]);
    if (!funcionarios[0]) {
      throw erroDominio('Funcionário não encontrado ou inativo neste estabelecimento.', 404);
    }
  }

  const id = await executarTransacao(banco, async (conexao) => {
    const [mesas] = await conexao.execute(`
      SELECT id FROM mesas
      WHERE id = ? AND id_estabelecimento = ? AND ativo = 1 FOR UPDATE
    `, [mesa, idEstabelecimento]);
    if (!mesas[0]) throw erroDominio('Mesa não encontrada.', 404);
    const [existentes] = await conexao.execute(`
      SELECT id FROM comandas
      WHERE mesa_id = ? AND id_estabelecimento = ?
        AND status NOT IN ('Encerrada', 'Cancelada')
      FOR UPDATE
    `, [mesa, idEstabelecimento]);
    if (existentes[0]) return Number(existentes[0].id);
    const [resultado] = await conexao.execute(`
      INSERT INTO comandas
        (id_estabelecimento, mesa_id, funcionario_id, aberta_por_admin_id, status)
      VALUES (?, ?, ?, ?, 'Aberta')
    `, [idEstabelecimento, mesa, funcionario, administradorId]);
    await registrarAuditoria(
      conexao,
      idEstabelecimento,
      administradorId,
      'comanda.aberta',
      'comanda',
      Number(resultado.insertId),
      { mesaId: mesa, funcionarioId: funcionario }
    );
    return Number(resultado.insertId);
  });

  const comandas = await listarComandas(banco, idEstabelecimento);
  return comandas.find((comanda) => comanda.id === String(id));
}

/*
  O painel age pela mesa, não pelo garçom: valida a comanda do próprio
  estabelecimento e segue, sem depender de haver um responsável definido.
*/
export async function adicionarItemComandaAdmin(banco, idEstabelecimento, comandaId, dados) {
  await executarTransacao(banco, async (conexao) => {
    const comanda = await obterComandaAtiva(conexao, idEstabelecimento, comandaId);
    await inserirItemNaComanda(conexao, idEstabelecimento, comandaId, comanda, dados);
  });
}

/*
  Variante do caixa: o painel responde pela mesa e edita o recado de qualquer
  comanda aberta do próprio estabelecimento, sem depender de haver garçom
  responsável. Como toda alteração feita pelo painel, fica na auditoria.
*/
export async function atualizarObservacaoComandaAdmin(
  banco,
  idEstabelecimento,
  comandaId,
  administradorId,
  observacao
) {
  const limpa = observacaoDaComanda(observacao);
  return executarTransacao(banco, async (conexao) => {
    await obterComandaAtiva(conexao, idEstabelecimento, comandaId);
    const salva = await gravarObservacaoComanda(conexao, idEstabelecimento, comandaId, limpa);
    await registrarAuditoria(
      conexao,
      idEstabelecimento,
      administradorId,
      'comanda.observacao_alterada',
      'comanda',
      Number(comandaId),
      // O recado em si não vai para a auditoria: registrar se foi preenchido
      // ou limpo basta, e evita duplicar o texto fora da comanda.
      { preenchida: limpa !== null }
    );
    return salva;
  });
}

export async function removerItemComandaAdmin(banco, idEstabelecimento, comandaId, itemId) {
  await executarTransacao(banco, async (conexao) => {
    const comanda = await obterComandaAtiva(conexao, idEstabelecimento, comandaId);
    await excluirItemDaComanda(conexao, idEstabelecimento, comandaId, itemId, comanda);
  });
}

export async function limparItensNaoLancadosAdmin(
  banco,
  idEstabelecimento,
  comandaId,
  administradorId = null
) {
  const removidos = await limparItensNaoLancados(banco, idEstabelecimento, comandaId);
  await registrarAuditoria(
    banco,
    idEstabelecimento,
    administradorId,
    'comanda.itens_pendentes_removidos',
    'comanda',
    Number(comandaId),
    { itens: removidos }
  );
  return removidos;
}

export async function atualizarQuantidadeItemComandaAdmin(
  banco,
  idEstabelecimento,
  comandaId,
  itemId,
  quantidadeInformada
) {
  const quantidade = Number(quantidadeInformada);
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) {
    throw erroDominio('Informe uma quantidade entre 1 e 50.');
  }
  await executarTransacao(banco, async (conexao) => {
    const [comandas] = await conexao.execute(`
      SELECT status FROM comandas
      WHERE id = ? AND id_estabelecimento = ? FOR UPDATE
    `, [comandaId, idEstabelecimento]);
    if (!comandas[0]) throw erroDominio('Comanda não encontrada.', 404);
    if (COMANDAS_FECHADAS.has(comandas[0].status)) {
      throw erroDominio('Esta comanda já foi encerrada.', 409);
    }

    const [itens] = await conexao.execute(`
      SELECT id FROM comanda_itens
      WHERE id = ? AND comanda_id = ? AND id_estabelecimento = ? FOR UPDATE
    `, [itemId, comandaId, idEstabelecimento]);
    if (!itens[0]) throw erroDominio('Item da comanda não encontrado.', 404);

    const [[totais]] = await conexao.execute(`
      SELECT COALESCE(SUM(quantidade), 0) AS unidades
      FROM comanda_itens
      WHERE comanda_id = ? AND id <> ? AND id_estabelecimento = ?
    `, [comandaId, itemId, idEstabelecimento]);
    if (Number(totais.unidades) + quantidade > MAX_UNIDADES_PEDIDO) {
      throw erroDominio('A comanda atingiu o limite de itens permitido.');
    }
    // A cozinha só conhece o que foi lançado: mudar a quantidade devolve o
    // item para pendente, para que a alteração passe pela confirmação de
    // lançamento em vez de sumir sem ninguém ver.
    await conexao.execute(`
      UPDATE comanda_itens SET quantidade = ?, enviado_em = NULL
      WHERE id = ? AND id_estabelecimento = ?
    `, [quantidade, itemId, idEstabelecimento]);
    await sincronizarStatusComanda(
      conexao,
      idEstabelecimento,
      comandaId,
      comandas[0].status
    );
  });
}

async function copiarItensComandaParaPedido(conexao, idEstabelecimento, comandaId, pedidoId) {
  const [itens] = await conexao.execute(`
    SELECT id, produto_id, nome_produto, preco_unitario_centavos, quantidade, observacao
    FROM comanda_itens
    WHERE comanda_id = ? AND id_estabelecimento = ?
    ORDER BY id
  `, [comandaId, idEstabelecimento]);
  if (itens.length === 0) throw erroDominio('Adicione produtos antes de enviar a comanda.', 409);
  for (const item of itens) {
    const [produtos] = item.produto_id
      ? await conexao.execute(`
          SELECT descricao, imagem_url FROM produtos
          WHERE id = ? AND id_estabelecimento = ?
        `, [item.produto_id, idEstabelecimento])
      : [[]];
    const [resultado] = await conexao.execute(`
      INSERT INTO pedido_itens
        (id_estabelecimento, pedido_id, produto_id, nome_produto, descricao_produto, imagem_url,
         preco_unitario_centavos, quantidade, observacao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      idEstabelecimento,
      pedidoId, item.produto_id, item.nome_produto, produtos[0]?.descricao ?? '',
      produtos[0]?.imagem_url ?? null, item.preco_unitario_centavos,
      item.quantidade, item.observacao
    ]);
    const [adicionais] = await conexao.execute(`
      SELECT adicional_id, nome_adicional, preco_centavos
      FROM comanda_item_adicionais
      WHERE comanda_item_id = ? AND id_estabelecimento = ?
    `, [item.id, idEstabelecimento]);
    for (const adicional of adicionais) {
      await conexao.execute(`
        INSERT INTO pedido_item_adicionais
          (id_estabelecimento, pedido_item_id, adicional_id, nome_adicional, preco_centavos)
        VALUES (?, ?, ?, ?, ?)
      `, [idEstabelecimento, resultado.insertId, adicional.adicional_id, adicional.nome_adicional, adicional.preco_centavos]);
    }
  }
  const total = itens.reduce(
    (soma, item) => soma + Number(item.preco_unitario_centavos) * Number(item.quantidade),
    0
  );
  if (!Number.isSafeInteger(total) || total < 0 || total > MAX_TOTAL_CENTAVOS) {
    throw erroDominio('O valor total da comanda excede o limite permitido.');
  }
  return total;
}

/* Nome do responsável só para o cabeçalho do recibo: comanda aberta no caixa
   ainda pode não ter garçom, e nesse caso a comanda sai sem essa linha. */
async function nomeDoGarcomDaComanda(conexao, idEstabelecimento, comanda) {
  if (comanda.funcionario_id == null) return null;
  const [linhas] = await conexao.execute(`
    SELECT nome FROM funcionarios
    WHERE id = ? AND id_estabelecimento = ?
  `, [Number(comanda.funcionario_id), idEstabelecimento]);
  return linhas[0]?.nome ?? null;
}

/*
  Itens da comanda que ainda não entraram em nenhum trabalho de impressão.

  O reenvio da comanda é comum — o cliente pede mais uma coisa e o garçom manda
  de novo —, e a cozinha não pode receber a comanda inteira de novo a cada vez.
  Só o que tem `impresso_em IS NULL` é impresso; o resto já está lá.
*/
async function itensComandaNaoImpressos(conexao, idEstabelecimento, comandaId) {
  const [itens] = await conexao.execute(`
    SELECT id, produto_id, nome_produto, quantidade, observacao
    FROM comanda_itens
    WHERE comanda_id = ? AND id_estabelecimento = ? AND impresso_em IS NULL
    ORDER BY id
  `, [comandaId, idEstabelecimento]);
  if (itens.length === 0) return [];
  const adicionaisPorItem = await listarAdicionaisDeItens(
    conexao,
    idEstabelecimento,
    'comanda_item_adicionais',
    'comanda_item_id',
    itens.map((item) => Number(item.id))
  );
  return itens.map((item) => ({
    id: Number(item.id),
    produtoId: item.produto_id == null ? null : Number(item.produto_id),
    nome: item.nome_produto,
    quantidade: Number(item.quantidade),
    observacao: item.observacao,
    adicionais: adicionaisPorItem.get(Number(item.id)) ?? []
  }));
}

/*
  Lançamento para a cozinha. `autor` guarda quem apertou o botão — garçom ou
  administrador —, item a item, para que a conta impressa mostre quem
  registrou cada pedido do cliente.
*/
async function lancarComandaNaCozinha(
  conexao,
  idEstabelecimento,
  comandaId,
  comanda,
  { funcionarioId = null, administradorId = null }
) {
  const [[pendentes]] = await conexao.execute(`
    SELECT COUNT(*) AS total FROM comanda_itens
    WHERE comanda_id = ? AND id_estabelecimento = ? AND enviado_em IS NULL
  `, [comandaId, idEstabelecimento]);
  if (Number(pendentes.total) === 0) {
    throw erroDominio('Não há item pendente para lançar na cozinha.', 409);
  }
  const [pedidos] = await conexao.execute(`
    SELECT id FROM pedidos
    WHERE comanda_id = ? AND id_estabelecimento = ? FOR UPDATE
  `, [comandaId, idEstabelecimento]);
  let pedidoId = pedidos[0] ? Number(pedidos[0].id) : null;
  if (!pedidoId) {
    const [resultado] = await conexao.execute(`
      INSERT INTO pedidos
        (id_estabelecimento, origem, cliente, telefone, status, pagamento, taxa_entrega_centavos,
         total_centavos, comanda_id, mesa_id, funcionario_id)
      VALUES (?, 'mesa', ?, 'Atendimento presencial', 'Recebido', 'A definir', 0, 0, ?, ?, ?)
    `, [
      idEstabelecimento,
      `Mesa ${comanda.mesa_numero}`,
      comandaId,
      comanda.mesa_id,
      // O pedido fica com o responsável da comanda; lançado pelo painel sem
      // garçom definido, ele nasce sem funcionário, como o delivery.
      funcionarioId ?? (comanda.funcionario_id == null ? null : Number(comanda.funcionario_id))
    ]);
    pedidoId = Number(resultado.insertId);
  } else {
    await conexao.execute(`
      DELETE FROM pedido_itens
      WHERE pedido_id = ? AND id_estabelecimento = ?
    `, [pedidoId, idEstabelecimento]);
  }
  const total = await copiarItensComandaParaPedido(
    conexao,
    idEstabelecimento,
    comandaId,
    pedidoId
  );
  await conexao.execute(`
    UPDATE pedidos SET total_centavos = ?, status = 'Em preparo'
    WHERE id = ? AND id_estabelecimento = ?
  `, [total, pedidoId, idEstabelecimento]);
  await conexao.execute(`
    UPDATE comanda_itens
    SET enviado_em = CURRENT_TIMESTAMP,
      enviado_por_funcionario_id = ?,
      enviado_por_admin_id = ?
    WHERE comanda_id = ? AND id_estabelecimento = ? AND enviado_em IS NULL
  `, [funcionarioId, administradorId, comandaId, idEstabelecimento]);

  /* Impressão só do que ainda não foi impresso, e a marcação na mesma
    transação: reenviar a comanda depois de acrescentar um item manda para a
    cozinha apenas o item novo. Produto sem impressora não gera trabalho e não
    impede o lançamento. */
  const naoImpressos = await itensComandaNaoImpressos(conexao, idEstabelecimento, comandaId);
  if (naoImpressos.length > 0) {
    await gerarTrabalhosImpressao(conexao, idEstabelecimento, {
      origem: 'comanda',
      pedidoId,
      comandaId: Number(comandaId),
      itens: naoImpressos,
      contexto: {
        /* A comanda é identificada pela mesa no papel: para a cozinha, o
          número da comanda e o da mesa são a mesma coisa. `mesa` continua no
          registro do trabalho; quem imprime usa `numeroMesa` no título. */
        numeroMesa: String(comanda.mesa_numero),
        mesa: `Mesa ${comanda.mesa_numero}`,
        garcom: await nomeDoGarcomDaComanda(conexao, idEstabelecimento, comanda),
        /* Recado que vale para a mesa inteira. Vai em todo trabalho desta
          leva, porque cada impressora recebe o seu recibo e a cozinha e o bar
          precisam ler a mesma alergia. */
        observacaoComanda: comanda.observacao ?? null
      }
    });
    const marcadores = naoImpressos.map(() => '?').join(', ');
    await conexao.execute(`
      UPDATE comanda_itens SET impresso_em = CURRENT_TIMESTAMP
      WHERE id_estabelecimento = ? AND comanda_id = ? AND id IN (${marcadores})
    `, [idEstabelecimento, comandaId, ...naoImpressos.map((item) => item.id)]);
  }

  await conexao.execute(`
    UPDATE comandas SET status = 'Na cozinha'
    WHERE id = ? AND id_estabelecimento = ?
  `, [comandaId, idEstabelecimento]);
}

export async function enviarComanda(banco, idEstabelecimento, comandaId, funcionarioId) {
  await executarTransacao(banco, async (conexao) => {
    const comanda = await obterComandaDoGarcom(
      conexao,
      idEstabelecimento,
      comandaId,
      funcionarioId,
      { bloquear: true }
    );
    await lancarComandaNaCozinha(conexao, idEstabelecimento, comandaId, comanda, {
      funcionarioId
    });
  });
}

/*
  Lançamento pelo painel: a comanda continua pertencendo ao funcionário
  responsável — o administrador apenas dispara o mesmo envio, com registro
  em auditoria de quem lançou.
*/
export async function enviarComandaAdmin(
  banco,
  idEstabelecimento,
  comandaId,
  administradorId = null
) {
  await executarTransacao(banco, async (conexao) => {
    const comanda = await obterComandaAtiva(conexao, idEstabelecimento, comandaId);
    await lancarComandaNaCozinha(conexao, idEstabelecimento, comandaId, comanda, {
      administradorId
    });
    await registrarAuditoria(
      conexao,
      idEstabelecimento,
      administradorId,
      'comanda.lancada',
      'comanda',
      Number(comandaId),
      { funcionarioId: comanda.funcionario_id == null ? null : Number(comanda.funcionario_id) }
    );
  });
}

/*
  Cancelamento da comanda inteira: exclusivo do painel. Libera a mesa sem
  cobrança e cancela o pedido correspondente, preservando os itens já
  registrados para auditoria em vez de apagar o histórico.
*/
export async function cancelarComandaAdmin(
  banco,
  idEstabelecimento,
  comandaId,
  administradorId = null
) {
  await executarTransacao(banco, async (conexao) => {
    const comanda = await obterComandaAtiva(conexao, idEstabelecimento, comandaId);
    const [[totais]] = await conexao.execute(`
      SELECT COUNT(*) AS linhas,
        COALESCE(SUM(preco_unitario_centavos * quantidade), 0) AS total_centavos
      FROM comanda_itens
      WHERE comanda_id = ? AND id_estabelecimento = ?
    `, [comandaId, idEstabelecimento]);
    const [pedidos] = await conexao.execute(`
      SELECT id FROM pedidos
      WHERE comanda_id = ? AND id_estabelecimento = ? FOR UPDATE
    `, [comandaId, idEstabelecimento]);
    if (pedidos[0]) {
      await conexao.execute(`
        UPDATE pedidos SET status = 'Cancelado'
        WHERE id = ? AND id_estabelecimento = ?
      `, [pedidos[0].id, idEstabelecimento]);
    }
    await conexao.execute(`
      UPDATE comandas SET status = 'Cancelada', encerrada_em = CURRENT_TIMESTAMP
      WHERE id = ? AND id_estabelecimento = ?
    `, [comandaId, idEstabelecimento]);
    await registrarAuditoria(
      conexao,
      idEstabelecimento,
      administradorId,
      'comanda.cancelada',
      'comanda',
      Number(comandaId),
      {
        mesaId: Number(comanda.mesa_id),
        itens: Number(totais.linhas),
        valorCentavos: Number(totais.total_centavos)
      }
    );
  });
}

export async function fecharComanda(
  banco,
  idEstabelecimento,
  comandaId,
  funcionarioId,
  pagamento
) {
  if (!PAGAMENTOS.has(pagamento) || pagamento === 'A definir') throw erroDominio('Selecione uma forma de pagamento válida.');
  await executarTransacao(banco, async (conexao) => {
    const comanda = await obterComandaDoGarcom(
      conexao,
      idEstabelecimento,
      comandaId,
      funcionarioId,
      { bloquear: true }
    );
    if (comanda.status !== 'Conta solicitada') {
      throw erroDominio('Solicite a conta antes de confirmar o pagamento.', 409);
    }
    const [pedidos] = await conexao.execute(`
      SELECT id, total_centavos FROM pedidos
      WHERE comanda_id = ? AND id_estabelecimento = ? FOR UPDATE
    `, [comandaId, idEstabelecimento]);
    const pedido = pedidos[0];
    if (!pedido) throw erroDominio('Envie a comanda para a cozinha antes de fechá-la.', 409);
    await conexao.execute(`
      UPDATE comandas SET status = 'Encerrada', pagamento = ?, encerrada_em = CURRENT_TIMESTAMP
      WHERE id = ? AND id_estabelecimento = ?
    `, [pagamento, comandaId, idEstabelecimento]);
    await conexao.execute(`
      UPDATE pedidos SET status = 'Entregue na mesa', pagamento = ?
      WHERE id = ? AND id_estabelecimento = ?
    `, [pagamento, pedido.id, idEstabelecimento]);
    await conexao.execute(`
      INSERT INTO pagamentos
        (id_estabelecimento, pedido_id, comanda_id, forma, status,
         valor_centavos, pago_em, confirmado_em)
      VALUES (?, ?, ?, ?, 'Pago', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [idEstabelecimento, pedido.id, comandaId, pagamento, pedido.total_centavos]);
  });
}

/*
  Fechamento no caixa. O total sai sempre dos itens da comanda e o troco é
  calculado no servidor a partir do que o caixa digitou como recebido — o
  navegador informa apenas a forma e o valor entregue pelo cliente.
  `provedor` deixa o caminho pronto para um gateway externo assumir o
  pagamento sem mudar esta função.
*/
export async function finalizarComandaAdmin(
  banco,
  idEstabelecimento,
  comandaId,
  { forma, valorRecebidoCentavos = null, provedor = undefined } = {},
  administradorId = null
) {
  if (!PAGAMENTOS.has(forma) || forma === 'A definir') {
    throw erroDominio('Selecione uma forma de pagamento válida.');
  }
  return executarTransacao(banco, async (conexao) => {
    const [comandas] = await conexao.execute(`
      SELECT c.id, c.mesa_id, c.funcionario_id, c.status, m.numero AS mesa_numero
      FROM comandas c
      INNER JOIN mesas m
        ON m.id = c.mesa_id
        AND m.id_estabelecimento = c.id_estabelecimento
      WHERE c.id = ? AND c.id_estabelecimento = ? FOR UPDATE
    `, [comandaId, idEstabelecimento]);
    const comanda = comandas[0];
    if (!comanda) throw erroDominio('Comanda não encontrada.', 404);
    if (COMANDAS_FECHADAS.has(comanda.status)) {
      throw erroDominio('Esta comanda já foi encerrada.', 409);
    }

    const [pedidos] = await conexao.execute(`
      SELECT id FROM pedidos
      WHERE comanda_id = ? AND id_estabelecimento = ? FOR UPDATE
    `, [comandaId, idEstabelecimento]);
    let pedidoId = pedidos[0] ? Number(pedidos[0].id) : null;
    if (!pedidoId) {
      const [resultado] = await conexao.execute(`
        INSERT INTO pedidos
          (id_estabelecimento, origem, cliente, telefone, status, pagamento, taxa_entrega_centavos,
           total_centavos, comanda_id, mesa_id, funcionario_id)
        VALUES (?, 'mesa', ?, 'Atendimento presencial', 'Recebido', ?, 0, 0, ?, ?, ?)
      `, [idEstabelecimento, `Mesa ${comanda.mesa_numero}`, pagamento, comandaId, comanda.mesa_id, comanda.funcionario_id]);
      pedidoId = Number(resultado.insertId);
    } else {
      await conexao.execute(`
        DELETE FROM pedido_itens
        WHERE pedido_id = ? AND id_estabelecimento = ?
      `, [pedidoId, idEstabelecimento]);
    }

    const total = await copiarItensComandaParaPedido(
      conexao,
      idEstabelecimento,
      comandaId,
      pedidoId
    );
    const pagamento = await prepararPagamentoComanda({
      ...(provedor ? { provedor } : {}),
      forma,
      totalCentavos: total,
      valorRecebidoCentavos
    });
    await conexao.execute(`
      UPDATE pedidos SET total_centavos = ?, status = 'Entregue na mesa', pagamento = ?
      WHERE id = ? AND id_estabelecimento = ?
    `, [total, pagamento.forma, pedidoId, idEstabelecimento]);
    await conexao.execute(`
      UPDATE comandas SET status = 'Encerrada', pagamento = ?, encerrada_em = CURRENT_TIMESTAMP
      WHERE id = ? AND id_estabelecimento = ?
    `, [pagamento.forma, comandaId, idEstabelecimento]);
    await conexao.execute(`
      INSERT INTO pagamentos
        (id_estabelecimento, pedido_id, comanda_id, forma, status,
         valor_centavos, valor_recebido_centavos, troco_centavos, provedor,
         referencia_externa, pago_em, confirmado_por, confirmado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
    `, [
      idEstabelecimento,
      pedidoId,
      comandaId,
      pagamento.forma,
      pagamento.status,
      pagamento.valorCentavos,
      pagamento.valorRecebidoCentavos,
      pagamento.trocoCentavos,
      pagamento.provedor,
      pagamento.referenciaExterna,
      administradorId
    ]);
    await registrarAuditoria(conexao, idEstabelecimento, administradorId, 'comanda.finalizada', 'pedido', pedidoId, {
      comandaId: Number(comandaId),
      forma: pagamento.forma,
      valorCentavos: pagamento.valorCentavos,
      trocoCentavos: pagamento.trocoCentavos
    });
    return {
      forma: pagamento.forma,
      provedor: pagamento.provedor,
      totalCentavos: pagamento.valorCentavos,
      valorRecebidoCentavos: pagamento.valorRecebidoCentavos,
      trocoCentavos: pagamento.trocoCentavos
    };
  });
}

/*
  Indicadores do dashboard (ticket médio e produtos mais vendidos).

  Vale a mesma regra do card "Receita confirmada": conta o pedido cujo
  pagamento mais recente está 'Pago'. `status <> 'Cancelado'` só deixa
  explícito o que o cancelamento já garante ao cancelar ou estornar a cobrança.

  O período é recortado no fuso da loja e comparado com `criado_em`, que o
  sistema grava e lê como UTC (o pool usa timezone 'Z'). As datas seguem como
  parâmetros no formato DATETIME, nunca concatenadas no SQL.
*/
const PERIODOS_INDICADORES = new Set(['hoje', '7dias', '30dias', 'mes']);
const PERIODO_INDICADORES_PADRAO = '30dias';
const DIAS_ANTERIORES_PERIODO = { hoje: 0, '7dias': 6, '30dias': 29 };
const LIMITE_PRODUTOS_MAIS_VENDIDOS = 5;

const PEDIDOS_CONFIRMADOS_NO_PERIODO = `
  INNER JOIN pagamentos pg
    ON pg.id = (
      SELECT MAX(pg2.id) FROM pagamentos pg2
      WHERE pg2.pedido_id = p.id AND pg2.id_estabelecimento = p.id_estabelecimento
    )
    AND pg.id_estabelecimento = p.id_estabelecimento
  WHERE p.id_estabelecimento = ?
    AND p.criado_em >= ?
    AND p.criado_em < ?
    AND p.status <> 'Cancelado'
    AND pg.status = 'Pago'
`;

function dataUtcMySql(data) {
  return data.toISOString().slice(0, 19).replace('T', ' ');
}

export function intervaloIndicadores(periodo, agora = new Date(), fuso = FUSO_HORARIO_LOJA) {
  if (!PERIODOS_INDICADORES.has(periodo)) throw erroDominio('Período inválido para os indicadores.');
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(agora)
      .filter((parte) => parte.type !== 'literal')
      .map((parte) => [parte.type, Number(parte.value)])
  );
  // Diferença entre o relógio da loja e o UTC neste instante.
  const deslocamentoMs = Date.UTC(
    partes.year, partes.month - 1, partes.day, partes.hour, partes.minute, partes.second
  ) - Math.floor(agora.getTime() / 1000) * 1000;
  const meiaNoiteDaLoja = (dia) => new Date(Date.UTC(partes.year, partes.month - 1, dia) - deslocamentoMs);
  return {
    inicio: meiaNoiteDaLoja(periodo === 'mes' ? 1 : partes.day - DIAS_ANTERIORES_PERIODO[periodo]),
    fim: meiaNoiteDaLoja(partes.day + 1)
  };
}

export async function buscarIndicadoresDashboard(banco, idEstabelecimento, periodoInformado, agora = new Date()) {
  const periodo = texto(periodoInformado, 10) || PERIODO_INDICADORES_PADRAO;
  const { inicio, fim } = intervaloIndicadores(periodo, agora);
  const parametros = [idEstabelecimento, dataUtcMySql(inicio), dataUtcMySql(fim)];
  const [[linhasTicket], [linhasProdutos]] = await Promise.all([
    banco.execute(`
      SELECT COUNT(p.id) AS pedidos, COALESCE(SUM(p.total_centavos), 0) AS receita_centavos
      FROM pedidos p
      ${PEDIDOS_CONFIRMADOS_NO_PERIODO}
    `, parametros),
    // Agrupa pelo nome gravado no pedido: produto excluído (produto_id NULL)
    // continua aparecendo, e uma promoção não se mistura ao produto base.
    banco.execute(`
      SELECT itp.produto_id, itp.nome_produto,
        SUM(itp.quantidade) AS quantidade,
        SUM(itp.preco_unitario_centavos * itp.quantidade) AS receita_centavos
      FROM pedido_itens itp
      INNER JOIN pedidos p
        ON p.id = itp.pedido_id
        AND p.id_estabelecimento = itp.id_estabelecimento
      ${PEDIDOS_CONFIRMADOS_NO_PERIODO}
      GROUP BY itp.produto_id, itp.nome_produto
      ORDER BY quantidade DESC, receita_centavos DESC, itp.nome_produto ASC
      LIMIT ${LIMITE_PRODUTOS_MAIS_VENDIDOS}
    `, parametros)
  ]);
  const pedidos = Number(linhasTicket[0]?.pedidos ?? 0);
  const receitaCentavos = Number(linhasTicket[0]?.receita_centavos ?? 0);
  return {
    periodo,
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    ticketMedio: {
      valor: pedidos > 0 ? Math.round(receitaCentavos / pedidos) / 100 : null,
      receita: receitaCentavos / 100,
      pedidos
    },
    produtosMaisVendidos: linhasProdutos.map((linha, indice) => ({
      posicao: indice + 1,
      produtoId: linha.produto_id == null ? null : Number(linha.produto_id),
      nome: linha.nome_produto,
      quantidade: Number(linha.quantidade),
      receita: Number(linha.receita_centavos) / 100
    }))
  };
}

export async function listarDadosPublicos(banco, idEstabelecimento) {
  const [catalogo, promocoes, configuracao] = await Promise.all([
    listarCatalogo(banco, idEstabelecimento, { canal: 'online' }),
    listarPromocoes(banco, idEstabelecimento, { somenteAtivas: true }),
    buscarConfiguracaoPublica(banco, idEstabelecimento)
  ]);
  return { ...catalogo, promocoes, configuracao };
}

export async function listarDadosAdmin(banco, idEstabelecimento, permissoes = null) {
  /* Cada parte do painel só é consultada e devolvida para quem pode usá-la.
    Sem lista de permissões (uso interno), devolve o painel completo. */
  const pode = (...chaves) => permissoes === null || chaves.some((chave) => permissoes.includes(chave));
  const podeGerenciarEquipe = pode('funcionarios.gerenciar');
  const podeVerSalao = pode('mesas.operar', 'mesas.fechar', 'mesas.cadastrar');
  const [
    catalogo,
    promocoes,
    funcionarios,
    mesas,
    comandas,
    pedidos,
    configuracao,
    administradores,
    auditoria,
    acessoGarcom,
    impressoras
  ] = await Promise.all([
    pode('produtos.editar', 'mesas.operar')
      ? listarCatalogo(banco, idEstabelecimento, { administrativo: true })
      : { categorias: [], adicionais: [], produtos: [] },
    pode('produtos.editar') ? listarPromocoes(banco, idEstabelecimento) : [],
    pode('funcionarios.gerenciar', 'relatorios.visualizar', 'mesas.operar')
      ? listarFuncionarios(banco, idEstabelecimento)
      : [],
    podeVerSalao ? listarMesas(banco, idEstabelecimento) : [],
    podeVerSalao ? listarComandas(banco, idEstabelecimento) : [],
    pode('pedidos.visualizar', 'relatorios.visualizar') ? listarPedidos(banco, idEstabelecimento) : [],
    pode('personalizacao.editar', 'delivery.editar', 'configuracoes.editar')
      ? buscarConfiguracao(banco, idEstabelecimento)
      : buscarConfiguracaoPublica(banco, idEstabelecimento),
    podeGerenciarEquipe ? listarAdministradoresComPermissoes(banco, idEstabelecimento) : [],
    podeGerenciarEquipe
      ? listarAuditoriaAdmin(banco, idEstabelecimento, { acao: ACAO_LOGIN_ADMIN })
      : [],
    podeGerenciarEquipe ? obterTokenAcessoGarcom(banco, idEstabelecimento) : '',
    /* A lista alimenta o select de impressora no cardápio e a tela de
      impressoras; não expõe nada além de nome, endereço e status. */
    pode('produtos.editar', 'configuracoes.editar')
      ? listarImpressoras(banco, idEstabelecimento)
      : []
  ]);
  return {
    ...catalogo,
    promocoes,
    funcionarios,
    mesas,
    comandas,
    pedidos,
    configuracao,
    administradores,
    auditoria,
    // Token do QR Code único da equipe, exibido na tela de funcionários.
    acessoGarcom,
    impressoras
  };
}

export async function listarDadosGarcom(banco, idEstabelecimento) {
  const [catalogo, mesas, comandas, configuracao] = await Promise.all([
    listarCatalogo(banco, idEstabelecimento, { canal: 'salao' }),
    listarMesas(banco, idEstabelecimento),
    listarComandas(banco, idEstabelecimento),
    buscarConfiguracao(banco, idEstabelecimento)
  ]);
  return { ...catalogo, mesas, comandas, configuracao };
}

export { erroDominio };
