-- Permissões granulares dos administradores do estabelecimento.
--
-- Até aqui todo administrador ativo podia tudo no painel. A partir desta
-- migration cada administrador tem a sua lista de permissões, sempre dentro do
-- próprio estabelecimento. A lista de valores é fixa (CHECK) e acompanha
-- src/utils/permissoes.js.
--
-- Ninguém perde acesso: todo administrador já cadastrado recebe as 13
-- permissões, que é exatamente o que ele podia fazer antes. Administrador sem
-- estabelecimento não entra em sessão nenhuma hoje, então não recebe linhas.
--
-- Garçons e superadministradores não usam esta tabela.

CREATE TABLE IF NOT EXISTS administrador_permissoes (
  id_estabelecimento BIGINT UNSIGNED NOT NULL,
  administrador_id BIGINT UNSIGNED NOT NULL,
  permissao VARCHAR(40) NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (administrador_id, permissao),
  INDEX idx_administrador_permissoes_estabelecimento (id_estabelecimento),
  CONSTRAINT chk_administrador_permissoes_permissao
    CHECK (permissao IN (
      'dashboard.visualizar', 'pedidos.visualizar', 'pedidos.alterar_status',
      'pedidos.gerenciar_pagamento', 'mesas.operar', 'mesas.fechar', 'mesas.cadastrar',
      'produtos.editar', 'relatorios.visualizar', 'funcionarios.gerenciar',
      'personalizacao.editar', 'delivery.editar', 'configuracoes.editar'
    )),
  CONSTRAINT fk_administrador_permissoes_estabelecimento
    FOREIGN KEY (id_estabelecimento)
    REFERENCES estabelecimentos(id_estabelecimento) ON DELETE RESTRICT,
  CONSTRAINT fk_administrador_permissoes_administrador
    FOREIGN KEY (administrador_id) REFERENCES administradores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO administrador_permissoes (id_estabelecimento, administrador_id, permissao)
SELECT a.id_estabelecimento, a.id, padrao.permissao
FROM administradores a
CROSS JOIN (
  SELECT 'dashboard.visualizar' AS permissao
  UNION ALL SELECT 'pedidos.visualizar'
  UNION ALL SELECT 'pedidos.alterar_status'
  UNION ALL SELECT 'pedidos.gerenciar_pagamento'
  UNION ALL SELECT 'mesas.operar'
  UNION ALL SELECT 'mesas.fechar'
  UNION ALL SELECT 'mesas.cadastrar'
  UNION ALL SELECT 'produtos.editar'
  UNION ALL SELECT 'relatorios.visualizar'
  UNION ALL SELECT 'funcionarios.gerenciar'
  UNION ALL SELECT 'personalizacao.editar'
  UNION ALL SELECT 'delivery.editar'
  UNION ALL SELECT 'configuracoes.editar'
) padrao
WHERE a.id_estabelecimento IS NOT NULL
ON DUPLICATE KEY UPDATE permissao = VALUES(permissao);
