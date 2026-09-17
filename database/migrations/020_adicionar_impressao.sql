-- Impressão automática de comandas e pedidos, com roteamento por impressora.
--
-- Até aqui o pedido chegava à cozinha só na tela. A partir desta migration cada
-- estabelecimento cadastra as suas impressoras de rede, diz qual categoria (ou
-- qual produto, como exceção) sai em cada uma, e o envio da comanda ou a criação
-- de um pedido de delivery/retirada deixa um "trabalho de impressão" na fila.
-- Quem imprime de fato é um agente local rodando na loja, que busca a fila com
-- credencial própria (nem administrador, nem garçom).
--
-- 1. impressoras: nome e endereço de rede (host + porta), por estabelecimento.
--    Guarda também UNIQUE (id_estabelecimento, id) para as chaves compostas
--    abaixo, do mesmo jeito que areas_entrega faz.
-- 2. categorias.impressora_id e produtos.impressora_id: a impressora efetiva de
--    um item é produto.impressora_id, ou a da categoria quando o produto não
--    tem exceção. Os dois são NULL por padrão — produto sem impressora
--    configurada é normal e simplesmente não gera trabalho de impressão.
-- 3. comanda_itens.impresso_em: marca o item que já entrou em algum trabalho,
--    para o garçom poder reenviar a comanda depois de acrescentar um item sem
--    reimprimir o que a cozinha já recebeu. O histórico já lançado nasce
--    marcado com a data do próprio lançamento, senão a primeira impressão
--    depois desta migration reimprimiria todas as comandas abertas.
-- 4. dispositivos_impressao: cada agente local pareado, com token guardado só
--    como hash (mesmo padrão dos tokens de sessão).
-- 5. trabalhos_impressao: a fila. conteudo_json é o recibo já montado pelo
--    servidor; o agente só transmite. A chave estrangeira da impressora inclui
--    id_estabelecimento, então um trabalho nunca aponta para impressora de
--    outra loja.
--
-- Nada é removido nem reescrito: sem impressora cadastrada, o sistema continua
-- funcionando exatamente como antes.

CREATE TABLE IF NOT EXISTS impressoras (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED NOT NULL,
  nome VARCHAR(120) NOT NULL,
  -- IP ou hostname na rede local da loja, sem protocolo e sem caminho.
  host VARCHAR(255) NOT NULL,
  porta INT UNSIGNED NOT NULL DEFAULT 9100,
  ativa TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_impressoras_estabelecimento_nome (id_estabelecimento, nome),
  UNIQUE KEY uk_impressoras_estabelecimento_id (id_estabelecimento, id),
  INDEX idx_impressoras_estabelecimento (id_estabelecimento),
  CONSTRAINT chk_impressoras_porta CHECK (porta BETWEEN 1 AND 65535),
  CONSTRAINT fk_impressoras_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dispositivos_impressao (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_estabelecimento BIGINT UNSIGNED NOT NULL,
  nome VARCHAR(120) NOT NULL,
  -- O token em texto puro aparece uma única vez, na criação, e não é guardado.
  token_hash CHAR(64) NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_contato_em DATETIME NULL,
  revogado_em DATETIME NULL,
  UNIQUE KEY uk_dispositivos_impressao_token (token_hash),
  INDEX idx_dispositivos_impressao_estabelecimento (id_estabelecimento),
  CONSTRAINT fk_dispositivos_impressao_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  INDEX idx_trabalhos_impressao_fila (id_estabelecimento, impressora_id, status),
  INDEX idx_trabalhos_impressao_pedido (pedido_id),
  INDEX idx_trabalhos_impressao_comanda (comanda_id),
  CONSTRAINT chk_trabalhos_impressao_origem CHECK (origem IN ('comanda', 'delivery')),
  CONSTRAINT chk_trabalhos_impressao_status
    CHECK (status IN ('pendente', 'impresso', 'falhou')),
  CONSTRAINT fk_trabalhos_impressao_impressora
    FOREIGN KEY (id_estabelecimento, impressora_id)
    REFERENCES impressoras(id_estabelecimento, id) ON DELETE RESTRICT,
  CONSTRAINT fk_trabalhos_impressao_pedido
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE SET NULL,
  CONSTRAINT fk_trabalhos_impressao_comanda
    FOREIGN KEY (comanda_id) REFERENCES comandas(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE categorias
  ADD COLUMN impressora_id BIGINT UNSIGNED NULL AFTER canal,
  ADD INDEX idx_categorias_impressora (impressora_id),
  ADD CONSTRAINT fk_categorias_impressora
    FOREIGN KEY (impressora_id) REFERENCES impressoras(id) ON DELETE SET NULL;

ALTER TABLE produtos
  ADD COLUMN impressora_id BIGINT UNSIGNED NULL AFTER canal,
  ADD INDEX idx_produtos_impressora (impressora_id),
  ADD CONSTRAINT fk_produtos_impressora
    FOREIGN KEY (impressora_id) REFERENCES impressoras(id) ON DELETE SET NULL;

ALTER TABLE comanda_itens
  ADD COLUMN impresso_em DATETIME NULL AFTER enviado_em;

-- Item já lançado para a cozinha antes desta migration conta como impresso: o
-- pedido dele já chegou lá pela tela, e reenviar a comanda não deve reimprimi-lo.
UPDATE comanda_itens
SET impresso_em = enviado_em
WHERE enviado_em IS NOT NULL AND impresso_em IS NULL;
