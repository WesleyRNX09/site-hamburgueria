-- Cria o estabelecimento de compatibilidade e associa todos os dados atuais.
-- Execute com as escritas da aplicação suspensas para não surgirem registros
-- sem escopo durante o backfill.

INSERT INTO estabelecimentos (
  nome_fantasia,
  slug,
  dominio_personalizado,
  status,
  plano,
  status_assinatura
)
SELECT
  COALESCE(NULLIF(TRIM(c.nome_loja), ''), 'Estabelecimento padrão'),
  'estabelecimento-padrao',
  NULL,
  'ativo',
  'basico',
  'ativa'
FROM (SELECT 1 AS origem) AS base
LEFT JOIN configuracoes AS c ON c.id = 1
WHERE NOT EXISTS (
  SELECT 1
  FROM estabelecimentos AS e
  WHERE e.slug = 'estabelecimento-padrao'
);

SET @id_estabelecimento_padrao = (
  SELECT e.id_estabelecimento
  FROM estabelecimentos AS e
  WHERE e.slug = 'estabelecimento-padrao'
  LIMIT 1
);

INSERT INTO configuracoes_estabelecimento (
  id_estabelecimento,
  logo_url,
  banner_url,
  cor_principal,
  cor_secundaria,
  cor_fundo,
  cor_card,
  cor_texto,
  fonte,
  telefone,
  whatsapp,
  email,
  endereco,
  horario_funcionamento,
  loja_aberta,
  pedido_minimo_centavos,
  taxa_entrega_centavos,
  tempo_entrega,
  pix_chave,
  pix_beneficiario,
  pix_cidade,
  entrega_ativa,
  retirada_ativa,
  atendimento_garcom_ativo,
  aceita_cartao,
  aceita_dinheiro,
  areas_entrega_json,
  formas_pagamento_json,
  politica_cancelamento,
  informacoes_legais
)
SELECT
  @id_estabelecimento_padrao,
  c.logo_url,
  NULL,
  '#FFC107',
  '#0A0A0A',
  '#111111',
  '#181818',
  '#FFFFFF',
  'Poppins',
  c.telefone,
  c.whatsapp,
  c.email,
  c.endereco,
  c.horario_funcionamento,
  COALESCE(c.loja_aberta, 0),
  COALESCE(c.pedido_minimo_centavos, 0),
  COALESCE(c.taxa_entrega_centavos, 0),
  c.tempo_entrega,
  c.pix_chave,
  c.pix_beneficiario,
  c.pix_cidade,
  COALESCE(c.entrega_ativa, 0),
  COALESCE(c.retirada_ativa, 0),
  CASE
    WHEN EXISTS (SELECT 1 FROM funcionarios AS f)
      OR EXISTS (SELECT 1 FROM mesas AS m)
    THEN 1
    ELSE 0
  END,
  COALESCE(c.aceita_cartao, 0),
  COALESCE(c.aceita_dinheiro, 0),
  c.areas_entrega_json,
  NULL,
  NULL,
  NULL
FROM (SELECT 1 AS origem) AS base
LEFT JOIN configuracoes AS c ON c.id = 1
WHERE @id_estabelecimento_padrao IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM configuracoes_estabelecimento AS ce
    WHERE ce.id_estabelecimento = @id_estabelecimento_padrao
  );

UPDATE administradores
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE sessoes_admin
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE auditoria_admin
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE categorias
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE adicionais
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE produtos
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE produto_adicionais
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE promocoes
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE funcionarios
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE sessoes_garcom
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE mesas
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE comandas
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE comanda_itens
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE comanda_item_adicionais
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE pedidos
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE pedido_itens
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE pedido_item_adicionais
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE pagamentos
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
UPDATE configuracoes
SET id_estabelecimento = @id_estabelecimento_padrao
WHERE id_estabelecimento IS NULL;
