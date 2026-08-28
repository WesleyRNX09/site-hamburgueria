import { ArrowRight, QrCode, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useApp } from '../../context/appContext';
import LogoEstabelecimento from '../../components/LogoEstabelecimento';
import styles from './garcom.module.css';

function AcessoGarcom() {
  const { token } = useParams();
  const { entrarGarcom, configuracao } = useApp();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState('');

  async function entrar(event) {
    event.preventDefault();
    setErro('');
    try {
      if (!await entrarGarcom(token, pin)) {
        setErro('Não foi possível autenticar com os dados informados.');
        return;
      }
      navigate('/garcom/mesas');
    } catch (falha) {
      setErro(falha.message);
    }
  }

  return (
    <main className={styles.acessoPagina}>
      <section className={styles.acessoCard}>
        <div className={styles.marcaAcesso}>
          <LogoEstabelecimento configuracao={configuracao} alternativa={configuracao.nomeLoja || 'Atendimento'} />
        </div>
        <div className={styles.iconeAcesso}>{token ? <ShieldCheck size={30} /> : <QrCode size={30} />}</div>
        <h1>Acesso do garçom</h1>
        <p>{token ? 'Digite seu PIN pessoal para entrar no atendimento.' : 'Escaneie seu QR Code individual para acessar o atendimento.'}</p>

        {token ? (
          <form className={styles.formAcesso} onSubmit={entrar}>
            <div className={styles.campo}><label htmlFor="pinGarcom">PIN de acesso</label><input id="pinGarcom" type="password" inputMode="numeric" maxLength="6" autoFocus value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} placeholder="Digite seu PIN" /></div>
            {erro && <div className={styles.erro} role="alert">{erro}</div>}
            <button type="submit" className={styles.botaoPrincipal}>Entrar no atendimento <ArrowRight size={17} /></button>
          </form>
        ) : (
          <div className={styles.linksDemo}>
            <Link className={styles.linkDemo} to="/"><div><strong>Voltar ao site</strong><small>Página inicial da hamburgueria</small></div></Link>
          </div>
        )}
      </section>
    </main>
  );
}

export default AcessoGarcom;
