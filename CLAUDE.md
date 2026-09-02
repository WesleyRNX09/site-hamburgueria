# CLAUDE.md — REGRAS PERMANENTES DO PROJETO

## 1. Finalidade deste arquivo

Este arquivo contém as regras permanentes que devem orientar qualquer trabalho feito pelo Claude Code neste repositório.

Leia este arquivo antes de analisar, criar, editar, excluir ou mover qualquer arquivo.

As instruções específicas dadas pelo usuário em uma tarefa complementam estas regras, mas não autorizam ignorar segurança, isolamento multiempresa ou preservação de dados.

Este arquivo trabalha em conjunto com `.claude/settings.json` (seção 32), que aplica tecnicamente as regras mais sensíveis descritas aqui.

---

# 2. Como este arquivo funciona no Claude Code

O Claude Code carrega este `CLAUDE.md` automaticamente no início de cada sessão, a partir da raiz do projeto.

Importante: este arquivo é contexto/orientação para o modelo, não um bloqueio técnico. O Claude Code segue estas regras como instruções, mas nada aqui impede fisicamente uma ação por conta própria.

Por isso, este projeto também mantém `.claude/settings.json`, com regras de permissão (`ask`/`deny`) que aplicam tecnicamente as ações mais sensíveis citadas abaixo — como `git push`, `git commit`, `git reset --hard`, `git clean`, `rebase`, deploy e comandos SQL destrutivos. Quando o Claude Code pedir confirmação para uma dessas ações, esse pedido de confirmação **é** a "autorização explícita" exigida pelas regras deste documento — não tente contorná-lo.

Sempre que uma nova regra "nunca" ou "não sem autorização" for adicionada a este arquivo, adicione também a regra correspondente em `.claude/settings.json` (seção 32).

Subpastas do projeto (`/frontend`, `/backend`, `/database`, se existirem nessa estrutura) podem receber seus próprios `CLAUDE.md` com detalhes específicos daquela área. O Claude Code os descobre e carrega automaticamente quando trabalha dentro dessas pastas, sem precisar repetir tudo neste arquivo raiz.

---

# 3. Visão geral do projeto

Este projeto é um sistema para hamburgueria/lanchonete transformado em uma plataforma:

- white-label;
- multiempresa;
- multiestabelecimento;
- com painel administrativo;
- com área pública do cliente;
- com backend compartilhado;
- com banco MySQL compartilhado.

Arquitetura esperada:

```text
1 frontend
1 backend
1 banco por ambiente
1 esquema de tabelas
N estabelecimentos
isolamento por id_estabelecimento
```

Não criar uma cópia do projeto para cada cliente.

---

# 4. Tecnologias principais

Preservar as tecnologias existentes, salvo autorização explícita:

## Frontend

- React.
- JavaScript.
- `react-router-dom`.
- CSS Modules.

## Backend

- Node.js.
- Express.
- JWT.
- `mysql2/promise`.

## Banco

- MySQL.
- InnoDB.
- utf8mb4.

---

# 5. Comandos do projeto

Esta seção deve ser mantida atualizada com os comandos reais do projeto. Sempre que descobrir ou confirmar um comando durante uma tarefa, atualize esta seção.

## Antes de rodar qualquer comando

1. Verifique os scripts reais em `package.json` (raiz, e em `/frontend` e `/backend`, conforme a estrutura existente).
2. Nunca assuma que um script existe só porque é comum em outros projetos Node/React.
3. Prefira `npm run <script>` a reproduzir manualmente o que o script faz por dentro.

Este projeto não usa pastas `/frontend` e `/backend` separadas: é um único
`package.json` na raiz, com o frontend em `src/` e o backend em `server/`.

## Instalação

- Única, na raiz: `npm install`.

## Ambiente de desenvolvimento

- Subir frontend e backend juntos: `npm run dev` (frontend em
  `http://localhost:5173`, API em `http://localhost:3001`).
- Somente frontend: `npm run dev:web`.
- Somente backend: `npm run dev:api`.
- Variáveis de ambiente obrigatórias: ver `env.example` (o projeto não usa o
  nome `.env.example`) e o guia de instalação em `docs/INSTALACAO.md`.

