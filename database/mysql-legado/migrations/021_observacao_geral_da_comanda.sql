-- Observação geral da comanda, separada da observação de cada item.
--
-- Até aqui só o item tinha recado ("sem cebola", "ponto da carne"). O que vale
-- para a mesa inteira — aniversário, alergia, cliente com pressa, juntar duas
-- mesas — não tinha onde ser escrito e acabava só no combinado verbal entre
-- garçom e cozinha.
--
-- TEXT NULL e sem DEFAULT: nenhuma comanda existente é reescrita, e comanda sem
-- observação continua sendo o caso normal. O limite real (500 caracteres) é
-- aplicado no servidor, que também faz o trim; a coluna é TEXT para acompanhar
-- `comanda_itens.observacao` em vez de criar um segundo formato de recado.

ALTER TABLE comandas
  ADD COLUMN observacao TEXT NULL AFTER pagamento;
