import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { executarTransacao } from './database.js';
import { pastaUploadsEstabelecimento } from './imageStore.js';
import { registrarErro } from './logger.js';
import { registrarAuditoria } from './superadmin.js';
import { criarZip } from './zip.js';

/*
  Exportação e exclusão definitiva de um estabelecimento ARQUIVADO.

  É a ação mais perigosa do sistema, então toda dúvida vira recusa:
  - só estabelecimento com status 'arquivado' há pelo menos 60 dias;
  - o superadmin digita o nome fantasia exato;
  - a linha do estabelecimento fica travada (FOR UPDATE) do começo ao fim;
  - a exportação é montada ANTES de qualquer DELETE, e qualquer falha nela
    derruba a transação sem apagar nada;
  - uma linha de outra loja apontando para dado desta loja cancela tudo;
  - os arquivos só saem do disco depois do commit.
*/

export const DIAS_PARA_EXCLUSAO = 60;
const DIA_MS = 24 * 60 * 60 * 1000;

/*
  Tabelas com id_estabelecimento, NA ORDEM DE REMOÇÃO: cada tabela vem antes de
  todas as tabelas para as quais ela aponta, e `estabelecimentos` fica fora da
  lista porque sai por último, sozinha. A remoção é sempre explícita, por
  id_estabelecimento, sem contar com CASCADE ou SET NULL.

  `colunas` é o que vai para a exportação, citado coluna a coluna. Ficam de
  fora senha, hash de senha e token (`colunasOcultas`), e as tabelas de sessão
  inteiras (colunas: null), que só guardam token.
*/
export const TABELAS_DO_ESTABELECIMENTO = Object.freeze([
  {
    tabela: 'trabalhos_impressao',
    colunas: ['id', 'id_estabelecimento', 'impressora_id', 'origem', 'pedido_id', 'comanda_id',
      'conteudo_json', 'status', 'tentativas', 'criado_em', 'impresso_em']
  },
  {
    tabela: 'pagamentos',
    colunas: ['id', 'id_estabelecimento', 'pedido_id', 'comanda_id', 'forma', 'status', 'valor_centavos',
      'valor_recebido_centavos', 'troco_centavos', 'provedor', 'referencia_externa', 'pix_chave',
      'pix_beneficiario', 'sem_troco', 'troco_para_centavos', 'pix_copia_cola', 'pago_em',
      'confirmado_por', 'confirmado_em', 'estornado_por', 'estornado_em', 'criado_em']
  },
  {
    tabela: 'pedido_item_adicionais',
    colunas: ['id_estabelecimento', 'pedido_item_id', 'adicional_id', 'nome_adicional', 'preco_centavos']
  },
  {
    tabela: 'pedido_itens',
    colunas: ['id', 'id_estabelecimento', 'pedido_id', 'produto_id', 'promocao_id', 'nome_produto',
      'descricao_produto', 'imagem_url', 'preco_unitario_centavos', 'quantidade', 'observacao']
  },
  {
    tabela: 'pedidos',
    colunas: ['id', 'id_estabelecimento', 'origem', 'cliente', 'telefone', 'email', 'status', 'pagamento',
      'rua', 'numero', 'bairro', 'area_entrega_id', 'complemento', 'referencia', 'taxa_entrega_centavos',
      'total_centavos', 'comanda_id', 'mesa_id', 'funcionario_id', 'criado_em', 'atualizado_em'],
    colunasOcultas: ['token_acompanhamento_hash', 'chave_idempotencia_hash']
  },
  {
    tabela: 'comanda_item_adicionais',
    colunas: ['id_estabelecimento', 'comanda_item_id', 'adicional_id', 'nome_adicional', 'preco_centavos']
  },
  {
    tabela: 'comanda_itens',
    colunas: ['id', 'id_estabelecimento', 'comanda_id', 'produto_id', 'nome_produto', 'preco_unitario_centavos',
      'quantidade', 'observacao', 'criado_em', 'enviado_em', 'impresso_em', 'enviado_por_funcionario_id',
      'enviado_por_admin_id']
  },
  {
    tabela: 'comandas',
    colunas: ['id', 'id_estabelecimento', 'mesa_id', 'funcionario_id', 'aberta_por_admin_id', 'status',
      'pagamento', 'observacao', 'aberta_em', 'encerrada_em', 'atualizado_em']
  },
  { tabela: 'mesas', colunas: ['id', 'id_estabelecimento', 'numero', 'lugares', 'ativo', 'criado_em'] },
  {
    tabela: 'areas_entrega',
    colunas: ['id', 'id_estabelecimento', 'nome', 'taxa_entrega_centavos', 'tempo_estimado_min',
      'tempo_estimado_max', 'ativo', 'criado_em', 'atualizado_em']
  },
  {
    tabela: 'promocoes',
    colunas: ['id', 'id_estabelecimento', 'produto_id', 'nome', 'categoria', 'descricao',
      'preco_anterior_centavos', 'preco_centavos', 'imagem_url', 'destaque', 'tipo', 'ativo', 'inicio_em',
      'fim_em', 'criado_em', 'atualizado_em']
  },
  { tabela: 'produto_adicionais', colunas: ['id_estabelecimento', 'produto_id', 'adicional_id'] },
  {
    tabela: 'produtos',
    colunas: ['id', 'id_estabelecimento', 'categoria_id', 'canal', 'impressora_id', 'nome', 'descricao',
      'preco_centavos', 'imagem_url', 'destaque', 'ativo', 'criado_em', 'atualizado_em']
  },
  { tabela: 'categorias', colunas: ['id', 'id_estabelecimento', 'nome', 'canal', 'impressora_id', 'ordem', 'ativo'] },
  {
    tabela: 'adicionais',
    colunas: ['id', 'id_estabelecimento', 'nome', 'preco_centavos', 'ativo', 'criado_em', 'atualizado_em']
  },
  {
    tabela: 'dispositivos_impressao',
    colunas: ['id', 'id_estabelecimento', 'nome', 'criado_em', 'ultimo_contato_em', 'revogado_em'],
    colunasOcultas: ['token_hash']
  },
  {
    tabela: 'impressoras',
    colunas: ['id', 'id_estabelecimento', 'nome', 'host', 'porta', 'ativa', 'eh_caixa', 'criado_em', 'atualizado_em']
  },
  { tabela: 'sessoes_garcom', colunas: null },
  {
    tabela: 'funcionarios',
    colunas: ['id', 'id_estabelecimento', 'nome', 'cargo', 'usuario', 'senha_definida_em', 'ativo', 'criado_em',
      'atualizado_em'],
    colunasOcultas: ['pin_hash', 'senha_busca', 'token_acesso']
  },
  { tabela: 'sessoes_admin', colunas: null },
  { tabela: 'administrador_permissoes', colunas: ['id_estabelecimento', 'administrador_id', 'permissao', 'criado_em'] },
  // RESTRICT para estabelecimentos: o histórico do painel da loja NÃO sobrevive
  // à exclusão. Vai inteiro na exportação.
  {
    tabela: 'auditoria_admin',
    colunas: ['id', 'id_estabelecimento', 'administrador_id', 'acao', 'entidade', 'entidade_id', 'detalhes_json',
      'criado_em']
  },
  {
    tabela: 'administradores',
    colunas: ['id', 'id_estabelecimento', 'usuario', 'email', 'nome', 'trocar_senha_em_proximo_acesso', 'ativo',
      'arquivado_em', 'criado_em', 'atualizado_em'],
    colunasOcultas: ['senha_hash']
  },
  {
    tabela: 'configuracoes_estabelecimento',
    colunas: ['id_estabelecimento', 'logo_url', 'banner_url', 'banner_titulo', 'banner_subtitulo',
      'banner_botao_texto', 'banner_botao_destino', 'titulo_cardapio', 'texto_apresentacao', 'titulo_sobre',
      'texto_sobre', 'mensagem_rodape', 'cor_principal', 'cor_secundaria', 'cor_fundo', 'cor_card', 'cor_texto',
      'fonte', 'telefone', 'whatsapp', 'email', 'endereco', 'horario_funcionamento', 'horarios_json',
      'funcionamento_automatico', 'instagram_url', 'facebook_url', 'loja_aberta', 'pedido_minimo_centavos',
      'taxa_entrega_centavos', 'tempo_entrega', 'pix_chave', 'pix_beneficiario', 'pix_cidade', 'entrega_ativa',
      'retirada_ativa', 'atendimento_garcom_ativo', 'aceita_cartao', 'aceita_dinheiro', 'areas_entrega_json',
      'formas_pagamento_json', 'politica_cancelamento', 'informacoes_legais', 'criado_em', 'atualizado_em']
  },
  {
    tabela: 'configuracoes',
    colunas: ['id', 'id_estabelecimento', 'nome_loja', 'telefone', 'email', 'endereco', 'taxa_entrega_centavos',
      'tempo_entrega', 'pedido_minimo_centavos', 'loja_aberta', 'pix_chave', 'pix_beneficiario', 'pix_cidade',
      'logo_url', 'whatsapp', 'horario_funcionamento', 'instagram_url', 'facebook_url', 'entrega_ativa',
      'retirada_ativa', 'aceita_cartao', 'aceita_dinheiro', 'areas_entrega_json', 'atualizado_em']
  }
]);

