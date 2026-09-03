-- Prepara APENAS o ambiente MySQL local de desenvolvimento: cria o schema
-- vazio e a conta da aplicação. Não cria tabelas — a estrutura vem de
-- ../CRIAR_db.sql ou de `npm run db:prepare`.
--
-- Este arquivo não faz parte da estrutura versionada do banco. A fonte da
-- verdade do schema continua sendo ../CRIAR_db.sql + ../migrations/.
--
-- A senha NÃO fica gravada aqui: informe-a em @senha_app na execução.
--
-- Uso (a partir da raiz do projeto):
--   mysql -u root -p --init-command="SET @senha_app='SUA_SENHA_LOCAL'" \
--     < database/local/001_ambiente_local.sql
--
-- Depois, use a mesma senha em DB_PASSWORD no .env.

-- Sem senha informada, @senha_app vira NULL; os CONCAT abaixo também viram
-- NULL e o PREPARE falha, em vez de criar uma conta sem senha.
SET @senha_app = NULLIF(TRIM(IFNULL(@senha_app, '')), '');

SELECT IF(
  @senha_app IS NULL,
  'ERRO: senha nao informada. Use --init-command="SET @senha_app=''sua-senha''"',
  'Senha recebida; criando schema e conta local.'
) AS validacao;

-- Schema local descartável.
-- Mantido em UMA linha: o MySQL Workbench quebra este comando na quebra de
-- linha e executa "CHARACTER SET ..." como statement solto (erro 1064).
CREATE DATABASE IF NOT EXISTS `hamburgueria` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Conta da aplicação. mysql2 conecta por TCP em 127.0.0.1; dependendo da
-- resolução de nomes o servidor identifica o cliente como 'localhost' ou
-- '127.0.0.1', então as duas formas são criadas.
SET @sql = CONCAT("CREATE USER IF NOT EXISTS 'hamburgueria_app'@'localhost' IDENTIFIED BY '", @senha_app, "'");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = CONCAT("ALTER USER 'hamburgueria_app'@'localhost' IDENTIFIED BY '", @senha_app, "'");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = CONCAT("CREATE USER IF NOT EXISTS 'hamburgueria_app'@'127.0.0.1' IDENTIFIED BY '", @senha_app, "'");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = CONCAT("ALTER USER 'hamburgueria_app'@'127.0.0.1' IDENTIFIED BY '", @senha_app, "'");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Privilégios limitados ao schema local. Inclui DDL porque `db:prepare` e
-- `db:migrate` rodam aqui. Em produção a conta da aplicação deve ficar
-- somente com DML, conforme ../README.md ("TLS e segredos").
GRANT ALL PRIVILEGES ON `hamburgueria`.* TO 'hamburgueria_app'@'localhost';
GRANT ALL PRIVILEGES ON `hamburgueria`.* TO 'hamburgueria_app'@'127.0.0.1';

FLUSH PRIVILEGES;

SELECT 'Ambiente local pronto. Aponte o .env para ele e rode npm run db:prepare.' AS proximo_passo;
