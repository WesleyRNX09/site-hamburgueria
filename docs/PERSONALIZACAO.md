# Personalização por estabelecimento

Este guia documenta a arquitetura de personalização white-label: como cada
estabelecimento configura sua própria identidade visual e textos públicos
usando o mesmo frontend, o mesmo backend e o mesmo banco compartilhado. Para
arquitetura multiempresa em geral (tenant, isolamento, migrations), veja
[`../database/README.md`](../database/README.md). Para instalação e deploy,
veja [`INSTALACAO.md`](INSTALACAO.md) e [`DEPLOY.md`](DEPLOY.md).

## 1. Arquitetura

Toda personalização vive em uma única tabela, `configuracoes_estabelecimento`,
com uma linha por `id_estabelecimento` (chave primária). Não existe tabela
separada por cliente nem cópia de schema por tenant.

Fluxo de leitura/escrita:

- **Backend** (`server/operations.js`): `buscarConfiguracao` lê a linha do
  tenant (join com `estabelecimentos` para o nome), `mapearConfiguracao`
  sanitiza cada campo (cor hexadecimal, fonte permitida, URL segura, destino
  de botão permitido, tamanho de texto), `selecionarConfiguracaoPublica` filtra
  o subconjunto seguro para expor publicamente, e `salvarConfiguracao` valida e
  grava tudo em uma transação (`INSERT ... ON DUPLICATE KEY UPDATE`), sempre
  usando o `id_estabelecimento` do contexto autenticado — nunca um valor vindo
  do corpo da requisição.
- **Rotas** (`server/app.js`): `GET /api/publico/configuracao` (tenant
  resolvido pelo domínio/host, sem autenticação), `GET /api/admin/dados`
  (inclui a configuração do estabelecimento autenticado) e
  `PUT /api/admin/configuracao` (grava, exige sessão de administrador).
- **Frontend** (`src/context/AppProvider.jsx` + `src/utils/theme.js`): a
  configuração pública é buscada uma vez e fica disponível via
  `useApp().configuracao` em toda a árvore de componentes.
  `normalizarConfiguracaoPublica` faz a mesma sanitização do backend do lado do
  cliente (defesa em profundidade) antes de qualquer uso, e `aplicarTema`
  aplica as cores/fonte como variáveis CSS no `<html>`.
- **Admin** (`src/pages/admin/configuracoes/index.jsx`): formulário único com
  todas as seções, preview de tema e imagens, envia o objeto completo para
  `PUT /api/admin/configuracao` ao salvar.
- **Site público** (`src/pages/home/index.jsx`): lê `configuracao` do
  contexto; cada campo configurável tem um fallback para o texto/tema
  original do projeto quando ausente.

## 2. Campos configuráveis

