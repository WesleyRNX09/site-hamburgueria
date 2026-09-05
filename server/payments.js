/*
  Camada de pagamento do caixa.

  Hoje existe um único provedor — `manual` —, que é o caixa recebendo em
  dinheiro, no cartão da maquininha ou por Pix conferido na hora. Ele apenas
  valida a forma escolhida e calcula, no servidor, o valor recebido e o
  troco: o navegador nunca decide quanto foi pago.

  O ponto de extensão para uma integração futura (Mercado Pago, Stone, Pix
  automático, etc.) é `PROVEDORES`. Um provedor novo recebe os mesmos dados
  e devolve o mesmo formato — inclusive `referenciaExterna`, que é onde fica
  o identificador da transação no gateway e já tem coluna própria em
  `pagamentos`. Assim, ligar um gateway não muda as telas, o fechamento da
  comanda nem o esquema do banco.
*/

// Formas aceitas no salão. Delivery e retirada continuam com as próprias
// listas em operations.js — aqui é só o pagamento presencial da comanda.
export const PAGAMENTOS_PRESENCIAIS = new Set(['Pix', 'Cartão', 'Dinheiro']);

export const PROVEDOR_PADRAO = 'manual';

function erroPagamento(mensagem, status = 400) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

/*
  `valorRecebidoCentavos` só faz sentido em dinheiro: é o que o cliente
  entregou. Quando não vem informado, assume-se o valor exato da conta.
*/
function prepararPagamentoManual({ forma, totalCentavos, valorRecebidoCentavos }) {
  if (!PAGAMENTOS_PRESENCIAIS.has(forma)) {
    throw erroPagamento('Selecione uma forma de pagamento válida.');
  }
  if (!Number.isSafeInteger(totalCentavos) || totalCentavos < 0) {
    throw erroPagamento('Valor da comanda inválido para pagamento.');
  }

  if (forma !== 'Dinheiro') {
    return {
      provedor: PROVEDOR_PADRAO,
      status: 'Pago',
      forma,
      valorCentavos: totalCentavos,
      valorRecebidoCentavos: null,
      trocoCentavos: null,
      referenciaExterna: null
    };
  }

  const recebido = valorRecebidoCentavos == null || valorRecebidoCentavos === ''
    ? totalCentavos
    : Number(valorRecebidoCentavos);
  if (!Number.isSafeInteger(recebido) || recebido < 0) {
    throw erroPagamento('Informe um valor recebido válido.');
  }
  if (recebido < totalCentavos) {
    throw erroPagamento('O valor recebido é menor que o total da conta.');
  }

  return {
    provedor: PROVEDOR_PADRAO,
    status: 'Pago',
    forma,
    valorCentavos: totalCentavos,
    valorRecebidoCentavos: recebido,
    trocoCentavos: recebido - totalCentavos,
    referenciaExterna: null
  };
}

const PROVEDORES = new Map([
  [PROVEDOR_PADRAO, prepararPagamentoManual]
]);

/*
  Resolve o provedor e devolve o pagamento já calculado. Um provedor externo
  futuro será assíncrono (chamada de rede); por isso a função é async desde
  agora e quem chama já trata a espera.
*/
export async function prepararPagamentoComanda({
  provedor = PROVEDOR_PADRAO,
  forma,
  totalCentavos,
  valorRecebidoCentavos = null
}) {
  const preparar = PROVEDORES.get(provedor);
  if (!preparar) throw erroPagamento('Provedor de pagamento não configurado.', 501);
  return preparar({ forma, totalCentavos, valorRecebidoCentavos });
}
