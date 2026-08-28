import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useApp } from '../context/appContext';
import { useSuperadmin } from '../context/superadminContext';

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
