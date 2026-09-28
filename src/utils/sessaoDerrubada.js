/*
  Quando uma resposta da API derruba a sessão guardada no navegador, e com qual
  mensagem o login recebe a pessoa de volta. Função pura (sem fetch nem
  sessionStorage) para poder ser testada fora do navegador; quem aplica é
  src/services/api.js.

  - 401 em chamada com sessão: a sessão não vale mais.
  - 403 "estabelecimento_indisponivel" no painel do admin ou do garçom: a loja
    foi suspensa ou arquivada com o painel aberto. A mensagem é a genérica da
    Etapa 2, sem motivo e sem dizer se é suspensão ou arquivamento.
  - Qualquer outro erro (inclusive "senha_temporaria_pendente", que tem
    tratamento próprio) mantém a sessão.
*/
export const CODIGO_ESTABELECIMENTO_INDISPONIVEL = 'estabelecimento_indisponivel';
export const MENSAGEM_ESTABELECIMENTO_INDISPONIVEL = 'Este estabelecimento está temporariamente indisponível.';
export const MENSAGEM_SESSAO_EXPIRADA = 'Sua sessão expirou. Entre novamente para continuar.';

const PERFIS_DA_LOJA = new Set(['admin', 'garcom']);

/**
 * @param {{ perfil: string | null, status: number, codigo?: string | null }} resposta
 *   `perfil` é o da sessão enviada na chamada; null quando a chamada não usou sessão.
 * @returns {string | null} mensagem para o login, ou null se a sessão continua.
 */
export function motivoParaEncerrarSessao({ perfil, status, codigo = null }) {
  if (!perfil) return null;
  if (status === 401) return MENSAGEM_SESSAO_EXPIRADA;
  if (status === 403 && codigo === CODIGO_ESTABELECIMENTO_INDISPONIVEL && PERFIS_DA_LOJA.has(perfil)) {
    return MENSAGEM_ESTABELECIMENTO_INDISPONIVEL;
  }
  return null;
}
