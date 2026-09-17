/*
  Montagem do recibo em ESC/POS, o dialeto que as impressoras térmicas de rede
  entendem. É tudo byte cru: não há dependência nenhuma aqui, só `Buffer`.

  O agente não decide o que imprimir. O servidor já mandou o recibo pronto em
  `conteudo`; aqui ele só vira papel.
*/

const ESC = 0x1b;
const GS = 0x1d;

const COMANDOS = {
  inicializar: Buffer.from([ESC, 0x40]),
  alinharEsquerda: Buffer.from([ESC, 0x61, 0x00]),
  alinharCentro: Buffer.from([ESC, 0x61, 0x01]),
  negritoLigado: Buffer.from([ESC, 0x45, 0x01]),
  negritoDesligado: Buffer.from([ESC, 0x45, 0x00]),
  fonteDupla: Buffer.from([GS, 0x21, 0x11]),
  fonteNormal: Buffer.from([GS, 0x21, 0x00]),
  // Corte parcial, com avanço para o papel sair da guilhotina.
  cortar: Buffer.from([GS, 0x56, 0x42, 0x00])
};

const COLUNAS = 42;

/*
  A maioria das térmicas de rede sai de fábrica na página de código 858
  (CP858, latin-1 com o símbolo do euro). Sem selecionar a página e sem
  transliterar, "Ã§" e "Ã£" saem como lixo no papel.
*/
const SELECIONAR_CP858 = Buffer.from([ESC, 0x74, 0x13]);

/*
  Pontuação e símbolos que não têm decomposição em ASCII, então precisam de
  equivalente escrito à mão. Acento nenhum entra aqui: quem resolve acento é a
  normalização em `semAcento`.

  O que está nesta lista é o que de fato chega do salão: o teclado do celular
  troca aspas e hífen por versões tipográficas sozinho, e endereço brasileiro
  vive de "1º andar" e "2ª rua".
*/
const SUBSTITUICOES = new Map(Object.entries({
  // Indicadores ordinais.
  'ª': 'a', 'º': 'o',
  // Hífens e travessões tipográficos.
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-',
  '―': '-', '−': '-',
  // Aspas e apóstrofos curvos.
  '‘': "'", '’': "'", '‚': "'", '‹': "'", '›': "'",
  '“': '"', '”': '"', '„': '"', '«': '"', '»': '"',
  // Reticências e marcadores de lista.
  '…': '...', '•': '-', '·': '-',
  // Espaços especiais viram espaço comum; o de largura zero simplesmente sai.
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '​': '',
  // Sinais de quantidade e temperatura.
  '×': 'x', '÷': '/', '±': '+/-', '°': 'o',
  '½': '1/2', '¼': '1/4', '¾': '3/4',
  // Letras sem decomposição canônica.
  'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'ø': 'o', 'Ø': 'O'
}));

/* Impressora antiga que ignore a página de código ainda imprime algo legível:
   o texto perde o acento, não a palavra.

   A normalização NFD separa a letra do acento ("ç" vira "c" + cedilha), e
   apagar as marcas combinantes resolve todo acento latino de uma vez — vale
   para ç, ã, ü e também para o que uma tabela escrita à mão esqueceria. Serve
   ainda para texto que já chega decomposto, que antes virava "a?".

   Sobrou algo fora do ASCII e fora da lista acima? Vira '?', que é ruim de
   ler mas não é lixo binário no papel. */
function semAcento(texto) {
  const semMarcas = String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  // Percorre por ponto de código: emoji conta como um caractere, não dois.
  return [...semMarcas]
    .map((caractere) => (
      caractere.codePointAt(0) < 128 ? caractere : SUBSTITUICOES.get(caractere) ?? '?'
    ))
    .join('');
}

function linha(texto = '') {
  return Buffer.from(`${semAcento(texto)}\n`, 'latin1');
}

function separador() {
  return linha('-'.repeat(COLUNAS));
}

