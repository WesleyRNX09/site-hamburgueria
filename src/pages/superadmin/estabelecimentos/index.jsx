import {
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Edit3,
  Plus,
  Power,
  Search,
  ShieldAlert,
  X
} from 'lucide-react';
import { useMemo, useState } from 'react';

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
    status: 'ativo',
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
          <p>Plano e assinatura são controlados manualmente nesta etapa.</p>
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
            <label className={styles.campo}><span>Status operacional</span><select value={dados.status} onChange={(e) => alterar('status', e.target.value)}>{opcoes.statusEstabelecimento.map((item) => <option value={item} key={item}>{textoStatus(item)}</option>)}</select></label>
          </div>
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

function EstabelecimentosSuperadmin() {
  const {
    estabelecimentos,
    opcoes,
    dadosCarregando,
    carregarEstabelecimentos,
    criarEstabelecimento,
    atualizarEstabelecimento
  } = useSuperadmin();
  const [filtros, setFiltros] = useState({ busca: '', status: '', plano: '', statusAssinatura: '' });
  const [formulario, setFormulario] = useState(null);
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

  async function filtrar(evento) {
    evento.preventDefault();
    setErro('');
    try {
      await carregarEstabelecimentos(filtros);
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

  async function alternarStatus(estabelecimento) {
    setMensagem('');
    setErro('');
    setProcessando(true);
    try {
      const status = estabelecimento.status === 'ativo' ? 'inativo' : 'ativo';
      await atualizarEstabelecimento(estabelecimento.id, { ...estabelecimento, status });
      setMensagem(`${estabelecimento.nomeFantasia} agora está ${status}.`);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
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

      {mensagem && <div className={styles.sucesso} role="status">{mensagem}</div>}
      {erro && <div className={styles.erro} role="alert">{erro}</div>}

      <section className={styles.listaCard}>
        <div className={styles.listaTopo}>
          <div><h2>Tenants cadastrados</h2><p>A busca consulta no máximo 200 registros por vez.</p></div>
        </div>
        <form className={styles.filtros} onSubmit={filtrar}>
          <label className={styles.busca}>
            <span className={styles.srOnly}>Buscar</span><Search size={18} />
            <input value={filtros.busca} onChange={(e) => setFiltros((atuais) => ({ ...atuais, busca: e.target.value }))} placeholder="Nome, slug ou domínio" />
          </label>
          <select aria-label="Filtrar por status" value={filtros.status} onChange={(e) => setFiltros((atuais) => ({ ...atuais, status: e.target.value }))}><option value="">Todos os status</option>{opcoes.statusEstabelecimento.map((item) => <option key={item} value={item}>{textoStatus(item)}</option>)}</select>
          <select aria-label="Filtrar por plano" value={filtros.plano} onChange={(e) => setFiltros((atuais) => ({ ...atuais, plano: e.target.value }))}><option value="">Todos os planos</option>{opcoes.planos.map((item) => <option key={item} value={item}>{textoStatus(item)}</option>)}</select>
          <select aria-label="Filtrar por assinatura" value={filtros.statusAssinatura} onChange={(e) => setFiltros((atuais) => ({ ...atuais, statusAssinatura: e.target.value }))}><option value="">Todas as assinaturas</option>{opcoes.statusAssinatura.map((item) => <option key={item} value={item}>{textoStatus(item)}</option>)}</select>
          <button className={styles.botaoSecundario} type="submit" disabled={dadosCarregando}>{dadosCarregando ? 'Buscando...' : 'Filtrar'}</button>
        </form>

        <div className={styles.tabelaContainer}>
          <table>
            <thead><tr><th>Estabelecimento</th><th>Acesso</th><th>Plano</th><th>Assinatura</th><th>Administradores</th><th>Ações</th></tr></thead>
            <tbody>
              {estabelecimentos.map((item) => (
                <tr key={item.id}>
                  <td data-rotulo="Estabelecimento"><strong>{item.nomeFantasia}</strong><small>/{item.slug}{item.dominioPersonalizado ? ` • ${item.dominioPersonalizado}` : ''}</small></td>
                  <td data-rotulo="Acesso"><span className={`${styles.status} ${item.status === 'ativo' ? styles.ativo : styles.inativo}`}>{textoStatus(item.status)}</span></td>
                  <td data-rotulo="Plano"><span className={styles.plano}>{textoStatus(item.plano)}</span></td>
                  <td data-rotulo="Assinatura"><span className={`${styles.status} ${item.statusAssinatura === 'ativa' ? styles.ativo : styles.atencao}`}>{textoStatus(item.statusAssinatura)}</span><small className={styles.vencimento}><CalendarClock size={12} /> {dataCurta(item.vencimentoAssinatura)}</small></td>
                  <td data-rotulo="Administradores">{item.totalAdministradores}</td>
                  <td data-rotulo="Ações"><div className={styles.acoes}><button type="button" aria-label={`Editar ${item.nomeFantasia}`} title="Editar" onClick={() => abrirEdicao(item)}><Edit3 size={17} /></button><button type="button" disabled={processando} aria-label={`${item.status === 'ativo' ? 'Desativar' : 'Ativar'} ${item.nomeFantasia}`} title={item.status === 'ativo' ? 'Desativar' : 'Ativar'} onClick={() => alternarStatus(item)}><Power size={17} /></button></div></td>
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
