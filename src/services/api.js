const CHAVE_SESSAO_ADMIN = 'hamburgueria_admin_sessao';
const CHAVE_SESSAO_GARCOM = 'hamburgueria_garcom_sessao';
const CHAVE_SESSAO_SUPERADMIN = 'hamburgueria_superadmin_sessao';
const URL_API = import.meta.env.VITE_API_URL ?? '';

export class ErroApi extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function obterToken(chave) {
  try {
    return JSON.parse(sessionStorage.getItem(chave))?.token ?? null;
  } catch {
    return null;
  }
}

async function requisicao(caminho, { metodo = 'GET', dados, autenticacao } = {}) {
  const cabecalhos = { Accept: 'application/json' };
  if (dados !== undefined) cabecalhos['Content-Type'] = 'application/json';

  if (autenticacao) {
    const chaves = {
      admin: CHAVE_SESSAO_ADMIN,
      garcom: CHAVE_SESSAO_GARCOM,
      superadmin: CHAVE_SESSAO_SUPERADMIN
    };
    const chave = chaves[autenticacao];
    const token = obterToken(chave);
    if (token) cabecalhos.Authorization = `Bearer ${token}`;
  }

  let resposta;
  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), 10000);
  try {
    resposta = await fetch(`${URL_API}${caminho}`, {
      method: metodo,
      headers: cabecalhos,
      body: dados === undefined ? undefined : JSON.stringify(dados),
      signal: controlador.signal
    });
  } catch {
    throw new ErroApi('Não foi possível conectar ao servidor. Verifique se o backend e o MySQL estão ligados.', 0);
  } finally {
    clearTimeout(limite);
  }

  const conteudo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ErroApi(conteudo.erro || 'Não foi possível concluir a operação.', resposta.status);
  return conteudo;
}

export function buscarCatalogo() {
  return requisicao('/api/catalogo');
}

export function buscarDadosPublicos() {
  return requisicao('/api/publico/inicial');
}

export function loginSuperadmin(usuario, senha) {
  return requisicao('/api/superadmin/login', { metodo: 'POST', dados: { usuario, senha } });
}

export function validarSessaoSuperadmin() {
  return requisicao('/api/superadmin/sessao', { autenticacao: 'superadmin' });
}

export function logoutSuperadmin() {
  return requisicao('/api/superadmin/sessao', { metodo: 'DELETE', autenticacao: 'superadmin' });
}

export function listarEstabelecimentosSuperadmin(filtros = {}) {
  const parametros = new URLSearchParams();
  Object.entries(filtros).forEach(([chave, valor]) => {
    if (valor) parametros.set(chave, valor);
  });
  const consulta = parametros.size ? `?${parametros.toString()}` : '';
  return requisicao(`/api/superadmin/estabelecimentos${consulta}`, { autenticacao: 'superadmin' });
}

export function criarEstabelecimentoSuperadmin(dados) {
  return requisicao('/api/superadmin/estabelecimentos', {
    metodo: 'POST',
    dados,
    autenticacao: 'superadmin'
  });
}

export function atualizarEstabelecimentoSuperadmin(id, dados) {
  return requisicao(`/api/superadmin/estabelecimentos/${id}`, {
    metodo: 'PUT',
    dados,
    autenticacao: 'superadmin'
  });
}

export function criarPedidoDeliveryApi(dados, itens) {
  return requisicao('/api/pedidos', { metodo: 'POST', dados: { ...dados, itens } });
}

export function validarCarrinhoApi(itens) {
  return requisicao('/api/carrinho/validar', { metodo: 'POST', dados: { itens } });
}

export function acompanharPedidoApi(codigo, token) {
  return requisicao(`/api/pedidos/${encodeURIComponent(codigo)}?token=${encodeURIComponent(token)}`);
}

export function loginAdmin(usuario, senha) {
  return requisicao('/api/admin/login', { metodo: 'POST', dados: { usuario, senha } });
}

export function validarSessaoAdmin() {
  return requisicao('/api/admin/sessao', { autenticacao: 'admin' });
}

export function logoutAdmin() {
  return requisicao('/api/admin/sessao', { metodo: 'DELETE', autenticacao: 'admin' });
}

