# Sistema da Hamburgueria

Aplicação responsiva com três áreas integradas: cliente, administrador e garçom. O frontend usa React e a API Node.js persiste os dados em um MySQL Server que pode ser administrado pelo MySQL Workbench.

## Recursos conectados ao MySQL

- login e sessões revogáveis do administrador com JWT assinado;
- múltiplos administradores, troca segura de senha e auditoria das ações críticas;
- categorias administráveis, produtos, fotos, adicionais e vínculos por produto;
- promoções exibidas no site;
- pedidos de delivery e retirada, itens, adicionais, pagamentos e acompanhamento;
- confirmação manual e idempotente de pagamentos, cancelamento e estorno com autor e horário;
- funcionários com PIN protegido por `scrypt` e token individual para QR Code;
- sessões revogáveis do garçom com JWT, mesas, comandas e itens da comanda;
- vínculo automático entre garçom, mesa, comanda e pedido do salão;
- identidade e operação da lanchonete: nome, logo, contatos, horário, redes sociais, status, delivery, áreas, taxas, mínimo e pagamentos;
- dados de dashboard e relatórios calculados a partir dos registros compartilhados.

O carrinho permanece no navegador somente até o cliente finalizar a compra. Ao abrir o carrinho e antes do checkout, a API remove itens indisponíveis e atualiza preço, promoção e adicionais. Na criação do pedido, o servidor recalcula tudo novamente, inclusive taxa por bairro e pedido mínimo, e grava pedido, itens e pagamento na mesma transação. Cada tentativa leva uma chave idempotente para que reenvios não criem pedidos duplicados.

O backend identifica o estabelecimento pelo domínio, subdomínio ou slug local e
aplica `id_estabelecimento` em todas as operações de negócio. JWTs assinados
carregam usuário, perfil, tenant e indicação de superadministrador; o backend
confirma essas informações contra o domínio e a sessão revogável no MySQL.

O mesmo frontend consome as configurações públicas do estabelecimento e aplica
logo, banner, fonte e as variáveis CSS `--cor-principal`, `--cor-secundaria`,
`--cor-fundo`, `--cor-card` e `--cor-texto`. Valores ausentes ou inválidos usam
o tema escuro e amarelo original como fallback, sem aceitar CSS, HTML ou
JavaScript configurável vindo do banco.

O administrador autenticado edita esses dados em `/admin/configuracoes`, com
prévia do tema, upload de logo e banner, contatos, operação, pagamentos, áreas
de entrega e textos legais. A API ignora identificadores de estabelecimento do
formulário, usa exclusivamente o tenant confirmado pelo host e pela sessão e
registra a atualização na auditoria administrativa.

## Requisitos

- Node.js 22.13 ou superior;
- npm;
- MySQL Server 8.0 em execução;
- MySQL Workbench opcional para visualizar e administrar o banco.

## Configuração inicial

1. Copie o modelo de ambiente e preencha somente valores locais:

```powershell
Copy-Item .env.example .env
```

2. No MySQL Workbench, crie e selecione um schema vazio e então execute [`database/CRIAR_db.sql`](database/CRIAR_db.sql). O arquivo cria a estrutura atual e os dados mínimos, sem criar/selecionar o banco, sem usuário administrativo e sem conteúdo demonstrativo.

3. Crie um usuário MySQL restrito para a aplicação. O exemplo abaixo pressupõe que o schema selecionado se chama `hamburgueria`:

```sql
CREATE USER IF NOT EXISTS 'hamburgueria_app'@'localhost'
  IDENTIFIED BY 'troque-por-uma-senha-local-segura';
GRANT SELECT, INSERT, UPDATE, DELETE ON hamburgueria.*
  TO 'hamburgueria_app'@'localhost';
FLUSH PRIVILEGES;
```

4. Edite o `.env` com a mesma conta e defina o primeiro administrador:

```dotenv
DB_HOST=127.0.0.1
DB_PORT=3306
DB_CREATE_IF_MISSING=1
DB_USER=hamburgueria_app
DB_PASSWORD=sua-senha-local-da-aplicacao
DB_NAME=hamburgueria

DOMINIO_PRINCIPAL=meusistema.com.br
TENANT_DESENVOLVIMENTO=estabelecimento-padrao
JWT_SECRET=gere-um-segredo-aleatorio-com-pelo-menos-32-bytes

ADMIN_USER=admin
ADMIN_EMAIL=admin@exemplo.com
ADMIN_PASSWORD=uma-senha-administrativa-segura
```

5. Crie a conta administrativa e valide a conexão:

```bash
npm run criar-admin-inicial
npm run db:check
```

O `.env` é ignorado pelo Git. Nunca envie senhas ou `JWT_SECRET` ao
repositório. Em produção, `JWT_SECRET` é obrigatório e deve possuir pelo menos
32 bytes. Em desenvolvimento, sua ausência gera um segredo temporário e todas
as sessões são invalidadas ao reiniciar o processo. `ADMIN_PASSWORD` é lido
pelos comandos explícitos de preparação/administração, não pelo startup do
servidor. Para uma instalação local totalmente vazia, `npm run db:prepare` pode
criar e preparar o schema; ele recusa schemas que já possuam tabelas. Consulte
[`database/README.md`](database/README.md) antes de preparar ou migrar um
ambiente.

## Executar localmente

```bash
npm install
npm run dev
```

Esse comando inicia a API e o site juntos. O frontend normalmente fica em `http://localhost:5173` e a API em `http://localhost:3001`.

