/*
  Vocabulário único de status de mesa, compartilhado pelo painel
  administrativo e pelo app do garçom: a mesma situação recebe o mesmo
  rótulo e a mesma cor nas duas telas.

  Os estados derivam do que o backend já devolve — `mesa.status`
  ("Livre" / "Ocupada") e `comanda.status` ("Aberta", "Na cozinha",
  "Conta solicitada") — e não criam nenhum estado novo no banco.

  "outro" é a folga entre uma leitura e outra: a mesa consta como ocupada
  mas a comanda correspondente ainda não chegou na lista. Painel e app do
  garçom enxergam todas as comandas do estabelecimento, então ele some assim
  que os dados se alinham.

  "pendente" não é um status novo no banco: é a comanda aberta que ainda
  tem item sem lançar para a cozinha, derivado dos itens que o backend já
  devolve (`item.enviado`). Ele ganha cor própria porque é a única situação
  da grade que exige uma ação do salão.
*/

export const ESTADOS_MESA = [
  { chave: 'livre', rotulo: 'Livre' },
  { chave: 'aberta', rotulo: 'Comanda aberta' },
  { chave: 'pendente', rotulo: 'Pedido não lançado' },
  { chave: 'cozinha', rotulo: 'Na cozinha' },
  { chave: 'conta', rotulo: 'Conta solicitada' },
  { chave: 'outro', rotulo: 'Outro atendimento' }
];

const ROTULOS = Object.fromEntries(ESTADOS_MESA.map((estado) => [estado.chave, estado.rotulo]));

export function temItemPendente(comanda) {
  return Boolean(comanda?.itens?.some((item) => !item.enviado));
}

export function statusDaMesa(mesa, comanda) {
  if (comanda) {
    if (comanda.status === 'Conta solicitada') return 'conta';
    if (temItemPendente(comanda)) return 'pendente';
    if (comanda.status === 'Na cozinha') return 'cozinha';
    return 'aberta';
  }
  return mesa?.status === 'Ocupada' ? 'outro' : 'livre';
}

export function rotuloDoStatus(chave) {
  return ROTULOS[chave] ?? ROTULOS.livre;
}
