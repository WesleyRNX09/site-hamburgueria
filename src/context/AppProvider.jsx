import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { configuracaoInicial } from '../data/initialData';
import { aplicarTema, normalizarConfiguracaoPublica } from '../utils/theme';
import {
  acompanharPedidoApi,
  adicionarItemComandaApi,
  abrirComandaAdminApi,
  adicionarItemComandaAdminApi,
  alterarStatusAdicionalApi,
  alterarStatusAdministradorApi,
  alterarStatusCategoriaApi,
  alterarStatusFuncionarioApi,
  alterarStatusProdutoApi,
  atualizarAdicionalApi,
  atualizarCategoriaApi,
  atualizarFuncionarioApi,
  atualizarItemComandaAdminApi,
  atualizarProdutoApi,
  atualizarPromocaoApi,
  atualizarStatusPedidoApi,
  abrirComandaApi,
  buscarDadosAdmin,
  buscarDadosGarcom,
  buscarDadosPublicos,
  confirmarPagamentoPedidoApi,
  criarAdicionalApi,
  criarAdministradorApi,
  criarCategoriaApi,
  criarFuncionarioApi,
  criarMesaAdminApi,
  criarPedidoDeliveryApi,
  criarProdutoApi,
  criarPromocaoApi,
  ErroApi,
  enviarComandaApi,
  estornarPagamentoPedidoApi,
  excluirAdicionalApi,
  excluirProdutoApi,
  excluirPromocaoApi,
  fecharComandaApi,
  finalizarComandaAdminApi,
  loginAdmin,
  loginGarcom,
  logoutAdmin,
  logoutGarcom,
  removerItemComandaApi,
  removerItemComandaAdminApi,
  salvarConfiguracaoApi,
  solicitarContaApi,
  validarSessaoAdmin,
  validarCarrinhoApi,
  validarSessaoGarcom,
  alterarSenhaAdministradorApi
} from '../services/api';
import { AppContext } from './appContext';

const CHAVES = {
  carrinho: 'hamburgueria_carrinho',
  pedidoAtual: 'hamburgueria_pedido_atual',
  admin: 'hamburgueria_admin_sessao',
  garcom: 'hamburgueria_garcom_sessao'
};

function lerLocal(chave, valorInicial) {
  try {
    const valor = localStorage.getItem(chave);
    return valor ? JSON.parse(valor) : valorInicial;
  } catch {
    return valorInicial;
  }
}

function lerSessao(chave) {
  try {
    const valor = sessionStorage.getItem(chave);
    return valor ? JSON.parse(valor) : null;
  } catch {
    return null;
  }
}

function lerSessaoComToken(chave) {
  const sessao = lerSessao(chave);
  return sessao?.token ? sessao : null;
}

function lerPedidoAtual() {
  const pedido = lerSessao(CHAVES.pedidoAtual);
  return pedido?.id && pedido?.tokenAcompanhamento ? pedido : null;
}

function numeroPreco(valor) {
  if (typeof valor === 'number') return valor;
  return Number(String(valor).replace(',', '.')) || 0;
}

function normalizarProdutos(lista) {
  return (lista ?? []).map((produto) => ({
    ...produto,
    imagem: produto.imagem || '/produto-placeholder.svg',
    adicionaisIds: produto.adicionaisIds ?? []
  }));
}

function normalizarPromocoes(lista, produtos) {
  return (lista ?? []).map((promocao) => {
    const produto = produtos.find((item) => item.id === promocao.produtoId);
    return {
      ...promocao,
      adicionaisIds: produto?.adicionaisIds ?? [],
      imagem: promocao.imagem
        || produto?.imagem
        || produtos.find((item) => item.nome === promocao.nome)?.imagem
        || '/produto-placeholder.svg'
    };
  });
}

