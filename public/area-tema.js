/* Cardápio, painel do estabelecimento e garçom são claros; só o superadmin é
   escuro. Marcar a área antes do React montar evita o pisca de paleta. O
   AppProvider mantém isso atualizado a cada troca de rota (mesma regra de
   areaDoTema, em src/utils/theme.js).
   Fica em arquivo próprio, e não inline no index.html, porque a CSP de
   produção (server/app.js) só aceita scripts de 'self'. */
document.documentElement.dataset.area =
  /^\/superadmin(\/|$)/.test(location.pathname) ? 'painel'
    : /^\/garcom(\/|$)/.test(location.pathname) ? 'garcom'
      : /^\/admin(\/|$)/.test(location.pathname) ? 'admin' : 'publica';
