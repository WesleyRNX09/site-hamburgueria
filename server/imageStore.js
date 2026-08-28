import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

function erroUpload(mensagem, status = 400) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

function idTenant(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw erroUpload('O estabelecimento do upload é inválido.');
  return id;
}

function nomeImagemValido(nomeArquivo) {
  return /^(produto|logo|banner)-[a-f0-9-]+\.(jpg|png|webp)$/.test(nomeArquivo);
}

export function pastaUploadsEstabelecimento(pastaUploads, idEstabelecimento) {
  return join(pastaUploads, 'estabelecimentos', String(idTenant(idEstabelecimento)));
}

export async function salvarImagemDataUrl(imagem, pastaUploads, idEstabelecimento, prefixo = 'produto') {
  if (!imagem || !String(imagem).startsWith('data:')) return null;
  const tenantId = idTenant(idEstabelecimento);
  if (!['produto', 'logo', 'banner'].includes(prefixo)) throw erroUpload('O tipo da imagem é inválido.');

  const correspondencia = String(imagem).match(/^data:image\/(jpeg|jpg|png|webp);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!correspondencia) throw erroUpload('A imagem enviada é inválida.');

  const tipo = TIPOS[correspondencia[1]];
  const buffer = Buffer.from(correspondencia[2], 'base64');
  if (!buffer.length || buffer.length > TAMANHO_MAXIMO) {
    throw erroUpload('A imagem deve ter no máximo 1 MB após a otimização.', 413);
  }
  if (!tipo.validar(buffer)) throw erroUpload('O conteúdo da imagem não corresponde ao formato informado.');

  const pastaEstabelecimento = pastaUploadsEstabelecimento(pastaUploads, tenantId);
  await mkdir(pastaEstabelecimento, { recursive: true, mode: 0o750 });
  const nomeArquivo = `${prefixo}-${randomUUID()}.${tipo.extensao}`;
  await writeFile(join(pastaEstabelecimento, nomeArquivo), buffer, { flag: 'wx', mode: 0o640 });
  return `/uploads/estabelecimentos/${tenantId}/${nomeArquivo}`;
}

export async function removerImagemLocal(imagemUrl, pastaUploads, idEstabelecimento) {
  const tenantId = idTenant(idEstabelecimento);
  const url = String(imagemUrl ?? '');
  const isolada = url.match(/^\/uploads\/estabelecimentos\/(\d+)\/([^/]+)$/);
  if (isolada) {
    if (Number(isolada[1]) !== tenantId || !nomeImagemValido(isolada[2])) return false;
    await rm(join(pastaUploadsEstabelecimento(pastaUploads, tenantId), isolada[2]), { force: true });
    return true;
  }

  const legada = url.match(/^\/uploads\/([^/]+)$/);
  if (!legada || !nomeImagemValido(legada[1])) return false;
  await rm(join(pastaUploads, legada[1]), { force: true });
  return true;
}
