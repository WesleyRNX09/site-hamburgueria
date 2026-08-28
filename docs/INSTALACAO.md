# Instalação e operação final

Este guia descreve uma única implantação do frontend e do backend, um único
schema MySQL compartilhado e vários estabelecimentos isolados por
`id_estabelecimento`. Não crie uma cópia da aplicação ou um banco separado para
cada cliente.

## 1. Decida o tipo de instalação

Use somente um dos fluxos:

- **Banco novo e vazio:** execute `database/CRIAR_db.sql` uma única vez.
- **Banco existente com dados:** faça backup e execute somente
  `npm run db:migrate`.

Nunca execute `CRIAR_db.sql` sobre um banco persistente que já possua tabelas.
O arquivo não contém `CREATE DATABASE` nem `USE`; o schema precisa ser criado e
selecionado previamente no painel do provedor.

## 2. Prepare a infraestrutura

Antes do deploy, providencie:

- Node.js 22.13 ou superior;
- MySQL 8 com um schema exclusivo da aplicação;
- uma conta MySQL operacional sem privilégios administrativos globais;
- HTTPS e proxy reverso encaminhando para o processo Node;
- um domínio principal e DNS curinga para os subdomínios;
- um volume persistente para uploads;
- uma estratégia de backup conjunto do MySQL e dos uploads.

O proxy deve preservar o cabeçalho `Host`. É por ele que o backend identifica o
estabelecimento; substituir o host por `localhost` quebra o isolamento por
domínio.

## 3. Crie o banco remoto

No painel do provedor:

1. Crie um schema vazio com `utf8mb4`, quando essa opção estiver disponível.
2. Crie uma conta de aplicação limitada a esse schema.
3. Anote host, porta, usuário, nome do schema e exigência de TLS.
4. Baixe a CA oficial do provedor quando a conexão exigir certificado.
5. Não coloque essas informações em arquivos versionados.

Para banco novo, abra o editor SQL do schema criado e execute todo o conteúdo
de `database/CRIAR_db.sql`. Em seguida, execute
`database/verificacoes/001_verificar_instalacao.sql` e confira os resultados.

## 4. Crie o `.env`

Crie manualmente um arquivo chamado `.env` na raiz do projeto, no mesmo nível
de `package.json`. O repositório não distribui um `.env.example`, porque
credenciais reais nunca devem ser confundidas com um modelo versionável.

Use este modelo e substitua somente no servidor:

```dotenv
# Aplicação
NODE_ENV=production
PORT=3001

# MySQL
DB_HOST=
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=
DB_CONNECTION_LIMIT=10
DB_SSL=true
DB_SSL_CA=

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

# Dados demonstrativos — mantenha desativados em produção
SEED_DEMO_DATA=0
DEMO_WAITER_PIN=
```

Regras importantes:

- `JWT_SECRET` deve ser aleatório, ter pelo menos 32 bytes e ser igual em todas
  as instâncias do mesmo ambiente.
- `DB_SSL=true` habilita TLS. `DB_SSL_CA` aceita o conteúdo PEM com quebras
  representadas por `\n` ou um caminho relativo/absoluto para a CA.
- O backend sempre valida o certificado TLS; não existe opção para usar
  `rejectUnauthorized: false`.
- Use aspas no `.env` se uma senha possuir `#`, espaços ou caracteres que
  possam ser interpretados pelo formato do arquivo.
- `VITE_API_URL` deve ficar vazio quando frontend e API usam a mesma origem.
- `CORS_ORIGINS` aceita uma lista separada por vírgulas e exige origens HTTPS
  exatas. Inclua a origem do painel global, cada subdomínio já publicado e
  cada domínio personalizado; curingas não são aceitos pela implementação
  atual. Ao cadastrar um novo domínio, atualize a lista e reinicie o processo.
- `TENANT_DESENVOLVIMENTO` é usado em localhost e pelo comando de criação do
  administrador inicial. Ele não permite trocar o tenant de uma requisição
  remota.
- `UPLOADS_PATH` precisa apontar para a pasta montada no processo Node, não para
  o MySQL e não para `dist`.
- Não defina `RUN_MYSQL_TESTS=1` em produção.

Em Windows, um caminho válido de upload é:

```dotenv
UPLOADS_PATH=C:/dados/hamburgueria/uploads
```

## 5. Configure SSL do MySQL

Se o provedor exigir TLS:

1. mantenha `DB_SSL=true`;
2. salve a CA fora de pastas públicas e com leitura limitada ao usuário do
   serviço;
3. informe o caminho em `DB_SSL_CA`;
4. execute `npm run db:check`;
5. interrompa a implantação se houver erro de certificado.

Use `DB_SSL=false` somente quando o MySQL estiver em uma rede local confiável
e o provedor declarar que TLS não é necessário.

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
4. Preencha a identidade visual e crie o primeiro administrador no mesmo
   formulário.
5. Entre pelo subdomínio do estabelecimento e conclua cardápio, áreas de
   entrega, pagamentos, horários e textos legais.

O cadastro pelo painel cria tenant, configuração e primeiro administrador na
mesma transação. Não execute `CRIAR_db.sql` para cada cliente.

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
5. use uma credencial temporária com os privilégios DDL necessários;
6. execute `npm run db:migrate` uma única vez;
7. execute `database/verificacoes/002_verificar_migracao_estabelecimento.sql`;
8. restaure a conta operacional restrita e libere o tráfego somente após os
   testes.

O runner registra nome e checksum em `schema_migrations`. DDL do MySQL pode
efetuar commit implícito; não tente desfazer uma migration parcialmente
aplicada com comandos improvisados. Interrompa o deploy, preserve evidências e
decida entre correção incremental ou restauração do backup validado.

## 13. Verifique a instalação

Antes de liberar tráfego, confirme:

- `npm run db:check`, `npm run lint`, `npm test` e `npm run build` aprovados;
- `database/verificacoes/001_verificar_instalacao.sql` sem divergências;
- verificação de migration sem registros órfãos, quando aplicável;
- duas lojas exibindo nomes, temas e cardápios diferentes;
- token de administrador e garçom de uma loja recusado na outra;
- pedido e imagem de uma loja retornando `403` ou `404` na outra;
- loja inativa, bloqueada ou vencida sem acesso operacional;
- `/api/saude` monitorado e sem exposição pública da porta interna;
- `/uploads/` passando pelo backend e persistindo após novo deploy.

Na verificação de instalação, o resultado estrutural deve ser `OK`, e as
contagens de configuração, sessão e auditoria sem relacionamento devem ser
zero. Na verificação de migration, todas as contagens de registros sem
estabelecimento e escopos divergentes devem ser zero.

`npm test` não acessa MySQL por padrão. A integração real só é habilitada por
`RUN_MYSQL_TESTS=1`, cria um schema com sufixo `_testes` e o remove ao final.
Use-a exclusivamente com credenciais de um MySQL descartável, nunca com o
banco remoto ou persistente.

## 14. Backup e recuperação

Faça backups coordenados de:

- schema e dados do MySQL;
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

- criação do schema e usuário no provedor MySQL;
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
