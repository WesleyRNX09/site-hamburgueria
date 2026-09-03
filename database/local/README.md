# Ambiente MySQL local (desenvolvimento)

Esta pasta prepara **o ambiente**, não o schema. A estrutura do banco continua
tendo uma única fonte da verdade:

| o quê | onde |
| --- | --- |
| Estrutura completa, instalação nova | [`../CRIAR_db.sql`](../CRIAR_db.sql) |
| Alterações incrementais em banco existente | [`../migrations/`](../migrations/) |
| Mesma estrutura em módulos menores | [`../estrutura/`](../estrutura/) |

Nada aqui cria tabela. Se você precisa **adicionar ou alterar uma coluna,
tabela, índice ou FK**, o lugar é `../migrations/` + `../CRIAR_db.sql` — nunca
esta pasta. Ver [`../README.md`](../README.md).

## Por que rodar o banco localmente

O `.env` de desenvolvimento estava apontando para o MySQL remoto da Hostinger.
Cada `npm run dev` abre um pool novo, e a conta remota tem cota de
`max_connections_per_hour`. Ao estourar a cota, a API para de subir — e o
mesmo banco atende produção. Desenvolver contra um MySQL local remove as duas
coisas: o limite e o risco.

## Passo 1 — criar schema e conta local

Requer o MySQL local instalado e no ar. Neste ambiente já existe o serviço
`MySQL80` (MySQL 8.0.46), com o cliente em
`C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe`.

Escolha uma senha local e rode, a partir da raiz do projeto:

```bash
"/c/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe" -u root -p \
  --init-command="SET @senha_app='SUA_SENHA_LOCAL'" \
  < database/local/001_ambiente_local.sql
```

O script é idempotente: cria o schema `hamburgueria` se não existir, cria (ou
atualiza a senha de) `hamburgueria_app` em `localhost` e `127.0.0.1`, e concede
privilégios **somente** sobre `hamburgueria.*`.

A senha não fica gravada em nenhum arquivo versionado — ela é passada em
`@senha_app` na execução. Se você esquecer o `--init-command`, o script
interrompe em vez de criar uma conta sem senha.

## Passo 2 — apontar o `.env` para o banco local

Edite o `.env` (não versionado) e troque o bloco de conexão por:

```dotenv
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=hamburgueria_app
DB_PASSWORD=SUA_SENHA_LOCAL
DB_NAME=hamburgueria
DB_CREATE_IF_MISSING=1
```

Se houver `DB_SSL=true` apontando para a Hostinger, remova ou deixe `false`
para o local — o MySQL local não usa TLS.

**Guarde as credenciais antigas da Hostinger antes de sobrescrever.** Elas
continuam sendo as de produção.

## Passo 3 — montar a estrutura

```bash
npm run db:check     # valida a conexão, sem alterar nada
npm run db:prepare   # cria a estrutura num schema vazio + admin inicial
```

`db:prepare` exige `ADMIN_PASSWORD` no `.env` e **recusa** um schema que já
tenha tabelas. Para inserir o catálogo fictício, use `SEED_DEMO_DATA=1` —
apenas em ambiente descartável.

Alternativa equivalente, pelo MySQL Workbench: selecione o schema
`hamburgueria` e execute `../CRIAR_db.sql` inteiro, uma única vez.

## Passo 4 — conferir

```bash
npm run db:check
npm test                      # inclui os invariantes de SQL e multiempresa
RUN_MYSQL_TESTS=1 npm test    # integração real; só com banco descartável
```

`RUN_MYSQL_TESTS=1` cria e remove bancos. Use somente aqui, **nunca** com o
`.env` apontando para a Hostinger.

## Recomeçar do zero

Como o schema é descartável, para reinstalar basta remover o schema pelo
Workbench (ou por um `DROP DATABASE` manual como root) e repetir os passos 1 e
3. Esse `DROP` é uma operação de ambiente local — por isso não existe script
versionado para ele, e ele nunca deve ser apontado para um banco remoto.
