-- Estrutura base multiempresa. As tabelas operacionais serão relacionadas
-- aos estabelecimentos por migrations posteriores e não destrutivas.
-- Não cria nem seleciona banco. Execute sobre um schema MySQL vazio.

SET NAMES utf8mb4;
SET time_zone = '-03:00';

CREATE TABLE IF NOT EXISTS schema_migrations (
  versao VARCHAR(255) PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  executado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS metadados (
  chave VARCHAR(100) PRIMARY KEY,
  valor TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  CONSTRAINT chk_estabelecimentos_slug_preenchido
    CHECK (CHAR_LENGTH(TRIM(slug)) > 0),
  CONSTRAINT chk_estabelecimentos_dominio_preenchido
    CHECK (dominio_personalizado IS NULL OR CHAR_LENGTH(TRIM(dominio_personalizado)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS configuracoes_estabelecimento (
  id_estabelecimento BIGINT UNSIGNED PRIMARY KEY,
  logo_url VARCHAR(500),
  banner_url VARCHAR(500),
  banner_titulo VARCHAR(160),
  banner_subtitulo VARCHAR(280),
  banner_botao_texto VARCHAR(60),
  banner_botao_destino VARCHAR(20),
  titulo_cardapio VARCHAR(160),
  texto_apresentacao VARCHAR(280),
  titulo_sobre VARCHAR(160),
  texto_sobre VARCHAR(600),
  mensagem_rodape VARCHAR(280),
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
  instagram_url VARCHAR(500),
  facebook_url VARCHAR(500),
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
  CONSTRAINT chk_config_banner_botao_destino
    CHECK (banner_botao_destino IS NULL
      OR banner_botao_destino IN ('cardapio', 'promocoes', 'sobre'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auditoria_superadmin (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  superadministrador_id BIGINT UNSIGNED,
  id_estabelecimento BIGINT UNSIGNED,
  acao VARCHAR(80) NOT NULL,
  detalhes_json JSON,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS administradores (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  usuario VARCHAR(80) NOT NULL,
  email VARCHAR(160) NOT NULL,
  nome VARCHAR(160) NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_administradores_estabelecimento_usuario (id_estabelecimento, usuario),
  UNIQUE KEY uk_administradores_estabelecimento_email (id_estabelecimento, email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessoes_admin (
  token_hash CHAR(64) PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  administrador_id BIGINT UNSIGNED NOT NULL,
  expira_em DATETIME(3) NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessoes_admin_administrador (administrador_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auditoria_admin (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  administrador_id BIGINT UNSIGNED,
  acao VARCHAR(80) NOT NULL,
  entidade VARCHAR(60) NOT NULL,
  entidade_id VARCHAR(80),
  detalhes_json JSON,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auditoria_admin_administrador (administrador_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categorias (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  nome VARCHAR(100) NOT NULL,
  ordem INT NOT NULL DEFAULT 0,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uk_categorias_estabelecimento_nome (id_estabelecimento, nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS adicionais (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  nome VARCHAR(120) NOT NULL,
  preco_centavos INT UNSIGNED NOT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_adicionais_estabelecimento_nome (id_estabelecimento, nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS produtos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  categoria_id BIGINT UNSIGNED NOT NULL,
  nome VARCHAR(160) NOT NULL,
  descricao TEXT NOT NULL,
  preco_centavos INT UNSIGNED NOT NULL,
  imagem_url VARCHAR(500),
  destaque VARCHAR(100),
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_produtos_categoria (categoria_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS produto_adicionais (
  id_estabelecimento BIGINT UNSIGNED,
  produto_id BIGINT UNSIGNED NOT NULL,
  adicional_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (produto_id, adicional_id),
  INDEX idx_produto_adicionais_adicional (adicional_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS promocoes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  produto_id BIGINT UNSIGNED,
  nome VARCHAR(160) NOT NULL,
  categoria VARCHAR(100) NOT NULL,
  descricao TEXT NOT NULL,
  preco_anterior_centavos INT UNSIGNED NOT NULL DEFAULT 0,
  preco_centavos INT UNSIGNED NOT NULL,
  imagem_url VARCHAR(500),
  destaque VARCHAR(100),
  tipo VARCHAR(100),
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  inicio_em DATETIME,
  fim_em DATETIME,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_promocoes_produto (produto_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS funcionarios (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  nome VARCHAR(160) NOT NULL,
  cargo VARCHAR(80) NOT NULL,
  pin_hash VARCHAR(255) NOT NULL,
  token_acesso VARCHAR(160) NOT NULL UNIQUE,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessoes_garcom (
  token_hash CHAR(64) PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  funcionario_id BIGINT UNSIGNED NOT NULL,
  expira_em DATETIME(3) NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessoes_garcom_funcionario (funcionario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mesas (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  numero VARCHAR(10) NOT NULL,
  lugares INT UNSIGNED NOT NULL DEFAULT 4,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_mesas_estabelecimento_numero (id_estabelecimento, numero)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comandas (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  mesa_id BIGINT UNSIGNED NOT NULL,
  funcionario_id BIGINT UNSIGNED,
  aberta_por_admin_id BIGINT UNSIGNED,
  status VARCHAR(40) NOT NULL DEFAULT 'Aberta',
  pagamento VARCHAR(40),
  aberta_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  encerrada_em DATETIME,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_comandas_mesa_status (mesa_id, status),
  INDEX idx_comandas_funcionario (funcionario_id),
  INDEX idx_comandas_aberta_por_admin (aberta_por_admin_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comanda_itens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  comanda_id BIGINT UNSIGNED NOT NULL,
  produto_id BIGINT UNSIGNED,
  nome_produto VARCHAR(160) NOT NULL,
  preco_unitario_centavos INT UNSIGNED NOT NULL,
  quantidade INT UNSIGNED NOT NULL,
  observacao TEXT,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enviado_em DATETIME,
  enviado_por_funcionario_id BIGINT UNSIGNED,
  enviado_por_admin_id BIGINT UNSIGNED,
  INDEX idx_comanda_itens_comanda (comanda_id),
  INDEX idx_comanda_itens_produto (produto_id),
  INDEX idx_comanda_itens_enviado_funcionario (enviado_por_funcionario_id),
  INDEX idx_comanda_itens_enviado_admin (enviado_por_admin_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comanda_item_adicionais (
  id_estabelecimento BIGINT UNSIGNED,
  comanda_item_id BIGINT UNSIGNED NOT NULL,
  adicional_id BIGINT UNSIGNED,
  nome_adicional VARCHAR(120) NOT NULL,
  preco_centavos INT UNSIGNED NOT NULL,
  PRIMARY KEY (comanda_item_id, nome_adicional),
  INDEX idx_comanda_item_adicionais_adicional (adicional_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pedidos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  token_acompanhamento_hash CHAR(64),
  chave_idempotencia_hash CHAR(64),
  origem VARCHAR(20) NOT NULL,
  cliente VARCHAR(160) NOT NULL,
  telefone VARCHAR(40) NOT NULL,
  email VARCHAR(160),
  status VARCHAR(40) NOT NULL DEFAULT 'Recebido',
  pagamento VARCHAR(40) NOT NULL,
  rua VARCHAR(180),
  numero VARCHAR(30),
  bairro VARCHAR(120),
  complemento VARCHAR(160),
  referencia VARCHAR(255),
  taxa_entrega_centavos INT UNSIGNED NOT NULL DEFAULT 0,
  total_centavos INT UNSIGNED NOT NULL DEFAULT 0,
  comanda_id BIGINT UNSIGNED,
  mesa_id BIGINT UNSIGNED,
  funcionario_id BIGINT UNSIGNED,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pedidos_comanda (comanda_id),
  UNIQUE KEY uk_pedidos_estabelecimento_idempotencia
    (id_estabelecimento, chave_idempotencia_hash),
  INDEX idx_pedidos_mesa (mesa_id),
  INDEX idx_pedidos_funcionario (funcionario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pedido_itens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  pedido_id BIGINT UNSIGNED NOT NULL,
  produto_id BIGINT UNSIGNED,
  promocao_id BIGINT UNSIGNED,
  nome_produto VARCHAR(160) NOT NULL,
  descricao_produto TEXT,
  imagem_url VARCHAR(500),
  preco_unitario_centavos INT UNSIGNED NOT NULL,
  quantidade INT UNSIGNED NOT NULL,
  observacao TEXT,
  INDEX idx_pedido_itens_pedido (pedido_id),
  INDEX idx_pedido_itens_produto (produto_id),
  INDEX idx_pedido_itens_promocao (promocao_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pedido_item_adicionais (
  id_estabelecimento BIGINT UNSIGNED,
  pedido_item_id BIGINT UNSIGNED NOT NULL,
  adicional_id BIGINT UNSIGNED,
  nome_adicional VARCHAR(120) NOT NULL,
  preco_centavos INT UNSIGNED NOT NULL,
  PRIMARY KEY (pedido_item_id, nome_adicional),
  INDEX idx_pedido_item_adicionais_adicional (adicional_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pagamentos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  pedido_id BIGINT UNSIGNED,
  comanda_id BIGINT UNSIGNED,
  forma VARCHAR(40) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Aguardando pagamento',
  valor_centavos INT UNSIGNED NOT NULL,
  valor_recebido_centavos INT UNSIGNED,
  troco_centavos INT UNSIGNED,
  provedor VARCHAR(40) NOT NULL DEFAULT 'manual',
  referencia_externa VARCHAR(120),
  pix_chave VARCHAR(180),
  pix_beneficiario VARCHAR(160),
  sem_troco TINYINT(1),
  troco_para_centavos INT UNSIGNED,
  pix_copia_cola TEXT,
  pago_em DATETIME,
  confirmado_por BIGINT UNSIGNED,
  confirmado_em DATETIME,
  estornado_por BIGINT UNSIGNED,
  estornado_em DATETIME,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pagamentos_pedido (pedido_id),
  INDEX idx_pagamentos_referencia_externa (referencia_externa),
  INDEX idx_pagamentos_comanda (comanda_id),
  INDEX idx_pagamentos_confirmado_por (confirmado_por),
  INDEX idx_pagamentos_estornado_por (estornado_por)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS configuracoes (
  id TINYINT UNSIGNED PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  nome_loja VARCHAR(160) NOT NULL,
  telefone VARCHAR(40) NOT NULL,
  email VARCHAR(160) NOT NULL,
  endereco VARCHAR(255) NOT NULL,
  taxa_entrega_centavos INT UNSIGNED NOT NULL DEFAULT 0,
  tempo_entrega VARCHAR(60) NOT NULL,
  pedido_minimo_centavos INT UNSIGNED NOT NULL DEFAULT 0,
  loja_aberta TINYINT(1) NOT NULL DEFAULT 0,
  pix_chave VARCHAR(180),
  pix_beneficiario VARCHAR(160),
  pix_cidade VARCHAR(60),
  logo_url VARCHAR(500),
  whatsapp VARCHAR(40),
  horario_funcionamento TEXT,
  instagram_url VARCHAR(500),
  facebook_url VARCHAR(500),
  entrega_ativa TINYINT(1) NOT NULL DEFAULT 0,
  retirada_ativa TINYINT(1) NOT NULL DEFAULT 0,
  aceita_cartao TINYINT(1) NOT NULL DEFAULT 0,
  aceita_dinheiro TINYINT(1) NOT NULL DEFAULT 0,
  areas_entrega_json JSON,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
