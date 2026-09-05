/*
  Completa a grade de mesas de um estabelecimento até o total informado.

  Somente INSERT, através de `criarMesa` — a mesma função validada usada
  pelo painel (número entre 1 e 999, normalizado com dois dígitos). Nunca
  apaga, altera ou desativa mesa existente.

  Uso (o script carrega o arquivo de ambiente sozinho, sem flag):
    node scripts/completar-mesas.js
      → apenas lista os estabelecimentos e quantas mesas cada um tem.

    node scripts/completar-mesas.js <id> [total]
      → cria as mesas que faltam nesse estabelecimento (total padrão: 50).
*/

import process from 'node:process';

// Carrega as variaveis do projeto sem depender da flag de linha de
// comando, do mesmo modo que os scripts npm fazem. Os segredos ficam
// no processo: este script imprime apenas host, porta e nome do banco.
try {
  process.loadEnvFile();
} catch {
  // Sem arquivo de ambiente: segue com as variaveis ja exportadas.
}

const { config } = await import('../server/config.js');
const { abrirBanco, fecharBanco } = await import('../server/database.js');
const { criarMesa, listarMesas } = await import('../server/operations.js');

const idEstabelecimento = process.argv[2] ? Number(process.argv[2]) : null;
const totalDesejado = process.argv[3] ? Number(process.argv[3]) : 50;

if (idEstabelecimento !== null && (!Number.isInteger(idEstabelecimento) || idEstabelecimento < 1)) {
  console.error('Informe um id de estabelecimento válido.');
  process.exit(1);
}

if (!Number.isInteger(totalDesejado) || totalDesejado < 1 || totalDesejado > 999) {
  console.error('O total de mesas precisa estar entre 1 e 999.');
  process.exit(1);
}

let banco;
try {
  banco = await abrirBanco({ mysql: config.mysql });
  console.log(`Banco: ${config.mysql.database} em ${config.mysql.host}:${config.mysql.port}`);

  const [estabelecimentos] = await banco.execute(`
    SELECT e.id_estabelecimento AS id, e.nome_fantasia AS nome, COUNT(m.id) AS mesas
    FROM estabelecimentos e
    LEFT JOIN mesas m
      ON m.id_estabelecimento = e.id_estabelecimento
      AND m.ativo = 1
    GROUP BY e.id_estabelecimento, e.nome_fantasia
    ORDER BY e.id_estabelecimento
  `);

  if (idEstabelecimento === null) {
    console.log('\nEstabelecimentos e mesas ativas:');
    for (const linha of estabelecimentos) {
      console.log(`  [${linha.id}] ${linha.nome} — ${linha.mesas} mesas`);
    }
    console.log('\nPara completar, rode novamente informando o id. Exemplo:');
    console.log(`  node scripts/completar-mesas.js ${estabelecimentos[0]?.id ?? 1} ${totalDesejado}`);
  } else {
    const alvo = estabelecimentos.find((linha) => Number(linha.id) === idEstabelecimento);
    if (!alvo) throw new Error(`Estabelecimento ${idEstabelecimento} não encontrado.`);

    const mesas = await listarMesas(banco, idEstabelecimento);
    const existentes = new Set(mesas.map((mesa) => Number(mesa.numero)));
    const faltando = [];
    for (let numero = 1; numero <= totalDesejado; numero += 1) {
      if (!existentes.has(numero)) faltando.push(numero);
    }

    if (faltando.length === 0) {
      console.log(`\n[${alvo.id}] ${alvo.nome} já tem as ${totalDesejado} mesas. Nada a fazer.`);
    } else {
      console.log(`\n[${alvo.id}] ${alvo.nome}: criando ${faltando.length} mesas (${faltando[0]}…${faltando[faltando.length - 1]}).`);
      for (const numero of faltando) {
        await criarMesa(banco, idEstabelecimento, { numero: String(numero) });
      }
      const finais = await listarMesas(banco, idEstabelecimento);
      console.log(`Concluído: ${finais.length} mesas ativas.`);
    }
  }
} catch (erro) {
  console.error(`Falhou: ${erro.message}`);
  process.exitCode = 1;
} finally {
  if (banco) await fecharBanco(banco);
}