export function buscarDadosAdmin() {
  return requisicao('/api/admin/dados', { autenticacao: 'admin' });
}

export function criarCategoriaApi(dados) {
  return requisicao('/api/admin/categorias', { metodo: 'POST', dados, autenticacao: 'admin' });
}

export function atualizarCategoriaApi(id, dados) {
  return requisicao(`/api/admin/categorias/${id}`, { metodo: 'PUT', dados, autenticacao: 'admin' });
}

export function alterarStatusCategoriaApi(id, ativo) {
  return requisicao(`/api/admin/categorias/${id}/status`, { metodo: 'PATCH', dados: { ativo }, autenticacao: 'admin' });
}

export function criarAdministradorApi(dados) {
  return requisicao('/api/admin/administradores', { metodo: 'POST', dados, autenticacao: 'admin' });
}

export function alterarStatusAdministradorApi(id, ativo) {
  return requisicao(`/api/admin/administradores/${id}/status`, { metodo: 'PATCH', dados: { ativo }, autenticacao: 'admin' });
}

export function alterarSenhaAdministradorApi(dados) {
  return requisicao('/api/admin/senha', { metodo: 'PUT', dados, autenticacao: 'admin' });
}

export function criarMesaAdminApi(numero) {
  return requisicao('/api/admin/mesas', { metodo: 'POST', dados: { numero }, autenticacao: 'admin' });
}

export function abrirComandaAdminApi(mesaId, funcionarioId) {
  return requisicao('/api/admin/comandas', {
    metodo: 'POST',
    dados: { mesaId, funcionarioId },
    autenticacao: 'admin'
  });
}

export function adicionarItemComandaAdminApi(comandaId, dados) {
  return requisicao(`/api/admin/comandas/${comandaId}/itens`, { metodo: 'POST', dados, autenticacao: 'admin' });
}

export function atualizarItemComandaAdminApi(comandaId, itemId, quantidade) {
  return requisicao(`/api/admin/comandas/${comandaId}/itens/${itemId}`, {
    metodo: 'PATCH',
    dados: { quantidade },
    autenticacao: 'admin'
  });
}

export function removerItemComandaAdminApi(comandaId, itemId) {
  return requisicao(`/api/admin/comandas/${comandaId}/itens/${itemId}`, { metodo: 'DELETE', autenticacao: 'admin' });
}

export function lancarComandaAdminApi(comandaId) {
  return requisicao(`/api/admin/comandas/${comandaId}/lancar`, {
    metodo: 'POST',
    autenticacao: 'admin'
  });
}

export function limparItensPendentesAdminApi(comandaId) {
  return requisicao(`/api/admin/comandas/${comandaId}/itens-pendentes`, {
    metodo: 'DELETE',
    autenticacao: 'admin'
  });
}

export function cancelarComandaAdminApi(comandaId) {
  return requisicao(`/api/admin/comandas/${comandaId}/cancelar`, {
    metodo: 'POST',
    autenticacao: 'admin'
  });
}

export function finalizarComandaAdminApi(comandaId, pagamento, valorRecebido = null) {
  return requisicao(`/api/admin/comandas/${comandaId}/finalizar`, {
    metodo: 'POST',
    dados: { pagamento, valorRecebido },
    autenticacao: 'admin'
  });
}

export function criarProdutoApi(dados) {
  return requisicao('/api/admin/produtos', { metodo: 'POST', dados, autenticacao: 'admin' });
}

export function atualizarProdutoApi(id, dados) {
  return requisicao(`/api/admin/produtos/${id}`, { metodo: 'PUT', dados, autenticacao: 'admin' });
}

export function alterarStatusProdutoApi(id, ativo) {
  return requisicao(`/api/admin/produtos/${id}/status`, { metodo: 'PATCH', dados: { ativo }, autenticacao: 'admin' });
}

export function excluirProdutoApi(id) {
  return requisicao(`/api/admin/produtos/${id}`, { metodo: 'DELETE', autenticacao: 'admin' });
}

export function criarAdicionalApi(dados) {
  return requisicao('/api/admin/adicionais', { metodo: 'POST', dados, autenticacao: 'admin' });
}

export function atualizarAdicionalApi(id, dados) {
  return requisicao(`/api/admin/adicionais/${id}`, { metodo: 'PUT', dados, autenticacao: 'admin' });
}

