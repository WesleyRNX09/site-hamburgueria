import { useEffect, useRef, useState } from 'react';
import {
  BadgePercent,
  BarChart3,
  BellRing,
  ClipboardList,
  LayoutDashboard,
  Layers3,
  LogOut,
  ListPlus,
  Menu,
  Package,
  Settings,
  ShieldCheck,
  Users,
  UtensilsCrossed,
  X
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';

import { useApp } from '../../context/appContext';
import LogoEstabelecimento from '../LogoEstabelecimento';
import styles from './index.module.css';

const itensMenu = [
  { nome: 'Dashboard', rota: '/admin/dashboard', icone: LayoutDashboard },
  { nome: 'Pedidos', rota: '/admin/pedidos', icone: ClipboardList },
  { nome: 'Cardápio', rota: '/admin/cardapio', icone: Package },
  { nome: 'Categorias', rota: '/admin/categorias', icone: Layers3 },
  { nome: 'Adicionais', rota: '/admin/adicionais', icone: ListPlus },
  { nome: 'Promoções', rota: '/admin/promocoes', icone: BadgePercent },
  { nome: 'Mesas / Comandas', rota: '/admin/mesas', icone: UtensilsCrossed },
  { nome: 'Funcionários', rota: '/admin/funcionarios', icone: Users },
  { nome: 'Acessos', rota: '/admin/acessos', icone: ShieldCheck },
  { nome: 'Relatórios', rota: '/admin/relatorios', icone: BarChart3 },
  { nome: 'Configurações', rota: '/admin/configuracoes', icone: Settings }
];

function AdminLayout({ titulo, subtitulo, acao, children }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [layoutCompacto, setLayoutCompacto] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const botaoMenuRef = useRef(null);
  const fecharMenuRef = useRef(null);
  const { adminSessao, sairAdmin, configuracao, alertaNovoPedido, dispensarAlertaNovoPedido } = useApp();
  const navigate = useNavigate();

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

      {menuAberto && (
        <button
          type="button"
          className={styles.overlay}
          aria-label="Fechar menu"
          onClick={() => setMenuAberto(false)}
        />
      )}

      <aside
        id="navegacao-administrativa"
        aria-label="Navegação administrativa"
        aria-hidden={layoutCompacto && !menuAberto}
        inert={layoutCompacto && !menuAberto ? true : undefined}
        className={`${styles.sidebar} ${menuAberto ? styles.sidebarAberta : ''}`}
      >
        <div className={styles.logoArea}>
          <div className={styles.marcaIcone}>
            <LogoEstabelecimento configuracao={configuracao} alternativa={<UtensilsCrossed size={24} />} />
          </div>
          <div>
            <strong>{configuracao.nomeLoja || 'Administração'}</strong>
            <span>ADMIN</span>
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
                onClick={() => setMenuAberto(false)}
                className={({ isActive }) => `${styles.linkMenu} ${isActive ? styles.linkAtivo : ''}`}
              >
                <Icone size={20} />
                <span>{item.nome}</span>
              </NavLink>
            );
          })}
        </nav>

        <button type="button" className={styles.sair} onClick={sair}>
          <LogOut size={20} />
          Sair
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
          <div>
            <h1>{titulo}</h1>
            <p>{subtitulo}</p>
          </div>

          <div className={styles.cabecalhoDireita}>
            {acao}
            <div className={styles.perfil}>
              <span>{adminSessao?.nome?.charAt(0) ?? 'A'}</span>
              <div>
                <strong>{adminSessao?.nome ?? 'Admin'}</strong>
                <small>{adminSessao?.perfil ?? 'Administrador'}</small>
              </div>
            </div>
          </div>
        </header>

        <div className={styles.conteudo}>{children}</div>
      </main>
    </div>
  );
}

export default AdminLayout;
