import React from 'react';
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from './App.jsx';
import { AppProvider } from './context/AppProvider.jsx';

// Poppins servida pelo próprio site: a CSP de produção (server/app.js) só
// aceita fontes e estilos de 'self', então o Google Fonts era bloqueado.
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import './css/reset.css';
import './css/global.css';


const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>
);
