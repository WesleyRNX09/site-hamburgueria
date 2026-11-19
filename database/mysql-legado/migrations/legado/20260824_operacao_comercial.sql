-- Migração histórica preservada apenas para rastreabilidade.
-- Não é executada automaticamente pelo runner de migrações atual.

-- Migração não destrutiva para pagamentos auditáveis, retirada e auditoria administrativa.

ALTER TABLE pagamentos
  ADD COLUMN pix_copia_cola TEXT NULL AFTER troco_para_centavos,
  ADD COLUMN confirmado_por BIGINT UNSIGNED NULL AFTER pago_em,
  ADD COLUMN confirmado_em DATETIME NULL AFTER confirmado_por,
  ADD COLUMN estornado_por BIGINT UNSIGNED NULL AFTER confirmado_em,
  ADD COLUMN estornado_em DATETIME NULL AFTER estornado_por,
  ADD CONSTRAINT fk_pagamentos_confirmado_por
    FOREIGN KEY (confirmado_por) REFERENCES administradores(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_pagamentos_estornado_por
    FOREIGN KEY (estornado_por) REFERENCES administradores(id) ON DELETE SET NULL,
  ADD INDEX idx_pagamentos_status (status);

ALTER TABLE configuracoes
  ADD COLUMN pix_cidade VARCHAR(60) NULL AFTER pix_beneficiario,
  ADD COLUMN retirada_ativa TINYINT(1) NOT NULL DEFAULT 1 AFTER entrega_ativa;

CREATE TABLE IF NOT EXISTS auditoria_admin (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  administrador_id BIGINT UNSIGNED,
  acao VARCHAR(80) NOT NULL,
  entidade VARCHAR(60) NOT NULL,
  entidade_id VARCHAR(80),
  detalhes_json JSON,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_auditoria_admin_administrador
    FOREIGN KEY (administrador_id) REFERENCES administradores(id) ON DELETE SET NULL,
  INDEX idx_auditoria_admin_criado_em (criado_em),
  INDEX idx_auditoria_admin_entidade (entidade, entidade_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
