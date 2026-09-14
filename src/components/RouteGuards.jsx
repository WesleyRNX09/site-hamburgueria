import { ShieldAlert } from 'lucide-react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useApp } from '../context/appContext';
import { useSuperadmin } from '../context/superadminContext';
import styles from '../pages/admin/shared.module.css';
import AdminLayout from './AdminLayout';
import { itensMenuAdmin } from './AdminLayout/menu';
import estilos from './RouteGuards.module.css';

export function RequireSuperadmin() {
  const { sessao, sessaoCarregando } = useSuperadmin();
  const location = useLocation();

  if (sessaoCarregando) {
    return (
      <div className="carregamentoAplicacao" role="status">
        <span />
        <strong>Validando acesso global...</strong>
      </div>
    );
  }

  if (!sessao) {
    return <Navigate to="/superadmin/login" replace state={{ origem: location.pathname }} />;
  }

  return <Outlet />;
}

export function RequireAdmin() {
  const { adminSessao, sessaoAdminCarregando } = useApp();
  const location = useLocation();

  if (sessaoAdminCarregando) {
    return (
      <div className="carregamentoAplicacao" role="status">
        <span />
        <strong>Validando acesso administrativo...</strong>
      </div>
    );
  }

  if (!adminSessao) {
    return <Navigate to="/admin/login" replace state={{ origem: location.pathname }} />;
  }

  return <Outlet />;
}

/*
  Tela do painel sem permissão: mantém o layout e a sessão, explica o motivo e
  oferece a primeira tela que a conta pode abrir. Esconder a rota é só
  conveniência; o servidor recusa as ações de qualquer forma.
*/
function AcessoRestrito() {
  const { temPermissao } = useApp();
  const navigate = useNavigate();
  const destino = itensMenuAdmin.find((item) => !item.permissoes || temPermissao(...item.permissoes));

  return (
    <AdminLayout titulo="Acesso restrito" subtitulo="Esta área não faz parte das permissões da sua conta.">
      <section className={styles.card}>
        <div className={styles.vazio} role="alert">
          <ShieldAlert size={32} />
          <h3>Você não tem permissão para acessar esta tela</h3>
          <p>Peça a um administrador com permissão de gerenciar funcionários para liberar o acesso.</p>
          {destino && (
            <button type="button" className={`${styles.botaoPrimario} ${estilos.acaoAcessoRestrito}`} onClick={() => navigate(destino.rota)}>
              Ir para {destino.nome}
            </button>
          )}
        </div>
      </section>
    </AdminLayout>
  );
}

export function RequirePermissao({ algumaDe }) {
  const { temPermissao } = useApp();
  return temPermissao(...algumaDe) ? <Outlet /> : <AcessoRestrito />;
}

export function RequireGarcom() {
  const { garcomSessao, sessaoGarcomCarregando } = useApp();

  if (sessaoGarcomCarregando) {
    return (
      <div className="carregamentoAplicacao" role="status">
        <span />
        <strong>Validando acesso do atendimento...</strong>
      </div>
    );
  }

  if (!garcomSessao) {
    return <Navigate to="/garcom/acesso" replace />;
  }

  return <Outlet />;
}
