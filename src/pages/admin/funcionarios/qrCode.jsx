import { ArrowLeft, Copy, ExternalLink, QrCode, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import { QRCodeSVG } from '../../../vendor/qrcode';
import styles from '../shared.module.css';

function QrCodeFuncionario() {
  const { id } = useParams();
  const { funcionarios, gerarAcessoFuncionario } = useApp();
  const navigate = useNavigate();
  const [copiado, setCopiado] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');
  const funcionario = funcionarios.find((item) => item.id === id);

  async function gerarNovoAcesso() {
    if (processando) return;
    if (!window.confirm('Gerar um novo QR Code? A senha atual deixa de funcionar.')) return;
    setProcessando(true);
    try {
      await gerarAcessoFuncionario(id);
      setErro('');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  if (!funcionario) {
    return <AdminLayout titulo="Funcionário não encontrado" subtitulo="Não foi possível gerar o acesso."><button type="button" className={styles.botaoSecundario} onClick={() => navigate('/admin/funcionarios')}><ArrowLeft size={17} /> Voltar</button></AdminLayout>;
  }

  /* O link só abre alguma coisa enquanto a senha não foi criada: depois do
     primeiro acesso ele deixa de valer, e a tela passa a oferecer a geração
     de um acesso novo. */
  const urlAcesso = `${window.location.origin}/garcom/acesso/${funcionario.token}`;

  async function copiar() {
    await navigator.clipboard.writeText(urlAcesso);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  }

  const acao = <button type="button" className={styles.botaoSecundario} onClick={() => navigate('/admin/funcionarios')}><ArrowLeft size={17} /> Voltar</button>;

  return (
    <AdminLayout titulo="QR Code do garçom" subtitulo={`Primeiro acesso de ${funcionario.nome}.`} acao={acao}>
      <section className={styles.card}>
        <div className={styles.qrArea}>
          {funcionario.acessoPendente && (
            <div className={styles.qrBox}>
              <QRCodeSVG value={urlAcesso} size={210} level="H" includeMargin aria-label={`QR Code de ${funcionario.nome}`} />
            </div>
          )}
          <div>
            <div className={styles.topoCard}><div><h2>{funcionario.nome}</h2><p>{funcionario.cargo} • {funcionario.status}</p></div><QrCode size={34} color="#ffc107" /></div>
            {funcionario.acessoPendente ? (
              <>
                <div className={styles.aviso}>O QR Code leva ao primeiro acesso, onde <strong>{funcionario.nome}</strong> cria a própria senha. Ele vale uma única vez; depois disso o acesso é pelo usuário <strong>{funcionario.usuario}</strong> e a senha escolhida.</div>
                <p className={styles.codigo}>{urlAcesso}</p>
                <div className={styles.acoes}>
                  <button type="button" className={styles.botaoPrimario} onClick={copiar}><Copy size={17} /> {copiado ? 'Link copiado' : 'Copiar link'}</button>
                  <button type="button" className={styles.botaoSecundario} onClick={() => window.open(urlAcesso, '_blank', 'noopener,noreferrer')}><ExternalLink size={17} /> Abrir primeiro acesso</button>
                </div>
              </>
            ) : (
              <>
                <div className={styles.aviso}>Primeiro acesso concluído: <strong>{funcionario.nome}</strong> entra com o usuário <strong>{funcionario.usuario}</strong> e a senha que criou. Gere um novo acesso apenas se a senha for esquecida — a atual deixa de funcionar e as sessões abertas caem.</div>
                {erro && <div className={styles.erro} role="alert">{erro}</div>}
                <div className={styles.acoes}>
                  <button disabled={processando} type="button" className={styles.botaoPrimario} onClick={gerarNovoAcesso}><RefreshCw size={17} /> {processando ? 'Gerando…' : 'Gerar novo QR Code'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </AdminLayout>
  );
}

export default QrCodeFuncionario;
