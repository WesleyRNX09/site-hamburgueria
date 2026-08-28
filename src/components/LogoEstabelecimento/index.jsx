import { useState } from 'react';

function LogoEstabelecimento({ configuracao, alternativa, className, loading = 'eager' }) {
  const [logoComErro, setLogoComErro] = useState('');
  const logo = configuracao?.logo ?? '';

  if (logo && logo !== logoComErro) {
    return (
      <img
        className={className}
        src={logo}
        alt={configuracao?.nomeLoja ? `Logo de ${configuracao.nomeLoja}` : 'Logo do estabelecimento'}
        loading={loading}
        decoding="async"
        onError={() => setLogoComErro(logo)}
      />
    );
  }

  return alternativa ?? configuracao?.nomeLoja ?? 'Cardápio online';
}

export default LogoEstabelecimento;
