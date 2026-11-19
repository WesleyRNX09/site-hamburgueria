-- Verificações somente leitura após as migrations 001 a 004.

SELECT
  e.id_estabelecimento,
  e.nome_fantasia,
  e.slug,
  e.status,
  e.plano,
  e.status_assinatura,
  CASE WHEN ce.id_estabelecimento IS NULL THEN 0 ELSE 1 END AS possui_configuracao
FROM estabelecimentos AS e
LEFT JOIN configuracoes_estabelecimento AS ce
  ON ce.id_estabelecimento = e.id_estabelecimento
ORDER BY e.id_estabelecimento;

SELECT 'administradores' AS tabela, COUNT(*) AS registros_sem_estabelecimento
FROM administradores WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'sessoes_admin', COUNT(*) FROM sessoes_admin WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'auditoria_admin', COUNT(*) FROM auditoria_admin WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'categorias', COUNT(*) FROM categorias WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'adicionais', COUNT(*) FROM adicionais WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'produtos', COUNT(*) FROM produtos WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'produto_adicionais', COUNT(*) FROM produto_adicionais WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'promocoes', COUNT(*) FROM promocoes WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'funcionarios', COUNT(*) FROM funcionarios WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'sessoes_garcom', COUNT(*) FROM sessoes_garcom WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'mesas', COUNT(*) FROM mesas WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'comandas', COUNT(*) FROM comandas WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'comanda_itens', COUNT(*) FROM comanda_itens WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'comanda_item_adicionais', COUNT(*) FROM comanda_item_adicionais WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'pedidos', COUNT(*) FROM pedidos WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'pedido_itens', COUNT(*) FROM pedido_itens WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'pedido_item_adicionais', COUNT(*) FROM pedido_item_adicionais WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'pagamentos', COUNT(*) FROM pagamentos WHERE id_estabelecimento IS NULL
UNION ALL
SELECT 'configuracoes', COUNT(*) FROM configuracoes WHERE id_estabelecimento IS NULL;

