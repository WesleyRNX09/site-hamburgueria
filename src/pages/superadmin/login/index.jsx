import { AlertCircle, ArrowRight, Building2, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useSuperadmin } from '../../../context/superadminContext';
import styles from './index.module.css';

function LoginSuperadmin() {
  const { sessao, sessaoCarregando, entrar } = useSuperadmin();
  const navigate = useNavigate();
  const location = useLocation();
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');

  if (sessao && !sessaoCarregando) {
    return <Navigate to="/superadmin/estabelecimentos" replace />;
  }

  async function fazerLogin(evento) {
    evento.preventDefault();
    setErro('');
    if (!usuario.trim() || !senha) {
      setErro('Preencha o usuário ou e-mail e a senha.');
      return;
    }
    setProcessando(true);
    try {
      if (!await entrar(usuario, senha)) {
        setErro('Usuário ou senha incorretos.');
        return;
      }
      navigate(location.state?.origem ?? '/superadmin/estabelecimentos', { replace: true });
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  const carregando = processando || sessaoCarregando;

  return (
    <main className={styles.pagina}>
      <section className={styles.painelMarca} aria-hidden="true">
        <div className={styles.marcaFundo} />
        <div className={styles.marcaTopo}>
          <span className={styles.marcaSelo}><ShieldCheck size={24} /></span>
          <div><strong>Central</strong><small>SUPERADMIN</small></div>
        </div>

        <div className={styles.marcaCorpo}>
          <span className={styles.marcaRotulo}>GESTÃO GLOBAL</span>
          <h2>Toda a plataforma, <em>em um só lugar</em>.</h2>
          <p>Administre tenants, planos, assinaturas e identidades visuais de cada estabelecimento com uma sessão isolada e segura.</p>
          <ul className={styles.marcaLista}>
            <li><Building2 size={17} /><span>Gestão centralizada de estabelecimentos</span></li>
            <li><Sparkles size={17} /><span>Personalização white-label por tenant</span></li>
            <li><LockKeyhole size={17} /><span>Escopo global isolado dos painéis de loja</span></li>
          </ul>
        </div>

        <p className={styles.marcaRodape}>Plataforma multiempresa &middot; acesso restrito</p>
      </section>

      <section className={styles.painelFormulario}>
        <div className={styles.luz} aria-hidden="true" />
        <div className={styles.container}>
          <div className={styles.marcaMobile}>
            <span><ShieldCheck size={22} /></span>
            <div><strong>Central de operações</strong><small>GESTÃO GLOBAL</small></div>
          </div>

          <div className={styles.introducao}>
            <span className={styles.rotulo}>ACESSO RESTRITO</span>
            <h1 id="titulo-superadmin">Entrar no painel <em>global</em></h1>
            <p>Use as credenciais exclusivas de superadministrador para continuar.</p>
          </div>

          <form className={styles.card} onSubmit={fazerLogin} aria-labelledby="titulo-superadmin">
            <label className={styles.campo} htmlFor="superadmin-usuario">
              <span>Usuário ou e-mail</span>
              <input
                id="superadmin-usuario"
                value={usuario}
                onChange={(evento) => setUsuario(evento.target.value)}
                autoComplete="username"
                placeholder="superadmin"
              />
            </label>

            <label className={styles.campo} htmlFor="superadmin-senha">
              <span>Senha</span>
              <div className={styles.senha}>
                <input
                  id="superadmin-senha"
                  type={mostrarSenha ? 'text' : 'password'}
                  value={senha}
                  onChange={(evento) => setSenha(evento.target.value)}
                  autoComplete="current-password"
                  placeholder="Sua senha segura"
                />
                <button type="button" aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setMostrarSenha((atual) => !atual)}>
                  {mostrarSenha ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {erro && (
              <div className={styles.erro} role="alert">
                <AlertCircle size={16} />
                <span>{erro}</span>
              </div>
            )}

            <button className={styles.entrar} type="submit" disabled={carregando}>
              {carregando
                ? <><Loader2 size={17} className={styles.spinner} /> Validando acesso...</>
                : <>Entrar com segurança <ArrowRight size={17} /></>}
            </button>

            <p className={styles.aviso}><ShieldCheck size={15} /> Sessão global revogável e separada dos administradores de cada loja.</p>
          </form>
        </div>
      </section>
    </main>
  );
}

export default LoginSuperadmin;
