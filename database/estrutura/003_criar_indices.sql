-- Índices de consulta que não são exigidos diretamente pelas chaves estrangeiras.

CREATE INDEX idx_estabelecimentos_status_assinatura
  ON estabelecimentos (status, status_assinatura, vencimento_assinatura_em);
CREATE INDEX idx_estabelecimentos_plano ON estabelecimentos (plano);
CREATE INDEX idx_sessoes_superadmin_usuario ON sessoes_superadmin (superadministrador_id);
CREATE INDEX idx_sessoes_superadmin_expiracao ON sessoes_superadmin (expira_em);
CREATE INDEX idx_auditoria_superadmin_usuario ON auditoria_superadmin (superadministrador_id);
CREATE INDEX idx_auditoria_superadmin_estabelecimento ON auditoria_superadmin (id_estabelecimento);
CREATE INDEX idx_auditoria_superadmin_criado_em ON auditoria_superadmin (criado_em);
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
CREATE INDEX idx_sessoes_admin_expiracao ON sessoes_admin (expira_em);
CREATE INDEX idx_auditoria_admin_criado_em ON auditoria_admin (criado_em);
CREATE INDEX idx_auditoria_admin_entidade ON auditoria_admin (entidade, entidade_id);
CREATE INDEX idx_produtos_ativo ON produtos (ativo);
CREATE INDEX idx_promocoes_ativo ON promocoes (ativo);
CREATE INDEX idx_funcionarios_ativo ON funcionarios (ativo);
CREATE INDEX idx_sessoes_garcom_expiracao ON sessoes_garcom (expira_em);
CREATE INDEX idx_pedidos_criado_em ON pedidos (criado_em);
CREATE INDEX idx_pedidos_status ON pedidos (status);
CREATE INDEX idx_pedidos_token_acompanhamento ON pedidos (token_acompanhamento_hash);
CREATE INDEX idx_pagamentos_status ON pagamentos (status);
