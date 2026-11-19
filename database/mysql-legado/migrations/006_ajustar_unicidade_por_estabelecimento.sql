-- Remove unicidades globais que impediriam tenants diferentes de reutilizar
-- usuários, e-mails, nomes de catálogo e números de mesa comuns.

ALTER TABLE administradores
  DROP INDEX usuario,
  DROP INDEX email,
  ADD UNIQUE KEY uk_administradores_estabelecimento_usuario
    (id_estabelecimento, usuario),
  ADD UNIQUE KEY uk_administradores_estabelecimento_email
    (id_estabelecimento, email);

ALTER TABLE categorias
  DROP INDEX nome,
  ADD UNIQUE KEY uk_categorias_estabelecimento_nome
    (id_estabelecimento, nome);

ALTER TABLE adicionais
  DROP INDEX nome,
  ADD UNIQUE KEY uk_adicionais_estabelecimento_nome
    (id_estabelecimento, nome);

ALTER TABLE mesas
  DROP INDEX numero,
  ADD UNIQUE KEY uk_mesas_estabelecimento_numero
    (id_estabelecimento, numero);

ALTER TABLE pedidos
  DROP INDEX uk_pedidos_chave_idempotencia,
  ADD UNIQUE KEY uk_pedidos_estabelecimento_idempotencia
    (id_estabelecimento, chave_idempotencia_hash);
