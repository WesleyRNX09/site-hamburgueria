/*
  Rascunho do formulário de produto. O formulário grava enquanto o
  administrador digita, então o que já foi preenchido sobrevive a uma ida aos
  adicionais (pelo botão do formulário ou pelo menu) e volta. Fica no
  sessionStorage: some ao fechar a aba, ao salvar ou ao cancelar, e nunca vai
  para o servidor. Qualquer falha de armazenamento (aba anônima, cota cheia) só
  faz o rascunho não sobreviver; o formulário continua normal.
*/
const PREFIXO = 'rascunho-produto:';
// Qual formulário tem rascunho em andamento, para a página de adicionais
// oferecer a volta mesmo quando se chega lá pelo menu.
const CHAVE_ULTIMO = `${PREFIXO}ultimo`;
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

export function caminhoFormularioProduto(idProduto) {
  return idProduto ? `/admin/cardapio/${idProduto}/editar` : '/admin/cardapio/novo';
}

function gravar(armazenamento, chave, dados) {
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

export function salvarRascunhoProduto(idProduto, dados, armazenamento = armazenamentoPadrao()) {
  if (!armazenamento) return false;
  if (!gravar(armazenamento, chaveRascunho(idProduto), dados)) return false;
  try {
    armazenamento.setItem(CHAVE_ULTIMO, caminhoFormularioProduto(idProduto));
  } catch {
    // Sem a marca, só a volta pelo menu deixa de aparecer.
  }
  return true;
}

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

export function descartarRascunhoProduto(idProduto, armazenamento = armazenamentoPadrao()) {
  if (!armazenamento) return;
  try {
    armazenamento.removeItem(chaveRascunho(idProduto));
    if (armazenamento.getItem(CHAVE_ULTIMO) === caminhoFormularioProduto(idProduto)) {
      armazenamento.removeItem(CHAVE_ULTIMO);
    }
  } catch {
    // Nada a fazer: sem armazenamento, não há rascunho.
  }
}

/* Só aceita voltar para o próprio formulário de produto, nunca para um
   caminho qualquer vindo do estado da navegação. */
export function caminhoVoltaProduto(caminho) {
  return typeof caminho === 'string' && CAMINHO_FORMULARIO.test(caminho) ? caminho : null;
}

/* Formulário com rascunho em andamento nesta aba, ou null. */
export function caminhoRascunhoPendente(armazenamento = armazenamentoPadrao()) {
  if (!armazenamento) return null;
  try {
    const caminho = caminhoVoltaProduto(armazenamento.getItem(CHAVE_ULTIMO));
    if (!caminho) return null;
    const id = /^\/admin\/cardapio\/(\d+)\/editar$/.exec(caminho)?.[1];
    return armazenamento.getItem(chaveRascunho(id)) ? caminho : null;
  } catch {
    return null;
  }
}
