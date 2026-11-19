# Legado MySQL/MariaDB (somente histórico)

O sistema usava MySQL (desenvolvimento) e MariaDB (produção na Hostinger) até
a migração para PostgreSQL/Supabase. Esta pasta guarda, sem alteração, o que
existia naquela época:

- `CRIAR_db.sql`, `estrutura/` e `seeds/` — o esquema MySQL;
- `migrations/` — as migrations `001` a `025` e o histórico `legado/`;
- `verificacoes/` — consultas de conferência da instalação MySQL;
- `local/` — preparo de um MySQL local.

**Nada aqui roda no PostgreSQL** e nenhum script do projeto lê esta pasta. Use
apenas como referência — por exemplo, para entender a origem de uma coluna ou
para montar uma importação de dados de um banco MySQL antigo (ver
[`../../docs/DEPLOY.md`](../../docs/DEPLOY.md), seção "Migração para
PostgreSQL").
