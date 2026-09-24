import {
  Archive,
  ArchiveRestore,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  CirclePause,
  CirclePlay,
  Edit3,
  KeyRound,
  Plus,
  Search,
  ShieldAlert,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import SuperadminLayout from '../../../components/SuperadminLayout';
import { useSuperadmin } from '../../../context/superadminContext';
import styles from './index.module.css';

const CORES_PADRAO = {
  corPrincipal: '#FFC107',
  corSecundaria: '#0A0A0A',
  corFundo: '#111111',
  corCard: '#181818',
  corTexto: '#FFFFFF'
};

function formularioVazio() {
  return {
    nomeFantasia: '',
    slug: '',
    dominioPersonalizado: '',
    plano: 'basico',
    statusAssinatura: 'ativa',
    vencimentoAssinatura: '',
    logo: '',
    banner: '',
    ...CORES_PADRAO,
    fonte: 'Poppins',
    primeiroAdministrador: { nome: '', usuario: '', email: '', senha: '', confirmacaoSenha: '' }
  };
}

function dataFormulario(valor) {
  return valor ? String(valor).slice(0, 10) : '';
}

function dataCurta(valor) {
  if (!valor) return 'Sem vencimento';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(valor));
}

function textoStatus(valor) {
  return String(valor ?? '').replace(/^./, (letra) => letra.toUpperCase());
}

const TAMANHO_MAXIMO_MOTIVO = 280;
const CLASSE_STATUS = {
  ativo: styles.ativo,
  suspenso: styles.suspenso,
  arquivado: styles.arquivado
};

