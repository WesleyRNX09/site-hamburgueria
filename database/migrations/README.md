# Migrações incrementais

Esta pasta contém as migrações novas e idempotentes, nomeadas como
`NNN_descricao.sql` (por exemplo, `001_adicionar_campo.sql`). O comando
`npm run db:migrate` executa os arquivos da raiz desta pasta em ordem,
registra versão e checksum em `schema_migrations` e recusa um arquivo já
aplicado cujo conteúdo tenha sido alterado. O checksum normaliza as quebras de
linha para produzir o mesmo resultado em Windows e Linux; hashes CRLF antigos
são reconhecidos e atualizados para o formato estável pelo próprio runner.

Antes de migrar um ambiente persistente, crie e valide um backup. Comandos
DDL do MySQL podem efetuar commit implícito; portanto, um erro interrompe a
migração, mas não garante reversão automática do que já tiver sido aplicado.

A pasta `legado/` preserva o histórico anterior e não é executada pelo runner.

## Estado atual

- `001_adicionar_estabelecimentos.sql`: cria as tabelas globais
  `estabelecimentos` e `configuracoes_estabelecimento`, sem inserir ou alterar
  dados operacionais.
- `002_adicionar_escopo_estabelecimento.sql`: adiciona `id_estabelecimento`
  nullable às 19 tabelas de negócio.
- `003_relacionar_dados_estabelecimento.sql`: cria o estabelecimento padrão,
  copia a configuração atual e faz o backfill sem excluir registros.
- `004_adicionar_integridade_estabelecimento.sql`: adiciona índices e FKs para
  o estabelecimento depois do backfill, mantendo compatibilidade de escrita.
- `005_preservar_redes_configuracao.sql`: completa a configuração multiempresa
  e preserva as redes sociais cadastradas no modelo legado.
- `006_ajustar_unicidade_por_estabelecimento.sql`: permite que tenants distintos
  reutilizem usuários, e-mails, nomes de catálogo, números de mesa e chaves de
  idempotência.
- `007_adicionar_superadministradores.sql`: cria credenciais, sessões revogáveis
  e auditoria globais do painel de superadministrador, sem criar senha padrão.
- `legado/20260824_operacao_comercial.sql`: histórico anterior, fora do runner.
