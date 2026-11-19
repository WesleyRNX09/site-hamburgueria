# Migrações incrementais (PostgreSQL)

Alterações de estrutura feitas depois de uma instalação por `CRIAR_db.sql`.
Nomeie como `NNN_descricao.sql`, em sequência a partir de `001`
(por exemplo, `001_adicionar_campo.sql`).

`npm run db:migrate` executa os arquivos desta pasta em ordem e registra versão
e checksum em `schema_migrations`. Cada arquivo roda **numa transação**, junto
com o próprio registro: se qualquer instrução falhar, nada daquele arquivo
fica aplicado (no PostgreSQL, DDL é transacional). Um arquivo já aplicado cujo
conteúdo mudou é recusado. O checksum normaliza as quebras de linha para dar o
mesmo resultado em Windows e Linux.

Regras (conferidas por `server/multitenant-security.test.js`):

- nada de `DROP TABLE`, `TRUNCATE`, `DELETE FROM` nem `SELECT *`;
- nada de sintaxe do MySQL (`AUTO_INCREMENT`, `ON DUPLICATE KEY`, `UNSIGNED`,
  `DATETIME`, `TINYINT`, crases, `ENGINE=`);
- tabela nova precisa de `ALTER TABLE <tabela> ENABLE ROW LEVEL SECURITY;`,
  senão a API REST do Supabase a expõe;
- coluna nova em tabela existente é `NULL`able ou tem `DEFAULT`;
- depois de criar a migration, aplique a mesma mudança no `CRIAR_db.sql` e
  registre o arquivo nele (`INSERT INTO schema_migrations (versao, checksum)
  VALUES ('NNN_descricao.sql', '<sha256>') ON CONFLICT (versao) DO NOTHING;`),
  para que uma instalação nova não tente reaplicá-la. O teste confere o
  checksum.
- se a tabela nova tiver `id_estabelecimento`, inclua-a em
  `TABELAS_DO_ESTABELECIMENTO` (`server/exclusaoEstabelecimento.js`); se tiver
  id gerado, inclua-a em `COLUNAS_IDENTIDADE` (`server/db/postgres.js`).

Antes de migrar um ambiente persistente, crie e valide um backup.

As migrations `001` a `025` da época do MySQL/MariaDB estão em
[`../mysql-legado/migrations/`](../mysql-legado/migrations/) e não são
executadas: a estrutura final delas já está no `CRIAR_db.sql`.