/*
  Confirmação das duas ações que tiram a loja do ar: suspender pede o motivo
  (vai para a auditoria e aparece na lista) e arquivar pede o slug digitado,
  para não arquivar a loja errada com um clique. A mensagem de erro é a do
  servidor, que é quem decide se a transição vale.
*/
function ModalCicloDeVida({ acao, estabelecimento, processando, onCancelar, onConfirmar }) {
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState('');
  const suspender = acao === 'suspender';
  const tamanhoMotivo = Array.from(valor.trim()).length;
  const podeConfirmar = suspender
    ? tamanhoMotivo > 0 && tamanhoMotivo <= TAMANHO_MAXIMO_MOTIVO
    : valor.trim() === estabelecimento.slug;

  useEffect(() => {
    function aoTeclar(evento) {
      if (evento.key === 'Escape' && !processando) onCancelar();
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [onCancelar, processando]);

  async function enviar(evento) {
    evento.preventDefault();
    setErro('');
    try {
      await onConfirmar(valor.trim());
    } catch (falha) {
      setErro(falha.message || 'Não foi possível concluir a ação.');
    }
  }

  return (
    <div className={styles.modalFundo} role="presentation" onClick={(evento) => { if (evento.target === evento.currentTarget && !processando) onCancelar(); }}>
      <section className={`${styles.formularioCard} ${styles.modal}`} role="dialog" aria-modal="true" aria-labelledby="titulo-ciclo-vida">
        <div className={styles.formularioTopo}>
          <div>
            <span>{suspender ? 'SUSPENDER ACESSO' : 'ARQUIVAR TENANT'}</span>
            <h2 id="titulo-ciclo-vida">{suspender ? 'Suspender' : 'Arquivar'} {estabelecimento.nomeFantasia}</h2>
            <p>
              {suspender
                ? 'A loja sai do ar e as sessões abertas de administradores e garçons são encerradas. Dá para reativar depois.'
                : 'O tenant sai da lista padrão e continua fora do ar. Nenhum dado é apagado; dá para desarquivar depois.'}
            </p>
          </div>
          <button type="button" className={styles.fechar} aria-label="Fechar" disabled={processando} onClick={onCancelar}><X size={20} /></button>
        </div>
        <form className={styles.formulario} onSubmit={enviar}>
          {suspender ? (
            <label className={styles.campo}>
              <span>Motivo da suspensão</span>
              <textarea
                required
                autoFocus
                rows={3}
                maxLength={TAMANHO_MAXIMO_MOTIVO}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="Ex.: pagamento de setembro em aberto"
              />
              <small>{tamanhoMotivo}/{TAMANHO_MAXIMO_MOTIVO} caracteres. Fica registrado na auditoria.</small>
            </label>
          ) : (
            <label className={styles.campo}>
              <span>Digite <strong>{estabelecimento.slug}</strong> para confirmar</span>
              <input
                required
                autoFocus
                autoComplete="off"
                spellCheck="false"
                maxLength="100"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder={estabelecimento.slug}
              />
            </label>
          )}
          {erro && <div className={styles.erro} role="alert">{erro}</div>}
          <div className={styles.acoesFormulario}>
            <button type="button" className={styles.botaoSecundario} disabled={processando} onClick={onCancelar}>Cancelar</button>
            <button type="submit" className={styles.botaoPerigo} disabled={processando || !podeConfirmar}>
              {suspender ? <CirclePause size={17} /> : <Archive size={17} />}
              {processando ? 'Aplicando...' : suspender ? 'Suspender acesso' : 'Arquivar tenant'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function FormularioEstabelecimento({ inicial, editando, opcoes, processando, onCancelar, onSalvar }) {
  const [dados, setDados] = useState(inicial);
  const [erro, setErro] = useState('');
  const cores = [
    ['corPrincipal', 'Principal'],
    ['corSecundaria', 'Secundária'],
    ['corFundo', 'Fundo'],
    ['corCard', 'Cards'],
    ['corTexto', 'Texto']
  ];

  function alterar(campo, valor) {
    setDados((atuais) => ({ ...atuais, [campo]: valor }));
  }

  function alterarAdministrador(campo, valor) {
    setDados((atuais) => ({
      ...atuais,
      primeiroAdministrador: { ...atuais.primeiroAdministrador, [campo]: valor }
    }));
  }

  async function enviar(evento) {
    evento.preventDefault();
    setErro('');
    if (!editando && dados.primeiroAdministrador.senha !== dados.primeiroAdministrador.confirmacaoSenha) {
      setErro('A confirmação da senha do primeiro administrador não confere.');
      return;
    }
    try {
      const primeiroAdministrador = { ...dados.primeiroAdministrador };
      delete primeiroAdministrador.confirmacaoSenha;
      await onSalvar(editando ? dados : { ...dados, primeiroAdministrador });
    } catch (falha) {
      setErro(falha.message);
    }
  }

  return (
    <section className={styles.formularioCard} aria-labelledby="titulo-formulario">
      <div className={styles.formularioTopo}>
        <div>
          <span>{editando ? 'EDIÇÃO DO TENANT' : 'NOVO TENANT'}</span>
          <h2 id="titulo-formulario">{editando ? `Editar ${inicial.nomeFantasia}` : 'Cadastrar estabelecimento'}</h2>
          <p>Plano, assinatura e vencimento são informativos: não tiram a loja do ar. Para bloquear o acesso, use Suspender na lista.</p>
        </div>
        <button type="button" className={styles.fechar} aria-label="Fechar formulário" onClick={onCancelar}><X size={20} /></button>
      </div>

      <form className={styles.formulario} onSubmit={enviar}>
        <fieldset>
          <legend>Identificação e acesso</legend>
          <div className={styles.gridCampos}>
            <label className={styles.campo}><span>Nome do estabelecimento</span><input required maxLength="160" value={dados.nomeFantasia} onChange={(e) => alterar('nomeFantasia', e.target.value)} /></label>
            <label className={styles.campo}><span>Slug</span><input required maxLength="100" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="minha-hamburgueria" value={dados.slug} onChange={(e) => alterar('slug', e.target.value.toLowerCase())} /></label>
            <label className={styles.campo}><span>Domínio personalizado <small>(opcional)</small></span><input maxLength="253" placeholder="pedidos.exemplo.com.br" value={dados.dominioPersonalizado} onChange={(e) => alterar('dominioPersonalizado', e.target.value)} /></label>
          </div>
          <p className={styles.ajuda}>{editando ? 'Suspender, reativar e arquivar ficam nas ações da lista.' : 'O estabelecimento nasce ativo. Suspender e arquivar ficam nas ações da lista.'}</p>
        </fieldset>

        <fieldset>
          <legend>Plano e assinatura</legend>
          <div className={styles.gridCampos}>
            <label className={styles.campo}><span>Plano</span><select value={dados.plano} onChange={(e) => alterar('plano', e.target.value)}>{opcoes.planos.map((item) => <option value={item} key={item}>{textoStatus(item)}</option>)}</select></label>
            <label className={styles.campo}><span>Status da assinatura</span><select value={dados.statusAssinatura} onChange={(e) => alterar('statusAssinatura', e.target.value)}>{opcoes.statusAssinatura.map((item) => <option value={item} key={item}>{textoStatus(item)}</option>)}</select></label>
            <label className={styles.campo}><span>Vencimento <small>(opcional)</small></span><input type="date" value={dados.vencimentoAssinatura} onChange={(e) => alterar('vencimentoAssinatura', e.target.value)} /></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Identidade visual</legend>
          <div className={styles.gridCampos}>
            <label className={styles.campo}><span>Logo <small>(URL ou caminho)</small></span><input maxLength="500" placeholder="/uploads/logo.png" value={dados.logo} onChange={(e) => alterar('logo', e.target.value)} /></label>
            <label className={styles.campo}><span>Banner <small>(URL ou caminho)</small></span><input maxLength="500" placeholder="https://..." value={dados.banner} onChange={(e) => alterar('banner', e.target.value)} /></label>
            <label className={styles.campo}><span>Fonte</span><select value={dados.fonte} onChange={(e) => alterar('fonte', e.target.value)}>{opcoes.fontes.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
          </div>
          <div className={styles.cores}>
            {cores.map(([campo, nome]) => (
              <label className={styles.cor} key={campo}>
                <span>{nome}</span>
                <div><input type="color" value={dados[campo]} onChange={(e) => alterar(campo, e.target.value.toUpperCase())} /><input aria-label={`${nome} hexadecimal`} maxLength="7" pattern="#[0-9A-Fa-f]{6}" value={dados[campo]} onChange={(e) => alterar(campo, e.target.value)} /></div>
              </label>
            ))}
          </div>
          <div className={styles.previa} style={{ background: dados.corFundo, color: dados.corTexto, fontFamily: dados.fonte }}>
            <span style={{ background: dados.corPrincipal, color: dados.corSecundaria }}>PRÉVIA</span>
            <div style={{ background: dados.corCard, borderColor: dados.corPrincipal }}><strong>{dados.nomeFantasia || 'Novo estabelecimento'}</strong><small>Identidade visual isolada por tenant</small></div>
          </div>
        </fieldset>

        {!editando && (
          <fieldset>
            <legend>Primeiro administrador da loja</legend>
            <p className={styles.ajuda}>Essa conta será criada junto do estabelecimento e ficará limitada a ele.</p>
            <div className={styles.gridCampos}>
              <label className={styles.campo}><span>Nome</span><input required maxLength="160" value={dados.primeiroAdministrador.nome} onChange={(e) => alterarAdministrador('nome', e.target.value)} /></label>
              <label className={styles.campo}><span>Usuário</span><input required minLength="3" maxLength="80" pattern="[a-z0-9._-]+" value={dados.primeiroAdministrador.usuario} onChange={(e) => alterarAdministrador('usuario', e.target.value.toLowerCase())} /></label>
              <label className={styles.campo}><span>E-mail</span><input required type="email" maxLength="160" value={dados.primeiroAdministrador.email} onChange={(e) => alterarAdministrador('email', e.target.value)} /></label>
              <label className={styles.campo}><span>Senha inicial</span><input required type="password" minLength="12" autoComplete="new-password" value={dados.primeiroAdministrador.senha} onChange={(e) => alterarAdministrador('senha', e.target.value)} /></label>
              <label className={styles.campo}><span>Confirmar senha</span><input required type="password" minLength="12" autoComplete="new-password" value={dados.primeiroAdministrador.confirmacaoSenha} onChange={(e) => alterarAdministrador('confirmacaoSenha', e.target.value)} /></label>
            </div>
          </fieldset>
        )}

        {erro && <div className={styles.erro} role="alert">{erro}</div>}
        <div className={styles.acoesFormulario}>
          <button type="button" className={styles.botaoSecundario} onClick={onCancelar}>Cancelar</button>
          <button type="submit" className={styles.botaoPrimario} disabled={processando}>{processando ? 'Salvando...' : editando ? 'Salvar alterações' : 'Criar estabelecimento'}</button>
        </div>
      </form>
    </section>
  );
}

const TAMANHO_MINIMO_SENHA = 12;

function ResetSenhaAdministrador({ estabelecimento, onCancelar, onConcluir }) {
  const { carregarAdministradoresDoEstabelecimento, redefinirSenhaAdministrador } = useSuperadmin();
  const [administradores, setAdministradores] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [dados, setDados] = useState({ idAdministrador: '', novaSenha: '', confirmacaoSenha: '' });
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);

  useEffect(() => {
    let ativo = true;
    carregarAdministradoresDoEstabelecimento(estabelecimento.id)
      .then((lista) => {
        if (!ativo) return;
        setAdministradores(lista);
        setDados((atuais) => ({
          ...atuais,
          idAdministrador: lista[0] ? String(lista[0].id) : ''
        }));
      })
      .catch((falha) => {
        if (ativo) setErro(falha.message || 'Não foi possível carregar os administradores.');
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => { ativo = false; };
  }, [estabelecimento.id, carregarAdministradoresDoEstabelecimento]);

  function alterar(campo, valor) {
    setDados((atuais) => ({ ...atuais, [campo]: valor }));
  }

  async function enviar(evento) {
    evento.preventDefault();
    setErro('');
    if (!dados.idAdministrador) {
      setErro('Selecione o administrador que terá a senha redefinida.');
      return;
    }
    if (dados.novaSenha.length < TAMANHO_MINIMO_SENHA) {
      setErro(`A nova senha deve ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
      return;
    }
    if (dados.novaSenha !== dados.confirmacaoSenha) {
      setErro('A confirmação da nova senha não confere.');
      return;
    }
    setProcessando(true);
    try {
      const administrador = await redefinirSenhaAdministrador(
        estabelecimento.id,
        dados.idAdministrador,
        { novaSenha: dados.novaSenha, confirmacaoSenha: dados.confirmacaoSenha }
      );
      onConcluir(administrador);
    } catch (falha) {
      setErro(falha.message || 'Não foi possível redefinir a senha.');
    } finally {
      setProcessando(false);
    }
  }

  return (
    <section className={styles.formularioCard} aria-labelledby="titulo-reset-senha">
      <div className={styles.formularioTopo}>
        <div>
          <span>RESET DE SENHA</span>
          <h2 id="titulo-reset-senha">Administradores de {estabelecimento.nomeFantasia}</h2>
          <p>A senha vale só para este estabelecimento e derruba as sessões abertas do administrador.</p>
        </div>
        <button type="button" className={styles.fechar} aria-label="Fechar" onClick={onCancelar}>
          <X size={20} />
        </button>
      </div>

      {erro && <div className={styles.erro} role="alert">{erro}</div>}

      {carregando ? (
        <p className={styles.ajuda}>Carregando administradores...</p>
      ) : administradores.length === 0 ? (
        <p className={styles.ajuda}>Este estabelecimento não possui administradores cadastrados.</p>
      ) : (
        <form className={styles.formulario} onSubmit={enviar}>
          <div className={styles.gridCampos}>
            <label className={styles.campo}>
              <span>Administrador</span>
              <select
                value={dados.idAdministrador}
                required
                onChange={(e) => alterar('idAdministrador', e.target.value)}
              >
                {administradores.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nome} ({item.usuario}){item.ativo ? '' : ' — inativo'}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.campo}>
              <span>Nova senha</span>
              <input
                required
                type="password"
                minLength={TAMANHO_MINIMO_SENHA}
                autoComplete="new-password"
                value={dados.novaSenha}
                onChange={(e) => alterar('novaSenha', e.target.value)}
              />
              <small>Mínimo de {TAMANHO_MINIMO_SENHA} caracteres.</small>
            </label>
            <label className={styles.campo}>
              <span>Confirmar nova senha</span>
              <input
                required
                type="password"
                minLength={TAMANHO_MINIMO_SENHA}
                autoComplete="new-password"
                value={dados.confirmacaoSenha}
                onChange={(e) => alterar('confirmacaoSenha', e.target.value)}
              />
            </label>
          </div>
          <div className={styles.acoesFormulario}>
            <button type="button" className={styles.botaoSecundario} onClick={onCancelar}>
              Cancelar
            </button>
            <button type="submit" className={styles.botaoPrimario} disabled={processando}>
              <KeyRound size={17} />
              {processando ? 'Redefinindo...' : 'Redefinir senha'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function EstabelecimentosSuperadmin() {
  const {
    estabelecimentos,
    opcoes,
    dadosCarregando,
    carregarEstabelecimentos,
    criarEstabelecimento,
    atualizarEstabelecimento,
    suspenderEstabelecimento,
    reativarEstabelecimento,
    arquivarEstabelecimento,
    desarquivarEstabelecimento
  } = useSuperadmin();
  const [filtros, setFiltros] = useState({ busca: '', status: '', plano: '', statusAssinatura: '', incluirArquivados: false });
  const [formulario, setFormulario] = useState(null);
  const [resetSenha, setResetSenha] = useState(null);
  const [cicloDeVida, setCicloDeVida] = useState(null);
  const [processando, setProcessando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');

  const metricas = useMemo(() => ({
    total: estabelecimentos.length,
    ativos: estabelecimentos.filter((item) => item.status === 'ativo').length,
    regulares: estabelecimentos.filter((item) => item.statusAssinatura === 'ativa').length,
    atencao: estabelecimentos.filter((item) => item.status !== 'ativo' || item.statusAssinatura !== 'ativa').length
  }), [estabelecimentos]);

  function abrirNovo() {
    setMensagem('');
    setErro('');
    setFormulario({ editando: false, dados: formularioVazio() });
  }

  function abrirEdicao(estabelecimento) {
    setMensagem('');
    setErro('');
    setFormulario({
      editando: true,
      dados: {
        ...formularioVazio(),
        ...estabelecimento,
        vencimentoAssinatura: dataFormulario(estabelecimento.vencimentoAssinatura)
      }
    });
  }

  function abrirResetSenha(estabelecimento) {
    setMensagem('');
    setErro('');
    setFormulario(null);
    setResetSenha(estabelecimento);
  }

  function concluirResetSenha(administrador) {
    setResetSenha(null);
    setErro('');
    setMensagem(`Senha do administrador "${administrador.usuario}" redefinida. As sessões dele foram encerradas.`);
  }

  async function filtrar(evento) {
    evento.preventDefault();
    setErro('');
    try {
      const { incluirArquivados, ...demais } = filtros;
      await carregarEstabelecimentos(incluirArquivados ? { ...demais, incluirArquivados: '1' } : demais);
    } catch (falha) {
      setErro(falha.message);
    }
  }

  async function salvar(dados) {
    setProcessando(true);
    setErro('');
    try {
      if (formulario.editando) await atualizarEstabelecimento(formulario.dados.id, dados);
      else await criarEstabelecimento(dados);
      setMensagem(formulario.editando ? 'Estabelecimento atualizado com sucesso.' : 'Estabelecimento e primeiro administrador criados com sucesso.');
      setFormulario(null);
    } finally {
      setProcessando(false);
    }
  }

  function abrirCicloDeVida(acao, estabelecimento) {
    setMensagem('');
    setErro('');
    setCicloDeVida({ acao, estabelecimento });
  }

  const fecharCicloDeVida = useCallback(() => setCicloDeVida(null), []);

  // Erro dentro do modal: o modal continua aberto e mostra a mensagem.
  async function confirmarCicloDeVida(valor) {
    const { acao, estabelecimento } = cicloDeVida;
    setProcessando(true);
    try {
      if (acao === 'suspender') {
        await suspenderEstabelecimento(estabelecimento.id, valor);
        setMensagem(`${estabelecimento.nomeFantasia} foi suspenso. As sessões abertas da loja foram encerradas.`);
      } else {
        await arquivarEstabelecimento(estabelecimento.id, valor);
        setMensagem(`${estabelecimento.nomeFantasia} foi arquivado. Marque "Incluir arquivados" para vê-lo na lista.`);
      }
      setCicloDeVida(null);
    } finally {
      setProcessando(false);
    }
  }

  // Reativar e desarquivar não tiram ninguém do ar: rodam direto, sem modal.
  async function aplicarSemConfirmacao(acao, estabelecimento) {
    setMensagem('');
    setErro('');
    setProcessando(true);
    try {
      if (acao === 'reativar') {
        await reativarEstabelecimento(estabelecimento.id);
        setMensagem(`${estabelecimento.nomeFantasia} foi reativado. Administradores e garçons precisam entrar de novo.`);
      } else {
        await desarquivarEstabelecimento(estabelecimento.id);
        setMensagem(`${estabelecimento.nomeFantasia} foi desarquivado e voltou como suspenso.`);
      }
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  function acoesDoEstabelecimento(item) {
    const nome = item.nomeFantasia;
    return (
      <div className={styles.acoes}>
        {item.status !== 'arquivado' && (
          <button type="button" aria-label={`Editar ${nome}`} title="Editar" onClick={() => abrirEdicao(item)}><Edit3 size={17} /></button>
        )}
        {item.status === 'ativo' && (
          <button type="button" className={styles.acaoPerigo} disabled={processando} aria-label={`Suspender ${nome}`} title="Suspender" onClick={() => abrirCicloDeVida('suspender', item)}><CirclePause size={17} /></button>
        )}
        {item.status === 'suspenso' && (
          <>
            <button type="button" disabled={processando} aria-label={`Reativar ${nome}`} title="Reativar" onClick={() => aplicarSemConfirmacao('reativar', item)}><CirclePlay size={17} /></button>
            <button type="button" className={styles.acaoPerigo} disabled={processando} aria-label={`Arquivar ${nome}`} title="Arquivar" onClick={() => abrirCicloDeVida('arquivar', item)}><Archive size={17} /></button>
          </>
        )}
        {item.status === 'arquivado' && (
          <button type="button" disabled={processando} aria-label={`Desarquivar ${nome}`} title="Desarquivar" onClick={() => aplicarSemConfirmacao('desarquivar', item)}><ArchiveRestore size={17} /></button>
        )}
        {item.status !== 'arquivado' && (
          <button type="button" aria-label={`Resetar senha de administrador de ${nome}`} title="Resetar senha de administrador" onClick={() => abrirResetSenha(item)}><KeyRound size={17} /></button>
        )}
      </div>
    );
  }

  function situacaoDoEstabelecimento(item) {
    return (
      <>
        <span className={`${styles.status} ${CLASSE_STATUS[item.status] ?? styles.atencao}`}>{textoStatus(item.status)}</span>
        {item.status === 'suspenso' && (
          <small className={styles.motivo} title={item.motivoSuspensao || undefined}>
            {item.motivoSuspensao || 'Motivo não informado'}
            {item.suspensoEm ? ` • desde ${dataCurta(item.suspensoEm)}` : ''}
          </small>
        )}
        {item.status === 'arquivado' && item.arquivadoEm && (
          <small className={styles.motivo}>Arquivado em {dataCurta(item.arquivadoEm)}</small>
        )}
      </>
    );
  }

  return (
    <SuperadminLayout
      titulo="Estabelecimentos"
      subtitulo="Cadastre tenants e controle manualmente acesso, plano, assinatura, domínio e identidade visual."
      acao={<button type="button" className={styles.botaoPrimario} onClick={abrirNovo}><Plus size={18} /> Novo estabelecimento</button>}
    >
      <section className={styles.metricas} aria-label="Resumo dos estabelecimentos filtrados">
        <article><span><Building2 size={21} /></span><div><small>Encontrados</small><strong>{metricas.total}</strong></div></article>
        <article><span><CheckCircle2 size={21} /></span><div><small>Operação ativa</small><strong>{metricas.ativos}</strong></div></article>
        <article><span><CircleDollarSign size={21} /></span><div><small>Assinaturas ativas</small><strong>{metricas.regulares}</strong></div></article>
        <article><span><ShieldAlert size={21} /></span><div><small>Exigem atenção</small><strong>{metricas.atencao}</strong></div></article>
      </section>

      {formulario && (
        <FormularioEstabelecimento
          key={formulario.editando ? formulario.dados.id : 'novo'}
          inicial={formulario.dados}
          editando={formulario.editando}
          opcoes={opcoes}
          processando={processando}
          onCancelar={() => setFormulario(null)}
          onSalvar={salvar}
        />
      )}

      {resetSenha && (
        <ResetSenhaAdministrador
          key={resetSenha.id}
          estabelecimento={resetSenha}
          onCancelar={() => setResetSenha(null)}
          onConcluir={concluirResetSenha}
        />
      )}

      {cicloDeVida && (
        <ModalCicloDeVida
          key={`${cicloDeVida.acao}-${cicloDeVida.estabelecimento.id}`}
          acao={cicloDeVida.acao}
          estabelecimento={cicloDeVida.estabelecimento}
          processando={processando}
          onCancelar={fecharCicloDeVida}
          onConfirmar={confirmarCicloDeVida}
        />
      )}

      {mensagem && <div className={styles.sucesso} role="status">{mensagem}</div>}
      {erro && <div className={styles.erro} role="alert">{erro}</div>}

      <section className={styles.listaCard}>
        <div className={styles.listaTopo}>
          <div><h2>Tenants cadastrados</h2><p>A busca consulta no máximo 200 registros por vez. Arquivados só aparecem filtrando por eles.</p></div>
        </div>
        <form className={styles.filtros} onSubmit={filtrar}>
          <label className={styles.busca}>
            <span className={styles.srOnly}>Buscar</span><Search size={18} />
            <input value={filtros.busca} onChange={(e) => setFiltros((atuais) => ({ ...atuais, busca: e.target.value }))} placeholder="Nome, slug ou domínio" />
          </label>
          <select aria-label="Filtrar por status" value={filtros.status} onChange={(e) => setFiltros((atuais) => ({ ...atuais, status: e.target.value }))}><option value="">Todos os status</option>{opcoes.statusEstabelecimento.map((item) => <option key={item} value={item}>{textoStatus(item)}</option>)}</select>
          <select aria-label="Filtrar por plano" value={filtros.plano} onChange={(e) => setFiltros((atuais) => ({ ...atuais, plano: e.target.value }))}><option value="">Todos os planos</option>{opcoes.planos.map((item) => <option key={item} value={item}>{textoStatus(item)}</option>)}</select>
          <select aria-label="Filtrar por assinatura" value={filtros.statusAssinatura} onChange={(e) => setFiltros((atuais) => ({ ...atuais, statusAssinatura: e.target.value }))}><option value="">Todas as assinaturas</option>{opcoes.statusAssinatura.map((item) => <option key={item} value={item}>{textoStatus(item)}</option>)}</select>
          <label className={styles.incluirArquivados}><input type="checkbox" checked={filtros.incluirArquivados} onChange={(e) => setFiltros((atuais) => ({ ...atuais, incluirArquivados: e.target.checked }))} /> Incluir arquivados</label>
          <button className={styles.botaoSecundario} type="submit" disabled={dadosCarregando}>{dadosCarregando ? 'Buscando...' : 'Filtrar'}</button>
        </form>

        <div className={styles.tabelaContainer}>
          <table>
            <thead><tr><th>Estabelecimento</th><th>Acesso</th><th>Plano</th><th>Assinatura</th><th>Administradores</th><th>Ações</th></tr></thead>
            <tbody>
              {estabelecimentos.map((item) => (
                <tr key={item.id}>
                  <td data-rotulo="Estabelecimento"><strong>{item.nomeFantasia}</strong><small>/{item.slug}{item.dominioPersonalizado ? ` • ${item.dominioPersonalizado}` : ''}</small></td>
                  <td data-rotulo="Acesso">{situacaoDoEstabelecimento(item)}</td>
                  <td data-rotulo="Plano"><span className={styles.plano}>{textoStatus(item.plano)}</span></td>
                  <td data-rotulo="Assinatura"><span className={`${styles.status} ${item.statusAssinatura === 'ativa' ? styles.ativo : styles.atencao}`}>{textoStatus(item.statusAssinatura)}</span><small className={styles.vencimento}><CalendarClock size={12} /> {dataCurta(item.vencimentoAssinatura)}</small></td>
                  <td data-rotulo="Administradores">{item.totalAdministradores}</td>
                  <td data-rotulo="Ações">{acoesDoEstabelecimento(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!dadosCarregando && estabelecimentos.length === 0 && <div className={styles.vazio}><Building2 size={26} /><strong>Nenhum estabelecimento encontrado</strong><span>Ajuste os filtros ou cadastre o primeiro tenant.</span></div>}
        </div>
      </section>
    </SuperadminLayout>
  );
}

export default EstabelecimentosSuperadmin;
