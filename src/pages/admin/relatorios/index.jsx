import { Bike, DollarSign, Store, TrendingDown, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import styles from '../shared.module.css';

function moeda(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

/* Rótulo curto para caber acima das barras estreitas do gráfico mensal. */
function moedaCompacta(valor) {
  if (valor < 1000) return moeda(valor);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(valor);
}

/* Períodos disponíveis no gráfico de receita: sete dias ou doze meses. */
const PERIODOS = {
  semana: {
    rotulo: 'Semanal',
    titulo: 'Receita dos últimos 7 dias',
    total: 'Total dos 7 dias',
    media: 'Média diária',
    variacao: 'Variação sobre o dia anterior',
    melhor: 'Melhor dia',
    semDados: 'Sem dados neste dia'
  },
  mes: {
    rotulo: 'Mensal',
    titulo: 'Receita dos últimos 12 meses',
    total: 'Total dos 12 meses',
    media: 'Média mensal',
    variacao: 'Variação sobre o mês anterior',
    melhor: 'Melhor mês',
    semDados: 'Sem dados neste mês'
  }
};

function faixasDoPeriodo(periodo) {
  const agora = Date.now();
  const marcarAtual = (faixa) => ({
    ...faixa,
    atual: agora >= faixa.inicio.getTime() && agora < faixa.fim.getTime()
  });
  if (periodo === 'mes') {
    return Array.from({ length: 12 }, (_, indice) => {
      const inicio = new Date();
      inicio.setHours(0, 0, 0, 0);
      inicio.setDate(1);
      inicio.setMonth(inicio.getMonth() - (11 - indice));
      const fim = new Date(inicio);
      fim.setMonth(fim.getMonth() + 1);
      return marcarAtual({
        rotulo: inicio.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
        inicio,
        fim
      });
    });
  }
  return Array.from({ length: 7 }, (_, indice) => {
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    inicio.setDate(inicio.getDate() - (6 - indice));
    const fim = new Date(inicio);
    fim.setDate(fim.getDate() + 1);
    return marcarAtual({
      rotulo: inicio.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
      inicio,
      fim
    });
  });
}

function RelatoriosAdmin() {
  const { pedidos, funcionarios, administradores } = useApp();
  const [periodo, setPeriodo] = useState('semana');
  const pagos = pedidos.filter((pedido) => pedido.pagamentoStatus === 'Pago');
  const receitaConfirmada = pagos.reduce((total, pedido) => total + pedido.total, 0);
  const delivery = pagos.filter((pedido) => pedido.origem === 'Delivery');
  const salao = pagos.filter((pedido) => pedido.origem.startsWith('Mesa'));

  /* A API não expõe a data de criação do estabelecimento. O primeiro
    administrador é criado na mesma transação do estabelecimento, então o
    registro mais antigo já disponível no painel serve para separar "mês sem
    dados" de "mês sem pagamento confirmado". */
  const inicioAtividade = useMemo(() => {
    const datas = [...administradores, ...pedidos]
      .map((registro) => new Date(registro.criadoEm).getTime())
      .filter((tempo) => !Number.isNaN(tempo));
    return datas.length ? new Date(Math.min(...datas)) : null;
  }, [administradores, pedidos]);

  const serieGrafico = faixasDoPeriodo(periodo).map((faixa) => ({
    ...faixa,
    valor: pagos
      .filter((pedido) => {
        const data = new Date(pedido.criadoEm);
        return !Number.isNaN(data.getTime()) && data >= faixa.inicio && data < faixa.fim;
      })
      .reduce((total, pedido) => total + pedido.total, 0),
    semDados: Boolean(inicioAtividade) && faixa.fim <= inicioAtividade
  }));
  const maiorValorGrafico = Math.max(...serieGrafico.map((item) => item.valor), 1);

  const faixasAtivas = serieGrafico.filter((item) => !item.semDados);
  const totalPeriodo = serieGrafico.reduce((total, item) => total + item.valor, 0);
  const mediaPeriodo = faixasAtivas.length ? totalPeriodo / faixasAtivas.length : 0;
  const melhorFaixa = faixasAtivas.reduce(
    (melhor, item) => (melhor && melhor.valor >= item.valor ? melhor : item),
    null
  );
  const ultima = serieGrafico[serieGrafico.length - 1];
  const anterior = serieGrafico[serieGrafico.length - 2];
  const variacao = anterior && anterior.valor > 0 && ultima
    ? ((ultima.valor - anterior.valor) / anterior.valor) * 100
    : null;

  const ranking = pagos.flatMap((pedido) => pedido.itens).reduce((resultado, item) => {
    resultado[item.nome] = (resultado[item.nome] ?? 0) + item.quantidade;
    return resultado;
  }, {});

  return (
    <AdminLayout titulo="Relatórios" subtitulo="Indicadores de vendas, canais e desempenho da equipe.">
      <section className={`${styles.gradeMetricas} ${styles.gradeMetricasTres}`}>
        <div className={styles.metrica}><div className={styles.metricaIcone}><DollarSign size={23} /></div><div><span>Receita confirmada</span><strong>{moeda(receitaConfirmada)}</strong><small>Somente pagamentos marcados como pagos</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><Bike size={23} /></div><div><span>Delivery</span><strong>{delivery.length}</strong><small>{moeda(delivery.reduce((soma, pedido) => soma + pedido.total, 0))}</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><Store size={23} /></div><div><span>Salão</span><strong>{salao.length}</strong><small>{moeda(salao.reduce((soma, pedido) => soma + pedido.total, 0))}</small></div></div>
      </section>

      <div className={styles.gradeDuasColunas}>
        <section className={styles.card}>
          <div className={styles.topoCard}>
            <div><h2>{PERIODOS[periodo].titulo}</h2><p>Valores de pagamentos confirmados no banco.</p></div>
            <div className={styles.abas}>{Object.entries(PERIODOS).map(([chave, { rotulo }]) => <button type="button" key={chave} aria-pressed={periodo === chave} className={`${styles.aba} ${periodo === chave ? styles.abaAtiva : ''}`} onClick={() => setPeriodo(chave)}>{rotulo}</button>)}</div>
          </div>
          <div className={styles.resumoGrafico}>
            <div className={styles.resumoItem}><span>{PERIODOS[periodo].total}</span><strong>{moeda(totalPeriodo)}</strong><small>Pagamentos confirmados</small></div>
            <div className={styles.resumoItem}><span>{PERIODOS[periodo].media}</span><strong>{moeda(mediaPeriodo)}</strong><small>{faixasAtivas.length} {faixasAtivas.length === 1 ? 'período ativo' : 'períodos ativos'}</small></div>
            <div className={styles.resumoItem}>
              <span>{PERIODOS[periodo].variacao}</span>
              <strong className={variacao === null ? '' : (variacao < 0 ? styles.resumoQueda : styles.resumoAlta)}>
                {variacao === null ? '—' : <>{variacao < 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />}{`${variacao < 0 ? '' : '+'}${variacao.toFixed(1).replace('.', ',')}%`}</>}
              </strong>
              <small>{variacao === null ? 'Sem base de comparação' : `Antes: ${moeda(anterior.valor)}`}</small>
            </div>
            <div className={styles.resumoItem}><span>{PERIODOS[periodo].melhor}</span><strong>{melhorFaixa && melhorFaixa.valor > 0 ? melhorFaixa.rotulo : '—'}</strong><small>{melhorFaixa && melhorFaixa.valor > 0 ? moeda(melhorFaixa.valor) : 'Sem receita registrada'}</small></div>
          </div>
          <div className={styles.grafico}>{serieGrafico.map((item) => {
            const semPagamento = !item.semDados && item.valor === 0;
            const titulo = item.semDados
              ? PERIODOS[periodo].semDados
              : (semPagamento ? 'Nenhum pagamento confirmado' : moeda(item.valor));
            return (
              <div className={`${styles.barraGrupo} ${item.atual ? styles.barraGrupoAtual : ''}`} key={item.inicio.toISOString()} title={titulo}>
                <b className={styles.barraValor}>{item.semDados ? '—' : moedaCompacta(item.valor)}</b>
                <div
                  className={`${styles.barra} ${item.semDados ? styles.barraSemDados : ''} ${semPagamento ? styles.barraSemPagamento : ''}`}
                  style={{ height: item.valor > 0 ? `${Math.max(8, (item.valor / maiorValorGrafico) * 85)}%` : undefined }}
                />
                <span>{item.rotulo}</span>
              </div>
            );
          })}</div>
        </section>
        <section className={styles.card}>
          <div className={styles.topoCard}><div><h2>Mais vendidos</h2><p>Produtos por volume</p></div></div>
          <div className={styles.ranking}>{Object.entries(ranking).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nome, quantidade], indice) => <div className={styles.rankingItem} key={nome}><span>{indice + 1}</span><div><strong>{nome}</strong><small>Quantidade vendida</small></div><b>{quantidade}</b></div>)}{Object.keys(ranking).length === 0 && <div className={styles.vazio}><p>Sem vendas suficientes para formar o ranking.</p></div>}</div>
        </section>
      </div>

      <section className={`${styles.card} ${styles.secaoSeparada}`}>
        <div className={styles.topoCard}><div><h2>Desempenho dos garçons</h2><p>Comandas e vendas atribuídas a cada funcionário.</p></div></div>
        <div className={`${styles.tabelaContainer} ${styles.tabelaCartoes}`}><table className={styles.tabela} aria-label="Desempenho dos funcionários"><thead><tr><th>Funcionário</th><th>Cargo</th><th>Comandas fechadas</th><th>Vendas</th><th>Status</th></tr></thead><tbody>{funcionarios.map((funcionario) => <tr key={funcionario.id}><td data-rotulo="Funcionário"><strong>{funcionario.nome}</strong></td><td data-rotulo="Cargo">{funcionario.cargo}</td><td data-rotulo="Comandas fechadas">{funcionario.comandas}</td><td data-rotulo="Vendas">{funcionario.vendas}</td><td data-rotulo="Status"><span className={`${styles.status} ${funcionario.status === 'Ativo' ? styles.statusAtivo : styles.statusInativo}`}>{funcionario.status}</span></td></tr>)}</tbody></table>{funcionarios.length === 0 && <div className={styles.vazio}><p>Nenhum funcionário cadastrado para exibir.</p></div>}</div>
      </section>
    </AdminLayout>
  );
}

export default RelatoriosAdmin;
