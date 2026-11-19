-- Ciclo de vida do estabelecimento: ativo, suspenso e arquivado.
--
-- Até aqui `estabelecimentos.status` aceitava qualquer texto e o painel do
-- superadministrador só alternava entre 'ativo' e 'inativo'. O ciclo passa a
-- ter três estados fixos, trocados apenas pelas ações dedicadas do painel:
--
--   ativo    -> suspenso   (suspender, com motivo obrigatório)
--   suspenso -> ativo      (reativar)
--   suspenso -> arquivado  (arquivar; exige estar suspenso antes)
--   arquivado -> suspenso  (desarquivar)
--
-- Arquivar não apaga nada: a linha e todos os dados da loja continuam no banco.
-- A exclusão definitiva fica para uma etapa futura, a partir do arquivamento.
--
-- Colunas novas e opcionais. `arquivado_por` usa o mesmo tipo de
-- `superadministradores.id` e perde o valor (SET NULL) se a conta global for
-- removida, para o estabelecimento continuar arquivado mesmo sem o autor.

ALTER TABLE estabelecimentos
  ADD COLUMN suspenso_em DATETIME NULL AFTER status,
  ADD COLUMN motivo_suspensao VARCHAR(280) NULL AFTER suspenso_em,
  ADD COLUMN arquivado_em DATETIME NULL AFTER motivo_suspensao,
  ADD COLUMN arquivado_por BIGINT UNSIGNED NULL AFTER arquivado_em;

-- Conversão não destrutiva: qualquer status fora dos três novos (na prática,
-- 'inativo') vira 'suspenso', que é o que ele já significava — a loja fora do
-- ar, mas com os dados preservados. O momento da conversão fica em
-- `suspenso_em`, em UTC como o restante do aplicativo. Nenhuma loja ativa muda.
UPDATE estabelecimentos
SET status = 'suspenso',
    suspenso_em = UTC_TIMESTAMP()
WHERE status NOT IN ('ativo', 'suspenso', 'arquivado');

-- Só depois da conversão: com linhas fora da lista, o CHECK seria recusado.
ALTER TABLE estabelecimentos
  ADD CONSTRAINT chk_estabelecimentos_status
    CHECK (status IN ('ativo', 'suspenso', 'arquivado'));

ALTER TABLE estabelecimentos
  ADD INDEX idx_estabelecimentos_arquivado_por (arquivado_por),
  ADD CONSTRAINT fk_estabelecimentos_arquivado_por
    FOREIGN KEY (arquivado_por)
    REFERENCES superadministradores(id) ON DELETE SET NULL;
