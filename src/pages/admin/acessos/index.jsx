import { KeyRound, Plus, Save, ShieldCheck, UserPlus, X } from 'lucide-react';
import { useState } from 'react';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import styles from '../shared.module.css';

const administradorVazio = { nome: '', usuario: '', email: '', senha: '', confirmacaoSenha: '' };
const senhaVazia = { senhaAtual: '', novaSenha: '', confirmacaoSenha: '' };

function dataHora(valor) {
  if (!valor) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(valor));
}

function AcessosAdmin() {
  const {
    adminSessao,
    administradores,
    auditoria,
    criarAdministrador,
    alternarAdministrador,
    alterarSenhaAdministrador
  } = useApp();
  const [novo, setNovo] = useState(null);
  const [senha, setSenha] = useState(senhaVazia);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [processando, setProcessando] = useState(false);

  async function cadastrar(evento) {
    evento.preventDefault();
    setProcessando(true);
    setErro('');
    try {
      await criarAdministrador(novo);
      setNovo(null);
      setSucesso('Administrador cadastrado com sucesso.');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  async function trocarSenha(evento) {
    evento.preventDefault();
    setProcessando(true);
    setErro('');
    try {
      await alterarSenhaAdministrador(senha);
      setSenha(senhaVazia);
      setSucesso('Senha alterada. As outras sessões desta conta foram encerradas.');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  async function alternar(administrador) {
    setProcessando(true);
    setErro('');
    try {
      await alternarAdministrador(administrador.id);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  const acao = <button type="button" className={styles.botaoPrimario} onClick={() => { setNovo({ ...administradorVazio }); setErro(''); }}><Plus size={17} /> Novo administrador</button>;

  return (
    <AdminLayout titulo="Acessos administrativos" subtitulo="Gerencie administradores e a segurança da sua própria conta." acao={acao}>
      {novo && (
        <section className={`${styles.card} ${styles.secaoComMargemInferior}`}>
          <div className={styles.topoCard}><div><h2>Novo administrador</h2><p>A senha é protegida pelo mesmo hash seguro usado no sistema.</p></div><button type="button" className={styles.botaoIcone} aria-label="Fechar formulário" onClick={() => setNovo(null)}><X size={17} /></button></div>
          <form className={styles.formulario} onSubmit={cadastrar}>
            <div className={styles.gridFormulario}>
              <div className={styles.campo}><label htmlFor="novoAdminNome">Nome</label><input id="novoAdminNome" required value={novo.nome} onChange={(evento) => setNovo((atual) => ({ ...atual, nome: evento.target.value }))} /></div>
              <div className={styles.campo}><label htmlFor="novoAdminUsuario">Usuário</label><input id="novoAdminUsuario" required autoComplete="username" value={novo.usuario} onChange={(evento) => setNovo((atual) => ({ ...atual, usuario: evento.target.value }))} /></div>
              <div className={`${styles.campo} ${styles.campoCompleto}`}><label htmlFor="novoAdminEmail">E-mail</label><input id="novoAdminEmail" required type="email" value={novo.email} onChange={(evento) => setNovo((atual) => ({ ...atual, email: evento.target.value }))} /></div>
              <div className={styles.campo}><label htmlFor="novoAdminSenha">Senha</label><input id="novoAdminSenha" required minLength={10} type="password" autoComplete="new-password" value={novo.senha} onChange={(evento) => setNovo((atual) => ({ ...atual, senha: evento.target.value }))} /></div>
              <div className={styles.campo}><label htmlFor="novoAdminConfirmacao">Confirmar senha</label><input id="novoAdminConfirmacao" required minLength={10} type="password" autoComplete="new-password" value={novo.confirmacaoSenha} onChange={(evento) => setNovo((atual) => ({ ...atual, confirmacaoSenha: evento.target.value }))} /></div>
            </div>
            <div className={styles.rodapeFormulario}><button disabled={processando} type="submit" className={styles.botaoPrimario}><UserPlus size={17} /> Cadastrar administrador</button></div>
          </form>
        </section>
      )}

      {sucesso && <div className={`${styles.sucesso} ${styles.secaoComMargemInferior}`} role="status">{sucesso}</div>}
      {erro && <div className={`${styles.erro} ${styles.secaoComMargemInferior}`} role="alert">{erro}</div>}

      <div className={styles.gradeDuasColunas}>
        <section className={styles.card}>
          <div className={styles.topoCard}><div><h2>Administradores</h2><p>Mais de uma conta pode operar o painel.</p></div><ShieldCheck size={25} color="#ffc107" /></div>
          <div className={styles.listaAdicionaisAdmin}>
            {administradores.map((administrador) => (
              <div className={styles.adicionalLinha} key={administrador.id}>
                <div><strong>{administrador.nome}{administrador.id === adminSessao?.id ? ' (você)' : ''}</strong><span>{administrador.usuario} • {administrador.email}</span></div>
                <span className={`${styles.status} ${administrador.ativo ? styles.statusAtivo : styles.statusInativo}`}>{administrador.ativo ? 'Ativo' : 'Inativo'}</span>
                <button disabled={processando || administrador.id === adminSessao?.id} type="button" className={administrador.ativo ? styles.botaoPerigo : styles.botaoSecundario} onClick={() => alternar(administrador)}>{administrador.ativo ? 'Desativar' : 'Ativar'}</button>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.topoCard}><div><h2>Alterar minha senha</h2><p>A senha atual é validada pelo servidor.</p></div><KeyRound size={25} color="#ffc107" /></div>
          <form className={styles.formulario} onSubmit={trocarSenha}>
            <div className={styles.campo}><label htmlFor="senhaAtual">Senha atual</label><input id="senhaAtual" required type="password" autoComplete="current-password" value={senha.senhaAtual} onChange={(evento) => setSenha((atual) => ({ ...atual, senhaAtual: evento.target.value }))} /></div>
            <div className={styles.campo}><label htmlFor="novaSenha">Nova senha</label><input id="novaSenha" required minLength={10} type="password" autoComplete="new-password" value={senha.novaSenha} onChange={(evento) => setSenha((atual) => ({ ...atual, novaSenha: evento.target.value }))} /></div>
            <div className={styles.campo}><label htmlFor="confirmarNovaSenha">Confirmar nova senha</label><input id="confirmarNovaSenha" required minLength={10} type="password" autoComplete="new-password" value={senha.confirmacaoSenha} onChange={(evento) => setSenha((atual) => ({ ...atual, confirmacaoSenha: evento.target.value }))} /></div>
            <button disabled={processando} type="submit" className={styles.botaoPrimario}><Save size={17} /> Alterar senha</button>
          </form>
        </section>
      </div>

      <section className={`${styles.card} ${styles.secaoSeparada}`}>
        <div className={styles.topoCard}><div><h2>Histórico administrativo</h2><p>Confirmações, estornos, cancelamentos e mudanças de acesso.</p></div></div>
        <div className={`${styles.tabelaContainer} ${styles.tabelaCartoes}`}>
          <table className={styles.tabela} aria-label="Histórico administrativo"><thead><tr><th>Data</th><th>Administrador</th><th>Ação</th><th>Registro</th></tr></thead><tbody>{auditoria.map((registro) => <tr key={registro.id}><td data-rotulo="Data">{dataHora(registro.criadoEm)}</td><td data-rotulo="Administrador"><strong>{registro.administrador}</strong></td><td data-rotulo="Ação">{registro.acao.replaceAll('.', ' ')}</td><td data-rotulo="Registro">{registro.entidade} {registro.entidadeId}</td></tr>)}</tbody></table>
          {auditoria.length === 0 && <div className={styles.vazio}><p>As próximas ações relevantes aparecerão aqui.</p></div>}
        </div>
      </section>
    </AdminLayout>
  );
}

export default AcessosAdmin;
