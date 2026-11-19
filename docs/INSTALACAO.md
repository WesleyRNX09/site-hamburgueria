# Instalação e operação final

Este guia descreve uma única implantação do frontend e do backend, um único
banco PostgreSQL (Supabase) compartilhado e vários estabelecimentos isolados por
`id_estabelecimento`. Não crie uma cópia da aplicação ou um banco separado para
cada cliente.

## 1. Decida o tipo de instalação

Use somente um dos fluxos:

- **Banco novo e vazio:** execute `database/CRIAR_db.sql` uma única vez.
- **Banco existente com dados:** faça backup e execute somente
  `npm run db:migrate`.

Nunca execute `CRIAR_db.sql` sobre um banco persistente que já possua tabelas.
O arquivo não contém `CREATE DATABASE`; ele cria tudo no schema atual (`public`,
no Supabase) dentro de uma transação — se algo falhar, nada fica pela metade.

Até a versão que usava MySQL/MariaDB, a estrutura e as migrations eram outras;
elas estão preservadas em `database/mysql-legado/` só como histórico e não
rodam no PostgreSQL. Não há conversão automática dos dados antigos.

## 2. Prepare a infraestrutura

Antes do deploy, providencie:

- Node.js 22.13 ou superior;
- um projeto Supabase (PostgreSQL 15+) exclusivo da aplicação;
- a senha do banco guardada fora do repositório;
- HTTPS e proxy reverso encaminhando para o processo Node;
- um domínio principal e DNS curinga para os subdomínios;
- um volume persistente para uploads;
- uma estratégia de backup conjunto do banco e dos uploads.

O proxy deve preservar o cabeçalho `Host`. É por ele que o backend identifica o
estabelecimento; substituir o host por `localhost` quebra o isolamento por
domínio.

## 3. Crie o banco no Supabase