export function alterarStatusAdicionalApi(id, ativo) {
  return requisicao(`/api/admin/adicionais/${id}/status`, { metodo: 'PATCH', dados: { ativo }, autenticacao: 'admin' });
}

export function excluirAdicionalApi(id) {
  return requisicao(`/api/admin/adicionais/${id}`, { metodo: 'DELETE', autenticacao: 'admin' });
}

export function criarPromocaoApi(dados) {
  return requisicao('/api/admin/promocoes', { metodo: 'POST', dados, autenticacao: 'admin' });
}

export function atualizarPromocaoApi(id, dados) {
  return requisicao(`/api/admin/promocoes/${id}`, { metodo: 'PUT', dados, autenticacao: 'admin' });
}

export function excluirPromocaoApi(id) {
  return requisicao(`/api/admin/promocoes/${id}`, { metodo: 'DELETE', autenticacao: 'admin' });
}

export function criarFuncionarioApi(dados) {
  return requisicao('/api/admin/funcionarios', { metodo: 'POST', dados, autenticacao: 'admin' });
}

export function atualizarFuncionarioApi(id, dados) {
  return requisicao(`/api/admin/funcionarios/${id}`, { metodo: 'PUT', dados, autenticacao: 'admin' });
}

export function alterarStatusFuncionarioApi(id, ativo) {
  return requisicao(`/api/admin/funcionarios/${id}/status`, { metodo: 'PATCH', dados: { ativo }, autenticacao: 'admin' });
}

export function atualizarStatusPedidoApi(id, status) {
  return requisicao(`/api/admin/pedidos/${encodeURIComponent(id)}/status`, {
    metodo: 'PATCH',
    dados: { status },
    autenticacao: 'admin'
  });
}

export function confirmarPagamentoPedidoApi(id) {
  return requisicao(`/api/admin/pedidos/${encodeURIComponent(id)}/pagamento/confirmar`, {
    metodo: 'POST',
    autenticacao: 'admin'
  });
}

export function estornarPagamentoPedidoApi(id) {
  return requisicao(`/api/admin/pedidos/${encodeURIComponent(id)}/pagamento/estornar`, {
    metodo: 'POST',
    autenticacao: 'admin'
  });
}

export function salvarConfiguracaoApi(dados) {
  return requisicao('/api/admin/configuracao', { metodo: 'PUT', dados, autenticacao: 'admin' });
}

export function loginGarcom(token, pin) {
  return requisicao('/api/garcom/login', { metodo: 'POST', dados: { token, pin } });
}

export function validarSessaoGarcom() {
  return requisicao('/api/garcom/sessao', { autenticacao: 'garcom' });
}

export function logoutGarcom() {
  return requisicao('/api/garcom/sessao', { metodo: 'DELETE', autenticacao: 'garcom' });
}

export function buscarDadosGarcom() {
  return requisicao('/api/garcom/dados', { autenticacao: 'garcom' });
}

export function abrirComandaApi(mesaId) {
  return requisicao('/api/garcom/comandas', { metodo: 'POST', dados: { mesaId }, autenticacao: 'garcom' });
}

export function adicionarItemComandaApi(comandaId, dados) {
  return requisicao(`/api/garcom/comandas/${comandaId}/itens`, { metodo: 'POST', dados, autenticacao: 'garcom' });
}

export function removerItemComandaApi(comandaId, itemId) {
  return requisicao(`/api/garcom/comandas/${comandaId}/itens/${itemId}`, { metodo: 'DELETE', autenticacao: 'garcom' });
}

export function enviarComandaApi(comandaId) {
  return requisicao(`/api/garcom/comandas/${comandaId}/enviar`, { metodo: 'POST', autenticacao: 'garcom' });
}

export function limparItensPendentesApi(comandaId) {
  return requisicao(`/api/garcom/comandas/${comandaId}/itens-pendentes`, {
    metodo: 'DELETE',
    autenticacao: 'garcom'
  });
}

export function solicitarContaApi(comandaId) {
  return requisicao(`/api/garcom/comandas/${comandaId}/conta`, { metodo: 'POST', autenticacao: 'garcom' });
}

