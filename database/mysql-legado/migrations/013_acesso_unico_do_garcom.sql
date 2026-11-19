-- Um QR Code por estabelecimento e login do garçom só com a senha.
--
-- Até aqui cada funcionário tinha o próprio QR Code de primeiro acesso e
-- entrava depois com usuário + senha. Isso obrigava o gerente a gerar e
-- entregar um código por pessoa. Agora existe um único QR Code por
-- estabelecimento, que só leva à tela de acesso da equipe, e quem cadastra a
-- senha é o administrador — o garçom digita apenas a senha para entrar.
--
-- Três mudanças:
--   * `estabelecimentos.token_acesso_garcom`: o token do QR Code único. Nasce
--     vazio e é criado sob demanda na primeira vez que o painel o exibe; o
--     administrador pode trocá-lo, e o QR antigo para de valer na hora.
--   * `funcionarios.senha_busca`: índice determinístico da senha, para achar o
--     garçom sem testar o hash de toda a equipe a cada login. É único por
--     estabelecimento, porque a senha sozinha precisa identificar uma pessoa.
--     `pin_hash` continua sendo o que autentica de fato.
--   * `comandas.funcionario_id` passa a ser ON DELETE SET NULL, para o
--     administrador poder excluir um garçom sem apagar as comandas que ele
--     atendeu — o histórico fica, apenas sem o vínculo com o cadastro.
--
-- As credenciais antigas (usuário + senha) deixam de valer: não há como
-- converter o hash existente para o novo índice sem a senha em texto puro. Os
-- cadastros e todo o histórico são preservados; cada funcionário volta a
-- aparecer como "senha pendente" até o administrador definir a nova senha.
-- Sessões já abertas continuam válidas até expirarem.

ALTER TABLE estabelecimentos
  ADD COLUMN token_acesso_garcom VARCHAR(160) NULL AFTER status,
  ADD UNIQUE KEY uk_estabelecimentos_token_garcom (token_acesso_garcom);

ALTER TABLE funcionarios
  ADD COLUMN senha_busca CHAR(64) NULL AFTER pin_hash,
  ADD UNIQUE KEY uk_funcionarios_estabelecimento_senha (id_estabelecimento, senha_busca);

UPDATE funcionarios
SET pin_hash = NULL, senha_definida_em = NULL
WHERE pin_hash IS NOT NULL;

ALTER TABLE comandas
  DROP FOREIGN KEY fk_comandas_funcionario;

ALTER TABLE comandas
  ADD CONSTRAINT fk_comandas_funcionario
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL;
