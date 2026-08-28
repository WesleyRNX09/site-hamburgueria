# Implantação em produção

## Arquitetura recomendada

- Node.js 22 executa a API e serve o `dist` já compilado.
- MySQL 8 usa banco e usuário exclusivos.
- Um proxy reverso (Nginx, Caddy, IIS ou serviço gerenciado) termina HTTPS e encaminha para `127.0.0.1:3001`.
- `UPLOADS_PATH` aponta para volume persistente fora da pasta substituída a cada release.
- `database/CRIAR_db.sql` documenta a criação limpa da estrutura MySQL; `database/migrations` contém somente alterações incrementais.
- Um gerenciador de processos (serviço do Windows, systemd ou PM2) reinicia o Node após falhas e inicialização da máquina.

## Preparação

1. Provisione o banco e um usuário restrito conforme o README. Não use `root` na aplicação.
2. Copie `.env.example` para `.env` somente no servidor e preencha os valores reais.
3. Defina `NODE_ENV=production`, `PUBLIC_SITE_URL`, `VITE_PUBLIC_URL` e `CORS_ORIGINS` com a origem HTTPS exata. Para MySQL remoto, use `DB_SSL=true` e configure `DB_SSL_CA`.
4. Em uma instalação nova, crie/selecione o schema pelo provedor e aplique `database/CRIAR_db.sql`; esse arquivo não cria nem seleciona o banco. Em banco existente, faça backup, revise as migrations e execute `npm run db:migrate`; nunca reaplique o instalador completo.
5. Defina `ADMIN_PASSWORD` com no mínimo 12 caracteres, execute `npm run criar-admin-inicial` e depois remova a senha do ambiente de execução se ela não for necessária para recuperação operacional.
6. Defina um caminho absoluto e persistente para `UPLOADS_PATH`, crie a pasta
   e conceda leitura/escrita somente ao usuário do serviço Node.
7. Execute `npm ci`, os testes adequados em banco isolado, `npm run lint`, `npm run build` e `npm run db:check`.
8. Inicie com `npm start`; exponha apenas o proxy HTTPS, nunca a porta interna diretamente à internet. O startup valida a conexão, mas não cria nem altera estruturas ou usuários.

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
  mantendo a correspondência entre o backup dos arquivos e o backup MySQL.
- Direcione stdout/stderr estruturados do processo para a solução de logs do servidor, com rotação e acesso restrito.
- Monitore `/api/saude`, uso de disco, conexões MySQL, erros HTTP 5xx e validade do certificado.
- Mantenha cópias operacionais do MySQL pela infraestrutura escolhida e teste a restauração em ambiente isolado. `database/CRIAR_db.sql` recria uma instalação limpa, mas não substitui uma cópia dos dados reais de produção.
- Antes de cada release, confira migrations pendentes e seus checksums. DDL do MySQL pode efetuar commit implícito, portanto planeje a recuperação antes da execução.
- As migrations `002` a `004` expandem e associam o escopo multiempresa. Execute-as com novas escritas suspensas e valide `database/verificacoes/002_verificar_migracao_estabelecimento.sql` antes de liberar tráfego. As colunas continuam nullable até o backend passar a preencher e validar o estabelecimento em todas as operações.
- Faça o primeiro acesso administrativo, troque a senha e cadastre os dados reais da loja antes de abrir pedidos.

## Recuperação de acesso

Não existe SMTP ou provedor de e-mail configurado, então o sistema não apresenta um fluxo de “esqueci minha senha” fictício. Uma recuperação autônoma futura exige provedor SMTP/API, remetente e domínio verificados, tokens de uso único com hash e expiração, rate limit e templates. Até isso ser implantado, outro administrador ativo pode manter acessos e a recuperação de último recurso exige procedimento operacional direto e controlado no banco/ambiente pelo responsável técnico.
