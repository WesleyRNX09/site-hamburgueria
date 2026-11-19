-- Áreas de entrega por estabelecimento.
--
-- Cada área (bairro ou região) tem taxa e tempo estimado próprios. Até aqui a
-- loja guardava só bairro e taxa em configuracoes_estabelecimento.areas_entrega_json,
-- sem id, e nenhum pedido conseguia apontar para a área usada.
--
-- 1. Tabela areas_entrega, presa ao estabelecimento, com nome único dentro dele.
-- 2. pedidos.area_entrega_id guarda a área escolhida. A taxa cobrada continua em
--    pedidos.taxa_entrega_centavos e o nome em pedidos.bairro, então alterar ou
--    desativar a área depois não muda o histórico. A chave estrangeira inclui
--    id_estabelecimento (um pedido nunca aponta para área de outra loja) e é
--    RESTRICT: área já usada em pedido não pode ser apagada.
-- 3. Os bairros de areas_entrega_json são copiados para a tabela. O tempo
--    estimado vem dos dois números de tempo_entrega ("30–45 min" vira 30 e 45);
--    sem dois números válidos, 30 e 45.
--
-- Nada é removido: areas_entrega_json e pedido_minimo_centavos continuam no
-- banco, só deixam de ser usados. Loja sem bairros cadastrados não ganha área e
-- continua com a taxa única.

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
  INDEX idx_areas_entrega_estabelecimento (id_estabelecimento),
  CONSTRAINT chk_areas_entrega_tempo
    CHECK (tempo_estimado_min > 0 AND tempo_estimado_max >= tempo_estimado_min),
  CONSTRAINT fk_areas_entrega_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE pedidos
  ADD COLUMN area_entrega_id BIGINT UNSIGNED NULL AFTER bairro,
  ADD INDEX idx_pedidos_estabelecimento_area_entrega (id_estabelecimento, area_entrega_id),
  ADD CONSTRAINT fk_pedidos_area_entrega
    FOREIGN KEY (id_estabelecimento, area_entrega_id)
    REFERENCES areas_entrega(id_estabelecimento, id) ON DELETE RESTRICT;

INSERT INTO areas_entrega
  (id_estabelecimento, nome, taxa_entrega_centavos, tempo_estimado_min, tempo_estimado_max, ativo)
SELECT
  ce.id_estabelecimento,
  TRIM(area.bairro),
  CASE WHEN area.taxa_centavos REGEXP '^[0-9]{1,9}$' THEN CAST(area.taxa_centavos AS UNSIGNED) END,
  CASE
    WHEN tempos.primeiro BETWEEN 1 AND 600 AND tempos.segundo BETWEEN tempos.primeiro AND 600
      THEN tempos.primeiro
    ELSE 30
  END,
  CASE
    WHEN tempos.primeiro BETWEEN 1 AND 600 AND tempos.segundo BETWEEN tempos.primeiro AND 600
      THEN tempos.segundo
    ELSE 45
  END,
  1
FROM configuracoes_estabelecimento ce
INNER JOIN (
  SELECT
    textos.id_estabelecimento,
    CASE WHEN textos.primeiro REGEXP '^[0-9]{1,3}$' THEN CAST(textos.primeiro AS UNSIGNED) END AS primeiro,
    CASE WHEN textos.segundo REGEXP '^[0-9]{1,3}$' THEN CAST(textos.segundo AS UNSIGNED) END AS segundo
  FROM (
    SELECT
      id_estabelecimento,
      REGEXP_SUBSTR(COALESCE(tempo_entrega, ''), '[0-9]+') AS primeiro,
      REGEXP_SUBSTR(REGEXP_REPLACE(COALESCE(tempo_entrega, ''), '^[^0-9]*[0-9]+', ''), '[0-9]+') AS segundo
    FROM configuracoes_estabelecimento
  ) textos
) tempos ON tempos.id_estabelecimento = ce.id_estabelecimento
CROSS JOIN JSON_TABLE(
  ce.areas_entrega_json,
  '$[*]' COLUMNS (
    bairro VARCHAR(255) PATH '$.bairro' NULL ON EMPTY NULL ON ERROR,
    taxa_centavos VARCHAR(20) PATH '$.taxaCentavos' NULL ON EMPTY NULL ON ERROR
  )
) area
WHERE ce.areas_entrega_json IS NOT NULL
  AND CHAR_LENGTH(TRIM(area.bairro)) BETWEEN 1 AND 120
  AND area.taxa_centavos REGEXP '^[0-9]{1,9}$'
ON DUPLICATE KEY UPDATE tempo_estimado_min = areas_entrega.tempo_estimado_min;
