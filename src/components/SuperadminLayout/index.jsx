import { Building2, LogOut, Menu, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import { useSuperadmin } from '../../context/superadminContext';
import styles from './index.module.css';

function SuperadminLayout({ titulo, subtitulo, acao, children }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [layoutCompacto, setLayoutCompacto] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const botaoMenuRef = useRef(null);
  const fecharMenuRef = useRef(null);
  const { sessao, sair } = useSuperadmin();
  const navigate = useNavigate();

  async function encerrarSessao() {
    await sair();
    navigate('/superadmin/login');
  }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const atualizar = (evento) => setLayoutCompacto(evento.matches);
    media.addEventListener('change', atualizar);
    return () => media.removeEventListener('change', atualizar);
  }, []);

  useEffect(() => {
    if (!menuAberto) return undefined;
    const overflowAnterior = document.body.style.overflow;
    const botaoMenu = botaoMenuRef.current;
    const animacao = window.requestAnimationFrame(() => fecharMenuRef.current?.focus());
    document.body.style.overflow = 'hidden';
    const fecharComEscape = (evento) => {
      if (evento.key === 'Escape') setMenuAberto(false);
    };
    document.addEventListener('keydown', fecharComEscape);
    return () => {
      window.cancelAnimationFrame(animacao);
      document.removeEventListener('keydown', fecharComEscape);
      document.body.style.overflow = overflowAnterior;
      botaoMenu?.focus();
    };
  }, [menuAberto]);

  return (
    <div className={styles.pagina}>
      <button
        type="button"
        className={styles.botaoMenu}
        aria-label="Abrir menu"
        aria-expanded={menuAberto}
        aria-controls="navegacao-superadmin"
        ref={botaoMenuRef}
        onClick={() => setMenuAberto(true)}
      >
        <Menu size={22} />
      </button>

      {menuAberto && <button type="button" className={styles.overlay} aria-label="Fechar menu" onClick={() => setMenuAberto(false)} />}

      <aside
        id="navegacao-superadmin"
        aria-label="Navegação global"
        aria-hidden={layoutCompacto && !menuAberto}
        inert={layoutCompacto && !menuAberto ? true : undefined}
        className={`${styles.sidebar} ${menuAberto ? styles.sidebarAberta : ''}`}
      >
        <div className={styles.logoArea}>
          <span className={styles.marcaIcone}><ShieldCheck size={25} /></span>
          <div><strong>Central</strong><span>SUPERADMIN</span></div>
          <button type="button" className={styles.fecharMenu} ref={fecharMenuRef} aria-label="Fechar menu" onClick={() => setMenuAberto(false)}>
            <X size={22} />
          </button>
        </div>

        <nav className={styles.navegacao} aria-label="Seções do painel global">
          <NavLink
            to="/superadmin/estabelecimentos"
            onClick={() => setMenuAberto(false)}
            className={({ isActive }) => `${styles.linkMenu} ${isActive ? styles.linkAtivo : ''}`}
          >
            <Building2 size={20} />
            <span>Estabelecimentos</span>
          </NavLink>
        </nav>

        <div className={styles.escopo}>
          <ShieldCheck size={17} />
          <span>Escopo global protegido</span>
        </div>
        <button type="button" className={styles.sair} onClick={encerrarSessao}>
          <LogOut size={20} /> Sair
        </button>
      </aside>

      <main className={styles.principal}>
        <header className={styles.cabecalho}>
          <div><h1>{titulo}</h1><p>{subtitulo}</p></div>
          <div className={styles.cabecalhoDireita}>
            {acao}
            <div className={styles.perfil}>
              <span>{sessao?.nome?.charAt(0) ?? 'S'}</span>
              <div><strong>{sessao?.nome ?? 'Superadmin'}</strong><small>{sessao?.perfil ?? 'Superadministrador'}</small></div>
            </div>
          </div>
        </header>
        <div className={styles.conteudo}>{children}</div>
      </main>
    </div>
  );
}

export default SuperadminLayout;