const COLUNAS_ESTABELECIMENTO = Object.freeze(['id_estabelecimento', 'nome_fantasia', 'slug',
  'dominio_personalizado', 'status', 'suspenso_em', 'motivo_suspensao', 'arquivado_em', 'arquivado_por', 'plano',
  'status_assinatura', 'vencimento_assinatura_em', 'criado_em', 'atualizado_em']);
export const COLUNAS_OCULTAS_ESTABELECIMENTO = Object.freeze(['token_acesso_garcom']);

/*
  Referências entre tabelas do tenant que NÃO carregam o id_estabelecimento na
  chave estrangeira (apontam só para o id global do pai). Com dado íntegro,
  filho e pai são sempre da mesma loja. Se alguma linha de outra loja (ou sem
  loja) apontar para dado desta, apagar esta loja mexeria nela — via SET NULL,
  CASCADE ou erro de RESTRICT —, então a exclusão é recusada antes de começar.
*/
export const REFERENCIAS_SEM_TENANT = Object.freeze([
  ['produtos', 'categoria_id', 'categorias'],
  ['categorias', 'impressora_id', 'impressoras'],
  ['produtos', 'impressora_id', 'impressoras'],
  ['produto_adicionais', 'produto_id', 'produtos'],
  ['produto_adicionais', 'adicional_id', 'adicionais'],
  ['promocoes', 'produto_id', 'produtos'],
  ['sessoes_garcom', 'funcionario_id', 'funcionarios'],
  ['administrador_permissoes', 'administrador_id', 'administradores'],
  ['sessoes_admin', 'administrador_id', 'administradores'],
  ['auditoria_admin', 'administrador_id', 'administradores'],
  ['comandas', 'mesa_id', 'mesas'],
  ['comandas', 'funcionario_id', 'funcionarios'],
  ['comandas', 'aberta_por_admin_id', 'administradores'],
  ['comanda_itens', 'comanda_id', 'comandas'],
  ['comanda_itens', 'enviado_por_funcionario_id', 'funcionarios'],
  ['comanda_itens', 'enviado_por_admin_id', 'administradores'],
  ['comanda_itens', 'produto_id', 'produtos'],
  ['comanda_item_adicionais', 'comanda_item_id', 'comanda_itens'],
  ['comanda_item_adicionais', 'adicional_id', 'adicionais'],
  ['pedidos', 'comanda_id', 'comandas'],
  ['pedidos', 'mesa_id', 'mesas'],
  ['pedidos', 'funcionario_id', 'funcionarios'],
  ['pedido_itens', 'pedido_id', 'pedidos'],
  ['pedido_itens', 'produto_id', 'produtos'],
  ['pedido_itens', 'promocao_id', 'promocoes'],
  ['pedido_item_adicionais', 'pedido_item_id', 'pedido_itens'],
  ['pedido_item_adicionais', 'adicional_id', 'adicionais'],
  ['pagamentos', 'pedido_id', 'pedidos'],
  ['pagamentos', 'comanda_id', 'comandas'],
  ['pagamentos', 'confirmado_por', 'administradores'],
  ['pagamentos', 'estornado_por', 'administradores'],
  ['trabalhos_impressao', 'pedido_id', 'pedidos'],
  ['trabalhos_impressao', 'comanda_id', 'comandas']
]);

