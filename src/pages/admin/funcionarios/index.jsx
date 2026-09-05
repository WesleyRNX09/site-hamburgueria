import { Copy, Edit3, ExternalLink, KeyRound, QrCode, RefreshCw, Save, Trash2, UserRoundPlus, Users, X } from 'lucide-react';
import { useState } from 'react';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import { QRCodeSVG } from '../../../vendor/qrcode';
import styles from '../shared.module.css';

const vazio = { nome: '', cargo: 'Garçom', senha: '' };

/*
  O QR Code é um só para toda a equipe: leva à tela de acesso do garçom, onde
  ele digita apenas a senha que o administrador cadastrou aqui. Não há um código
  por pessoa — o mesmo serve para quantos garçons forem cadastrados, e trocá-lo
  invalida de uma vez os códigos já impressos.
*/
function FuncionariosAdmin() {
  const {
    funcionarios,
    acessoGarcom,
    salvarFuncionario,
    excluirFuncionario,
    alternarFuncionario,
    rotacionarAcessoGarcom
  } = useApp();
  const [formulario, setFormulario] = useState(null);
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);
  const [alterandoId, setAlterandoId] = useState(null);
  const [copiado, setCopiado] = useState(false);
  const [trocandoQr, setTrocandoQr] = useState(false);

  const urlAcesso = acessoGarcom ? `${window.location.origin}/garcom/acesso/${acessoGarcom}` : '';

  function alterar(campo, valor) {
    setFormulario((atual) => ({ ...atual, [campo]: valor }));
  }

  async function enviar(event) {
    event.preventDefault();
    if (processando) return;
    if (!formulario.nome.trim()) {
      setErro('Informe o nome do funcionário.');
      return;
    }
    /* Na edição, senha em branco mantém a atual; no cadastro ela é obrigatória,
       porque é a única credencial do garçom. */
    if ((!formulario.id || formulario.senha) && !/^[a-z0-9][a-z0-9._-]{3,31}$/.test(formulario.senha)) {
      setErro('A senha deve ter de 4 a 32 caracteres, usando letras, números, ponto, hífen ou _.');
      return;
    }
    setProcessando(true);
    try {
      await salvarFuncionario(formulario);
      setFormulario(null);
      setErro('');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  async function remover(funcionario) {
    if (alterandoId) return;
    if (!window.confirm(
      `Excluir ${funcionario.nome}? O acesso é encerrado na hora. As comandas e os pedidos já atendidos continuam no histórico, sem o vínculo com o cadastro.`
    )) return;
    setAlterandoId(funcionario.id);
    try {
      await excluirFuncionario(funcionario.id);
      setErro('');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setAlterandoId(null);
    }
  }

  async function mudarStatus(funcionario) {
    if (alterandoId) return;
    setAlterandoId(funcionario.id);
    try {
      await alternarFuncionario(funcionario.id);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setAlterandoId(null);
    }
  }

  async function trocarQr() {
    if (trocandoQr) return;
    if (!window.confirm(
      'Gerar um novo QR Code para a equipe? Os códigos já impressos deixam de funcionar e a equipe precisa ler o novo.'
    )) return;
    setTrocandoQr(true);
    try {
      await rotacionarAcessoGarcom();
      setErro('');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setTrocandoQr(false);
    }
  }

  async function copiar() {
    await navigator.clipboard.writeText(urlAcesso);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  }

  const acao = <button type="button" className={styles.botaoPrimario} onClick={() => setFormulario({ ...vazio })}><UserRoundPlus size={17} /> Cadastrar garçom</button>;

  return (
    <AdminLayout titulo="Funcionários" subtitulo="Cadastre a equipe e deixe o QR Code de acesso à vista." acao={acao}>
      <section className={styles.gradeMetricas}>
        <div className={styles.metrica}><div className={styles.metricaIcone}><Users size={23} /></div><div><span>Funcionários</span><strong>{funcionarios.length}</strong><small>Total cadastrado</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><Users size={23} /></div><div><span>Ativos</span><strong>{funcionarios.filter((item) => item.status === 'Ativo').length}</strong><small>Com acesso liberado</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><KeyRound size={23} /></div><div><span>Sem senha</span><strong>{funcionarios.filter((item) => !item.senhaDefinida).length}</strong><small>Aguardando você cadastrar</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><QrCode size={23} /></div><div><span>Comandas fechadas</span><strong>{funcionarios.reduce((total, item) => total + item.comandas, 0)}</strong><small>Produção da equipe</small></div></div>
      </section>

      <section className={styles.card}>
        <div className={styles.topoCard}><div><h2>QR Code da equipe</h2><p>Um só para todos os garçons. Imprima e deixe no balcão.</p></div><QrCode size={34} color="#ffc107" /></div>
        <div className={styles.qrArea}>
          {urlAcesso && (
            <div className={styles.qrBox}>
              <QRCodeSVG value={urlAcesso} size={210} level="H" includeMargin aria-label="QR Code de acesso da equipe" />
            </div>
          )}
          <div>
            <div className={styles.aviso}>O garçom lê este código e cai direto na tela de acesso, onde digita <strong>apenas a senha</strong> que você cadastrou. O mesmo QR serve para a equipe inteira — não é preciso gerar um por pessoa. Gere um novo só quando quiser invalidar os códigos já entregues.</div>
            {urlAcesso && <p className={styles.codigo}>{urlAcesso}</p>}
            <div className={styles.acoes}>
              <button disabled={!urlAcesso} type="button" className={styles.botaoPrimario} onClick={copiar}><Copy size={17} /> {copiado ? 'Link copiado' : 'Copiar link'}</button>
              <button disabled={!urlAcesso} type="button" className={styles.botaoSecundario} onClick={() => window.open(urlAcesso, '_blank', 'noopener,noreferrer')}><ExternalLink size={17} /> Abrir tela de acesso</button>
              <button disabled={trocandoQr} type="button" className={styles.botaoSecundario} onClick={trocarQr}><RefreshCw size={17} /> {trocandoQr ? 'Gerando…' : 'Gerar novo QR Code'}</button>
            </div>
          </div>
        </div>
      </section>

      {formulario && (
        <section className={styles.card}>
          <div className={styles.topoCard}><div><h2>{formulario.id ? 'Editar funcionário' : 'Novo funcionário'}</h2><p>A senha é o que o garçom digita para entrar.</p></div><button type="button" className={styles.botaoIcone} aria-label="Fechar formulário" onClick={() => setFormulario(null)}><X size={17} /></button></div>
          <form className={styles.formulario} onSubmit={enviar}>
            <div className={styles.gridFormulario}>
              <div className={styles.campo}><label htmlFor="nomeFuncionario">Nome completo</label><input id="nomeFuncionario" value={formulario.nome} onChange={(event) => alterar('nome', event.target.value)} placeholder="Carlos Silva" /></div>
              <div className={styles.campo}><label htmlFor="cargoFuncionario">Cargo</label><select id="cargoFuncionario" value={formulario.cargo} onChange={(event) => alterar('cargo', event.target.value)}><option>Garçom</option><option>Garçonete</option><option>Atendente</option></select></div>
              <div className={styles.campo}>
                <label htmlFor="senhaFuncionario">{formulario.id ? 'Nova senha (opcional)' : 'Senha'}</label>
                <input
                  id="senhaFuncionario"
                  value={formulario.senha}
                  onChange={(event) => alterar('senha', event.target.value.trim().toLowerCase())}
                  placeholder={formulario.id ? 'Deixe em branco para manter' : 'carlos'}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck="false"
                />
              </div>
            </div>
            {erro && <div className={styles.erro} role="alert">{erro}</div>}
            <div className={styles.aviso}>Escolha algo fácil de lembrar — o próprio nome costuma bastar. Como o garçom entra só com a senha, cada pessoa da equipe precisa de uma senha diferente. Trocar a senha aqui derruba a sessão que o funcionário tiver aberta.</div>
            <div className={styles.rodapeFormulario}><button disabled={processando} type="button" className={styles.botaoSecundario} onClick={() => setFormulario(null)}>Cancelar</button><button disabled={processando} type="submit" className={styles.botaoPrimario}><Save size={17} /> {processando ? 'Salvando…' : 'Salvar funcionário'}</button></div>
          </form>
        </section>
      )}

      <section className={styles.card}>
        <div className={styles.topoCard}><div><h2>Equipe cadastrada</h2><p>Controle status, acesso e desempenho.</p></div></div>
        <div className={`${styles.tabelaContainer} ${styles.tabelaCartoes}`}>
          <table className={styles.tabela} aria-label="Funcionários cadastrados">
            <thead><tr><th>Funcionário</th><th>Cargo</th><th>Status</th><th>Acesso</th><th>Comandas</th><th>Vendas</th><th>Ações</th></tr></thead>
            <tbody>
              {funcionarios.map((funcionario) => (
                <tr key={funcionario.id}>
                  <td data-rotulo="Funcionário"><strong>{funcionario.nome}</strong><span className={styles.textoSecundario}>{funcionario.id}</span></td>
                  <td data-rotulo="Cargo">{funcionario.cargo}</td>
                  <td data-rotulo="Status"><button disabled={alterandoId === funcionario.id} type="button" className={`${styles.status} ${funcionario.status === 'Ativo' ? styles.statusAtivo : styles.statusInativo}`} onClick={() => mudarStatus(funcionario)}>{alterandoId === funcionario.id ? 'Atualizando…' : funcionario.status}</button></td>
                  <td data-rotulo="Acesso">{funcionario.senhaDefinida ? 'Senha cadastrada' : 'Sem senha'}</td>
                  <td data-rotulo="Comandas">{funcionario.comandas}</td>
                  <td data-rotulo="Vendas">{funcionario.vendas}</td>
                  <td data-rotulo="Ações"><div className={styles.acoes}><button type="button" className={styles.botaoIcone} aria-label={`Editar ${funcionario.nome}`} onClick={() => setFormulario({ ...funcionario, senha: '' })}><Edit3 size={16} /></button><button disabled={alterandoId === funcionario.id} type="button" className={styles.botaoIcone} aria-label={`Excluir ${funcionario.nome}`} onClick={() => remover(funcionario)}><Trash2 size={16} /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {erro && !formulario && <div className={styles.erro} role="alert">{erro}</div>}
    </AdminLayout>
  );
}

export default FuncionariosAdmin;
