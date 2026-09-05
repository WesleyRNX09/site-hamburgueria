import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import banner from '../../assets/banner.webp';
import LogoEstabelecimento from '../../components/LogoEstabelecimento';
import { useApp } from '../../context/appContext';
import { usarPlaceholderProduto } from '../../utils/productImage';
import styles from './index.module.css';

const DESTINOS_BANNER_VALIDOS = new Set(['cardapio', 'promocoes', 'sobre']);

function Home() {
  const [rolouPagina, setRolouPagina] = useState(false);
  const [categoriaAtiva, setCategoriaAtiva] = useState('Todos');
  const [secaoAtiva, setSecaoAtiva] = useState('inicio');
  const [bannerComErro, setBannerComErro] = useState('');

  const [indicePromocao, setIndicePromocao] = useState(0);

  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  const [modalProdutoAberto, setModalProdutoAberto] = useState(false);
  const [produtoSelecionado, setProdutoSelecionado] = useState(null);
  const modalProdutoRef = useRef(null);
  const fecharModalRef = useRef(null);
  const carrinhoRef = useRef(null);
  const fecharCarrinhoRef = useRef(null);
  const trilhoPromocoesRef = useRef(null);

  const [observacao, setObservacao] = useState('');
  const [quantidadeModal, setQuantidadeModal] = useState(1);

  const navigate = useNavigate();
  const {
    categorias: categoriasSalvas,
    produtos: produtosSalvos,
    promocoes: promocoesSalvas,
    adicionais: adicionaisSalvos,
    carrinho,
    setCarrinho,
    configuracao,
    erroApi,
    recarregarCatalogo,
    revalidarCarrinho,
    avisosCarrinho
  } = useApp();

  const [adicionaisSelecionados, setAdicionaisSelecionados] =
    useState([]);

  const categorias = ['Todos', ...categoriasSalvas.filter((categoria) => categoria.ativo !== false).map((categoria) => categoria.nome)];

  const produtos = produtosSalvos.filter((produto) => produto.ativo !== false);
  const promocoes = promocoesSalvas.filter((promocao) => promocao.disponivel !== false);

  function cartoesDoTrilho() {
    const trilho = trilhoPromocoesRef.current;
    if (!trilho) return [];
    return [...trilho.children].filter((filho) => filho.tagName === 'ARTICLE');
  }

  /* O indicador acompanha a rolagem: cartao cuja posicao esta mais
     proxima do inicio da area visivel. */
  function aoRolarPromocoes() {
    const cartoes = cartoesDoTrilho();
    if (cartoes.length === 0) return;

    const inicio = cartoes[0].offsetLeft;
    const rolagem = trilhoPromocoesRef.current.scrollLeft;

    let maisProximo = 0;
    let menorDistancia = Infinity;

    cartoes.forEach((cartao, indice) => {
      const distancia = Math.abs(cartao.offsetLeft - inicio - rolagem);
      if (distancia < menorDistancia) {
        menorDistancia = distancia;
        maisProximo = indice;
      }
    });

    setIndicePromocao(maisProximo);
  }

  function irParaPromocao(indice) {
    const cartoes = cartoesDoTrilho();
    const alvo = cartoes[indice];
    if (!alvo) return;

    trilhoPromocoesRef.current.scrollTo({
      left: alvo.offsetLeft - cartoes[0].offsetLeft,
      behavior: 'smooth'
    });
  }

  /* As setas andam um cartao por vez e continuam dando a volta no fim,
     como antes — agora movendo a rolagem em vez de trocar a janela. */
  function rolarPromocoes(direcao) {
    const trilho = trilhoPromocoesRef.current;
    const cartoes = cartoesDoTrilho();
    if (!trilho || cartoes.length < 2) return;

    const passo = cartoes[1].offsetLeft - cartoes[0].offsetLeft;
    const limite = trilho.scrollWidth - trilho.clientWidth;
    let destino = trilho.scrollLeft + direcao * passo;

    if (destino > limite + 1) destino = 0;
    else if (destino < -1) destino = limite;

    trilho.scrollTo({
      left: Math.max(0, Math.min(destino, limite)),
      behavior: 'smooth'
    });
  }

  function proximaPromocao() {
    rolarPromocoes(1);
  }

  function promocaoAnterior() {
    rolarPromocoes(-1);
  }

  const adicionais = adicionaisSalvos;

  const adicionaisProduto = adicionais.filter((adicional) => {
    if (adicional.ativo === false) return false;
    if (!Array.isArray(produtoSelecionado?.adicionaisIds)) return true;
    return produtoSelecionado.adicionaisIds.some((id) => String(id) === String(adicional.id));
  });

  const produtosFiltrados =
    categoriaAtiva === 'Todos'
      ? produtos
      : produtos.filter(
          (produto) => produto.categoria === categoriaAtiva
        );

  async function abrirCarrinho() {
    setCarrinhoAberto(true);
    await revalidarCarrinho().catch(() => {});
  }

  function fecharCarrinho() {
    setCarrinhoAberto(false);
  }

  function abrirModalProduto(produto) {
    setProdutoSelecionado(produto);

    setObservacao('');
    setQuantidadeModal(1);
    setAdicionaisSelecionados([]);

    setModalProdutoAberto(true);
  }

  function fecharModalProduto() {
    setModalProdutoAberto(false);
    setProdutoSelecionado(null);

    setObservacao('');
    setQuantidadeModal(1);
    setAdicionaisSelecionados([]);
  }

  function selecionarAdicional(adicional) {
    const jaSelecionado = adicionaisSelecionados.some(
      (item) => item.id === adicional.id
    );

    if (jaSelecionado) {
      setAdicionaisSelecionados(
        adicionaisSelecionados.filter(
          (item) => item.id !== adicional.id
        )
      );
    } else {
      setAdicionaisSelecionados([
        ...adicionaisSelecionados,
        adicional
      ]);
    }
  }

  function aumentarQuantidade(chave) {
    setCarrinho(
      carrinho.map((item) =>
        (item.carrinhoId ?? item.id) === chave
          ? { ...item, quantidade: Math.min(50, item.quantidade + 1) }
          : item
      )
    );
  }

  function diminuirQuantidade(chave) {
    setCarrinho(
      carrinho
        .map((item) =>
          (item.carrinhoId ?? item.id) === chave
            ? { ...item, quantidade: item.quantidade - 1 }
            : item
        )
        .filter((item) => item.quantidade > 0)
    );
  }

  function removerProduto(chave) {
    setCarrinho(
      carrinho.filter((item) => (item.carrinhoId ?? item.id) !== chave)
    );
  }

  const totalCarrinho = carrinho.reduce((total, item) => {

    const preco =
      item.precoFinal ??
      Number(item.preco.replace(',', '.'));

    return total + preco * item.quantidade;

  }, 0);

  const quantidadeCarrinho = carrinho.reduce(
    (total, item) => total + item.quantidade,
    0
  );
  const pedidoMinimo = Number(configuracao.pedidoMinimo);
  const minimoAtingido = totalCarrinho >= pedidoMinimo;
  const pedidosOnlineDisponiveis = Boolean(
    configuracao.lojaAberta && (configuracao.entregaAtiva || configuracao.retiradaAtiva)
  );
  const formasAtendimento = [
    configuracao.entregaAtiva ? 'delivery' : null,
    configuracao.retiradaAtiva ? 'retirada' : null,
    configuracao.atendimentoGarcomAtivo ? 'salão' : null
  ].filter(Boolean);
  const resumoAtendimento = formasAtendimento.length
    ? `Atendimento: ${formasAtendimento.join(', ')}`
    : 'Nenhuma modalidade disponível no momento.';
  const statusCompleto = pedidosOnlineDisponiveis
    ? 'Aberta para pedidos'
    : configuracao.lojaAberta
      ? 'Pedidos online indisponíveis'
      : 'Fechada no momento';
  const statusCurto = pedidosOnlineDisponiveis
    ? 'Aberto'
    : configuracao.lojaAberta
      ? 'Só consulta'
      : 'Fechado';
  const horarioResumido = String(configuracao.horarioFuncionamento ?? '')
    .split('\n')
    .map((linha) => linha.trim())
    .find(Boolean) || '';
  const podeFinalizar = pedidosOnlineDisponiveis && minimoAtingido;
  const nomeExibicao = configuracao.nomeLoja || 'Cardápio online';
  const bannerTitulo = configuracao.bannerTitulo?.trim() || '';
  const bannerSubtitulo = configuracao.bannerSubtitulo?.trim() || '';
  const bannerBotaoTexto = configuracao.bannerBotaoTexto?.trim() || 'Ver Cardápio';
  const bannerBotaoDestino = DESTINOS_BANNER_VALIDOS.has(configuracao.bannerBotaoDestino)
    ? configuracao.bannerBotaoDestino
    : 'cardapio';
  const tituloCardapio = configuracao.tituloCardapio?.trim() || 'Nosso cardápio';
  const textoApresentacao = configuracao.textoApresentacao?.trim() || 'Escolha o seu hambúrguer favorito.';
  const tituloSobre = configuracao.tituloSobre?.trim() || '';
  const textoSobre = configuracao.textoSobre?.trim()
    || 'Trabalhamos com ingredientes selecionados, hambúrguer artesanal preparado na hora e muito sabor em cada pedido.';
  const mensagemRodape = configuracao.mensagemRodape?.trim() || '';
  const digitosWhatsapp = String(configuracao.whatsapp ?? '').replace(/\D/g, '');
  const whatsappUrl = digitosWhatsapp.length >= 10
    ? `https://wa.me/${digitosWhatsapp.length <= 11 ? `55${digitosWhatsapp}` : digitosWhatsapp}`
    : '';
  const bannerConfigurado = configuracao.banner && configuracao.banner !== bannerComErro
    ? configuracao.banner
    : banner;

  useEffect(() => {
    if (!configuracao.banner) return undefined;
    let ativo = true;
    const imagem = new Image();
    imagem.onload = () => {
      if (ativo) setBannerComErro('');
    };
    imagem.onerror = () => {
      if (ativo) setBannerComErro(configuracao.banner);
    };
    imagem.src = configuracao.banner;
    return () => { ativo = false; };
  }, [configuracao.banner]);
  
  function irParaSecao(id) {
  const secao = document.getElementById(id);

  if (secao) {
    secao.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }
}

  useEffect(() => {
    function verificarScroll() {
      setRolouPagina(window.scrollY > 50);
    }

    verificarScroll();

    window.addEventListener('scroll', verificarScroll);

    return () => {
      window.removeEventListener('scroll', verificarScroll);
    };
  }, []);

  useEffect(() => {
    if (!modalProdutoAberto && !carrinhoAberto) return undefined;

    const focoAnterior = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const container = modalProdutoAberto ? modalProdutoRef.current : carrinhoRef.current;
    const alvoInicial = modalProdutoAberto ? fecharModalRef.current : fecharCarrinhoRef.current;
    const overflowAnterior = document.body.style.overflow;
    const animacao = window.requestAnimationFrame(() => alvoInicial?.focus());

    document.body.style.overflow = 'hidden';

    function fecharCamadaAtiva() {
      if (modalProdutoAberto) {
        setModalProdutoAberto(false);
        setProdutoSelecionado(null);
        setObservacao('');
        setQuantidadeModal(1);
        setAdicionaisSelecionados([]);
      } else {
        setCarrinhoAberto(false);
      }
    }

    function tratarTeclado(evento) {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        fecharCamadaAtiva();
        return;
      }

      if (evento.key !== 'Tab' || !container) return;
      const focaveis = [...container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )];
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];

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
  }, [carrinhoAberto, modalProdutoAberto]);

  useEffect(() => {
    function verificarSecaoAtual() {
      const cardapio = document.getElementById('cardapio');
      const promocoes = document.getElementById('promocoes');
      const sobre = document.getElementById('sobre');

      const linhaMenu = 200;

      const elementoScroll =
        document.scrollingElement || document.documentElement;

      const scrollAtual = elementoScroll.scrollTop;
      const alturaPagina = elementoScroll.scrollHeight;
      const alturaTela = window.innerHeight;

      const chegouNoFinal =
        scrollAtual + alturaTela >= alturaPagina - 20;

      /*
        SOBRE
        Ativa quando:
        1. chegou no final da página
        OU
        2. o Sobre já entrou bastante na tela
      */
      if (sobre) {
        const posicaoSobre =
          sobre.getBoundingClientRect();

        if (
          chegouNoFinal ||
          (
            posicaoSobre.top <= alturaTela * 0.75 &&
            posicaoSobre.bottom > linhaMenu
          )
        ) {
          setSecaoAtiva('sobre');
          return;
        }
      }

      /*
        PROMOÇÕES
      */
      if (promocoes) {
        const posicaoPromocoes =
          promocoes.getBoundingClientRect();

        if (
          posicaoPromocoes.top <= linhaMenu &&
          posicaoPromocoes.bottom > linhaMenu
        ) {
          setSecaoAtiva('promocoes');
          return;
        }
      }

      /*
        CARDÁPIO
      */
      if (cardapio) {
        const posicaoCardapio =
          cardapio.getBoundingClientRect();

        if (
          posicaoCardapio.top <= linhaMenu &&
          posicaoCardapio.bottom > linhaMenu
        ) {
          setSecaoAtiva('cardapio');
          return;
        }
      }

      /*
        INÍCIO
      */
      setSecaoAtiva('inicio');
    }


    // Scroll normal da página
    window.addEventListener(
      'scroll',
      verificarSecaoAtual,
      { passive: true }
    );

    /*
      Também detecta scroll caso algum elemento
      esteja sendo responsável pela rolagem.
    */
    document.addEventListener(
      'scroll',
      verificarSecaoAtual,
      true
    );

    window.addEventListener(
      'resize',
      verificarSecaoAtual
    );


    // Verifica assim que a página carregar
    verificarSecaoAtual();


    return () => {
      window.removeEventListener(
        'scroll',
        verificarSecaoAtual
      );

      document.removeEventListener(
        'scroll',
        verificarSecaoAtual,
        true
      );

      window.removeEventListener(
        'resize',
        verificarSecaoAtual
      );
    };
  }, []);

  const precoProdutoSelecionado = produtoSelecionado
    ? Number(produtoSelecionado.preco.replace(',', '.'))
    : 0;

  const totalAdicionais = adicionaisSelecionados.reduce(
    (total, adicional) => total + adicional.preco,
    0
  );

  const totalModal =
    (precoProdutoSelecionado + totalAdicionais) *
    quantidadeModal;

  function confirmarProduto() {
    if (!produtoSelecionado) {
      return;
    }

    const precoFinal =
      precoProdutoSelecionado + totalAdicionais;

    const novoItem = {
      ...produtoSelecionado,

      id: produtoSelecionado.produtoId ?? produtoSelecionado.id,

      produtoId: produtoSelecionado.produtoId ?? produtoSelecionado.id,

      promocaoId: produtoSelecionado.produtoId ? produtoSelecionado.id : null,

      carrinhoId: `${produtoSelecionado.id}-${Date.now()}`,

      quantidade: quantidadeModal,

      observacao: observacao.trim(),

      adicionais: adicionaisSelecionados,

      precoFinal
    };

    setCarrinho((carrinhoAtual) => [
      ...carrinhoAtual,
      novoItem
    ]);

    fecharModalProduto();

    setCarrinhoAberto(true);
  }

  return (
    <div className={styles.pagina}>
      <header
        className={`${styles.barraPrincipal} ${
          rolouPagina ? styles.barraRolada : ''
        }`}
      >
        <div className={styles.conteudoHeader}>
          <Link to="/" className={styles.logo}>
            <LogoEstabelecimento configuracao={configuracao} alternativa={nomeExibicao} />
          </Link>

          <nav
            className={styles.menu}
            aria-label="Navegação principal"
          >
            <a
              href="#inicio"
              className={
                secaoAtiva === 'inicio'
                  ? styles.linkAtivo
                  : ''
              }
              onClick={(e) => {
                e.preventDefault();
                irParaSecao('inicio');
              }}
            >
              Início
            </a>

            <a
              href="#cardapio"
              className={
                secaoAtiva === 'cardapio'
                  ? styles.linkAtivo
                  : ''
              }
              onClick={(e) => {
                e.preventDefault();
                irParaSecao('cardapio');
              }}
            >
              Cardápio
            </a>

            <a
              href="#promocoes"
              className={
                secaoAtiva === 'promocoes'
                  ? styles.linkAtivo
                  : ''
              }
              onClick={(e) => {
                e.preventDefault();
                irParaSecao('promocoes');
              }}
            >
              Promoções
            </a>

           <a
              href="#sobre"
              className={
                secaoAtiva === 'sobre'
                  ? styles.linkAtivo
                  : ''
              }
              onClick={(e) => {
                e.preventDefault();
                irParaSecao('sobre');
              }}
            >
              Sobre
            </a>

            <a
              href="#sobre"
              className={
                secaoAtiva === 'sobre'
                  ? styles.linkAtivo
                  : ''
              }
              onClick={(e) => {
                e.preventDefault();
                irParaSecao('sobre');
              }}
            >
              Contato
            </a>

          </nav>

          <button
            type="button"
            className={styles.botaoCarrinho}
            onClick={abrirCarrinho}
            aria-haspopup="dialog"
            aria-expanded={carrinhoAberto}
            aria-controls="carrinho-lateral"
          >
            <svg
              className={styles.iconeCarrinho}
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 3h2l2.4 10.1a2 2 0 0 0 2 1.5h7.7a2 2 0 0 0 1.9-1.4L21 6H6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              <circle cx="10" cy="20" r="1" fill="currentColor" />
              <circle cx="18" cy="20" r="1" fill="currentColor" />
            </svg>

            <span className={styles.textoCarrinho}>Ver Carrinho</span>

            {quantidadeCarrinho > 0 && (
              <span className={styles.numeroCarrinho}>
                {quantidadeCarrinho}
              </span>
            )}
          </button>

        </div>
      </header>

      <main id="conteudo-principal">
      {erroApi && (
        <div className={styles.erroCatalogo} role="alert">
          <div><strong>Não foi possível atualizar o cardápio.</strong><span>{erroApi}</span></div>
          <button type="button" onClick={() => recarregarCatalogo().catch(() => {})}>Tentar novamente</button>
        </div>
      )}
      <section
        id="inicio"
        className={styles.banner}
        style={{ backgroundImage: `url(${JSON.stringify(bannerConfigurado)})` }}
      >
        <div className={styles.conteudoBanner}>
          <div className={`${styles.statusLoja} ${pedidosOnlineDisponiveis ? styles.statusAberta : styles.statusFechada}`} role="status">
            <span className={styles.pontoStatus} aria-hidden="true" />

            <strong className={styles.statusRotuloLongo}>{statusCompleto}</strong>
            <strong className={styles.statusRotuloCurto}>{statusCurto}</strong>

            {horarioResumido && (
              <span className={styles.statusHorario}>{horarioResumido}</span>
            )}

            <span className={styles.statusDetalhe}>{pedidosOnlineDisponiveis ? `${resumoAtendimento} • Estimativa: ${configuracao.tempoEntrega}` : 'O cardápio continua disponível para consulta.'}</span>
          </div>
          <span className={styles.textoPequeno}>
            🔥 FEITO NA HORA
          </span>

          <h1>
            {bannerTitulo ? (
              <span className={styles.tituloAmarelo}>
                {bannerTitulo}
              </span>
            ) : (
              <>
                <span className={styles.tituloBranco}>
                  O Verdadeiro
                </span>

                <span className={styles.tituloAmarelo}>
                  Hambúrguer Artesanal
                </span>
              </>
            )}
          </h1>

          <p className={styles.descricaoBanner}>
            {bannerSubtitulo || (
              <>
                Carne grelhada na hora, cheddar cremoso,
                <br className={styles.quebraDesktop} />
                bacon crocante e ingredientes sempre frescos
                <br className={styles.quebraDesktop} />
                para uma experiência irresistível.
              </>
            )}
          </p>

          <div className={styles.botoesBanner}>
            <button
              type="button"
              className={styles.botaoPrincipal}
              onClick={abrirCarrinho}
            >
              Peça agora
            </button>

            <button
              type="button"
              className={styles.botaoSecundario}
              onClick={() => irParaSecao(bannerBotaoDestino)}
            >
              {bannerBotaoTexto}
            </button>

          </div>
        </div>
      </section>

      <section
        id="cardapio"
        className={styles.cardapio}
      >

        <h2>{tituloCardapio}</h2>

        <p>{textoApresentacao}</p>

        {/* PROMOÇÕES */}
        <div
          id="promocoes"
          className={styles.areaPromocoes}
        >

          <div className={styles.topoPromocoes}>

            <div>
              <span>
                🔥 OFERTAS ESPECIAIS
              </span>

              <h3>
                Promoções do dia
              </h3>
            </div>


            <div className={styles.controlesPromocao}>

              <button
                type="button"
                className={styles.setaPromocao}
                onClick={promocaoAnterior}
                aria-label="Promoção anterior"
              >
                <svg viewBox="0 0 24 24">
                  <path
                    d="M15 5L8 12L15 19"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>


              <button
                type="button"
                className={styles.setaPromocao}
                onClick={proximaPromocao}
                aria-label="Próxima promoção"
              >
                <svg viewBox="0 0 24 24">
                  <path
                    d="M9 5L16 12L9 19"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

            </div>

          </div>


          <div className={styles.carrosselPromocoes}>

            <div
              className={styles.listaPromocoes}
              ref={trilhoPromocoesRef}
              onScroll={aoRolarPromocoes}
              role="group"
              aria-label="Promoções do dia"
            >

              {promocoes.map((promocao) => (

                <article
                  key={promocao.id}
                  className={styles.cardPromocao}
                >

                  <div className={styles.imagemPromocao}>

                    <img
                      src={promocao.imagem}
                      alt={promocao.nome}
                      onError={usarPlaceholderProduto}
                      loading="lazy"
                      decoding="async"
                    />


                    <span className={styles.seloPromocao}>
                      {promocao.destaque}
                    </span>

                  </div>


                  <div className={styles.conteudoPromocao}>

                    <span className={styles.tipoPromocao}>
                      {promocao.tipo}
                    </span>


                    <h4>
                      {promocao.nome}
                    </h4>


                    <p>
                      {promocao.descricao}
                    </p>


                    <div className={styles.precoPromocao}>

                      <span>
                        De R$ {promocao.precoAntigo}
                      </span>

                      <strong>
                        R$ {promocao.preco}
                      </strong>

                    </div>


                    <button
                      type="button"
                      onClick={() =>
                        abrirModalProduto(promocao)
                      }
                    >
                      Aproveitar oferta
                    </button>

                  </div>

                </article>

              ))}

              {promocoes.length === 0 && (
                <p className={styles.semResultados}>Nenhuma promoção disponível no momento.</p>
              )}

            </div>

          </div>


          {/* INDICADOR */}

          {promocoes.length > 0 && <div className={styles.indicadoresPromocao}>

            {promocoes.map((promocao, indice) => (

              <button
                key={promocao.id}
                type="button"
                aria-label={`Ir para promoção ${indice + 1}`}
                onClick={() =>
                  irParaPromocao(indice)
                }
                className={
                  indicePromocao === indice
                    ? styles.indicadorAtivo
                    : ''
                }
                aria-current={indicePromocao === indice ? 'true' : undefined}
              />

            ))}

          </div>}

        </div>

        <div className={styles.categorias} role="group" aria-label="Filtrar por categoria">
          {categorias.map((categoria) => (
            <button
              key={categoria}
              type="button"
              onClick={() => setCategoriaAtiva(categoria)}
              aria-pressed={categoriaAtiva === categoria}
              className={`${styles.botaoCategoria} ${
                categoriaAtiva === categoria
                  ? styles.categoriaAtiva
                  : ''
              }`}
            >
              {categoria}
            </button>
          ))}
        </div>

        <div className={styles.listaProdutos}>
          {produtosFiltrados.map((produto) => (
            <article
              className={styles.cardProduto}
              key={produto.id}
            >
              <div className={styles.areaImagemProduto}>
                <img
                  src={produto.imagem}
                  alt={produto.nome}
                  onError={usarPlaceholderProduto}
                  className={styles.imagemProduto}
                  loading="lazy"
                  decoding="async"
                />

                {/* No mobile a linha inteira e o alvo de toque; este "+"
                    e apenas o indicativo visual de que da para adicionar. */}
                <span className={styles.indicadorAdicionar} aria-hidden="true">+</span>
              </div>

              <div className={styles.informacoesProduto}>
                {produto.destaque && (
                  <span className={styles.seloProduto}>
                    🔥 {produto.destaque}
                  </span>
                )}

                <div>
                  <h3 className={styles.informacoesProdutoTitulo}>{produto.nome}</h3>
                  <p className={styles.informacoesProdutoDescrição}>{produto.descricao}</p>
                </div>

                <div className={styles.rodapeProduto}>
                  <div className={styles.precoProduto}>
                    <span>A partir de</span>
                    <strong>R$ {produto.preco}</strong>
                  </div>

                  <button
                    type="button"
                    className={styles.botaoAdicionar}
                    onClick={() => abrirModalProduto(produto)}
                  >
                    Adicionar
                  </button>

                </div>
              </div>

              {/* Mobile: alvo de toque cobrindo a linha toda (o botao
                  "Adicionar" fica oculto nesse breakpoint). */}
              <button
                type="button"
                className={styles.aberturaCardProduto}
                onClick={() => abrirModalProduto(produto)}
                aria-label={`Ver detalhes de ${produto.nome}`}
              />
            </article>
          ))}
          {produtosFiltrados.length === 0 && (
            <p className={styles.semResultados} role="status">Nenhum produto disponível nesta categoria.</p>
          )}
        </div>
      </section>
      </main>

      {/* =========================
          SOBRE A LOJA
      ========================= */}

      <footer
        id="sobre"
        className={styles.sobreLoja}
      >
        <div className={styles.conteudoSobre}>

          {/* PARTE PRINCIPAL */}

          <div className={styles.apresentacaoLoja}>
            <Link
              to="/"
              className={styles.logoRodape}
            >
              <LogoEstabelecimento configuracao={configuracao} alternativa={nomeExibicao} loading="lazy" />
            </Link>

            <h2>
              {tituloSobre || (
                <>
                  Hambúrguer de verdade,
                  <span> feito do nosso jeito.</span>
                </>
              )}
            </h2>

            <p>
              {textoSobre}
            </p>

            {(configuracao.instagramUrl || configuracao.facebookUrl || whatsappUrl) && <div className={styles.redesSociais}>
              <span>Siga a gente</span>

              <div className={styles.iconesSociais}>

                {configuracao.instagramUrl && <a
                  href={configuracao.instagramUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Instagram"
                >
                  <svg viewBox="0 0 24 24">
                    <rect
                      x="3"
                      y="3"
                      width="18"
                      height="18"
                      rx="5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />

                    <circle
                      cx="12"
                      cy="12"
                      r="4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />

                    <circle
                      cx="17.5"
                      cy="6.5"
                      r="1"
                      fill="currentColor"
                    />
                  </svg>
                </a>}

                {configuracao.facebookUrl && <a
                  href={configuracao.facebookUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Facebook"
                >
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M14 8h3V4h-3c-3 0-5 2-5 5v3H6v4h3v5h4v-5h3l1-4h-4V9c0-.7.3-1 1-1Z"
                      fill="currentColor"
                    />
                  </svg>
                </a>}

                {whatsappUrl && <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="WhatsApp"
                >
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M20 11.5A8 8 0 0 1 8.2 18.6L4 20l1.4-4.1A8 8 0 1 1 20 11.5Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  </svg>
                </a>}

              </div>
            </div>}
          </div>


          {/* NAVEGAÇÃO */}

          <div className={styles.colunaSobre}>
            <h3>Navegação</h3>

            <button
              type="button"
              onClick={() => irParaSecao('inicio')}
            >
              Início
            </button>

            <button
              type="button"
              onClick={() => irParaSecao('cardapio')}
            >
              Cardápio
            </button>

            <button
              type="button"
              onClick={() => irParaSecao('promocoes')}
            >
              Promoções
            </button>

            <button
              type="button"
              onClick={() => irParaSecao('sobre')}
            >
              Sobre nós
            </button>
          </div>


          {/* FUNCIONAMENTO */}

          <div className={styles.colunaSobre}>
            <h3>Funcionamento</h3>

            <div className={styles.horario}>
              <strong>{configuracao.horarioFuncionamento || 'Horário ainda não configurado.'}</strong>
            </div>
          </div>


          {/* CONTATO */}

          <div className={styles.colunaSobre}>
            <h3>Fale com a gente</h3>

            <div className={styles.contatoSobre}>
              <span>Telefone</span>
              <strong>{configuracao.telefone || 'Não informado'}</strong>
            </div>

            <div className={styles.contatoSobre}>
              <span>E-mail</span>
              <strong>{configuracao.email || 'Não informado'}</strong>
            </div>

            {whatsappUrl && <a
              href={whatsappUrl}
              target="_blank"
              rel="noreferrer"
              className={styles.botaoWhatsapp}
            >
              Pedir pelo WhatsApp
            </a>}

            {configuracao.endereco && <div className={styles.contatoSobre}><span>Endereço</span><strong>{configuracao.endereco}</strong></div>}
          </div>

        </div>


        {/* PARTE INFERIOR */}

        <div className={styles.rodapeFinal}>
          <div className={styles.direitosRodape}>
            {mensagemRodape && <p>{mensagemRodape}</p>}
            <p>© {new Date().getFullYear()} {nomeExibicao}. Todos os direitos reservados.</p>
            {configuracao.informacoesLegais && (
              <small className={styles.informacoesLegais}>{configuracao.informacoesLegais}</small>
            )}
          </div>

          <div>
            <Link to="/politica-de-privacidade">
              Política de Privacidade
            </Link>

            <span>•</span>

            <Link to="/termos-de-uso">
              Termos de Uso
            </Link>
          </div>
        </div>

      </footer>

      {modalProdutoAberto && produtoSelecionado && (
        <div
          className={styles.overlayModalProduto}
          onClick={fecharModalProduto}
        >

          <div
            className={styles.modalProduto}
            ref={modalProdutoRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-modal-produto"
            onClick={(evento) => evento.stopPropagation()}
          >

            {/* CABEÇALHO */}

            <div className={styles.topoModalProduto}>

              <div className={styles.resumoProdutoModal}>

                <img
                  src={produtoSelecionado.imagem}
                  alt={produtoSelecionado.nome}
                  onError={usarPlaceholderProduto}
                  decoding="async"
                />

                <div>
                  <span>PERSONALIZE SEU PEDIDO</span>

                  <h2 id="titulo-modal-produto">
                    {produtoSelecionado.nome}
                  </h2>

                  <p>
                    {produtoSelecionado.descricao}
                  </p>

                  <strong>
                    R$ {produtoSelecionado.preco}
                  </strong>
                </div>

              </div>


              <button
                type="button"
                className={styles.fecharModalProduto}
                ref={fecharModalRef}
                onClick={fecharModalProduto}
                aria-label="Fechar"
              >

                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    d="M6 6L18 18M18 6L6 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                </svg>

              </button>

            </div>


            {/* ADICIONAIS */}

            <div className={styles.secaoModal}>

              <div className={styles.tituloSecaoModal}>
                <div>
                  <span>OPCIONAL</span>
                  <h3>Quer deixar ainda melhor?</h3>
                </div>

                <span>
                  Escolha seus adicionais
                </span>
              </div>


              <div className={styles.listaAdicionais}>

                {adicionaisProduto.map((adicional) => {

                  const selecionado =
                    adicionaisSelecionados.some(
                      (item) => item.id === adicional.id
                    );

                  return (
                    <button
                      type="button"
                      key={adicional.id}
                      className={`${styles.cardAdicional} ${
                        selecionado
                          ? styles.adicionalSelecionado
                          : ''
                      }`}
                      onClick={() =>
                        selecionarAdicional(adicional)
                      }
                      aria-pressed={selecionado}
                    >

                      <div
                        className={styles.checkboxAdicional}
                      >
                        {selecionado && '✓'}
                      </div>

                      <div>
                        <strong>
                          {adicional.nome}
                        </strong>

                        <span>
                          + R$ {adicional.preco
                            .toFixed(2)
                            .replace('.', ',')}
                        </span>
                      </div>

                    </button>
                  );
                })}

                {adicionaisProduto.length === 0 && (
                  <p className={styles.semAdicionais}>Este produto não possui adicionais disponíveis.</p>
                )}

              </div>

            </div>


            {/* OBSERVAÇÃO */}

            <div className={styles.secaoObservacao}>

              <div className={styles.tituloObservacao}>
                <div>
                  <span>OBSERVAÇÕES</span>

                  <h3>
                    Algum pedido especial?
                  </h3>
                </div>

                <span>
                  {observacao.length}/180
                </span>
              </div>

              <textarea
                aria-label="Observações do produto"
                value={observacao}
                maxLength={180}
                onChange={(evento) =>
                  setObservacao(evento.target.value)
                }
                placeholder="Ex: sem cebola, tirar tomate, molho separado..."
              />

            </div>


            {/* RODAPÉ */}

            <div className={styles.rodapeModalProduto}>

              <div className={styles.quantidadeModal}>

                <button
                  type="button"
                  aria-label="Diminuir quantidade"
                  onClick={() =>
                    setQuantidadeModal(
                      Math.max(1, quantidadeModal - 1)
                    )
                  }
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M6 12H18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>

                <span>
                  {quantidadeModal}
                </span>

                <button
                  type="button"
                  aria-label="Aumentar quantidade"
                  onClick={() =>
                    setQuantidadeModal(
                      Math.min(50, quantidadeModal + 1)
                    )
                  }
                  disabled={quantidadeModal >= 50}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M12 6V18M6 12H18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>

              </div>


              <div className={styles.totalModal}>

                <span>Total</span>

                <strong>
                  R$ {totalModal
                    .toFixed(2)
                    .replace('.', ',')}
                </strong>

              </div>


              <button
                type="button"
                className={styles.confirmarProduto}
                onClick={confirmarProduto}
              >
                Adicionar ao carrinho
              </button>

            </div>

          </div>

        </div>
      )}

      <div
        className={`${styles.overlayCarrinho} ${
          carrinhoAberto ? styles.overlayVisivel : ''
        }`}
        aria-hidden="true"
        onClick={fecharCarrinho}
      />

      <aside
        id="carrinho-lateral"
        className={`${styles.carrinhoLateral} ${
          carrinhoAberto ? styles.carrinhoAberto : ''
        }`}
        ref={carrinhoRef}
        role="dialog"
        aria-modal={carrinhoAberto ? 'true' : undefined}
        aria-hidden={!carrinhoAberto}
        aria-labelledby="titulo-carrinho"
      >
        <div className={styles.topoCarrinho}>
          <div>
            <span className={styles.subtituloCarrinho}>
              SEU PEDIDO
            </span>

            <h2 id="titulo-carrinho">Meu Carrinho</h2>
          </div>

          <button
            type="button"
            className={styles.fecharCarrinho}
            ref={fecharCarrinhoRef}
            aria-label="Fechar carrinho"
            onClick={fecharCarrinho}
          >
            ×
          </button>
        </div>

        <div className={styles.linhaCarrinho} />

        <div className={styles.produtosCarrinho}>
          {avisosCarrinho.length > 0 && (
            <div className={styles.avisosCarrinho} role="status" aria-live="polite">
              <strong>Carrinho atualizado</strong>
              {avisosCarrinho.map((aviso, indice) => <p key={`${aviso.carrinhoId ?? 'aviso'}-${indice}`}>{aviso.mensagem}</p>)}
            </div>
          )}
          {carrinho.length === 0 ? (
            <div className={styles.carrinhoVazio}>
              <div className={styles.iconeCarrinhoVazio}>
                🛒
              </div>

              <h3>Seu carrinho está vazio</h3>

              <p>
                Adicione seus hambúrgueres favoritos para
                começar o pedido.
              </p>

              <button
                type="button"
                onClick={() => {
                  fecharCarrinho();

                  setTimeout(() => {
                    irParaSecao('cardapio');
                  }, 300);
                }}
              >
                Ver cardápio
              </button>

            </div>
          ) : (
            carrinho.map((item) => (
              <div
                className={styles.itemCarrinho}
                key={item.carrinhoId ?? item.id}
              >
                <img
                  src={item.imagem}
                  alt={item.nome}
                  onError={usarPlaceholderProduto}
                  loading="lazy"
                  decoding="async"
                />

               <div className={styles.infoItemCarrinho}>

                <div className={styles.nomeRemover}>
                  <h3>{item.nome}</h3>

                  <button
                    type="button"
                    className={styles.botaoRemover}
                    onClick={() => removerProduto(item.carrinhoId ?? item.id)}
                    aria-label={`Remover ${item.nome}`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        d="M6 6L18 18M18 6L6 18"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>


                {/* DESCRIÇÃO DO PRODUTO */}

                <p className={styles.descricaoItemCarrinho}>
                  {item.descricao}
                </p>


                {/* ADICIONAIS */}

                {item.adicionais?.length > 0 && (
                  <div className={styles.adicionaisCarrinho}>

                    {item.adicionais.map((adicional) => (
                      <span key={adicional.id}>
                        + {adicional.nome}
                        <strong>
                          + R$ {adicional.preco
                            .toFixed(2)
                            .replace('.', ',')}
                        </strong>
                      </span>
                    ))}

                  </div>
                )}

                {item.observacao && (
                  <p className={styles.observacaoCarrinho}>
                    <strong>Observação:</strong> {item.observacao}
                  </p>
                )}


                {/* PREÇO */}

                <strong className={styles.precoItemCarrinho}>
                  R$ {(item.precoFinal ??
                    Number(item.preco.replace(',', '.')))
                    .toFixed(2)
                    .replace('.', ',')}
                </strong>


                {/* QUANTIDADE */}

                <div className={styles.controleQuantidade}>

                  <button
                    type="button"
                    onClick={() => diminuirQuantidade(item.carrinhoId ?? item.id)}
                    aria-label="Diminuir quantidade"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M6 12H18"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>

                  <span>{item.quantidade}</span>

                  <button
                    type="button"
                    disabled={item.quantidade >= 50}
                    onClick={() => aumentarQuantidade(item.carrinhoId ?? item.id)}
                    aria-label="Aumentar quantidade"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M12 6V18M6 12H18"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>

                </div>

              </div>
              </div>
            ))
          )}
        </div>

        {carrinho.length > 0 && (
          <div className={styles.rodapeCarrinho}>
            <div className={styles.totalCarrinho}>
              <span>Total</span>

              <strong>
                R$ {totalCarrinho.toFixed(2).replace('.', ',')}
              </strong>
            </div>

            <div className={`${styles.progressoMinimo} ${minimoAtingido ? styles.minimoAtingido : ''}`}>
              <div><span>Pedido mínimo</span><strong>R$ {pedidoMinimo.toFixed(2).replace('.', ',')}</strong></div>
              <div className={styles.barraMinimo}><span style={{ width: `${pedidoMinimo > 0 ? Math.min(100, (totalCarrinho / pedidoMinimo) * 100) : 100}%` }} /></div>
              <small>{minimoAtingido ? 'Pedido mínimo atingido.' : `Faltam R$ ${(pedidoMinimo - totalCarrinho).toFixed(2).replace('.', ',')}.`}</small>
            </div>

            {!pedidosOnlineDisponiveis && <p className={styles.bloqueioCarrinho}>{configuracao.lojaAberta ? 'Delivery e retirada estão indisponíveis.' : 'A loja está fechada no momento.'}</p>}

            <button
              type="button"
              className={styles.finalizarPedido}
              onClick={() => navigate('/finalizar-pedido')}
              disabled={!podeFinalizar}
            >
              {podeFinalizar ? 'Finalizar Pedido' : !pedidosOnlineDisponiveis ? 'Pedidos indisponíveis' : 'Complete o pedido mínimo'}
            </button>

            <button
              type="button"
              className={styles.continuarComprando}
              onClick={fecharCarrinho}
            >
              Continuar comprando
            </button>
          </div>
        )}
      </aside>

      
    </div>
  );
}

export default Home;