function erroDominio(mensagem, status = 400) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

function idValido(valor) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function travarEstabelecimento(conexao, idEstabelecimento) {
  const [linhas] = await conexao.execute(`
    SELECT ${COLUNAS_ESTABELECIMENTO.join(', ')}
    FROM estabelecimentos
    WHERE id_estabelecimento = ?
    FOR UPDATE
  `, [idEstabelecimento]);
  return linhas[0] ?? null;
}

function exigirArquivado(estabelecimento, acao) {
  if (String(estabelecimento.status) !== 'arquivado') {
    throw erroDominio(`Só estabelecimento arquivado pode ser ${acao}. Arquive a loja antes.`, 409);
  }
}

/* Dias que ainda faltam para a exclusão ficar liberada; 0 quando já pode. */
export function diasParaLiberarExclusao(arquivadoEm, agora = new Date()) {
  const arquivado = arquivadoEm ? new Date(arquivadoEm) : null;
  if (!arquivado || Number.isNaN(arquivado.getTime())) return null;
  const liberadoEm = arquivado.getTime() + (DIAS_PARA_EXCLUSAO * DIA_MS);
  const restante = liberadoEm - agora.getTime();
  return restante > 0 ? Math.ceil(restante / DIA_MS) : 0;
}

/*
  Pasta de uploads da loja, só se for um diretório comum dentro da raiz de
  uploads. Link simbólico, subpasta ou qualquer coisa que a exportação não
  copiaria faz a operação parar: nada que não foi exportado é apagado.
*/
async function lerUploadsDoEstabelecimento(pastaUploads, idEstabelecimento) {
  const raiz = resolve(pastaUploads, 'estabelecimentos');
  const pasta = resolve(pastaUploadsEstabelecimento(pastaUploads, idEstabelecimento));
  const caminhoRelativo = relative(raiz, pasta);
  if (!caminhoRelativo || caminhoRelativo.startsWith('..') || isAbsolute(caminhoRelativo)) {
    throw new Error('A pasta de uploads do estabelecimento está fora da raiz de uploads.');
  }
  let informacoes;
  try {
    informacoes = await lstat(pasta);
  } catch (erro) {
    if (erro.code === 'ENOENT') return { pasta, arquivos: [] };
    throw erro;
  }
  if (!informacoes.isDirectory()) {
    throw erroDominio('A pasta de uploads do estabelecimento não é um diretório comum. Revise o disco manualmente.', 409);
  }
  const entradas = await readdir(pasta, { withFileTypes: true });
  const estranhas = entradas.filter((entrada) => !entrada.isFile());
  if (estranhas.length) {
    throw erroDominio(
      'A pasta de uploads do estabelecimento tem subpastas ou links que a exportação não copia. Revise o disco manualmente.',
      409
    );
  }
  const arquivos = [];
  for (const entrada of entradas.sort((a, b) => a.name.localeCompare(b.name))) {
    const conteudo = await readFile(join(pasta, entrada.name));
    arquivos.push({ nome: entrada.name, conteudo });
  }
  return { pasta, arquivos };
}

