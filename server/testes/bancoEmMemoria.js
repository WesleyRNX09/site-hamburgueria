/*
  Banco em memória para os testes de exportação e exclusão definitiva.

  Colunas e chaves estrangeiras vêm do próprio database/CRIAR_db.sql, então a
  ordem de remoção é conferida contra o esquema real, não contra a lista do
  código: DELETE que deixaria filho órfão numa FK RESTRICT falha como no MySQL
  (ER_ROW_IS_REFERENCED_2), CASCADE apaga e SET NULL zera. Transação guarda uma
  cópia no BEGIN e volta a ela no ROLLBACK.

  Só entende as consultas usadas pela exportação, pela exclusão e pelo login
  do superadmin; qualquer outra derruba o teste.
*/
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { criarHashSenha } from '../security.js';

const pastaProjeto = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function lerEsquema() {
  const sql = readFileSync(resolve(pastaProjeto, 'database/CRIAR_db.sql'), 'utf8').replace(/\r\n/g, '\n');
  const colunas = new Map();
  for (const [, tabela, corpo] of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\) ENGINE/g)) {
    colunas.set(tabela, corpo.split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => /^[a-z_]+ [A-Z]/.test(linha) && !/^(UNIQUE|INDEX|CONSTRAINT|PRIMARY|KEY|CHECK)\b/i.test(linha))
      .map((linha) => linha.split(' ')[0]));
  }
  const chaves = [];
  for (const [, tabela, corpo] of sql.matchAll(/ALTER TABLE (\w+)\s+([\s\S]*?);/g)) {
    for (const [, origem, pai, destino, regra] of corpo.matchAll(
      /FOREIGN KEY \(([^)]+)\)\s*REFERENCES (\w+)\(([^)]+)\)(?:\s+ON DELETE (SET NULL|CASCADE|RESTRICT))?/g
    )) {
      chaves.push({
        filho: tabela,
        colunas: origem.split(',').map((item) => item.trim()),
        pai,
        colunasPai: destino.split(',').map((item) => item.trim()),
        regra: regra ?? 'RESTRICT'
      });
    }
  }
  return { colunas, chaves };
}

function erroRestrict(filho) {
  const erro = new Error(`Cannot delete or update a parent row: a foreign key constraint fails (${filho})`);
  erro.code = 'ER_ROW_IS_REFERENCED_2';
  return erro;
}

