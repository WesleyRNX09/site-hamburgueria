const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'image/webp'];
const TAMANHO_MAXIMO_ARQUIVO = 8 * 1024 * 1024;
const TAMANHO_MAXIMO_IMAGEM = 1200;
const TAMANHO_MAXIMO_DATA_URL = 850_000;

const ERRO_LEITURA = 'Não foi possível ler a imagem selecionada.';

/*
  Lê o arquivo como data: URL, e não como blob: (URL.createObjectURL). A CSP de
  produção (server/app.js) libera imagens só de 'self' e data:; um blob: é
  bloqueado pelo navegador e o upload falhava só em produção, onde a CSP é
  enviada. Ler como data: mantém a política estrita sem abrir exceção.
*/
function lerComoDataUrl(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () => reject(new Error(ERRO_LEITURA));
    leitor.readAsDataURL(arquivo);
  });
}

async function carregarImagem(arquivo) {
  const dataUrl = await lerComoDataUrl(arquivo);
  return new Promise((resolve, reject) => {
    const imagem = new Image();
    imagem.onload = () => resolve(imagem);
    imagem.onerror = () => reject(new Error(ERRO_LEITURA));
    imagem.src = dataUrl;
  });
}

export async function otimizarImagemProduto(arquivo) {
  if (!TIPOS_ACEITOS.includes(arquivo.type)) {
    throw new Error('Use uma imagem JPG, PNG ou WebP.');
  }

  if (arquivo.size > TAMANHO_MAXIMO_ARQUIVO) {
    throw new Error('A imagem deve ter no máximo 8 MB.');
  }

  const imagem = await carregarImagem(arquivo);
  const escala = Math.min(1, TAMANHO_MAXIMO_IMAGEM / Math.max(imagem.naturalWidth, imagem.naturalHeight));
  const largura = Math.max(1, Math.round(imagem.naturalWidth * escala));
  const altura = Math.max(1, Math.round(imagem.naturalHeight * escala));
  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;

  const contexto = canvas.getContext('2d');
  contexto.drawImage(imagem, 0, 0, largura, altura);

  let resultado = canvas.toDataURL('image/webp', 0.82);
  if (resultado.length > TAMANHO_MAXIMO_DATA_URL) {
    resultado = canvas.toDataURL('image/webp', 0.65);
  }

  if (resultado.length > TAMANHO_MAXIMO_DATA_URL) {
    throw new Error('A imagem ainda ficou muito grande. Escolha uma foto menor.');
  }

  return resultado;
}
