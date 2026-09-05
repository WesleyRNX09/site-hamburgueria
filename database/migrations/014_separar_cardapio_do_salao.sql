-- Separa o que aparece no cardápio online do que aparece no salão.
--
-- A loja física vende mais coisa do que o site: chopp, porções e itens que só
-- fazem sentido na mesa. Até aqui categoria e produto eram únicos e apareciam
-- nos dois lugares, então incluir um item do salão sujava o cardápio online.
--
-- `canal` responde onde cada registro aparece:
--   * `ambos`  — cardápio online e salão (é o padrão, e é o que todo registro
--     existente recebe: nada muda no site que já está no ar);
--   * `online` — só o cardápio online, para combos de entrega;
--   * `salao`  — só o app do garçom e as comandas de mesa.
--
-- A visibilidade é a interseção entre produto e categoria: um produto `ambos`
-- dentro de uma categoria `salao` não vaza para o online. É por isso que o
-- filtro sempre olha as duas colunas, e não só a do produto.
--
-- Coluna nova com DEFAULT, sem reescrever linha nenhuma: o cardápio online
-- continua exatamente como está até o administrador marcar algo como `salao`.

ALTER TABLE categorias
  ADD COLUMN canal VARCHAR(10) NOT NULL DEFAULT 'ambos' AFTER nome,
  ADD CONSTRAINT chk_categorias_canal CHECK (canal IN ('ambos', 'online', 'salao'));

ALTER TABLE produtos
  ADD COLUMN canal VARCHAR(10) NOT NULL DEFAULT 'ambos' AFTER categoria_id,
  ADD CONSTRAINT chk_produtos_canal CHECK (canal IN ('ambos', 'online', 'salao'));
