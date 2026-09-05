# Pagamentos da comanda

## Como funciona hoje

O fechamento da comanda acontece no painel administrativo, em **Mesas /
Comandas → Finalizar comanda**. O modal de pagamento mostra o total da conta,
as formas habilitadas nas configurações do estabelecimento e, quando a forma é
**Dinheiro**, um campo para o valor recebido do cliente.

Quem calcula é o servidor:

1. `finalizarComandaAdmin` (`server/operations.js`) recopia os itens da comanda
   para o pedido e obtém o total em centavos a partir do banco.
2. `prepararPagamentoComanda` (`server/payments.js`) valida a forma escolhida,
   confere se o valor recebido cobre a conta e devolve o troco em centavos.
3. O pagamento é gravado em `pagamentos` com `valor_centavos`,
   `valor_recebido_centavos`, `troco_centavos`, `provedor` e
   `referencia_externa`, dentro da mesma transação que encerra a comanda.

O navegador envia apenas a forma e o valor digitado pelo caixa. O troco exibido
depois da confirmação é o que voltou do servidor — nunca o calculado na tela.

## Ligando um gateway de pagamento no futuro

O ponto de extensão é o mapa `PROVEDORES` em `server/payments.js`. Hoje ele tem
um único provedor, `manual` (dinheiro, cartão na maquininha, Pix conferido na
hora). Para integrar um gateway:

1. Escreva a função do provedor com a mesma assinatura de
   `prepararPagamentoManual`, podendo ser assíncrona (chamada de rede):

   ```js
   async function prepararPagamentoGateway({ forma, totalCentavos, valorRecebidoCentavos }) {
     // chama a API do gateway e devolve o mesmo formato
     return {
       provedor: 'gateway-x',
       status: 'Pago',            // ou 'Aguardando pagamento' em fluxo assíncrono
       forma,
       valorCentavos: totalCentavos,
       valorRecebidoCentavos: null,
       trocoCentavos: null,
       referenciaExterna: '<id da transação no gateway>'
     };
   }
   ```

2. Registre-o em `PROVEDORES` com a chave do provedor.
3. Envie `provedor` no fechamento (a rota já repassa o campo para
   `finalizarComandaAdmin`).

A coluna `referencia_externa` guarda o identificador da transação, e o índice
`idx_pagamentos_referencia_externa` permite localizar o pagamento a partir de um
webhook do gateway. Nada disso exige mudança de esquema, de tela ou do fluxo da
comanda.

### Cuidados obrigatórios

- Credenciais do gateway ficam no `.env`, nunca no código nem no banco.
- O valor cobrado é sempre o total calculado no servidor, jamais o enviado pelo
  navegador.
- Todo acesso continua isolado por `id_estabelecimento`: cada estabelecimento
  responde pelos próprios pagamentos e pelas próprias credenciais.
- Um fluxo assíncrono (Pix com confirmação por webhook, por exemplo) deve
  gravar o pagamento como `Aguardando pagamento` e só encerrar a comanda quando
  a confirmação chegar.
