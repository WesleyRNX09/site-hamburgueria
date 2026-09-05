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
- `008_adicionar_textos_publicos.sql`: adiciona os textos editáveis do banner,
  do cardápio e da seção "sobre" (título, subtítulo, texto do botão e destino
  do banner; título e apresentação do cardápio; título e texto da seção
  sobre; mensagem de rodapé) a `configuracoes_estabelecimento`, todos opcionais.
- `009_marcar_lancamento_itens_comanda.sql`: adiciona `enviado_em` a
  `comanda_itens` para separar o que já foi lançado para a cozinha do que
  ainda está pendente de confirmação, marcando como lançado o histórico das
  comandas já enviadas.
- `010_preparar_pagamento_no_caixa.sql`: guarda em `pagamentos` o valor
  recebido, o troco calculado no servidor e a origem da confirmação
  (`provedor` e `referencia_externa`), abrindo espaço para integração futura
  com gateway sem mudar o esquema de novo.
- `011_registrar_autoria_da_comanda.sql`: torna `funcionario_id` opcional em
  `comandas` (o painel abre a comanda direto, sem escolher garçom), guarda o
  administrador que abriu e registra em cada item de comanda quem o lançou
  para a cozinha, com backfill pelo responsável atual da comanda.
- `012_adicionar_login_do_garcom.sql`: dá ao garçom login próprio (`usuario`,
  único por estabelecimento) e transforma o QR Code em credencial de primeiro
  acesso: `pin_hash` passa a aceitar NULL enquanto a senha não é criada e
  `senha_definida_em` marca o link como usado. Faz backfill do usuário a
  partir do nome e mantém quem já tinha PIN entrando com a mesma senha.
- `legado/20260824_operacao_comercial.sql`: histórico anterior, fora do runner.
