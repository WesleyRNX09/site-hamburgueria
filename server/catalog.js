import { executarTransacao } from './database.js';

export function formatarPreco(centavos) {
  return (Number(centavos) / 100).toFixed(2).replace('.', ',');
}

export function precoParaCentavos(valor) {
  if (typeof valor === 'number') return Math.round(valor * 100);

  const texto = String(valor ?? '').trim().replace(/\s/g, '');
  if (!texto) return Number.NaN;

  const normalizado = texto.includes(',')
    ? texto.replace(/\./g, '').replace(',', '.')
    : texto;
  return Math.round(Number(normalizado) * 100);
}

/*
  Onde categoria e produto aparecem. O cardápio online e o salão dividem o
  mesmo catálogo, mas a loja física vende mais coisa: 'salao' guarda o que não
  deve chegar ao site, 'online' o contrário, e 'ambos' é o padrão de quem já
  existia antes desta separação.
*/
export const CANAIS_CATALOGO = ['ambos', 'online', 'salao'];

export function normalizarCanal(valor, padrao = 'ambos') {
  const canal = String(valor ?? '').trim().toLowerCase();
  return CANAIS_CATALOGO.includes(canal) ? canal : padrao;
}

/*
  Filtro de visibilidade de um canal. A regra vale para as duas pontas: um
  produto marcado 'ambos' dentro de uma categoria 'salao' continua fora do
  cardápio online, porque a categoria já o tirou de lá.
*/
export function filtroCanal(canal, { aliasProduto = null, aliasCategoria = 'c' } = {}) {
  if (!canal || canal === 'ambos') return { sql: '', parametros: [] };
  const condicoes = [];
  const parametros = [];
  if (aliasProduto) {
    condicoes.push(`${aliasProduto}.canal IN ('ambos', ?)`);
    parametros.push(canal);
  }
  if (aliasCategoria) {
    condicoes.push(`${aliasCategoria}.canal IN ('ambos', ?)`);
    parametros.push(canal);
  }
  return { sql: condicoes.map((condicao) => `AND ${condicao}`).join(' '), parametros };
}

function mapearCategoria(linha) {
  return {
    id: Number(linha.id),
    nome: linha.nome,
    canal: linha.canal,
    ordem: Number(linha.ordem),
    ativo: Boolean(linha.ativo)
  };
}

async function buscarCategoria(banco, idEstabelecimento, id) {
  const [linhas] = await banco.execute(`
    SELECT id, nome, canal, ordem, ativo
    FROM categorias
    WHERE id = ? AND id_estabelecimento = ?
  `, [id, idEstabelecimento]);
  return linhas[0] ? mapearCategoria(linhas[0]) : null;
}

function mapearAdicional(linha) {
  return {
    id: Number(linha.id),
    nome: linha.nome,
    preco: Number(linha.preco_centavos) / 100,
    ativo: Boolean(linha.ativo)
  };
}

function mapearProduto(linha, vinculos) {
  return {
    id: Number(linha.id),
    categoriaId: Number(linha.categoria_id),
    nome: linha.nome,
    categoria: linha.categoria,
    canal: linha.canal,
    descricao: linha.descricao,
    preco: formatarPreco(linha.preco_centavos),
    imagem: linha.imagem_url,
    adicionaisIds: vinculos.get(Number(linha.id)) ?? [],
    destaque: linha.destaque ?? '',
    ativo: Boolean(linha.ativo)
  };
}

async function buscarVinculos(banco, idEstabelecimento, produtosIds = []) {
  if (produtosIds.length === 0) return new Map();
  const marcadores = produtosIds.map(() => '?').join(', ');
  const [linhas] = await banco.execute(`
    SELECT produto_id, adicional_id
    FROM produto_adicionais
    WHERE id_estabelecimento = ? AND produto_id IN (${marcadores})
    ORDER BY adicional_id
  `, [idEstabelecimento, ...produtosIds]);
  const vinculos = new Map();
  for (const linha of linhas) {
    const produtoId = Number(linha.produto_id);
    if (!vinculos.has(produtoId)) vinculos.set(produtoId, []);
    vinculos.get(produtoId).push(Number(linha.adicional_id));
  }
  return vinculos;
}