## Qualidade

- Lint: `npm run lint`.
- Testes (backend + utilitários de frontend, sem integração MySQL):
  `npm test`.
- Testes de isolamento multiempresa: `npm run test:security`.
- Integração MySQL real (opt-in, banco descartável): `RUN_MYSQL_TESTS=1 npm test`
  — nunca aponte para um banco remoto/persistente ao usar essa variável.
- Build de produção do frontend: `npm run build`.

## Banco de dados

- Instalação limpa: `database/CRIAR_db.sql`.
- Migrations incrementais: `npm run db:migrate` (nunca em banco remoto sem
  autorização explícita e backup validado).
- Preparo de um schema novo e vazio: `npm run db:prepare`.
- Checar conexão sem alterar estrutura: `npm run db:check`.

---

# 6. Execução de comandos e processos pelo Claude Code

- Não inicie servidores de desenvolvimento (`npm run dev`, `nodemon`, etc.) em primeiro plano esperando que terminem sozinhos — isso trava a sessão. Se precisar validar algo em execução, rode em segundo plano e encerre o processo ao terminar.
- Prefira comandos que terminam sozinhos para validar mudanças (build, lint, testes, type-check) em vez de deixar um servidor rodando para inspeção manual.
- Não exponha portas além de localhost sem necessidade e sem avisar o usuário.
- Ao instalar dependências, não altere versões já fixadas no `package.json`/lockfile sem necessidade relacionada à tarefa atual.

---

# 7. Fonte da verdade

Antes de implementar qualquer tarefa:

1. leia este `CLAUDE.md`;
2. leia documentação relevante;
3. inspecione o código real;
4. verifique o `git status`;
5. verifique alterações locais;
6. preserve trabalho já realizado.

Nunca assuma que o repositório continua exatamente igual a um prompt antigo.

O estado atual dos arquivos é a fonte da verdade.

---

# 8. Regras Git

Não executar sem autorização explícita:

- `git reset --hard`;
- `git clean -fd`;
- descarte global de alterações;
- force push;
- rebase destrutivo;
- push;
- criação de commit;
- deploy.

Nunca apagar alterações locais do usuário.

Antes de modificar arquivos importantes, verifique se existem mudanças não commitadas relacionadas.

Essas ações pedem confirmação automaticamente via `.claude/settings.json` (seção 32). Trate o pedido de confirmação como o momento de dar ou negar a autorização.

---

# 9. Regra central multiempresa

O isolamento entre estabelecimentos é obrigatório.

Dados de estabelecimentos diferentes nunca podem se misturar.

O backend nunca deve confiar no `id_estabelecimento` enviado pelo frontend para decidir propriedade de um recurso.

O tenant deve vir do contexto confiável já adotado pelo projeto, como:

- domínio;
- subdomínio;
- slug validado;
- middleware de estabelecimento;
- JWT validado;
- `request.estabelecimento`;
- contexto equivalente existente.

Todo endpoint administrativo deve validar o estabelecimento autenticado.

---

# 10. Autorização

Perfis devem continuar respeitando as permissões existentes.

Conceitualmente:

## Superadministrador

Pode possuir acesso global conforme as regras do sistema.

## Administrador do estabelecimento

Pode administrar somente o próprio estabelecimento.

## Garçom

Pode acessar somente recursos permitidos do próprio estabelecimento.

Um usuário do estabelecimento A nunca pode visualizar ou modificar dados privados do estabelecimento B.

Quando um recurso de outro tenant for solicitado, utilizar `403` ou `404` conforme a estratégia de segurança já adotada.

---

# 11. Consultas SQL

Nunca utilizar:

```sql
SELECT *
```

Cite explicitamente todas as colunas.

Toda consulta relacionada a dados do estabelecimento deve possuir filtro apropriado por tenant ou derivar de uma relação já validada pelo tenant.

Ao buscar por ID, não basta:

```sql
WHERE id = ?
```

Quando aplicável, a consulta deve também limitar pelo estabelecimento.

Exemplo conceitual:

```sql
WHERE id = ?
  AND id_estabelecimento = ?
```

Adapte ao esquema real.

---