export function AppProvider({ children }) {
  const areaSuperadmin = window.location.pathname === '/superadmin'
    || window.location.pathname.startsWith('/superadmin/');
  const [categorias, setCategorias] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [adicionais, setAdicionais] = useState([]);
  const [promocoes, setPromocoes] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [mesas, setMesas] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [comandas, setComandas] = useState([]);
  const [administradores, setAdministradores] = useState([]);
  const [auditoria, setAuditoria] = useState([]);
  const [configuracao, setConfiguracaoEstado] = useState(() => normalizarConfiguracaoPublica(configuracaoInicial));
  const [carrinho, setCarrinho] = useState(() => {
    const salvo = lerLocal(CHAVES.carrinho, []);
    return Array.isArray(salvo) ? salvo : [];
  });
  const [pedidoAtual, setPedidoAtual] = useState(lerPedidoAtual);
  const [pedidoAtualCarregando, setPedidoAtualCarregando] = useState(
    () => Boolean(lerPedidoAtual())
  );
  const pedidoAtualValidado = useRef(false);
  const [adminSessao, setAdminSessao] = useState(() => lerSessaoComToken(CHAVES.admin));
  const [garcomSessao, setGarcomSessao] = useState(() => lerSessaoComToken(CHAVES.garcom));
  const [catalogoCarregando, setCatalogoCarregando] = useState(() => !areaSuperadmin);
  const [sessaoAdminCarregando, setSessaoAdminCarregando] = useState(() => Boolean(lerSessaoComToken(CHAVES.admin)));
  const [sessaoGarcomCarregando, setSessaoGarcomCarregando] = useState(() => Boolean(lerSessaoComToken(CHAVES.garcom)));
  const [erroApi, setErroApi] = useState('');
  const [avisosCarrinho, setAvisosCarrinho] = useState([]);
  const [alertaNovoPedido, setAlertaNovoPedido] = useState(null);
  const [pedidosNovos, setPedidosNovos] = useState([]);
  const pedidosConhecidosRef = useRef(new Set());
  const pedidosInicializadosRef = useRef(false);
  const audioLiberadoRef = useRef(false);

  useEffect(() => localStorage.setItem(CHAVES.carrinho, JSON.stringify(carrinho)), [carrinho]);
  useLayoutEffect(() => aplicarTema(document.documentElement, configuracao), [configuracao]);
  useEffect(() => {
    const nome = configuracao.nomeLoja?.trim();
    const titulo = nome ? `${nome} | Cardápio e pedidos` : 'Cardápio e pedidos online';
    const descricao = nome
      ? `Consulte o cardápio e faça seu pedido online na ${nome}.`
      : 'Cardápio e pedidos online para entrega ou retirada.';
    document.title = titulo;
    const metaDescricao = document.querySelector('meta[name="description"]');
    if (metaDescricao) metaDescricao.setAttribute('content', descricao);
    const metas = {
      'meta[property="og:title"]': titulo,
      'meta[property="og:description"]': descricao,
      'meta[name="twitter:title"]': titulo,
      'meta[name="twitter:description"]': descricao
    };
    Object.entries(metas).forEach(([seletor, conteudo]) => document.querySelector(seletor)?.setAttribute('content', conteudo));
    const imagemSocial = document.querySelector('meta[property="og:image"]');
    if (imagemSocial) imagemSocial.setAttribute('content', configuracao.logo ? new URL(configuracao.logo, window.location.origin).href : '');
    const urlSocial = document.querySelector('meta[property="og:url"]');
    if (urlSocial) urlSocial.setAttribute('content', import.meta.env.VITE_PUBLIC_URL || '');
  }, [configuracao.logo, configuracao.nomeLoja]);

  useEffect(() => {
    const liberarAudio = () => { audioLiberadoRef.current = true; };
    window.addEventListener('pointerdown', liberarAudio, { once: true });
    window.addEventListener('keydown', liberarAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', liberarAudio);
      window.removeEventListener('keydown', liberarAudio);
    };
  }, []);
  useEffect(() => {
    if (pedidoAtual) sessionStorage.setItem(CHAVES.pedidoAtual, JSON.stringify(pedidoAtual));
    else sessionStorage.removeItem(CHAVES.pedidoAtual);
  }, [pedidoAtual]);

  const tocarSomNovoPedido = useCallback(() => {
    if (!audioLiberadoRef.current) return;
    try {
      const AudioContexto = window.AudioContext || window.webkitAudioContext;
      if (!AudioContexto) return;
      const contexto = new AudioContexto();
      const oscilador = contexto.createOscillator();
      const ganho = contexto.createGain();
      oscilador.type = 'sine';
      oscilador.frequency.setValueAtTime(880, contexto.currentTime);
      oscilador.frequency.setValueAtTime(1046, contexto.currentTime + 0.12);
      ganho.gain.setValueAtTime(0.0001, contexto.currentTime);
      ganho.gain.exponentialRampToValueAtTime(0.16, contexto.currentTime + 0.02);
      ganho.gain.exponentialRampToValueAtTime(0.0001, contexto.currentTime + 0.32);
      oscilador.connect(ganho);
      ganho.connect(contexto.destination);
      oscilador.start();
      oscilador.stop(contexto.currentTime + 0.34);
      oscilador.addEventListener('ended', () => contexto.close().catch(() => {}));
    } catch {
      // O alerta visual permanece disponível quando o navegador bloquear áudio.
    }
  }, []);

  const aplicarDados = useCallback((dados) => {
    const produtosNormalizados = dados.produtos ? normalizarProdutos(dados.produtos) : null;
    if (dados.categorias) setCategorias(dados.categorias);
    if (produtosNormalizados) setProdutos(produtosNormalizados);
    if (dados.adicionais) setAdicionais(dados.adicionais);
    if (dados.promocoes) {
      setPromocoes(normalizarPromocoes(dados.promocoes, produtosNormalizados ?? []));
    }
    if (dados.funcionarios) setFuncionarios(dados.funcionarios);
    if (dados.mesas) setMesas(dados.mesas);
    if (dados.pedidos) {
      const idsRecebidos = new Set(dados.pedidos.map((pedido) => pedido.id));
      if (pedidosInicializadosRef.current) {
        const novos = dados.pedidos.filter((pedido) => !pedidosConhecidosRef.current.has(pedido.id));
        if (novos.length > 0) {
          setPedidosNovos(novos.map((pedido) => pedido.id));
          setAlertaNovoPedido({ quantidade: novos.length, pedido: novos[0] });
          tocarSomNovoPedido();
          window.setTimeout(() => setPedidosNovos([]), 12000);
        }
      } else {
        pedidosInicializadosRef.current = true;
      }
      pedidosConhecidosRef.current = idsRecebidos;
      setPedidos(dados.pedidos);
    }
    if (dados.comandas) setComandas(dados.comandas);
    if (dados.administradores) setAdministradores(dados.administradores);
    if (dados.auditoria) setAuditoria(dados.auditoria);
    if (dados.configuracao) setConfiguracaoEstado(normalizarConfiguracaoPublica(dados.configuracao));
  }, [tocarSomNovoPedido]);

  const recarregarPublico = useCallback(async () => {
    const dados = await buscarDadosPublicos();
    aplicarDados(dados);
    return dados;
  }, [aplicarDados]);

  const recarregarAdmin = useCallback(async () => {
    const dados = await buscarDadosAdmin();
    aplicarDados(dados);
    return dados;
  }, [aplicarDados]);

  const recarregarGarcom = useCallback(async () => {
    const dados = await buscarDadosGarcom();
    aplicarDados(dados);
    return dados;
  }, [aplicarDados]);

  useEffect(() => {
    if (areaSuperadmin) return undefined;
    let ativo = true;
    buscarDadosPublicos()
      .then((dados) => {
        if (!ativo) return;
        aplicarDados(dados);
        setErroApi('');
      })
      .catch((erro) => {
        if (ativo) setErroApi(erro.message);
      })
      .finally(() => {
        if (ativo) setCatalogoCarregando(false);
      });
    return () => { ativo = false; };
  }, [aplicarDados, areaSuperadmin]);

  useEffect(() => {
    if (!adminSessao?.token) return undefined;
    let ativo = true;
    const token = adminSessao.token;
    Promise.all([validarSessaoAdmin(), buscarDadosAdmin()])
      .then(([{ admin }, dados]) => {
        if (!ativo) return;
        const sessao = { ...admin, token };
        sessionStorage.setItem(CHAVES.admin, JSON.stringify(sessao));
        setAdminSessao(sessao);
        aplicarDados(dados);
      })
      .catch(() => {
        if (!ativo) return;
        sessionStorage.removeItem(CHAVES.admin);
        setAdminSessao(null);
      })
      .finally(() => {
        if (ativo) setSessaoAdminCarregando(false);
      });
    return () => { ativo = false; };
  }, [adminSessao?.token, aplicarDados]);

  useEffect(() => {
    if (!garcomSessao?.token) return undefined;
    let ativo = true;
    const token = garcomSessao.token;
    Promise.all([validarSessaoGarcom(), buscarDadosGarcom()])
      .then(([{ garcom }, dados]) => {
        if (!ativo) return;
        const sessao = { ...garcom, token };
        sessionStorage.setItem(CHAVES.garcom, JSON.stringify(sessao));
        setGarcomSessao(sessao);
        aplicarDados(dados);
      })
      .catch(() => {
        if (!ativo) return;
        sessionStorage.removeItem(CHAVES.garcom);
        setGarcomSessao(null);
      })
      .finally(() => {
        if (ativo) setSessaoGarcomCarregando(false);
      });
    return () => { ativo = false; };
  }, [garcomSessao?.token, aplicarDados]);

  useEffect(() => {
    if (!adminSessao?.token && !garcomSessao?.token) return undefined;
    const atualizar = () => {
      const operacao = adminSessao?.token ? recarregarAdmin() : recarregarGarcom();
      operacao.catch(() => {});
    };
    const intervalo = setInterval(atualizar, 15000);
    return () => clearInterval(intervalo);
  }, [adminSessao?.token, garcomSessao?.token, recarregarAdmin, recarregarGarcom]);

  const pedidoAtualId = pedidoAtual?.id;
  const pedidoAtualToken = pedidoAtual?.tokenAcompanhamento;

  useEffect(() => {
    if (!pedidoAtualId || !pedidoAtualToken) return undefined;
    let ativo = true;
    let validado = pedidoAtualValidado.current;
    const atualizar = () => acompanharPedidoApi(pedidoAtualId, pedidoAtualToken)
      .then(({ pedido }) => {
        if (ativo) {
          validado = true;
          pedidoAtualValidado.current = true;
          setPedidoAtual(pedido);
        }
      })
      .catch((erro) => {
        if (ativo && (!validado || (erro instanceof ErroApi && erro.status === 404))) {
          pedidoAtualValidado.current = false;
          setPedidoAtual(null);
        }
      })
      .finally(() => {
        if (ativo) setPedidoAtualCarregando(false);
      });
    atualizar();
    const intervalo = setInterval(atualizar, 10000);
    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, [pedidoAtualId, pedidoAtualToken]);

  async function recarregarCatalogo() {
    setCatalogoCarregando(true);
    try {
      await recarregarPublico();
      setErroApi('');
    } catch (erro) {
      setErroApi(erro.message);
      throw erro;
    } finally {
      setCatalogoCarregando(false);
    }
  }

  async function entrarAdmin(usuario, senha) {
    try {
      const { admin, token } = await loginAdmin(usuario, senha);
      const sessao = { ...admin, token };
      sessionStorage.setItem(CHAVES.admin, JSON.stringify(sessao));
      setAdminSessao(sessao);
      await recarregarAdmin();
      return true;
    } catch (erro) {
      if (erro instanceof ErroApi && erro.status === 401) return false;
      throw erro;
    }
  }

  async function sairAdmin() {
    await logoutAdmin().catch(() => {});
    sessionStorage.removeItem(CHAVES.admin);
    setAdminSessao(null);
    setSessaoAdminCarregando(false);
    setPedidos([]);
    setComandas([]);
    setMesas([]);
    setFuncionarios([]);
    setAdministradores([]);
    setAuditoria([]);
    setAlertaNovoPedido(null);
    setPedidosNovos([]);
    pedidosConhecidosRef.current = new Set();
    pedidosInicializadosRef.current = false;
    await recarregarPublico().catch(() => {});
  }

  async function entrarGarcom(tokenAcesso, pin) {
    try {
      const { garcom, token } = await loginGarcom(tokenAcesso, pin);
      const sessao = { ...garcom, token };
      sessionStorage.setItem(CHAVES.garcom, JSON.stringify(sessao));
      setGarcomSessao(sessao);
      await recarregarGarcom();
      return true;
    } catch (erro) {
      if (erro instanceof ErroApi && erro.status === 401) return false;
      throw erro;
    }
  }

  async function sairGarcom() {
    await logoutGarcom().catch(() => {});
    sessionStorage.removeItem(CHAVES.garcom);
    setGarcomSessao(null);
    setSessaoGarcomCarregando(false);
    setMesas([]);
    setComandas([]);
    await recarregarPublico().catch(() => {});
  }

  async function salvarProduto(dados) {
    const resposta = dados.id
      ? await atualizarProdutoApi(dados.id, dados)
      : await criarProdutoApi(dados);
    const normalizado = normalizarProdutos([resposta.produto])[0];
    setProdutos((atuais) => dados.id
      ? atuais.map((item) => item.id === normalizado.id ? normalizado : item)
      : [...atuais, normalizado]);
    return normalizado.id;
  }

  async function salvarCategoria(dados) {
    const resposta = dados.id
      ? await atualizarCategoriaApi(dados.id, dados)
      : await criarCategoriaApi(dados);
    setCategorias((atuais) => dados.id
      ? atuais.map((item) => item.id === resposta.categoria.id ? resposta.categoria : item)
      : [...atuais, resposta.categoria].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome)));
    return resposta.categoria.id;
  }

  async function alternarCategoria(id) {
    const atual = categorias.find((categoria) => categoria.id === id);
    if (!atual) return;
    const { categoria } = await alterarStatusCategoriaApi(id, !atual.ativo);
    setCategorias((atuais) => atuais.map((item) => item.id === id ? categoria : item));
  }

  async function criarAdministrador(dados) {
    const { administrador } = await criarAdministradorApi(dados);
    setAdministradores((atuais) => [...atuais, administrador].sort((a, b) => a.nome.localeCompare(b.nome)));
    await recarregarAdmin();
    return administrador.id;
  }

  async function alternarAdministrador(id) {
    const atual = administradores.find((administrador) => administrador.id === id);
    if (!atual) return;
    const { administrador } = await alterarStatusAdministradorApi(id, !atual.ativo);
    setAdministradores((atuais) => atuais.map((item) => item.id === id ? administrador : item));
    await recarregarAdmin();
  }

  async function alterarSenhaAdministrador(dados) {
    await alterarSenhaAdministradorApi(dados);
    await recarregarAdmin();
  }

  async function removerProduto(id) {
    await excluirProdutoApi(id);
    setProdutos((atuais) => atuais.filter((produto) => produto.id !== id));
  }

  async function alternarProduto(id) {
    const atual = produtos.find((produto) => produto.id === id);
    if (!atual) return;
    const { produto } = await alterarStatusProdutoApi(id, !atual.ativo);
    const normalizado = normalizarProdutos([produto])[0];
    setProdutos((atuais) => atuais.map((item) => item.id === id ? normalizado : item));
  }

  async function salvarAdicional(dados) {
    const resposta = dados.id
      ? await atualizarAdicionalApi(dados.id, dados)
      : await criarAdicionalApi(dados);
    setAdicionais((atuais) => dados.id
      ? atuais.map((item) => item.id === resposta.adicional.id ? resposta.adicional : item)
      : [...atuais, resposta.adicional]);
    return resposta.adicional.id;
  }

  async function removerAdicional(id) {
    await excluirAdicionalApi(id);
    setAdicionais((atuais) => atuais.filter((adicional) => adicional.id !== id));
    setProdutos((atuais) => atuais.map((produto) => ({
      ...produto,
      adicionaisIds: (produto.adicionaisIds ?? []).filter((adicionalId) => adicionalId !== id)
    })));
  }

  async function alternarAdicional(id) {
    const atual = adicionais.find((adicional) => adicional.id === id);
    if (!atual) return;
    const { adicional } = await alterarStatusAdicionalApi(id, atual.ativo === false);
    setAdicionais((atuais) => atuais.map((item) => item.id === id ? adicional : item));
  }

  async function salvarPromocao(dados) {
    const resposta = dados.id
      ? await atualizarPromocaoApi(dados.id, dados)
      : await criarPromocaoApi(dados);
    const normalizada = normalizarPromocoes([resposta.promocao], produtos)[0];
    setPromocoes((atuais) => dados.id
      ? atuais.map((item) => item.id === normalizada.id ? normalizada : item)
      : [...atuais, normalizada]);
    return normalizada.id;
  }

  async function removerPromocao(id) {
    await excluirPromocaoApi(id);
    setPromocoes((atuais) => atuais.filter((promocao) => promocao.id !== id));
  }

  async function salvarFuncionario(dados) {
    const resposta = dados.id
      ? await atualizarFuncionarioApi(dados.id, dados)
      : await criarFuncionarioApi(dados);
    setFuncionarios((atuais) => dados.id
      ? atuais.map((item) => item.id === resposta.funcionario.id ? resposta.funcionario : item)
      : [...atuais, resposta.funcionario]);
    return resposta.funcionario.id;
  }

  async function alternarFuncionario(id) {
    const atual = funcionarios.find((funcionario) => funcionario.id === id);
    if (!atual) return;
    const { funcionario } = await alterarStatusFuncionarioApi(id, atual.status !== 'Ativo');
    setFuncionarios((atuais) => atuais.map((item) => item.id === id ? funcionario : item));
  }

  async function atualizarStatusPedido(id, status) {
    const { pedido } = await atualizarStatusPedidoApi(id, status);
    setPedidos((atuais) => atuais.map((item) => item.id === id ? pedido : item));
    setPedidoAtual((atual) => atual?.id === id ? { ...pedido, tokenAcompanhamento: atual.tokenAcompanhamento } : atual);
  }

  async function confirmarPagamentoPedido(id) {
    const { pedido } = await confirmarPagamentoPedidoApi(id);
    setPedidos((atuais) => atuais.map((item) => item.id === id ? pedido : item));
    await recarregarAdmin();
    return pedido;
  }

  async function estornarPagamentoPedido(id) {
    const { pedido } = await estornarPagamentoPedidoApi(id);
    setPedidos((atuais) => atuais.map((item) => item.id === id ? pedido : item));
    await recarregarAdmin();
    return pedido;
  }

  function itensCarrinhoParaApi(lista) {
    return lista.map((item) => ({
      carrinhoId: item.carrinhoId,
      produtoId: item.produtoId ?? item.id,
      promocaoId: item.promocaoId ?? null,
      quantidade: item.quantidade,
      adicionais: (item.adicionais ?? []).map((adicional) => adicional.id),
      observacao: item.observacao || undefined,
      precoFinal: item.precoFinal ?? numeroPreco(item.preco),
      nome: item.nome
    }));
  }

  async function revalidarCarrinho() {
    if (carrinho.length === 0) {
      setAvisosCarrinho([]);
      return { itens: [], alteracoes: [] };
    }
    const resultado = await validarCarrinhoApi(itensCarrinhoParaApi(carrinho));
    const normalizados = normalizarProdutos(resultado.itens);
    setCarrinho(normalizados);
    setAvisosCarrinho(resultado.alteracoes ?? []);
    return { ...resultado, itens: normalizados };
  }

  async function criarPedidoDelivery(dados) {
    const validacao = await validarCarrinhoApi(itensCarrinhoParaApi(carrinho));
    const itensAtuais = normalizarProdutos(validacao.itens);
    setCarrinho(itensAtuais);
    setAvisosCarrinho(validacao.alteracoes ?? []);
    if (validacao.alteracoes?.length) {
      throw new ErroApi('Seu carrinho foi atualizado. Revise as alterações antes de finalizar o pedido.', 409);
    }
    const itens = itensAtuais.map((item) => ({
      produtoId: item.produtoId ?? item.id,
      promocaoId: item.promocaoId ?? null,
      quantidade: item.quantidade,
      adicionais: (item.adicionais ?? []).map((adicional) => adicional.id),
      observacao: item.observacao || undefined
    }));
    const { pedido } = await criarPedidoDeliveryApi(dados, itens);
    pedidoAtualValidado.current = true;
    setPedidoAtual(pedido);
    setPedidoAtualCarregando(false);
    setCarrinho([]);
    setAvisosCarrinho([]);
    return pedido;
  }

  async function abrirComanda(mesaId) {
    const { comanda } = await abrirComandaApi(mesaId);
    await recarregarGarcom();
    return comanda;
  }

  async function criarMesaAdmin(numero) {
    await criarMesaAdminApi(numero);
    await recarregarAdmin();
  }

  async function abrirComandaAdmin(mesaId, funcionarioId) {
    const { comanda } = await abrirComandaAdminApi(mesaId, funcionarioId);
    await recarregarAdmin();
    return comanda;
  }

  async function adicionarItemComandaAdmin(comandaId, produtoId) {
    await adicionarItemComandaAdminApi(comandaId, {
      produtoId,
      quantidade: 1,
      adicionais: []
    });
    await recarregarAdmin();
  }

  async function atualizarItemComandaAdmin(comandaId, itemId, quantidade) {
    await atualizarItemComandaAdminApi(comandaId, itemId, quantidade);
    await recarregarAdmin();
  }

  async function removerItemComandaAdmin(comandaId, itemId) {
    await removerItemComandaAdminApi(comandaId, itemId);
    await recarregarAdmin();
  }

  async function finalizarComandaAdmin(comandaId, pagamento) {
    await finalizarComandaAdminApi(comandaId, pagamento);
    await recarregarAdmin();
  }

  async function adicionarItemComanda(comandaId, produto, quantidade, extras, observacao) {
    await adicionarItemComandaApi(comandaId, {
      produtoId: produto.id,
      quantidade,
      adicionais: extras.map((extra) => extra.id),
      observacao
    });
    await recarregarGarcom();
  }

  async function removerItemComanda(comandaId, linhaId) {
    await removerItemComandaApi(comandaId, linhaId);
    await recarregarGarcom();
  }

  async function enviarComanda(comandaId) {
    await enviarComandaApi(comandaId);
    await recarregarGarcom();
    return true;
  }

  async function solicitarConta(comandaId) {
    await solicitarContaApi(comandaId);
    await recarregarGarcom();
  }

  async function fecharComanda(comandaId, pagamento) {
    await fecharComandaApi(comandaId, pagamento);
    await recarregarGarcom();
  }

  async function setConfiguracao(dados) {
    const { configuracao: salva } = await salvarConfiguracaoApi(dados);
    const normalizada = normalizarConfiguracaoPublica(salva);
    setConfiguracaoEstado(normalizada);
    return normalizada;
  }

  const valor = {
    categorias,
    produtos,
    adicionais,
    promocoes,
    funcionarios,
    mesas,
    pedidos,
    comandas,
    administradores,
    auditoria,
    configuracao,
    carrinho,
    pedidoAtual,
    pedidoAtualCarregando,
    adminSessao,
    garcomSessao,
    catalogoCarregando,
    sessaoAdminCarregando,
    sessaoGarcomCarregando,
    erroApi,
    avisosCarrinho,
    alertaNovoPedido,
    pedidosNovos,
    setCarrinho,
    setConfiguracao,
    entrarAdmin,
    sairAdmin,
    entrarGarcom,
    sairGarcom,
    salvarProduto,
    salvarCategoria,
    alternarCategoria,
    removerProduto,
    alternarProduto,
    salvarAdicional,
    removerAdicional,
    alternarAdicional,
    salvarPromocao,
    removerPromocao,
    salvarFuncionario,
    alternarFuncionario,
    atualizarStatusPedido,
    confirmarPagamentoPedido,
    estornarPagamentoPedido,
    criarPedidoDelivery,
    revalidarCarrinho,
    criarAdministrador,
    alternarAdministrador,
    alterarSenhaAdministrador,
    dispensarAlertaNovoPedido: () => setAlertaNovoPedido(null),
    criarMesaAdmin,
    abrirComanda,
    abrirComandaAdmin,
    adicionarItemComanda,
    removerItemComanda,
    enviarComanda,
    solicitarConta,
    fecharComanda,
    adicionarItemComandaAdmin,
    atualizarItemComandaAdmin,
    removerItemComandaAdmin,
    finalizarComandaAdmin,
    recarregarCatalogo,
    recarregarAdmin,
    recarregarGarcom,
    numeroPreco
  };

  if (catalogoCarregando) {
    return (
      <div className="carregamentoAplicacao" role="status">
        <span />
        <strong>Conectando ao cardápio...</strong>
      </div>
    );
  }

  return <AppContext.Provider value={valor}>{children}</AppContext.Provider>;
}