async function verificarReferenciasCruzadas(conexao, idEstabelecimento) {
  const encontradas = [];
  for (const [filho, coluna, pai] of REFERENCIAS_SEM_TENANT) {
    const [linhas] = await conexao.execute(`
      SELECT COUNT(f.${coluna}) AS total
      FROM ${filho} f
      INNER JOIN ${pai} p ON p.id = f.${coluna}
      WHERE p.id_estabelecimento = ?
        AND (f.id_estabelecimento IS NULL OR f.id_estabelecimento <> ?)
    `, [idEstabelecimento, idEstabelecimento]);
    const total = Number(linhas[0]?.total ?? 0);
    if (total > 0) encontradas.push(`${filho}.${coluna} → ${pai} (${total})`);
  }
  if (encontradas.length) {
    throw erroDominio(
      `Exclusão recusada: há registros de outra loja (ou sem loja) apontando para dados deste estabelecimento: ${encontradas.join('; ')}. Corrija os dados antes.`,
      409
    );
  }
}

function carimboArquivo(data) {
  return data.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
}

/*
  Monta o .zip com dados.json (todas as linhas da loja, sem senha nem token) e
  a cópia de uploads/estabelecimentos/{id}/. Só lê: nada é gravado nem apagado.
*/
async function montarExportacao(conexao, estabelecimento, pastaUploads, agora) {
  const idEstabelecimento = Number(estabelecimento.id_estabelecimento);
  const tabelas = {};
  const linhasPorTabela = {};
  for (const { tabela, colunas } of TABELAS_DO_ESTABELECIMENTO) {
    if (!colunas) continue;
    const [linhas] = await conexao.execute(`
      SELECT ${colunas.join(', ')}
      FROM ${tabela}
      WHERE id_estabelecimento = ?
    `, [idEstabelecimento]);
    tabelas[tabela] = linhas;
    linhasPorTabela[tabela] = linhas.length;
  }
  // Fica no banco depois da exclusão (com id_estabelecimento NULL); vai aqui
  // para a exportação ter a história completa da loja.
  const [auditoriaGlobal] = await conexao.execute(`
    SELECT id, superadministrador_id, id_estabelecimento, acao, detalhes_json, criado_em
    FROM auditoria_superadmin
    WHERE id_estabelecimento = ?
  `, [idEstabelecimento]);
  tabelas.auditoria_superadmin = auditoriaGlobal;
  linhasPorTabela.auditoria_superadmin = auditoriaGlobal.length;

  const { arquivos } = await lerUploadsDoEstabelecimento(pastaUploads, idEstabelecimento);
  const dados = {
    formato: 'exportacao-estabelecimento',
    versao: 1,
    geradoEm: agora.toISOString(),
    estabelecimento: Object.fromEntries(COLUNAS_ESTABELECIMENTO.map((coluna) => [coluna, estabelecimento[coluna] ?? null])),
    observacao: 'Sem senhas, hashes de senha nem tokens de acesso. Sessões não são exportadas.',
    linhasPorTabela,
    tabelas,
    uploads: arquivos.map(({ nome, conteudo }) => ({
      arquivo: `uploads/${nome}`,
      bytes: conteudo.length,
      sha256: createHash('sha256').update(conteudo).digest('hex')
    }))
  };
  const zip = criarZip([
    { nome: 'dados.json', conteudo: JSON.stringify(dados, null, 2) },
    ...arquivos.map(({ nome, conteudo }) => ({ nome: `uploads/${nome}`, conteudo }))
  ], { data: agora });
  const slug = String(estabelecimento.slug).replace(/[^a-z0-9-]/g, '') || 'loja';
  return {
    zip,
    nomeArquivo: `exportacao-${slug}-${idEstabelecimento}-${carimboArquivo(agora)}.zip`,
    resumo: {
      linhasPorTabela,
      arquivos: arquivos.length,
      bytes: zip.length
    }
  };
}

