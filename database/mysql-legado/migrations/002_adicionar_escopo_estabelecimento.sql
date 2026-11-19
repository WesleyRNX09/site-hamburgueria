-- Expansão compatível: adiciona o escopo como nullable para não interromper
-- o backend atual durante a transição. Nenhum registro é removido ou recriado.

ALTER TABLE administradores
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE sessoes_admin
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER token_hash;
ALTER TABLE auditoria_admin
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE categorias
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE adicionais
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE produtos
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE produto_adicionais
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL FIRST;
ALTER TABLE promocoes
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE funcionarios
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE sessoes_garcom
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER token_hash;
ALTER TABLE mesas
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE comandas
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE comanda_itens
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE comanda_item_adicionais
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL FIRST;
ALTER TABLE pedidos
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE pedido_itens
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE pedido_item_adicionais
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL FIRST;
ALTER TABLE pagamentos
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE configuracoes
  ADD COLUMN id_estabelecimento BIGINT UNSIGNED NULL AFTER id;
