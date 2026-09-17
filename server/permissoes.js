import {
  CHAVES_PERMISSOES,
  PERMISSOES_PADRAO_ADMINISTRADOR,
  normalizarPermissoes,
  possuiPermissao
} from '../src/utils/permissoes.js';

/*
  Autorização do painel do estabelecimento.

  Cada rota /api/admin/* declara aqui a permissão que exige. `null` significa
  que basta estar autenticado (a rota decide o que devolver). Rota que não
  aparece na lista não é atendida: esquecer de declarar uma rota nova falha
  fechado, nunca aberto.

  `dashboard.visualizar` não tem rota própria: controla só a tela no painel,
  cujos cards já dependem das outras permissões.
*/
const ROTAS_ADMIN = [
  // Retorno filtrado por permissão em listarDadosAdmin.
  ['GET', /^\/api\/admin\/dados$/, null],
  // A própria senha: vale para qualquer administrador autenticado.
  ['PUT', /^\/api\/admin\/senha$/, null],
  // Campos limitados por grupo em limitarConfiguracaoPorPermissao.
  ['PUT', /^\/api\/admin\/configuracao$/, null],
  ['GET', /^\/api\/admin\/dashboard\/indicadores$/, 'relatorios.visualizar'],

  ['GET', /^\/api\/admin\/areas-entrega$/, 'delivery.editar'],
  ['POST', /^\/api\/admin\/areas-entrega$/, 'delivery.editar'],
  ['PUT', /^\/api\/admin\/areas-entrega\/\d+$/, 'delivery.editar'],
  ['PATCH', /^\/api\/admin\/areas-entrega\/\d+\/status$/, 'delivery.editar'],
  ['DELETE', /^\/api\/admin\/areas-entrega\/\d+$/, 'delivery.editar'],

  /* Impressão fica junto das configurações operacionais da loja: quem
     configura pagamento e horário é quem cadastra as impressoras da cozinha.
     Reaproveitar a permissão existente evita mexer no CHECK da tabela. */
  ['GET', /^\/api\/admin\/impressoras$/, 'configuracoes.editar'],
  ['POST', /^\/api\/admin\/impressoras$/, 'configuracoes.editar'],
  ['PUT', /^\/api\/admin\/impressoras\/\d+$/, 'configuracoes.editar'],
  ['PATCH', /^\/api\/admin\/impressoras\/\d+\/status$/, 'configuracoes.editar'],
  ['DELETE', /^\/api\/admin\/impressoras\/\d+$/, 'configuracoes.editar'],
  ['POST', /^\/api\/admin\/impressao\/dispositivos$/, 'configuracoes.editar'],
  ['DELETE', /^\/api\/admin\/impressao\/dispositivos\/\d+$/, 'configuracoes.editar'],

  ['PATCH', /^\/api\/admin\/pedidos\/[^/]+\/status$/, 'pedidos.alterar_status'],
  ['POST', /^\/api\/admin\/pedidos\/[^/]+\/pagamento\/(?:confirmar|estornar)$/, 'pedidos.gerenciar_pagamento'],

  ['POST', /^\/api\/admin\/mesas$/, 'mesas.cadastrar'],
  ['POST', /^\/api\/admin\/comandas$/, 'mesas.operar'],
  ['POST', /^\/api\/admin\/comandas\/\d+\/itens$/, 'mesas.operar'],
  ['PATCH', /^\/api\/admin\/comandas\/\d+\/itens\/\d+$/, 'mesas.operar'],
  ['DELETE', /^\/api\/admin\/comandas\/\d+\/itens\/\d+$/, 'mesas.operar'],
  ['POST', /^\/api\/admin\/comandas\/\d+\/lancar$/, 'mesas.operar'],
  ['PUT', /^\/api\/admin\/comandas\/\d+\/observacao$/, 'mesas.operar'],
  ['DELETE', /^\/api\/admin\/comandas\/\d+\/itens-pendentes$/, 'mesas.operar'],
  ['POST', /^\/api\/admin\/comandas\/\d+\/(?:cancelar|finalizar)$/, 'mesas.fechar'],

  ['POST', /^\/api\/admin\/categorias$/, 'produtos.editar'],
  ['PATCH', /^\/api\/admin\/categorias\/\d+\/status$/, 'produtos.editar'],
  ['PUT', /^\/api\/admin\/categorias\/\d+$/, 'produtos.editar'],
  ['POST', /^\/api\/admin\/produtos$/, 'produtos.editar'],
  ['PATCH', /^\/api\/admin\/produtos\/\d+\/status$/, 'produtos.editar'],
  ['PUT', /^\/api\/admin\/produtos\/\d+$/, 'produtos.editar'],
  ['DELETE', /^\/api\/admin\/produtos\/\d+$/, 'produtos.editar'],
  ['POST', /^\/api\/admin\/adicionais$/, 'produtos.editar'],
  ['PATCH', /^\/api\/admin\/adicionais\/\d+\/status$/, 'produtos.editar'],
  ['PUT', /^\/api\/admin\/adicionais\/\d+$/, 'produtos.editar'],
  ['DELETE', /^\/api\/admin\/adicionais\/\d+$/, 'produtos.editar'],
  ['POST', /^\/api\/admin\/promocoes$/, 'produtos.editar'],
  ['PUT', /^\/api\/admin\/promocoes\/\d+$/, 'produtos.editar'],
  ['DELETE', /^\/api\/admin\/promocoes\/\d+$/, 'produtos.editar'],

  ['POST', /^\/api\/admin\/funcionarios$/, 'funcionarios.gerenciar'],
  ['PATCH', /^\/api\/admin\/funcionarios\/\d+\/status$/, 'funcionarios.gerenciar'],
  ['PUT', /^\/api\/admin\/funcionarios\/\d+$/, 'funcionarios.gerenciar'],
  ['DELETE', /^\/api\/admin\/funcionarios\/\d+$/, 'funcionarios.gerenciar'],
  ['POST', /^\/api\/admin\/acesso-garcom$/, 'funcionarios.gerenciar'],
  ['POST', /^\/api\/admin\/administradores$/, 'funcionarios.gerenciar'],
  ['PATCH', /^\/api\/admin\/administradores\/\d+\/status$/, 'funcionarios.gerenciar'],
  ['PUT', /^\/api\/admin\/administradores\/\d+\/permissoes$/, 'funcionarios.gerenciar'],
  ['POST', /^\/api\/admin\/administradores\/\d+\/arquivar$/, 'funcionarios.gerenciar'],
  ['POST', /^\/api\/admin\/administradores\/\d+\/desarquivar$/, 'funcionarios.gerenciar'],
  ['DELETE', /^\/api\/admin\/administradores\/\d+$/, 'funcionarios.gerenciar']
];