export function criarBancoEmMemoria() {
  const esquema = lerEsquema();
  let tabelas = new Map([...esquema.colunas.keys()].map((nome) => [nome, []]));
  const consultas = [];
  let copia = null;
  let proximoId = 100000;
  let falharEm = null;

  function linhaCompleta(tabela, dados) {
    const colunas = esquema.colunas.get(tabela);
    if (!colunas) throw new Error(`Tabela desconhecida no teste: ${tabela}`);
    for (const chave of Object.keys(dados)) {
      if (!colunas.includes(chave)) throw new Error(`Coluna ${tabela}.${chave} não existe no esquema.`);
    }
    return Object.fromEntries(colunas.map((coluna) => [coluna, dados[coluna] ?? null]));
  }

  function inserir(tabela, dados) {
    const linha = linhaCompleta(tabela, dados);
    tabelas.get(tabela).push(linha);
    return linha;
  }

  function projetar(linha, lista) {
    return Object.fromEntries(lista.map((coluna) => {
      if (!(coluna in linha)) throw new Error(`Coluna inexistente consultada: ${coluna}`);
      return [coluna, linha[coluna]];
    }));
  }

  /* Remove linhas e aplica as regras de ON DELETE de quem aponta para elas. */
  function apagar(tabela, filtro) {
    const todas = tabelas.get(tabela);
    const removidas = todas.filter(filtro);
    if (!removidas.length) return 0;
    tabelas.set(tabela, todas.filter((linha) => !removidas.includes(linha)));
    for (const chave of esquema.chaves.filter((item) => item.pai === tabela)) {
      const aponta = (filho) => removidas.some((pai) => chave.colunas.every(
        (coluna, indice) => filho[coluna] != null && filho[coluna] === pai[chave.colunasPai[indice]]
      ));
      const afetados = tabelas.get(chave.filho).filter(aponta);
      if (!afetados.length) continue;
      if (chave.regra === 'RESTRICT') throw erroRestrict(`${chave.filho}.${chave.colunas.join(',')}`);
      if (chave.regra === 'CASCADE') apagar(chave.filho, (linha) => afetados.includes(linha));
      if (chave.regra === 'SET NULL') {
        for (const linha of afetados) for (const coluna of chave.colunas) linha[coluna] = null;
      }
    }
    return removidas.length;
  }

  function responder(sql, parametros = []) {
    consultas.push({ sql, parametros });
    if (falharEm && falharEm(sql)) throw new Error('Falha simulada no teste.');

    // Login e sessão do superadmin.
    if (sql.includes('FROM superadministradores') && sql.includes('senha_hash')) {
      return [[{ id: 1, nome: 'Super', usuario: 'super', email: 'super@teste.local', senha_hash: criarHashSenha('senha-global-segura') }]];
    }
    if (sql.includes('INSERT INTO sessoes_superadmin') || sql.includes('DELETE FROM sessoes_superadmin')) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM sessoes_superadmin ss')) {
      return [[{ id: 1, nome: 'Super', usuario: 'super', email: 'super@teste.local' }]];
    }

    const contagem = sql.match(
      /SELECT COUNT\(f\.(\w+)\) AS total\s+FROM (\w+) f\s+INNER JOIN (\w+) p ON p\.id = f\.\1\s+WHERE p\.id_estabelecimento = \?\s+AND \(f\.id_estabelecimento IS NULL OR f\.id_estabelecimento <> \?\)/
    );
    if (contagem) {
      const [, coluna, filho, pai] = contagem;
      const idsPai = new Set(tabelas.get(pai).filter((linha) => linha.id_estabelecimento === parametros[0]).map((linha) => linha.id));
      const total = tabelas.get(filho).filter((linha) => idsPai.has(linha[coluna])
        && (linha.id_estabelecimento == null || linha.id_estabelecimento !== parametros[1])).length;
      return [[{ total }]];
    }

    const selecao = sql.match(/^\s*SELECT ([\s\S]+?)\s+FROM (\w+)\s+WHERE id_estabelecimento = \?(\s+FOR UPDATE)?\s*$/);
    if (selecao) {
      const lista = selecao[1].split(',').map((item) => item.trim());
      return [tabelas.get(selecao[2])
        .filter((linha) => linha.id_estabelecimento === parametros[0])
        .map((linha) => projetar(linha, lista))];
    }

    const remocaoEstabelecimento = sql.match(
      /^\s*DELETE FROM estabelecimentos\s+WHERE id_estabelecimento = \? AND status = 'arquivado'\s*$/
    );
    if (remocaoEstabelecimento) {
      return [{ affectedRows: apagar('estabelecimentos', (linha) => linha.id_estabelecimento === parametros[0]
        && linha.status === 'arquivado') }];
    }
    const remocao = sql.match(/^\s*DELETE FROM (\w+) WHERE id_estabelecimento = \?\s*$/);
    if (remocao) {
      return [{ affectedRows: apagar(remocao[1], (linha) => linha.id_estabelecimento === parametros[0]) }];
    }

    if (sql.includes('INSERT INTO auditoria_superadmin')) {
      const [superadministradorId, idEstabelecimento, acao, detalhes] = parametros;
      if (idEstabelecimento != null
          && !tabelas.get('estabelecimentos').some((linha) => linha.id_estabelecimento === idEstabelecimento)) {
        const erro = new Error('Cannot add or update a child row'); erro.code = 'ER_NO_REFERENCED_ROW_2'; throw erro;
      }
      inserir('auditoria_superadmin', {
        id: proximoId++, superadministrador_id: superadministradorId, id_estabelecimento: idEstabelecimento,
        acao, detalhes_json: JSON.parse(detalhes), criado_em: new Date()
      });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Consulta inesperada no teste: ${sql}`);
  }

  const conexao = {
    async beginTransaction() { copia = structuredClone(tabelas); },
    async commit() { copia = null; },
    async rollback() { if (copia) tabelas = copia; copia = null; },
    release() {},
    async execute(sql, parametros) { return responder(sql, parametros); }
  };

  return {
    esquema,
    consultas,
    inserir,
    tabela: (nome) => tabelas.get(nome),
    linhasDaLoja: (idEstabelecimento) => Object.fromEntries([...tabelas.entries()]
      .map(([nome, linhas]) => [nome, linhas.filter((linha) => linha.id_estabelecimento === idEstabelecimento)])),
    fotografia: () => structuredClone(tabelas),
    falharQuando(condicao) { falharEm = condicao; },
    banco: {
      async getConnection() { return conexao; },
      async execute(sql, parametros) { return responder(sql, parametros); },
      async query(sql, parametros) { return responder(sql, parametros); }
    }
  };
}

/*
  Uma loja completa: uma linha em cada tabela do tenant, todas ligadas entre
  si (pedido com item, adicional, pagamento e impressão; comanda com item; etc.).
  `base` separa os ids de cada loja.
*/
export function semearLoja(memoria, { id, nome, slug, status = 'ativo', arquivadoEm = null, base }) {
  const n = (deslocamento) => base + deslocamento;
  const agora = new Date('2026-06-01T12:00:00.000Z');
  memoria.inserir('estabelecimentos', {
    id_estabelecimento: id, nome_fantasia: nome, slug, status, arquivado_em: arquivadoEm,
    token_acesso_garcom: `token-garcom-${slug}`, plano: 'basico', status_assinatura: 'ativa',
    criado_em: agora, atualizado_em: agora, suspenso_em: status === 'ativo' ? null : agora,
    motivo_suspensao: status === 'ativo' ? null : 'Encerramento'
  });
  memoria.inserir('configuracoes_estabelecimento', {
    id_estabelecimento: id, cor_principal: '#FFC107', logo_url: `/uploads/estabelecimentos/${id}/logo-${slug}.png`,
    pix_chave: `pix-${slug}`, criado_em: agora, atualizado_em: agora
  });
  memoria.inserir('administradores', {
    id: n(1), id_estabelecimento: id, usuario: `admin-${slug}`, email: `admin@${slug}.local`, nome: 'Admin',
    senha_hash: `scrypt:hash-secreto-${slug}`, trocar_senha_em_proximo_acesso: 0, ativo: 1, criado_em: agora
  });
  memoria.inserir('administrador_permissoes', { id_estabelecimento: id, administrador_id: n(1), permissao: 'pedidos.visualizar' });
  memoria.inserir('sessoes_admin', { token_hash: `sessao-admin-${slug}`, id_estabelecimento: id, administrador_id: n(1), expira_em: agora });
  memoria.inserir('auditoria_admin', { id: n(2), id_estabelecimento: id, administrador_id: n(1), acao: 'administrador.login', entidade: 'administrador', criado_em: agora });
  memoria.inserir('impressoras', { id: n(3), id_estabelecimento: id, nome: 'Cozinha', host: '10.0.0.5', porta: 9100, ativa: 1, eh_caixa: 0 });
  memoria.inserir('dispositivos_impressao', { id: n(4), id_estabelecimento: id, nome: 'Balcão', token_hash: `token-dispositivo-${slug}` });
  memoria.inserir('categorias', { id: n(5), id_estabelecimento: id, nome: 'Lanches', canal: 'ambos', impressora_id: n(3), ordem: 1, ativo: 1 });
  memoria.inserir('adicionais', { id: n(6), id_estabelecimento: id, nome: 'Bacon', preco_centavos: 400, ativo: 1 });
  memoria.inserir('produtos', {
    id: n(7), id_estabelecimento: id, categoria_id: n(5), canal: 'ambos', impressora_id: n(3), nome: 'X-Burger',
    descricao: 'Pão e carne', preco_centavos: 2490, ativo: 1
  });
  memoria.inserir('produto_adicionais', { id_estabelecimento: id, produto_id: n(7), adicional_id: n(6) });
  memoria.inserir('promocoes', { id: n(8), id_estabelecimento: id, produto_id: n(7), nome: 'Promo', preco_centavos: 1990, ativo: 1 });
  memoria.inserir('funcionarios', {
    id: n(9), id_estabelecimento: id, nome: 'Garçom', usuario: `garcom-${slug}`, pin_hash: `scrypt:pin-${slug}`,
    senha_busca: `busca-${slug}`, token_acesso: `token-antigo-${slug}`, ativo: 1
  });
  memoria.inserir('sessoes_garcom', { token_hash: `sessao-garcom-${slug}`, id_estabelecimento: id, funcionario_id: n(9), expira_em: agora });
  memoria.inserir('mesas', { id: n(10), id_estabelecimento: id, numero: 1, lugares: 4, ativo: 1 });
  memoria.inserir('comandas', {
    id: n(11), id_estabelecimento: id, mesa_id: n(10), funcionario_id: n(9), aberta_por_admin_id: n(1), status: 'Encerrada'
  });
  memoria.inserir('comanda_itens', {
    id: n(12), id_estabelecimento: id, comanda_id: n(11), produto_id: n(7), nome_produto: 'X-Burger',
    preco_unitario_centavos: 2490, quantidade: 1, enviado_por_funcionario_id: n(9), enviado_por_admin_id: n(1)
  });
  memoria.inserir('comanda_item_adicionais', { id_estabelecimento: id, comanda_item_id: n(12), adicional_id: n(6), nome_adicional: 'Bacon', preco_centavos: 400 });
  memoria.inserir('areas_entrega', { id: n(13), id_estabelecimento: id, nome: 'Centro', taxa_entrega_centavos: 500, tempo_estimado_min: 30, tempo_estimado_max: 45, ativo: 1 });
  memoria.inserir('pedidos', {
    id: n(14), id_estabelecimento: id, token_acompanhamento_hash: `acompanhamento-${slug}`,
    chave_idempotencia_hash: `idempotencia-${slug}`, origem: 'delivery', cliente: 'Cliente', status: 'Entregue',
    area_entrega_id: n(13), comanda_id: n(11), mesa_id: n(10), funcionario_id: n(9), total_centavos: 2990
  });
  memoria.inserir('pedido_itens', {
    id: n(15), id_estabelecimento: id, pedido_id: n(14), produto_id: n(7), promocao_id: n(8), nome_produto: 'X-Burger',
    preco_unitario_centavos: 2490, quantidade: 1
  });
  memoria.inserir('pedido_item_adicionais', { id_estabelecimento: id, pedido_item_id: n(15), adicional_id: n(6), nome_adicional: 'Bacon', preco_centavos: 400 });
  memoria.inserir('pagamentos', {
    id: n(16), id_estabelecimento: id, pedido_id: n(14), comanda_id: n(11), forma: 'Pix', status: 'Pago',
    valor_centavos: 2990, confirmado_por: n(1), estornado_por: n(1)
  });
  memoria.inserir('trabalhos_impressao', {
    id: n(17), id_estabelecimento: id, impressora_id: n(3), origem: 'delivery', pedido_id: n(14), comanda_id: n(11),
    conteudo_json: { linhas: ['X-Burger'] }, status: 'impresso'
  });
  memoria.inserir('auditoria_superadmin', {
    id: n(18), superadministrador_id: 1, id_estabelecimento: id, acao: 'estabelecimento.criado',
    detalhes_json: { slug }, criado_em: agora
  });
}
