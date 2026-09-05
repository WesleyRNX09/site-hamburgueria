import { ArrowRight, QrCode, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useApp } from '../../context/appContext';
import LogoEstabelecimento from '../../components/LogoEstabelecimento';
import { validarAcessoGarcom } from '../../services/api';
import styles from './garcom.module.css';

/* O QR Code da equipe é o mesmo para todos, então o aparelho pode guardá-lo: o
   garçom lê o código uma vez e nos próximos turnos abre direto na senha. Quando
   o gerente troca o QR, o token guardado deixa de valer e a tela volta a pedir
   a leitura. */
const CHAVE_ACESSO = 'hamburgueria_garcom_acesso';

function lerAcessoSalvo() {
  try {
    return localStorage.getItem(CHAVE_ACESSO) || '';
  } catch {
    return '';
  }
}

function guardarAcesso(token) {
  try {
    localStorage.setItem(CHAVE_ACESSO, token);
  } catch {
    // Navegador sem armazenamento: o acesso continua funcionando pelo QR Code.
  }
}

function esquecerAcesso() {
  try {
    localStorage.removeItem(CHAVE_ACESSO);
  } catch {
    // Nada a limpar.
  }
}

/*
  Uma tela só, com o QR Code da equipe como porta de entrada:

  - `/garcom/acesso/:token` chega da leitura do QR e guarda o código no
    aparelho;
  - `/garcom/acesso` reaproveita o código já guardado.

  Em qualquer um dos casos o garçom digita apenas a senha que o administrador
  cadastrou para ele — é ela que identifica quem está entrando.
*/
function AcessoGarcom() {
  const { token } = useParams();
  const { entrarGarcom, configuracao, sessaoExpirada } = useApp();
  const navigate = useNavigate();
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);
  const [acesso, setAcesso] = useState('');
  /* O código guardado é lido uma vez: depois disso quem manda é o resultado da
     validação, não o que estiver no armazenamento do navegador. */
  const [acessoSalvo] = useState(lerAcessoSalvo);
  const candidato = token || acessoSalvo;
  const [validando, setValidando] = useState(Boolean(candidato));

  useEffect(() => {
    if (!candidato) return undefined;
    let ativo = true;
    validarAcessoGarcom(candidato)
      .then(() => {
        if (!ativo) return;
        guardarAcesso(candidato);
        setAcesso(candidato);
        setErro('');
      })
      .catch((falha) => {
        if (!ativo) return;
        esquecerAcesso();
        setAcesso('');
        setErro(falha.message);
      })
      .finally(() => {
        if (ativo) setValidando(false);
      });
    return () => { ativo = false; };
  }, [candidato]);

  async function entrar(event) {
    event.preventDefault();
    if (processando) return;
    setErro('');
    setProcessando(true);
    try {
      if (!await entrarGarcom(acesso, senha)) {
        setErro('Senha não encontrada. Confira com o gerente.');
        return;
      }
      navigate('/garcom/mesas');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  return (
    <main className={styles.acessoPagina}>
      <section className={styles.acessoCard}>
        <div className={styles.marcaAcesso}>
          <LogoEstabelecimento configuracao={configuracao} alternativa={configuracao.nomeLoja || 'Atendimento'} />
        </div>
        <div className={styles.iconeAcesso}>{acesso ? <ShieldCheck size={30} /> : <QrCode size={30} />}</div>
        <h1>Acesso do garçom</h1>
        <p>
          {acesso
            ? 'Digite a sua senha para entrar no atendimento.'
            : 'Leia o QR Code da equipe, no balcão, para abrir o atendimento neste aparelho.'}
        </p>

        {/* Fica fora do formulário: o motivo do retorno precisa aparecer mesmo
            enquanto o QR Code ainda está sendo validado. */}
        {!erro && sessaoExpirada && <div className={styles.erro} role="alert">{sessaoExpirada}</div>}

        {validando && (
          <div className={styles.identificado} role="status"><span>…</span><div><strong>Validando o acesso</strong><small>Só um instante.</small></div></div>
        )}

        {!validando && !acesso && (
          <>
            {erro && <div className={styles.erro} role="alert">{erro}</div>}
            <p className={styles.ajudaAcesso}>
              O mesmo QR Code serve para toda a equipe. Se ele foi trocado, peça o código atual ao gerente.
            </p>
          </>
        )}

        {!validando && acesso && (
          <form className={styles.formAcesso} onSubmit={entrar}>
            <div className={styles.campo}>
              <label htmlFor="senhaGarcom">Sua senha</label>
              <input
                id="senhaGarcom"
                type="password"
                autoFocus
                maxLength="32"
                autoComplete="current-password"
                autoCapitalize="none"
                spellCheck="false"
                value={senha}
                onChange={(event) => setSenha(event.target.value)}
                placeholder="Digite sua senha"
              />
            </div>
            {erro && <div className={styles.erro} role="alert">{erro}</div>}
            <button type="submit" className={styles.botaoPrincipal} disabled={processando}>
              {processando ? 'Entrando…' : 'Entrar no atendimento'} <ArrowRight size={17} />
            </button>
            <p className={styles.ajudaAcesso}>
              Esqueceu a senha? Peça ao gerente para cadastrar uma nova.
            </p>
          </form>
        )}
      </section>
    </main>
  );
}

export default AcessoGarcom;