/* Campos de PUT /api/admin/configuracao por permissão. Todo campo lido por
   salvarConfiguracao pertence a exatamente um grupo. */
export const CAMPOS_CONFIGURACAO_POR_PERMISSAO = Object.freeze({
  'personalizacao.editar': Object.freeze([
    'nomeLoja', 'logo', 'banner', 'bannerTitulo', 'bannerSubtitulo', 'bannerBotaoTexto',
    'bannerBotaoDestino', 'tituloCardapio', 'textoApresentacao', 'tituloSobre', 'textoSobre',
    'mensagemRodape'
  ]),
  'delivery.editar': Object.freeze([
    'entregaAtiva', 'retiradaAtiva', 'taxaEntrega', 'tempoEntrega'
  ]),
  'configuracoes.editar': Object.freeze([
    'telefone', 'email', 'endereco', 'whatsapp', 'instagramUrl', 'facebookUrl',
    'horarioFuncionamento', 'horarios', 'funcionamentoAutomatico', 'lojaAbertaManual',
    'atendimentoGarcomAtivo', 'pixChave', 'pixBeneficiario', 'pixCidade', 'aceitaCartao',
    'aceitaDinheiro', 'politicaCancelamento', 'informacoesLegais'
  ])
});

export const PERMISSOES_CONFIGURACAO = Object.freeze(Object.keys(CAMPOS_CONFIGURACAO_POR_PERMISSAO));

function erroSemPermissao() {
  const erro = new Error('Você não tem permissão para esta ação.');
  erro.status = 403;
  return erro;
}

/* `undefined` = rota administrativa não declarada; `null` = só autenticação. */
export function permissaoDaRotaAdmin(metodo, caminho) {
  const rota = ROTAS_ADMIN.find(([metodoRota, padrao]) => metodoRota === metodo && padrao.test(caminho));
  return rota ? rota[2] : undefined;
}

export function exigirPermissao(administrador, permissao) {
  if (permissao === null) return;
  if (!possuiPermissao(administrador?.permissoes, permissao)) throw erroSemPermissao();
}

export function exigirAlgumaPermissao(administrador, permissoes) {
  if (!permissoes.some((permissao) => possuiPermissao(administrador?.permissoes, permissao))) {
    throw erroSemPermissao();
  }
}

/*
  Monta o payload da configuração só com campos conhecidos. Grupo sem
  permissão recebe o valor já salvo, e o que veio do navegador para ele é
  ignorado.
*/
export function limitarConfiguracaoPorPermissao(anterior, dados, permissoes) {
  const recebidos = dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
  const resultado = {};
  for (const [permissao, campos] of Object.entries(CAMPOS_CONFIGURACAO_POR_PERMISSAO)) {
    const origem = possuiPermissao(permissoes, permissao) ? recebidos : anterior;
    for (const campo of campos) resultado[campo] = origem[campo];
  }
  return resultado;
}

export async function listarPermissoesAdministrador(banco, idEstabelecimento, administradorId) {
  const [linhas] = await banco.execute(`
    SELECT ap.permissao
    FROM administrador_permissoes ap
    INNER JOIN administradores a
      ON a.id = ap.administrador_id
      AND a.id_estabelecimento = ap.id_estabelecimento
    WHERE ap.id_estabelecimento = ? AND ap.administrador_id = ?
  `, [idEstabelecimento, administradorId]);
  return normalizarPermissoes(linhas.map((linha) => linha.permissao));
}

/* Conjunto padrão de um administrador recém-criado, na mesma transação. */
export async function concederPermissoesPadrao(conexao, idEstabelecimento, administradorId) {
  const tenantId = Number(idEstabelecimento);
  const adminId = Number(administradorId);
  if (!Number.isInteger(tenantId) || tenantId <= 0 || !Number.isInteger(adminId) || adminId <= 0) {
    throw new Error('Administrador ou estabelecimento inválido para conceder permissões.');
  }
  const marcadores = PERMISSOES_PADRAO_ADMINISTRADOR.map(() => '(?, ?, ?)').join(', ');
  await conexao.execute(`
    INSERT INTO administrador_permissoes (id_estabelecimento, administrador_id, permissao)
    VALUES ${marcadores}
    ON DUPLICATE KEY UPDATE permissao = VALUES(permissao)
  `, PERMISSOES_PADRAO_ADMINISTRADOR.flatMap((permissao) => [tenantId, adminId, permissao]));
}

export { CHAVES_PERMISSOES };
