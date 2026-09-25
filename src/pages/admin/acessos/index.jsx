import { Archive, ArchiveRestore, KeyRound, ListChecks, Lock, Plus, Save, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import { useState } from 'react';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import { PERMISSOES, PERMISSOES_PADRAO_ADMINISTRADOR } from '../../../utils/permissoes';
import styles from '../shared.module.css';
import estilos from './index.module.css';

const administradorVazio = { nome: '', usuario: '', email: '', senha: '', confirmacaoSenha: '' };
const senhaVazia = { senhaAtual: '', novaSenha: '', confirmacaoSenha: '' };

// Permissões agrupadas por área, na ordem do catálogo.
const AREAS_PERMISSOES = PERMISSOES.reduce((areas, permissao) => {
  const area = areas.find((item) => item.nome === permissao.area);
  if (area) area.permissoes.push(permissao);
  else areas.push({ nome: permissao.area, permissoes: [permissao] });
  return areas;
}, []);

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
    alterarSenhaAdministrador,
    atualizarPermissoesAdministrador,
    arquivarAdministrador,
    desarquivarAdministrador,
    excluirAdministrador,
    temPermissao
  } = useApp();
  const [novo, setNovo] = useState(null);
  const [senha, setSenha] = useState(senhaVazia);
  const [edicaoPermissoes, setEdicaoPermissoes] = useState(null);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [processando, setProcessando] = useState(false);
  /* A troca da própria senha vale para todos. Gerenciar administradores, suas
    permissões e o histórico exige funcionarios.gerenciar, também no servidor. */
  const podeGerenciar = temPermissao('funcionarios.gerenciar');

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

  async function arquivar(administrador) {
    if (!window.confirm(`Arquivar ${administrador.nome}? A conta perde o acesso e as permissões e vai para Arquivados. O nome continua no histórico e você pode desarquivar depois.`)) return;
    setProcessando(true);
    setErro('');
    setSucesso('');
    try {
      await arquivarAdministrador(administrador.id);
      if (edicaoPermissoes?.id === administrador.id) setEdicaoPermissoes(null);
      setSucesso(`${administrador.nome} foi arquivado.`);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  async function desarquivar(administrador) {
    if (!window.confirm(`Desarquivar ${administrador.nome}? A conta volta para a lista desativada e sem permissões. Depois marque as permissões e ative quando quiser.`)) return;
    setProcessando(true);
    setErro('');
    setSucesso('');
    try {
      await desarquivarAdministrador(administrador.id);
      setSucesso(`${administrador.nome} foi desarquivado. A conta está desativada e sem permissões.`);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  async function apagar(administrador) {
    if (!window.confirm(`Apagar ${administrador.nome} definitivamente? O nome some do histórico de acessos e dos pagamentos e comandas registrados por esta conta. Não dá para desfazer.`)) return;
    setProcessando(true);
    setErro('');
    setSucesso('');
    try {
      await excluirAdministrador(administrador.id);
      if (edicaoPermissoes?.id === administrador.id) setEdicaoPermissoes(null);
      setSucesso(`${administrador.nome} foi apagado.`);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  function abrirPermissoes(administrador) {
    setNovo(null);
    setErro('');
    setSucesso('');
    setEdicaoPermissoes({
      id: administrador.id,
      nome: administrador.nome,
      selecionadas: administrador.permissoes ?? []
    });
  }

  function alternarPermissao(chave) {
    if (!temPermissao(chave)) return;
    setEdicaoPermissoes((atual) => ({
      ...atual,
      selecionadas: atual.selecionadas.includes(chave)
        ? atual.selecionadas.filter((item) => item !== chave)
        : [...atual.selecionadas, chave]
    }));
  }

  /* O atalho liga o conjunto padrão até onde a própria conta pode conceder;
    permissões que ela não possui ficam como estão. */
  function aplicarPadrao() {
    setEdicaoPermissoes((atual) => ({
      ...atual,
      selecionadas: [...new Set([
        ...atual.selecionadas.filter((chave) => !temPermissao(chave)),
        ...PERMISSOES_PADRAO_ADMINISTRADOR.filter((chave) => temPermissao(chave))
      ])]
    }));
  }

  async function salvarPermissoes(evento) {
    evento.preventDefault();
    setProcessando(true);
    setErro('');
    try {
      await atualizarPermissoesAdministrador(edicaoPermissoes.id, edicaoPermissoes.selecionadas);
      setSucesso(`Permissões de ${edicaoPermissoes.nome} atualizadas.`);
      setEdicaoPermissoes(null);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  const administradoresEmUso = administradores.filter((administrador) => !administrador.arquivado);
  const administradoresArquivados = administradores.filter((administrador) => administrador.arquivado);

  const acao = podeGerenciar
    ? <button type="button" className={styles.botaoPrimario} onClick={() => { setEdicaoPermissoes(null); setNovo({ ...administradorVazio }); setErro(''); }}><Plus size={17} /> Novo administrador</button>
    : null;

  const cardSenha = (
    <section className={styles.card}>
      <div className={styles.topoCard}><div><h2>Alterar minha senha</h2><p>A senha atual é validada pelo servidor.</p></div><KeyRound size={25} color="#ffc107" /></div>
      <form className={styles.formulario} onSubmit={trocarSenha}>
        <div className={styles.campo}><label htmlFor="senhaAtual">Senha atual</label><input id="senhaAtual" required type="password" autoComplete="current-password" value={senha.senhaAtual} onChange={(evento) => setSenha((atual) => ({ ...atual, senhaAtual: evento.target.value }))} /></div>
        <div className={styles.campo}><label htmlFor="novaSenha">Nova senha</label><input id="novaSenha" required minLength={12} type="password" autoComplete="new-password" value={senha.novaSenha} onChange={(evento) => setSenha((atual) => ({ ...atual, novaSenha: evento.target.value }))} /></div>
        <div className={styles.campo}><label htmlFor="confirmarNovaSenha">Confirmar nova senha</label><input id="confirmarNovaSenha" required minLength={12} type="password" autoComplete="new-password" value={senha.confirmacaoSenha} onChange={(evento) => setSenha((atual) => ({ ...atual, confirmacaoSenha: evento.target.value }))} /></div>
        <button disabled={processando} type="submit" className={styles.botaoPrimario}><Save size={17} /> Alterar senha</button>
      </form>
    </section>
  );

  return (
    <AdminLayout titulo="Acessos administrativos" subtitulo={podeGerenciar ? 'Gerencie administradores, permissões e a segurança da sua própria conta.' : 'Gerencie a segurança da sua própria conta.'} acao={acao}>
      {podeGerenciar && novo && (
        <section className={`${styles.card} ${styles.secaoComMargemInferior}`}>
          <div className={styles.topoCard}><div><h2>Novo administrador</h2><p>A senha é protegida pelo mesmo hash seguro usado no sistema. A conta nasce com todas as permissões.</p></div><button type="button" className={styles.botaoIcone} aria-label="Fechar formulário" onClick={() => setNovo(null)}><X size={17} /></button></div>
          <form className={styles.formulario} onSubmit={cadastrar}>
            <div className={styles.gridFormulario}>
              <div className={styles.campo}><label htmlFor="novoAdminNome">Nome</label><input id="novoAdminNome" required value={novo.nome} onChange={(evento) => setNovo((atual) => ({ ...atual, nome: evento.target.value }))} /></div>
              <div className={styles.campo}><label htmlFor="novoAdminUsuario">Usuário</label><input id="novoAdminUsuario" required autoComplete="username" value={novo.usuario} onChange={(evento) => setNovo((atual) => ({ ...atual, usuario: evento.target.value }))} /></div>
              <div className={`${styles.campo} ${styles.campoCompleto}`}><label htmlFor="novoAdminEmail">E-mail</label><input id="novoAdminEmail" required type="email" value={novo.email} onChange={(evento) => setNovo((atual) => ({ ...atual, email: evento.target.value }))} /></div>
              <div className={styles.campo}><label htmlFor="novoAdminSenha">Senha</label><input id="novoAdminSenha" required minLength={12} type="password" autoComplete="new-password" value={novo.senha} onChange={(evento) => setNovo((atual) => ({ ...atual, senha: evento.target.value }))} /></div>
              <div className={styles.campo}><label htmlFor="novoAdminConfirmacao">Confirmar senha</label><input id="novoAdminConfirmacao" required minLength={12} type="password" autoComplete="new-password" value={novo.confirmacaoSenha} onChange={(evento) => setNovo((atual) => ({ ...atual, confirmacaoSenha: evento.target.value }))} /></div>
            </div>
            <div className={styles.rodapeFormulario}><button disabled={processando} type="submit" className={styles.botaoPrimario}><UserPlus size={17} /> Cadastrar administrador</button></div>
          </form>
        </section>
      )}

      {podeGerenciar && edicaoPermissoes && (
        <section className={`${styles.card} ${styles.secaoComMargemInferior}`} aria-labelledby="titulo-permissoes">
          <div className={styles.topoCard}>
            <div><h2 id="titulo-permissoes">Permissões de {edicaoPermissoes.nome}</h2><p>Marque o que esta conta pode ver e fazer no painel. Você só concede o que a sua conta também possui.</p></div>
            <button type="button" className={styles.botaoIcone} aria-label="Fechar permissões" onClick={() => setEdicaoPermissoes(null)}><X size={17} /></button>
          </div>
          <form className={styles.formulario} onSubmit={salvarPermissoes}>
            <div className={estilos.atalhosPermissoes}>
              <button type="button" className={styles.botaoSecundario} disabled={processando} onClick={aplicarPadrao}><ListChecks size={16} /> Aplicar padrão de Administrador</button>
              <span>{edicaoPermissoes.selecionadas.length} de {PERMISSOES.length} permissões marcadas</span>
            </div>
            <div className={estilos.gradeAreas}>
              {AREAS_PERMISSOES.map((area) => (
                <fieldset className={estilos.areaPermissoes} key={area.nome}>
                  <legend>{area.nome}</legend>
                  {area.permissoes.map((permissao) => {
                    const bloqueada = !temPermissao(permissao.chave);
                    return (
                      <label className={`${estilos.opcaoPermissao} ${bloqueada ? estilos.opcaoBloqueada : ''}`} key={permissao.chave}>
                        <input
                          type="checkbox"
                          checked={edicaoPermissoes.selecionadas.includes(permissao.chave)}
                          disabled={bloqueada || processando}
                          onChange={() => alternarPermissao(permissao.chave)}
                        />
                        <span>
                          <strong>{permissao.rotulo}</strong>
                          <small>{permissao.chave}{bloqueada ? ' • sua conta não possui esta permissão' : ''}</small>
                        </span>
                        {bloqueada && <Lock size={14} aria-hidden="true" />}
                      </label>
                    );
                  })}
                </fieldset>
              ))}
            </div>
            <div className={styles.rodapeFormulario}>
              <button type="button" className={styles.botaoSecundario} onClick={() => setEdicaoPermissoes(null)}>Cancelar</button>
              <button disabled={processando} type="submit" className={styles.botaoPrimario}><Save size={17} /> Salvar permissões</button>
            </div>
          </form>
        </section>
      )}

      {sucesso && <div className={`${styles.sucesso} ${styles.secaoComMargemInferior}`} role="status">{sucesso}</div>}
      {erro && <div className={`${styles.erro} ${styles.secaoComMargemInferior}`} role="alert">{erro}</div>}

      {podeGerenciar ? (
        <div className={styles.gradeDuasColunas}>
          <section className={styles.card}>
            <div className={styles.topoCard}><div><h2>Administradores</h2><p>Mais de uma conta pode operar o painel, cada uma com suas permissões.</p></div><ShieldCheck size={25} color="#ffc107" /></div>
            <div className={styles.listaAdicionaisAdmin}>
              {administradoresEmUso.map((administrador) => {
                const propria = administrador.id === adminSessao?.id;
                const totalPermissoes = administrador.permissoes?.length ?? 0;
                return (
                  <div className={styles.adicionalLinha} key={administrador.id}>
                    <div><strong>{administrador.nome}{propria ? ' (você)' : ''}</strong><span>{administrador.usuario} • {administrador.email} • {totalPermissoes} de {PERMISSOES.length} permissões</span></div>
                    <span className={`${styles.status} ${administrador.ativo ? styles.statusAtivo : styles.statusInativo}`}>{administrador.ativo ? 'Ativo' : 'Inativo'}</span>
                    <div className={styles.acoes}>
                      <button disabled={processando || propria} title={propria ? 'Você não pode alterar as próprias permissões.' : undefined} type="button" className={styles.botaoSecundario} onClick={() => abrirPermissoes(administrador)}>Permissões</button>
                      <button disabled={processando || propria} type="button" className={administrador.ativo ? styles.botaoPerigo : styles.botaoSecundario} onClick={() => alternar(administrador)}>{administrador.ativo ? 'Desativar' : 'Ativar'}</button>
                      <button disabled={processando || propria} title={propria ? 'Você não pode arquivar a própria conta.' : undefined} type="button" className={styles.botaoSecundario} onClick={() => arquivar(administrador)}><Archive size={15} /> Arquivar</button>
                      <button disabled={processando || propria} title={propria ? 'Você não pode apagar a própria conta.' : undefined} type="button" className={styles.botaoPerigo} onClick={() => apagar(administrador)}><Trash2 size={15} /> Apagar</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {cardSenha}
        </div>
      ) : cardSenha}

      {podeGerenciar && administradoresArquivados.length > 0 && (
        <section className={`${styles.card} ${styles.secaoSeparada}`}>
          <div className={styles.topoCard}><div><h2>Arquivados</h2><p>Contas sem acesso. Ao desarquivar, a conta volta desativada e sem permissões.</p></div><Archive size={25} color="#ffc107" /></div>
          <div className={styles.listaAdicionaisAdmin}>
            {administradoresArquivados.map((administrador) => (
              <div className={styles.adicionalLinha} key={administrador.id}>
                <div><strong>{administrador.nome}</strong><span>{administrador.usuario} • {administrador.email} • arquivado em {dataHora(administrador.arquivadoEm)}</span></div>
                <span className={`${styles.status} ${styles.statusInativo}`}>Arquivado</span>
                <div className={styles.acoes}>
                  <button disabled={processando} type="button" className={styles.botaoSecundario} onClick={() => desarquivar(administrador)}><ArchiveRestore size={15} /> Desarquivar</button>
                  <button disabled={processando} type="button" className={styles.botaoPerigo} onClick={() => apagar(administrador)}><Trash2 size={15} /> Apagar</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {podeGerenciar && (
        <section className={`${styles.card} ${styles.secaoSeparada}`}>
          <div className={styles.topoCard}><div><h2>Histórico de acessos</h2><p>Cada entrada de administrador no painel administrativo.</p></div></div>
          <div className={`${styles.tabelaContainer} ${styles.tabelaCartoes}`}>
            <table className={styles.tabela} aria-label="Histórico de acessos"><thead><tr><th>Data</th><th>Administrador</th><th>Usuário</th><th>Ação</th></tr></thead><tbody>{auditoria.map((registro) => <tr key={registro.id}><td data-rotulo="Data">{dataHora(registro.criadoEm)}</td><td data-rotulo="Administrador"><strong>{registro.administrador}</strong></td><td data-rotulo="Usuário">{registro.usuario || '—'}</td><td data-rotulo="Ação">Entrou no painel</td></tr>)}</tbody></table>
            {auditoria.length === 0 && <div className={styles.vazio}><p>Os próximos logins de administradores aparecerão aqui.</p></div>}
          </div>
        </section>
      )}
    </AdminLayout>
  );
}

export default AcessosAdmin;
