import {
  Bike,
  ChefHat,
  DollarSign,
  Eye,
  ShoppingBag,
  Store
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import styles from '../shared.module.css';

function moeda(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

function classeStatus(status) {
  if (status === 'Recebido') return styles.statusRecebido;
  if (['Em preparo', 'Pronto'].includes(status)) return styles.statusPreparo;
  if (status === 'Saiu para entrega') return styles.statusEntrega;
  if (['Entregue', 'Entregue na mesa', 'Retirado'].includes(status)) return styles.statusConcluido;
  if (status === 'Cancelado') return styles.statusCancelado;
  return '';
}

function AdminDashboard() {
  const { pedidos, produtos, pedidosNovos } = useApp();
  const navigate = useNavigate();

  const pedidosValidos = pedidos.filter((pedido) => pedido.status !== 'Cancelado');
  const pedidosPagos = pedidos.filter((pedido) => pedido.pagamentoStatus === 'Pago');
  const receitaConfirmada = pedidosPagos.reduce((total, pedido) => total + pedido.total, 0);
  const emPreparo = pedidos.filter((pedido) => pedido.status === 'Em preparo').length;
  const pedidosSalao = pedidos.filter((pedido) => pedido.origem.startsWith('Mesa')).length;
  const pedidosDelivery = pedidos.filter((pedido) => pedido.origem === 'Delivery').length;

  const vendasPorProduto = pedidosPagos
    .flatMap((pedido) => pedido.itens)
    .reduce((resultado, item) => {
      const atual = resultado[item.nome] ?? { nome: item.nome, quantidade: 0, total: 0 };
      atual.quantidade += item.quantidade;
      atual.total += Number(item.preco) * item.quantidade;
      resultado[item.nome] = atual;
      return resultado;
    }, {});

  const ranking = Object.values(vendasPorProduto)
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, 5);

  return (
    <AdminLayout titulo="Dashboard ADM" subtitulo="Visão operacional dos registros mais recentes carregados pelo sistema.">
      <section className={styles.gradeMetricas}>
        <div className={styles.metrica}><div className={styles.metricaIcone}><ShoppingBag size={23} /></div><div><span>Pedidos carregados</span><strong>{pedidos.length}</strong><small>Até 500 registros recentes</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><DollarSign size={24} /></div><div><span>Receita confirmada</span><strong>{moeda(receitaConfirmada)}</strong><small>Somente pagamentos marcados como pagos</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><ChefHat size={23} /></div><div><span>Em preparo</span><strong>{emPreparo}</strong><small>Aguardando finalização</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><Store size={23} /></div><div><span>Pedidos do salão</span><strong>{pedidosSalao}</strong><small>Atendimento nas mesas</small></div></div>
      </section>

      <section className={styles.card}>
        <div className={styles.topoCard}><div><h2>Visão geral dos registros</h2><p>Resumo da janela de dados carregada</p></div></div>
        <div className={styles.gradeMetricas}>
          <div className={styles.metrica}><div className={styles.metricaIcone}><Bike size={22} /></div><div><span>Delivery</span><strong>{pedidosDelivery}</strong><small>Pedidos para entrega</small></div></div>
          <div className={styles.metrica}><div className={styles.metricaIcone}><Store size={22} /></div><div><span>Salão</span><strong>{pedidosSalao}</strong><small>Pedidos presenciais</small></div></div>
          <div className={styles.metrica}><div className={styles.metricaIcone}><ShoppingBag size={22} /></div><div><span>Produtos ativos</span><strong>{produtos.filter((produto) => produto.ativo).length}</strong><small>Disponíveis no cardápio</small></div></div>
          <div className={styles.metrica}><div className={styles.metricaIcone}><ChefHat size={22} /></div><div><span>Cancelados</span><strong>{pedidos.length - pedidosValidos.length}</strong><small>Requerem acompanhamento</small></div></div>
        </div>
      </section>

      <div className={`${styles.gradeDuasColunas} ${styles.secaoSeparada}`}>
        <section className={styles.card}>
          <div className={styles.topoCard}>
            <div><h2>Pedidos recentes</h2><p>Últimas entradas no sistema</p></div>
            <button type="button" className={styles.botaoSecundario} onClick={() => navigate('/admin/pedidos')}>Ver todos</button>
          </div>
          <div className={`${styles.tabelaContainer} ${styles.tabelaCartoes}`}>
            <table className={styles.tabela} aria-label="Pedidos recentes">
              <thead><tr><th>Pedido</th><th>Origem</th><th>Status</th><th>Total</th><th>Ação</th></tr></thead>
              <tbody>
                {pedidos.slice(0, 5).map((pedido) => (
                  <tr key={pedido.id} className={pedidosNovos.includes(pedido.id) ? styles.pedidoNovo : ''}>
                    <td data-rotulo="Pedido"><strong>{pedido.id}</strong><span className={styles.textoSecundario}>{pedido.cliente}</span></td>
                    <td data-rotulo="Origem">{pedido.origem}</td>
                    <td data-rotulo="Status"><span className={`${styles.status} ${classeStatus(pedido.status)}`}>{pedido.status}</span></td>
                    <td data-rotulo="Total"><strong>{moeda(pedido.total)}</strong></td>
                    <td data-rotulo="Ação"><button type="button" className={styles.botaoIcone} aria-label={`Ver ${pedido.id}`} onClick={() => navigate(`/admin/pedidos/${pedido.id.replace('#', '')}`)}><Eye size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pedidos.length === 0 && <div className={styles.vazio}><ShoppingBag size={32} /><h3>Nenhum pedido registrado</h3><p>Os novos pedidos aparecerão aqui.</p></div>}
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.topoCard}><div><h2>Produtos mais vendidos</h2><p>Ranking dos pedidos com pagamento confirmado</p></div></div>
          <div className={styles.ranking}>
            {ranking.map((item, indice) => (
              <div className={styles.rankingItem} key={item.nome}>
                <span>{indice + 1}</span>
                <div><strong>{item.nome}</strong><small>{item.quantidade} vendas</small></div>
                <b>{moeda(item.total)}</b>
              </div>
            ))}
            {ranking.length === 0 && <div className={styles.vazio}><p>O ranking será exibido após as primeiras vendas.</p></div>}
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}

export default AdminDashboard;
