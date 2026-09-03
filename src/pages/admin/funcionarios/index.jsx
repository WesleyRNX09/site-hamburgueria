import { Edit3, Plus, QrCode, Save, UserRoundPlus, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import styles from '../shared.module.css';

const vazio = { nome: '', cargo: 'Garçom', pin: '' };

function FuncionariosAdmin() {
  const { funcionarios, salvarFuncionario, alternarFuncionario } = useApp();
  const navigate = useNavigate();
  const [formulario, setFormulario] = useState(null);
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);
  const [alterandoId, setAlterandoId] = useState(null);

  function alterar(campo, valor) {
    setFormulario((atual) => ({ ...atual, [campo]: valor }));
  }

  async function enviar(event) {
    event.preventDefault();
    if (processando) return;
    if (!formulario.nome.trim() || !/^\d{4,6}$/.test(formulario.pin)) {
      setErro('Informe o nome e um PIN numérico de 4 a 6 dígitos.');
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

  const acao = <button type="button" className={styles.botaoPrimario} onClick={() => setFormulario({ ...vazio })}><UserRoundPlus size={17} /> Cadastrar garçom</button>;

  return (
    <AdminLayout titulo="Funcionários" subtitulo="Cadastre a equipe e gere acessos individuais por QR Code + PIN." acao={acao}>
      <section className={styles.gradeMetricas}>
        <div className={styles.metrica}><div className={styles.metricaIcone}><Users size={23} /></div><div><span>Funcionários</span><strong>{funcionarios.length}</strong><small>Total cadastrado</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><Users size={23} /></div><div><span>Ativos</span><strong>{funcionarios.filter((item) => item.status === 'Ativo').length}</strong><small>Com acesso liberado</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><QrCode size={23} /></div><div><span>QR Codes</span><strong>{funcionarios.length}</strong><small>Um token por funcionário</small></div></div>
        <div className={styles.metrica}><div className={styles.metricaIcone}><Plus size={23} /></div><div><span>Comandas fechadas</span><strong>{funcionarios.reduce((total, item) => total + item.comandas, 0)}</strong><small>Produção da equipe</small></div></div>
      </section>

      {formulario && (
        <section className={styles.card}>
          <div className={styles.topoCard}><div><h2>{formulario.id ? 'Editar funcionário' : 'Novo funcionário'}</h2><p>O PIN é solicitado somente depois da leitura do QR.</p></div><button type="button" className={styles.botaoIcone} aria-label="Fechar formulário" onClick={() => setFormulario(null)}><X size={17} /></button></div>
          <form className={styles.formulario} onSubmit={enviar}>
            <div className={styles.gridFormulario}>
              <div className={styles.campo}><label htmlFor="nomeFuncionario">Nome completo</label><input id="nomeFuncionario" value={formulario.nome} onChange={(event) => alterar('nome', event.target.value)} placeholder="Carlos Silva" /></div>
              <div className={styles.campo}><label htmlFor="cargoFuncionario">Cargo</label><select id="cargoFuncionario" value={formulario.cargo} onChange={(event) => alterar('cargo', event.target.value)}><option>Garçom</option><option>Garçonete</option><option>Atendente</option></select></div>
              <div className={styles.campo}><label htmlFor="pinFuncionario">PIN de acesso</label><input id="pinFuncionario" type="password" inputMode="numeric" maxLength="6" value={formulario.pin} onChange={(event) => alterar('pin', event.target.value.replace(/\D/g, ''))} placeholder="4 a 6 dígitos" /></div>
            </div>
            {erro && <div className={styles.erro} role="alert">{erro}</div>}
            <div className={styles.aviso}>O QR Code guarda apenas um identificador seguro do funcionário. O PIN nunca é inserido no código.</div>
            <div className={styles.rodapeFormulario}><button disabled={processando} type="button" className={styles.botaoSecundario} onClick={() => setFormulario(null)}>Cancelar</button><button disabled={processando} type="submit" className={styles.botaoPrimario}><Save size={17} /> {processando ? 'Salvando…' : 'Salvar funcionário'}</button></div>
          </form>
        </section>
      )}

      <section className={styles.card}>
        <div className={styles.topoCard}><div><h2>Equipe cadastrada</h2><p>Controle status, acesso e desempenho.</p></div></div>
        <div className={`${styles.tabelaContainer} ${styles.tabelaCartoes}`}>
          <table className={styles.tabela} aria-label="Funcionários cadastrados">
            <thead><tr><th>Funcionário</th><th>Cargo</th><th>Status</th><th>PIN</th><th>Comandas</th><th>Vendas</th><th>Ações</th></tr></thead>
            <tbody>
              {funcionarios.map((funcionario) => (
                <tr key={funcionario.id}>
                  <td data-rotulo="Funcionário"><strong>{funcionario.nome}</strong><span className={styles.textoSecundario}>{funcionario.id}</span></td>
                  <td data-rotulo="Cargo">{funcionario.cargo}</td>
                  <td data-rotulo="Status"><button disabled={alterandoId === funcionario.id} type="button" className={`${styles.status} ${funcionario.status === 'Ativo' ? styles.statusAtivo : styles.statusInativo}`} onClick={() => mudarStatus(funcionario)}>{alterandoId === funcionario.id ? 'Atualizando…' : funcionario.status}</button></td>
                  <td data-rotulo="PIN">••••</td>
                  <td data-rotulo="Comandas">{funcionario.comandas}</td>
                  <td data-rotulo="Vendas">{funcionario.vendas}</td>
                  <td data-rotulo="Ações"><div className={styles.acoes}><button type="button" className={styles.botaoIcone} aria-label={`Editar ${funcionario.nome}`} onClick={() => setFormulario({ ...funcionario })}><Edit3 size={16} /></button><button type="button" className={styles.botaoIcone} aria-label={`QR Code de ${funcionario.nome}`} onClick={() => navigate(`/admin/funcionarios/${funcionario.id}/qr`)}><QrCode size={16} /></button></div></td>
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
