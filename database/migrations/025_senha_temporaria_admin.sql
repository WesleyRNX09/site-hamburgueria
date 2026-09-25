-- Senha temporária do administrador do estabelecimento.
--
-- Quando outra pessoa escolhe a senha de um administrador — o superadmin ao
-- criar o primeiro administrador da loja, ou ao redefinir a senha de um
-- administrador —, essa senha passa a ser temporária: o próximo login entra,
-- mas o painel só libera a troca de senha. Ao trocar, a marca volta a 0.
--
-- Coluna nova com DEFAULT 0: nenhuma linha é reescrita, e os administradores
-- já cadastrados continuam entrando normalmente, sem exigir troca.

ALTER TABLE administradores
  ADD COLUMN trocar_senha_em_proximo_acesso TINYINT(1) NOT NULL DEFAULT 0 AFTER senha_hash;
