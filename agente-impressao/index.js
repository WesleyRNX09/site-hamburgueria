/*
  Agente de impressão local.

  Roda no computador da loja (PC, mini PC ou Raspberry Pi), na mesma rede das
  impressoras. Não faz parte do app: só conversa com a API por HTTP e com as
  impressoras por TCP.

  Ciclo: busca os trabalhos pendentes da loja, imprime cada um e avisa o
  servidor. Falhou (impressora sem papel, fora da rede, desligada)? O trabalho
  continua pendente e volta no próximo ciclo — recibo de cozinha não pode
  simplesmente sumir.

  Sem nenhuma dependência: só módulos nativos do Node.
*/

import { Socket } from 'node:net';
import process from 'node:process';

import { montarRecibo } from './escpos.js';

const URL_SERVIDOR = String(process.env.PRINT_AGENT_URL ?? '').trim().replace(/\/+$/, '');
const TOKEN = String(process.env.PRINT_AGENT_TOKEN ?? '').trim();
const INTERVALO_MS = Number(process.env.PRINT_AGENT_INTERVAL_MS ?? 5000);
const TIMEOUT_IMPRESSORA_MS = Number(process.env.PRINT_AGENT_PRINTER_TIMEOUT_MS ?? 10000);
const TIMEOUT_HTTP_MS = Number(process.env.PRINT_AGENT_HTTP_TIMEOUT_MS ?? 15000);

function registrar(nivel, mensagem, detalhe) {
  const hora = new Date().toISOString();
  const linha = `[${hora}] ${nivel} ${mensagem}`;
  if (detalhe === undefined) console.log(linha);
  else console.log(linha, detalhe);
}

function validarConfiguracao() {
  const problemas = [];
  if (!/^https?:\/\//.test(URL_SERVIDOR)) {
    problemas.push('PRINT_AGENT_URL precisa ser a URL da loja, começando com http:// ou https://');
  }
  // O formato é o mesmo que o painel gera: 32 bytes em base64url.
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(TOKEN)) {
    problemas.push('PRINT_AGENT_TOKEN precisa ser o token gerado em Admin → Impressoras → Gerar dispositivo');
  }
  if (!Number.isFinite(INTERVALO_MS) || INTERVALO_MS < 1000) {
    problemas.push('PRINT_AGENT_INTERVAL_MS precisa ser de pelo menos 1000 (1 segundo)');
  }
  if (problemas.length > 0) {
    registrar('ERRO', 'Configuração inválida. Revise o arquivo .env:');
    for (const problema of problemas) registrar('ERRO', `  - ${problema}`);
    process.exit(1);
  }
}

async function chamarApi(caminho, { metodo = 'GET' } = {}) {
  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), TIMEOUT_HTTP_MS);
  try {
    const resposta = await fetch(`${URL_SERVIDOR}${caminho}`, {
      method: metodo,
      headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}` },
      signal: controlador.signal
    });
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      const erro = new Error(corpo.erro || `HTTP ${resposta.status}`);
      erro.status = resposta.status;
      throw erro;
    }
    return corpo;
  } finally {
    clearTimeout(limite);
  }
}

/*
  Envio cru para a impressora: abre a conexão TCP (porta 9100 por padrão nas
  térmicas de rede), despeja os bytes do recibo e fecha. Não há confirmação no
  protocolo — o que dá para garantir é que a impressora aceitou os bytes.
*/
function imprimir(host, porta, bytes) {
  return new Promise((resolver, rejeitar) => {
    const conexao = new Socket();
    let encerrado = false;

    const terminar = (erro) => {
      if (encerrado) return;
      encerrado = true;
      conexao.destroy();
      if (erro) rejeitar(erro);
      else resolver();
    };

    conexao.setTimeout(TIMEOUT_IMPRESSORA_MS);
    conexao.once('timeout', () => terminar(new Error(`tempo esgotado em ${host}:${porta}`)));
    conexao.once('error', (erro) => terminar(erro));
    conexao.connect(porta, host, () => {
      conexao.write(bytes, (erro) => {
        if (erro) {
          terminar(erro);
          return;
        }
        // `end` espera o envio terminar antes de fechar a conexão.
        conexao.end(() => terminar(null));
      });
    });
  });
}

async function processarTrabalho(trabalho) {
  const { impressora } = trabalho;
  try {
    await imprimir(impressora.host, impressora.porta, montarRecibo(trabalho));
  } catch (erro) {
    registrar('AVISO', `Trabalho ${trabalho.id} falhou em ${impressora.nome} (${impressora.host}:${impressora.porta}): ${erro.message}`);
    await chamarApi(`/api/impressao/trabalhos/${trabalho.id}/falhar`, { metodo: 'POST' })
      .catch((falha) => registrar('ERRO', `Não foi possível registrar a falha do trabalho ${trabalho.id}: ${falha.message}`));
    return false;
  }
  await chamarApi(`/api/impressao/trabalhos/${trabalho.id}/confirmar`, { metodo: 'POST' });
  registrar('INFO', `Trabalho ${trabalho.id} impresso em ${impressora.nome}`);
  return true;
}

let avisouDesconexao = false;

async function ciclo() {
  let trabalhos;
  try {
    ({ trabalhos } = await chamarApi('/api/impressao/trabalhos'));
    if (avisouDesconexao) {
      registrar('INFO', 'Conexão com o servidor restabelecida.');
      avisouDesconexao = false;
    }
  } catch (erro) {
    if (erro.status === 401) {
      registrar('ERRO', 'Token recusado pelo servidor. O dispositivo foi revogado ou o token está errado. Gere outro no painel.');
      return;
    }
    if (!avisouDesconexao) {
      registrar('AVISO', `Sem contato com o servidor: ${erro.message}. Continuo tentando.`);
      avisouDesconexao = true;
    }
    return;
  }

  if (trabalhos.length === 0) return;
  registrar('INFO', `${trabalhos.length} trabalho(s) na fila.`);
  // Um por vez e em ordem: a cozinha recebe os pedidos na sequência em que
  // foram lançados, e duas impressoras não disputam a mesma conexão.
  for (const trabalho of trabalhos) {
    await processarTrabalho(trabalho).catch((erro) => {
      registrar('ERRO', `Erro inesperado no trabalho ${trabalho.id}: ${erro.message}`);
    });
  }
}

async function principal() {
  validarConfiguracao();
  registrar('INFO', `Agente de impressão iniciado. Servidor: ${URL_SERVIDOR}, intervalo: ${INTERVALO_MS}ms.`);

  let rodando = true;
  const parar = (sinal) => {
    if (!rodando) return;
    rodando = false;
    registrar('INFO', `Recebido ${sinal}, encerrando após o ciclo atual.`);
  };
  process.on('SIGINT', () => parar('SIGINT'));
  process.on('SIGTERM', () => parar('SIGTERM'));

  /* Laço sequencial em vez de setInterval: um ciclo lento (impressora
     travada) nunca acumula ciclos sobrepostos disputando a mesma fila. */
  while (rodando) {
    await ciclo().catch((erro) => registrar('ERRO', `Falha no ciclo: ${erro.message}`));
    if (!rodando) break;
    await new Promise((resolver) => setTimeout(resolver, INTERVALO_MS));
  }
  registrar('INFO', 'Agente encerrado.');
}

principal();
