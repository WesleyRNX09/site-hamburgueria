/*
  Dados de contato e endereço lembrados neste aparelho para agilizar o próximo
  pedido. O navegador separa o armazenamento por domínio, então cada loja tem o
  seu. Só entram os campos abaixo: pagamento, troco, token ou qualquer outro
  dado sensível nunca são guardados.
*/
export const CHAVE_DADOS_CLIENTE = 'hamburgueria_cliente';

const LIMITES_CAMPOS = Object.freeze({
  nome: 160,
  telefone: 40,
  rua: 180,
  numero: 30,
  bairro: 120,
  complemento: 160,
  referencia: 255
});

export function normalizarDadosCliente(recebidos) {
  const origem = recebidos && typeof recebidos === 'object' && !Array.isArray(recebidos) ? recebidos : {};
  const dados = {};
  for (const [campo, limite] of Object.entries(LIMITES_CAMPOS)) {
    dados[campo] = typeof origem[campo] === 'string' ? origem[campo].slice(0, limite) : '';
  }
  const areaEntregaId = String(origem.areaEntregaId ?? '');
  dados.areaEntregaId = /^\d{1,19}$/.test(areaEntregaId) ? areaEntregaId : '';
  return dados;
}

/* Armazenamento indisponível (modo privado, bloqueio) nunca quebra o checkout. */
export function lerDadosCliente(armazenamento = globalThis.localStorage) {
  try {
    const bruto = armazenamento?.getItem(CHAVE_DADOS_CLIENTE);
    return bruto ? normalizarDadosCliente(JSON.parse(bruto)) : null;
  } catch {
    return null;
  }
}

export function salvarDadosCliente(dados, armazenamento = globalThis.localStorage) {
  try {
    armazenamento?.setItem(CHAVE_DADOS_CLIENTE, JSON.stringify(normalizarDadosCliente(dados)));
    return true;
  } catch {
    return false;
  }
}

export function apagarDadosCliente(armazenamento = globalThis.localStorage) {
  try {
    armazenamento?.removeItem(CHAVE_DADOS_CLIENTE);
  } catch {
    /* Sem acesso ao armazenamento, não há o que apagar. */
  }
}
