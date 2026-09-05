-- Dá ao garçom um login próprio (usuário + senha) e transforma o QR Code em
-- credencial de primeiro acesso, usada uma única vez.
--
-- Até aqui quem identificava o garçom era o token do QR: sem ler o código não
-- havia como entrar. Agora o token serve só para o funcionário definir a
-- própria senha; do segundo acesso em diante ele entra digitando usuário e
-- senha, como o administrador.
--
-- Três mudanças em `funcionarios`:
--   * `usuario`: identificador do login, único dentro do estabelecimento;
--   * `pin_hash` passa a aceitar NULL, para o cadastro nascer sem senha
--     enquanto o garçom não fizer o primeiro acesso;
--   * `senha_definida_em`: marca o primeiro acesso concluído e é o que
--     invalida o link do QR — usado uma vez, não vale mais.
--
-- Nenhum funcionário existente perde o acesso: quem já tem senha recebe
-- `senha_definida_em` preenchido e continua entrando com o mesmo PIN, agora
-- pelo usuário gerado a partir do nome. O administrador pode renomear esse
-- usuário na tela de funcionários.

ALTER TABLE funcionarios
  ADD COLUMN usuario VARCHAR(60) NULL AFTER cargo,
  ADD COLUMN senha_definida_em DATETIME NULL AFTER token_acesso,
  MODIFY COLUMN pin_hash VARCHAR(255) NULL;

-- Usuário a partir do nome: acentos trocados pelo equivalente sem acento,
-- espaços viram ponto. O que sobrar fora de [a-z0-9._-] é raro e o
-- administrador ajusta ao editar o funcionário.
UPDATE funcionarios
SET usuario = LEFT(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(
                  REPLACE(
                    REPLACE(
                      REPLACE(
                        REPLACE(
                          REPLACE(
                            REPLACE(
                              REPLACE(
                                REPLACE(
                                  REPLACE(
                                    REPLACE(
                                      REPLACE(
                                        REPLACE(
                                          REPLACE(LOWER(nome), 'á', 'a'),
                                        'à', 'a'),
                                      'â', 'a'),
                                    'ã', 'a'),
                                  'ä', 'a'),
                                'é', 'e'),
                              'ê', 'e'),
                            'è', 'e'),
                          'í', 'i'),
                        'ì', 'i'),
                      'ó', 'o'),
                    'ô', 'o'),
                  'õ', 'o'),
                'ò', 'o'),
              'ú', 'u'),
            'ù', 'u'),
          'û', 'u'),
        'ü', 'u'),
      'ç', 'c'),
    'ñ', 'n'),
  ' ', '.'),
  50)
WHERE usuario IS NULL;

UPDATE funcionarios
SET usuario = CONCAT('garcom', id)
WHERE usuario IS NULL OR usuario = '';

-- Desempate: nomes iguais no mesmo estabelecimento ganham o id no final.
UPDATE funcionarios f
INNER JOIN (
  SELECT id_estabelecimento, usuario
  FROM funcionarios
  GROUP BY id_estabelecimento, usuario
  HAVING COUNT(*) > 1
) repetidos
  ON repetidos.usuario = f.usuario
  AND (repetidos.id_estabelecimento = f.id_estabelecimento
    OR (repetidos.id_estabelecimento IS NULL AND f.id_estabelecimento IS NULL))
SET f.usuario = CONCAT(LEFT(f.usuario, 50), '.', f.id);

-- Quem já tinha PIN continua entrando com ele: o primeiro acesso está feito.
UPDATE funcionarios
SET senha_definida_em = criado_em
WHERE senha_definida_em IS NULL
  AND pin_hash IS NOT NULL
  AND pin_hash <> '';

ALTER TABLE funcionarios
  MODIFY COLUMN usuario VARCHAR(60) NOT NULL,
  ADD UNIQUE KEY uk_funcionarios_estabelecimento_usuario (id_estabelecimento, usuario);