const SELECT_PRODUTOS = `
  SELECT p.id, p.categoria_id, p.nome, p.descricao, p.preco_centavos,
         p.imagem_url, p.destaque, p.ativo, p.canal, c.nome AS categoria
  FROM produtos p
  INNER JOIN categorias c
    ON c.id = p.categoria_id AND c.id_estabelecimento = p.id_estabelecimento
`;

/*
  `canal` recorta o catálogo para quem vai consumi-lo: 'online' para o site,
  'salao' para o app do garçom, nada (ou 'ambos') para o painel, que precisa
  enxergar e administrar os dois cardápios.
*/
export async function listarCatalogo(
  banco,
  idEstabelecimento,
  { administrativo = false, canal = null } = {}
) {
  const canalCategoria = filtroCanal(canal, { aliasCategoria: 'categorias' });
  const canalProduto = filtroCanal(canal, { aliasProduto: 'p', aliasCategoria: 'c' });
  const [[categorias], [adicionais], [produtos]] = await Promise.all([
    banco.execute(`
      SELECT id, nome, canal, ordem, ativo
      FROM categorias
      WHERE id_estabelecimento = ? ${administrativo ? '' : 'AND ativo = 1'}
        ${canalCategoria.sql}
      ORDER BY ordem, nome
    `, [idEstabelecimento, ...canalCategoria.parametros]),
    banco.execute(`
      SELECT id, nome, preco_centavos, ativo
      FROM adicionais
      WHERE id_estabelecimento = ? ${administrativo ? '' : 'AND ativo = 1'}
      ORDER BY nome
    `, [idEstabelecimento]),
    banco.execute(`${SELECT_PRODUTOS}
      WHERE p.id_estabelecimento = ? ${administrativo ? '' : 'AND p.ativo = 1 AND c.ativo = 1'}
        ${canalProduto.sql}
      ORDER BY p.id
    `, [idEstabelecimento, ...canalProduto.parametros])
  ]);
  const vinculos = await buscarVinculos(banco, idEstabelecimento, produtos.map((produto) => Number(produto.id)));
  return {
    categorias: categorias.map(mapearCategoria),
    adicionais: adicionais.map(mapearAdicional),
    produtos: produtos.map((produto) => mapearProduto(produto, vinculos))
  };
}

function validarCategoria(dados) {
  const nome = String(dados?.nome ?? '').trim().slice(0, 100);
  const ordem = Number(dados?.ordem ?? 0);
  if (!nome) throw new Error('Informe o nome da categoria.');
  if (!Number.isInteger(ordem) || ordem < 0 || ordem > 9999) {
    throw new Error('Informe uma ordem entre 0 e 9999.');
  }
  return {
    nome,
    ordem,
    canal: normalizarCanal(dados?.canal),
    ativo: dados?.ativo === false ? 0 : 1
  };
}

export async function criarCategoria(banco, idEstabelecimento, dados) {
  const categoria = validarCategoria(dados);
  const [resultado] = await banco.execute(`
    INSERT INTO categorias (id_estabelecimento, nome, canal, ordem, ativo)
    VALUES (?, ?, ?, ?, ?)
  `, [idEstabelecimento, categoria.nome, categoria.canal, categoria.ordem, categoria.ativo]);
  return buscarCategoria(banco, idEstabelecimento, Number(resultado.insertId));
}

export async function atualizarCategoria(banco, idEstabelecimento, id, dados) {
  const categoria = validarCategoria(dados);
  const [resultado] = await banco.execute(`
    UPDATE categorias SET nome = ?, canal = ?, ordem = ?, ativo = ?
    WHERE id = ? AND id_estabelecimento = ?
  `, [categoria.nome, categoria.canal, categoria.ordem, categoria.ativo, id, idEstabelecimento]);
  if (!resultado.affectedRows) return null;
  return buscarCategoria(banco, idEstabelecimento, id);
}

export async function alternarStatusCategoria(banco, idEstabelecimento, id, ativo) {
  const [resultado] = await banco.execute(`
    UPDATE categorias SET ativo = ? WHERE id = ? AND id_estabelecimento = ?
  `, [ativo ? 1 : 0, id, idEstabelecimento]);
  if (!resultado.affectedRows) return null;
  return buscarCategoria(banco, idEstabelecimento, id);
}