Se o `.env` ou o MySQL ainda não estiverem disponíveis, o frontend continua iniciando em `http://localhost:5173` e o terminal mostra por que a API ficou indisponível. Depois de configurar o banco, basta reiniciar `npm run dev` para habilitar o sistema completo.

## Acessos iniciais

- Cliente: `/`
- Política de privacidade: `/politica-de-privacidade`
- Termos de uso: `/termos-de-uso`
- Administrador: `/admin/login`, com as credenciais definidas em `ADMIN_USER` e `ADMIN_PASSWORD`
- Garçom: cadastre o funcionário no painel administrativo e abra o QR Code individual por esse painel

Dados demonstrativos ficam desativados por padrão em todos os ambientes: a loja nasce fechada, sem produtos, adicionais, promoções, funcionários ou pedidos fictícios. `SEED_DEMO_DATA=1` só tem efeito no comando explícito `npm run db:prepare` e deve ser usado exclusivamente em ambiente descartável. Os tokens demonstrativos são aleatórios e, sem `DEMO_WAITER_PIN`, o PIN inicial também é aleatório. PINs são armazenados como hash, e tokens de acesso só aparecem em rotas administrativas autenticadas. O QR Code identifica o funcionário, mas a sessão só é criada depois da validação do PIN.

## Comandos

```bash
npm run dev       # frontend e backend
npm run dev:web   # somente frontend
npm run dev:api   # somente backend
npm run lint      # análise estática
npm test          # testes puros e integração MySQL quando DB_PASSWORD estiver definido
npm run build     # frontend de produção
npm start         # API, uploads e frontend já compilado
npm run db:check  # valida a conexão sem alterar a estrutura
npm run db:migrate # aplica migrations incrementais versionadas
npm run db:prepare # prepara somente um banco novo e vazio
npm run criar-admin-inicial # cria/verifica o primeiro administrador
```

Os testes de integração exigem configuração própria e usam um banco isolado cujo nome termina em `_testes`. Nunca execute testes de integração com credenciais apontadas para um banco persistente.

## Rotas principais da API

### Públicas

- `GET /api/saude`
- `GET /api/catalogo`
- `GET /api/publico/inicial`
- `GET /api/publico/configuracao`
- `POST /api/pedidos`
- `POST /api/carrinho/validar`
- `GET /api/pedidos/:codigo?token=...`

As configurações públicas são sempre selecionadas pelo domínio da requisição.
A API publica somente o contrato necessário ao site — identidade visual,
contatos, atendimento, pagamentos, entrega e textos legais — e não aceita um
`id_estabelecimento` informado pelo navegador para trocar esse escopo.

### Administrador

- `POST /api/admin/login`
- `GET|DELETE /api/admin/sessao`
- `GET /api/admin/dados`
- CRUD de `/api/admin/produtos`, `/api/admin/adicionais`, `/api/admin/promocoes` e `/api/admin/funcionarios`
- criação/edição/status de `/api/admin/categorias`
- criação/status de `/api/admin/administradores` e `PUT /api/admin/senha`
- `PATCH /api/admin/pedidos/:codigo/status`
- `POST /api/admin/pedidos/:codigo/pagamento/confirmar`
- `POST /api/admin/pedidos/:codigo/pagamento/estornar`
- `PUT /api/admin/configuracao`

### Garçom

- `POST /api/garcom/login`
- `GET|DELETE /api/garcom/sessao`
- `GET /api/garcom/dados`
- abertura de comanda, inclusão/remoção de itens, envio à cozinha, solicitação de conta e fechamento em `/api/garcom/comandas/...`

## Produção

Defina `NODE_ENV=production` e todas as variáveis `DB_HOST`, `DB_USER`, `DB_PASSWORD` e `DB_NAME`. Provisione a estrutura e execute migrations antes de iniciar a API; o startup nunca altera o schema. `ADMIN_PASSWORD` deve ter ao menos 12 caracteres quando usado para criar ou recuperar a conta inicial. Use uma conta MySQL com acesso somente ao banco já provisionado da aplicação. Antes de abrir pedidos, cadastre o cardápio e preencha **Configurações** com identidade, contatos, horário, áreas atendidas, taxas, mínimo e pagamentos reais. O Pix só aparece com chave, beneficiário e cidade; o QR Code BR Code é montado a partir desses dados, do total recalculado e do identificador real do pedido. Não há confirmação bancária automática: um administrador autenticado precisa confirmar o recebimento. Cartão e dinheiro também entram na receita somente após confirmação.

Fotos e logo ficam no caminho configurado em `UPLOADS_PATH` (padrão local `server/uploads`). Em hospedagem, esse caminho precisa ser um volume persistente e deve ter cópia própria. O sitemap usa `PUBLIC_SITE_URL`/`VITE_PUBLIC_URL`; nenhum domínio é inventado quando elas não estão definidas. Consulte [implantação](docs/DEPLOY.md) e o [guia do banco](database/README.md).

Alterações de estrutura são aplicadas somente pelo comando explícito `npm run db:migrate`. Mantenha um backup validado antes de cada migration e nunca use o instalador de banco novo sobre dados existentes.

O sistema não possui gateway bancário nem serviço SMTP. A conciliação é manual e auditada; recuperação de senha por e-mail depende da infraestrutura descrita em [implantação](docs/DEPLOY.md). Logs HTTP 5xx são emitidos em JSON com campos sensíveis redigidos e devem ser coletados/rotacionados pela infraestrutura.

Os textos de privacidade e termos são modelos operacionais. O proprietário precisa revisá-los com orientação jurídica, definir retenção de dados, fornecedores, políticas de cancelamento e regras locais antes da venda ou publicação comercial.
