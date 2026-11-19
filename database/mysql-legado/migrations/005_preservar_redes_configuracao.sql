-- Completa a configuração multiempresa com os campos já usados pelo painel.
-- O backfill preserva as redes sociais da configuração legada.

ALTER TABLE configuracoes_estabelecimento
  ADD COLUMN instagram_url VARCHAR(500) AFTER horario_funcionamento,
  ADD COLUMN facebook_url VARCHAR(500) AFTER instagram_url;

UPDATE configuracoes_estabelecimento AS ce
INNER JOIN configuracoes AS c
  ON c.id_estabelecimento = ce.id_estabelecimento
SET
  ce.instagram_url = c.instagram_url,
  ce.facebook_url = c.facebook_url
WHERE ce.instagram_url IS NULL
  AND ce.facebook_url IS NULL;
