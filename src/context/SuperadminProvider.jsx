import { useCallback, useEffect, useState } from 'react';

import {
  alterarSenhaSuperadmin,
  alterarStatusSuperadministrador,
  aoExpirarSessao,
  atualizarEstabelecimentoSuperadmin,
  criarEstabelecimentoSuperadmin,
  criarSuperadministrador,
  ErroApi,
  listarAdministradoresEstabelecimento,
  listarAuditoriaSuperadmin,
  listarEstabelecimentosSuperadmin,
  listarSuperadministradores,
  loginSuperadmin,
  logoutSuperadmin,
  redefinirSenhaAdministradorEstabelecimento,
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
  const [superadministradores, setSuperadministradores] = useState([]);
  const [dadosCarregando, setDadosCarregando] = useState(false);
  const [sessaoExpirada, setSessaoExpirada] = useState('');

  const limparSessao = useCallback(() => {
    sessionStorage.removeItem(CHAVE_SESSAO);
    setSessao(null);
    setSessaoCarregando(false);
    setEstabelecimentos([]);
    setSuperadministradores([]);
  }, []);

  /* Mesmo tratamento do painel do estabelecimento: 401 em chamada
     autenticada derruba a sessão e o guard leva ao login com o motivo. */
  useEffect(() => aoExpirarSessao((perfil) => {
    if (perfil !== 'superadmin') return;
    limparSessao();
    setSessaoExpirada('Sua sessão expirou. Entre novamente para continuar.');
  }), [limparSessao]);

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
      setSessaoExpirada('');
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
    setSessaoExpirada('');
    limparSessao();
  }

  /* A troca de senha derruba TODAS as sessões no servidor, inclusive esta.
     Por isso a sessão local cai junto e o guard leva de volta ao login. */
  async function alterarSenha(dados) {
    await alterarSenhaSuperadmin(dados);
    limparSessao();
    setSessaoExpirada('Senha alterada. Entre novamente com a nova senha.');
  }

  const carregarSuperadministradores = useCallback(async () => {
    setDadosCarregando(true);
    try {
      const resposta = await listarSuperadministradores();
      setSuperadministradores(resposta.superadministradores ?? []);
      return resposta.superadministradores ?? [];
    } catch (erro) {
      if (erro instanceof ErroApi && erro.status === 401) limparSessao();
      throw erro;
    } finally {
      setDadosCarregando(false);
    }
  }, [limparSessao]);

  async function criarContaGlobal(dados) {
    const { superadministrador } = await criarSuperadministrador(dados);
    setSuperadministradores((atuais) => [superadministrador, ...atuais]);
    return superadministrador;
  }

  async function alterarStatusContaGlobal(id, ativo) {
    const { superadministrador } = await alterarStatusSuperadministrador(id, ativo);
    setSuperadministradores((atuais) => atuais.map(
      (item) => item.id === superadministrador.id ? superadministrador : item
    ));
    return superadministrador;
  }

  const carregarAdministradoresDoEstabelecimento = useCallback(async (idEstabelecimento) => {
    const resposta = await listarAdministradoresEstabelecimento(idEstabelecimento);
    return resposta.administradores ?? [];
  }, []);

  /* O vínculo com o estabelecimento vai na própria URL: o backend recusa um
     administrador que não pertença a esse tenant. */
  async function redefinirSenhaAdministrador(idEstabelecimento, idAdministrador, dados) {
    const { administrador } = await redefinirSenhaAdministradorEstabelecimento(
      idEstabelecimento,
      idAdministrador,
      dados
    );
    return administrador;
  }

  const carregarAuditoria = useCallback(async (filtros = {}) => {
    try {
      return await listarAuditoriaSuperadmin(filtros);
    } catch (erro) {
      if (erro instanceof ErroApi && erro.status === 401) limparSessao();
      throw erro;
    }
  }, [limparSessao]);

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
      sessaoExpirada,
      estabelecimentos,
      superadministradores,
      opcoes,
      dadosCarregando,
      entrar,
      sair,
      alterarSenha,
      carregarEstabelecimentos,
      criarEstabelecimento,
      atualizarEstabelecimento,
      carregarAuditoria,
      carregarAdministradoresDoEstabelecimento,
      redefinirSenhaAdministrador,
      carregarSuperadministradores,
      criarContaGlobal,
      alterarStatusContaGlobal
    }}>
      {children}
    </SuperadminContext.Provider>
  );
}
