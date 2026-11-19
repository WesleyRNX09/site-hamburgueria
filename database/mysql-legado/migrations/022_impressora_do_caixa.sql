-- Marca uma impressora como a "impressora do caixa" do estabelecimento.
--
-- As impressoras cadastradas até aqui são todas de produção: cozinha, bar,
-- chapa. Falta dizer qual delas fica no caixa — a que atende o balcão, e não
-- uma praça de preparo.
--
-- Só uma por estabelecimento. Quem garante isso é a aplicação, dentro da mesma
-- transação que grava: marcar uma impressora zera as demais da loja. O MySQL
-- não tem índice único parcial ("único entre as linhas com eh_caixa = 1"), e
-- um UNIQUE (id_estabelecimento, eh_caixa) barraria ter duas impressoras
-- comuns na mesma loja, que é o caso normal.
--
-- DEFAULT 0 e NOT NULL: toda impressora existente continua como está, nenhuma
-- loja ganha impressora de caixa sem alguém escolher.

ALTER TABLE impressoras
  ADD COLUMN eh_caixa TINYINT(1) NOT NULL DEFAULT 0 AFTER ativa;

-- A busca é sempre "a impressora de caixa desta loja": o índice cobre
-- exatamente isso, sem impor unicidade.
ALTER TABLE impressoras
  ADD INDEX idx_impressoras_caixa (id_estabelecimento, eh_caixa);
