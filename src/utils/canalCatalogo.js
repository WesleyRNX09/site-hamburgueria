/*
  Onde cada categoria e cada produto aparece. O cardápio online e o salão
  dividem o mesmo catálogo, mas a loja física vende mais coisa do que o site —
  chopp, porções, itens que só fazem sentido na mesa. Este é o mesmo vocabulário
  gravado na coluna `canal` do banco, para o painel e o backend falarem igual.

  A visibilidade real é a interseção entre produto e categoria: um produto
  marcado "nos dois" dentro de uma categoria "só salão" não chega ao site.
*/
export const CANAIS_CATALOGO = [
  {
    valor: 'ambos',
    rotulo: 'Cardápio online e salão',
    curto: 'Nos dois',
    ajuda: 'Aparece para o cliente no site e para o garçom na comanda.'
  },
  {
    valor: 'online',
    rotulo: 'Somente cardápio online',
    curto: 'Só online',
    ajuda: 'Só o cliente vê no site. Útil para combos de entrega.'
  },
  {
    valor: 'salao',
    rotulo: 'Somente salão (mesas e comandas)',
    curto: 'Só salão',
    ajuda: 'Só o garçom vê ao lançar itens na mesa. Não aparece no site.'
  }
];

const PADRAO = CANAIS_CATALOGO[0];

export function canalCatalogo(valor) {
  return CANAIS_CATALOGO.find((canal) => canal.valor === valor) ?? PADRAO;
}

export function rotuloCanal(valor) {
  return canalCatalogo(valor).curto;
}