| Campo (camelCase na API/front) | Coluna (banco) | Tipo/limite | Onde é validado |
|---|---|---|---|
| `nomeLoja` | `estabelecimentos.nome_fantasia` | texto, 160 | `salvarConfiguracao` |
| `logo`, `banner` | `logo_url`, `banner_url` | URL, 500 | upload (`imageStore.js`) + `salvarConfiguracao` |
| `bannerTitulo` | `banner_titulo` | texto, 160, opcional | `salvarConfiguracao` |
| `bannerSubtitulo` | `banner_subtitulo` | texto, 280, opcional | `salvarConfiguracao` |
| `bannerBotaoTexto` | `banner_botao_texto` | texto, 60, opcional | `salvarConfiguracao` (deve vir junto com o destino) |
| `bannerBotaoDestino` | `banner_botao_destino` | enum: `cardapio`/`promocoes`/`sobre`, opcional | `salvarConfiguracao` + `CHECK` no banco |
| `tituloCardapio` | `titulo_cardapio` | texto, 160, opcional | `salvarConfiguracao` |
| `textoApresentacao` | `texto_apresentacao` | texto, 280, opcional | `salvarConfiguracao` |
| `tituloSobre` | `titulo_sobre` | texto, 160, opcional | `salvarConfiguracao` |
| `textoSobre` | `texto_sobre` | texto, 600, opcional | `salvarConfiguracao` |
| `mensagemRodape` | `mensagem_rodape` | texto, 280, opcional | `salvarConfiguracao` |
| `corPrincipal`, `corSecundaria`, `corFundo`, `corCard`, `corTexto` | `cor_*` | hexadecimal `#RRGGBB` | `validarCorConfiguracao` + `CHECK` no banco |
| `fonte` | `fonte` | allowlist fixa (Poppins, Arial, Verdana, Tahoma, Trebuchet MS, Georgia) | `FONTES_PERMITIDAS` |
| `telefone`, `whatsapp`, `email`, `endereco`, `horarioFuncionamento` | idem | texto, com validação de formato de e-mail | `salvarConfiguracao` |
| `instagramUrl`, `facebookUrl` | `instagram_url`, `facebook_url` | URL http(s), opcional | `validarUrlOpcional` |
| `lojaAberta`, `entregaAtiva`, `retiradaAtiva`, `atendimentoGarcomAtivo`, `aceitaCartao`, `aceitaDinheiro` | booleanos | `TINYINT(1)` | booleano estrito (`=== true`) |
| `taxaEntrega`, `pedidoMinimo` | `*_centavos` | número ≥ 0, convertido para centavos | `precoParaCentavos` |
| `pixChave`, `pixBeneficiario`, `pixCidade` | `pix_*` | texto; beneficiário/cidade exigidos se houver chave | `salvarConfiguracao` |
| `areasEntrega` | `areas_entrega_json` | lista `{bairro, taxa}`, sem bairro duplicado | `salvarConfiguracao` |
| `politicaCancelamento`, `informacoesLegais` | `politica_cancelamento`, `informacoes_legais` | texto, 2000, opcional | `salvarConfiguracao` |

Nenhum desses campos aceita HTML, JSX, CSS completo ou JavaScript. Todos são
renderizados como texto simples pelo React (sem `dangerouslySetInnerHTML`).

## 3. Valores padrão (fallback)

Se a configuração de um estabelecimento estiver ausente ou parcial, a
interface nunca fica quebrada ou em branco:

- **Cores/fonte**: fallback para o tema padrão do projeto —
  `#FFC107` (principal), `#0A0A0A` (secundária), `#111111` (fundo),
  `#181818` (cards), `#FFFFFF` (texto), fonte `Poppins`. Definido em
  `CORES_PADRAO` (`server/operations.js` e
  `src/pages/admin/configuracoes/index.jsx`) e nos `DEFAULT` das colunas
  `configuracoes_estabelecimento.cor_*`/`fonte`.
- **Textos do banner/cardápio/sobre/rodapé**: quando vazios, `src/pages/home/index.jsx`
  usa os textos originais do projeto ("O Verdadeiro Hambúrguer Artesanal",
  "Nosso cardápio", "Hambúrguer de verdade, feito do nosso jeito.", etc.).
  O botão secundário do banner cai para texto "Ver Cardápio" e destino
  `cardapio` quando não configurado.
- **Imagens**: sem logo/banner configurado, a interface usa o ícone/imagem
  padrão do projeto (`LogoEstabelecimento`, `banner.webp`).

## 4. Uploads (logo e banner)

Reaproveita o mecanismo existente (`server/imageStore.js`), sem tabela ou
rota nova. Arquivos ficam isolados por tenant em
`UPLOADS_PATH/estabelecimentos/{id_estabelecimento}/`. O banco armazena
somente a URL/caminho, nunca o binário. Validações: MIME real do arquivo,
extensão, tamanho máximo, nome seguro e checagem de propriedade do tenant
antes de excluir um arquivo antigo ao substituir logo/banner (nunca é possível
remover um arquivo de outro estabelecimento).

## 5. Permissões

- **Administrador do estabelecimento**: lê e edita somente a configuração do
  próprio tenant, resolvido pela sessão JWT (`request.estabelecimento`), nunca
  por um ID enviado no corpo da requisição.
- **Superadministrador**: cria estabelecimentos e a configuração inicial pelo
  painel global (`server/superadmin.js`), mas a edição do dia a dia continua
  sendo feita pelo administrador de cada loja.
- **Público**: só recebe o subconjunto de `selecionarConfiguracaoPublica`
  (nada de dados administrativos, e-mail interno ou de outro tenant).

## 6. Como adicionar uma nova configuração no futuro

Passo a passo para um novo campo (ex.: `mensagem_atendimento`):

