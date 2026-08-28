import { useCallback, useEffect, useState } from 'react';

import {
  atualizarEstabelecimentoSuperadmin,
  criarEstabelecimentoSuperadmin,
  ErroApi,
  listarEstabelecimentosSuperadmin,
  loginSuperadmin,
  logoutSuperadmin,
  validarSessaoSuperadmin
} from '../services/api';
import { SuperadminContext } from './superadminContext';

const CHAVE_SESSAO = 'hamburgueria_superadmin_sessao';

function lerSessao() {
  try {
    const sessao = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO));
    return sessao?.token ? sessao : null;
  } catch {
    return null;
  }
}

export function SuperadminProvider({ children }) {
  const [sessao, setSessao] = useState(lerSessao);
  const [sessaoCarregando, setSessaoCarregando] = useState(() => Boolean(lerSessao()));
  const [estabelecimentos, setEstabelecimentos] = useState([]);
  const [opcoes, setOpcoes] = useState({
    planos: ['basico', 'profissional', 'premium'],
    statusEstabelecimento: ['ativo', 'inativo'],
    statusAssinatura: ['ativa', 'inadimplente', 'suspensa', 'bloqueada', 'cancelada'],
    fontes: ['Poppins', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia']
  });
  const [dadosCarregando, setDadosCarregando] = useState(false);

  const limparSessao = useCallback(() => {
    sessionStorage.removeItem(CHAVE_SESSAO);
    setSessao(null);
    setSessaoCarregando(false);
    setEstabelecimentos([]);
  }, []);

  const carregarEstabelecimentos = useCallback(async (filtros = {}) => {
    setDadosCarregando(true);
    try {
      const resposta = await listarEstabelecimentosSuperadmin(filtros);
      setEstabelecimentos(resposta.estabelecimentos ?? []);
      if (resposta.opcoes) setOpcoes(resposta.opcoes);
      return resposta.estabelecimentos ?? [];
    } catch (erro) {
      if (erro instanceof ErroApi && erro.status === 401) limparSessao();
      throw erro;
    } finally {
      setDadosCarregando(false);
    }
  }, [limparSessao]);

  useEffect(() => {
    if (!sessao?.token) return undefined;
    let ativo = true;
    const token = sessao.token;
    Promise.all([validarSessaoSuperadmin(), listarEstabelecimentosSuperadmin()])
      .then(([{ superadmin }, resposta]) => {
        if (!ativo) return;
        const validada = { ...superadmin, token };
        sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(validada));
        setSessao(validada);
        setEstabelecimentos(resposta.estabelecimentos ?? []);
        if (resposta.opcoes) setOpcoes(resposta.opcoes);
      })
      .catch(() => {
        if (ativo) limparSessao();
      })
      .finally(() => {
        if (ativo) setSessaoCarregando(false);
      });
    return () => { ativo = false; };
  }, [sessao?.token, limparSessao]);

  async function entrar(usuario, senha) {
    try {
      const { superadmin, token } = await loginSuperadmin(usuario, senha);
      const novaSessao = { ...superadmin, token };
      sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(novaSessao));
      setSessaoCarregando(true);
      setSessao(novaSessao);
      return true;
    } catch (erro) {
      if (erro instanceof ErroApi && erro.status === 401) return false;
      throw erro;
    }
  }

  async function sair() {
    await logoutSuperadmin().catch(() => {});
    limparSessao();
  }

  async function criarEstabelecimento(dados) {
    const { estabelecimento } = await criarEstabelecimentoSuperadmin(dados);
    setEstabelecimentos((atuais) => [estabelecimento, ...atuais]);
    return estabelecimento;
  }

  async function atualizarEstabelecimento(id, dados) {
    const { estabelecimento } = await atualizarEstabelecimentoSuperadmin(id, dados);
    setEstabelecimentos((atuais) => atuais.map((item) => item.id === estabelecimento.id ? estabelecimento : item));
    return estabelecimento;
  }

  return (
    <SuperadminContext.Provider value={{
      sessao,
      sessaoCarregando,
      estabelecimentos,
      opcoes,
      dadosCarregando,
      entrar,
      sair,
      carregarEstabelecimentos,
      criarEstabelecimento,
      atualizarEstabelecimento
    }}>
      {children}
    </SuperadminContext.Provider>
  );
}