# 12. Banco de dados e migrations

O projeto deve manter a pasta `database` organizada conforme a estrutura real adotada.

Princípios:

- migrations incrementais;
- preservar dados existentes;
- banco novo compatível com estado final das migrations;
- `database/CRIAR_db.sql` atualizado quando a estrutura final mudar;
- seeds demonstrativos separados;
- verificações separadas;
- documentação atualizada.

Nunca utilizar em migrations normais:

- `DROP TABLE`;
- `TRUNCATE`;
- exclusão em massa;
- recriação destrutiva;
- reset total do banco.

Antes de qualquer migration de produção, exigir backup.

Não executar migration em banco remoto sem autorização explícita.

Comandos que contenham `DROP TABLE`, `DROP DATABASE` ou `TRUNCATE` também pedem confirmação via `.claude/settings.json` (seção 32).

---

# 13. CRIAR_db.sql

`database/CRIAR_db.sql` deve representar uma instalação nova e vazia do sistema.

Não deve:

- criar o banco;
- executar `USE`;
- depender de `SOURCE`;
- depender de caminho local;
- possuir host;
- possuir usuário;
- possuir senha;
- usar `DROP TABLE`;
- usar `TRUNCATE`;
- incluir dados demonstrativos;
- incluir senha em texto puro;
- usar `SELECT *`.

Deve manter:

- InnoDB;
- utf8mb4;
- chaves primárias;
- chaves estrangeiras;
- índices;
- restrições;
- estrutura multiempresa;
- dados iniciais não sensíveis necessários.

---

# 14. Secrets e ambiente

Nunca colocar secrets no código.

Nunca exibir nos logs:

- senha do banco;
- JWT secret;
- tokens;
- chaves privadas;
- credenciais.

Configurações de ambiente devem permanecer no `.env`.

O `.env` real não deve ser commitado.

O `.env.example` pode documentar nomes de variáveis, sem valores secretos.

A leitura e a edição diretas do `.env` real são bloqueadas por padrão via `.claude/settings.json` (seção 32); trabalhe com `.env.example`.

---

# 15. Conexão MySQL

Preservar o uso de `mysql2/promise` e pool quando já adotado.

A conexão deve:

- ler variáveis do ambiente;
- validar variáveis obrigatórias;
- possuir limite de conexões;
- suportar SSL quando necessário;
- validar certificados.

Nunca utilizar:

```text
rejectUnauthorized: false
```

como solução de produção.

O servidor não deve criar/alterar tabelas automaticamente ao iniciar.

---

# 16. Personalização white-label

Cada estabelecimento pode possuir identidade visual própria.

Configurações permitidas podem incluir:

## Identidade

- nome;
- logo;
- banner;
- cores;
- fonte de uma allowlist segura.

## Conteúdo público

- título do banner;
- subtítulo do banner;
- texto do botão do banner;
- destino interno permitido;
- título do cardápio;
- texto de apresentação;
- mensagem curta de atendimento;
- mensagem de rodapé;
- texto "sobre", quando existir.

## Contato e operação

- telefone;
- WhatsApp;
- e-mail;
- endereço;
- horários;
- pedido mínimo;
- chave Pix;
- formas de pagamento;
- delivery;
- retirada;
- atendimento por garçom;
- política de cancelamento;
- informações legais.

Antes de criar novos campos, verificar se já existem equivalentes.

---

# 17. O que NÃO pode ser personalizável pelo administrador

Nunca permitir que configurações vindas do banco executem:

- HTML arbitrário;
- JavaScript;
- JSX;
- scripts;
- CSS completo;
- SQL;
- templates executáveis.

O administrador não pode alterar por personalização:

- autenticação;
- autorização;
- tenant;
- `id_estabelecimento`;
- regras de pedidos;
- regras de pagamento;
- código;
- rotas privadas;
- permissões;
- banco;
- secrets.

Não usar:

```jsx
dangerouslySetInnerHTML
```

para renderizar textos configuráveis.

---

# 18. Validação da personalização

Todos os campos devem ser validados no backend.

Aplicar quando relevante:

