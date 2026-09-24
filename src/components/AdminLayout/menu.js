import {
  BarChart3,
  ClipboardList,
  LayoutDashboard,
  Package,
  Printer,
  Settings,
  ShieldCheck,
  Users,
  Utensils
} from 'lucide-react';

/*
  Permissões que abrem cada tela do painel: basta uma delas. Menu e rotas leem
  daqui; quem autoriza cada ação continua sendo o servidor.
*/
export const PERMISSOES_TELAS_ADMIN = Object.freeze({
  dashboard: ['dashboard.visualizar'],
  pedidos: ['pedidos.visualizar'],
  cardapio: ['produtos.editar'],
  mesas: ['mesas.operar', 'mesas.fechar', 'mesas.cadastrar'],
  funcionarios: ['funcionarios.gerenciar'],
  relatorios: ['relatorios.visualizar'],
  configuracoes: ['personalizacao.editar', 'delivery.editar', 'configuracoes.editar'],
  // Impressão fica com quem já cuida da operação da loja.
  impressoras: ['configuracoes.editar'],
  // Aberta a partir da tela de Configurações, sem item próprio no menu.
  areasEntrega: ['delivery.editar']
});

export const itensMenuAdmin = [
  { nome: 'Dashboard', rota: '/admin/dashboard', icone: LayoutDashboard, permissoes: PERMISSOES_TELAS_ADMIN.dashboard },
  { nome: 'Pedidos', rota: '/admin/pedidos', icone: ClipboardList, permissoes: PERMISSOES_TELAS_ADMIN.pedidos },
  // Categorias, adicionais e promoções moram dentro da tela de cardápio,
  // para encurtar o menu.
  { nome: 'Cardápio', rota: '/admin/cardapio', icone: Package, permissoes: PERMISSOES_TELAS_ADMIN.cardapio },
  { nome: 'Mesas / Comandas', rota: '/admin/mesas', icone: Utensils, permissoes: PERMISSOES_TELAS_ADMIN.mesas },
  { nome: 'Funcionários', rota: '/admin/funcionarios', icone: Users, permissoes: PERMISSOES_TELAS_ADMIN.funcionarios },
  // Sem permissão exigida: é ali que cada administrador troca a própria senha.
  { nome: 'Acessos', rota: '/admin/acessos', icone: ShieldCheck, permissoes: null },
  { nome: 'Relatórios', rota: '/admin/relatorios', icone: BarChart3, permissoes: PERMISSOES_TELAS_ADMIN.relatorios },
  { nome: 'Configurações', rota: '/admin/configuracoes', icone: Settings, permissoes: PERMISSOES_TELAS_ADMIN.configuracoes },
  { nome: 'Impressoras', rota: '/admin/impressoras', icone: Printer, permissoes: PERMISSOES_TELAS_ADMIN.impressoras }
];
