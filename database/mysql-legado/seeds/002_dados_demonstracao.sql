-- Seed opcional. Nunca execute automaticamente em produção.
-- Troque a variável para 1 somente em ambiente descartável.

SET @CARREGAR_DEMONSTRACAO = 0;

START TRANSACTION;

INSERT INTO adicionais (id, nome, preco_centavos, ativo)
SELECT id, nome, preco_centavos, 1
FROM (
  SELECT 1 id, 'Bacon extra' nome, 500 preco_centavos UNION ALL
  SELECT 2, 'Cheddar extra', 400 UNION ALL
  SELECT 3, 'Hambúrguer extra', 1000 UNION ALL
  SELECT 4, 'Ovo', 300 UNION ALL
  SELECT 5, 'Cebola caramelizada', 400 UNION ALL
  SELECT 6, 'Catupiry', 600
) AS dados
WHERE @CARREGAR_DEMONSTRACAO = 1
ON DUPLICATE KEY UPDATE nome = VALUES(nome), preco_centavos = VALUES(preco_centavos);

INSERT INTO produtos (id, categoria_id, nome, descricao, preco_centavos, destaque, ativo)
SELECT id, categoria_id, nome, descricao, preco_centavos, destaque, 1
FROM (
  SELECT 1 id, 1 categoria_id, 'X-Bacon' nome, 'Pão brioche, hambúrguer artesanal, cheddar cremoso, bacon crocante, alface e tomate.' descricao, 3490 preco_centavos, 'Mais vendido' destaque UNION ALL
  SELECT 2, 1, 'X-Salada', 'Pão brioche, hambúrguer artesanal, queijo, alface, tomate e molho especial da casa.', 2990, NULL UNION ALL
  SELECT 3, 1, 'Duplo Bacon', 'Dois hambúrgueres artesanais, cheddar duplo, bacon crocante e molho especial.', 4290, 'Recomendado' UNION ALL
  SELECT 4, 1, 'X-Tudo', 'Hambúrguer artesanal, queijo, bacon, ovo, presunto, alface, tomate e maionese.', 3990, NULL UNION ALL
  SELECT 5, 2, 'Combo X-Bacon', 'X-Bacon acompanhado de batata frita e refrigerante.', 4990, NULL UNION ALL
  SELECT 6, 3, 'Batata com Cheddar', 'Batata frita crocante com cheddar cremoso e bacon.', 2490, NULL UNION ALL
  SELECT 7, 4, 'Refrigerante', 'Refrigerante gelado disponível em diversos sabores.', 700, NULL
) AS dados
WHERE @CARREGAR_DEMONSTRACAO = 1
ON DUPLICATE KEY UPDATE
  categoria_id = VALUES(categoria_id), nome = VALUES(nome),
  descricao = VALUES(descricao), preco_centavos = VALUES(preco_centavos),
  destaque = VALUES(destaque);

INSERT IGNORE INTO produto_adicionais (produto_id, adicional_id)
SELECT produto_id, adicional_id
FROM (
  SELECT 1 produto_id, 1 adicional_id UNION ALL SELECT 1, 2 UNION ALL SELECT 1, 3 UNION ALL SELECT 1, 4 UNION ALL SELECT 1, 5 UNION ALL SELECT 1, 6 UNION ALL
  SELECT 2, 1 UNION ALL SELECT 2, 2 UNION ALL SELECT 2, 3 UNION ALL SELECT 2, 4 UNION ALL SELECT 2, 5 UNION ALL SELECT 2, 6 UNION ALL
  SELECT 3, 1 UNION ALL SELECT 3, 2 UNION ALL SELECT 3, 3 UNION ALL SELECT 3, 4 UNION ALL SELECT 3, 5 UNION ALL SELECT 3, 6 UNION ALL
  SELECT 4, 1 UNION ALL SELECT 4, 2 UNION ALL SELECT 4, 3 UNION ALL SELECT 4, 4 UNION ALL SELECT 4, 5 UNION ALL SELECT 4, 6 UNION ALL
  SELECT 5, 1 UNION ALL SELECT 5, 2 UNION ALL SELECT 5, 3 UNION ALL SELECT 5, 5 UNION ALL SELECT 5, 6 UNION ALL
  SELECT 6, 1 UNION ALL SELECT 6, 2 UNION ALL SELECT 6, 6
) AS dados
WHERE @CARREGAR_DEMONSTRACAO = 1;

COMMIT;
