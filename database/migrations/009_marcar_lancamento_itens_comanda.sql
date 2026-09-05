-- Marca, item a item, o momento em que a comanda foi lançada para a cozinha.
-- Item ainda não lançado fica com enviado_em NULL e aparece destacado nas
-- telas de mesa, que passam a exigir confirmação antes do lançamento.
-- Nenhum registro é removido: o backfill apenas considera já lançado o que
-- pertencia a uma comanda enviada, mantendo o histórico existente coerente.

ALTER TABLE comanda_itens
  ADD COLUMN enviado_em DATETIME NULL AFTER criado_em;

UPDATE comanda_itens ci
INNER JOIN comandas c
  ON c.id = ci.comanda_id
  AND c.id_estabelecimento = ci.id_estabelecimento
SET ci.enviado_em = ci.criado_em
WHERE ci.enviado_em IS NULL
  AND c.status IN ('Na cozinha', 'Conta solicitada', 'Encerrada');
