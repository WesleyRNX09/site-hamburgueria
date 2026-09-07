import {
  Bike,
  ClipboardList,
  DollarSign,
  Eye,
  ShoppingBag
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import styles from '../shared.module.css';

// Delivery encerrado não entra na contagem de pedidos em andamento.
const STATUS_DELIVERY_ENCERRADO = ['Entregue', 'Cancelado'];

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
  const { pedidos, comandas, pedidosNovos } = useApp();
  const navigate = useNavigate();

  const receitaConfirmada = pedidos
    .filter((pedido) => pedido.pagamentoStatus === 'Pago')
    .reduce((total, pedido) => total + pedido.total, 0);
  // A API já devolve apenas as comandas do estabelecimento autenticado que continuam abertas.
  const comandasAbertas = comandas.length;
  const deliveryEmAndamento = pedidos.filter(
    (pedido) => pedido.origem === 'Delivery' && !STATUS_DELIVERY_ENCERRADO.includes(pedido.status)
  ).length;

  return (
    <AdminLayout titulo="Dashboard ADM" subtitulo="Visão operacional dos registros mais recentes carregados pelo sistema.">
      <section className={`${styles.gradeMetricas} ${styles.gradeMetricasTres}`}>
        <div className={styles.metrica}><div className={styles.metricaIcone}><DollarSign size={24} /></div><div><span>Receita confirmada</span><strong>{moeda(receitaConfirmada)}</strong><small>Somente pagamentos marcados como pagos</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><ClipboardList size={23} /></div><div><span>Comandas abertas</span><strong>{comandasAbertas}</strong><small>Mesas em atendimento no momento</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><Bike size={23} /></div><div><span>Pedidos do delivery</span><strong>{deliveryEmAndamento}</strong><small>Entregas em andamento</small></div></div>
      </section>

      <section className={`${styles.card} ${styles.secaoSeparada}`}>
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
    </AdminLayout>
  );
}

export default AdminDashboard;
