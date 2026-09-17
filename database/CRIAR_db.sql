-- Instalação completa da estrutura multiempresa.
-- Uso exclusivo em um schema novo, previamente criado e selecionado no provedor.
-- Cria somente o estabelecimento inicial de compatibilidade, sem contas administrativas
-- ou dados demonstrativos.

-- Estrutura base multiempresa. As tabelas operacionais serão relacionadas
-- aos estabelecimentos por migrations posteriores e não destrutivas.
-- Não cria nem seleciona banco. Execute sobre um schema MySQL vazio.

SET NAMES utf8mb4;
-- UTC, a mesma convencao do aplicativo (o pool fixa '+00:00' em toda conexao).
-- Com '-03:00' aqui, a conexao que executasse este arquivo voltava para o pool
-- com o fuso trocado, e passava a gravar CURRENT_TIMESTAMP 3 h deslocado das
-- demais -- dois relogios diferentes dentro da mesma tabela.
SET time_zone = '+00:00';

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
  -- Token do QR Code único da equipe: um por estabelecimento, criado sob
  -- demanda pelo painel e trocado quando o administrador quiser invalidar os
  -- códigos já impressos.
  token_acesso_garcom VARCHAR(160) NULL,
  plano VARCHAR(50) NOT NULL DEFAULT 'basico',
  status_assinatura VARCHAR(30) NOT NULL DEFAULT 'ativa',
  vencimento_assinatura_em DATETIME,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_estabelecimentos_slug (slug),
  UNIQUE KEY uk_estabelecimentos_dominio (dominio_personalizado),
  UNIQUE KEY uk_estabelecimentos_token_garcom (token_acesso_garcom),
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
  -- Grade semanal: [{ "dia": 0-6, "aberto": bool, "abre": "HH:MM", "fecha": "HH:MM" }].
  horarios_json TEXT NULL,
  -- 1 = o servidor decide aberta/fechada pelo relógio; 0 = vale loja_aberta.
  funcionamento_automatico TINYINT(1) NOT NULL DEFAULT 0,
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
  -- Preenchida quando a conta é arquivada; NULL significa conta em uso.
  arquivado_em DATETIME NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_administradores_estabelecimento_usuario (id_estabelecimento, usuario),
  UNIQUE KEY uk_administradores_estabelecimento_email (id_estabelecimento, email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Permissões de cada administrador no painel do estabelecimento. A lista de
-- valores acompanha src/utils/permissoes.js.
CREATE TABLE IF NOT EXISTS administrador_permissoes (
  id_estabelecimento BIGINT UNSIGNED NOT NULL,
  administrador_id BIGINT UNSIGNED NOT NULL,
  permissao VARCHAR(40) NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (administrador_id, permissao),
  CONSTRAINT chk_administrador_permissoes_permissao
    CHECK (permissao IN (
      'dashboard.visualizar', 'pedidos.visualizar', 'pedidos.alterar_status',
      'pedidos.gerenciar_pagamento', 'mesas.operar', 'mesas.fechar', 'mesas.cadastrar',
      'produtos.editar', 'relatorios.visualizar', 'funcionarios.gerenciar',
      'personalizacao.editar', 'delivery.editar', 'configuracoes.editar'
    ))
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

-- Impressoras de rede da loja. O roteamento da comanda usa a impressora da
-- categoria, ou a do produto quando ele tem exceção; sem nenhuma das duas, o
-- item simplesmente não é impresso.
CREATE TABLE IF NOT EXISTS impressoras (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED NOT NULL,
  nome VARCHAR(120) NOT NULL,
  -- IP ou hostname na rede local da loja, sem protocolo e sem caminho.
  host VARCHAR(255) NOT NULL,
  porta INT UNSIGNED NOT NULL DEFAULT 9100,
  ativa TINYINT(1) NOT NULL DEFAULT 1,
  -- A impressora do balcao: no maximo uma por estabelecimento, garantido pela
  -- aplicacao (o MySQL nao tem indice unico parcial para "unico entre as
  -- linhas com eh_caixa = 1").
  eh_caixa TINYINT(1) NOT NULL DEFAULT 0,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_impressoras_estabelecimento_nome (id_estabelecimento, nome),
  UNIQUE KEY uk_impressoras_estabelecimento_id (id_estabelecimento, id),
  CONSTRAINT chk_impressoras_porta CHECK (porta BETWEEN 1 AND 65535)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categorias (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED,
  nome VARCHAR(100) NOT NULL,
  -- Onde a categoria aparece: 'ambos', 'online' (só o cardápio do site) ou
  -- 'salao' (só o app do garçom e as comandas de mesa).
  canal VARCHAR(10) NOT NULL DEFAULT 'ambos',
  -- Impressora padrão da categoria; NULL significa "não imprime".
  impressora_id BIGINT UNSIGNED,
  ordem INT NOT NULL DEFAULT 0,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uk_categorias_estabelecimento_nome (id_estabelecimento, nome),
  CONSTRAINT chk_categorias_canal CHECK (canal IN ('ambos', 'online', 'salao'))
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
  -- Mesmo vocabulário da categoria. A visibilidade real é a interseção das
  -- duas: produto 'ambos' em categoria 'salao' não aparece no site.
  canal VARCHAR(10) NOT NULL DEFAULT 'ambos',
  -- Exceção do produto; NULL herda a impressora da categoria.
  impressora_id BIGINT UNSIGNED,
  nome VARCHAR(160) NOT NULL,
  descricao TEXT NOT NULL,
  preco_centavos INT UNSIGNED NOT NULL,
  imagem_url VARCHAR(500),
  destaque VARCHAR(100),
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_produtos_categoria (categoria_id),
  CONSTRAINT chk_produtos_canal CHECK (canal IN ('ambos', 'online', 'salao'))
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
  usuario VARCHAR(60) NOT NULL,
  -- Sem senha até o administrador definir uma; `senha_definida_em` marca esse
  -- momento e é o que separa um cadastro pronto de um cadastro pendente.
  pin_hash VARCHAR(255) NULL,
  -- Índice determinístico da senha: o garçom entra digitando só a senha, e é
  -- por aqui que o login encontra o cadastro sem testar o hash de toda a
  -- equipe. Único por estabelecimento, porque a senha sozinha identifica a
  -- pessoa. Quem autentica de fato continua sendo `pin_hash`.
  senha_busca CHAR(64) NULL,
  token_acesso VARCHAR(160) NOT NULL UNIQUE,
  senha_definida_em DATETIME NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_funcionarios_estabelecimento_usuario (id_estabelecimento, usuario),
  UNIQUE KEY uk_funcionarios_estabelecimento_senha (id_estabelecimento, senha_busca)
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
  -- Recado que vale para a mesa inteira, não para um item: aniversário,
  -- alergia, cliente com pressa. O limite de 500 caracteres é do servidor.
  observacao TEXT,
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
  -- Quando o item entrou em um trabalho de impressão, para o reenvio da
  -- comanda não reimprimir o que a cozinha já recebeu.
  impresso_em DATETIME,
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

-- Áreas de entrega (bairro ou região) com taxa e tempo estimado próprios. Loja
-- sem nenhuma área cadastrada usa a taxa única de configuracoes_estabelecimento.
CREATE TABLE IF NOT EXISTS areas_entrega (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED NOT NULL,
  nome VARCHAR(120) NOT NULL,
  taxa_entrega_centavos INT UNSIGNED NOT NULL DEFAULT 0,
  tempo_estimado_min SMALLINT UNSIGNED NOT NULL,
  tempo_estimado_max SMALLINT UNSIGNED NOT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_areas_entrega_estabelecimento_nome (id_estabelecimento, nome),
  UNIQUE KEY uk_areas_entrega_estabelecimento_id (id_estabelecimento, id),
  CONSTRAINT chk_areas_entrega_tempo
    CHECK (tempo_estimado_min > 0 AND tempo_estimado_max >= tempo_estimado_min)
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
  -- Área escolhida no pedido. A taxa cobrada fica em taxa_entrega_centavos.
  area_entrega_id BIGINT UNSIGNED,
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

-- Agente local pareado que busca e imprime a fila. Autenticação própria: não é
-- administrador nem garçom, e o token só existe em texto puro na criação.
CREATE TABLE IF NOT EXISTS dispositivos_impressao (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED NOT NULL,
  nome VARCHAR(120) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_contato_em DATETIME NULL,
  revogado_em DATETIME NULL,
  UNIQUE KEY uk_dispositivos_impressao_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fila de impressão. conteudo_json é o recibo já montado pelo servidor; o
-- agente local apenas transmite o que está aqui.
CREATE TABLE IF NOT EXISTS trabalhos_impressao (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED NOT NULL,
  impressora_id BIGINT UNSIGNED NOT NULL,
  origem VARCHAR(20) NOT NULL,
  pedido_id BIGINT UNSIGNED NULL,
  comanda_id BIGINT UNSIGNED NULL,
  conteudo_json JSON NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pendente',
  tentativas INT UNSIGNED NOT NULL DEFAULT 0,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  impresso_em DATETIME NULL,
  INDEX idx_trabalhos_impressao_pedido (pedido_id),
  INDEX idx_trabalhos_impressao_comanda (comanda_id),
  CONSTRAINT chk_trabalhos_impressao_origem CHECK (origem IN ('comanda', 'delivery', 'conta')),
  CONSTRAINT chk_trabalhos_impressao_status
    CHECK (status IN ('pendente', 'impresso', 'falhou'))
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
CREATE INDEX idx_administrador_permissoes_estabelecimento ON administrador_permissoes (id_estabelecimento);
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
CREATE INDEX idx_areas_entrega_estabelecimento ON areas_entrega (id_estabelecimento);
CREATE INDEX idx_pedidos_estabelecimento_area_entrega ON pedidos (id_estabelecimento, area_entrega_id);
CREATE INDEX idx_configuracoes_estabelecimento_legado ON configuracoes (id_estabelecimento);
CREATE INDEX idx_sessoes_admin_expiracao ON sessoes_admin (expira_em);
CREATE INDEX idx_auditoria_admin_criado_em ON auditoria_admin (criado_em);
CREATE INDEX idx_auditoria_admin_entidade ON auditoria_admin (entidade, entidade_id);
CREATE INDEX idx_produtos_ativo ON produtos (ativo);
CREATE INDEX idx_promocoes_ativo ON promocoes (ativo);
CREATE INDEX idx_funcionarios_ativo ON funcionarios (ativo);
CREATE INDEX idx_sessoes_garcom_expiracao ON sessoes_garcom (expira_em);
CREATE INDEX idx_pedidos_criado_em ON pedidos (criado_em);
CREATE INDEX idx_pedidos_estabelecimento_criado_em ON pedidos (id_estabelecimento, criado_em);
CREATE INDEX idx_pedidos_status ON pedidos (status);
CREATE INDEX idx_pedidos_token_acompanhamento ON pedidos (token_acompanhamento_hash);
CREATE INDEX idx_pagamentos_status ON pagamentos (status);

-- Impressão: fila por loja/impressora e as colunas de roteamento do catálogo.
CREATE INDEX idx_impressoras_estabelecimento ON impressoras (id_estabelecimento);
CREATE INDEX idx_impressoras_caixa ON impressoras (id_estabelecimento, eh_caixa);
CREATE INDEX idx_dispositivos_impressao_estabelecimento
  ON dispositivos_impressao (id_estabelecimento);
CREATE INDEX idx_trabalhos_impressao_fila
  ON trabalhos_impressao (id_estabelecimento, impressora_id, status);
CREATE INDEX idx_categorias_impressora ON categorias (impressora_id);
CREATE INDEX idx_produtos_impressora ON produtos (impressora_id);

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

ALTER TABLE administrador_permissoes
  ADD CONSTRAINT fk_administrador_permissoes_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_administrador_permissoes_administrador
  FOREIGN KEY (administrador_id) REFERENCES administradores(id) ON DELETE CASCADE;

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
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_comandas_aberta_por_admin
    FOREIGN KEY (aberta_por_admin_id) REFERENCES administradores(id) ON DELETE SET NULL;

ALTER TABLE comanda_itens
  ADD CONSTRAINT fk_comanda_itens_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comanda_itens_comanda
    FOREIGN KEY (comanda_id) REFERENCES comandas(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_comanda_itens_enviado_funcionario
    FOREIGN KEY (enviado_por_funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_comanda_itens_enviado_admin
    FOREIGN KEY (enviado_por_admin_id) REFERENCES administradores(id) ON DELETE SET NULL,
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

ALTER TABLE areas_entrega
  ADD CONSTRAINT fk_areas_entrega_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;

ALTER TABLE pedidos
  ADD CONSTRAINT fk_pedidos_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedidos_comanda
    FOREIGN KEY (comanda_id) REFERENCES comandas(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_pedidos_mesa
    FOREIGN KEY (mesa_id) REFERENCES mesas(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_pedidos_funcionario
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL,
  -- Com id_estabelecimento: o pedido nunca aponta para área de outra loja, e
  -- área usada em pedido não pode ser apagada.
  ADD CONSTRAINT fk_pedidos_area_entrega
    FOREIGN KEY (id_estabelecimento, area_entrega_id)
    REFERENCES areas_entrega(id_estabelecimento, id) ON DELETE RESTRICT;

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

ALTER TABLE impressoras
  ADD CONSTRAINT fk_impressoras_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;

ALTER TABLE dispositivos_impressao
  ADD CONSTRAINT fk_dispositivos_impressao_estabelecimento
  FOREIGN KEY (id_estabelecimento)
  REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT;

-- A impressora do trabalho é apontada junto com o estabelecimento: um trabalho
-- nunca consegue referenciar impressora de outra loja.
ALTER TABLE trabalhos_impressao
  ADD CONSTRAINT fk_trabalhos_impressao_impressora
    FOREIGN KEY (id_estabelecimento, impressora_id)
    REFERENCES impressoras(id_estabelecimento, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_trabalhos_impressao_pedido
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_trabalhos_impressao_comanda
    FOREIGN KEY (comanda_id) REFERENCES comandas(id) ON DELETE SET NULL;

ALTER TABLE categorias
  ADD CONSTRAINT fk_categorias_impressora
  FOREIGN KEY (impressora_id) REFERENCES impressoras(id) ON DELETE SET NULL;

ALTER TABLE produtos
  ADD CONSTRAINT fk_produtos_impressora
  FOREIGN KEY (impressora_id) REFERENCES impressoras(id) ON DELETE SET NULL;

-- Dados mínimos e não sensíveis da instalação atual.

START TRANSACTION;

-- Em instalações novas, a estrutura final já incorpora estas migrations.
-- Os checksums impedem que o runner tente reaplicar ALTERs sobre o schema novo.
INSERT INTO schema_migrations (versao, checksum) VALUES
  ('001_adicionar_estabelecimentos.sql', 'fe5a3c02b5519e7a7b6007f4d6c180cf54d18cf78f640d41e3161d45b4c3a10c'),
  ('002_adicionar_escopo_estabelecimento.sql', '379ac9882c45d603cd978ea0900f89a680ffff820ef49f8539d023e0ce45963c'),
  ('003_relacionar_dados_estabelecimento.sql', '62f6e86e05a80b98fa1ce6cfa4f0e423893944ec8290810c0abe052f2673e4bc'),
  ('004_adicionar_integridade_estabelecimento.sql', 'c8e52b9245f1ab2866718e979e118249cf0118f809ecf41a76b4c4191f577a46'),
  ('005_preservar_redes_configuracao.sql', '456ca8ceeb39b4693e26e3e8fff02cc113adc9e820f47844aea30b81f2a23c44'),
  ('006_ajustar_unicidade_por_estabelecimento.sql', '3908bf4e8d0ab04225077d2fb829e27544cd1d0e30f40634b172b821627a4cb4'),
  ('007_adicionar_superadministradores.sql', '59cd72293045658157f4dc217736d384791fe5ad6a047681c2539c373221812d'),
  ('008_adicionar_textos_publicos.sql', 'effc5d8a2688e354f1a12eb537aa323eb3c7698be9e46fa36316893f48559ae7'),
  ('009_marcar_lancamento_itens_comanda.sql', 'cc107471dbcf63037db6f3fc0105643e0a3d25f68bfd6d3aa350c828b4e6ccbf'),
  ('010_preparar_pagamento_no_caixa.sql', 'e7b38e1fa95226662015d800496e4bee069693c8d6abb4e302897bd563128005'),
  ('011_registrar_autoria_da_comanda.sql', 'f327fbf669bb69e4e95f636e66289e34feda5852772151a0c11f306f1f26dcc4'),
  ('012_adicionar_login_do_garcom.sql', '371e3d178993ed316dd67a4a321e38ee2c47dac46bce4436ead2c41764fc7fd6'),
  ('013_acesso_unico_do_garcom.sql', 'e3ef5ae2adcd59a4f74cce3efa27bfb4aa211298b82149fffbe3c9b02436ee7a'),
  ('014_separar_cardapio_do_salao.sql', 'a3f19528864c09205aacc7d4833fceca41234f75e76d740daf0acfbc6d0342be'),
  ('015_horario_automatico_da_loja.sql', '4ec43857d55a1e0ecdbb547855406e0cab47ac47383e6e2a7892778b7ad4897e'),
  ('016_indice_pedidos_por_periodo.sql', '6d2b3da9d4f619e59ab9682ebd8ddd38ed4ce036e3632de0fbb01e3a78edaf39'),
  ('017_permissoes_administradores.sql', '1630b466b47154b28b0d5c2d7d0714c3e0874fd9dbfd534aeaa8ec9cae1b809f'),
  ('018_arquivar_administradores.sql', '7bdc15d4289120e9766ba52f1cdebacd10127bcc92748adeaeda58750a84dd33'),
  ('019_areas_entrega.sql', '74127c736bef982a1c643a8c6186e14bc9cdfde341539201e65bdf43fd703993'),
  ('020_adicionar_impressao.sql', '5f16a543cda46d77e573cb2fdb012c2928a89e4ea6afe0e30235e31db33d8658'),
  ('021_observacao_geral_da_comanda.sql', '6d8d045464806ecf39f4007e322bceb64dc1740b3eb44a70baa02ceb4f683e04'),
  ('022_impressora_do_caixa.sql', '8d9bc13565eef36400913ae00b4571d5f416e6e35932ef58ded80a302a0f9879'),
  ('023_recibo_de_fechamento.sql', 'b3f6f90862344408022a15928a096d950d64c54d0a27805f7787d9c8e9327c12')
ON DUPLICATE KEY UPDATE versao = VALUES(versao);

INSERT INTO estabelecimentos
  (nome_fantasia, slug, status, plano, status_assinatura)
VALUES
  ('Estabelecimento padrão', 'estabelecimento-padrao', 'ativo', 'basico', 'ativa')
ON DUPLICATE KEY UPDATE slug = VALUES(slug);

SET @id_estabelecimento_inicial = (
  SELECT id_estabelecimento
  FROM estabelecimentos
  WHERE slug = 'estabelecimento-padrao'
  LIMIT 1
);

INSERT INTO configuracoes_estabelecimento (id_estabelecimento)
VALUES (@id_estabelecimento_inicial)
ON DUPLICATE KEY UPDATE id_estabelecimento = VALUES(id_estabelecimento);

INSERT INTO categorias (id_estabelecimento, id, nome, ordem, ativo) VALUES
  (@id_estabelecimento_inicial, 1, 'Hambúrgueres', 1, 1),
  (@id_estabelecimento_inicial, 2, 'Combos', 2, 1),
  (@id_estabelecimento_inicial, 3, 'Porções', 3, 1),
  (@id_estabelecimento_inicial, 4, 'Bebidas', 4, 1)
ON DUPLICATE KEY UPDATE
  id_estabelecimento = VALUES(id_estabelecimento),
  nome = VALUES(nome),
  ordem = VALUES(ordem);

INSERT INTO configuracoes (
  id, id_estabelecimento, nome_loja, telefone, email, endereco, taxa_entrega_centavos,
  tempo_entrega, pedido_minimo_centavos, loja_aberta, entrega_ativa,
  retirada_ativa, aceita_cartao, aceita_dinheiro
) VALUES (
  1, @id_estabelecimento_inicial, '', '', '', '', 0,
  '', 0, 0, 0,
  0, 0, 0
)
ON DUPLICATE KEY UPDATE id_estabelecimento = VALUES(id_estabelecimento);

INSERT INTO metadados (chave, valor) VALUES
  ('catalogo_inicial_criado', '1'),
  ('operacao_inicial_criada', '1')
ON DUPLICATE KEY UPDATE valor = VALUES(valor);

COMMIT;
