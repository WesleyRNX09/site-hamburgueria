import { useEffect, useRef, useState } from 'react';
import {
  BellRing,
  LogOut,
  Menu,
  X
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';

import { useApp } from '../../context/appContext';
import LogoEstabelecimento from '../LogoEstabelecimento';
import styles from './index.module.css';
import { itensMenuAdmin } from './menu';

function inicial(texto, alternativa) {
  return texto?.trim().charAt(0).toUpperCase() || alternativa;
}

function AdminLayout({ titulo, subtitulo, acao, children }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [layoutCompacto, setLayoutCompacto] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const botaoMenuRef = useRef(null);
  const fecharMenuRef = useRef(null);
  const { adminSessao, sairAdmin, configuracao, alertaNovoPedido, dispensarAlertaNovoPedido, temPermissao } = useApp();
  // O menu mostra só as telas que as permissões recebidas do servidor abrem.
  const itensMenu = itensMenuAdmin.filter((item) => !item.permissoes || temPermissao(...item.permissoes));
  const navigate = useNavigate();
  // Sem o dado de funcionamento, o selo fica de fora em vez de chutar.
  const situacaoLoja = typeof configuracao.lojaAberta === 'boolean' ? configuracao.lojaAberta : null;

  async function sair() {
    await sairAdmin();
    navigate('/admin/login');
  }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const atualizarLayout = (evento) => setLayoutCompacto(evento.matches);
    media.addEventListener('change', atualizarLayout);
    return () => media.removeEventListener('change', atualizarLayout);
  }, []);

  useEffect(() => {
    if (!menuAberto) return undefined;

    const overflowAnterior = document.body.style.overflow;
    const botaoMenu = botaoMenuRef.current;
    const animacao = window.requestAnimationFrame(() => fecharMenuRef.current?.focus());
    document.body.style.overflow = 'hidden';

    function fecharComEscape(evento) {
      if (evento.key === 'Escape') setMenuAberto(false);
    }

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
      {menuAberto && (
        <button
          type="button"
          className={styles.overlay}
          aria-label="Fechar menu"
          onClick={() => setMenuAberto(false)}
        />
      )}

      {/* Faixa só de ícones: o nome de cada tela fica no aria-label e na dica
          que aparece no hover e no foco. No celular a faixa vira gaveta e os
          nomes aparecem ao lado dos ícones. */}
      <aside
        id="navegacao-administrativa"
        aria-label="Navegação administrativa"
        aria-hidden={layoutCompacto && !menuAberto}
        inert={layoutCompacto && !menuAberto ? true : undefined}
        className={`${styles.sidebar} ${menuAberto ? styles.sidebarAberta : ''}`}
      >
        <div className={styles.topoFaixa}>
          <div className={styles.marca} title={configuracao.nomeLoja || undefined}>
            <LogoEstabelecimento configuracao={configuracao} alternativa={<span aria-hidden="true">{inicial(configuracao.nomeLoja, 'A')}</span>} />
          </div>
          <button type="button" className={styles.fecharMenu} ref={fecharMenuRef} aria-label="Fechar menu" onClick={() => setMenuAberto(false)}>
            <X size={22} />
          </button>
        </div>

        <nav className={styles.navegacao} aria-label="Seções do painel">
          {itensMenu.map((item) => {
            const Icone = item.icone;
            return (
              <NavLink
                key={item.rota}
                to={item.rota}
                aria-label={item.nome}
                onClick={() => setMenuAberto(false)}
                className={({ isActive }) => `${styles.linkMenu} ${isActive ? styles.linkAtivo : ''}`}
              >
                <Icone size={22} strokeWidth={1.8} aria-hidden="true" />
                <span className={styles.rotulo} aria-hidden="true">{item.nome}</span>
              </NavLink>
            );
          })}
        </nav>

        <button type="button" className={`${styles.linkMenu} ${styles.sair}`} aria-label="Sair" onClick={sair}>
          <LogOut size={22} strokeWidth={1.8} aria-hidden="true" />
          <span className={styles.rotulo} aria-hidden="true">Sair</span>
        </button>
      </aside>

      <main id="conteudo-principal" className={styles.principal}>
        {alertaNovoPedido && (
          <div className={styles.alertaPedido} role="status" aria-live="assertive">
            <BellRing size={21} />
            <div><strong>{alertaNovoPedido.quantidade === 1 ? 'Novo pedido recebido' : `${alertaNovoPedido.quantidade} novos pedidos`}</strong><span>{alertaNovoPedido.pedido.id} • {alertaNovoPedido.pedido.origem} • {alertaNovoPedido.pedido.cliente}</span></div>
            <button type="button" aria-label="Dispensar alerta" onClick={dispensarAlertaNovoPedido}><X size={17} /></button>
          </div>
        )}
        <header className={styles.cabecalho}>
          <button
            type="button"
            className={styles.botaoMenu}
            aria-label="Abrir menu"
            aria-expanded={menuAberto}
            aria-controls="navegacao-administrativa"
            ref={botaoMenuRef}
            onClick={() => setMenuAberto(true)}
          >
            <Menu size={22} />
          </button>

          <h1>{titulo}</h1>

          <div className={styles.cabecalhoDireita}>
            {situacaoLoja !== null && (
              <span className={`${styles.seloLoja} ${situacaoLoja ? '' : styles.seloLojaFechada}`}>
                {situacaoLoja ? 'Aberta' : 'Fechada'}
              </span>
            )}
            <div className={styles.perfil}>
              <span aria-hidden="true">{inicial(adminSessao?.nome, 'A')}</span>
              <strong>{adminSessao?.nome ?? 'Admin'}</strong>
            </div>
          </div>
        </header>

        <div className={styles.conteudo}>
          {(subtitulo || acao) && (
            <div className={styles.barraPagina}>
              {subtitulo && <p>{subtitulo}</p>}
              {acao && <div className={styles.acoesPagina}>{acao}</div>}
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}

export default AdminLayout;
