# Implantação em produção

## Arquitetura recomendada

- Node.js 22 executa a API e serve o `dist` já compilado.
- PostgreSQL no Supabase (projeto exclusivo), acessado pelo Session pooler com TLS validado.
- Um proxy reverso (Nginx, Caddy, IIS ou serviço gerenciado) termina HTTPS e encaminha para `127.0.0.1:3001`.
- `UPLOADS_PATH` aponta para volume persistente fora da pasta substituída a cada release.
- `database/CRIAR_db.sql` documenta a criação limpa da estrutura PostgreSQL; `database/migrations` contém somente alterações incrementais. O esquema MySQL anterior está em `database/mysql-legado/`, só como histórico.
- Um gerenciador de processos (serviço do Windows, systemd ou PM2) reinicia o Node após falhas e inicialização da máquina.

## Preparação

1. Crie o projeto no Supabase e execute `database/CRIAR_db.sql` no SQL Editor, conforme [`INSTALACAO.md`](INSTALACAO.md).
2. Crie `.env` somente no servidor e preencha o modelo seguro de
   [`INSTALACAO.md`](INSTALACAO.md). Não copie credenciais para o Git.
3. Defina `NODE_ENV=production`, `PUBLIC_SITE_URL`, `VITE_PUBLIC_URL` e `CORS_ORIGINS` com a origem HTTPS exata. Defina `DATABASE_URL` (Session pooler), `DB_SSL=true` e `DB_SSL_CA` com o certificado baixado do Supabase.
4. Em banco existente, faça backup, revise as migrations e execute `npm run db:migrate`; nunca reaplique o instalador completo.
5. Defina `SUPERADMIN_PASSWORD` com no mínimo 12 caracteres e execute
   `npm run criar-superadmin`. Para manter o estabelecimento inicial de
   compatibilidade, defina também `ADMIN_PASSWORD` e execute
   `npm run criar-admin-inicial`. Depois, remova as senhas do ambiente de
   execução se elas não forem necessárias para recuperação operacional.
6. Defina um caminho absoluto e persistente para `UPLOADS_PATH`, crie a pasta
   e conceda leitura/escrita somente ao usuário do serviço Node.
7. Execute `npm ci`, os testes adequados em banco isolado, `npm run lint`, `npm run build` e `npm run db:check`.
8. Inicie com `npm start`; exponha apenas o proxy HTTPS, nunca a porta interna diretamente à internet. O startup valida a conexão, mas não cria nem altera estruturas ou usuários.

O roteiro completo, incluindo DNS curinga, domínio personalizado, SSL do banco,
verificação, backup e cadastro do primeiro estabelecimento, está em
[`INSTALACAO.md`](INSTALACAO.md).

Exemplo conceitual de proxy:

```text
https://pedidos.exemplo -> proxy HTTPS -> http://127.0.0.1:3001
```

O domínio acima é apenas formato ilustrativo: use o domínio real do proprietário. Em produção, a API envia HSTS e CSP; portanto o serviço deve estar realmente protegido por HTTPS. Mantenha frontend e API na mesma origem quando possível.

## Uploads isolados por estabelecimento

Novas imagens são armazenadas em
`UPLOADS_PATH/estabelecimentos/{id_estabelecimento}/` e publicadas como
`/uploads/estabelecimentos/{id_estabelecimento}/{arquivo}`. O ID usado na
gravação vem do tenant autenticado no backend, nunca do formulário. Na leitura,
o backend resolve novamente o estabelecimento pelo domínio e retorna `404` se
o ID da URL pertencer a outro tenant.

O proxy reverso deve encaminhar também `/uploads/` para o processo Node. Não
configure `alias`, `root`, bucket público ou CDN para servir essa pasta
diretamente, pois isso contornaria a validação de tenant. Em uma implantação
com várias instâncias da aplicação, todas precisam usar o mesmo volume
persistente compartilhado; disco efêmero ou discos locais independentes
causam perda ou inconsistência de imagens.

Exemplos de raiz persistente:

```text
/var/lib/hamburgueria/uploads
D:\dados\hamburgueria\uploads
```

