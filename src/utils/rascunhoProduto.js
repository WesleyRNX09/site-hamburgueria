/*
  Rascunho do formulário de produto enquanto o administrador sai para
  "Gerenciar adicionais" e volta. Fica no sessionStorage: some ao fechar a aba
  e nunca vai para o servidor. Qualquer falha de armazenamento (aba anônima,
  cota cheia) só faz o rascunho não sobreviver; o formulário continua normal.
*/
const PREFIXO = 'rascunho-produto:';
const CAMINHO_FORMULARIO = /^\/admin\/cardapio\/(?:novo|\d+\/editar)$/;

function armazenamentoPadrao() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function chaveRascunho(idProduto) {
  return `${PREFIXO}${idProduto ? String(idProduto) : 'novo'}`;
}

export function salvarRascunhoProduto(idProduto, dados, armazenamento = armazenamentoPadrao()) {
  if (!armazenamento) return false;
  const chave = chaveRascunho(idProduto);
  try {
    armazenamento.setItem(chave, JSON.stringify(dados));
    return true;
  } catch {
    // Foto em data: URL pode estourar a cota: guarda o resto sem ela.
    try {
      armazenamento.setItem(chave, JSON.stringify({ ...dados, imagem: '' }));
      return true;
    } catch {
      return false;
    }
  }
}

/* Só lê. Quem abre o formulário apaga depois de montar (descartarRascunho),
   porque o React pode chamar o inicializador do estado mais de uma vez. */
export function lerRascunhoProduto(idProduto, armazenamento = armazenamentoPadrao()) {
  if (!armazenamento) return null;
  try {
    const texto = armazenamento.getItem(chaveRascunho(idProduto));
    if (!texto) return null;
    const dados = JSON.parse(texto);
    return dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : null;
  } catch {
    return null;
  }
}

/* Lê e já remove: o rascunho vale para uma volta só, não para sempre. */
export function recuperarRascunhoProduto(idProduto, armazenamento = armazenamentoPadrao()) {
  const dados = lerRascunhoProduto(idProduto, armazenamento);
  descartarRascunhoProduto(idProduto, armazenamento);
  return dados;
}

export function descartarRascunhoProduto(idProduto, armazenamento = armazenamentoPadrao()) {
  try {
    armazenamento?.removeItem(chaveRascunho(idProduto));
  } catch {
    // Nada a fazer: sem armazenamento, não há rascunho.
  }
}

/* Só aceita voltar para o próprio formulário de produto, nunca para um
   caminho qualquer vindo do estado da navegação. */
export function caminhoVoltaProduto(caminho) {
  return typeof caminho === 'string' && CAMINHO_FORMULARIO.test(caminho) ? caminho : null;
}
