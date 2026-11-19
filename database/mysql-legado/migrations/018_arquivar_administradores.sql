-- Arquivamento de administradores do estabelecimento.
--
-- Arquivar tira a conta da lista do painel e o acesso dela, mas mantém a linha
-- para que o histórico (auditoria, pagamentos confirmados, comandas abertas)
-- continue mostrando quem fez cada ação. A data fica em `arquivado_em`; NULL
-- significa conta em uso.
--
-- Coluna nova e opcional: nenhuma linha existente muda e ninguém é arquivado.

ALTER TABLE administradores
  ADD COLUMN arquivado_em DATETIME NULL AFTER ativo;