No Linux, use como referência diretórios `750` e arquivos `640`, pertencentes
ao usuário/grupo do serviço. A aplicação solicita essas permissões ao criar
novos itens, mas o volume e a pasta raiz precisam estar preparados pela
infraestrutura. Se `UPLOADS_PATH` for alterado, copie todo o conteúdo da raiz
antiga preservando nomes e subpastas antes de iniciar a nova versão.

Arquivos antigos no formato `/uploads/{arquivo}` continuam funcionando sem
movimentação manual. Para eles, o backend consulta a propriedade registrada no
banco antes de servir. Novos arquivos são sempre gravados na estrutura isolada.

## Operação

- Preserve `UPLOADS_PATH` entre releases e inclua-o em backup separado do banco,
  mantendo a correspondência entre o backup dos arquivos e o backup do banco.
- Direcione stdout/stderr estruturados do processo para a solução de logs do servidor, com rotação e acesso restrito.
- Monitore `/api/saude`, uso de disco, conexões do banco (Supabase → Reports), erros HTTP 5xx e validade do certificado.
- Mantenha cópias operacionais do banco (backups do Supabase ou `pg_dump`) e teste a restauração em ambiente isolado. `database/CRIAR_db.sql` recria uma instalação limpa, mas não substitui uma cópia dos dados reais de produção.
- Antes de cada release, confira migrations pendentes e seus checksums. Cada migration roda numa transação (DDL do PostgreSQL é transacional), mas mantenha o backup validado antes de migrar.
- **Defina `SUPERADMIN_HOSTS` em produção** (sem migration). Lista separada
  por vírgulas com o host do painel global (ex.:
  `SUPERADMIN_HOSTS=pedidos.exemplo.com.br`). Fora desses hosts,
  `/api/superadmin/*` responde `404`, inclusive o login. Sem a variável, o
  comportamento é o de antes (responde em qualquer host). Depois do deploy,
  confira que o login do superadmin funciona no host da lista e dá 404 no
  endereço de uma loja. Login, saída e tentativa recusada do superadmin passam
  a ser gravados na auditoria (`superadmin.login`, `superadmin.logout`,
  `superadmin.login_falhou`).
- **Exclusão definitiva de loja arquivada** (sem migration): só 60 dias depois
  do arquivamento e com o nome fantasia exato digitado. É **irreversível** e
  apaga também o histórico do painel daquela loja (`auditoria_admin`, FK
  RESTRICT); fica só o evento `estabelecimento.excluido` na auditoria do
  superadmin, com os detalhes em JSON. **A exclusão só é liberada se a loja
  tiver sido exportada nas últimas 24 horas** (evento
  `estabelecimento.exportado` desta loja, por qualquer superadmin); sem isso a
  API responde `409` com `codigo: "exportacao_recente_pendente"` e nada é
  apagado. O sistema só sabe que a exportação foi gerada, não se o `.zip` foi
  salvo no computador de quem baixou: confira que o arquivo abre antes de
  excluir. A exportação montada na própria exclusão também é entregue só como
  download da resposta — o servidor não guarda cópia —, então mantenha o
  backup do banco em dia. Exportação acima de 4 GiB é recusada com `409`
  antes de qualquer remoção. Se a pasta `UPLOADS_PATH/estabelecimentos/{id}/`
  não puder ser removida depois do commit, a exclusão continua valendo: o erro
  vai para o log (`estabelecimento.excluido.limpeza_uploads`), para a
  auditoria do superadmin (`estabelecimento.limpeza_disco_falhou`, com o
  caminho relativo e a mensagem do erro) e para o aviso no painel, e a pasta
  precisa ser apagada à mão. **Pendência conhecida:** arquivos antigos no
  formato `/uploads/{arquivo}` (fora da pasta da loja) não são exportados nem
  apagados.
