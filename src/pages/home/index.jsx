import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgePercent, ShoppingBag, X } from 'lucide-react';

import banner from '../../assets/banner.webp';
import LogoEstabelecimento from '../../components/LogoEstabelecimento';
import { useApp } from '../../context/appContext';
import { algumDiaAberto, DIAS_SEMANA, ORDEM_EXIBICAO } from '../../utils/horarios';
import { imagemProdutoPadrao, usarPlaceholderProduto } from '../../utils/productImage';
import styles from './index.module.css';

/* Assinatura exibida no rodapé público de todas as lojas. */
const NOME_PLATAFORMA = 'Cardápio Online';

/* Achata o texto para comparar: sem acento, sem caixa e sem separador
   nenhum. Com isso "X-Salada", "x salada" e "xsalada" viram a mesma
   chave, e a busca acha o produto de qualquer jeito que for digitado. */
function achatar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/* Os precos chegam formatados ("49,90"); para calcular o desconto exibido
   eles voltam a ser numero. So exibicao: o valor cobrado sai do backend. */
function paraNumero(valor) {
  if (typeof valor === 'number') return valor;
  return Number(String(valor ?? '').replace(/\./g, '').replace(',', '.'));
}

function percentualDesconto(promocao) {
  const antigo = paraNumero(promocao.precoAntigo);
  const atual = paraNumero(promocao.preco);
  if (!(antigo > 0) || !(atual >= 0) || atual >= antigo) return 0;
  return Math.round((1 - atual / antigo) * 100);
}