- tamanho mínimo/máximo;
- trim;
- normalização;
- formato de e-mail;
- formato de telefone;
- formato de cor;
- enum para opções;
- enum para destino de botões;
- limites numéricos;
- validação booleana.

Não fazer mass assignment.

Nunca atualizar configurações usando diretamente todos os campos do `request.body`.

Mapear explicitamente os campos aceitos.

---

# 19. Tema padrão

A identidade visual atual deve continuar sendo o fallback:

```text
Cor principal: #FFC107
Fundo principal: #111111
Tons escuros: #0A0A0A, #141414 e #181818
Texto principal: #FFFFFF
```

Se uma configuração estiver ausente ou `NULL`, a interface deve continuar funcional usando valores padrão.

Nunca deixar a tela pública em branco por configuração ausente.

---

# 20. Frontend público

Não criar um frontend diferente para cada estabelecimento.

Não duplicar componentes por cliente.

Centralizar as configurações do estabelecimento em um Context/Provider/Hook apropriado.

Aplicar tema preferencialmente por variáveis CSS:

```css
--cor-principal;
--cor-secundaria;
--cor-fundo;
--cor-card;
--cor-texto;
```

Não armazenar CSS arbitrário no banco.

Valores configuráveis devem ter fallback.

Evitar múltiplas requisições idênticas para carregar a mesma configuração.

---

# 21. Frontend administrativo

Manter o padrão visual atual:

- fundo escuro;
- destaque amarelo;
- cards escuros;
- bordas discretas;
- botões arredondados;
- textos claros;
- visual clean;
- responsividade;
- CSS Modules.

Não redesenhar telas não relacionadas sem necessidade.

Uma tela de personalização deve priorizar clareza e preview visual.

---

# 22. Upload de imagens

Logo, banner e demais imagens não devem ser salvos como binário diretamente no MySQL.

O banco deve armazenar caminho/URL/metadados necessários.

Arquivos devem ficar isolados por estabelecimento, em estrutura equivalente a:

```text
uploads/estabelecimentos/{id_estabelecimento}/
```

ou mecanismo persistente equivalente.

Validar:

- autenticação;
- tenant;
- MIME type;
- extensão;
- tamanho;
- nome;
- path;
- autorização.

Prevenir:

- path traversal;
- upload de arquivo executável;
- sobrescrita de outro tenant;
- remoção de arquivo de outro tenant.

---

# 23. API

Manter o padrão de resposta JSON já existente.

Não mudar contratos de API sem verificar impacto no frontend.

Quando adicionar campos:

1. atualizar backend;
2. atualizar validações;
3. atualizar frontend;
4. atualizar SQL/migration;
5. atualizar `CRIAR_db.sql` quando necessário;
6. atualizar testes;
7. atualizar documentação.

---

# 24. Pedidos e pagamentos

O backend é a autoridade para valores.

Nunca confiar em preço, total, desconto ou taxa calculados somente pelo navegador.

Ao criar pedido:

- validar produtos;
- validar adicionais;
- validar estabelecimento;
- validar forma de pagamento;
- calcular valores no backend;
- usar transação quando múltiplas tabelas precisarem permanecer consistentes.

Não alterar essas regras em tarefas de personalização sem necessidade explícita.

---

# 25. Segurança mínima obrigatória

Ao alterar qualquer endpoint multiempresa, verificar:

- autenticação;
- autorização;
- tenant;
- IDOR;
- validação de entrada;
- mass assignment;
- SQL injection;
- XSS;
- exposição de informações;
- tratamento de erros.

Ao alterar upload, verificar também:

- MIME spoofing;
- path traversal;
- extensão;
- tamanho;
- propriedade do arquivo.

---

# 26. Preservação de funcionalidades

Não remover funcionalidades existentes para facilitar uma implementação nova.

Preservar, conforme existentes no projeto:

- cardápio;
- carrinho;
- checkout;
- pedidos;
- delivery;
- dashboard;
- gerenciamento de pedidos;
- cadastro de garçons;
- autenticação;
- relatórios;
- personalização já existente.

Mudanças devem ser incrementais.

---

# 27. Escopo

Faça somente o que foi solicitado na tarefa atual.

Não aproveite uma tarefa pequena para:

