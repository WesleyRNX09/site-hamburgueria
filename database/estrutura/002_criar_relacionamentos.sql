-- Relacionamentos da estrutura multiempresa em transição.

ALTER TABLE configuracoes_estabelecimento
  ADD CONSTRAINT fk_configuracoes_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;

ALTER TABLE sessoes_superadmin
  ADD CONSTRAINT fk_sessoes_superadmin_usuario
  FOREIGN KEY (superadministrador_id)
  REFERENCES superadministradores(id) ON DELETE CASCADE;

ALTER TABLE auditoria_superadmin
  ADD CONSTRAINT fk_auditoria_superadmin_usuario
    FOREIGN KEY (superadministrador_id)
    REFERENCES superadministradores(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_auditoria_superadmin_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE SET NULL;

ALTER TABLE administradores
  ADD CONSTRAINT fk_administradores_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;

ALTER TABLE sessoes_admin
  ADD CONSTRAINT fk_sessoes_admin_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessoes_admin_administrador
  FOREIGN KEY (administrador_id) REFERENCES administradores(id) ON DELETE CASCADE;

ALTER TABLE auditoria_admin
  ADD CONSTRAINT fk_auditoria_admin_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_admin_administrador
  FOREIGN KEY (administrador_id) REFERENCES administradores(id) ON DELETE SET NULL;

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
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produtos_categoria
  FOREIGN KEY (categoria_id) REFERENCES categorias(id);

ALTER TABLE produto_adicionais
  ADD CONSTRAINT fk_produto_adicionais_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_adicionais_produto
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_produto_adicionais_adicional
    FOREIGN KEY (adicional_id) REFERENCES adicionais(id) ON DELETE CASCADE;

ALTER TABLE promocoes
  ADD CONSTRAINT fk_promocoes_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_promocoes_produto
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL;

ALTER TABLE funcionarios
  ADD CONSTRAINT fk_funcionarios_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;

ALTER TABLE sessoes_garcom
  ADD CONSTRAINT fk_sessoes_garcom_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessoes_garcom_funcionario
  FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE;

ALTER TABLE mesas
  ADD CONSTRAINT fk_mesas_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;

ALTER TABLE comandas
  ADD CONSTRAINT fk_comandas_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comandas_mesa
    FOREIGN KEY (mesa_id) REFERENCES mesas(id),
  ADD CONSTRAINT fk_comandas_funcionario
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id);

ALTER TABLE comanda_itens
  ADD CONSTRAINT fk_comanda_itens_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comanda_itens_comanda
    FOREIGN KEY (comanda_id) REFERENCES comandas(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_comanda_itens_produto
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL;

ALTER TABLE comanda_item_adicionais
  ADD CONSTRAINT fk_comanda_item_adicionais_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comanda_item_adicionais_item
    FOREIGN KEY (comanda_item_id) REFERENCES comanda_itens(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_comanda_item_adicionais_adicional
    FOREIGN KEY (adicional_id) REFERENCES adicionais(id) ON DELETE SET NULL;

ALTER TABLE pedidos
  ADD CONSTRAINT fk_pedidos_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedidos_comanda
    FOREIGN KEY (comanda_id) REFERENCES comandas(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_pedidos_mesa
    FOREIGN KEY (mesa_id) REFERENCES mesas(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_pedidos_funcionario
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL;

ALTER TABLE pedido_itens
  ADD CONSTRAINT fk_pedido_itens_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_itens_pedido
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_pedido_itens_produto
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_pedido_itens_promocao
    FOREIGN KEY (promocao_id) REFERENCES promocoes(id) ON DELETE SET NULL;

ALTER TABLE pedido_item_adicionais
  ADD CONSTRAINT fk_pedido_item_adicionais_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_item_adicionais_item
    FOREIGN KEY (pedido_item_id) REFERENCES pedido_itens(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_pedido_item_adicionais_adicional
    FOREIGN KEY (adicional_id) REFERENCES adicionais(id) ON DELETE SET NULL;

ALTER TABLE pagamentos
  ADD CONSTRAINT fk_pagamentos_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pagamentos_pedido
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_pagamentos_comanda
    FOREIGN KEY (comanda_id) REFERENCES comandas(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_pagamentos_confirmado_por
    FOREIGN KEY (confirmado_por) REFERENCES administradores(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_pagamentos_estornado_por
    FOREIGN KEY (estornado_por) REFERENCES administradores(id) ON DELETE SET NULL;

ALTER TABLE configuracoes
  ADD CONSTRAINT fk_configuracoes_estabelecimento_legado
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;