export async function buscarProduto(banco, idEstabelecimento, id) {
  const [linhas] = await banco.execute(`
    ${SELECT_PRODUTOS}
    WHERE p.id = ? AND p.id_estabelecimento = ?
  `, [id, idEstabelecimento]);
  if (!linhas[0]) return null;
  const vinculos = await buscarVinculos(banco, idEstabelecimento, [Number(id)]);
  return mapearProduto(linhas[0], vinculos);
}

export async function buscarAdicional(banco, idEstabelecimento, id) {
  const [linhas] = await banco.execute(`
    SELECT id, nome, preco_centavos, ativo
    FROM adicionais
    WHERE id = ? AND id_estabelecimento = ?
  `, [id, idEstabelecimento]);
  return linhas[0] ? mapearAdicional(linhas[0]) : null;
}

async function obterCategoriaId(banco, idEstabelecimento, nome) {
  const [linhas] = await banco.execute(`
    SELECT id FROM categorias
    WHERE nome = ? AND ativo = 1 AND id_estabelecimento = ?
  `, [nome, idEstabelecimento]);
  return linhas[0] ? Number(linhas[0].id) : null;
}

async function validarProduto(banco, idEstabelecimento, dados) {
  const nome = String(dados.nome ?? '').trim();
  const descricao = String(dados.descricao ?? '').trim();
  const categoriaInformada = Number(dados.categoriaId);
  let categoriaId = Number.isInteger(categoriaInformada) && categoriaInformada > 0
    ? categoriaInformada
    : await obterCategoriaId(banco, idEstabelecimento, String(dados.categoria ?? '').trim());
  if (categoriaId) {
    const [categorias] = await banco.execute(`
      SELECT id FROM categorias
      WHERE id = ? AND ativo = 1 AND id_estabelecimento = ?
    `, [categoriaId, idEstabelecimento]);
    categoriaId = categorias[0] ? Number(categorias[0].id) : null;
  }
  const precoCentavos = precoParaCentavos(dados.preco);
  const adicionaisIds = [...new Set((dados.adicionaisIds ?? []).map(Number))]
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!nome || !descricao) throw new Error('Informe o nome e a descrição do produto.');
  if (!categoriaId) throw new Error('Selecione uma categoria válida.');
  if (!Number.isInteger(precoCentavos) || precoCentavos < 0) throw new Error('Informe um preço válido.');

  if (adicionaisIds.length > 0) {
    const marcadores = adicionaisIds.map(() => '?').join(', ');
    const [linhas] = await banco.execute(`
      SELECT COUNT(*) AS total FROM adicionais
      WHERE id_estabelecimento = ? AND id IN (${marcadores})
    `, [idEstabelecimento, ...adicionaisIds]);
    if (Number(linhas[0].total) !== adicionaisIds.length) throw new Error('Um ou mais adicionais não existem.');
  }

  return {
    nome,
    descricao,
    categoriaId,
    canal: normalizarCanal(dados.canal),
    precoCentavos,
    adicionaisIds,
    destaque: String(dados.destaque ?? '').trim() || null,
    ativo: dados.ativo === false ? 0 : 1
  };
}

async function salvarVinculos(conexao, idEstabelecimento, produtoId, adicionaisIds) {
  await conexao.execute(`
    DELETE FROM produto_adicionais
    WHERE produto_id = ? AND id_estabelecimento = ?
  `, [produtoId, idEstabelecimento]);
  for (const adicionalId of adicionaisIds) {
    await conexao.execute(`
      INSERT INTO produto_adicionais (id_estabelecimento, produto_id, adicional_id)
      VALUES (?, ?, ?)
    `, [idEstabelecimento, produtoId, adicionalId]);
  }
}

