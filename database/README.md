# Banco de dados

Esta pasta é a fonte versionada da estrutura MySQL. O roteiro operacional
completo está em [`../docs/INSTALACAO.md`](../docs/INSTALACAO.md); a
arquitetura de personalização por estabelecimento (campos configuráveis,
fallbacks, uploads e como adicionar um novo campo) está em
[`../docs/PERSONALIZACAO.md`](../docs/PERSONALIZACAO.md). A fundação multiempresa
possui `estabelecimentos`, `configuracoes_estabelecimento` e escopo
`id_estabelecimento` nas tabelas de negócio. As migrations preservam os dados
atuais associando-os a um estabelecimento padrão. O slug
`estabelecimento-padrao` mantém a instalação atual compatível em
desenvolvimento, enquanto produção resolve cada tenant pelo host validado.

## Fundação multiempresa

`estabelecimentos` é a entidade global que guarda nome, slug, domínio
personalizado, estado operacional, plano e situação da assinatura. `slug` é
obrigatório e único; o domínio personalizado também é único quando informado e
deve ser gravado como `NULL` quando não existir.

`configuracoes_estabelecimento` mantém uma configuração individual por
estabelecimento. Ela contém URLs de logo/banner, a paleta visual padrão, fonte,
contatos, endereço, horários, opções de atendimento e pagamento e textos
operacionais. Imagens permanecem fora do MySQL; somente URLs e caminhos são
armazenados.

A separação foi aplicada somente a dados de negócio. `schema_migrations`,
`metadados`, `superadministradores`, `sessoes_superadmin` e
`auditoria_superadmin` permanecem globais; a própria tabela `estabelecimentos`
é o registro global dos tenants. As demais 19 tabelas atuais recebem o escopo diretamente,
inclusive itens e sessões, para permitir filtros simples e auditoria sem
depender apenas de relacionamentos indiretos. A tabela `configuracoes` é mantida
como compatibilidade temporária, enquanto `configuracoes_estabelecimento` é o
modelo definitivo.

O backend resolve o estabelecimento somente pelo `Host`: subdomínio do domínio
principal, domínio personalizado ou slug de desenvolvimento em localhost. O ID
do estabelecimento enviado pelo cliente não é usado. Leituras, escritas,
sessões e auditoria recebem esse escopo explicitamente.

As colunas adicionadas ao banco existente permanecem nullable durante a
implantação gradual, embora o backend atual sempre as preencha. As unicidades
de usuário, e-mail, categoria, adicional, mesa e chave de idempotência já são
compostas com o estabelecimento. Uma migration futura poderá tornar o escopo
obrigatório após a verificação de ausência de nulos em todos os ambientes.

## Instalação nova pelo MySQL Workbench

1. Crie um schema vazio pelo painel do provedor ou selecione o schema já fornecido.
2. Faça login nesse schema e execute `CRIAR_db.sql` completo uma única vez.
3. Configure a conta restrita da aplicação no `.env`.
4. Defina senhas fortes para o administrador do estabelecimento inicial e para
   o superadministrador global. Execute `npm run criar-admin-inicial` e
   `npm run criar-superadmin`.
5. Valide com `npm run db:check` e, no Workbench, execute
   `verificacoes/001_verificar_instalacao.sql`.

`CRIAR_db.sql` contém tabelas, índices, relacionamentos, o estabelecimento
inicial de compatibilidade e apenas os dados iniciais não sensíveis. Ele não
contém conta administrativa nem dados demonstrativos.

Se preferir executar os módulos menores no schema já selecionado, use nesta
ordem os arquivos de `estrutura/` e depois `seeds/001_dados_iniciais.sql`:

1. `estrutura/001_criar_tabelas.sql`;
2. `estrutura/003_criar_indices.sql`;
3. `estrutura/002_criar_relacionamentos.sql`;
4. `seeds/001_dados_iniciais.sql`.

## Ambiente local de desenvolvimento

[`local/`](local/README.md) prepara o MySQL local (schema vazio + conta da
aplicação) para que o desenvolvimento não use o banco remoto de produção. Essa
pasta é ambiente, não estrutura: nenhuma tabela é criada por ela.

## Preparação local explícita

`npm run db:prepare` é uma conveniência para um banco novo e vazio. Em
desenvolvimento ele pode criar o schema ausente, aplica a estrutura e cria o
primeiro administrador a partir do `.env`. O comando recusa qualquer schema que
já contenha tabelas, evitando que uma reinstalação altere dados existentes.

Dados fictícios são opt-in: somente `SEED_DEMO_DATA=1` faz o preparo inserir o
catálogo e a operação de demonstração. Use essa opção apenas em ambiente
descartável; ela deve permanecer desativada em produção.

O servidor (`npm run dev`, `npm start`) apenas abre e valida a conexão. Ele não
cria banco, tabelas, índices, relacionamentos, usuários ou seeds no startup.

## Banco existente e migrations

