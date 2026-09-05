import { ArrowLeft, Check, Minus, Plus, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import WaiterLayout from '../../components/WaiterLayout';
import { useApp } from '../../context/appContext';
import { usarPlaceholderProduto } from '../../utils/productImage';
import styles from './garcom.module.css';

function moeda(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

function ComandaGarcom() {
  const { mesaId } = useParams();
  const {
    produtos,
    adicionais,
    mesas,
    comandas,
    garcomSessao,
    configuracao,
    abrirComanda,
    adicionarItemComanda,
    removerItemComanda,
    enviarComanda,
    solicitarConta,
    fecharComanda,
    recarregarGarcom,
    numeroPreco
  } = useApp();
  const navigate = useNavigate();
  const mesa = mesas.find((item) => item.id === Number(mesaId));
  const comanda = comandas.find((item) => item.mesaId === Number(mesaId) && item.status !== 'Encerrada');
  const [categoria, setCategoria] = useState('Todos');
  const [produtoSelecionado, setProdutoSelecionado] = useState(null);
  const [quantidade, setQuantidade] = useState(1);
  const [extras, setExtras] = useState([]);
  const [observacao, setObservacao] = useState('');
  const [pagamento, setPagamento] = useState('Cartão');
  const [mensagem, setMensagem] = useState('');
  const [processando, setProcessando] = useState(null);
  const modalRef = useRef(null);
  const fecharModalRef = useRef(null);

  useEffect(() => {
    if (!produtoSelecionado) return undefined;

    const focoAnterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflowAnterior = document.body.style.overflow;
    const animacao = window.requestAnimationFrame(() => fecharModalRef.current?.focus());
    document.body.style.overflow = 'hidden';

    function tratarTeclado(evento) {
      if (evento.key === 'Escape') {
        setProdutoSelecionado(null);
        return;
      }

      if (evento.key !== 'Tab' || !modalRef.current) return;
      const focaveis = [...modalRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )];
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (!primeiro || !ultimo) return;
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener('keydown', tratarTeclado);
    return () => {
      window.cancelAnimationFrame(animacao);
      document.removeEventListener('keydown', tratarTeclado);
      document.body.style.overflow = overflowAnterior;
      focoAnterior?.focus();
    };
  }, [produtoSelecionado]);

  async function executarAcao(chave, acao) {
    if (processando) return null;
    setMensagem('');
    setProcessando(chave);
    try {
      return await acao();
    } catch (falha) {
      setMensagem(falha.message);
      return null;
    } finally {
      setProcessando(null);
    }
  }

  if (!mesa) {
    return <WaiterLayout titulo="Mesa não encontrada" subtitulo="Volte para selecionar uma mesa válida."><button type="button" className={styles.botaoSecundario} onClick={() => navigate('/garcom/mesas')}><ArrowLeft size={17} /> Voltar</button></WaiterLayout>;
  }

  if (!comanda) {
    if (mesa.status === 'Ocupada') {
      return <WaiterLayout titulo={`Mesa ${mesa.numero} em atendimento`} subtitulo="Esta mesa está vinculada a outro funcionário."><button type="button" className={styles.botaoSecundario} onClick={() => navigate('/garcom/mesas')}><ArrowLeft size={17} /> Voltar</button></WaiterLayout>;
    }
    return <WaiterLayout titulo={`Mesa ${mesa.numero}`} subtitulo="A comanda ainda não foi aberta."><button disabled={processando === 'abrir'} type="button" className={styles.botaoPrincipal} onClick={() => executarAcao('abrir', () => abrirComanda(mesa.id))}>{processando === 'abrir' ? 'Abrindo…' : 'Abrir comanda'}</button>{mensagem && <div className={styles.erro} role="alert">{mensagem}</div>}</WaiterLayout>;
  }

  if (comanda.funcionarioId !== garcomSessao.id) {
    return <WaiterLayout titulo={`Mesa ${mesa.numero} em atendimento`} subtitulo="Esta comanda pertence a outro funcionário."><button type="button" className={styles.botaoSecundario} onClick={() => navigate('/garcom/mesas')}><ArrowLeft size={17} /> Voltar</button></WaiterLayout>;
  }

  const categorias = ['Todos', ...new Set(produtos.filter((produto) => produto.ativo).map((produto) => produto.categoria))];
  const filtrados = produtos.filter((produto) => produto.ativo && (categoria === 'Todos' || produto.categoria === categoria));
  const total = comanda.itens.reduce((soma, item) => soma + Number(item.preco) * item.quantidade, 0);
  const quantidadeItens = comanda.itens.reduce((soma, item) => soma + item.quantidade, 0);
  const precoModal = produtoSelecionado ? (numeroPreco(produtoSelecionado.preco) + extras.reduce((soma, item) => soma + item.preco, 0)) * quantidade : 0;
  const adicionaisProduto = adicionais.filter((adicional) => {
    if (adicional.ativo === false) return false;
    if (!Array.isArray(produtoSelecionado?.adicionaisIds)) return true;
    return produtoSelecionado.adicionaisIds.some((id) => String(id) === String(adicional.id));
  });
  const pagamentosDisponiveis = [
    configuracao.pixChave ? 'Pix' : null,
    configuracao.aceitaCartao ? 'Cartão' : null,
    configuracao.aceitaDinheiro ? 'Dinheiro' : null
  ].filter(Boolean);
  const pagamentoValido = pagamentosDisponiveis.includes(pagamento) ? pagamento : (pagamentosDisponiveis[0] ?? '');

  function abrirProduto(produto) {
    setProdutoSelecionado(produto);
    setQuantidade(1);
    setExtras([]);
    setObservacao('');
  }

  function alternarExtra(adicional) {
    setExtras((atuais) => atuais.some((item) => item.id === adicional.id) ? atuais.filter((item) => item.id !== adicional.id) : [...atuais, adicional]);
  }

  async function adicionar() {
    const resultado = await executarAcao('adicionar', () => adicionarItemComanda(comanda.id, produtoSelecionado, quantidade, extras, observacao.trim()));
    if (resultado !== null) {
      setProdutoSelecionado(null);
      setMensagem('Item adicionado à comanda.');
    }
  }

  async function enviar() {
    const resultado = await executarAcao('enviar', () => enviarComanda(comanda.id));
    if (resultado) setMensagem('Pedido enviado para a cozinha.');
  }

  async function encerrar() {
    const resultado = await executarAcao('encerrar', () => fecharComanda(comanda.id, pagamentoValido));
    if (resultado !== null) {
      navigate('/garcom/mesas');
    }
  }

  async function pedirConta() {
    const resultado = await executarAcao('conta', () => solicitarConta(comanda.id));
    if (resultado !== null) {
      setMensagem('Conta solicitada.');
    }
  }

  async function atualizar() {
    await executarAcao('atualizar', () => recarregarGarcom());
  }

  async function removerItem(itemId) {
    const resultado = await executarAcao(`remover-${itemId}`, () => removerItemComanda(comanda.id, itemId));
    if (resultado !== null) {
      setMensagem('Item removido da comanda.');
    }
  }

  /* A ação principal muda com o estágio da comanda, mas é sempre a mesma
     operação de antes — só passou a morar na barra fixa do rodapé, onde o
     garçom já está olhando o total. */
  const acaoPrincipal = comanda.status === 'Conta solicitada'
    ? {
      chave: 'encerrar',
      rotulo: 'Confirmar pagamento',
      carregando: 'Finalizando…',
      executar: encerrar,
      classe: styles.botaoPerigo,
      icone: <Check size={17} />,
      bloqueada: pagamentosDisponiveis.length === 0
    }
    : comanda.status === 'Na cozinha'
      ? {
        chave: 'conta',
        rotulo: 'Solicitar conta',
        carregando: 'Solicitando…',
        executar: pedirConta,
        classe: styles.botaoPrincipal,
        icone: null,
        bloqueada: comanda.itens.length === 0
      }
      : {
        chave: 'enviar',
        rotulo: 'Enviar para cozinha',
        carregando: 'Enviando…',
        executar: enviar,
        classe: styles.botaoPrincipal,
        icone: <Send size={17} />,
        bloqueada: comanda.itens.length === 0
      };

  return (
    <WaiterLayout titulo={`Mesa ${mesa.numero}`} subtitulo={`${comanda.status} • aberta às ${comanda.abertaEm} • ${comanda.garcom}`}>
      {mensagem && <div className={styles.identificado} role="status" aria-live="polite"><span><Check size={18} /></span><div><strong>{mensagem}</strong><small>Status atual: {comanda.status}</small></div></div>}

      <div className={styles.comandaFluxo}>
        <div className={styles.acoesTopo}>
          <button type="button" className={styles.botaoSecundario} onClick={() => navigate('/garcom/mesas')}>
            <ArrowLeft size={16} /> Mesas
          </button>
          <button type="button" className={styles.botaoSecundario} disabled={Boolean(processando)} onClick={atualizar}>
            <RefreshCw size={16} /> {processando === 'atualizar' ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>

        <section className={styles.painel}>
          <div className={styles.categorias}>
            {categorias.map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={categoria === item}
                className={`${styles.categoria} ${categoria === item ? styles.categoriaAtiva : ''}`}
                onClick={() => setCategoria(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <div className={styles.gradeProdutos}>
            {filtrados.map((produto) => (
              <button
                type="button"
                key={produto.id}
                className={styles.produto}
                disabled={Boolean(processando)}
                aria-label={`Adicionar ${produto.nome}`}
                onClick={() => abrirProduto(produto)}
              >
                <img src={produto.imagem} alt="" loading="lazy" decoding="async" onError={usarPlaceholderProduto} />
                <strong>{produto.nome}</strong>
                <span>{moeda(numeroPreco(produto.preco))}</span>
              </button>
            ))}
          </div>

          {filtrados.length === 0 && <div className={styles.vazio} role="status">Nenhum produto disponível nesta categoria.</div>}
        </section>

        <section className={styles.painel}>
          <div className={styles.topoPainel}>
            <div><h2>Consumo da mesa</h2><p>{comanda.itens.length} lançamentos</p></div>
          </div>

          {comanda.itens.length === 0 ? (
            <div className={styles.vazio}>A comanda está vazia.<br />Toque em um produto para lançar.</div>
          ) : (
            <div className={styles.listaItens}>
              <div className={styles.itemCabecalho} aria-hidden="true">
                <span>Hora</span><span>Descrição</span><span>Qtde</span><span>Valor</span><span />
              </div>
              {comanda.itens.map((item, indice) => (
                <div
                  className={`${styles.itemComanda} ${indice === comanda.itens.length - 1 ? styles.itemRecente : ''}`}
                  key={item.linhaId ?? `${item.id}-${indice}`}
                >
                  <span className={styles.itemHora}>{item.lancadoEm ?? '—'}</span>
                  <span className={styles.itemDescricao}>
                    <strong>{item.nome}</strong>
                    {item.adicionais?.length > 0 && <small>+ {item.adicionais.map((extra) => extra.nome ?? extra).join(', ')}</small>}
                    {item.observacao && <small>{item.observacao}</small>}
                  </span>
                  <span className={styles.itemQuantidade}>{item.quantidade}</span>
                  <span className={styles.itemValor}>{moeda(Number(item.preco) * item.quantidade)}</span>
                  <button
                    disabled={Boolean(processando)}
                    type="button"
                    className={styles.itemRemover}
                    aria-label={`Remover ${item.nome}`}
                    onClick={() => removerItem(item.linhaId ?? item.id)}
                  ><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          )}

          {comanda.status === 'Conta solicitada' && (
            <>
              <div className={styles.campo}>
                <label htmlFor="pagamentoComanda">Forma de pagamento confirmada</label>
                <select disabled={Boolean(processando)} id="pagamentoComanda" value={pagamentoValido} onChange={(evento) => setPagamento(evento.target.value)}>
                  {pagamentosDisponiveis.map((forma) => <option key={forma}>{forma}</option>)}
                </select>
              </div>
              {pagamentosDisponiveis.length === 0 && <div className={styles.erro} role="alert">Nenhuma forma de pagamento está habilitada nas configurações.</div>}
            </>
          )}
        </section>
      </div>

      <div className={styles.barraTotal}>
        <div className={styles.barraValores}>
          <span>{quantidadeItens} {quantidadeItens === 1 ? 'item' : 'itens'}</span>
          <strong>{moeda(total)}</strong>
        </div>
        <button
          type="button"
          className={acaoPrincipal.classe}
          disabled={Boolean(processando) || acaoPrincipal.bloqueada}
          onClick={acaoPrincipal.executar}
        >
          {acaoPrincipal.icone}
          {processando === acaoPrincipal.chave ? acaoPrincipal.carregando : acaoPrincipal.rotulo}
        </button>
      </div>

      {produtoSelecionado && (
        <div className={styles.modalFundo} onClick={() => setProdutoSelecionado(null)}>
          <div
            className={styles.modal}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-produto-garcom"
            onClick={(evento) => evento.stopPropagation()}
          >
            <div className={styles.modalTopo}>
              <div><h2 id="titulo-produto-garcom">{produtoSelecionado.nome}</h2><p>{produtoSelecionado.descricao}</p></div>
              <button type="button" ref={fecharModalRef} aria-label="Fechar personalização" onClick={() => setProdutoSelecionado(null)}><X size={21} /></button>
            </div>
            <div className={styles.adicionais}>
              {adicionaisProduto.map((adicional) => {
                const selecionado = extras.some((item) => item.id === adicional.id);
                return <button type="button" key={adicional.id} aria-pressed={selecionado} className={`${styles.adicional} ${selecionado ? styles.adicionalAtivo : ''}`} onClick={() => alternarExtra(adicional)}><span>{adicional.nome}</span><strong>+ {moeda(adicional.preco)}</strong></button>;
              })}
              {adicionaisProduto.length === 0 && <div className={styles.vazio}>Este produto não possui adicionais disponíveis.</div>}
            </div>
            <div className={styles.campo}><label htmlFor="observacaoItem">Observação <span>(opcional)</span></label><textarea id="observacaoItem" value={observacao} onChange={(evento) => setObservacao(evento.target.value)} placeholder="Ex: sem cebola, ponto da carne..." /></div>
            <div className={styles.modalRodape}>
              <div className={styles.quantidade}><button disabled={Boolean(processando)} type="button" aria-label="Diminuir quantidade" onClick={() => setQuantidade((atual) => Math.max(1, atual - 1))}><Minus size={16} /></button><strong>{quantidade}</strong><button disabled={Boolean(processando) || quantidade >= 50} type="button" aria-label="Aumentar quantidade" onClick={() => setQuantidade((atual) => Math.min(50, atual + 1))}><Plus size={16} /></button></div>
              <button disabled={Boolean(processando)} type="button" className={styles.botaoPrincipal} onClick={adicionar}>{processando === 'adicionar' ? 'Adicionando…' : `Adicionar • ${moeda(precoModal)}`}</button>
            </div>
          </div>
        </div>
      )}
    </WaiterLayout>
  );
}

export default ComandaGarcom;