1. Em [supabase.com](https://supabase.com), crie um projeto. Escolha a região
   mais próxima da hospedagem (ex.: São Paulo, `sa-east-1`) e guarde a senha do
   banco num cofre de senhas.
2. Abra **SQL Editor**, cole o conteúdo inteiro de `database/CRIAR_db.sql` e
   clique em **Run**. Deve terminar com "Success. No rows returned".
3. Clique em **Connect** (topo do painel) → **Session pooler** e copie a URI.
   Ela tem o formato
   `postgresql://postgres.<projeto>:[YOUR-PASSWORD]@aws-0-<regiao>.pooler.supabase.com:5432/postgres`.
4. Em **Project Settings → Database → SSL Configuration**, clique em
   **Download certificate** e guarde o arquivo `.crt` (ex.:
   `certificados/supabase-ca.crt`, pasta já ignorada pelo Git).
5. Não coloque nenhuma dessas informações em arquivos versionados.

Por que o **Session pooler** (porta 5432):

- a conexão direta (`db.<projeto>.supabase.co`) só tem IPv6 no plano gratuito,
  e muitas hospedagens compartilhadas, como a Hostinger, só saem por IPv4;
- o backend fixa o fuso da sessão em UTC em cada conexão; o **Transaction
  pooler** (porta 6543) troca a sessão a cada transação e **não é suportado**.

Segurança da API REST do Supabase: o `CRIAR_db.sql` liga RLS em todas as
tabelas sem criar política nenhuma e revoga o acesso dos papéis `anon` e
`authenticated`. Assim a chave pública (`anon`) não lê nem grava dado algum;
só o backend, que conecta como dono das tabelas, acessa o banco. Não crie
políticas RLS nem use `supabase-js` no frontend: o isolamento entre lojas é
feito pelo backend.

## 4. Crie o `.env`

Crie manualmente um arquivo chamado `.env` na raiz do projeto, no mesmo nível
de `package.json`. O repositório não distribui um `.env.example`, porque
credenciais reais nunca devem ser confundidas com um modelo versionável.

Use este modelo e substitua somente no servidor:

```dotenv
# Aplicação
NODE_ENV=production
PORT=3001

# PostgreSQL (Supabase, Session pooler)
DATABASE_URL=
DB_CONNECTION_LIMIT=10
DB_SSL=true
DB_SSL_CA=certificados/supabase-ca.crt

# URL pública, CORS e identificação do tenant
PUBLIC_SITE_URL=https://pedidos.exemplo.com.br
VITE_PUBLIC_URL=https://pedidos.exemplo.com.br
VITE_API_URL=
CORS_ORIGINS=https://pedidos.exemplo.com.br
DOMINIO_PRINCIPAL=pedidos.exemplo.com.br
TENANT_DESENVOLVIMENTO=estabelecimento-padrao
JWT_SECRET=

# Volume persistente de imagens
UPLOADS_PATH=/var/lib/hamburgueria/uploads

# Administrador do estabelecimento inicial de compatibilidade
ADMIN_USER=admin
ADMIN_EMAIL=admin@exemplo.com
ADMIN_NAME=Administrador
ADMIN_PASSWORD=
SYNC_ADMIN_CREDENTIALS=0

# Superadministrador global
SUPERADMIN_USER=superadmin
SUPERADMIN_EMAIL=superadmin@exemplo.com
SUPERADMIN_NAME=Superadministrador
SUPERADMIN_PASSWORD=
SYNC_SUPERADMIN_CREDENTIALS=0
# Obrigatório em produção: hosts onde a API do superadmin responde.
SUPERADMIN_HOSTS=

# Dados demonstrativos — mantenha desativados em produção
SEED_DEMO_DATA=0
DEMO_WAITER_PASSWORD=
```

Regras importantes:

- `JWT_SECRET` deve ser aleatório, ter pelo menos 32 bytes e ser igual em todas
  as instâncias do mesmo ambiente.
- `DATABASE_URL` é a URI do Session pooler com a senha no lugar de
  `[YOUR-PASSWORD]`. Caracteres especiais da senha precisam ir codificados na
  URL (`@` → `%40`, `#` → `%23`, `/` → `%2F`, `?` → `%3F`, `%` → `%25`). Como
  alternativa, informe `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` e
  `DB_NAME` separados; se as duas formas existirem, vale `DATABASE_URL`.
- `DB_SSL=true` habilita TLS. `DB_SSL_CA` aceita o conteúdo PEM com quebras
  representadas por `\n` ou um caminho relativo/absoluto para a CA.
- O backend sempre valida o certificado TLS; não existe opção para usar
  `rejectUnauthorized: false`.
- Use aspas no `.env` se uma senha possuir `#`, espaços ou caracteres que
  possam ser interpretados pelo formato do arquivo.
- Para sobrescrever variáveis apenas na sua máquina, crie um `.env.local` na
  raiz. Os scripts de desenvolvimento (`dev`, `dev:api`, `db:*`, `test`,
  `build`, `seo:generate`) carregam `.env` e depois `.env.local`, então o
  segundo vence nos campos que repetir e o `.env` continua valendo no resto.
  O arquivo é opcional, já está no `.gitignore` e nunca deve ser commitado.
  O script `start`, usado em produção, de propósito **não** lê `.env.local`.
- `VITE_API_URL` deve ficar vazio quando frontend e API usam a mesma origem.
- `CORS_ORIGINS` aceita uma lista separada por vírgulas com origens HTTPS
  exatas, mas é só um complemento: qualquer subdomínio de `DOMINIO_PRINCIPAL`
  e qualquer `dominio_personalizado` já cadastrado em um estabelecimento são
  liberados automaticamente. Cadastrar um estabelecimento novo pelo painel
  superadmin já basta; não é preciso editar `CORS_ORIGINS` nem reiniciar o
  processo. Use essa variável só para origens fora desses dois casos (ex.: um
  painel administrativo hospedado em outro domínio).
- `TENANT_DESENVOLVIMENTO` é usado em localhost e pelo comando de criação do
  administrador inicial. Ele não permite trocar o tenant de uma requisição
  remota.
- `UPLOADS_PATH` precisa apontar para a pasta montada no processo Node, não para
  o banco e não para `dist`.
- Não defina `RUN_PG_TESTS=1` em produção.

Em Windows, um caminho válido de upload é:

```dotenv
UPLOADS_PATH=C:/dados/hamburgueria/uploads
```

## 5. Configure SSL do banco

O Supabase exige TLS:

1. mantenha `DB_SSL=true`;
2. salve a CA fora de pastas públicas e com leitura limitada ao usuário do
   serviço;
3. informe o caminho em `DB_SSL_CA`;
4. execute `npm run db:check`;
5. interrompa a implantação se houver erro de certificado.

Use `DB_SSL=false` somente com um PostgreSQL local, numa rede confiável, que
não ofereça TLS.

## 6. Valide a conexão

Instale as dependências e teste a conexão sem alterar o schema:

```bash
npm ci
npm run db:check
```

O comando executa `SELECT 1 AS conexao`. Ele não cria tabelas, migrations,
usuários da aplicação ou dados demonstrativos.

## 7. Crie o primeiro superadministrador

Preencha `SUPERADMIN_USER`, `SUPERADMIN_EMAIL`, `SUPERADMIN_NAME` e uma
`SUPERADMIN_PASSWORD` com pelo menos 12 caracteres. Depois execute:

```bash
npm run criar-superadmin
```

A senha é transformada em hash antes da gravação. O startup não cria nem
altera essa conta. Após uma recuperação de acesso com
`SYNC_SUPERADMIN_CREDENTIALS=1`, volte a variável para `0` e reinicie o
processo.

O administrador do estabelecimento inicial é opcional em uma operação
totalmente gerenciada pelo painel global. Para manter compatibilidade com a
instalação inicial, execute:

```bash
npm run criar-admin-inicial
```

Esse comando usa o slug de `TENANT_DESENVOLVIMENTO`. Após uma recuperação com
`SYNC_ADMIN_CREDENTIALS=1`, volte a variável para `0`.

## 8. Compile e inicie

```bash
npm run lint
npm test
npm run build
npm start
```

O processo Node serve a API, o frontend compilado e os uploads protegidos. O
startup apenas valida a conexão; ele não aplica migrations nem cria usuários.

Exponha somente o proxy HTTPS. Mantenha a porta `3001` acessível apenas pela
rede interna ou pelo próprio servidor.

## 9. Cadastre estabelecimentos

1. Acesse `https://SEU_DOMINIO/superadmin/login`.
2. Entre com o superadministrador criado no passo anterior.
3. Cadastre o estabelecimento, o slug, o plano e a situação da assinatura.
   Plano, status da assinatura e vencimento são informativos: não tiram a
   loja do ar.
4. Preencha a identidade visual e crie o primeiro administrador no mesmo
   formulário.
5. Entre pelo subdomínio do estabelecimento e conclua cardápio, áreas de
   entrega, pagamentos, horários e textos legais.

O cadastro pelo painel cria tenant, configuração e primeiro administrador na
mesma transação. Não execute `CRIAR_db.sql` para cada cliente.

O estabelecimento nasce `ativo`. Depois disso o status só muda pelas ações da
lista: **Suspender** (pede motivo e encerra as sessões de administradores e
garçons), **Reativar**, **Arquivar** (só a partir de suspenso, digitando o
slug para confirmar; também encerra sessões) e **Desarquivar** (volta como
suspenso). A edição não altera o status e recusa estabelecimento arquivado.
Arquivados somem da lista padrão; marque "Incluir arquivados" para vê-los.
Cada ação fica registrada na auditoria com o status antes e depois.

Só o status decide se a loja atende (`server/tenant.js`,
`estabelecimentoLiberado`): `ativo` atende; `suspenso` e `arquivado` bloqueiam
do mesmo jeito o site público, o painel, o garçom, os uploads e o agente de
impressão. Quem abre o endereço de uma loja bloqueada vê a página genérica
"Estabelecimento indisponível", com o tema padrão e sem nome nem motivo; a API
responde `403` em JSON. Endereço de loja que não existe continua em `404`. Em
`npm run dev` o `index.html` vem do Vite, então essa página só aparece com o
build servido pelo backend (`npm run build` + `npm start`); no dev, as telas de
login mostram "Este estabelecimento está temporariamente indisponível.".

Slugs usados pela plataforma (`www`, `api`, `admin`, `superadmin`, `app`,
`mail`, `static`, `uploads`, entre outros) são recusados na criação e na troca
de slug. A lista completa é `SLUGS_RESERVADOS`, em `server/superadmin.js`.

### Exportação e exclusão definitiva (loja arquivada)

Com a loja **arquivada**, a lista do superadmin oferece:

- **Baixar exportação dos dados** — a qualquer momento, quantas vezes for
  preciso, sem apagar nada. Gera um `.zip` com `dados.json` (todas as linhas
  da loja em todas as tabelas: cardápio, pedidos, comandas, pagamentos,
  equipe, administradores, configurações, impressão, auditoria) e a cópia de
  `UPLOADS_PATH/estabelecimentos/{id}/`. Senhas, hashes de senha, tokens e as
  tabelas de sessão ficam de fora. Cada download é registrado como
  `estabelecimento.exportado` na auditoria do superadmin.
- **Excluir definitivamente** — **irreversível**. Só é liberada **60 dias**
  depois do arquivamento (antes disso a tela mostra quantos dias faltam, e a
  API responde `409` com a contagem), exige digitar o **nome fantasia exato**
  da loja (não o slug; maiúsculas e minúsculas contam) e exige uma
  **exportação desta loja nas últimas 24 horas**, feita por qualquer
  superadmin. Sem ela, o botão de excluir fica desabilitado, o modal oferece
  "Baixar exportação agora" e a API responde `409` com
  `codigo: "exportacao_recente_pendente"`. Exportar outra loja não conta.

O sistema registra que a exportação foi **gerada**, mas não sabe se o `.zip`
foi **salvo** no computador de quem baixou. Antes de excluir, confira que o
arquivo foi salvo e abre corretamente.

A exclusão segue esta ordem, numa única transação com a linha da loja
travada: valida estado, prazo, nome e exportação recente; recusa se algum
registro de outra loja apontar para dados desta; monta a exportação completa
(se falhar, ou se passar do limite de 4 GiB do `.zip`, nada é apagado); apaga
as tabelas da loja dos filhos para os pais; grava
`estabelecimento.excluido` na auditoria do superadmin com id, nome, slug,
autor e linhas removidas por tabela; apaga a linha da loja; confirma. Só
depois do commit a pasta de uploads da loja é removida do disco, e a
exportação é entregue como download.

O que **não** sobrevive: todos os dados da loja, inclusive o histórico de
acessos e ações do painel (`auditoria_admin`, que tem FK RESTRICT para
`estabelecimentos` e por isso precisa ser apagada — ela vai inteira na
exportação). O que sobrevive: a auditoria do superadmin (`auditoria_superadmin`,
FK SET NULL), com `id_estabelecimento` nulo e os detalhes preservados em JSON.

Se a pasta de uploads não puder ser apagada depois do commit (arquivo em uso,
permissão), a exclusão **não** é desfeita: o erro vai para o log, para a
auditoria do superadmin como `estabelecimento.limpeza_disco_falhou` (com o
caminho relativo e a mensagem, sem o caminho absoluto do servidor) e para o
aviso no painel. Apague a pasta `UPLOADS_PATH/estabelecimentos/{id}/` à mão.

**Pendência conhecida:** imagens antigas no formato `/uploads/{arquivo}`,
gravadas antes das pastas por loja, não entram na exportação e não são
apagadas pela exclusão.

## 10. Configure subdomínios

Para `DOMINIO_PRINCIPAL=pedidos.exemplo.com.br`, um slug `loja-a` é acessado
como `loja-a.pedidos.exemplo.com.br`.

Na infraestrutura:

1. crie um registro DNS curinga `*.pedidos.exemplo.com.br` apontando para a
   mesma implantação;
2. configure certificado que cubra os subdomínios;
3. preserve o cabeçalho `Host` no proxy;
4. encaminhe todas as rotas, inclusive `/uploads/`, ao Node;
5. valide dois slugs diferentes antes de liberar produção.

**Configure `SUPERADMIN_HOSTS` em produção.** É a lista, separada por
vírgulas, dos hosts onde a API do superadmin (`/api/superadmin/*`) responde —
só o nome do host, sem `https://` nem caminho; a porta é ignorada. Exemplo:
`SUPERADMIN_HOSTS=pedidos.exemplo.com.br`. Fora da lista, toda rota do
superadmin, inclusive o login, responde o mesmo `404` de rota inexistente, sem
consultar o banco. Vazia ou ausente, a API responde em qualquer host (útil no
desenvolvimento local, mas expõe o login do painel global nos domínios das
lojas). Uma lista preenchida só com valores inválidos bloqueia tudo. Todo
login, saída e tentativa recusada do superadmin fica na auditoria
(`superadmin.login`, `superadmin.logout`, `superadmin.login_falhou`), sem senha
nem o usuário digitado.

O domínio principal sem subdomínio pode hospedar o acesso do
superadministrador, mas as rotas públicas de uma loja exigem um tenant válido.

## 11. Configure domínio personalizado

1. Aponte o DNS do domínio do cliente para a mesma implantação.
2. Emita e instale um certificado TLS para esse domínio.
3. Cadastre no painel global apenas o hostname, sem `https://`, porta ou caminho.
4. Confirme que o proxy preserva o `Host` original.
5. Teste identidade visual, cardápio, login administrativo e um upload.

Não cadastre o domínio antes de o DNS e o certificado estarem prontos.

## 12. Aplique migrations em banco existente

Para um banco com dados:

1. suspenda novas escritas;
2. gere um backup e teste a restauração em ambiente isolado;
3. valide `npm run db:check`;
4. revise os arquivos pendentes em `database/migrations/`;
5. execute `npm run db:migrate` uma única vez;
6. libere o tráfego somente após os testes.

O runner registra nome e checksum em `schema_migrations`. No PostgreSQL cada
migration roda numa transação junto com o próprio registro: se uma instrução
falhar, o arquivo inteiro é desfeito e nada fica pela metade. Mesmo assim,
mantenha o backup validado antes de migrar.

### Migrations antigas (MySQL)

As migrations `001` a `025` eram do MySQL/MariaDB e estão em
`database/mysql-legado/migrations/`. A estrutura final delas já está no
`CRIAR_db.sql` do PostgreSQL. A pasta `database/migrations/` recomeça vazia
para as próximas alterações.

## 13. Verifique a instalação

Antes de liberar tráfego, confirme:

- `npm run db:check`, `npm run lint`, `npm test` e `npm run build` aprovados;
- no SQL Editor do Supabase, RLS ligado em todas as tabelas — a consulta
  `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity;`
  não pode devolver linha nenhuma;
- duas lojas exibindo nomes, temas e cardápios diferentes;
- token de administrador e garçom de uma loja recusado na outra;
- pedido e imagem de uma loja retornando `403` ou `404` na outra;
- loja suspensa ou arquivada sem acesso operacional: a API responde `403`
  (com `codigo: "estabelecimento_indisponivel"`) e o endereço da loja no
  navegador mostra a página "Estabelecimento indisponível", sem o motivo;
- loja ativa com assinatura bloqueada ou vencida continuando no ar — a
  assinatura é só informativa;
- `/api/saude` monitorado e sem exposição pública da porta interna;
- `/uploads/` passando pelo backend e persistindo após novo deploy.

`npm test` não acessa o banco por padrão. A integração real só é habilitada por
`RUN_PG_TESTS=1`, cria um schema `testes_<aleatório>` e o remove ao final.
Use-a exclusivamente com um projeto Supabase ou PostgreSQL descartável, nunca
com o banco de produção.

## 14. Backup e recuperação

Faça backups coordenados de:

- schema e dados do PostgreSQL (o Supabase faz backup diário no plano pago;
  no gratuito, exporte com `pg_dump` pela string de conexão);
- raiz completa de `UPLOADS_PATH`;
- variáveis e certificados por meio do cofre de segredos da infraestrutura.

Não coloque backups no Git. Defina retenção, criptografia, acesso restrito e
alertas de falha. Teste periodicamente uma restauração completa em ambiente
isolado, incluindo a correspondência entre URLs do banco e arquivos do volume.

Para voltar a versão da aplicação, implante o commit anterior sem apagar o
volume. Para voltar dados ou schema, use somente um backup cuja restauração já
tenha sido validada.

## 15. Operações manuais obrigatórias

A aplicação não consegue realizar automaticamente:

- criação do projeto no Supabase e execução do `CRIAR_db.sql`;
- DNS, certificado TLS e configuração do proxy;
- criação e permissões do volume persistente;
- armazenamento seguro de secrets;
- backups, monitoramento e rotação de logs;
- revisão jurídica dos termos, privacidade e política de cancelamento.

## 16. Credenciais já versionadas

Excluir um `.env`, backup ou modelo com dados reais não remove o conteúdo do
histórico do Git. Qualquer senha, token ou chave que já tenha sido commitido
deve ser considerado comprometido e trocado no provedor correspondente.

Não reutilize a credencial antiga. Se o repositório foi compartilhado ou
publicado, avalie uma limpeza de histórico separadamente; isso reescreve
commits e exige coordenação com todos os clones, portanto não deve ser feito
durante um deploy comum.