- refatorar o projeto inteiro;
- renomear todas as pastas;
- trocar bibliotecas;
- reformatar todos os arquivos;
- alterar design global;
- reescrever APIs sem necessidade.

Se encontrar problema não relacionado:

- documente;
- informe o risco;
- não altere automaticamente, salvo se for necessário para concluir com segurança a tarefa autorizada.

---

# 28. Fluxo de trabalho obrigatório

Para cada tarefa:

## Antes

1. Ler este arquivo.
2. Ler os arquivos relevantes.
3. Executar `git status`.
4. Identificar alterações do usuário.
5. Entender o fluxo atual.
6. Procurar implementações semelhantes antes de criar novas.
7. Conferir a seção 5 (Comandos do projeto) antes de rodar scripts.

## Durante

1. Fazer mudanças mínimas e coerentes.
2. Preservar padrões existentes.
3. Não duplicar lógica.
4. Não duplicar tabelas.
5. Manter isolamento multiempresa.
6. Validar entradas.
7. Atualizar documentação relacionada quando necessário.

## Depois

1. Executar testes relacionados.
2. Executar lint/build quando aplicável.
3. Revisar `git diff`.
4. Verificar que nenhum secret foi incluído.
5. Verificar que nenhum arquivo não relacionado foi alterado.
6. Informar exatamente o que foi feito.

---

# 29. Testes

Não afirmar que algo funciona sem validação.

Quando aplicável, executar:

- testes unitários existentes;
- testes de integração;
- testes de rotas;
- lint;
- build frontend;
- checagem do backend;
- checagem de isolamento entre dois estabelecimentos.

Para alterações multiempresa, sempre pensar em:

```text
Estabelecimento A
Estabelecimento B
```

e tentar provar que A não consegue acessar B.

---

# 30. Deploy e produção

Não fazer deploy automaticamente.

Não alterar configurações da Hostinger ou outro ambiente remoto sem autorização explícita.

Não assumir que um push deve ser feito após editar arquivos.

Ao concluir alterações locais, apenas informe quais passos de Git/deploy seriam necessários, se relevantes.

Comandos de deploy também pedem confirmação via `.claude/settings.json` (seção 32); ajuste o padrão genérico ali para o comando real assim que ele for definido.

---

# 31. Relatório ao finalizar uma tarefa

Ao finalizar, responder com:

## Resumo
O que foi realizado.

## Arquivos modificados
Lista e motivo.

## Arquivos criados
Lista e motivo.

## Banco
Migrations/SQL envolvidos e se foram executados.

## Segurança
Como o tenant e as permissões foram preservados.

## Testes
Comandos e resultados.

## Pendências
Somente problemas reais.

## Próximo passo
Uma sugestão objetiva.

---

# 32. Aplicação técnica das regras: .claude/settings.json

Este projeto inclui `.claude/settings.json` (versionado, compartilhado pelo time) com regras de permissão que reforçam tecnicamente as regras deste documento.

## Pedem confirmação explícita (`ask`)

- `git push`
- `git commit`
- `git reset --hard`
- `git clean`
- `git rebase`
- comandos contendo `DROP TABLE`, `DROP DATABASE` ou `TRUNCATE`
- comandos contendo `deploy`

## Sempre bloqueados (`deny`)

- leitura ou edição direta do `.env` real (use `.env.example`)
- `git add` do `.env` real

Ajustes recomendados assim que os detalhes reais do projeto forem confirmados:

- trocar o padrão genérico de `deploy` pelo comando real usado (ex.: script de deploy na Hostinger);
- revisar, com `/permissions` dentro do Claude Code, se algum comando legítimo do dia a dia está caindo sem querer em uma dessas regras.

A sintaxe de permissões pode variar entre versões do Claude Code; confirme o comportamento com `/permissions` após adicionar este arquivo.

---

# 33. Regra final

Segurança, isolamento entre estabelecimentos e preservação dos dados têm prioridade sobre conveniência.

Quando houver dúvida entre uma mudança ampla e uma mudança mínima segura, prefira a mudança mínima segura.

Não recrie o projeto.
Não quebre o que já funciona.
Não misture dados entre estabelecimentos.
