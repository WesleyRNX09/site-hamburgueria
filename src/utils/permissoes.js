/*
  Catálogo fixo das permissões do painel do estabelecimento.

  Compartilhado entre o servidor, que é quem autoriza de fato, e o painel, que
  só usa a lista para montar menu e tela. A mesma lista está no CHECK da tabela
  `administrador_permissoes`: incluir uma permissão nova exige migration.

  A matriz vale somente para administradores do estabelecimento. Garçom e
  superadministrador ficam de fora.
*/
export const PERMISSOES = Object.freeze([
  { chave: 'dashboard.visualizar', area: 'Dashboard', rotulo: 'Abrir o dashboard' },
  { chave: 'pedidos.visualizar', area: 'Pedidos', rotulo: 'Ver pedidos' },
  { chave: 'pedidos.alterar_status', area: 'Pedidos', rotulo: 'Alterar o status e cancelar pedidos' },
  { chave: 'pedidos.gerenciar_pagamento', area: 'Pedidos', rotulo: 'Confirmar e estornar pagamentos' },
  { chave: 'mesas.operar', area: 'Mesas e comandas', rotulo: 'Abrir comandas e lançar itens' },
  { chave: 'mesas.fechar', area: 'Mesas e comandas', rotulo: 'Finalizar e cancelar comandas' },
  { chave: 'mesas.cadastrar', area: 'Mesas e comandas', rotulo: 'Cadastrar mesas' },
  { chave: 'produtos.editar', area: 'Cardápio', rotulo: 'Editar produtos, categorias, adicionais e promoções' },
  { chave: 'relatorios.visualizar', area: 'Relatórios', rotulo: 'Ver relatórios e indicadores financeiros' },
  { chave: 'funcionarios.gerenciar', area: 'Equipe e acessos', rotulo: 'Gerenciar garçons, administradores e permissões' },
  { chave: 'personalizacao.editar', area: 'Configurações', rotulo: 'Editar identidade e textos públicos' },
  { chave: 'delivery.editar', area: 'Configurações', rotulo: 'Editar entrega, retirada, taxas e bairros' },
  { chave: 'configuracoes.editar', area: 'Configurações', rotulo: 'Editar contato, horários, pagamentos e textos legais' }
]);

export const CHAVES_PERMISSOES = Object.freeze(PERMISSOES.map((permissao) => permissao.chave));

// Todo administrador, existente ou novo, nasce com o conjunto completo.
export const PERMISSOES_PADRAO_ADMINISTRADOR = CHAVES_PERMISSOES;

/* Aceita só chaves do catálogo, sem repetição e na ordem do catálogo. */
export function normalizarPermissoes(lista) {
  if (!Array.isArray(lista)) return [];
  const recebidas = new Set(lista.filter((chave) => typeof chave === 'string'));
  return CHAVES_PERMISSOES.filter((chave) => recebidas.has(chave));
}

export function possuiPermissao(permissoes, chave) {
  return Array.isArray(permissoes) && permissoes.includes(chave);
}
