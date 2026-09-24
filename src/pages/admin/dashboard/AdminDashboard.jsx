import { useEffect, useState } from 'react';
import {
  Bike,
  ClipboardList,
  DollarSign,
  Eye,
  LayoutDashboard,
  Receipt,
  ShoppingBag,
  Trophy
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import { buscarIndicadoresDashboardApi } from '../../../services/api';
import styles from '../shared.module.css';
import estilos from './AdminDashboard.module.css';

// Delivery encerrado não entra na contagem de pedidos em andamento.
const STATUS_DELIVERY_ENCERRADO = ['Entregue', 'Cancelado'];

// Período dos indicadores novos. Os cards que já existiam não usam o seletor.
const PERIODOS = [
  { valor: 'hoje', rotulo: 'Hoje', descricao: 'hoje' },
  { valor: '7dias', rotulo: '7 dias', descricao: 'nos últimos 7 dias' },
  { valor: '30dias', rotulo: '30 dias', descricao: 'nos últimos 30 dias' },
  { valor: 'mes', rotulo: 'Este mês', descricao: 'neste mês' }
];

function moeda(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

function quantidadePedidos(quantidade) {
  return `${quantidade.toLocaleString('pt-BR')} ${quantidade === 1 ? 'pedido' : 'pedidos'}`;
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
  const { pedidos, comandas, pedidosNovos, temPermissao } = useApp();
  const navigate = useNavigate();
  const [periodo, setPeriodo] = useState('30dias');
  const [tentativa, setTentativa] = useState(0);
  const [indicadores, setIndicadores] = useState(null);
  // Cada bloco aparece só para quem tem a permissão dos dados que ele mostra.
  const podeVerFinanceiro = temPermissao('relatorios.visualizar');
  const podeVerPedidos = temPermissao('pedidos.visualizar');
  const podeVerSalao = temPermissao('mesas.operar', 'mesas.fechar', 'mesas.cadastrar');

  /* Recarrega ao trocar o período, ao pedir nova tentativa e a cada
    atualização da lista de pedidos do painel. Uma falha numa atualização
    silenciosa mantém os números já exibidos. */
  useEffect(() => {
    if (!podeVerFinanceiro) return undefined;
    let ativo = true;
    buscarIndicadoresDashboardApi(periodo)
      .then((dados) => {
        if (ativo) setIndicadores({ periodo, tentativa, dados, erro: '' });
      })
      .catch((falha) => {
        if (!ativo) return;
        setIndicadores((atual) => (atual?.periodo === periodo && atual.tentativa === tentativa && atual.dados
          ? atual
          : { periodo, tentativa, dados: null, erro: falha.message }));
      });
    return () => { ativo = false; };
  }, [periodo, tentativa, pedidos, podeVerFinanceiro]);

  const carregandoIndicadores = !indicadores
    || indicadores.periodo !== periodo
    || indicadores.tentativa !== tentativa;
  const erroIndicadores = carregandoIndicadores ? '' : indicadores.erro;
  const ticketMedio = carregandoIndicadores ? null : indicadores.dados?.ticketMedio;
  const maisVendidos = carregandoIndicadores ? [] : (indicadores.dados?.produtosMaisVendidos ?? []);
  const descricaoPeriodo = PERIODOS.find((item) => item.valor === periodo)?.descricao ?? '';

  const receitaConfirmada = pedidos
    .filter((pedido) => pedido.pagamentoStatus === 'Pago')
    .reduce((total, pedido) => total + pedido.total, 0);
  // A API já devolve apenas as comandas do estabelecimento autenticado que continuam abertas.
  const comandasAbertas = comandas.length;
  const deliveryEmAndamento = pedidos.filter(
    (pedido) => pedido.origem === 'Delivery' && !STATUS_DELIVERY_ENCERRADO.includes(pedido.status)
  ).length;

  return (
    <AdminLayout titulo="Dashboard ADM">
      {!podeVerFinanceiro && !podeVerPedidos && !podeVerSalao && (
        <section className={styles.card}>
          <div className={styles.vazio} role="status">
            <LayoutDashboard size={32} />
            <h3>Nenhum indicador liberado para a sua conta</h3>
            <p>Use o menu para acessar as áreas que você pode gerenciar.</p>
          </div>
        </section>
      )}

      {podeVerFinanceiro && (
        <div className={estilos.seletorPeriodo}>
          <div className={`${styles.abas} ${estilos.opcoesPeriodo}`} role="group" aria-label="Período do ticket médio e dos mais vendidos">
            {PERIODOS.map((item) => (
              <button
                type="button"
                key={item.valor}
                aria-pressed={periodo === item.valor}
                className={`${styles.aba} ${periodo === item.valor ? styles.abaAtiva : ''}`}
                onClick={() => setPeriodo(item.valor)}
              >
                {item.rotulo}
              </button>
            ))}
          </div>
        </div>
      )}

      {(podeVerFinanceiro || podeVerPedidos || podeVerSalao) && (
        <section className={styles.gradeMetricas}>
          {podeVerFinanceiro && <div className={styles.metrica}><div className={styles.metricaIcone}><DollarSign size={24} /></div><div><span>Receita confirmada</span><strong>{moeda(receitaConfirmada)}</strong><small>Somente pagamentos marcados como pagos</small></div></div>}
          {podeVerSalao && <div className={styles.metrica}><div className={styles.metricaIcone}><ClipboardList size={23} /></div><div><span>Comandas abertas</span><strong>{comandasAbertas}</strong><small>Mesas em atendimento no momento</small></div></div>}
          {podeVerPedidos && <div className={styles.metrica}><div className={styles.metricaIcone}><Bike size={23} /></div><div><span>Pedidos do delivery</span><strong>{deliveryEmAndamento}</strong><small>Entregas em andamento</small></div></div>}
          {podeVerFinanceiro && (
            <div className={styles.metrica} aria-live="polite" aria-busy={carregandoIndicadores}>
              <div className={styles.metricaIcone}><Receipt size={23} /></div>
              <div className={estilos.estadoIndicador}>
                <span>Ticket médio</span>
                {carregandoIndicadores ? (
                  <><strong className={estilos.valorPendente}>Calculando…</strong><small>Pedidos pagos {descricaoPeriodo}</small></>
                ) : erroIndicadores ? (
                  <><strong className={estilos.valorPendente}>Indisponível</strong><small>Não foi possível calcular agora.</small></>
                ) : !ticketMedio || ticketMedio.pedidos === 0 ? (
                  <><strong className={estilos.valorPendente}>Sem pedidos</strong><small>Nenhum pedido pago {descricaoPeriodo}</small></>
                ) : (
                  <><strong>{moeda(ticketMedio.valor)}</strong><small>base: {quantidadePedidos(ticketMedio.pedidos)} {descricaoPeriodo}</small></>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {podeVerFinanceiro && (
        <section className={styles.card} aria-busy={carregandoIndicadores}>
          <div className={styles.topoCard}>
            <div><h2>Produtos mais vendidos</h2><p>Os 5 com maior quantidade em pedidos pagos {descricaoPeriodo}</p></div>
          </div>
          {carregandoIndicadores ? (
            <div className={styles.vazio} role="status"><p>Carregando os produtos mais vendidos…</p></div>
          ) : erroIndicadores ? (
            <div className={estilos.erroIndicadores} role="alert">
              <p className={styles.erro}>{erroIndicadores}</p>
              <button type="button" className={styles.botaoSecundario} onClick={() => setTentativa((atual) => atual + 1)}>Tentar novamente</button>
            </div>
          ) : maisVendidos.length === 0 ? (
            <div className={styles.vazio}><Trophy size={32} /><h3>Nenhuma venda no período</h3><p>Os produtos de pedidos pagos aparecerão aqui.</p></div>
          ) : (
            <ol className={styles.ranking} aria-label="Produtos mais vendidos">
              {maisVendidos.map((produto) => (
                <li className={styles.rankingItem} key={`${produto.produtoId ?? 'sem-cadastro'}-${produto.nome}`}>
                  <span>{produto.posicao}</span>
                  <div><strong>{produto.nome}</strong><small>{produto.quantidade.toLocaleString('pt-BR')} {produto.quantidade === 1 ? 'unidade vendida' : 'unidades vendidas'}</small></div>
                  <div className={estilos.valorProduto}><b>{moeda(produto.receita)}</b><small>receita</small></div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {podeVerPedidos && (
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
      )}
    </AdminLayout>
  );
}

export default AdminDashboard;