Nunca execute `CRIAR_db.sql` em um banco persistente. Antes de alterar um banco
existente:

1. crie um backup e teste a restauração em ambiente isolado;
2. valide as variáveis com `npm run db:check`;
3. revise as migrations pendentes em `migrations/`;
4. execute `npm run db:migrate` em uma janela controlada;
5. rode as consultas de `verificacoes/` e os testes da aplicação.

Para migrar a instalação atual, mantenha a aplicação sem novas escritas e use a
ordem registrada pelo runner:

1. `001_adicionar_estabelecimentos.sql` cria a fundação;
2. `002_adicionar_escopo_estabelecimento.sql` adiciona colunas nullable;
3. `003_relacionar_dados_estabelecimento.sql` cria o estabelecimento padrão,
   copia a configuração e associa todos os registros existentes;
4. `004_adicionar_integridade_estabelecimento.sql` cria índices e FKs;
5. `005_preservar_redes_configuracao.sql` preserva Instagram e Facebook no
   modelo definitivo de configuração;
6. `006_ajustar_unicidade_por_estabelecimento.sql` troca unicidades globais por
   unicidades compostas com o estabelecimento;
7. `007_adicionar_superadministradores.sql` cria as contas globais, sessões
   revogáveis e auditoria do painel de superadministrador;
8. `008_adicionar_textos_publicos.sql` adiciona os textos editáveis do banner,
   do cardápio e da seção "sobre" a `configuracoes_estabelecimento`, todos
   opcionais (ver [`../docs/PERSONALIZACAO.md`](../docs/PERSONALIZACAO.md));
9. `verificacoes/002_verificar_migracao_estabelecimento.sql` deve retornar zero
   para todos os registros sem escopo e relacionamentos divergentes.

Em produção, aplique essas migrations somente com backup validado e junto do
deploy do backend multiempresa. Nesta etapa os arquivos foram somente
versionados e verificados estaticamente; nenhum banco foi alterado.

Novas migrations usam o formato `NNN_descricao.sql`. O runner registra nome e
checksum em `schema_migrations` e interrompe a execução se uma migration já
registrada tiver sido modificada. DDL do MySQL pode efetuar commit implícito;
uma migration deve ser pequena, revisada, idempotente quando possível e
acompanhada de estratégia de recuperação. O histórico em `migrations/legado/`
é documental e não é executado automaticamente.

Uma instalação feita por `CRIAR_db.sql` já contém a estrutura final e registra
os checksums das migrations incorporadas. `npm run db:prepare` faz o mesmo para
um schema local vazio. Assim, o runner não tenta reaplicar alterações de coluna
em uma instalação nova.

## TLS e segredos

- Nunca versione `.env`, senha, token, chave privada ou backup real.
- Use um `JWT_SECRET` aleatório com pelo menos 32 bytes e compartilhe o mesmo
  valor entre todas as instâncias do mesmo ambiente.
- Use uma conta MySQL exclusiva, com acesso somente ao schema da aplicação.
- Mantenha a conta da aplicação apenas com permissões operacionais. Para
  migrations, forneça temporariamente ao comando uma credencial de manutenção
  com os privilégios DDL estritamente necessários e retire-a depois.
- Para MySQL remoto, habilite `DB_SSL=true` e informe em `DB_SSL_CA` o conteúdo
  PEM da CA ou o caminho para o certificado. A validação do certificado não é
  desativada.
- `SYNC_ADMIN_CREDENTIALS=1` pode atualizar a primeira conta administrativa;
  use-o apenas de forma pontual e volte a `0` após a recuperação controlada.
- `SYNC_SUPERADMIN_CREDENTIALS=1` faz o mesmo para a conta global e revoga suas
  sessões existentes; volte a `0` imediatamente depois do uso.

## Painel global e novos estabelecimentos

Depois de aplicar a migration `007`, defina `SUPERADMIN_USER`,
`SUPERADMIN_EMAIL`, `SUPERADMIN_NAME` e uma `SUPERADMIN_PASSWORD` com pelo
menos 12 caracteres. Execute `npm run criar-superadmin` uma única vez e acesse
`/superadmin/login`. A senha é transformada em hash antes de ser gravada e não
é criada no startup da aplicação.

O cadastro de um estabelecimento pelo painel cria, na mesma transação, o
tenant, sua configuração visual e o primeiro administrador. Não execute
`CRIAR_db.sql` novamente para cada cliente. Plano, situação e vencimento da
assinatura são controles manuais; esta etapa não possui gateway de cobrança.

Para publicar um novo slug como subdomínio, configure um registro DNS curinga
para `*.seu-dominio` apontando para a mesma implantação e preencha
`DOMINIO_PRINCIPAL`. Um domínio personalizado também precisa ser apontado no
DNS para essa implantação antes de ser informado no painel. DNS, certificado
TLS e configuração do proxy/hospedagem não podem ser realizados pela aplicação.
