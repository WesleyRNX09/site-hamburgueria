-- Recibo de fechamento de conta: um terceiro tipo de trabalho de impressão.
--
-- Até aqui a fila só conhecia 'comanda' (o que a cozinha prepara) e 'delivery'
-- (o pedido que sai para entrega). O fechamento no caixa gera um papel de
-- natureza diferente: o histórico inteiro da mesa com preços e total, para o
-- cliente conferir. Ele sai na impressora marcada como caixa (migration 022),
-- e não na praça de preparo.
--
-- A constraint de origem precisa aceitar o valor novo. Confirmado em
-- SHOW CREATE TABLE que o nome real é `chk_trabalhos_impressao_origem`.
--
-- DROP CONSTRAINT, e não DROP CHECK: `DROP CHECK` é sintaxe do MySQL 8.0.16+ e
-- não está documentada no MariaDB, que é o motor de produção (11.8).
-- `DROP CONSTRAINT` vale nos dois (MySQL 8.0.19+ e MariaDB 10.2+). Em duas
-- instruções separadas para nenhum motor ter que resolver a remoção e a
-- recriação do mesmo nome dentro de um único ALTER.
--
-- Nada é reescrito: os trabalhos já gravados continuam válidos, porque
-- 'comanda' e 'delivery' seguem na lista.

ALTER TABLE trabalhos_impressao
  DROP CONSTRAINT chk_trabalhos_impressao_origem;

ALTER TABLE trabalhos_impressao
  ADD CONSTRAINT chk_trabalhos_impressao_origem
    CHECK (origem IN ('comanda', 'delivery', 'conta'));
