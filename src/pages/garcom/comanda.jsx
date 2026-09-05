import { ArrowLeft, Check, Minus, Plus, Send, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import WaiterLayout from '../../components/WaiterLayout';
import { useApp } from '../../context/appContext';
import { usarPlaceholderProduto } from '../../utils/productImage';
import styles from './garcom.module.css';

function moeda(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

/* A comanda pode ter sido aberta no caixa: mostrar quem abriu evita o garçom
   achar que a mesa é dele quando ainda não assumiu o atendimento. */
function rotuloAutor(autor) {
  if (!autor) return null;
  return autor.tipo === 'admin' ? `Admin ${autor.nome}` : autor.nome;
}

function ComandaGarcom() {
  const { mesaId } = useParams();
  const {
    produtos,
    categorias,
    adicionais,
    mesas,
    comandas,
    abrirComanda,
    adicionarItemComanda,
    removerItemComanda,
    enviarComanda,
    limparItensPendentes,
    numeroPreco
  } = useApp();
  const navigate = useNavigate();
  const mesa = mesas.find((item) => item.id === Number(mesaId));
  const comanda = comandas.find((item) => item.mesaId === Number(mesaId) && item.status !== 'Encerrada');
  /* Cardápio em dois passos: a lista abre nas categorias e só entra nos itens
     depois que o garçom escolhe uma. Guardar o id, e não a categoria inteira,
     mantém a tela certa quando os dados são recarregados no meio do turno. */
  const [categoriaAbertaId, setCategoriaAbertaId] = useState(null);
  const [produtoSelecionado, setProdutoSelecionado] = useState(null);
  const [confirmacaoAberta, setConfirmacaoAberta] = useState(false);
  const [quantidade, setQuantidade] = useState(1);
  const [extras, setExtras] = useState([]);
  const [observacao, setObservacao] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [processando, setProcessando] = useState(null);
  const modalRef = useRef(null);
  const fecharModalRef = useRef(null);

  const modalAberto = Boolean(produtoSelecionado) || confirmacaoAberta;

  function fecharModais() {
    setProdutoSelecionado(null);
    setConfirmacaoAberta(false);
  }

  useEffect(() => {
    if (!modalAberto) return undefined;

    const focoAnterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflowAnterior = document.body.style.overflow;
    const animacao = window.requestAnimationFrame(() => fecharModalRef.current?.focus());
    document.body.style.overflow = 'hidden';

    function tratarTeclado(evento) {
      if (evento.key === 'Escape') {
        fecharModais();
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
  }, [modalAberto]);

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

  /* O salão é da equipe: comanda de colega não bloqueia mais a tela. Se a
     mesa aparece ocupada sem comanda na lista, é atraso de atualização — abrir
     a comanda entra na que já existe, em vez de criar outra. */
  if (!comanda) {
    return <WaiterLayout titulo={`Mesa ${mesa.numero}`} subtitulo="A comanda ainda não foi aberta."><button disabled={processando === 'abrir'} type="button" className={styles.botaoPrincipal} onClick={() => executarAcao('abrir', () => abrirComanda(mesa.id))}>{processando === 'abrir' ? 'Abrindo…' : 'Abrir comanda'}</button>{mensagem && <div className={styles.erro} role="alert">{mensagem}</div>}</WaiterLayout>;
  }

  const produtosDoSalao = produtos.filter((produto) => produto.ativo);
  /* Categoria vazia não vira linha: no salão ela só atrapalharia a busca. */
  const categoriasDoSalao = categorias
    .filter((item) => item.ativo !== false)
    .map((item) => ({
      ...item,
      total: produtosDoSalao.filter((produto) => produto.categoriaId === item.id).length
    }))
    .filter((item) => item.total > 0);
  const categoriaAberta = categoriasDoSalao.find((item) => item.id === categoriaAbertaId) ?? null;
  const produtosDaCategoria = categoriaAberta
    ? produtosDoSalao.filter((produto) => produto.categoriaId === categoriaAberta.id)
    : [];
  const total = comanda.itens.reduce((soma, item) => soma + Number(item.preco) * item.quantidade, 0);
  const quantidadeItens = comanda.itens.reduce((soma, item) => soma + item.quantidade, 0);
  const precoModal = produtoSelecionado ? (numeroPreco(produtoSelecionado.preco) + extras.reduce((soma, item) => soma + item.preco, 0)) * quantidade : 0;
  const adicionaisProduto = adicionais.filter((adicional) => {
    if (adicional.ativo === false) return false;
    if (!Array.isArray(produtoSelecionado?.adicionaisIds)) return true;
    return produtoSelecionado.adicionaisIds.some((id) => String(id) === String(adicional.id));
  });
  /* O garçom só mexe no que ainda não foi para a cozinha: item já lançado
     fica visível, mas sem remover nem alterar — isso é do painel. */
  const pendentes = comanda.itens.filter((item) => !item.enviado);
  const totalPendente = pendentes.reduce(
    (soma, item) => soma + Number(item.preco) * item.quantidade,
    0
  );

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
    if (resultado) {
      setConfirmacaoAberta(false);
      setMensagem('Pedido lançado para a cozinha.');
    }
  }

  async function limparPendentes() {
    if (pendentes.length === 0) return;
    const resultado = await executarAcao('limpar', () => limparItensPendentes(comanda.id));
    if (resultado !== null) setMensagem('Itens não lançados removidos.');
  }

  async function removerItem(itemId) {
    // Segurança de duas pontas: o backend recusa a remoção de item já
    // lançado; aqui a lixeira nem aparece nesse caso.
    const resultado = await executarAcao(`remover-${itemId}`, () => removerItemComanda(comanda.id, itemId));
    if (resultado !== null) {
      setMensagem('Item removido da comanda.');
    }
  }

  /* Lançar para a cozinha é a única ação do rodapé. Fechar a conta é do
     caixa: o garçom acompanha o valor, mas não solicita nem finaliza. */
  const podeLancar = pendentes.length > 0;

  return (
    <WaiterLayout
      titulo={`Mesa ${mesa.numero}`}
      subtitulo={`${comanda.status} • aberta às ${comanda.abertaEm}${rotuloAutor(comanda.abertaPor) ? ` • ${rotuloAutor(comanda.abertaPor)}` : ''}`}
    >
      {mensagem && <div className={styles.identificado} role="status" aria-live="polite"><span><Check size={18} /></span><div><strong>{mensagem}</strong><small>Status atual: {comanda.status}</small></div></div>}

      <div className={styles.comandaFluxo}>
        <div className={styles.acoesTopo}>
          <button type="button" className={styles.botaoSecundario} onClick={() => navigate('/garcom/mesas')}>
            <ArrowLeft size={16} /> Mesas
          </button>
        </div>

        <section className={styles.painel}>
          {categoriaAberta ? (
            <>
              <div className={styles.topoPainel}>
                <h2>{categoriaAberta.nome}</h2>
                <button type="button" className={styles.botaoSecundario} onClick={() => setCategoriaAbertaId(null)}>
                  <ArrowLeft size={16} /> Categorias
                </button>
              </div>

              <div className={styles.gradeCatalogo}>
                {produtosDaCategoria.map((produto) => (
                  <button
                    type="button"
                    key={produto.id}
                    className={styles.itemCatalogo}
                    disabled={Boolean(processando)}
                    aria-label={`Adicionar ${produto.nome} — ${moeda(numeroPreco(produto.preco))}`}
                    onClick={() => abrirProduto(produto)}
                  >
                    <img src={produto.imagem} alt="" loading="lazy" decoding="async" onError={usarPlaceholderProduto} />
                    <span>{produto.nome}</span>
                  </button>
                ))}
              </div>

              {produtosDaCategoria.length === 0 && <div className={styles.vazio} role="status">Nenhum produto nesta categoria.</div>}
            </>
          ) : (
            <>
              {/* Sem cabeçalho: a grade de nomes já diz o que fazer, e a barra
                  do topo continua mostrando de qual mesa é a comanda. */}
              <div className={styles.gradeCategorias}>
                {categoriasDoSalao.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={styles.botaoCategoria}
                    onClick={() => setCategoriaAbertaId(item.id)}
                  >
                    {item.nome}
                  </button>
                ))}
              </div>

              {categoriasDoSalao.length === 0 && <div className={styles.vazio} role="status">Nenhum produto liberado para o salão. Cadastre no painel, em Cardápio, marcando "Onde aparece" como salão.</div>}
            </>
          )}
        </section>

        <section className={`${styles.painel} ${styles.painelConsumo}`}>
          <div className={styles.topoPainel}>
            <div>
              <h2>Consumo da mesa</h2>
              <p>
                {comanda.itens.length} {comanda.itens.length === 1 ? 'lançamento' : 'lançamentos'}
                {pendentes.length > 0 && ` • ${pendentes.length} aguardando lançamento`}
              </p>
            </div>
            {pendentes.length > 0 && (
              <button
                type="button"
                className={styles.botaoSecundario}
                disabled={Boolean(processando)}
                onClick={limparPendentes}
              >
                <Trash2 size={16} /> {processando === 'limpar' ? 'Excluindo…' : 'Excluir não lançados'}
              </button>
            )}
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
                  className={`${styles.itemComanda} ${item.enviado ? '' : styles.itemPendente}`}
                  key={item.linhaId ?? `${item.id}-${indice}`}
                >
                  <span className={styles.itemHora}>{item.lancadoEm ?? '—'}</span>
                  <span className={styles.itemDescricao}>
                    <strong>{item.nome}</strong>
                    {item.adicionais?.length > 0 && <small>+ {item.adicionais.map((extra) => extra.nome ?? extra).join(', ')}</small>}
                    {item.observacao && <small>{item.observacao}</small>}
                    <small className={item.enviado ? styles.marcaLancado : styles.marcaPendente}>
                      {item.enviado
                        ? `Lançado às ${item.enviadoEm}${rotuloAutor(item.enviadoPor) ? ` por ${rotuloAutor(item.enviadoPor)}` : ''}`
                        : 'Aguardando lançamento'}
                    </small>
                  </span>
                  <span className={styles.itemQuantidade}>{item.quantidade}</span>
                  <span className={styles.itemValor}>{moeda(Number(item.preco) * item.quantidade)}</span>
                  {item.enviado ? (
                    <span className={styles.itemBloqueado} title="Item já lançado: só o painel pode remover">—</span>
                  ) : (
                    <button
                      disabled={Boolean(processando)}
                      type="button"
                      className={styles.itemRemover}
                      aria-label={`Remover ${item.nome}`}
                      onClick={() => removerItem(item.linhaId ?? item.id)}
                    ><Trash2 size={15} /></button>
                  )}
                </div>
              ))}
            </div>
          )}

          {comanda.status === 'Conta solicitada' && (
            <div className={styles.vazio} role="status">
              Conta solicitada. O pagamento e o fechamento da comanda são feitos no caixa.
            </div>
          )}
        </section>
      </div>

      <div className={styles.barraTotal}>
        <div className={styles.barraValores}>
          <span>{quantidadeItens} {quantidadeItens === 1 ? 'item' : 'itens'}</span>
          <strong>{moeda(total)}</strong>
        </div>
        {podeLancar && (
          <button
            type="button"
            className={styles.botaoPrincipal}
            disabled={Boolean(processando)}
            onClick={() => setConfirmacaoAberta(true)}
          >
            <Send size={17} />
            {processando === 'enviar' ? 'Lançando…' : `Lançar para a cozinha (${pendentes.length})`}
          </button>
        )}
      </div>

      {confirmacaoAberta && (
        <div className={styles.modalFundo} onClick={() => setConfirmacaoAberta(false)}>
          <div
            className={styles.modal}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-confirmar-lancamento-garcom"
            onClick={(evento) => evento.stopPropagation()}
          >
            <div className={styles.modalTopo}>
              <div>
                <h2 id="titulo-confirmar-lancamento-garcom">Confirmar lançamento</h2>
                <p>Revise antes de enviar para a cozinha da mesa {mesa.numero}.</p>
              </div>
              <button type="button" ref={fecharModalRef} aria-label="Fechar confirmação" onClick={() => setConfirmacaoAberta(false)}><X size={21} /></button>
            </div>
            <div className={styles.listaConfirmacao}>
              {pendentes.map((item) => (
                <div className={styles.itemConfirmacao} key={`pendente-${item.linhaId ?? item.id}`}>
                  <span>
                    <strong>{item.quantidade}× {item.nome}</strong>
                    {item.observacao && <small>{item.observacao}</small>}
                  </span>
                  <strong>{moeda(Number(item.preco) * item.quantidade)}</strong>
                </div>
              ))}
              {pendentes.length === 0 && <div className={styles.vazio}>Nenhum item pendente de lançamento.</div>}
            </div>
            <div className={styles.modalRodape}>
              <span>{pendentes.length} {pendentes.length === 1 ? 'item' : 'itens'} • {moeda(totalPendente)}</span>
              <button
                type="button"
                className={styles.botaoPrincipal}
                disabled={Boolean(processando) || pendentes.length === 0}
                onClick={enviar}
              >
                {processando === 'enviar' ? 'Lançando…' : 'Confirmar e lançar'}
              </button>
            </div>
          </div>
        </div>
      )}

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