function Home() {
  const [rolouPagina, setRolouPagina] = useState(false);
  const [categoriaAtiva, setCategoriaAtiva] = useState('Todos');
  const [busca, setBusca] = useState('');
  /* painel aberto pelo menu do topo: 'promocoes', 'pedidos' ou null */
  const [painelMenu, setPainelMenu] = useState(null);
  const [bannerComErro, setBannerComErro] = useState('');
  /* fotos que falharam ao carregar: o cartao passa a ser exibido sem foto */
  const [fotosComErro, setFotosComErro] = useState(() => new Set());

  const [horariosAbertos, setHorariosAbertos] = useState(false);
  const horariosRef = useRef(null);

  const [listaCategoriasAberta, setListaCategoriasAberta] = useState(false);
  const listaCategoriasRef = useRef(null);

  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  const [modalProdutoAberto, setModalProdutoAberto] = useState(false);
  const [produtoSelecionado, setProdutoSelecionado] = useState(null);
  const modalProdutoRef = useRef(null);
  const fecharModalRef = useRef(null);
  const carrinhoRef = useRef(null);
  const fecharCarrinhoRef = useRef(null);
  const painelMenuRef = useRef(null);
  const fecharPainelRef = useRef(null);

  const [observacao, setObservacao] = useState('');
  const [quantidadeModal, setQuantidadeModal] = useState(1);
  /* Aviso curto de item adicionado: não abre o carrinho nem bloqueia a tela. */
  const [confirmacao, setConfirmacao] = useState(null);
  const temporizadorConfirmacao = useRef(null);

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
    avisosCarrinho,
    pedidoAtual
  } = useApp();

  const [adicionaisSelecionados, setAdicionaisSelecionados] =
    useState([]);

  const categorias = ['Todos', ...categoriasSalvas.filter((categoria) => categoria.ativo !== false).map((categoria) => categoria.nome)];

  const produtos = produtosSalvos.filter((produto) => produto.ativo !== false);
  const promocoes = promocoesSalvas.filter((promocao) => promocao.disponivel !== false);

  const adicionais = adicionaisSalvos;

  const adicionaisProduto = adicionais.filter((adicional) => {
    if (adicional.ativo === false) return false;
    if (!Array.isArray(produtoSelecionado?.adicionaisIds)) return true;
    return produtoSelecionado.adicionaisIds.some((id) => String(id) === String(adicional.id));
  });

  /* A busca ignora acento, caixa e separador: quem digita "hamburguer" ou
     "x salada" espera achar "Hambúrguer" e "X-Salada". */
  const buscaNormalizada = achatar(busca);

  /* O cardapio é lido por seção, não como uma lista única: cada categoria
     ativa vira um bloco com título. O filtro do topo passa a recortar quais
     blocos aparecem, em vez de misturar tudo em uma lista só.
     Com algo digitado na busca, a categoria escolhida deixa de valer: quem
     procura um produto quer achá-lo esteja ele em que seção estiver. */
  const gruposDeProdutos = categoriasSalvas
    .filter((categoria) => categoria.ativo !== false)
    .filter((categoria) => buscaNormalizada || categoriaAtiva === 'Todos' || categoria.nome === categoriaAtiva)
    .map((categoria) => ({
      nome: categoria.nome,
      itens: produtos
        .filter((produto) => produto.categoria === categoria.nome)
        .filter((produto) => !buscaNormalizada
          || achatar(produto.nome).includes(buscaNormalizada)
          || achatar(produto.descricao).includes(buscaNormalizada))
    }))
    .filter((grupo) => grupo.itens.length > 0);

  async function abrirCarrinho() {
    setCarrinhoAberto(true);
    await revalidarCarrinho().catch(() => {});
  }

  function fecharCarrinho() {
    setCarrinhoAberto(false);
  }

  function fecharPainelMenu() {
    setPainelMenu(null);
  }

  /* Sem foto cadastrada o catalogo entrega a imagem padrao; nos cartoes do
     cardapio e das promocoes ela nao aparece, e o cartao fica so com texto. */
  function fotoValida(imagem) {
    return Boolean(imagem) && imagem !== imagemProdutoPadrao && !fotosComErro.has(imagem);
  }

  function marcarFotoComErro(imagem) {
    setFotosComErro((anteriores) => new Set(anteriores).add(imagem));
  }

  /* A promocao escolhida no painel segue o mesmo caminho do cardapio: abre
     o modal de personalizacao e dali vai para o carrinho. */
  function escolherPromocao(promocao) {
    setPainelMenu(null);
    abrirModalProduto(promocao);
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

  useEffect(() => () => window.clearTimeout(temporizadorConfirmacao.current), []);

  function mostrarConfirmacao(texto) {
    window.clearTimeout(temporizadorConfirmacao.current);
    setConfirmacao({ id: Date.now(), texto });
    temporizadorConfirmacao.current = window.setTimeout(() => setConfirmacao(null), 2500);
  }

  /* Só produto sem nenhum adicional ativo vinculado pode ir direto para o
     carrinho: com opções, o modal continua sendo o caminho. */
  function produtoSemAdicionais(produto) {
    return Array.isArray(produto.adicionaisIds) && !adicionais.some((adicional) => (
      adicional.ativo !== false
      && produto.adicionaisIds.some((id) => String(id) === String(adicional.id))
    ));
  }

  /* Adição rápida: 1 unidade, sem observação. Soma na linha que já existe do
     mesmo produto nas mesmas condições. O preço exibido é só prévia; o
     servidor recalcula tudo ao validar o carrinho e ao fechar o pedido. */
  function adicionarRapido(produto) {
    const produtoId = produto.produtoId ?? produto.id;
    setCarrinho((carrinhoAtual) => {
      const existente = carrinhoAtual.find((item) => (
        (item.produtoId ?? item.id) === produtoId
        && !item.promocaoId
        && !item.observacao
        && !(item.adicionais?.length)
      ));
      if (existente) {
        return carrinhoAtual.map((item) => (
          item === existente ? { ...item, quantidade: Math.min(50, item.quantidade + 1) } : item
        ));
      }
      return [...carrinhoAtual, {
        ...produto,
        id: produtoId,
        produtoId,
        promocaoId: null,
        carrinhoId: `${produto.id}-${Date.now()}`,
        quantidade: 1,
        observacao: '',
        adicionais: [],
        precoFinal: Number(produto.preco.replace(',', '.'))
      }];
    });
    mostrarConfirmacao(`${produto.nome} adicionado ao carrinho`);
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
  const pedidosOnlineDisponiveis = Boolean(
    configuracao.lojaAberta && (configuracao.entregaAtiva || configuracao.retiradaAtiva)
  );
  const statusCurto = pedidosOnlineDisponiveis
    ? 'Aberto'
    : configuracao.lojaAberta
      ? 'Só consulta'
      : 'Fechado';
  const gradeDeHorarios = algumDiaAberto(configuracao.horarios);
  const podeFinalizar = pedidosOnlineDisponiveis;
  const nomeExibicao = configuracao.nomeLoja || 'Cardápio online';
  const tituloCardapio = configuracao.tituloCardapio?.trim() || 'Nosso cardápio';
  const textoApresentacao = configuracao.textoApresentacao?.trim() || 'Escolha o seu hambúrguer favorito.';
  const bannerConfigurado = configuracao.banner && configuracao.banner !== bannerComErro
    ? configuracao.banner
    : banner;
  /* Sem logo enviada, o circulo da identidade mostra as iniciais da loja:
     o nome inteiro nao cabe e quebraria no meio da palavra. */
  const iniciaisLoja = nomeExibicao
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join('')
    .toUpperCase();

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

  /* Os dois paineis suspensos do mobile (horarios e lista de categorias)
     fecham do mesmo jeito: toque fora ou Esc. */
  useEffect(() => {
    if (!horariosAbertos && !listaCategoriasAberta) return undefined;

    function fecharForaDoPainel(evento) {
      if (!horariosRef.current?.contains(evento.target)) setHorariosAbertos(false);
      if (!listaCategoriasRef.current?.contains(evento.target)) setListaCategoriasAberta(false);
    }

    function fecharComEsc(evento) {
      if (evento.key !== 'Escape') return;

      setHorariosAbertos(false);
      setListaCategoriasAberta(false);
    }

    document.addEventListener('pointerdown', fecharForaDoPainel);
    document.addEventListener('keydown', fecharComEsc);

    return () => {
      document.removeEventListener('pointerdown', fecharForaDoPainel);
      document.removeEventListener('keydown', fecharComEsc);
    };
  }, [horariosAbertos, listaCategoriasAberta]);
  
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
      /* 160px = a faixa amarela (23rem) menos a altura da barra (7rem): a
         barra embranquece no instante em que o amarelo sai de tras dela. */
      setRolouPagina(window.scrollY > 160);
    }

    verificarScroll();

    window.addEventListener('scroll', verificarScroll);

    return () => {
      window.removeEventListener('scroll', verificarScroll);
    };
  }, []);

  useEffect(() => {
    if (!modalProdutoAberto && !carrinhoAberto && !painelMenu) return undefined;

    const focoAnterior = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const container = modalProdutoAberto
      ? modalProdutoRef.current
      : painelMenu ? painelMenuRef.current : carrinhoRef.current;
    const alvoInicial = modalProdutoAberto
      ? fecharModalRef.current
      : painelMenu ? fecharPainelRef.current : fecharCarrinhoRef.current;
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
      } else if (painelMenu) {
        setPainelMenu(null);
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
  }, [carrinhoAberto, modalProdutoAberto, painelMenu]);

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

    const nomeAdicionado = produtoSelecionado.nome;

    fecharModalProduto();

    mostrarConfirmacao(`${nomeAdicionado} adicionado ao carrinho`);
  }

  return (
    <div className={`${styles.pagina} ${quantidadeCarrinho > 0 ? styles.paginaComBarra : ''}`}>
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
            <button
              type="button"
              onClick={() => setPainelMenu('promocoes')}
              aria-haspopup="dialog"
              aria-expanded={painelMenu === 'promocoes'}
            >
              <BadgePercent aria-hidden="true" strokeWidth={1.8} />
              <span className={styles.textoMenu}>Promoções</span>
            </button>

            <button
              type="button"
              onClick={() => setPainelMenu('pedidos')}
              aria-haspopup="dialog"
              aria-expanded={painelMenu === 'pedidos'}
            >
              <ShoppingBag aria-hidden="true" strokeWidth={1.8} />
              <span className={styles.textoMenu}>Pedidos</span>
            </button>
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
      <section id="inicio" className={styles.banner}>
        <div
          className={styles.fotoBanner}
          style={{ backgroundImage: `url(${JSON.stringify(bannerConfigurado)})` }}
          role="img"
          aria-label={`Foto da ${nomeExibicao}`}
        />

        <div className={styles.conteudoBanner}>
          {/* Identidade da loja: a logo encosta na foto e ao lado dela ficam o
              nome, o endereco e a linha que decide o pedido. O horario nao
              ocupa um chip fixo: fica dentro do status, que abre a grade da
              semana. Quem abre um cardapio quer saber de que loja ele e. */}
          <div className={styles.identidadeLoja} ref={horariosRef}>
            <div className={styles.identidadeLogo}>
              <LogoEstabelecimento configuracao={configuracao} alternativa={iniciaisLoja} loading="lazy" />
            </div>

            <div className={styles.identidadeTextos}>
              <strong className={styles.identidadeNome}>{nomeExibicao}</strong>

              {configuracao.endereco && (
                <span className={styles.identidadeEndereco}>{configuracao.endereco}</span>
              )}

              <div className={styles.identidadeInfos}>
                <button
                  type="button"
                  className={`${styles.chipLoja} ${styles.chipStatus} ${pedidosOnlineDisponiveis ? styles.chipAberto : styles.chipFechado}`}
                  onClick={() => setHorariosAbertos((aberto) => !aberto)}
                  aria-expanded={horariosAbertos}
                  aria-controls="horarios-da-loja"
                >
                  <span className={styles.pontoStatus} aria-hidden="true" />
                  {statusCurto}

                  <svg
                    className={`${styles.setaChip} ${horariosAbertos ? styles.setaChipAberta : ''}`}
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      d="M6 9L12 15L18 9"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                {/* So o tempo de entrega acompanha o status: como texto solto ele
                    cabe na mesma linha, sem obrigar a arrastar a fila. Retirada e
                    pedido minimo continuam no rodape e no carrinho. */}
                {configuracao.entregaAtiva && configuracao.tempoEntrega && (
                  <span className={styles.infoLoja}>
                    <span>Entrega</span>
                    <strong>{configuracao.tempoEntrega}</strong>
                  </span>
                )}
              </div>
            </div>

            {/* Ocupa o vazio ao lado da identidade no desktop; no celular
                desce para dentro do cartao. Filtra o cardapio inteiro, nao
                so a categoria aberta. */}
            <form
              className={styles.buscaProduto}
              role="search"
              onSubmit={(evento) => evento.preventDefault()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle
                  cx="11"
                  cy="11"
                  r="7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M16.5 16.5L21 21"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>

              <input
                type="search"
                value={busca}
                onChange={(evento) => setBusca(evento.target.value)}
                placeholder="Busque por um produto"
                aria-label="Busque por um produto"
              />
            </form>

            {/* Fora da fila de chips: a fila rola na horizontal e recortaria
                o painel se ele morasse dentro dela. */}
            {horariosAbertos && (
              <div className={styles.painelHorarios} id="horarios-da-loja">
                <span className={styles.tituloHorarios}>Horários</span>

                {/* Sem grade preenchida, o horario da loja e o texto livre que
                    o administrador escreveu — listar sete "Fechado" mentiria. */}
                {gradeDeHorarios ? (
                  <ul>
                    {ORDEM_EXIBICAO.map((indice) => {
                      const dia = configuracao.horarios[indice];

                      return (
                        <li key={indice}>
                          <span>{DIAS_SEMANA[indice].curto}</span>
                          <strong className={dia.aberto ? '' : styles.diaFechado}>
                            {dia.aberto ? `${dia.abre} - ${dia.fecha}` : 'Fechado'}
                          </strong>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className={styles.horarioLivre}>
                    {configuracao.horarioFuncionamento || 'Horário ainda não informado.'}
                  </p>
                )}
              </div>
            )}
          </div>

        </div>
      </section>

      <section
        id="cardapio"
        className={styles.cardapio}
      >

        <h2>{tituloCardapio}</h2>

        <p>{textoApresentacao}</p>

        {/* A fila de chips exigia arrastar de lado para achar uma categoria e,
            com muitas categorias, escondia a maior parte delas. No lugar dela,
            um botao unico que abre a lista inteira. */}
        <div className={styles.seletorCategorias} ref={listaCategoriasRef}>
          <button
            type="button"
            className={styles.botaoListaCategorias}
            onClick={() => setListaCategoriasAberta((aberta) => !aberta)}
            aria-expanded={listaCategoriasAberta}
            aria-controls="lista-de-categorias"
          >
            {categoriaAtiva === 'Todos' ? 'Lista de categorias' : categoriaAtiva}

            <svg
              className={`${styles.setaChip} ${listaCategoriasAberta ? styles.setaChipAberta : ''}`}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                d="M6 9L12 15L18 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {listaCategoriasAberta && (
            <ul className={styles.menuCategorias} id="lista-de-categorias">
              {categorias.map((categoria) => (
                <li key={categoria}>
                  <button
                    type="button"
                    className={categoriaAtiva === categoria ? styles.categoriaSelecionada : ''}
                    onClick={() => {
                      setCategoriaAtiva(categoria);
                      setListaCategoriasAberta(false);
                    }}
                    aria-current={categoriaAtiva === categoria ? 'true' : undefined}
                  >
                    {categoria}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {gruposDeProdutos.map((grupo) => (
          <section className={styles.grupoCategoria} key={grupo.nome}>
            <h3 className={styles.tituloGrupo}>{grupo.nome}</h3>

            <div className={styles.listaProdutos}>
              {grupo.itens.map((produto) => (
            <article
              className={`${styles.cardProduto} ${fotoValida(produto.imagem) ? '' : styles.cardProdutoSemFoto}`}
              key={produto.id}
            >
              {/* A linha inteira e o alvo de toque. Com foto, nada fica por
                  cima dela; sem foto, o "+" ocupa sozinho o lugar da miniatura
                  como indicativo de que da para adicionar. */}
              {fotoValida(produto.imagem) ? (
                <div className={styles.areaImagemProduto}>
                  <img
                    src={produto.imagem}
                    alt={produto.nome}
                    onError={() => marcarFotoComErro(produto.imagem)}
                    className={styles.imagemProduto}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              ) : (
                !produtoSemAdicionais(produto) && <span className={styles.indicadorAdicionar} aria-hidden="true">+</span>
              )}

              <div className={styles.informacoesProduto}>
                {produto.destaque && (
                  <span className={styles.seloProduto}>
                    🔥 {produto.destaque}
                  </span>
                )}

                <div>
                  <h4 className={styles.informacoesProdutoTitulo}>{produto.nome}</h4>
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

              {produtoSemAdicionais(produto) && (
                <button
                  type="button"
                  className={styles.botaoAdicaoRapida}
                  onClick={() => adicionarRapido(produto)}
                  aria-label={`Adicionar ${produto.nome} ao carrinho`}
                >
                  +
                </button>
              )}
            </article>
              ))}
            </div>
          </section>
        ))}

        {gruposDeProdutos.length === 0 && (
          <p className={styles.semResultados} role="status">
            {busca.trim()
              ? `Nenhum produto encontrado para "${busca.trim()}".`
              : 'Nenhum produto disponível nesta categoria.'}
          </p>
        )}
      </section>
      </main>

      {/* Rodapé enxuto: uma faixa na cor principal da loja com os direitos
          de um lado e a assinatura da plataforma do outro. */}
      <footer
        id="sobre"
        className={styles.rodapeLoja}
      >
        <p>{nomeExibicao} - {new Date().getFullYear()}. Todos os direitos reservados</p>

        <div className={styles.linksRodape}>
          <Link to="/politica-de-privacidade">Política de Privacidade</Link>
          <span aria-hidden="true">•</span>
          <Link to="/termos-de-uso">Termos de Uso</Link>
          <span aria-hidden="true">•</span>
          <p>
            Plataforma fornecida por <strong>{NOME_PLATAFORMA}</strong>
          </p>
        </div>
      </footer>

      {/* Painel do menu do topo: lista as promocoes disponiveis ou mostra o
          pedido feito nesta sessao. */}
      {painelMenu && (
        <div
          className={styles.overlayPainel}
          onClick={fecharPainelMenu}
        >
          <div
            className={styles.painelMenu}
            ref={painelMenuRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-painel-menu"
            onClick={(evento) => evento.stopPropagation()}
          >
            <div className={styles.topoPainel}>
              <h2 id="titulo-painel-menu">
                {painelMenu === 'promocoes' ? 'Promoções' : 'Pedidos'}
              </h2>

              <button
                type="button"
                className={styles.fecharPainel}
                ref={fecharPainelRef}
                onClick={fecharPainelMenu}
                aria-label="Fechar"
              >
                <X aria-hidden="true" strokeWidth={2.2} />
              </button>
            </div>

            <div className={styles.corpoPainel}>
              {painelMenu === 'promocoes' && promocoes.map((promocao) => {
                const desconto = percentualDesconto(promocao);

                return (
                  <button
                    type="button"
                    key={promocao.id}
                    className={`${styles.cartaoPainel} ${styles.cartaoPromocaoPainel}`}
                    onClick={() => escolherPromocao(promocao)}
                  >
                    {fotoValida(promocao.imagem) && (
                      <img
                        className={styles.fotoCartaoPainel}
                        src={promocao.imagem}
                        alt=""
                        onError={() => marcarFotoComErro(promocao.imagem)}
                        loading="lazy"
                        decoding="async"
                      />
                    )}

                    <span className={styles.textosCartaoPainel}>
                      <strong className={styles.nomeCartaoPainel}>{promocao.nome}</strong>

                      <span className={styles.precosPainel}>
                        <span className={styles.precoAtualPainel}>R$ {promocao.preco}</span>

                        {promocao.precoAntigo && (
                          <span className={styles.precoAntigoPainel}>R$ {promocao.precoAntigo}</span>
                        )}

                        {desconto > 0 && (
                          <span className={styles.descontoPainel}>-{desconto}%</span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}

              {painelMenu === 'promocoes' && promocoes.length === 0 && (
                <p className={styles.semResultados}>Nenhuma promoção disponível no momento.</p>
              )}

              {painelMenu === 'pedidos' && (pedidoAtual ? (
                <div className={styles.cartaoPainel}>
                  <strong className={styles.nomeCartaoPainel}>
                    Pedido #{pedidoAtual.numero ?? pedidoAtual.id}
                  </strong>

                  <span className={styles.precosPainel}>
                    <span className={styles.statusPainel}>{pedidoAtual.status ?? 'Recebido'}</span>

                    {pedidoAtual.total != null && (
                      <span className={styles.precoAtualPainel}>
                        R$ {Number(pedidoAtual.total).toFixed(2).replace('.', ',')}
                      </span>
                    )}
                  </span>

                  <button
                    type="button"
                    className={styles.acompanharPedido}
                    onClick={() => navigate('/pedido-finalizado')}
                  >
                    Acompanhar pedido
                  </button>
                </div>
              ) : (
                <p className={styles.semResultados}>Você ainda não fez nenhum pedido por aqui.</p>
              ))}
            </div>
          </div>
        </div>
      )}

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


            {/* ADICIONAIS: a seção só aparece quando o produto tem opções. */}

            {adicionaisProduto.length > 0 && (
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

              </div>

            </div>
            )}


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

            {!pedidosOnlineDisponiveis && <p className={styles.bloqueioCarrinho}>{configuracao.lojaAberta ? 'Delivery e retirada estão indisponíveis.' : 'A loja está fechada no momento.'}</p>}

            <button
              type="button"
              className={styles.finalizarPedido}
              onClick={() => navigate('/finalizar-pedido')}
              disabled={!podeFinalizar}
            >
              {podeFinalizar ? 'Finalizar Pedido' : 'Pedidos indisponíveis'}
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

      {/* Celular: atalho fixo para o carrinho enquanto se navega pelo cardápio. */}
      {quantidadeCarrinho > 0 && !carrinhoAberto && !modalProdutoAberto && !painelMenu && (
        <button
          type="button"
          className={styles.barraCarrinho}
          onClick={abrirCarrinho}
          aria-haspopup="dialog"
          aria-controls="carrinho-lateral"
        >
          <span className={styles.quantidadeBarraCarrinho}>
            {quantidadeCarrinho} {quantidadeCarrinho === 1 ? 'item' : 'itens'}
          </span>
          <strong>Ver carrinho</strong>
          <span>R$ {totalCarrinho.toFixed(2).replace('.', ',')}</span>
        </button>
      )}

      <div className={styles.confirmacaoCarrinho} role="status" aria-live="polite">
        {confirmacao && <span key={confirmacao.id}>{confirmacao.texto}</span>}
      </div>

      
    </div>
  );
}

export default Home;
