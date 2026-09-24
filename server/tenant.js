const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '::1']);

/*
  Código devolvido junto do 403 de loja fora do ar. O navegador usa para
  mostrar a mensagem amigável, e o servidor para trocar o index.html pela
  página de "indisponível". Não diz se a loja está suspensa ou arquivada.
*/
export const CODIGO_ESTABELECIMENTO_INDISPONIVEL = 'estabelecimento_indisponivel';
const MENSAGEM_ESTABELECIMENTO_INDISPONIVEL = 'Este estabelecimento está temporariamente indisponível.';

/*
  Regra ÚNICA de liberação da loja, usada pelo host (resolverEstabelecimento)
  e pelo agente de impressão. Só o status decide: 'ativo' atende; 'suspenso' e
  'arquivado' ficam fora do ar do mesmo jeito. Plano, status da assinatura e
  vencimento são informativos no cadastro do superadmin e não bloqueiam nada.
*/
export function estabelecimentoLiberado(estabelecimento) {
  return String(estabelecimento?.status ?? '').trim().toLowerCase() === 'ativo';
}

function erroTenant(mensagem, status, codigo) {
  const erro = new Error(mensagem);
  erro.status = status;
  if (codigo) erro.codigo = codigo;
  return erro;
}

function normalizarDominio(valor) {
  return String(valor ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .replace(/^\./, '');
}

export function extrairHostname(cabecalhoHost) {
  const informado = String(cabecalhoHost ?? '').trim().toLowerCase();
  if (!informado || informado.includes(',') || /[\s/\\]/.test(informado)) {
    throw erroTenant('O domínio da requisição é inválido.', 400);
  }
  if (informado.startsWith('[')) {
    const fim = informado.indexOf(']');
    if (fim < 0) throw erroTenant('O domínio da requisição é inválido.', 400);
    return informado.slice(1, fim);
  }
  return informado.split(':')[0];
}

export function identificarEstabelecimentoPeloHost(hostname, {
  dominioPrincipal = '',
  tenantDesenvolvimento = ''
} = {}) {
  const host = extrairHostname(hostname);
  const slugDesenvolvimento = String(tenantDesenvolvimento ?? '').trim().toLowerCase();
  if (HOSTS_LOCAIS.has(host) && slugDesenvolvimento) {
    return { tipo: 'slug', valor: slugDesenvolvimento };
  }

  const dominioBase = normalizarDominio(dominioPrincipal);
  if (dominioBase && host.endsWith(`.${dominioBase}`)) {
    const slug = host.slice(0, -(dominioBase.length + 1));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw erroTenant('O subdomínio informado é inválido.', 404);
    }
    return { tipo: 'slug', valor: slug };
  }

  if (host === dominioBase) throw erroTenant('Informe o subdomínio do estabelecimento.', 404);
  return { tipo: 'dominio', valor: host };
}

export async function resolverEstabelecimento(banco, requisicao, opcoes = {}) {
  const identificador = identificarEstabelecimentoPeloHost(requisicao.headers.host, opcoes);
  const condicao = identificador.tipo === 'slug'
    ? 'LOWER(e.slug) = LOWER(?)'
    : 'LOWER(e.dominio_personalizado) = LOWER(?)';
  const [linhas] = await banco.execute(`
    SELECT e.id_estabelecimento, e.nome_fantasia, e.slug,
           e.dominio_personalizado, e.status, e.plano,
           e.status_assinatura, e.vencimento_assinatura_em
    FROM estabelecimentos AS e
    WHERE ${condicao}
    LIMIT 1
  `, [identificador.valor]);
  const estabelecimento = linhas[0];
  if (!estabelecimento) throw erroTenant('Estabelecimento não encontrado para este domínio.', 404);
  // Mensagem genérica de propósito: nem o motivo da suspensão nem a diferença
  // entre suspenso e arquivado saem daqui.
  if (!estabelecimentoLiberado(estabelecimento)) {
    throw erroTenant(MENSAGEM_ESTABELECIMENTO_INDISPONIVEL, 403, CODIGO_ESTABELECIMENTO_INDISPONIVEL);
  }

  return {
    id: Number(estabelecimento.id_estabelecimento),
    nomeFantasia: estabelecimento.nome_fantasia,
    slug: estabelecimento.slug,
    dominioPersonalizado: estabelecimento.dominio_personalizado ?? null,
    plano: estabelecimento.plano,
    statusAssinatura: estabelecimento.status_assinatura
  };
}