1. **Migration** (`database/migrations/NNN_descricao.sql`): `ALTER TABLE
   configuracoes_estabelecimento ADD COLUMN mensagem_atendimento VARCHAR(200)`
   — sempre `NULL`able/com `DEFAULT`, nunca `NOT NULL` sem default, para não
   quebrar linhas existentes. Nunca use `DROP`/`TRUNCATE`.
2. **Estrutura para banco novo**: replique a mesma coluna em
   `database/estrutura/001_criar_tabelas.sql` e em
   `database/CRIAR_db.sql` (são duas cópias da definição final da tabela).
3. **Backend** (`server/operations.js`): adicione a coluna ao `SELECT` de
   `buscarConfiguracao`, ao mapeamento em `mapearConfiguracao`, ao contrato
   público em `selecionarConfiguracaoPublica` (se for seguro expor
   publicamente) e à extração/validação/gravação em `salvarConfiguracao`
   (extraia com `texto(dados.campo, limite)`, nunca grave `request.body`
   inteiro).
4. **Frontend** (`src/utils/theme.js`): adicione o campo em
   `normalizarConfiguracaoPublica`, com o mesmo limite/validação do backend —
   sem isso, o valor é descartado ao passar pelo `AppProvider`.
5. **Admin** (`src/pages/admin/configuracoes/index.jsx`): adicione o campo ao
   formulário, na seção que fizer mais sentido.
6. **Site público** (`src/pages/home/index.jsx`, se for exibido lá): use o
   campo com fallback para o texto atual quando vazio.
7. **Testes**: atualize `server/api.test.js` (índices de parâmetros do
   `INSERT` mudam ao adicionar colunas no meio da lista — prefira sempre
   adicionar ao final da lista de colunas para minimizar isso) e
   `src/utils/theme.test.js`.
8. Rode `npm run lint`, `npm test` e `npm run build` antes de considerar a
   mudança pronta. Aplique a migration com `npm run db:migrate` somente após
   backup validado (produção) ou em ambiente de desenvolvimento.

## 7. Como testar isolamento com dois estabelecimentos

Sem precisar de um MySQL real, os testes já cobrem os dois tenants com mocks
determinísticos:

- `server/api.test.js` → `publica somente configurações seguras do tenant
  resolvido pelo domínio` (banner/cores/textos de A nunca aparecem em B) e
  `salva toda a configuração somente no tenant autenticado e valida o tema`
  (um `idEstabelecimento` forjado no corpo da requisição é ignorado).
- `server/multitenant-security.test.js` cobre login, catálogo, pedidos,
  uploads e auditoria com dois tenants simulados.

Para um teste de ponta a ponta com MySQL real (login, pedidos e dashboard com
dois tenants em um banco de verdade), use um MySQL **local** de
desenvolvimento (nunca aponte para produção) e rode:

```bash
RUN_MYSQL_TESTS=1 npm test
```

O runner cria e depois apaga automaticamente um banco descartável chamado
`<DB_NAME>_testes`.

## 8. Limitações de segurança

- Nenhum campo aceita HTML, CSS completo, JavaScript, SQL ou template
  executável — apenas texto simples, cor hexadecimal, URL http(s) validada ou
  um valor de uma allowlist fixa (fonte, destino do botão do banner).
- O backend nunca confia em `id_estabelecimento` enviado pelo cliente; o
  tenant vem sempre do host (público) ou da sessão JWT (administrativo).
- Preço, total, taxa de entrega e pedido mínimo continuam calculados e
  validados no servidor no momento do pedido — a personalização visual nunca
  altera essas regras.
- Mass assignment é impedido por mapeamento explícito de campos em
  `salvarConfiguracao`; nenhum campo desconhecido do `request.body` é gravado.

## 9. Configuração de produção

Nenhuma variável de ambiente nova foi introduzida por esta funcionalidade.
Siga [`INSTALACAO.md`](INSTALACAO.md) e [`DEPLOY.md`](DEPLOY.md) normalmente.
Ao aplicar a migration de personalização em um banco existente, siga o mesmo
processo de qualquer outra migration (seção "Banco existente e migrations" em
[`../database/README.md`](../database/README.md)): backup validado,
`npm run db:check`, revisão do arquivo pendente e só então `npm run db:migrate`
em uma janela controlada.
