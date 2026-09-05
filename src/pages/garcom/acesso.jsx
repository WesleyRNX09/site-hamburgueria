import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useApp } from '../../context/appContext';
import LogoEstabelecimento from '../../components/LogoEstabelecimento';
import { consultarPrimeiroAcessoGarcom } from '../../services/api';
import styles from './garcom.module.css';

/*
  Duas entradas na mesma tela:

  - `/garcom/acesso` é o dia a dia: usuário e senha, sem depender do QR Code
    para começar o turno;
  - `/garcom/acesso/:token` é o primeiro acesso, aberto pelo QR que o gerente
    entrega no cadastro. Ali o garçom escolhe a própria senha e já entra —
    o link não vale mais depois disso.
*/
function AcessoGarcom() {
  const { token } = useParams();
  const { entrarGarcom, definirSenhaGarcom, configuracao, sessaoExpirada } = useApp();
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);
  const [cadastro, setCadastro] = useState(null);
  const [validandoQr, setValidandoQr] = useState(Boolean(token));

  useEffect(() => {
    if (!token) return undefined;
    let ativo = true;
    consultarPrimeiroAcessoGarcom(token)
      .then(({ funcionario }) => {
        if (ativo) setCadastro(funcionario);
      })
      .catch((falha) => {
        if (ativo) setErro(falha.message);
      })
      .finally(() => {
        if (ativo) setValidandoQr(false);
      });
    return () => { ativo = false; };
  }, [token]);

  async function entrar(event) {
    event.preventDefault();
    if (processando) return;
    setErro('');
    setProcessando(true);
    try {
      if (!await entrarGarcom(usuario, senha)) {
        setErro('Não foi possível autenticar com os dados informados.');
        return;
      }
      navigate('/garcom/mesas');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  async function criarSenha(event) {
    event.preventDefault();
    if (processando) return;
    setErro('');
    if (!/^\d{6,12}$/.test(senha)) {
      setErro('A senha deve ter de 6 a 12 dígitos numéricos.');
      return;
    }
    if (senha !== confirmacao) {
      setErro('A confirmação não confere com a senha digitada.');
      return;
    }
    setProcessando(true);
    try {
      await definirSenhaGarcom(token, senha);
      navigate('/garcom/mesas');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  const primeiroAcesso = Boolean(token);

  return (
    <main className={styles.acessoPagina}>
      <section className={styles.acessoCard}>
        <div className={styles.marcaAcesso}>
          <LogoEstabelecimento configuracao={configuracao} alternativa={configuracao.nomeLoja || 'Atendimento'} />
        </div>
        <div className={styles.iconeAcesso}>{primeiroAcesso ? <KeyRound size={30} /> : <ShieldCheck size={30} />}</div>
        <h1>{primeiroAcesso ? 'Primeiro acesso' : 'Acesso do garçom'}</h1>
        <p>
          {primeiroAcesso
            ? 'Crie a sua senha para entrar no atendimento. Nos próximos turnos você entra direto com usuário e senha, sem o QR Code.'
            : 'Digite seu usuário e sua senha para entrar no atendimento.'}
        </p>

        {/* Fica fora do formulário: o motivo do retorno precisa aparecer
            mesmo enquanto o QR Code ainda está sendo validado. */}
        {!erro && sessaoExpirada && <div className={styles.erro} role="alert">{sessaoExpirada}</div>}

        {primeiroAcesso && validandoQr && (
          <div className={styles.identificado} role="status"><span>…</span><div><strong>Validando o QR Code</strong><small>Só um instante.</small></div></div>
        )}

        {primeiroAcesso && !validandoQr && !cadastro && (
          <>
            {erro && <div className={styles.erro} role="alert">{erro}</div>}
            <div className={styles.linksDemo}>
              <Link className={styles.linkDemo} to="/garcom/acesso">
                <div><strong>Entrar com usuário e senha</strong><small>Se você já criou a sua senha</small></div>
                <ArrowRight size={17} />
              </Link>
            </div>
          </>
        )}

        {primeiroAcesso && cadastro && (
          <form className={styles.formAcesso} onSubmit={criarSenha}>
            <div className={styles.identificado}>
              <span>{cadastro.nome.trim().charAt(0).toUpperCase()}</span>
              <div><strong>{cadastro.nome}</strong><small>{cadastro.cargo} • usuário <strong>{cadastro.usuario}</strong></small></div>
            </div>
            <div className={styles.campo}>
              <label htmlFor="novaSenha">Crie sua senha</label>
              <input
                id="novaSenha"
                type="password"
                inputMode="numeric"
                maxLength="12"
                autoFocus
                autoComplete="new-password"
                value={senha}
                onChange={(event) => setSenha(event.target.value.replace(/\D/g, ''))}
                placeholder="6 a 12 dígitos"
              />
            </div>
            <div className={styles.campo}>
              <label htmlFor="confirmarSenha">Repita a senha</label>
              <input
                id="confirmarSenha"
                type="password"
                inputMode="numeric"
                maxLength="12"
                autoComplete="new-password"
                value={confirmacao}
                onChange={(event) => setConfirmacao(event.target.value.replace(/\D/g, ''))}
                placeholder="Digite novamente"
              />
            </div>
            {erro && <div className={styles.erro} role="alert">{erro}</div>}
            <button type="submit" className={styles.botaoPrincipal} disabled={processando}>
              {processando ? 'Salvando…' : 'Salvar senha e entrar'} <ArrowRight size={17} />
            </button>
          </form>
        )}

        {!primeiroAcesso && (
          <form className={styles.formAcesso} onSubmit={entrar}>
            <div className={styles.campo}>
              <label htmlFor="usuarioGarcom">Usuário</label>
              <input
                id="usuarioGarcom"
                autoFocus
                autoComplete="username"
                value={usuario}
                onChange={(event) => setUsuario(event.target.value)}
                placeholder="Seu usuário de acesso"
              />
            </div>
            <div className={styles.campo}>
              <label htmlFor="senhaGarcom">Senha</label>
              <input
                id="senhaGarcom"
                type="password"
                inputMode="numeric"
                maxLength="12"
                autoComplete="current-password"
                value={senha}
                onChange={(event) => setSenha(event.target.value.replace(/\D/g, ''))}
                placeholder="Digite sua senha"
              />
            </div>
            {erro && <div className={styles.erro} role="alert">{erro}</div>}
            <button type="submit" className={styles.botaoPrincipal} disabled={processando}>
              {processando ? 'Entrando…' : 'Entrar no atendimento'} <ArrowRight size={17} />
            </button>
            <p className={styles.ajudaAcesso}>
              Esqueceu a senha? Peça ao gerente um novo QR Code de acesso.
            </p>
          </form>
        )}
      </section>
    </main>
  );
}

export default AcessoGarcom;
