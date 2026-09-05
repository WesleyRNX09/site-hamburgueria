/*
  Vocabulário único de status de mesa, compartilhado pelo painel
  administrativo e pelo app do garçom: a mesma situação recebe o mesmo
  rótulo e a mesma cor nas duas telas.

  Os estados derivam do que o backend já devolve — `mesa.status`
  ("Livre" / "Ocupada") e `comanda.status` ("Aberta", "Na cozinha",
  "Conta solicitada") — e não criam nenhum estado novo no banco.

  "outro" só aparece no app do garçom, que enxerga apenas as próprias
  comandas: a mesa está ocupada, mas por outro funcionário.
*/

export const ESTADOS_MESA = [
  { chave: 'livre', rotulo: 'Livre' },
  { chave: 'aberta', rotulo: 'Comanda aberta' },
  { chave: 'cozinha', rotulo: 'Na cozinha' },
  { chave: 'conta', rotulo: 'Conta solicitada' },
  { chave: 'outro', rotulo: 'Outro atendimento' }
];

const ROTULOS = Object.fromEntries(ESTADOS_MESA.map((estado) => [estado.chave, estado.rotulo]));

export function statusDaMesa(mesa, comanda) {
  if (comanda) {
    if (comanda.status === 'Conta solicitada') return 'conta';
    if (comanda.status === 'Na cozinha') return 'cozinha';
    return 'aberta';
  }
  return mesa?.status === 'Ocupada' ? 'outro' : 'livre';
}

export function rotuloDoStatus(chave) {
  return ROTULOS[chave] ?? ROTULOS.livre;
}
