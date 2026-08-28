import { Link, Navigate } from 'react-router-dom';

import LogoEstabelecimento from '../../../components/LogoEstabelecimento';
import { useState } from 'react';

import { useApp } from '../../../context/appContext';
import { usarPlaceholderProduto } from '../../../utils/productImage';
import { QRCodeSVG } from '../../../vendor/qrcode';
import styles from './index.module.css';

function PedidoFinalizado() {

  const [pixCopiado, setPixCopiado] = useState(false);

  const { pedidoAtual, pedidoAtualCarregando, configuracao } = useApp();

  if (pedidoAtualCarregando) {
    return (
      <div className="carregamentoAplicacao" role="status">
        <span />
        <strong>Atualizando os dados do pedido...</strong>
      </div>
    );
  }
  if (!pedidoAtual?.id || !pedidoAtual?.tokenAcompanhamento) return <Navigate to="/" replace />;

  const pedido = pedidoAtual;
  const dataPedido = pedido.criadoEm
    ? new Intl.DateTimeFormat('pt-BR').format(new Date(pedido.criadoEm))
    : '';
  const retirada = pedido.origem === 'Retirada no balcão' || pedido.modalidade === 'retirada';
  const fluxo = retirada
    ? ['Recebido', 'Em preparo', 'Pronto', 'Retirado']
    : ['Recebido', 'Em preparo', 'Saiu para entrega', 'Entregue'];
  const statusNormalizado = pedido.status === 'Pedido recebido'
    ? 'Recebido'
    : pedido.status ?? 'Recebido';
  const pedidoCancelado = statusNormalizado === 'Cancelado';
  const indiceStatus = fluxo.indexOf(statusNormalizado);

  function classeEtapa(indice) {
    if (indice < indiceStatus) {
      return `${styles.etapaStatus} ${styles.etapaConcluida}`;
    }
    if (indice === indiceStatus) {
      return `${styles.etapaStatus} ${styles.etapaAtual}`;
    }
    return styles.etapaStatus;
  }


  const subtotal = pedido.itens.reduce(
    (total, item) =>
      total + item.preco * item.quantidade,
    0
  );


  const total = Number(pedido.total);
  const pagamentoConfirmado = pedido.pagamentoStatus === 'Pago';

  async function copiarPix() {
    const conteudo = pedido.pixCopiaCola || pedido.pixChave;
    try {
      await navigator.clipboard.writeText(conteudo);
      setPixCopiado(true);
      window.setTimeout(() => setPixCopiado(false), 2500);
    } catch {
      setPixCopiado(false);
    }
  }


  return (
    <div className={styles.pagina}>

      {/* =========================
          HEADER
      ========================= */}

      <header className={styles.barraPrincipal}>

        <div className={styles.conteudoHeader}>

          <Link
            to="/"
            className={styles.logo}
          >
            <LogoEstabelecimento
              configuracao={configuracao}
              alternativa={configuracao.nomeLoja || 'Cardápio online'}
            />
          </Link>


          <nav className={styles.menu} aria-label="Navegação principal">

            <Link to="/">
              Início
            </Link>

            <Link to="/">
              Cardápio
            </Link>

            <Link to="/">
              Promoções
            </Link>

            <Link to="/">
              Sobre
            </Link>

            <Link to="/">
              Contato
            </Link>

          </nav>

        </div>

      </header>


      {/* =========================
          CONTEÚDO
      ========================= */}

      <main id="conteudo-principal" className={styles.conteudoPagina}>


        {/* =========================
            CONFIRMAÇÃO
        ========================= */}

        <section className={styles.confirmacao}>

          <div className={styles.iconeConfirmacao}>

            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                d="M5 12.5L9.5 17L19 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>

          </div>


          <div className={styles.textoConfirmacao}>

            <span>
              {pedidoCancelado ? 'PEDIDO CANCELADO' : 'PEDIDO REALIZADO COM SUCESSO'}
            </span>

            <h1>
              Pedido
              <strong>{pedidoCancelado ? ' cancelado.' : ' confirmado!'}</strong>
            </h1>

            <p>
              {pedidoCancelado
                ? 'Este pedido foi cancelado. Entre em contato com a hamburgueria se precisar de ajuda.'
                : 'Obrigado pela preferência! Seu pedido foi recebido e já estamos preparando tudo com muito carinho.'}
            </p>

          </div>

        </section>


        {/* =========================
            INFORMAÇÕES DO PEDIDO
        ========================= */}

        <section className={styles.informacoesPedido}>

          {/* NÚMERO */}

          <div className={styles.infoPedido}>

            <div className={styles.iconeInfo}>

              <svg viewBox="0 0 24 24">
                <path
                  d="M7 3h10v18l-2-1.5L12 21l-3-1.5L7 21V3Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />

                <path
                  d="M10 8h4M10 12h4M10 16h3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>

            </div>


            <div>
              <span>
                Número do pedido
              </span>

              <strong>
                {pedido.id ?? pedido.numero}
              </strong>

              <p>
                {dataPedido} às {pedido.horario}
              </p>
            </div>

          </div>


          {/* PREVISÃO */}

          <div className={styles.infoPedido}>

            <div className={styles.iconeInfo}>

              <svg viewBox="0 0 24 24">

                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />

                <path
                  d="M12 7v5l3 2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />

              </svg>

            </div>


            <div>
              <span>
                {retirada ? 'Previsão de retirada' : 'Previsão de entrega'}
              </span>

              <strong>
                {pedido.previsao ?? configuracao.tempoEntrega}
              </strong>

              <p>
                Tempo estimado
              </p>
            </div>

          </div>


          {/* PAGAMENTO */}

          <div className={styles.infoPedido}>

            <div className={styles.iconeInfo}>

              <svg viewBox="0 0 24 24">

                <rect
                  x="3"
                  y="5"
                  width="18"
                  height="14"
                  rx="2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />

                <path
                  d="M3 10h18"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />

              </svg>

            </div>


            <div>
              <span>
                Forma de pagamento
              </span>

              <strong>
                {pedido.pagamento}
              </strong>

              <p>
                Status: {pedido.pagamentoStatus}
              </p>

              {pedido.pagamento === 'Dinheiro' && (
                <p>{pedido.semTroco === true
                  ? 'Não precisa de troco'
                  : pedido.trocoPara != null
                    ? `Troco para R$ ${Number(pedido.trocoPara).toFixed(2).replace('.', ',')}`
                    : 'Troco não informado'}</p>
              )}
            </div>

          </div>


          {/* ENDEREÇO */}

          <div className={styles.infoPedido}>

            <div className={styles.iconeInfo}>

              <svg viewBox="0 0 24 24">

                <path
                  d="M12 21s7-6 7-12A7 7 0 1 0 5 9c0 6 7 12 7 12Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />

                <circle
                  cx="12"
                  cy="9"
                  r="2.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />

              </svg>

            </div>


            <div>
              <span>
                {retirada ? 'Local de retirada' : 'Endereço de entrega'}
              </span>

              <strong className={styles.endereco}>
                {retirada ? (configuracao.endereco || 'Confirme o endereço com a loja') : pedido.endereco}
              </strong>

              <p>
                {retirada ? 'Retire diretamente no balcão' : 'Entrega no endereço informado'}
              </p>
            </div>

          </div>

        </section>

        {pedido.pagamento === 'Pix' && pedido.pixChave && (
          <section className={styles.dadosPix}>
            {pedido.pixCopiaCola && <div className={styles.qrPix}><QRCodeSVG value={pedido.pixCopiaCola} size={176} level="M" includeMargin aria-label="QR Code Pix do pedido" /></div>}
            <div><strong>Dados do Pix</strong><span>Beneficiário: {pedido.pixBeneficiario}</span><code>{pedido.pixCopiaCola || pedido.pixChave}</code><button type="button" onClick={copiarPix}>{pixCopiado ? 'Pix copiado!' : pedido.pixCopiaCola ? 'Copiar Pix copia e cola' : 'Copiar chave Pix'}</button><p>{pagamentoConfirmado ? 'Pagamento confirmado pela hamburgueria.' : 'O pagamento ainda precisa ser confirmado pela hamburgueria.'}</p></div>
          </section>
        )}


        {/* =========================
            STATUS
        ========================= */}

        <section className={styles.statusPedido}>

          <div className={styles.linhaStatus} />


          {/* RECEBIDO */}

          <div
            className={classeEtapa(0)}
          >

            <div className={styles.circuloStatus}>
              ✓
            </div>

            <strong>
              Pedido recebido
            </strong>

            <span>
              {pedido.horario}
            </span>

          </div>


          {/* PREPARO */}

          <div
            className={classeEtapa(1)}
          >

            <div className={styles.circuloStatus}>
              <svg viewBox="0 0 24 24">
                <path
                  d="M4 15h16M6 15a6 6 0 0 1 12 0M12 7V5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <strong>
              Em preparo
            </strong>

            <span>
              Preparando agora
            </span>

          </div>


          {/* SAIU */}

          <div className={classeEtapa(2)}>

            <div className={styles.circuloStatus}>

              <svg viewBox="0 0 24 24">

                <path
                  d="M4 16h11l2-6h3l1 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />

                <circle
                  cx="7"
                  cy="18"
                  r="2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />

                <circle
                  cx="18"
                  cy="18"
                  r="2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />

              </svg>

            </div>

            <strong>
              {retirada ? 'Pronto para retirada' : 'Saiu para entrega'}
            </strong>

            <span>
              Aguarde
            </span>

          </div>


          {/* ENTREGUE */}

          <div className={classeEtapa(3)}>

            <div className={styles.circuloStatus}>

              <svg viewBox="0 0 24 24">

                <path
                  d="M4 11L12 4L20 11V20H5V11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />

              </svg>

            </div>

            <strong>
              {retirada ? 'Retirado' : 'Entregue'}
            </strong>

            <span>
              Aguarde
            </span>

          </div>

        </section>


        {/* =========================
            PARTE INFERIOR
        ========================= */}

        <div className={styles.areaResumo}>


          {/* ITENS */}

          <section className={styles.cardItens}>

            <h2>
              Itens do pedido
            </h2>


            <div className={styles.listaItens}>

              {pedido.itens.map((item) => (

                <article
                  key={item.id}
                  className={styles.itemPedido}
                >

                  <img
                    src={item.imagem}
                    alt={item.nome}
                    onError={usarPlaceholderProduto}
                    loading="lazy"
                    decoding="async"
                  />


                  <div className={styles.quantidadeItem}>
                    {item.quantidade}x
                  </div>


                  <div className={styles.infoItem}>

                    <h3>
                      {item.nome}
                    </h3>

                    <p>
                      {item.descricao}
                    </p>

                  </div>


                  <strong className={styles.precoItem}>
                    R${' '}
                    {(item.preco * item.quantidade)
                      .toFixed(2)
                      .replace('.', ',')}
                  </strong>

                </article>

              ))}

            </div>

          </section>


          {/* RESUMO */}

          <section className={styles.cardResumo}>

            <h2>
              Resumo do pedido
            </h2>


            <div className={styles.linhaResumo}>

              <span>
                Subtotal
              </span>

              <strong>
                R$ {subtotal
                  .toFixed(2)
                  .replace('.', ',')}
              </strong>

            </div>


            <div className={styles.linhaResumo}>

              <span>
                {retirada ? 'Taxa de retirada' : 'Taxa de entrega'}
              </span>

              <strong>
                R$ {pedido.taxaEntrega
                  .toFixed(2)
                  .replace('.', ',')}
              </strong>

            </div>


            <div className={styles.totalResumo}>

              <span>
                {pagamentoConfirmado ? 'Total pago' : 'Total do pedido'}
              </span>

              <strong>
                R$ {total
                  .toFixed(2)
                  .replace('.', ',')}
              </strong>

            </div>

          </section>

        </div>


        {/* =========================
            BENEFÍCIOS
        ========================= */}

        <section className={styles.beneficios}>

          <div>

            <div className={styles.iconeBeneficio}>
              ✓
            </div>

            <div>
              <strong>
                Pagamento seguro
              </strong>

              <p>
                Seus dados protegidos durante todo o pedido.
              </p>
            </div>

          </div>


          <div>

            <div className={styles.iconeBeneficio}>
              ◷
            </div>

            <div>
              <strong>
                Entrega rápida
              </strong>

              <p>
                Seu pedido preparado e entregue com agilidade.
              </p>
            </div>

          </div>


          <div>

            <div className={styles.iconeBeneficio}>
              ♨
            </div>

            <div>
              <strong>
                Feito na hora
              </strong>

              <p>
                Ingredientes frescos e selecionados.
              </p>
            </div>

          </div>

        </section>


      </main>

    </div>
  );
}

export default PedidoFinalizado;
