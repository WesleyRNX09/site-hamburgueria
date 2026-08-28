import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const TAMANHO_MAXIMO = 1024 * 1024;
const TIPOS = {
  jpeg: { extensao: 'jpg', validar: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  jpg: { extensao: 'jpg', validar: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  png: { extensao: 'png', validar: (buffer) => buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  webp: {
    extensao: 'webp',
    validar: (buffer) => buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
  }
};

export async function salvarImagemDataUrl(imagem, pastaUploads, prefixo = 'produto') {
  if (!imagem || !String(imagem).startsWith('data:')) return null;

  const correspondencia = String(imagem).match(/^data:image\/(jpeg|jpg|png|webp);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!correspondencia) throw new Error('A imagem enviada é inválida.');

  const tipo = TIPOS[correspondencia[1]];
  const buffer = Buffer.from(correspondencia[2], 'base64');
  if (!buffer.length || buffer.length > TAMANHO_MAXIMO) throw new Error('A imagem deve ter no máximo 1 MB após a otimização.');
  if (!tipo.validar(buffer)) throw new Error('O conteúdo da imagem não corresponde ao formato informado.');

  await mkdir(pastaUploads, { recursive: true });
  if (!['produto', 'logo', 'banner'].includes(prefixo)) throw new Error('O tipo da imagem é inválido.');
  const nomeArquivo = `${prefixo}-${randomUUID()}.${tipo.extensao}`;
  await writeFile(join(pastaUploads, nomeArquivo), buffer, { flag: 'wx' });
  return `/uploads/${nomeArquivo}`;
}

export async function removerImagemLocal(imagemUrl, pastaUploads) {
  if (!String(imagemUrl ?? '').startsWith('/uploads/')) return;
  const nomeArquivo = basename(imagemUrl);
  if (!/^(produto|logo|banner)-[a-f0-9-]+\.(jpg|png|webp)$/.test(nomeArquivo)) return;
  await rm(join(pastaUploads, nomeArquivo), { force: true });
}
