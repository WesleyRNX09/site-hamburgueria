-- Índices e referências adicionados somente após o backfill.
-- As colunas permanecem nullable até o backend multiempresa controlar todas
-- as novas escritas; o fechamento NOT NULL será feito em migration posterior.

CREATE INDEX idx_administradores_estabelecimento ON administradores (id_estabelecimento);
CREATE INDEX idx_sessoes_admin_estabelecimento ON sessoes_admin (id_estabelecimento);
CREATE INDEX idx_auditoria_admin_estabelecimento ON auditoria_admin (id_estabelecimento);
CREATE INDEX idx_categorias_estabelecimento ON categorias (id_estabelecimento);
CREATE INDEX idx_adicionais_estabelecimento ON adicionais (id_estabelecimento);
CREATE INDEX idx_produtos_estabelecimento ON produtos (id_estabelecimento);
CREATE INDEX idx_produto_adicionais_estabelecimento ON produto_adicionais (id_estabelecimento);
CREATE INDEX idx_promocoes_estabelecimento ON promocoes (id_estabelecimento);
CREATE INDEX idx_funcionarios_estabelecimento ON funcionarios (id_estabelecimento);
CREATE INDEX idx_sessoes_garcom_estabelecimento ON sessoes_garcom (id_estabelecimento);
CREATE INDEX idx_mesas_estabelecimento ON mesas (id_estabelecimento);
CREATE INDEX idx_comandas_estabelecimento ON comandas (id_estabelecimento);
CREATE INDEX idx_comanda_itens_estabelecimento ON comanda_itens (id_estabelecimento);
CREATE INDEX idx_comanda_item_adicionais_estabelecimento
  ON comanda_item_adicionais (id_estabelecimento);
CREATE INDEX idx_pedidos_estabelecimento ON pedidos (id_estabelecimento);
CREATE INDEX idx_pedido_itens_estabelecimento ON pedido_itens (id_estabelecimento);
CREATE INDEX idx_pedido_item_adicionais_estabelecimento
  ON pedido_item_adicionais (id_estabelecimento);
CREATE INDEX idx_pagamentos_estabelecimento ON pagamentos (id_estabelecimento);
CREATE INDEX idx_configuracoes_estabelecimento_legado ON configuracoes (id_estabelecimento);

ALTER TABLE administradores
  ADD CONSTRAINT fk_administradores_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE sessoes_admin
  ADD CONSTRAINT fk_sessoes_admin_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE auditoria_admin
  ADD CONSTRAINT fk_auditoria_admin_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE categorias
  ADD CONSTRAINT fk_categorias_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE adicionais
  ADD CONSTRAINT fk_adicionais_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE produtos
  ADD CONSTRAINT fk_produtos_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE produto_adicionais
  ADD CONSTRAINT fk_produto_adicionais_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE promocoes
  ADD CONSTRAINT fk_promocoes_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE funcionarios
  ADD CONSTRAINT fk_funcionarios_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE sessoes_garcom
  ADD CONSTRAINT fk_sessoes_garcom_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE mesas
  ADD CONSTRAINT fk_mesas_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE comandas
  ADD CONSTRAINT fk_comandas_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE comanda_itens
  ADD CONSTRAINT fk_comanda_itens_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE comanda_item_adicionais
  ADD CONSTRAINT fk_comanda_item_adicionais_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE pedidos
  ADD CONSTRAINT fk_pedidos_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE pedido_itens
  ADD CONSTRAINT fk_pedido_itens_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE pedido_item_adicionais
  ADD CONSTRAINT fk_pedido_item_adicionais_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE pagamentos
  ADD CONSTRAINT fk_pagamentos_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
ALTER TABLE configuracoes
  ADD CONSTRAINT fk_configuracoes_estabelecimento_legado
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
