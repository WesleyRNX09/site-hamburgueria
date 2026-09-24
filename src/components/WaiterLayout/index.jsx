import { LogOut, ReceiptText, Store, Utensils } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';

import { useApp } from '../../context/appContext';
import LogoEstabelecimento from '../LogoEstabelecimento';
import styles from './index.module.css';

function WaiterLayout({ titulo, subtitulo, children }) {
  const { garcomSessao, sairGarcom, configuracao } = useApp();
  const navigate = useNavigate();

  async function sair() {
    await sairGarcom();
    navigate('/garcom/acesso');
  }

  return (
    <div className={styles.pagina}>
      <header className={styles.header}>
        <button type="button" className={styles.logo} onClick={() => navigate('/garcom/mesas')}>
          <span><LogoEstabelecimento configuracao={configuracao} alternativa={<Utensils size={22} strokeWidth={1.8} aria-hidden="true" />} /></span>
          <div><strong>{configuracao.nomeLoja || 'Atendimento'}</strong><small>GARÇOM</small></div>
        </button>
        <nav className={styles.navegacao} aria-label="Navegação do atendimento">
          <NavLink to="/garcom/mesas" className={({ isActive }) => (isActive ? styles.linkAtivo : '')}><Store size={17} aria-hidden="true" /> Mesas</NavLink>
          {/* Ainda não há tela de comandas para o garçom: o item só sinaliza a
              seção, sem virar link. */}
          <span aria-disabled="true"><ReceiptText size={17} aria-hidden="true" /> Comandas</span>
        </nav>
        <div className={styles.perfil}>
          <span aria-hidden="true">{garcomSessao?.nome?.charAt(0)}</span>
          <div><strong>{garcomSessao?.nome}</strong><small>{garcomSessao?.cargo}</small></div>
          <button type="button" aria-label="Sair" onClick={sair}><LogOut size={19} /></button>
        </div>
      </header>
      <main id="conteudo-principal" className={styles.main}>
        <div className={styles.titulo}><h1>{titulo}</h1><p>{subtitulo}</p></div>
        {children}
      </main>
    </div>
  );
}

export default WaiterLayout;
