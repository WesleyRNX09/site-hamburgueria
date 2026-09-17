# Agente de impressão

Programa que roda **dentro da loja** e imprime as comandas da cozinha e os
pedidos de delivery nas impressoras térmicas de rede.

Ele não faz parte do site nem do painel: é um pacote separado, sem nenhuma
dependência além do próprio Node. Instale-o em um computador que fique ligado
durante o expediente e que esteja na mesma rede das impressoras.

## Como funciona

```text
Garçom envia a comanda  ─┐
                         ├─►  servidor cria um trabalho por impressora
Cliente faz um pedido   ─┘              (fila no banco)
                                             │
                    agente na loja ──────────┘
                    busca a fila a cada 5s
                                             │
                                             ▼
                              impressora da cozinha (TCP 9100)
```

O agente pergunta ao servidor o que há para imprimir, imprime e avisa que
imprimiu. Se a impressora estiver sem papel, desligada ou fora da rede, o
trabalho **continua na fila** e sai assim que ela voltar — nada é perdido.

Se nenhum produto tiver impressora configurada, nada é impresso, e isso não
impede o pedido de ser feito nem a comanda de ir para a cozinha.

## O que você precisa antes de começar

1. **Uma impressora térmica de rede** (Ethernet ou Wi-Fi) com **IP fixo** na
   rede da loja. Impressora só USB não funciona neste agente.
2. **O IP e a porta da impressora.** A porta padrão é `9100`. O IP costuma sair
   na página de autoteste (segure o botão de avanço de papel ao ligar).
3. **Node.js 22.13 ou mais novo** no computador que vai rodar o agente.
   Baixe em <https://nodejs.org> (versão LTS).

## Passo 1 — cadastrar a impressora no painel

1. Entre no painel como administrador.
2. Vá em **Impressoras**.
3. Cadastre cada impressora com um nome (ex.: `Cozinha`, `Bar`), o **IP** e a
   **porta**.
4. Em **Cardápio → Categorias**, escolha a **impressora padrão** de cada
   categoria (ex.: Hambúrgueres → Cozinha, Bebidas → Bar).
5. Se algum produto precisar sair em outra impressora, abra o produto em
   **Cardápio** e escolha a **Impressora (exceção)**. Deixe em "Usar da
   categoria" no caso normal.

## Passo 2 — gerar o token do dispositivo

Ainda em **Impressoras**, na seção **Dispositivos de impressão**:

1. Dê um nome ao computador (ex.: `PC da cozinha`) e clique em
   **Gerar dispositivo**.
2. **Copie o token na hora.** Ele aparece uma única vez; o servidor guarda
   apenas um hash e não consegue mostrá-lo de novo. Se perder, gere outro
   dispositivo e revogue o antigo.

O token vale como senha do agente: qualquer um com ele consegue ler a fila de
impressão da sua loja. Não mande por WhatsApp nem deixe anotado no balcão.

## Passo 3 — instalar o agente

Copie a pasta `agente-impressao/` para o computador da loja (pen drive, e-mail
ou `git clone` do projeto). Depois, dentro dela:

```bash
cp env.example .env
```

No Windows, use `copy env.example .env`.

Abra o `.env` no bloco de notas e preencha:

```text
PRINT_AGENT_URL=https://sualoja.exemplo.com.br
PRINT_AGENT_TOKEN=o-token-que-voce-copiou
```

`PRINT_AGENT_URL` é o mesmo endereço que você digita no navegador para abrir o
painel, sem barra no final.

## Passo 4 — testar

```bash
npm start
```

Deve aparecer:

```text
[...] INFO Agente de impressão iniciado. Servidor: https://..., intervalo: 5000ms.
```

Agora envie uma comanda de teste pelo painel ou pelo app do garçom. Em poucos
segundos o recibo sai na impressora e o log mostra:

```text
[...] INFO 1 trabalho(s) na fila.
[...] INFO Trabalho 12 impresso em Cozinha
```

Para parar o teste, pressione `Ctrl+C`.

## Passo 5 — deixar rodando sozinho

O agente precisa voltar sozinho depois de uma queda de energia ou de um
reinício do computador. Escolha a opção do seu sistema.

### Windows (Agendador de Tarefas)

1. Abra o **Agendador de Tarefas** → **Criar Tarefa**.
2. Aba **Geral**: nome `Agente de impressão`; marque **Executar estando o
   usuário conectado ou não** e **Executar com privilégios mais altos**.
3. Aba **Disparadores** → **Novo** → **Ao iniciar o computador**. Marque
   **Repetir a tarefa a cada 5 minutos** por **Indefinidamente** (assim, se o
   agente cair, ele volta).
4. Aba **Ações** → **Novo**:
   - Programa: `C:\Program Files\nodejs\node.exe`
   - Argumentos: `--env-file-if-exists=.env index.js`
   - Iniciar em: a pasta do `agente-impressao`
5. Aba **Configurações**: marque **Se a tarefa falhar, reiniciar a cada 1
   minuto**.

### Linux / Raspberry Pi (systemd)

Crie `/etc/systemd/system/agente-impressao.service`:

```ini
[Unit]
Description=Agente de impressao da loja
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/agente-impressao
ExecStart=/usr/bin/node --env-file-if-exists=.env index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Ajuste `User` e `WorkingDirectory` para o seu caso e ative:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now agente-impressao
```

Para ver o que está acontecendo:

```bash
sudo journalctl -u agente-impressao -f
```

## Ajustes opcionais

Todos no `.env`, com os valores padrão entre parênteses:

| Variável | O que faz |
| --- | --- |
| `PRINT_AGENT_INTERVAL_MS` (5000) | De quanto em quanto tempo consulta a fila. Mínimo 1000. |
| `PRINT_AGENT_PRINTER_TIMEOUT_MS` (10000) | Quanto espera a impressora responder. |
| `PRINT_AGENT_HTTP_TIMEOUT_MS` (15000) | Quanto espera o servidor responder. |

Baixar o intervalo para 1000 deixa a impressão quase instantânea, mas gera mais
requisições. O servidor limita a 120 requisições por minuto por endereço.

## Problemas comuns

| O que aparece no log | O que fazer |
| --- | --- |
| `Token recusado pelo servidor` | O dispositivo foi revogado ou o token está errado. Gere outro no painel e atualize o `.env`. |
| `Sem contato com o servidor` | Confira o `PRINT_AGENT_URL` e a internet da loja. O agente continua tentando sozinho. |
| `tempo esgotado em 192.168.x.x:9100` | A impressora está desligada, fora da rede ou com outro IP. Confira no painel e no autoteste dela. |
| `ECONNREFUSED` | O IP responde, mas não nessa porta. Confira a porta no cadastro (quase sempre `9100`). |
| Nada é impresso e a fila fica vazia | Nenhum produto do pedido tem impressora. Configure a impressora padrão das categorias. |
| Sai papel com caracteres estranhos | A impressora não aceitou a página de código. O texto ainda sai legível, só sem acento. |

## Segurança

- O `.env` guarda o token do dispositivo. Ele fica **somente** no computador da
  loja e nunca é commitado.
- O token identifica sozinho a loja: o servidor descobre o estabelecimento a
  partir dele, e um agente nunca enxerga a fila de outra loja.
- Revogar um dispositivo no painel corta o acesso na hora, sem precisar mexer
  no computador da loja.
- O agente só lê a fila e confirma impressão. Ele não cria, altera nem cancela
  pedidos.