SELECT 'sessoes_admin -> administradores' AS relacionamento, COUNT(*) AS escopos_divergentes
FROM sessoes_admin AS s
INNER JOIN administradores AS a ON a.id = s.administrador_id
WHERE s.id_estabelecimento <> a.id_estabelecimento
UNION ALL
SELECT 'auditoria_admin -> administradores', COUNT(*)
FROM auditoria_admin AS au
INNER JOIN administradores AS a ON a.id = au.administrador_id
WHERE au.id_estabelecimento <> a.id_estabelecimento
UNION ALL
SELECT 'produtos -> categorias', COUNT(*)
FROM produtos AS p
INNER JOIN categorias AS c ON c.id = p.categoria_id
WHERE p.id_estabelecimento <> c.id_estabelecimento
UNION ALL
SELECT 'produto_adicionais -> produtos', COUNT(*)
FROM produto_adicionais AS pa
INNER JOIN produtos AS p ON p.id = pa.produto_id
WHERE pa.id_estabelecimento <> p.id_estabelecimento
UNION ALL
SELECT 'produto_adicionais -> adicionais', COUNT(*)
FROM produto_adicionais AS pa
INNER JOIN adicionais AS a ON a.id = pa.adicional_id
WHERE pa.id_estabelecimento <> a.id_estabelecimento
UNION ALL
SELECT 'promocoes -> produtos', COUNT(*)
FROM promocoes AS pr
INNER JOIN produtos AS p ON p.id = pr.produto_id
WHERE pr.id_estabelecimento <> p.id_estabelecimento
UNION ALL
SELECT 'sessoes_garcom -> funcionarios', COUNT(*)
FROM sessoes_garcom AS s
INNER JOIN funcionarios AS f ON f.id = s.funcionario_id
WHERE s.id_estabelecimento <> f.id_estabelecimento
UNION ALL
SELECT 'comandas -> mesas', COUNT(*)
FROM comandas AS c
INNER JOIN mesas AS m ON m.id = c.mesa_id
WHERE c.id_estabelecimento <> m.id_estabelecimento
UNION ALL
SELECT 'comandas -> funcionarios', COUNT(*)
FROM comandas AS c
INNER JOIN funcionarios AS f ON f.id = c.funcionario_id
WHERE c.id_estabelecimento <> f.id_estabelecimento
UNION ALL
SELECT 'comanda_itens -> comandas', COUNT(*)
FROM comanda_itens AS ci
INNER JOIN comandas AS c ON c.id = ci.comanda_id
WHERE ci.id_estabelecimento <> c.id_estabelecimento
UNION ALL
SELECT 'comanda_itens -> produtos', COUNT(*)
FROM comanda_itens AS ci
INNER JOIN produtos AS p ON p.id = ci.produto_id
WHERE ci.id_estabelecimento <> p.id_estabelecimento
UNION ALL
SELECT 'comanda_item_adicionais -> comanda_itens', COUNT(*)
FROM comanda_item_adicionais AS cia
INNER JOIN comanda_itens AS ci ON ci.id = cia.comanda_item_id
WHERE cia.id_estabelecimento <> ci.id_estabelecimento
UNION ALL
SELECT 'comanda_item_adicionais -> adicionais', COUNT(*)
FROM comanda_item_adicionais AS cia
INNER JOIN adicionais AS a ON a.id = cia.adicional_id
WHERE cia.id_estabelecimento <> a.id_estabelecimento
UNION ALL
SELECT 'pedidos -> comandas', COUNT(*)
FROM pedidos AS p
INNER JOIN comandas AS c ON c.id = p.comanda_id
WHERE p.id_estabelecimento <> c.id_estabelecimento
UNION ALL
SELECT 'pedidos -> mesas', COUNT(*)
FROM pedidos AS p
INNER JOIN mesas AS m ON m.id = p.mesa_id
WHERE p.id_estabelecimento <> m.id_estabelecimento
UNION ALL
SELECT 'pedidos -> funcionarios', COUNT(*)
FROM pedidos AS p
INNER JOIN funcionarios AS f ON f.id = p.funcionario_id
WHERE p.id_estabelecimento <> f.id_estabelecimento
UNION ALL
SELECT 'pedido_itens -> pedidos', COUNT(*)
FROM pedido_itens AS pi
INNER JOIN pedidos AS p ON p.id = pi.pedido_id
WHERE pi.id_estabelecimento <> p.id_estabelecimento
UNION ALL
SELECT 'pedido_itens -> produtos', COUNT(*)
FROM pedido_itens AS pi
INNER JOIN produtos AS p ON p.id = pi.produto_id
WHERE pi.id_estabelecimento <> p.id_estabelecimento
UNION ALL
SELECT 'pedido_itens -> promocoes', COUNT(*)
FROM pedido_itens AS pi
INNER JOIN promocoes AS pr ON pr.id = pi.promocao_id
WHERE pi.id_estabelecimento <> pr.id_estabelecimento
UNION ALL
SELECT 'pedido_item_adicionais -> pedido_itens', COUNT(*)
FROM pedido_item_adicionais AS pia
INNER JOIN pedido_itens AS pi ON pi.id = pia.pedido_item_id
WHERE pia.id_estabelecimento <> pi.id_estabelecimento
UNION ALL
SELECT 'pedido_item_adicionais -> adicionais', COUNT(*)
FROM pedido_item_adicionais AS pia
INNER JOIN adicionais AS a ON a.id = pia.adicional_id
WHERE pia.id_estabelecimento <> a.id_estabelecimento
UNION ALL
SELECT 'pagamentos -> pedidos', COUNT(*)
FROM pagamentos AS pg
INNER JOIN pedidos AS p ON p.id = pg.pedido_id
WHERE pg.id_estabelecimento <> p.id_estabelecimento
UNION ALL
SELECT 'pagamentos -> comandas', COUNT(*)
FROM pagamentos AS pg
INNER JOIN comandas AS c ON c.id = pg.comanda_id
WHERE pg.id_estabelecimento <> c.id_estabelecimento
UNION ALL
SELECT 'pagamentos -> administrador confirmador', COUNT(*)
FROM pagamentos AS pg
INNER JOIN administradores AS a ON a.id = pg.confirmado_por
WHERE pg.id_estabelecimento <> a.id_estabelecimento
UNION ALL
SELECT 'pagamentos -> administrador estornador', COUNT(*)
FROM pagamentos AS pg
INNER JOIN administradores AS a ON a.id = pg.estornado_por
WHERE pg.id_estabelecimento <> a.id_estabelecimento;
