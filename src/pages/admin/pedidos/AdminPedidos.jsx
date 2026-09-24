import { CalendarDays, EllipsisVertical, Motorbike, Plus, Search, ShoppingBag, Store, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import AdminLayout from '../../../components/AdminLayout';
import SeletorOpcoes from '../../../components/SeletorOpcoes';
import { useApp } from '../../../context/appContext';
import shared from '../shared.module.css';
import styles from './AdminPedidos.module.css';

const filtrosPeriodo = ['Hoje', 'Ontem', 'Últimos 7 dias', 'Todos'];
const STATUS_FINAIS = ['Entregue', 'Entregue na mesa', 'Retirado', 'Cancelado'];
const MINUTOS_ATRASO = 20;

// Conta de mesa já paga: o fechamento da comanda grava o pagamento no pedido.
function contaFechada(pedido) {
  return ['Pago', 'Estornado'].includes(pedido.pagamentoStatus);
}

/*
  Abas montadas só com os status reais do servidor. "Aceito" não existe no
  fluxo; no lugar dele entra "Pronto p/ retirada", que é onde a retirada
  espera o cliente.
*/
const SEGMENTOS = {
  Delivery: {
    rotuloTempo: 'Recebido',
    abas: [
      { chave: 'pendentes', nome: 'Pendentes', cor: '#FFC107', filtro: (pedido) => pedido.status === 'Recebido' },
      { chave: 'preparo', nome: 'Em preparo', cor: '#FB923C', filtro: (pedido) => pedido.status === 'Em preparo' },
      { chave: 'pronto', nome: 'Pronto p/ retirada', cor: '#2DD4BF', filtro: (pedido) => pedido.status === 'Pronto' },
      { chave: 'entrega', nome: 'Saiu p/ entrega', cor: '#A78BFA', filtro: (pedido) => pedido.status === 'Saiu para entrega' },
      { chave: 'concluido', nome: 'Concluído', cor: '#4ADE80', filtro: (pedido) => ['Entregue', 'Retirado'].includes(pedido.status) },
      { chave: 'cancelados', nome: 'Cancelados', cor: '#F87171', filtro: (pedido) => pedido.status === 'Cancelado' }
    ]
  },
  Salão: {
    rotuloTempo: 'Enviado',
    abas: [
      { chave: 'pendentes', nome: 'Pendentes', cor: '#FFC107', filtro: (pedido) => pedido.status === 'Recebido' },
      { chave: 'preparo', nome: 'Em preparo', cor: '#FB923C', filtro: (pedido) => pedido.status === 'Em preparo' },
      { chave: 'pronto', nome: 'Pronto p/ servir', cor: '#2DD4BF', filtro: (pedido) => pedido.status === 'Pronto' },
      { chave: 'servido', nome: 'Servido', cor: '#A78BFA', filtro: (pedido) => pedido.status === 'Entregue na mesa' && !contaFechada(pedido) },
      { chave: 'conta', nome: 'Conta fechada', cor: '#4ADE80', filtro: (pedido) => pedido.status === 'Entregue na mesa' && contaFechada(pedido) },
      { chave: 'cancelados', nome: 'Cancelados', cor: '#F87171', filtro: (pedido) => pedido.status === 'Cancelado' }
    ]
  }
};

// Mesmo recorte por dia usado nos relatórios: virada do dia no fuso do navegador.
function inicioDoDia(diasAtras) {
  const data = new Date();
  data.setHours(0, 0, 0, 0);
  data.setDate(data.getDate() - diasAtras);
  return data;
}

function intervaloDoPeriodo(periodo) {
  if (periodo === 'Ontem') return { inicio: inicioDoDia(1), fim: inicioDoDia(0) };
  if (periodo === 'Últimos 7 dias') return { inicio: inicioDoDia(6), fim: null };
  if (periodo === 'Hoje') return { inicio: inicioDoDia(0), fim: null };
  return null;
}

function dentroDoPeriodo(pedido, intervalo) {
  if (!intervalo) return true;
  const data = new Date(pedido.criadoEm);
  if (Number.isNaN(data.getTime())) return false;
  if (data < intervalo.inicio) return false;
  return !intervalo.fim || data < intervalo.fim;
}

function moeda(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

function ehSalao(pedido) {
  return pedido.origem.startsWith('Mesa');
}

function classeStatus(status) {
  if (status === 'Recebido') return styles.seloRecebido;
  if (status === 'Em preparo') return styles.seloPreparo;
  if (status === 'Pronto') return styles.seloPronto;
  if (status === 'Saiu para entrega') return styles.seloEntrega;
  if (['Entregue', 'Entregue na mesa'].includes(status)) return styles.seloEntregue;
  if (status === 'Retirado') return styles.seloRetirado;
  if (status === 'Cancelado') return styles.seloCancelado;
  return '';
}

// Próxima etapa do mesmo fluxo que o servidor aceita para cada origem.
function proximaEtapa(pedido) {
  if (pedido.status === 'Recebido') return { status: 'Em preparo', rotulo: 'Iniciar preparo' };
  if (pedido.status === 'Em preparo') {
    return pedido.origem === 'Delivery'
      ? { status: 'Saiu para entrega', rotulo: 'Enviar para entrega' }
      : { status: 'Pronto', rotulo: 'Marcar como pronto' };
  }
  if (pedido.status === 'Pronto') {
    return pedido.origem === 'Retirada no balcão'
      ? { status: 'Retirado', rotulo: 'Confirmar retirada' }
      : { status: 'Entregue na mesa', rotulo: 'Marcar como servido' };
  }
  if (pedido.status === 'Saiu para entrega') return { status: 'Entregue', rotulo: 'Confirmar entrega' };
  return null;
}

function minutosDesde(valor, agora) {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return Math.max(0, Math.floor((agora - data.getTime()) / 60000));
}

function textoTempo(minutos) {
  if (minutos < 1) return 'agora mesmo';
  if (minutos === 1) return 'há 1 minuto';
  if (minutos < 60) return `há ${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return minutos % 60 ? `há ${horas} h ${minutos % 60} min` : `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

function textoPagamento(pedido) {
  if (ehSalao(pedido)) {
    if (contaFechada(pedido)) return `${pedido.pagamentoStatus} - ${pedido.pagamento}`;
    if (pedido.status === 'Cancelado') return 'Conta cancelada';
    const unidades = pedido.itens.reduce((total, item) => total + item.quantidade, 0);
    return `Conta aberta - ${unidades} ${unidades === 1 ? 'item' : 'itens'}`;
  }
  if (pedido.pagamentoStatus === 'Pago') return `Pago - ${pedido.pagamento}`;
  if (pedido.pagamentoStatus === 'Pagamento na entrega') {
    const troco = pedido.pagamento === 'Dinheiro' && pedido.trocoPara != null ? ` (troco p/ ${moeda(pedido.trocoPara)})` : '';
    const momento = pedido.origem === 'Retirada no balcão' ? 'na retirada' : 'na entrega';
    return `Cobrar ${momento} - ${pedido.pagamento}${troco}`;
  }
  return `${pedido.pagamentoStatus} - ${pedido.pagamento}`;
}

function OrigemPedido({ pedido }) {
  if (ehSalao(pedido)) return <><Store size={16} aria-hidden="true" /> Salão</>;
  if (pedido.origem === 'Delivery') return <><Motorbike size={16} aria-hidden="true" /> Delivery</>;
  return <><ShoppingBag size={16} aria-hidden="true" /> Retirada</>;
}

/* Ações que não cabem no botão principal do card. */
function MenuPedido({ pedido, podeCancelar, aoVerDetalhes, aoCancelar }) {
  const [aberto, setAberto] = useState(false);
  const areaRef = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const area = areaRef.current;
    area?.querySelector('[role="menuitem"]')?.focus();

    function fecharFora(evento) {
      if (!area?.contains(evento.target)) setAberto(false);
    }
    function fecharComEscape(evento) {
      if (evento.key !== 'Escape') return;
      setAberto(false);
      area?.querySelector('button')?.focus();
    }

    document.addEventListener('mousedown', fecharFora);
    document.addEventListener('keydown', fecharComEscape);
    return () => {
      document.removeEventListener('mousedown', fecharFora);
      document.removeEventListener('keydown', fecharComEscape);
    };
  }, [aberto]);

  function escolher(acao) {
    setAberto(false);
    acao();
  }

  return (
    <div className={styles.menuArea} ref={areaRef} onClick={(evento) => evento.stopPropagation()}>
      <button
        type="button"
        className={styles.botaoMais}
        aria-label={`Mais ações do pedido ${pedido.id}`}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((atual) => !atual)}
      >
        <EllipsisVertical size={18} />
      </button>
      {aberto && (
        <div className={styles.menu} role="menu" aria-label={`Ações do pedido ${pedido.id}`}>
          <button type="button" role="menuitem" onClick={() => escolher(aoVerDetalhes)}>Ver detalhes</button>
          {podeCancelar && (
            <button type="button" role="menuitem" className={styles.itemPerigo} onClick={() => escolher(aoCancelar)}>Cancelar pedido</button>
          )}
        </div>
      )}
    </div>
  );
}

