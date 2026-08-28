-- Credenciais e sessões globais do painel de superadmin.
-- Não altera nem remove registros de estabelecimentos existentes.

CREATE TABLE IF NOT EXISTS superadministradores (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario VARCHAR(80) NOT NULL,
  email VARCHAR(160) NOT NULL,
  nome VARCHAR(160) NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_superadministradores_usuario (usuario),
  UNIQUE KEY uk_superadministradores_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessoes_superadmin (
  token_hash CHAR(64) PRIMARY KEY,
  superadministrador_id BIGINT UNSIGNED NOT NULL,
  expira_em DATETIME(3) NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessoes_superadmin_usuario (superadministrador_id),
  INDEX idx_sessoes_superadmin_expiracao (expira_em),
  CONSTRAINT fk_sessoes_superadmin_usuario
    FOREIGN KEY (superadministrador_id)
    REFERENCES superadministradores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auditoria_superadmin (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  superadministrador_id BIGINT UNSIGNED,
  id_estabelecimento BIGINT UNSIGNED,
  acao VARCHAR(80) NOT NULL,
  detalhes_json JSON,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auditoria_superadmin_usuario (superadministrador_id),
  INDEX idx_auditoria_superadmin_estabelecimento (id_estabelecimento),
  INDEX idx_auditoria_superadmin_criado_em (criado_em),
  CONSTRAINT fk_auditoria_superadmin_usuario
    FOREIGN KEY (superadministrador_id)
    REFERENCES superadministradores(id) ON DELETE SET NULL,
  CONSTRAINT fk_auditoria_superadmin_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