/* Quebra respeitando a largura do papel, para o nome do produto não sumir. */
function quebrar(texto, largura = COLUNAS, recuo = '') {
  const palavras = semAcento(texto).split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';
  for (const palavra of palavras) {
    const candidata = atual ? `${atual} ${palavra}` : palavra;
    if (candidata.length <= largura) {
      atual = candidata;
      continue;
    }
    if (atual) linhas.push(atual);
    atual = palavra.length > largura ? palavra.slice(0, largura) : palavra;
  }
  if (atual) linhas.push(atual);
  return linhas.map((conteudo, indice) => (indice === 0 ? conteudo : `${recuo}${conteudo}`));
}

function horaLocal(iso) {
  const data = iso ? new Date(iso) : new Date();
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/*
  Título do recibo. A comanda é identificada pela mesa: o número da comanda e
  o da mesa são o mesmo para quem está na cozinha, então ele sobe para o
  título em vez de ocupar duas linhas próprias.
*/
function tituloDoRecibo(conteudo, cabecalho) {
  if (conteudo.origem === 'delivery') return 'PEDIDO';
  if (conteudo.origem === 'conta') return 'FECHAMENTO DE CONTA';
  return cabecalho.numeroMesa ? `COMANDA ${cabecalho.numeroMesa}` : 'COMANDA';
}

/* Centavos viram "1.234,56". O servidor manda dinheiro sempre em centavos; a
   formatação é do papel, para não depender do locale de quem gravou. */
function dinheiro(centavos) {
  const total = Math.round(Number(centavos ?? 0));
  const sinal = total < 0 ? '-' : '';
  const absoluto = Math.abs(total);
  const reais = String(Math.trunc(absoluto / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sinal}${reais},${String(absoluto % 100).padStart(2, '0')}`;
}

/*
  Linha de conta: descrição à esquerda, valor colado na margem direita e
  pontinhos ligando os dois, para o olho não se perder no meio do papel.

  Descrição comprida demais não espreme o valor: ela quebra em cima e o valor
  desce sozinho, alinhado à direita.
*/
function linhaDeValor(descricao, valor, preenchimento = '.') {
  const esquerda = semAcento(descricao);
  const direita = semAcento(valor);
  if (esquerda.length + direita.length + 1 > COLUNAS) {
    return [...quebrar(esquerda, COLUNAS, '  '), direita.padStart(COLUNAS)];
  }
  return [`${esquerda}${preenchimento.repeat(COLUNAS - esquerda.length - direita.length)}${direita}`];
}

function cabecalhoConta(cabecalho) {
  const linhas = [];
  if (cabecalho.numeroMesa) linhas.push(`Mesa ${cabecalho.numeroMesa}`);
  if (cabecalho.observacaoComanda) {
    linhas.push(...quebrar(`OBS DA MESA: ${cabecalho.observacaoComanda}`, COLUNAS, '  '));
  }
  return linhas;
}

function cabecalhoComanda(cabecalho) {
  const linhas = [];
  if (cabecalho.garcom) linhas.push(`Garcom: ${cabecalho.garcom}`);
  // Recado da mesa inteira, por último no cabeçalho: é o que a cozinha não
  // pode deixar passar, como alergia.
  if (cabecalho.observacaoComanda) {
    linhas.push(...quebrar(`OBS DA MESA: ${cabecalho.observacaoComanda}`, COLUNAS, '  '));
  }
  return linhas;
}

function cabecalhoDelivery(cabecalho) {
  const linhas = [];
  if (cabecalho.pedido) linhas.push(`Pedido ${cabecalho.pedido}`);
  if (cabecalho.modalidade) linhas.push(cabecalho.modalidade);
  if (cabecalho.cliente) linhas.push(`Cliente: ${cabecalho.cliente}`);
  if (cabecalho.telefone) linhas.push(`Fone: ${cabecalho.telefone}`);
  if (cabecalho.endereco) linhas.push(...quebrar(`Endereco: ${cabecalho.endereco}`, COLUNAS, '  '));
  // Sem forma de pagamento: quem monta o prato não cobra.
  return linhas;
}

/*
  Monta o recibo inteiro de um trabalho. `trabalho.conteudo` é o JSON que o
  servidor gravou em `trabalhos_impressao.conteudo_json`.
*/
export function montarRecibo(trabalho) {
  const conteudo = trabalho.conteudo ?? {};
  const cabecalho = conteudo.cabecalho ?? {};
  const partes = [COMANDOS.inicializar, SELECIONAR_CP858];

  /* Único negrito do recibo: o título. Tudo abaixo sai em texto normal —
     com a folha inteira destacada, nada fica destacado. */
  partes.push(COMANDOS.alinharCentro, COMANDOS.fonteDupla, COMANDOS.negritoLigado);
  partes.push(linha(tituloDoRecibo(conteudo, cabecalho)));
  partes.push(COMANDOS.fonteNormal, COMANDOS.negritoDesligado, COMANDOS.alinharEsquerda);
  partes.push(separador());

  const linhasCabecalho = conteudo.origem === 'delivery'
    ? cabecalhoDelivery(cabecalho)
    : conteudo.origem === 'conta'
      ? cabecalhoConta(cabecalho)
      : cabecalhoComanda(cabecalho);
  for (const texto of linhasCabecalho) partes.push(linha(texto));
  partes.push(linha(horaLocal(conteudo.emitidoEm)));
  /* Sem "Setor": o papel sai na impressora daquele setor, então quem o pega
     já sabe de onde ele veio. */
  partes.push(separador());

  if (conteudo.origem === 'conta') {
    /* Conta do cliente: hora do lançamento, o que foi consumido e quanto
       custou, uma linha por item. Os adicionais entram logo abaixo porque já
       estão embutidos no preço — é o que explica o valor cobrado. A
       observação do item fica de fora: "sem cebola" é recado de cozinha, não
       item de conta. */
    for (const item of conteudo.itens ?? []) {
      const hora = item.hora ? `${item.hora} ` : '';
      const valor = `R$ ${dinheiro(item.totalCentavos)}`;
      for (const texto of linhaDeValor(`${hora}${item.quantidade}x ${item.nome}`, valor)) {
        partes.push(linha(texto));
      }
      for (const adicional of item.adicionais ?? []) {
        for (const texto of quebrar(`+ ${adicional}`, COLUNAS - 2, '     ')) {
          partes.push(linha(`  ${texto}`));
        }
      }
    }
    partes.push(separador());
    // O total é a única coisa que alguém confere de longe: vai em corpo
    // dobrado e em negrito, como o título.
    partes.push(COMANDOS.fonteDupla, COMANDOS.negritoLigado);
    partes.push(linha(`TOTAL: R$ ${dinheiro(conteudo.totalCentavos)}`));
    partes.push(COMANDOS.fonteNormal, COMANDOS.negritoDesligado);
  } else {
    for (const item of conteudo.itens ?? []) {
      for (const texto of quebrar(`${item.quantidade}x ${item.nome}`, COLUNAS, '   ')) {
        partes.push(linha(texto));
      }
      for (const adicional of item.adicionais ?? []) {
        for (const texto of quebrar(`+ ${adicional}`, COLUNAS - 2, '     ')) {
          partes.push(linha(`  ${texto}`));
        }
      }
      if (item.observacao) {
        for (const texto of quebrar(`OBS: ${item.observacao}`, COLUNAS - 2, '       ')) {
          partes.push(linha(`  ${texto}`));
        }
      }
      partes.push(linha());
    }
  }

  /* Fecha a lista e encerra. O número do trabalho não vai para o papel: quem
     precisa rastrear um recibo tem o log do agente ("Trabalho N impresso em
     ..."), e na cozinha ele só ocuparia linha. */
  partes.push(separador());
  // Avanço antes do corte: sem isso a última linha fica dentro da impressora.
  partes.push(linha(), linha(), linha());
  partes.push(COMANDOS.cortar);
  return Buffer.concat(partes);
}
