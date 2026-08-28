import { Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
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

  return (
    <main className={styles.pagina}>
      <div className={styles.luz} aria-hidden="true" />
      <section className={styles.container} aria-labelledby="titulo-superadmin">
        <div className={styles.marca}>
          <span><ShieldCheck size={26} /></span>
          <div><strong>Central de operações</strong><small>GESTÃO GLOBAL</small></div>
        </div>

        <div className={styles.introducao}>
          <span className={styles.rotulo}>ACESSO RESTRITO</span>
          <h1 id="titulo-superadmin">Controle seus <em>estabelecimentos</em></h1>
          <p>Gerencie tenants, planos, assinaturas e identidades visuais em um único ambiente protegido.</p>
        </div>

        <form className={styles.card} onSubmit={fazerLogin}>
          <div className={styles.cardCabecalho}>
            <div><h2>Entrar no painel global</h2><p>Use as credenciais exclusivas de superadministrador.</p></div>
            <LockKeyhole size={22} />
          </div>

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

          {erro && <div className={styles.erro} role="alert">{erro}</div>}
          <button className={styles.entrar} type="submit" disabled={processando || sessaoCarregando}>
            {processando || sessaoCarregando ? 'Validando acesso...' : 'Entrar com segurança'}
          </button>
          <p className={styles.aviso}><ShieldCheck size={15} /> Sessão global revogável e separada dos administradores de cada loja.</p>
        </form>
      </section>
    </main>
  );
}

export default LoginSuperadmin;
