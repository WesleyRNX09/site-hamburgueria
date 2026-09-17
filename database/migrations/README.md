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
- `013_acesso_unico_do_garcom.sql`: troca o QR Code por funcionário por um
  único QR Code do estabelecimento (`estabelecimentos.token_acesso_garcom`) e
  faz o garçom entrar só com a senha, indexada por
  `funcionarios.senha_busca` (única por estabelecimento). Também passa
  `comandas.funcionario_id` para ON DELETE SET NULL, para o administrador
  poder excluir um garçom sem perder o histórico. As credenciais antigas
  (usuário + senha) são invalidadas, porque não há como convertê-las sem a
  senha em texto puro: cada funcionário volta a "sem senha" até o
  administrador cadastrar a nova.
- `014_separar_cardapio_do_salao.sql`: acrescenta `canal` (`ambos`, `online`,
  `salao`) a `categorias` e `produtos`, para a loja física ter mais itens que
  o site sem duplicar cadastro. Coluna nova com DEFAULT `ambos`: nenhuma
  linha é reescrita e o cardápio online continua igual. A visibilidade é a
  interseção entre produto e categoria, e um CHECK limita os valores.
- `015_horario_automatico_da_loja.sql`: acrescenta `horarios_json` (grade da
  semana) e `funcionamento_automatico` a `configuracoes_estabelecimento`, para
  o sistema abrir e fechar a loja pelo relógio em vez de depender do botão
  manual. Colunas novas com DEFAULT: enquanto o administrador não ligar o modo
  automático, `loja_aberta` continua mandando.
- `016_indice_pedidos_por_periodo.sql`: cria o índice composto
  `idx_pedidos_estabelecimento_criado_em (id_estabelecimento, criado_em)` para
  os indicadores do dashboard por período. Só adiciona índice: nenhuma linha é
  alterada e os índices anteriores continuam existindo.
- `017_permissoes_administradores.sql`: cria `administrador_permissoes`
  (permissões do painel por administrador, dentro do estabelecimento, com a
  lista fixa em CHECK) e concede as 13 permissões a todo administrador já
  cadastrado, preservando exatamente o acesso atual. Não altera nem remove
  linhas existentes.
- `018_arquivar_administradores.sql`: acrescenta `arquivado_em` a
  `administradores`, para arquivar uma conta sem apagar a linha e sem perder o
  autor no histórico. Coluna opcional: nenhuma conta existente é arquivada.
- `019_areas_entrega.sql`: cria `areas_entrega` (nome único por
  estabelecimento, taxa e tempo estimado mínimo/máximo em minutos, ativo) e
  `pedidos.area_entrega_id`, com chave estrangeira composta por
  `id_estabelecimento` e RESTRICT: área usada em pedido não é apagada e a taxa
  cobrada continua gravada no próprio pedido. Copia os bairros de
  `areas_entrega_json` para a tabela, lendo o tempo dos dois números de
  `tempo_entrega` (30 e 45 quando não houver). `areas_entrega_json` e
  `pedido_minimo_centavos` ficam no banco sem uso; nenhuma linha é alterada ou
  removida.
- `020_adicionar_impressao.sql`: cria `impressoras` (nome e endereço de rede
  por estabelecimento), `dispositivos_impressao` (cada agente local pareado,
  com o token guardado só como hash) e `trabalhos_impressao` (a fila, com o
  recibo já montado pelo servidor em `conteudo_json` e chave estrangeira da
  impressora composta por `id_estabelecimento`). Acrescenta
  `categorias.impressora_id` e `produtos.impressora_id` — a impressora efetiva
  de um item é a do produto, ou a da categoria quando o produto não tem
  exceção — e `comanda_itens.impresso_em`, para reenviar uma comanda sem
  reimprimir o que a cozinha já recebeu; o histórico já lançado nasce marcado
  com a data do próprio lançamento. As colunas acrescentadas a tabelas
  existentes são todas opcionais e nada é removido nem reescrito: sem
  impressora cadastrada, o sistema continua funcionando como antes.
- `021_observacao_geral_da_comanda.sql`: acrescenta `comandas.observacao`
  (TEXT NULL), o recado que vale para a mesa inteira — aniversário, alergia,
  cliente com pressa — separado da observação de cada item. Coluna opcional e
  sem DEFAULT: nenhuma comanda existente é reescrita, e o limite de 500
  caracteres, com trim, é aplicado pelo servidor.
- `022_impressora_do_caixa.sql`: acrescenta `impressoras.eh_caixa` (TINYINT
  NOT NULL DEFAULT 0) e o índice `idx_impressoras_caixa
  (id_estabelecimento, eh_caixa)`, para a loja dizer qual impressora fica no
  balcão em vez de numa praça de preparo. No máximo uma por estabelecimento,
  garantido pela aplicação dentro da transação que grava — o MySQL não tem
  índice único parcial, e um UNIQUE na coluna barraria ter duas impressoras
  comuns na mesma loja. Coluna com DEFAULT: nenhuma linha é reescrita e
  nenhuma loja ganha impressora de caixa sem alguém escolher.
- `legado/20260824_operacao_comercial.sql`: histórico anterior, fora do runner.
