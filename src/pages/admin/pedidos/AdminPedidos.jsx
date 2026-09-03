import { Bike, ChefHat, Eye, Search, ShoppingBag, Store } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import styles from '../shared.module.css';

const filtrosStatus = ['Todos', 'Recebido', 'Em preparo', 'Pronto', 'Saiu para entrega', 'Entregue', 'Retirado', 'Cancelado'];

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

function AdminPedidos() {
  const { pedidos, pedidosNovos } = useApp();
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');
  const [origem, setOrigem] = useState('Todos');
  const [status, setStatus] = useState('Todos');

  const termo = busca.trim().toLowerCase();
  const filtrados = pedidos.filter((pedido) => {
    const correspondeBusca = !termo || [pedido.id, pedido.cliente, pedido.origem, ...pedido.itens.map((item) => item.nome)]
      .join(' ')
      .toLowerCase()
      .includes(termo);
    const correspondeOrigem = origem === 'Todos'
      || (origem === 'Delivery' && pedido.origem === 'Delivery')
      || (origem === 'Retirada' && pedido.origem === 'Retirada no balcão')
      || (origem === 'Salão' && pedido.origem.startsWith('Mesa'));
    const correspondeStatus = status === 'Todos'
      || pedido.status === status
      || (status === 'Entregue' && pedido.status === 'Entregue na mesa');
    return correspondeBusca && correspondeOrigem && correspondeStatus;
  });

  const delivery = pedidos.filter((pedido) => pedido.origem === 'Delivery').length;
  const salao = pedidos.length - delivery;
  const preparo = pedidos.filter((pedido) => pedido.status === 'Em preparo').length;

  return (
    <AdminLayout titulo="Gerenciar pedidos" subtitulo="Acompanhe pedidos de delivery e do salão em um só lugar.">
      <section className={styles.gradeMetricas}>
        <div className={styles.metrica}><div className={styles.metricaIcone}><ShoppingBag size={23} /></div><div><span>Total de pedidos</span><strong>{pedidos.length}</strong><small>Pedidos registrados</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><ChefHat size={23} /></div><div><span>Em preparo</span><strong>{preparo}</strong><small>Aguardando finalização</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><Bike size={23} /></div><div><span>Delivery</span><strong>{delivery}</strong><small>Pedidos para entrega</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><Store size={23} /></div><div><span>Salão</span><strong>{salao}</strong><small>Atendimento em mesas</small></div></div>
      </section>

      <section className={styles.card}>
        <div className={styles.filtros}>
          <label className={styles.busca}>
            <Search size={17} />
            <input aria-label="Buscar pedidos" value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar pedido, cliente ou item..." />
          </label>
          <div className={styles.abas}>
            {['Todos', 'Delivery', 'Retirada', 'Salão'].map((item) => (
              <button type="button" key={item} aria-pressed={origem === item} className={`${styles.aba} ${origem === item ? styles.abaAtiva : ''}`} onClick={() => setOrigem(item)}>{item}</button>
            ))}
          </div>
        </div>
        <div className={styles.filtros}>
          <div className={styles.abas}>
            {filtrosStatus.map((item) => (
              <button type="button" key={item} aria-pressed={status === item} className={`${styles.aba} ${status === item ? styles.abaAtiva : ''}`} onClick={() => setStatus(item)}>{item}</button>
            ))}
          </div>
        </div>

        <div className={`${styles.tabelaContainer} ${styles.tabelaCartoes}`}>
          <table className={styles.tabela} aria-label="Lista de pedidos">
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Origem</th><th>Itens</th><th>Pagamento</th><th>Status</th><th>Horário</th><th>Total</th><th>Ações</th></tr></thead>
            <tbody>
              {filtrados.map((pedido) => (
                <tr key={pedido.id} className={pedidosNovos.includes(pedido.id) ? styles.pedidoNovo : ''}>
                  <td data-rotulo="Pedido"><strong>{pedido.id}</strong></td>
                  <td data-rotulo="Cliente"><strong>{pedido.cliente}</strong><span className={styles.textoSecundario}>{pedido.telefone}</span></td>
                  <td data-rotulo="Origem">{pedido.origem}</td>
                  <td data-rotulo="Itens"><strong>{pedido.itens.length} {pedido.itens.length === 1 ? 'item' : 'itens'}</strong><span className={styles.textoSecundario}>{pedido.itens.map((item) => item.nome).join(', ')}</span></td>
                  <td data-rotulo="Pagamento"><strong>{pedido.pagamento}</strong><span className={styles.textoSecundario}>{pedido.pagamentoStatus}</span></td>
                  <td data-rotulo="Status"><span className={`${styles.status} ${classeStatus(pedido.status)}`}>{pedido.status}</span></td>
                  <td data-rotulo="Horário">{pedido.horario}</td>
                  <td data-rotulo="Total"><strong>{moeda(pedido.total)}</strong></td>
                  <td data-rotulo="Ações"><button type="button" className={styles.botaoIcone} aria-label={`Visualizar ${pedido.id}`} onClick={() => navigate(`/admin/pedidos/${pedido.id.replace('#', '')}`)}><Eye size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtrados.length === 0 && <div className={styles.vazio}><ShoppingBag size={34} /><h3>Nenhum pedido encontrado</h3><p>Ajuste os filtros para visualizar outros pedidos.</p></div>}
        </div>
      </section>
    </AdminLayout>
  );
}

export default AdminPedidos;
