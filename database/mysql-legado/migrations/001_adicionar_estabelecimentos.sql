-- Cria a fundação global multiempresa sem alterar registros operacionais.
-- O backfill e as chaves id_estabelecimento das tabelas atuais pertencem
-- às migrations da etapa seguinte.

CREATE TABLE IF NOT EXISTS estabelecimentos (
  id_estabelecimento BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome_fantasia VARCHAR(160) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  dominio_personalizado VARCHAR(253),
  status VARCHAR(30) NOT NULL DEFAULT 'ativo',
  plano VARCHAR(50) NOT NULL DEFAULT 'basico',
  status_assinatura VARCHAR(30) NOT NULL DEFAULT 'ativa',
  vencimento_assinatura_em DATETIME,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_estabelecimentos_slug (slug),
  UNIQUE KEY uk_estabelecimentos_dominio (dominio_personalizado),
  INDEX idx_estabelecimentos_status_assinatura
    (status, status_assinatura, vencimento_assinatura_em),
  INDEX idx_estabelecimentos_plano (plano),
  CONSTRAINT chk_estabelecimentos_slug_preenchido
    CHECK (CHAR_LENGTH(TRIM(slug)) > 0),
  CONSTRAINT chk_estabelecimentos_dominio_preenchido
    CHECK (dominio_personalizado IS NULL OR CHAR_LENGTH(TRIM(dominio_personalizado)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS configuracoes_estabelecimento (
  id_estabelecimento BIGINT UNSIGNED PRIMARY KEY,
  logo_url VARCHAR(500),
  banner_url VARCHAR(500),
  cor_principal CHAR(7) NOT NULL DEFAULT '#FFC107',
  cor_secundaria CHAR(7) NOT NULL DEFAULT '#0A0A0A',
  cor_fundo CHAR(7) NOT NULL DEFAULT '#111111',
  cor_card CHAR(7) NOT NULL DEFAULT '#181818',
  cor_texto CHAR(7) NOT NULL DEFAULT '#FFFFFF',
  fonte VARCHAR(80) NOT NULL DEFAULT 'Poppins',
  telefone VARCHAR(40),
  whatsapp VARCHAR(40),
  email VARCHAR(160),
  endereco VARCHAR(255),
  horario_funcionamento TEXT,
  loja_aberta TINYINT(1) NOT NULL DEFAULT 0,
  pedido_minimo_centavos INT UNSIGNED NOT NULL DEFAULT 0,
  taxa_entrega_centavos INT UNSIGNED NOT NULL DEFAULT 0,
  tempo_entrega VARCHAR(60),
  pix_chave VARCHAR(180),
  pix_beneficiario VARCHAR(160),
  pix_cidade VARCHAR(60),
  entrega_ativa TINYINT(1) NOT NULL DEFAULT 0,
  retirada_ativa TINYINT(1) NOT NULL DEFAULT 0,
  atendimento_garcom_ativo TINYINT(1) NOT NULL DEFAULT 0,
  aceita_cartao TINYINT(1) NOT NULL DEFAULT 0,
  aceita_dinheiro TINYINT(1) NOT NULL DEFAULT 0,
  areas_entrega_json JSON,
  formas_pagamento_json JSON,
  politica_cancelamento TEXT,
  informacoes_legais TEXT,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_config_cor_principal
    CHECK (cor_principal REGEXP '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT chk_config_cor_secundaria
    CHECK (cor_secundaria REGEXP '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT chk_config_cor_fundo
    CHECK (cor_fundo REGEXP '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT chk_config_cor_card
    CHECK (cor_card REGEXP '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT chk_config_cor_texto
    CHECK (cor_texto REGEXP '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT fk_configuracoes_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
