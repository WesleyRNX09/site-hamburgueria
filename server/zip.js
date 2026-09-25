import { crc32, deflateRawSync } from 'node:zlib';

/*
  Gerador mínimo de arquivo .zip, sem dependência externa: cada entrada é
  comprimida com deflate (node:zlib) e o índice central é montado à mão,
  seguindo o formato PKWARE (APPNOTE 6.3). Sem ZIP64: o arquivo inteiro e cada
  entrada precisam ficar abaixo de 4 GiB e de 65 535 entradas — acima disso a
  montagem é recusada, em vez de gerar um arquivo corrompido.

  Usado pela exportação dos dados de um estabelecimento arquivado.
*/

const LIMITE_32_BITS = 0xFFFFFFFF;
const LIMITE_ENTRADAS = 0xFFFF;
const FLAG_NOME_UTF8 = 0x0800;
const METODO_DEFLATE = 8;
const VERSAO = 20;

function dataDos(data) {
  const ano = Math.max(1980, data.getFullYear());
  return {
    hora: (data.getHours() << 11) | (data.getMinutes() << 5) | Math.floor(data.getSeconds() / 2),
    dia: ((ano - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate()
  };
}

function nomeSeguro(nome) {
  const texto = String(nome ?? '');
  // Caminho relativo, com barras normais, sem subir de pasta nem começar na raiz.
  if (!texto || texto.startsWith('/') || texto.includes('\\')
      || texto.split('/').some((parte) => parte === '' || parte === '.' || parte === '..')) {
    throw new Error(`Nome de entrada inválido no arquivo compactado: ${texto}`);
  }
  return texto;
}

/**
 * @param {{ nome: string, conteudo: Buffer | string }[]} entradas
 * @param {{ data?: Date }} [opcoes]
 * @returns {Buffer}
 */
export function criarZip(entradas, { data = new Date() } = {}) {
  if (!Array.isArray(entradas) || entradas.length > LIMITE_ENTRADAS) {
    throw new Error('Quantidade de entradas inválida para o arquivo compactado.');
  }
  const { hora, dia } = dataDos(data);
  const nomesUsados = new Set();
  const locais = [];
  const centrais = [];
  let deslocamento = 0;

  for (const entrada of entradas) {
    const nome = nomeSeguro(entrada.nome);
    if (nomesUsados.has(nome)) throw new Error(`Entrada repetida no arquivo compactado: ${nome}`);
    nomesUsados.add(nome);
    const nomeBytes = Buffer.from(nome, 'utf8');
    const original = Buffer.isBuffer(entrada.conteudo)
      ? entrada.conteudo
      : Buffer.from(String(entrada.conteudo ?? ''), 'utf8');
    const comprimido = deflateRawSync(original);
    if (original.length > LIMITE_32_BITS || comprimido.length > LIMITE_32_BITS) {
      throw new Error(`Arquivo grande demais para o formato do arquivo compactado: ${nome}`);
    }
    const crc = crc32(original) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(VERSAO, 4);
    local.writeUInt16LE(FLAG_NOME_UTF8, 6);
    local.writeUInt16LE(METODO_DEFLATE, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(original.length, 22);
    local.writeUInt16LE(nomeBytes.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(VERSAO, 4);
    central.writeUInt16LE(VERSAO, 6);
    central.writeUInt16LE(FLAG_NOME_UTF8, 8);
    central.writeUInt16LE(METODO_DEFLATE, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(dia, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(original.length, 24);
    central.writeUInt16LE(nomeBytes.length, 28);
    // Comentário, disco inicial e atributos internos ficam em zero.
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(deslocamento, 42);

    locais.push(local, nomeBytes, comprimido);
    centrais.push(central, nomeBytes);
    deslocamento += local.length + nomeBytes.length + comprimido.length;
    if (deslocamento > LIMITE_32_BITS) throw new Error('Arquivo compactado grande demais.');
  }

  const tamanhoCentral = centrais.reduce((soma, parte) => soma + parte.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054B50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(tamanhoCentral, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, ...centrais, fim]);
}