/*
  Exportação a qualquer momento enquanto a loja estiver arquivada. Não apaga
  nada; só registra o acesso na auditoria do superadmin.
*/
export async function exportarEstabelecimentoArquivado(
  banco,
  id,
  superadministradorId,
  { pastaUploads, agora = new Date() }
) {
  const idEstabelecimento = idValido(id);
  if (!idEstabelecimento) return null;
  return executarTransacao(banco, async (conexao) => {
    const estabelecimento = await travarEstabelecimento(conexao, idEstabelecimento);
    if (!estabelecimento) return null;
    exigirArquivado(estabelecimento, 'exportado');
    const exportacao = await montarExportacao(conexao, estabelecimento, pastaUploads, agora);
    await registrarAuditoria(conexao, superadministradorId, idEstabelecimento, 'estabelecimento.exportado', {
      arquivo: exportacao.nomeArquivo,
      arquivos: exportacao.resumo.arquivos,
      bytes: exportacao.resumo.bytes
    });
    return exportacao;
  });
}

async function removerPastaUploads(pasta) {
  await rm(pasta, { recursive: true, force: true });
}

/*
  Exclusão definitiva. Ordem, sem exceção:
    1. trava a linha e valida: arquivado, 60 dias, nome digitado exato;
    2. recusa se outra loja aponta para dados desta;
    3. monta a exportação completa (falhou → nada é apagado);
    4. apaga as tabelas dependentes na ordem de TABELAS_DO_ESTABELECIMENTO;
    5. grava estabelecimento.excluido na auditoria do superadmin, com os
       detalhes em JSON (o id_estabelecimento dela vira NULL no passo 6);
    6. apaga a linha de estabelecimentos e confirma a transação;
    7. só então remove a pasta de uploads — se falhar, o banco já está limpo e
       a sobra no disco fica registrada como pendência manual.
*/
export async function excluirEstabelecimentoDefinitivamente(
  banco,
  id,
  dados,
  superadministradorId,
  { pastaUploads, agora = new Date() }
) {
  const idEstabelecimento = idValido(id);
  if (!idEstabelecimento) return null;
  const confirmacaoNome = typeof dados?.confirmacaoNome === 'string' ? dados.confirmacaoNome.trim() : '';
  if (!confirmacaoNome) throw erroDominio('Digite o nome completo do estabelecimento para confirmar a exclusão.');

  const resultado = await executarTransacao(banco, async (conexao) => {
    const estabelecimento = await travarEstabelecimento(conexao, idEstabelecimento);
    if (!estabelecimento) return null;
    exigirArquivado(estabelecimento, 'excluído definitivamente');
    const diasRestantes = diasParaLiberarExclusao(estabelecimento.arquivado_em, agora);
    if (diasRestantes === null) {
      throw erroDominio('O estabelecimento não tem data de arquivamento registrada. Desarquive e arquive de novo.', 409);
    }
    if (diasRestantes > 0) {
      throw erroDominio(
        `A exclusão definitiva só é liberada ${DIAS_PARA_EXCLUSAO} dias depois do arquivamento. Faltam ${diasRestantes} dia(s).`,
        409
      );
    }
    // Exato, sensível a maiúsculas e minúsculas: o slug, ou o nome com outra
    // grafia, não confirma.
    if (confirmacaoNome !== estabelecimento.nome_fantasia) {
      throw erroDominio('O nome digitado não confere com o nome do estabelecimento.');
    }

    await verificarReferenciasCruzadas(conexao, idEstabelecimento);
    const exportacao = await montarExportacao(conexao, estabelecimento, pastaUploads, agora);

    const linhasRemovidas = {};
    for (const { tabela } of TABELAS_DO_ESTABELECIMENTO) {
      const [resultadoDelete] = await conexao.execute(
        `DELETE FROM ${tabela} WHERE id_estabelecimento = ?`,
        [idEstabelecimento]
      );
      linhasRemovidas[tabela] = Number(resultadoDelete?.affectedRows ?? 0);
    }
    linhasRemovidas.estabelecimentos = 1;

    await registrarAuditoria(conexao, superadministradorId, idEstabelecimento, 'estabelecimento.excluido', {
      idEstabelecimento,
      nomeFantasia: estabelecimento.nome_fantasia,
      slug: estabelecimento.slug,
      excluidoPor: Number(superadministradorId),
      arquivadoEm: new Date(estabelecimento.arquivado_em).toISOString(),
      linhasRemovidas,
      exportacao: {
        arquivo: exportacao.nomeArquivo,
        arquivos: exportacao.resumo.arquivos,
        bytes: exportacao.resumo.bytes
      }
    });

    const [remocao] = await conexao.execute(`
      DELETE FROM estabelecimentos
      WHERE id_estabelecimento = ? AND status = 'arquivado'
    `, [idEstabelecimento]);
    if (Number(remocao?.affectedRows ?? 0) !== 1) {
      throw new Error('A linha do estabelecimento não foi removida; a exclusão foi desfeita.');
    }
    return { exportacao, slug: estabelecimento.slug };
  });
  if (!resultado) return null;

  let limpezaPendente = false;
  const pasta = pastaUploadsEstabelecimento(pastaUploads, idEstabelecimento);
  try {
    await removerPastaUploads(pasta);
  } catch (erro) {
    limpezaPendente = true;
    registrarErro(erro, {
      operacao: 'estabelecimento.excluido.limpeza_uploads',
      idEstabelecimento,
      pasta
    });
  }
  return { ...resultado.exportacao, limpezaPendente };
}
