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

const ACENTOS = new Map(Object.entries({
  á: 'a', à: 'a', ã: 'a', â: 'a', ä: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', õ: 'o', ô: 'o', ö: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ç: 'c', ñ: 'n',
  Á: 'A', À: 'A', Ã: 'A', Â: 'A', Ä: 'A',
  É: 'E', È: 'E', Ê: 'E', Ë: 'E',
  Í: 'I', Ì: 'I', Î: 'I', Ï: 'I',
  Ó: 'O', Ò: 'O', Õ: 'O', Ô: 'O', Ö: 'O',
  Ú: 'U', Ù: 'U', Û: 'U', Ü: 'U',
  Ç: 'C', Ñ: 'N'
}));

/* Impressora antiga que ignore a página de código ainda imprime algo legível:
   o texto perde o acento, não a palavra. Fora da tabela ASCII e sem
   equivalente conhecido, o caractere vira '?' em vez de virar lixo no papel. */
function semAcento(texto) {
  return String(texto ?? '')
    .split('')
    .map((caractere) => (
      caractere.codePointAt(0) < 128 ? caractere : ACENTOS.get(caractere) ?? '?'
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

function cabecalhoComanda(cabecalho) {
  const linhas = [];
  if (cabecalho.mesa) linhas.push(cabecalho.mesa);
  if (cabecalho.garcom) linhas.push(`Garcom: ${cabecalho.garcom}`);
  return linhas;
}

function cabecalhoDelivery(cabecalho) {
  const linhas = [];
  if (cabecalho.pedido) linhas.push(`Pedido ${cabecalho.pedido}`);
  if (cabecalho.modalidade) linhas.push(cabecalho.modalidade);
  if (cabecalho.cliente) linhas.push(`Cliente: ${cabecalho.cliente}`);
  if (cabecalho.telefone) linhas.push(`Fone: ${cabecalho.telefone}`);
  if (cabecalho.endereco) linhas.push(...quebrar(`Endereco: ${cabecalho.endereco}`, COLUNAS, '  '));
  if (cabecalho.pagamento) linhas.push(`Pagamento: ${cabecalho.pagamento}`);
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

  partes.push(COMANDOS.alinharCentro, COMANDOS.fonteDupla, COMANDOS.negritoLigado);
  partes.push(linha(conteudo.origem === 'delivery' ? 'PEDIDO' : 'COMANDA'));
  partes.push(COMANDOS.fonteNormal, COMANDOS.negritoDesligado, COMANDOS.alinharEsquerda);
  partes.push(separador());

  const linhasCabecalho = conteudo.origem === 'delivery'
    ? cabecalhoDelivery(cabecalho)
    : cabecalhoComanda(cabecalho);
  for (const texto of linhasCabecalho) partes.push(linha(texto));
  partes.push(linha(horaLocal(conteudo.emitidoEm)));
  if (conteudo.impressora) partes.push(linha(`Setor: ${conteudo.impressora}`));
  partes.push(separador());

  for (const item of conteudo.itens ?? []) {
    partes.push(COMANDOS.negritoLigado);
    for (const texto of quebrar(`${item.quantidade}x ${item.nome}`, COLUNAS, '   ')) {
      partes.push(linha(texto));
    }
    partes.push(COMANDOS.negritoDesligado);
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

  partes.push(separador());
  partes.push(linha(`Trabalho #${trabalho.id}`));
  // Avanço antes do corte: sem isso a última linha fica dentro da impressora.
  partes.push(linha(), linha(), linha());
  partes.push(COMANDOS.cortar);
  return Buffer.concat(partes);
}
