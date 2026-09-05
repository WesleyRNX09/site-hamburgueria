import {
  BookOpen,
  Minus,
  Plus,
  Printer,
  ReceiptText,
  Banknote,
  Send,
  Store,
  Trash2,
  UserRound,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import AdminLayout from '../../../components/AdminLayout';
import GradeMesas from '../../../components/GradeMesas';
import { useApp } from '../../../context/appContext';
import { usarPlaceholderProduto } from '../../../utils/productImage';
import { rotuloDoStatus, statusDaMesa } from '../../../utils/statusMesa';
import compartilhado from '../shared.module.css';
import styles from './index.module.css';

function moeda(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

/*
  O painel não distingue "Na cozinha": para quem opera o caixa a mesa está
  em atendimento até a conta ser pedida. O status continua existindo no
  backend e no app do garçom — aqui ele só não vira uma cor própria.
*/
function statusNoPainel(mesa, comanda) {
  const status = statusDaMesa(mesa, comanda);
  return status === 'cozinha' ? 'aberta' : status;
}

function MesasAdmin() {
  const {
    mesas,
    comandas,
    produtos,
    funcionarios,
    configuracao,
    numeroPreco,
    criarMesaAdmin,
    abrirComandaAdmin,
    adicionarItemComandaAdmin,
    atualizarItemComandaAdmin,
    removerItemComandaAdmin,
    lancarComandaAdmin,
    limparItensPendentesAdmin,
    cancelarComandaAdmin,
    finalizarComandaAdmin
  } = useApp();
  const [mesaSelecionadaId, setMesaSelecionadaId] = useState(null);
  const [formularioMesaAberto, setFormularioMesaAberto] = useState(false);
  const [numeroMesa, setNumeroMesa] = useState('');
  const [responsavelId, setResponsavelId] = useState('');
  const [pagamento, setPagamento] = useState('Cartão');
  const [processando, setProcessando] = useState('');
  const [erro, setErro] = useState('');
  const [cardapioAberto, setCardapioAberto] = useState(false);
  const [confirmacaoAberta, setConfirmacaoAberta] = useState(false);
  const [pagamentoAberto, setPagamentoAberto] = useState(false);
  const [valorRecebido, setValorRecebido] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [categoriaCardapio, setCategoriaCardapio] = useState('Todos');
  const [ultimoAdicionado, setUltimoAdicionado] = useState('');
  const modalRef = useRef(null);
  const fecharModalRef = useRef(null);

  const comandasAbertas = comandas.filter((comanda) => comanda.status !== 'Encerrada');
  const mesaSelecionada = mesas.find((mesa) => mesa.id === mesaSelecionadaId) ?? null;
  const comandaSelecionada = mesaSelecionada
    ? comandasAbertas.find((comanda) => comanda.mesaId === mesaSelecionada.id) ?? null
    : null;
  const itens = comandaSelecionada?.itens ?? [];
  // O que ainda não foi para a cozinha: destacado na tabela e único conteúdo
  // do lançamento, para que nenhum clique errado vire pedido sem revisão.
  const pendentes = itens.filter((item) => !item.enviado);
  const totalPendente = pendentes.reduce(
    (soma, item) => soma + Number(item.preco) * item.quantidade,
    0
  );
  const subtotal = itens.reduce((soma, item) => soma + Number(item.preco) * item.quantidade, 0);
  const quantidadeItens = itens.reduce((soma, item) => soma + item.quantidade, 0);

  const produtosAtivos = useMemo(() => produtos.filter((produto) => produto.ativo), [produtos]);
  const categoriasCardapio = useMemo(
    () => ['Todos', ...new Set(produtosAtivos.map((produto) => produto.categoria))],
    [produtosAtivos]
  );
  const produtosDoCardapio = produtosAtivos.filter(
    (produto) => categoriaCardapio === 'Todos' || produto.categoria === categoriaCardapio
  );
  const garconsAtivos = funcionarios.filter((funcionario) => funcionario.status === 'Ativo');
  const responsavelSelecionado = garconsAtivos.some((item) => item.id === responsavelId)
    ? responsavelId
    : (garconsAtivos[0]?.id ?? '');
  const formasPagamento = [
    configuracao.pixChave && configuracao.pixBeneficiario && configuracao.pixCidade ? 'Pix' : null,
    configuracao.aceitaCartao !== false ? 'Cartão' : null,
    configuracao.aceitaDinheiro !== false ? 'Dinheiro' : null
  ].filter(Boolean);
  const pagamentoSelecionado = formasPagamento.includes(pagamento)
    ? pagamento
    : (formasPagamento[0] ?? '');

  /* Mesmo comportamento do modal do garçom: Esc fecha, o foco fica preso no
     diálogo e a página atrás não rola enquanto o cardápio está aberto. */
  const modalAberto = cardapioAberto || confirmacaoAberta || pagamentoAberto;
  /* O caixa digita "132,70" ou "132.70": as duas formas viram o mesmo
     número aqui, e o servidor refaz a conta ao confirmar. */
  const recebidoNumero = Number(String(valorRecebido).replace(/\./g, '').replace(',', '.'));
  const recebidoInformado = valorRecebido.trim() !== '' && Number.isFinite(recebidoNumero);
  const emDinheiro = pagamentoSelecionado === 'Dinheiro';
  const recebidoInsuficiente = emDinheiro && recebidoInformado && recebidoNumero < subtotal;
  const troco = emDinheiro && recebidoInformado ? recebidoNumero - subtotal : 0;

  function fecharModais() {
    setCardapioAberto(false);
    setConfirmacaoAberta(false);
    setPagamentoAberto(false);
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

  function abrirFormularioMesa() {
    const maiorNumero = Math.max(0, ...mesas.map((mesa) => Number(mesa.numero) || 0));
    setNumeroMesa(String(maiorNumero + 1).padStart(2, '0'));
    setFormularioMesaAberto(true);
    setErro('');
  }

  async function executar(chave, operacao) {
    if (processando) return false;
    setProcessando(chave);
    setErro('');
    try {
      await operacao();
      return true;
    } catch (falha) {
      setErro(falha.message);
      return false;
    } finally {
      setProcessando('');
    }
  }

  async function cadastrarMesa(evento) {
    evento.preventDefault();
    const concluiu = await executar('mesa', () => criarMesaAdmin(numeroMesa));
    if (concluiu) {
      setFormularioMesaAberto(false);
      setNumeroMesa('');
    }
  }

  async function abrirComanda() {
    if (!mesaSelecionada || !responsavelSelecionado) return;
    await executar('abrir', () => abrirComandaAdmin(mesaSelecionada.id, responsavelSelecionado));
  }

  function abrirCardapio() {
    setCategoriaCardapio('Todos');
    setUltimoAdicionado('');
    setErro('');
    setCardapioAberto(true);
  }

  async function adicionarProduto(produto) {
    if (!comandaSelecionada) return;
    const concluiu = await executar(
      `adicionar-${produto.id}`,
      () => adicionarItemComandaAdmin(comandaSelecionada.id, produto.id)
    );
    if (concluiu) setUltimoAdicionado(produto.nome);
  }

  async function ajustarQuantidade(item, quantidade) {
    if (!comandaSelecionada || quantidade < 1) return;
    await executar(
      `item-${item.linhaId}`,
      () => atualizarItemComandaAdmin(comandaSelecionada.id, item.linhaId, quantidade)
    );
  }

  async function removerItem(item) {
    if (!comandaSelecionada) return;
    await executar(
      `item-${item.linhaId}`,
      () => removerItemComandaAdmin(comandaSelecionada.id, item.linhaId)
    );
  }

  async function lancarPedido() {
    if (!comandaSelecionada) return;
    const concluiu = await executar('lancar', () => lancarComandaAdmin(comandaSelecionada.id));
    if (concluiu) setConfirmacaoAberta(false);
  }

  async function limparPendentes() {
    if (!comandaSelecionada || pendentes.length === 0) return;
    const rotulo = pendentes.length === 1 ? '1 item ainda não lançado' : `${pendentes.length} itens ainda não lançados`;
    if (!window.confirm(`Excluir ${rotulo} da mesa ${mesaSelecionada.numero}?`)) return;
    await executar('limpar', () => limparItensPendentesAdmin(comandaSelecionada.id));
  }

  async function cancelarComanda() {
    if (!comandaSelecionada) return;
    if (!window.confirm(
      `Cancelar a comanda da mesa ${mesaSelecionada.numero}? A mesa será liberada sem cobrança.`
    )) return;
    const concluiu = await executar('cancelar', () => cancelarComandaAdmin(comandaSelecionada.id));
    if (concluiu) {
      fecharModais();
      setMesaSelecionadaId(null);
    }
  }

  function abrirPagamento() {
    setValorRecebido('');
    setErro('');
    setPagamentoAberto(true);
  }

  function imprimirConta() {
    // O cupom já está montado na página e só fica visível na impressão:
    // nada é enviado para fora e a conta sai igual ao que está na tela.
    window.print();
  }

  async function finalizar() {
    if (!comandaSelecionada || !pagamentoSelecionado || recebidoInsuficiente) return;
    const numeroMesaAtual = mesaSelecionada.numero;
    let confirmado = null;
    const concluiu = await executar('finalizar', async () => {
      confirmado = await finalizarComandaAdmin(
        comandaSelecionada.id,
        pagamentoSelecionado,
        emDinheiro && recebidoInformado ? valorRecebido : null
      );
    });
    if (concluiu) {
      const trocoConfirmado = (confirmado?.trocoCentavos ?? 0) / 100;
      setMensagem(
        `Comanda da mesa ${numeroMesaAtual} finalizada em ${pagamentoSelecionado}.`
        + (trocoConfirmado > 0 ? ` Troco: ${moeda(trocoConfirmado)}.` : '')
      );
      fecharModais();
      setValorRecebido('');
      setMesaSelecionadaId(null);
    }
  }

  const acao = (
    <button type="button" className={compartilhado.botaoPrimario} onClick={abrirFormularioMesa}>
      <Plus size={17} /> Adicionar mesa
    </button>
  );

  return (
    <AdminLayout
      titulo="Mesas / Comandas"
      subtitulo="Escolha a mesa e acompanhe o consumo sem sair desta tela."
      acao={acao}
    >
      {formularioMesaAberto && (
        <section className={`${compartilhado.card} ${compartilhado.secaoComMargemInferior}`}>
          <div className={compartilhado.topoCard}>
            <div><h2>Adicionar mesa</h2><p>Crie um novo cartão usando o número da mesa.</p></div>
          </div>
          <form className={compartilhado.formularioMesa} onSubmit={cadastrarMesa}>
            <div className={compartilhado.campo}>
              <label htmlFor="numero-mesa">Número da mesa</label>
              <input
                id="numero-mesa"
                inputMode="numeric"
                maxLength={3}
                pattern="[0-9]{1,3}"
                required
                value={numeroMesa}
                onChange={(evento) => setNumeroMesa(evento.target.value.replace(/\D/g, '').slice(0, 3))}
              />
            </div>
            <div className={compartilhado.acoesFormularioMesa}>
              <button type="button" className={compartilhado.botaoSecundario} onClick={() => setFormularioMesaAberto(false)}>Cancelar</button>
              <button type="submit" className={compartilhado.botaoPrimario} disabled={processando === 'mesa'}>
                {processando === 'mesa' ? 'Adicionando…' : 'Adicionar'}
              </button>
            </div>
          </form>
        </section>
      )}

      {erro && <div className={`${compartilhado.erro} ${compartilhado.secaoComMargemInferior}`} role="alert">{erro}</div>}

      {mensagem && (
        <div className={`${compartilhado.sucesso} ${compartilhado.secaoComMargemInferior}`} role="status">
          {mensagem}
        </div>
      )}

      <div className={styles.area}>
        <section className={styles.coluna} aria-label="Mapa do salão">
          <header className={styles.cabecalhoColuna}>
            <div>
              <h2>Salão</h2>
              <p>{mesas.length} mesas</p>
            </div>
          </header>

          {mesas.length === 0 ? (
            <div className={styles.vazio}>
              <Store size={30} />
              <p>Nenhuma mesa cadastrada. Use &ldquo;Adicionar mesa&rdquo; para começar.</p>
            </div>
          ) : (
            <GradeMesas
              mesas={mesas}
              selecionadaId={mesaSelecionadaId}
              statusPorMesa={(mesa) => statusNoPainel(
                mesa,
                comandasAbertas.find((comanda) => comanda.mesaId === mesa.id)
              )}
              aoSelecionar={(mesa) => {
                setMesaSelecionadaId(mesa.id);
                fecharModais();
                setErro('');
                setMensagem('');
              }}
            />
          )}
        </section>

        <section className={`${styles.coluna} ${styles.colunaComanda}`} aria-label="Comanda da mesa">
          {!mesaSelecionada && (
            <div className={styles.vazio}>
              <ReceiptText size={32} />
              <h3>Selecione uma mesa</h3>
              <p>O consumo lançado aparece aqui, com o total sempre visível.</p>
            </div>
          )}

          {mesaSelecionada && !comandaSelecionada && (
            <>
              <header className={styles.cabecalhoColuna}>
                <div>
                  <h2>Mesa {mesaSelecionada.numero}</h2>
                  <p>{rotuloDoStatus(statusNoPainel(mesaSelecionada, null))}</p>
                </div>
              </header>
              <div className={styles.vazio}>
                <ReceiptText size={32} />
                <h3>Nenhuma comanda aberta</h3>
                <p>Escolha o funcionário responsável para começar o atendimento.</p>
              </div>
              <div className={styles.abrirComanda}>
                <label className={compartilhado.campo}>
                  <span>Responsável pela comanda</span>
                  <select
                    value={responsavelSelecionado}
                    disabled={garconsAtivos.length === 0}
                    onChange={(evento) => setResponsavelId(evento.target.value)}
                  >
                    {garconsAtivos.map((funcionario) => (
                      <option key={funcionario.id} value={funcionario.id}>
                        {funcionario.nome} — {funcionario.cargo}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={compartilhado.botaoPrimario}
                  disabled={Boolean(processando) || garconsAtivos.length === 0}
                  onClick={abrirComanda}
                >
                  <UserRound size={17} /> {processando === 'abrir' ? 'Abrindo…' : 'Abrir comanda'}
                </button>
                {garconsAtivos.length === 0 && (
                  <p className={styles.aviso}>
                    Cadastre um funcionário ativo para abrir comandas pelo painel.
                  </p>
                )}
              </div>
            </>
          )}

          {mesaSelecionada && comandaSelecionada && (
            <>
              <header className={styles.cabecalhoColuna}>
                <div>
                  <h2>Mesa {mesaSelecionada.numero}</h2>
                  <p>{comandaSelecionada.garcom} • aberta às {comandaSelecionada.abertaEm}</p>
                </div>
                <span className={`${styles.selo} ${styles[statusNoPainel(mesaSelecionada, comandaSelecionada)]}`}>
                  Em atendimento
                </span>
              </header>

              <div className={styles.acoesPedido}>
                <button
                  type="button"
                  className={compartilhado.botaoPrimario}
                  disabled={Boolean(processando) || pendentes.length === 0}
                  onClick={() => setConfirmacaoAberta(true)}
                >
                  <Send size={16} />
                  {pendentes.length === 0
                    ? 'Lançar pedido'
                    : `Lançar pedido (${pendentes.length})`}
                </button>
                <button
                  type="button"
                  className={compartilhado.botaoSecundario}
                  disabled={Boolean(processando) || pendentes.length === 0}
                  onClick={limparPendentes}
                >
                  <Trash2 size={16} /> {processando === 'limpar' ? 'Excluindo…' : 'Excluir não lançados'}
                </button>
                <button
                  type="button"
                  className={compartilhado.botaoSecundario}
                  disabled={itens.length === 0}
                  onClick={imprimirConta}
                >
                  <Printer size={16} /> Imprimir conta
                </button>
                <button
                  type="button"
                  className={compartilhado.botaoPerigo}
                  disabled={Boolean(processando)}
                  onClick={cancelarComanda}
                >
                  <X size={16} /> {processando === 'cancelar' ? 'Cancelando…' : 'Excluir pedido'}
                </button>
              </div>

              {pendentes.length > 0 && (
                <p className={styles.aviso}>
                  {pendentes.length === 1
                    ? '1 item ainda não foi lançado para a cozinha.'
                    : `${pendentes.length} itens ainda não foram lançados para a cozinha.`}
                </p>
              )}

              <div className={styles.barraCardapio}>
                <div>
                  <strong>Adicionar produto</strong>
                  <p>Abra o cardápio completo e toque no item para lançar na comanda.</p>
                </div>
                <button
                  type="button"
                  className={compartilhado.botaoPrimario}
                  disabled={Boolean(processando) || produtosAtivos.length === 0}
                  onClick={abrirCardapio}
                >
                  <BookOpen size={17} /> Ver cardápio
                </button>
              </div>

              <div className={styles.tabela} role="table" aria-label={`Itens da mesa ${mesaSelecionada.numero}`}>
                <div className={styles.tabelaCabecalho} role="row">
                  <span role="columnheader">Hora</span>
                  <span role="columnheader">Descrição</span>
                  <span role="columnheader">Qtde</span>
                  <span role="columnheader">Unit.</span>
                  <span role="columnheader">Valor</span>
                  <span role="columnheader"><span className={styles.oculto}>Ações</span></span>
                </div>

                {itens.length === 0 && (
                  <p className={styles.tabelaVazia}>
                    Nenhum item lançado nesta comanda.
                  </p>
                )}

                {itens.map((item) => (
                  <div
                    key={item.linhaId}
                    role="row"
                    className={`${styles.linha} ${item.enviado ? '' : styles.linhaPendente}`}
                  >
                    <span role="cell" className={styles.hora}>{item.lancadoEm ?? '—'}</span>
                    <span role="cell" className={styles.descricao}>
                      <strong>{item.nome}</strong>
                      <small className={item.enviado ? styles.marcaLancado : styles.marcaPendente}>
                        {item.enviado ? `Lançado às ${item.enviadoEm}` : 'Aguardando lançamento'}
                      </small>
                      {item.adicionais?.length > 0 && <small>+ {item.adicionais.map((adicional) => adicional.nome).join(', ')}</small>}
                      {item.observacao && <small>{item.observacao}</small>}
                    </span>
                    <span role="cell" className={styles.controleQuantidade}>
                      <button
                        type="button"
                        aria-label={`Diminuir ${item.nome}`}
                        disabled={Boolean(processando) || item.quantidade <= 1}
                        onClick={() => ajustarQuantidade(item, item.quantidade - 1)}
                      ><Minus size={14} /></button>
                      <strong>{item.quantidade}</strong>
                      <button
                        type="button"
                        aria-label={`Aumentar ${item.nome}`}
                        disabled={Boolean(processando)}
                        onClick={() => ajustarQuantidade(item, item.quantidade + 1)}
                      ><Plus size={14} /></button>
                    </span>
                    <span role="cell" className={styles.numero}>{moeda(Number(item.preco))}</span>
                    <span role="cell" className={`${styles.numero} ${styles.valor}`}>
                      {moeda(Number(item.preco) * item.quantidade)}
                    </span>
                    <span role="cell" className={styles.celulaAcoes}>
                      <button
                        type="button"
                        className={styles.remover}
                        aria-label={`Remover ${item.nome}`}
                        disabled={Boolean(processando)}
                        onClick={() => removerItem(item)}
                      ><Trash2 size={15} /></button>
                    </span>
                  </div>
                ))}
              </div>

              <footer className={styles.rodapeComanda}>
                <dl className={styles.totais}>
                  <div><dt>Itens</dt><dd>{quantidadeItens}</dd></div>
                  <div><dt>Subtotal</dt><dd>{moeda(subtotal)}</dd></div>
                  <div className={styles.totalPrincipal}><dt>Total</dt><dd>{moeda(subtotal)}</dd></div>
                </dl>
                <div className={styles.acoesComanda}>
                  <button
                    type="button"
                    className={compartilhado.botaoPrimario}
                    disabled={Boolean(processando) || itens.length === 0 || formasPagamento.length === 0}
                    onClick={abrirPagamento}
                  >
                    <Banknote size={17} /> Finalizar comanda
                  </button>
                  {formasPagamento.length === 0 && (
                    <p className={styles.aviso}>
                      Habilite ao menos uma forma de pagamento nas configurações.
                    </p>
                  )}
                </div>
              </footer>
            </>
          )}
        </section>
      </div>

      {mesaSelecionada && comandaSelecionada && (
        <section className={styles.cupom} aria-hidden="true">
          <h1>{configuracao.nomeLoja ?? 'Conta'}</h1>
          <p>
            Mesa {mesaSelecionada.numero} • {comandaSelecionada.garcom}
            {' '}• aberta às {comandaSelecionada.abertaEm}
          </p>
          <table>
            <thead>
              <tr><th>Qtde</th><th>Item</th><th>Unit.</th><th>Valor</th></tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={`cupom-${item.linhaId}`}>
                  <td>{item.quantidade}</td>
                  <td>
                    {item.nome}
                    {item.adicionais?.length > 0 && ` (+ ${item.adicionais.map((adicional) => adicional.nome).join(', ')})`}
                  </td>
                  <td>{moeda(Number(item.preco))}</td>
                  <td>{moeda(Number(item.preco) * item.quantidade)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.cupomTotal}>
            {quantidadeItens} {quantidadeItens === 1 ? 'item' : 'itens'} • Total {moeda(subtotal)}
          </p>
          <p>Documento sem valor fiscal.</p>
        </section>
      )}

      {pagamentoAberto && mesaSelecionada && comandaSelecionada && (
        <div className={styles.modalFundo} onClick={() => setPagamentoAberto(false)}>
          <div
            className={styles.modal}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-pagamento-comanda"
            onClick={(evento) => evento.stopPropagation()}
          >
            <header className={styles.modalTopo}>
              <div>
                <h2 id="titulo-pagamento-comanda">Receber pagamento</h2>
                <p>Mesa {mesaSelecionada.numero} • {quantidadeItens} {quantidadeItens === 1 ? 'item' : 'itens'}</p>
              </div>
              <button
                type="button"
                ref={fecharModalRef}
                className={styles.fecharModal}
                aria-label="Fechar pagamento"
                onClick={() => setPagamentoAberto(false)}
              ><X size={20} /></button>
            </header>

            <div className={styles.totalPagamento}>
              <span>Total da conta</span>
              <strong>{moeda(subtotal)}</strong>
            </div>

            <div className={styles.formasPagamento} role="group" aria-label="Forma de pagamento">
              {formasPagamento.map((forma) => (
                <button
                  type="button"
                  key={forma}
                  aria-pressed={pagamentoSelecionado === forma}
                  className={`${styles.formaPagamento} ${pagamentoSelecionado === forma ? styles.formaAtiva : ''}`}
                  onClick={() => { setPagamento(forma); setValorRecebido(''); }}
                >
                  {forma}
                </button>
              ))}
            </div>

            {emDinheiro && (
              <div className={styles.blocoTroco}>
                <label className={compartilhado.campo}>
                  <span>Valor recebido do cliente</span>
                  <input
                    inputMode="decimal"
                    placeholder={moeda(subtotal)}
                    value={valorRecebido}
                    onChange={(evento) => setValorRecebido(evento.target.value.replace(/[^\d.,]/g, ''))}
                  />
                </label>
                <button
                  type="button"
                  className={compartilhado.botaoSecundario}
                  onClick={() => setValorRecebido(subtotal.toFixed(2).replace('.', ','))}
                >
                  Valor exato
                </button>
                <p className={recebidoInsuficiente ? styles.trocoInvalido : styles.troco}>
                  {recebidoInsuficiente
                    ? `Faltam ${moeda(subtotal - recebidoNumero)} para fechar a conta.`
                    : `Troco: ${moeda(troco)}`}
                </p>
              </div>
            )}

            {!emDinheiro && (
              <p className={styles.resumoCardapio}>
                Pagamento confirmado no caixa. A integração com gateway, quando existir,
                entra por aqui sem mudar esta tela.
              </p>
            )}

            {erro && <div className={compartilhado.erro} role="alert">{erro}</div>}

            <footer className={styles.modalRodape}>
              <p className={styles.resumoCardapio}>
                {pagamentoSelecionado || 'Selecione a forma de pagamento'}
              </p>
              <div className={styles.acoesConfirmacao}>
                <button
                  type="button"
                  className={compartilhado.botaoSecundario}
                  onClick={() => setPagamentoAberto(false)}
                >
                  Voltar
                </button>
                <button
                  type="button"
                  className={compartilhado.botaoPrimario}
                  disabled={
                    Boolean(processando)
                    || itens.length === 0
                    || !pagamentoSelecionado
                    || recebidoInsuficiente
                  }
                  onClick={finalizar}
                >
                  {processando === 'finalizar' ? 'Finalizando…' : 'Confirmar pagamento'}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {confirmacaoAberta && mesaSelecionada && comandaSelecionada && (
        <div className={styles.modalFundo} onClick={() => setConfirmacaoAberta(false)}>
          <div
            className={styles.modal}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-confirmar-lancamento"
            onClick={(evento) => evento.stopPropagation()}
          >
            <header className={styles.modalTopo}>
              <div>
                <h2 id="titulo-confirmar-lancamento">Confirmar lançamento</h2>
                <p>Confira os itens antes de enviar para a cozinha da mesa {mesaSelecionada.numero}.</p>
              </div>
              <button
                type="button"
                ref={fecharModalRef}
                className={styles.fecharModal}
                aria-label="Fechar confirmação"
                onClick={() => setConfirmacaoAberta(false)}
              ><X size={20} /></button>
            </header>

            {pendentes.length === 0 ? (
              <p className={styles.tabelaVazia}>Nenhum item pendente: tudo já foi lançado.</p>
            ) : (
              <ul className={styles.listaConfirmacao}>
                {pendentes.map((item) => (
                  <li key={`pendente-${item.linhaId}`}>
                    <span>
                      <strong>{item.quantidade}× {item.nome}</strong>
                      {item.observacao && <small>{item.observacao}</small>}
                    </span>
                    <strong className={styles.valor}>
                      {moeda(Number(item.preco) * item.quantidade)}
                    </strong>
                  </li>
                ))}
              </ul>
            )}

            {erro && <div className={compartilhado.erro} role="alert">{erro}</div>}

            <footer className={styles.modalRodape}>
              <p className={styles.resumoCardapio}>
                {pendentes.length} {pendentes.length === 1 ? 'item' : 'itens'} • {moeda(totalPendente)}
              </p>
              <div className={styles.acoesConfirmacao}>
                <button
                  type="button"
                  className={compartilhado.botaoSecundario}
                  onClick={() => setConfirmacaoAberta(false)}
                >
                  Voltar
                </button>
                <button
                  type="button"
                  className={compartilhado.botaoPrimario}
                  disabled={Boolean(processando) || pendentes.length === 0}
                  onClick={lancarPedido}
                >
                  <Send size={16} /> {processando === 'lancar' ? 'Lançando…' : 'Confirmar e lançar'}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {cardapioAberto && mesaSelecionada && comandaSelecionada && (
        <div className={styles.modalFundo} onClick={() => setCardapioAberto(false)}>
          <div
            className={styles.modal}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-cardapio-comanda"
            onClick={(evento) => evento.stopPropagation()}
          >
            <header className={styles.modalTopo}>
              <div>
                <h2 id="titulo-cardapio-comanda">Cardápio</h2>
                <p>Toque em um produto para lançar na mesa {mesaSelecionada.numero}.</p>
              </div>
              <button
                type="button"
                ref={fecharModalRef}
                className={styles.fecharModal}
                aria-label="Fechar cardápio"
                onClick={() => setCardapioAberto(false)}
              ><X size={20} /></button>
            </header>

            {categoriasCardapio.length > 1 && (
              <div className={styles.categoriasCardapio}>
                {categoriasCardapio.map((item) => (
                  <button
                    type="button"
                    key={item}
                    aria-pressed={categoriaCardapio === item}
                    className={`${styles.categoriaCardapio} ${categoriaCardapio === item ? styles.categoriaAtiva : ''}`}
                    onClick={() => setCategoriaCardapio(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}

            {produtosDoCardapio.length === 0 ? (
              <p className={styles.tabelaVazia}>Nenhum produto ativo nesta categoria.</p>
            ) : (
              <div className={styles.gradeCardapio}>
                {produtosDoCardapio.map((produto) => (
                  <button
                    type="button"
                    key={produto.id}
                    className={styles.cardProduto}
                    disabled={Boolean(processando)}
                    aria-label={`Adicionar ${produto.nome}`}
                    onClick={() => adicionarProduto(produto)}
                  >
                    <img src={produto.imagem} alt="" loading="lazy" decoding="async" onError={usarPlaceholderProduto} />
                    <span className={styles.cardProdutoTexto}>
                      <strong>{produto.nome}</strong>
                      {produto.descricao && <small>{produto.descricao}</small>}
                    </span>
                    <span className={styles.cardProdutoPreco}>
                      {processando === `adicionar-${produto.id}`
                        ? 'Adicionando…'
                        : moeda(numeroPreco(produto.preco))}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {erro && <div className={compartilhado.erro} role="alert">{erro}</div>}

            <footer className={styles.modalRodape}>
              <p className={styles.resumoCardapio} role="status" aria-live="polite">
                {ultimoAdicionado
                  ? `${ultimoAdicionado} lançado na comanda.`
                  : `${quantidadeItens} ${quantidadeItens === 1 ? 'item' : 'itens'} • ${moeda(subtotal)}`}
              </p>
              <button
                type="button"
                className={compartilhado.botaoPrimario}
                onClick={() => setCardapioAberto(false)}
              >
                Concluir
              </button>
            </footer>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

export default MesasAdmin;