export async function criarProduto(banco, idEstabelecimento, dados, imagemUrl) {
  const produto = await validarProduto(banco, idEstabelecimento, dados);
  const id = await executarTransacao(banco, async (conexao) => {
    const [resultado] = await conexao.execute(`
      INSERT INTO produtos
        (id_estabelecimento, categoria_id, canal, nome, descricao, preco_centavos,
         imagem_url, destaque, ativo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      idEstabelecimento,
      produto.categoriaId,
      produto.canal,
      produto.nome,
      produto.descricao,
      produto.precoCentavos,
      imagemUrl,
      produto.destaque,
      produto.ativo
    ]);
    await salvarVinculos(conexao, idEstabelecimento, resultado.insertId, produto.adicionaisIds);
    return Number(resultado.insertId);
  });
  return buscarProduto(banco, idEstabelecimento, id);
}

export async function atualizarProduto(banco, idEstabelecimento, id, dados, imagemUrl) {
  if (!await buscarProduto(banco, idEstabelecimento, id)) return null;
  const produto = await validarProduto(banco, idEstabelecimento, dados);

  await executarTransacao(banco, async (conexao) => {
    await conexao.execute(`
      UPDATE produtos
      SET categoria_id = ?, canal = ?, nome = ?, descricao = ?, preco_centavos = ?,
          imagem_url = ?, destaque = ?, ativo = ?
      WHERE id = ? AND id_estabelecimento = ?
    `, [
      produto.categoriaId,
      produto.canal,
      produto.nome,
      produto.descricao,
      produto.precoCentavos,
      imagemUrl,
      produto.destaque,
      produto.ativo,
      id,
      idEstabelecimento
    ]);
    await salvarVinculos(conexao, idEstabelecimento, id, produto.adicionaisIds);
  });
  return buscarProduto(banco, idEstabelecimento, id);
}

export async function alternarStatusProduto(banco, idEstabelecimento, id, ativo) {
  const [resultado] = await banco.execute(`
    UPDATE produtos SET ativo = ? WHERE id = ? AND id_estabelecimento = ?
  `, [ativo ? 1 : 0, id, idEstabelecimento]);
  return resultado.affectedRows ? buscarProduto(banco, idEstabelecimento, id) : null;
}

export async function excluirProduto(banco, idEstabelecimento, id) {
  const [resultado] = await banco.execute(`
    DELETE FROM produtos WHERE id = ? AND id_estabelecimento = ?
  `, [id, idEstabelecimento]);
  return resultado.affectedRows > 0;
}

function validarAdicional(dados) {
  const nome = String(dados.nome ?? '').trim();
  const precoCentavos = precoParaCentavos(dados.preco);
  if (!nome) throw new Error('Informe o nome do adicional.');
  if (!Number.isInteger(precoCentavos) || precoCentavos < 0) throw new Error('Informe um preço válido.');
  return { nome, precoCentavos, ativo: dados.ativo === false ? 0 : 1 };
}

export async function criarAdicional(banco, idEstabelecimento, dados) {
  const adicional = validarAdicional(dados);
  const [resultado] = await banco.execute(`
    INSERT INTO adicionais (id_estabelecimento, nome, preco_centavos, ativo)
    VALUES (?, ?, ?, ?)
  `, [idEstabelecimento, adicional.nome, adicional.precoCentavos, adicional.ativo]);
  return buscarAdicional(banco, idEstabelecimento, Number(resultado.insertId));
}

export async function atualizarAdicional(banco, idEstabelecimento, id, dados) {
  const adicional = validarAdicional(dados);
  const [resultado] = await banco.execute(`
    UPDATE adicionais SET nome = ?, preco_centavos = ?, ativo = ?
    WHERE id = ? AND id_estabelecimento = ?
  `, [adicional.nome, adicional.precoCentavos, adicional.ativo, id, idEstabelecimento]);
  return resultado.affectedRows ? buscarAdicional(banco, idEstabelecimento, id) : null;
}

export async function alternarStatusAdicional(banco, idEstabelecimento, id, ativo) {
  const [resultado] = await banco.execute(`
    UPDATE adicionais SET ativo = ? WHERE id = ? AND id_estabelecimento = ?
  `, [ativo ? 1 : 0, id, idEstabelecimento]);
  return resultado.affectedRows ? buscarAdicional(banco, idEstabelecimento, id) : null;
}

export async function excluirAdicional(banco, idEstabelecimento, id) {
  const [resultado] = await banco.execute(`
    DELETE FROM adicionais WHERE id = ? AND id_estabelecimento = ?
  `, [id, idEstabelecimento]);
  return resultado.affectedRows > 0;
}
