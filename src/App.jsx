import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { PERMISSOES_TELAS_ADMIN } from './components/AdminLayout/menu';
import { RequireAdmin, RequireGarcom, RequirePermissao, RequireSuperadmin } from './components/RouteGuards';
import { SuperadminProvider } from './context/SuperadminProvider';
import Home from './pages/home';
import FinalizarPedidos from './pages/telas/finalizarPedido';
import PedidoFinalizado from './pages/telas/pedidoFinalizado';
import LoginAdmin from './pages/admin/login';
import AdminDashboard from './pages/admin/dashboard/AdminDashboard';
import AdminPedidos from './pages/admin/pedidos/AdminPedidos';
import DetalhesPedido from './pages/admin/pedidos/detalhes';
import CardapioAdmin from './pages/admin/cardapio';
import CategoriasAdmin from './pages/admin/categorias';
import FormularioProduto from './pages/admin/cardapio/formulario';
import AdicionaisAdmin from './pages/admin/adicionais';
import PromocoesAdmin from './pages/admin/promocoes';
import FuncionariosAdmin from './pages/admin/funcionarios';
import MesasAdmin from './pages/admin/mesas';
import RelatoriosAdmin from './pages/admin/relatorios';
import ConfiguracoesAdmin from './pages/admin/configuracoes';
import AreasEntregaAdmin from './pages/admin/areasEntrega';
import AcessosAdmin from './pages/admin/acessos';
import AcessoGarcom from './pages/garcom/acesso';
import MesasGarcom from './pages/garcom/mesas';
import ComandaGarcom from './pages/garcom/comanda';
import PoliticaPrivacidade from './pages/legal/privacidade';
import TermosUso from './pages/legal/termos';
import LoginSuperadmin from './pages/superadmin/login';
import EstabelecimentosSuperadmin from './pages/superadmin/estabelecimentos';
import SenhaSuperadmin from './pages/superadmin/senha';
import SuperadministradoresSuperadmin from './pages/superadmin/superadministradores';
import AuditoriaSuperadmin from './pages/superadmin/auditoria';

function AreaSuperadmin() {
  return (
    <SuperadminProvider>
      <Outlet />
    </SuperadminProvider>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/finalizar-pedido" element={<FinalizarPedidos />} />
      <Route path="/pedido-finalizado" element={<PedidoFinalizado />} />
      <Route path="/pedidoFinalizado" element={<Navigate to="/pedido-finalizado" replace />} />
      <Route path="/politica-de-privacidade" element={<PoliticaPrivacidade />} />
      <Route path="/termos-de-uso" element={<TermosUso />} />

      <Route element={<AreaSuperadmin />}>
        <Route path="/superadmin/login" element={<LoginSuperadmin />} />
        <Route element={<RequireSuperadmin />}>
          <Route path="/superadmin" element={<Navigate to="/superadmin/estabelecimentos" replace />} />
          <Route path="/superadmin/estabelecimentos" element={<EstabelecimentosSuperadmin />} />
          <Route path="/superadmin/superadministradores" element={<SuperadministradoresSuperadmin />} />
          <Route path="/superadmin/auditoria" element={<AuditoriaSuperadmin />} />
          <Route path="/superadmin/senha" element={<SenhaSuperadmin />} />
        </Route>
      </Route>

      <Route path="/admin/login" element={<LoginAdmin />} />
      <Route element={<RequireAdmin />}>
        <Route element={<RequirePermissao algumaDe={PERMISSOES_TELAS_ADMIN.dashboard} />}>
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
        </Route>
        <Route element={<RequirePermissao algumaDe={PERMISSOES_TELAS_ADMIN.pedidos} />}>
          <Route path="/admin/pedidos" element={<AdminPedidos />} />
          <Route path="/admin/pedidos/:id" element={<DetalhesPedido />} />
        </Route>
        <Route element={<RequirePermissao algumaDe={PERMISSOES_TELAS_ADMIN.cardapio} />}>
          <Route path="/admin/cardapio" element={<CardapioAdmin />} />
          <Route path="/admin/categorias" element={<CategoriasAdmin />} />
          <Route path="/admin/cardapio/novo" element={<FormularioProduto />} />
          <Route path="/admin/cardapio/:id/editar" element={<FormularioProduto />} />
          <Route path="/admin/adicionais" element={<AdicionaisAdmin />} />
          <Route path="/admin/promocoes" element={<PromocoesAdmin />} />
        </Route>
        <Route element={<RequirePermissao algumaDe={PERMISSOES_TELAS_ADMIN.funcionarios} />}>
          <Route path="/admin/funcionarios" element={<FuncionariosAdmin />} />
        </Route>
        <Route element={<RequirePermissao algumaDe={PERMISSOES_TELAS_ADMIN.mesas} />}>
          <Route path="/admin/mesas" element={<MesasAdmin />} />
        </Route>
        <Route element={<RequirePermissao algumaDe={PERMISSOES_TELAS_ADMIN.relatorios} />}>
          <Route path="/admin/relatorios" element={<RelatoriosAdmin />} />
        </Route>
        <Route element={<RequirePermissao algumaDe={PERMISSOES_TELAS_ADMIN.configuracoes} />}>
          <Route path="/admin/configuracoes" element={<ConfiguracoesAdmin />} />
        </Route>
        <Route element={<RequirePermissao algumaDe={PERMISSOES_TELAS_ADMIN.areasEntrega} />}>
          <Route path="/admin/areas-entrega" element={<AreasEntregaAdmin />} />
        </Route>
        {/* Aberta a todo administrador: a troca da própria senha mora aqui. */}
        <Route path="/admin/acessos" element={<AcessosAdmin />} />
      </Route>

      <Route path="/garcom/acesso" element={<AcessoGarcom />} />
      <Route path="/garcom/acesso/:token" element={<AcessoGarcom />} />
      <Route element={<RequireGarcom />}>
        <Route path="/garcom/mesas" element={<MesasGarcom />} />
        <Route path="/garcom/comanda/:mesaId" element={<ComandaGarcom />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