function AdminPedidos() {
  const { pedidos, pedidosNovos, atualizarStatusPedido, temPermissao } = useApp();
  const navigate = useNavigate();
  const [segmento, setSegmento] = useState('Delivery');
  const [abaAtiva, setAbaAtiva] = useState('pendentes');
  const [busca, setBusca] = useState('');
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [periodo, setPeriodo] = useState('Hoje');
  const [processando, setProcessando] = useState('');
  const [erro, setErro] = useState('');
  const [agora, setAgora] = useState(() => Date.now());
  const campoBuscaRef = useRef(null);
  const podeAlterarStatus = temPermissao('pedidos.alterar_status');
  const podeLancar = temPermissao('mesas.operar');

  // Só o texto "há X minutos" muda; a lista continua vindo da atualização geral.
  useEffect(() => {
    const relogio = setInterval(() => setAgora(Date.now()), 60000);
    return () => clearInterval(relogio);
  }, []);

  useEffect(() => {
    if (buscaAberta) campoBuscaRef.current?.focus();
  }, [buscaAberta]);

  const configSegmento = SEGMENTOS[segmento];
  const aba = configSegmento.abas.find((item) => item.chave === abaAtiva) ?? configSegmento.abas[0];
  const termo = busca.trim().toLowerCase();
  const intervalo = intervaloDoPeriodo(periodo);
  // Período, origem e busca valem para os contadores e para a grade.
  const base = pedidos.filter((pedido) => {
    if (!dentroDoPeriodo(pedido, intervalo)) return false;
    if ((segmento === 'Salão') !== ehSalao(pedido)) return false;
    return !termo || [pedido.id, pedido.cliente, pedido.origem, ...pedido.itens.map((item) => item.nome)]
      .join(' ')
      .toLowerCase()
      .includes(termo);
  });
  const filtrados = base.filter(aba.filtro);

  function abrirDetalhes(pedido) {
    navigate(`/admin/pedidos/${pedido.id.replace('#', '')}`);
  }

  async function mudarStatus(pedido, status) {
    if (processando) return;
    if (status === 'Cancelado') {
      const complemento = pedido.pagamentoStatus === 'Pago'
        ? ' O pagamento confirmado será marcado como estornado e deixará de compor o faturamento.'
        : ' O pagamento pendente será marcado como cancelado.';
      if (!window.confirm(`Cancelar ${pedido.id}?${complemento}`)) return;
    }
    setErro('');
    setProcessando(pedido.id);
    try {
      await atualizarStatusPedido(pedido.id, status);
    } catch (falha) {
      setErro(`${pedido.id}: ${falha.message}`);
    } finally {
      setProcessando('');
    }
  }

  function alternarBusca() {
    if (buscaAberta) setBusca('');
    setBuscaAberta((atual) => !atual);
  }

  return (
    <AdminLayout titulo="Pedidos">
      <div className={styles.controles}>
        <div className={styles.segmentado} role="group" aria-label="Origem dos pedidos">
          {Object.keys(SEGMENTOS).map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={segmento === item}
              className={segmento === item ? styles.segmentoAtivo : ''}
              onClick={() => setSegmento(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className={styles.ferramentas}>
          {podeLancar && (
            <Link to="/admin/mesas" className={styles.botaoLancar} title="Lançar pedido em Mesas / Comandas">
              <Plus size={18} strokeWidth={2.4} aria-hidden="true" /> Lançar pedido
            </Link>
          )}
          <SeletorOpcoes
            rotulo="Período dos pedidos"
            icone={CalendarDays}
            opcoes={filtrosPeriodo}
            valor={periodo}
            onChange={setPeriodo}
          />
          <button
            type="button"
            className={`${styles.botaoFerramenta} ${buscaAberta ? styles.botaoFerramentaAtivo : ''}`}
            aria-label={buscaAberta ? 'Fechar busca' : 'Buscar pedidos'}
            aria-expanded={buscaAberta}
            aria-controls="busca-pedidos"
            onClick={alternarBusca}
          >
            {buscaAberta ? <X size={19} /> : <Search size={19} />}
          </button>
        </div>
      </div>

      {buscaAberta && (
        <label className={styles.busca} id="busca-pedidos">
          <Search size={17} aria-hidden="true" />
          <input
            ref={campoBuscaRef}
            aria-label="Buscar pedidos"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            onKeyDown={(evento) => { if (evento.key === 'Escape') alternarBusca(); }}
            placeholder="Buscar pedido, cliente ou item..."
          />
        </label>
      )}

      <div className={styles.abas} role="group" aria-label="Filtrar pedidos por status">
        {configSegmento.abas.map((item) => {
          const quantidade = base.filter(item.filtro).length;
          const ativa = item.chave === aba.chave;
          return (
            <button
              type="button"
              key={item.chave}
              aria-pressed={ativa}
              aria-label={`${item.nome}: ${quantidade}`}
              className={`${styles.aba} ${ativa ? styles.abaAtiva : ''}`}
              style={{ '--cor-aba': item.cor }}
              onClick={() => setAbaAtiva(item.chave)}
            >
              <span className={styles.bolinha} aria-hidden="true" />
              <span aria-hidden="true">{item.nome}</span>
              <span className={styles.contador} aria-hidden="true">{quantidade}</span>
            </button>
          );
        })}
      </div>

      {erro && <div className={`${shared.erro} ${styles.erro}`} role="alert">{erro}</div>}

      {filtrados.length > 0 ? (
        <ul className={styles.grade} aria-label={`Pedidos: ${aba.nome}`}>
          {filtrados.map((pedido) => {
            const etapa = podeAlterarStatus ? proximaEtapa(pedido) : null;
            const finalizado = STATUS_FINAIS.includes(pedido.status);
            const minutos = minutosDesde(pedido.criadoEm, agora);
            const atrasado = !finalizado && minutos !== null && minutos > MINUTOS_ATRASO;
            const salao = ehSalao(pedido);
            return (
              <li key={pedido.id}>
                <article
                  className={`${styles.cartao} ${pedidosNovos.includes(pedido.id) ? styles.cartaoNovo : ''}`}
                  onClick={() => abrirDetalhes(pedido)}
                >
                  <div className={styles.topo}>
                    <Link
                      to={`/admin/pedidos/${pedido.id.replace('#', '')}`}
                      className={styles.numero}
                      aria-label={`Ver detalhes do pedido ${pedido.id}`}
                      onClick={(evento) => evento.stopPropagation()}
                    >
                      {pedido.id}
                    </Link>
                    <span className={`${styles.selo} ${classeStatus(pedido.status)}`}>{pedido.status}</span>
                    <MenuPedido
                      pedido={pedido}
                      podeCancelar={podeAlterarStatus && !finalizado}
                      aoVerDetalhes={() => abrirDetalhes(pedido)}
                      aoCancelar={() => mudarStatus(pedido, 'Cancelado')}
                    />
                  </div>

                  <p className={styles.origem}><OrigemPedido pedido={pedido} /></p>
                  <h3 className={styles.cliente}>
                    {salao ? `${pedido.origem}${pedido.garcom ? ` · Garçom ${pedido.garcom}` : ''}` : pedido.cliente}
                  </h3>
                  <p className={styles.linha}>{pedido.itens.map((item) => `${item.quantidade}x ${item.nome}`).join(', ')}</p>
                  <p className={styles.linha}>{textoPagamento(pedido)}</p>

                  <div className={styles.rodape}>
                    <span className={`${styles.tempo} ${atrasado ? styles.tempoAtrasado : ''}`}>
                      {minutos === null ? pedido.horario : `${configSegmento.rotuloTempo} ${textoTempo(minutos)}`}
                    </span>
                    <strong className={styles.total}>{moeda(pedido.total)}</strong>
                  </div>

                  {etapa ? (
                    <button
                      type="button"
                      className={styles.botaoAcao}
                      disabled={Boolean(processando)}
                      aria-busy={processando === pedido.id}
                      onClick={(evento) => { evento.stopPropagation(); mudarStatus(pedido, etapa.status); }}
                    >
                      {processando === pedido.id ? 'Atualizando...' : etapa.rotulo}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`${styles.botaoAcao} ${styles.botaoDetalhes}`}
                      onClick={(evento) => { evento.stopPropagation(); abrirDetalhes(pedido); }}
                    >
                      Ver detalhes
                    </button>
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={`${shared.vazio} ${styles.vazio}`}>
          <ShoppingBag size={34} />
          <h3>Nenhum pedido encontrado</h3>
          <p>{termo ? 'Nenhum pedido corresponde à busca neste status.' : 'Ajuste o período ou escolha outra aba para ver outros pedidos.'}</p>
        </div>
      )}
    </AdminLayout>
  );
}

export default AdminPedidos;