- **Assinatura deixou de bloquear.** A partir desta versão só
  `estabelecimentos.status` tira a loja do ar (`suspenso` ou `arquivado`);
  `status_assinatura` e `vencimento_assinatura_em` ficam só informativos. Uma
  loja que hoje está fora do ar **apenas** por assinatura bloqueada, cancelada,
  inadimplente, suspensa ou vencida **volta ao ar** com o deploy. Antes de
  publicar, liste essas lojas e suspenda pelo painel as que devem continuar
  bloqueadas:
  `SELECT id_estabelecimento, slug, status_assinatura, vencimento_assinatura_em FROM estabelecimentos WHERE status = 'ativo' AND (status_assinatura IN ('bloqueada', 'cancelada', 'inadimplente', 'suspensa') OR vencimento_assinatura_em < CURRENT_TIMESTAMP);`
  Não há migration nesta mudança: é só a regra do backend.
- Faça o primeiro acesso administrativo, troque a senha e cadastre os dados reais da loja antes de abrir pedidos.

## Migração para PostgreSQL (Supabase)

Esta versão troca o MySQL/MariaDB pelo PostgreSQL. O código continua usando a
mesma interface de banco; a camada `server/db/postgres.js` traduz marcadores,
`insertId` e códigos de erro para o driver `pg`.

- **Não há migração automática de dados.** O `CRIAR_db.sql` novo cria uma
  instalação vazia. Para trazer dados de um MySQL antigo, exporte tabela a
  tabela (CSV) e importe pelo painel do Supabase, na ordem das chaves
  estrangeiras, e depois ajuste as sequências com
  `SELECT setval(pg_get_serial_sequence('<tabela>', 'id'), (SELECT MAX(id) FROM <tabela>));`.
- Unicidade de usuário, e-mail e nomes do catálogo ignora maiúsculas
  (índices em `LOWER(...)`), como a collation `_ci` do MySQL. Diferente do
  MySQL, acentos **são** diferenciados (`Porcoes` ≠ `Porções`).
- Horários são `TIMESTAMPTZ`; o pool fixa `TimeZone=UTC` em toda conexão, e o
  teste de integração confere isso em todas elas.
- Use o **Session pooler** (porta 5432). O Transaction pooler (6543) não é
  suportado, porque o fuso da sessão se perderia entre transações.
- RLS está ligado em todas as tabelas, sem políticas: a API REST do Supabase
  não expõe dado nenhum. Toda tabela nova (em migration) precisa do mesmo
  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` — o teste de segurança cobra.

## Hostinger (app Node.js)

- Versão do Node.js: **22.13 ou superior** (o `package.json` exige; o Vite 8 e
  a opção `--env-file-if-exists` dos scripts não rodam em versões anteriores).
- Comando de build: `npm run build`. Comando de início: `npm start` (ou o
  arquivo de entrada `server/index.js`).
- Variáveis de ambiente: cadastre no painel do app (`NODE_ENV=production`,
  `DATABASE_URL`, `DB_SSL=true`, `DB_SSL_CA`, `JWT_SECRET`, `PUBLIC_SITE_URL`,
  `SUPERADMIN_HOSTS` etc.). O `npm start` lê também um `.env` na raiz, se
  existir; nenhum outro arquivo (`.env.hostinger`, `.env.local`) é lido em
  produção.
- O certificado do Supabase precisa estar no servidor: envie o `.crt` por
  fora do Git (Gerenciador de Arquivos) e aponte `DB_SSL_CA` para o caminho, ou
  cole o conteúdo PEM direto em `DB_SSL_CA` com as quebras de linha como `
`.
- A hospedagem precisa conseguir abrir conexão de saída para
  `aws-0-<regiao>.pooler.supabase.com:5432`. Se o log mostrar `ETIMEDOUT` ou
  `ECONNREFUSED` nesse endereço, a porta está bloqueada pela hospedagem e é
  preciso pedir a liberação ao suporte.
- Depois do deploy, `/api/saude` deve responder
  `{"status":"ok","banco":"postgres-conectado"}`.

## Recuperação de acesso

Não existe SMTP ou provedor de e-mail configurado, então o sistema não apresenta um fluxo de “esqueci minha senha” fictício. Uma recuperação autônoma futura exige provedor SMTP/API, remetente e domínio verificados, tokens de uso único com hash e expiração, rate limit e templates. Até isso ser implantado, outro administrador ativo pode manter acessos e a recuperação de último recurso exige procedimento operacional direto e controlado no banco/ambiente pelo responsável técnico.
