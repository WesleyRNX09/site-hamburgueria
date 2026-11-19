-- Registra quem abriu a comanda e quem lançou cada item para a cozinha.
--
-- O painel passa a abrir a comanda direto no clique da mesa, sem escolher um
-- garçom: nesse caso a comanda nasce sem responsável (funcionario_id NULL) e
-- guarda o administrador que a abriu. O primeiro garçom que atender a mesa
-- assume a comanda. Por isso funcionario_id deixa de ser obrigatório —
-- nenhuma comanda existente é alterada, e a chave estrangeira continua
-- valendo para os valores preenchidos.

ALTER TABLE comandas
  MODIFY COLUMN funcionario_id BIGINT UNSIGNED NULL,
  ADD COLUMN aberta_por_admin_id BIGINT UNSIGNED NULL AFTER funcionario_id,
  ADD INDEX idx_comandas_aberta_por_admin (aberta_por_admin_id),
  ADD CONSTRAINT fk_comandas_aberta_por_admin
    FOREIGN KEY (aberta_por_admin_id) REFERENCES administradores(id) ON DELETE SET NULL;

ALTER TABLE comanda_itens
  ADD COLUMN enviado_por_funcionario_id BIGINT UNSIGNED NULL AFTER enviado_em,
  ADD COLUMN enviado_por_admin_id BIGINT UNSIGNED NULL AFTER enviado_por_funcionario_id,
  ADD INDEX idx_comanda_itens_enviado_funcionario (enviado_por_funcionario_id),
  ADD INDEX idx_comanda_itens_enviado_admin (enviado_por_admin_id),
  ADD CONSTRAINT fk_comanda_itens_enviado_funcionario
    FOREIGN KEY (enviado_por_funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_comanda_itens_enviado_admin
    FOREIGN KEY (enviado_por_admin_id) REFERENCES administradores(id) ON DELETE SET NULL;

UPDATE comanda_itens ci
INNER JOIN comandas c
  ON c.id = ci.comanda_id
  AND c.id_estabelecimento = ci.id_estabelecimento
SET ci.enviado_por_funcionario_id = c.funcionario_id
WHERE ci.enviado_em IS NOT NULL
  AND ci.enviado_por_funcionario_id IS NULL
  AND c.funcionario_id IS NOT NULL;
