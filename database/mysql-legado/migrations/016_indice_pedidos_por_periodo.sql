-- Índice para os indicadores do dashboard por período.
--
-- Ticket médio e produtos mais vendidos filtram `pedidos` pelo
-- estabelecimento e por um intervalo de `criado_em`. Até aqui havia um índice
-- para cada coluna, e o banco só conseguia usar um deles por vez. O índice
-- composto atende os dois filtros juntos.
--
-- Não remove `idx_pedidos_estabelecimento` nem `idx_pedidos_criado_em`: o
-- primeiro sustenta a chave estrangeira e outras consultas; o segundo, as
-- ordenações por data. Sintaxe válida em MySQL 8 e MariaDB.

CREATE INDEX idx_pedidos_estabelecimento_criado_em
  ON pedidos (id_estabelecimento, criado_em);
