import { Bike, DollarSign, ReceiptText, Store } from 'lucide-react';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import styles from '../shared.module.css';

function moeda(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

function RelatoriosAdmin() {
  const { pedidos, funcionarios } = useApp();
  const pagos = pedidos.filter((pedido) => pedido.pagamentoStatus === 'Pago');
  const receitaConfirmada = pagos.reduce((total, pedido) => total + pedido.total, 0);
  const ticketMedio = pagos.length ? receitaConfirmada / pagos.length : 0;
  const delivery = pagos.filter((pedido) => pedido.origem === 'Delivery');
  const salao = pagos.filter((pedido) => pedido.origem.startsWith('Mesa'));
  const dias = Array.from({ length: 7 }, (_, indice) => {
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    inicio.setDate(inicio.getDate() - (6 - indice));
    const fim = new Date(inicio);
    fim.setDate(fim.getDate() + 1);
    return {
      rotulo: inicio.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
      inicio,
      fim
    };
  });
  const valoresGrafico = dias.map(({ inicio, fim }) => pagos
    .filter((pedido) => {
      const data = new Date(pedido.criadoEm);
      return !Number.isNaN(data.getTime()) && data >= inicio && data < fim;
    })
    .reduce((total, pedido) => total + pedido.total, 0));
  const maiorValorGrafico = Math.max(...valoresGrafico, 1);

  const ranking = pagos.flatMap((pedido) => pedido.itens).reduce((resultado, item) => {
    resultado[item.nome] = (resultado[item.nome] ?? 0) + item.quantidade;
    return resultado;
  }, {});

  return (
    <AdminLayout titulo="Relatórios" subtitulo="Indicadores de vendas, canais e desempenho da equipe.">
      <section className={styles.gradeMetricas}>
        <div className={styles.metrica}><div className={styles.metricaIcone}><DollarSign size={23} /></div><div><span>Receita confirmada</span><strong>{moeda(receitaConfirmada)}</strong><small>Somente pagamentos marcados como pagos</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><ReceiptText size={23} /></div><div><span>Ticket médio pago</span><strong>{moeda(ticketMedio)}</strong><small>Valor médio dos pagamentos confirmados</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><Bike size={23} /></div><div><span>Delivery</span><strong>{delivery.length}</strong><small>{moeda(delivery.reduce((soma, pedido) => soma + pedido.total, 0))}</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><Store size={23} /></div><div><span>Salão</span><strong>{salao.length}</strong><small>{moeda(salao.reduce((soma, pedido) => soma + pedido.total, 0))}</small></div></div>
      </section>

      <div className={styles.gradeDuasColunas}>
        <section className={styles.card}>
          <div className={styles.topoCard}><div><h2>Receita dos últimos 7 dias</h2><p>Valores de pagamentos confirmados no banco.</p></div></div>
          <div className={styles.grafico}>{valoresGrafico.map((valor, indice) => <div className={styles.barraGrupo} key={dias[indice].inicio.toISOString()} title={moeda(valor)}><div className={styles.barra} style={{ height: valor > 0 ? `${Math.max(8, (valor / maiorValorGrafico) * 100)}%` : '0%' }} /><span>{dias[indice].rotulo}</span></div>)}</div>
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
