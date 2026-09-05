import {
  Minus,
  Plus,
  ReceiptText,
  Store,
  Trash2,
  UserRound
} from 'lucide-react';
import { useMemo, useState } from 'react';

import AdminLayout from '../../../components/AdminLayout';
import GradeMesas from '../../../components/GradeMesas';
import { useApp } from '../../../context/appContext';
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
    finalizarComandaAdmin
  } = useApp();
  const [mesaSelecionadaId, setMesaSelecionadaId] = useState(null);
  const [formularioMesaAberto, setFormularioMesaAberto] = useState(false);
  const [numeroMesa, setNumeroMesa] = useState('');
  const [produtoId, setProdutoId] = useState('');
  const [responsavelId, setResponsavelId] = useState('');
  const [pagamento, setPagamento] = useState('Cartão');
  const [processando, setProcessando] = useState('');
  const [erro, setErro] = useState('');

  const comandasAbertas = comandas.filter((comanda) => comanda.status !== 'Encerrada');
  const mesaSelecionada = mesas.find((mesa) => mesa.id === mesaSelecionadaId) ?? null;
  const comandaSelecionada = mesaSelecionada
    ? comandasAbertas.find((comanda) => comanda.mesaId === mesaSelecionada.id) ?? null
    : null;
  const itens = comandaSelecionada?.itens ?? [];
  const subtotal = itens.reduce((soma, item) => soma + Number(item.preco) * item.quantidade, 0);
  const quantidadeItens = itens.reduce((soma, item) => soma + item.quantidade, 0);

  const produtosAtivos = useMemo(() => produtos.filter((produto) => produto.ativo), [produtos]);
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

  async function adicionarProduto() {
    if (!comandaSelecionada || !produtoId) return;
    const concluiu = await executar(
      'adicionar',
      () => adicionarItemComandaAdmin(comandaSelecionada.id, Number(produtoId))
    );
    if (concluiu) setProdutoId('');
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

  async function finalizar() {
    if (!comandaSelecionada || !pagamentoSelecionado) return;
    if (!window.confirm(`Finalizar a comanda da mesa ${mesaSelecionada.numero} em ${pagamentoSelecionado}?`)) return;
    const concluiu = await executar(
      'finalizar',
      () => finalizarComandaAdmin(comandaSelecionada.id, pagamentoSelecionado)
    );
    if (concluiu) setMesaSelecionadaId(null);
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
              aoSelecionar={(mesa) => { setMesaSelecionadaId(mesa.id); setErro(''); }}
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

              <div className={compartilhado.adicionarProdutoComanda}>
                <label className={compartilhado.campo}>
                  <span>Adicionar produto</span>
                  <select value={produtoId} onChange={(evento) => setProdutoId(evento.target.value)}>
                    <option value="">Selecione no cardápio</option>
                    {produtosAtivos.map((produto) => (
                      <option key={produto.id} value={produto.id}>
                        {produto.nome} — {moeda(numeroPreco(produto.preco))}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={compartilhado.botaoPrimario}
                  disabled={!produtoId || Boolean(processando)}
                  onClick={adicionarProduto}
                >
                  <Plus size={17} /> {processando === 'adicionar' ? 'Adicionando…' : 'Adicionar item'}
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

                {itens.map((item, indice) => (
                  <div
                    key={item.linhaId}
                    role="row"
                    className={`${styles.linha} ${indice === itens.length - 1 ? styles.linhaRecente : ''}`}
                  >
                    <span role="cell" className={styles.hora}>{item.lancadoEm ?? '—'}</span>
                    <span role="cell" className={styles.descricao}>
                      <strong>{item.nome}</strong>
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
                  <label className={compartilhado.campo}>
                    <span>Pagamento</span>
                    <select value={pagamentoSelecionado} onChange={(evento) => setPagamento(evento.target.value)}>
                      {formasPagamento.map((forma) => <option key={forma} value={forma}>{forma}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    className={compartilhado.botaoPrimario}
                    disabled={Boolean(processando) || itens.length === 0 || formasPagamento.length === 0}
                    onClick={finalizar}
                  >
                    {processando === 'finalizar' ? 'Finalizando…' : 'Finalizar comanda'}
                  </button>
                </div>
              </footer>
            </>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}

export default MesasAdmin;
