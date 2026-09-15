import { ArrowLeft, Edit3, MapPin, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import AdminLayout from '../../../components/AdminLayout';
import {
  alterarStatusAreaEntregaApi,
  atualizarAreaEntregaApi,
  criarAreaEntregaApi,
  excluirAreaEntregaApi,
  listarAreasEntregaApi
} from '../../../services/api';
import styles from '../shared.module.css';

const vazio = { id: null, nome: '', taxaEntrega: '', tempoEstimadoMin: '', tempoEstimadoMax: '' };

function moeda(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

function tempoEstimado(area) {
  return area.tempoEstimadoMin === area.tempoEstimadoMax
    ? `${area.tempoEstimadoMin} min`
    : `${area.tempoEstimadoMin}–${area.tempoEstimadoMax} min`;
}

function ordenar(areas) {
  return [...areas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/* Só orienta quem preenche: o servidor valida tudo de novo. */
function erroNoFormulario(dados) {
  if (!dados.nome.trim()) return 'Informe o nome da área de entrega.';
  if (!/^\d+([.,]\d{1,2})?$/.test(String(dados.taxaEntrega).trim())) return 'Informe a taxa de entrega, por exemplo 5,00.';
  const minimo = Number(dados.tempoEstimadoMin);
  const maximo = Number(dados.tempoEstimadoMax);
  if (![minimo, maximo].every((tempo) => Number.isInteger(tempo) && tempo >= 1 && tempo <= 600)) {
    return 'Informe o tempo estimado em minutos inteiros, de 1 a 600.';
  }
  if (maximo < minimo) return 'O tempo máximo não pode ser menor que o mínimo.';
  return '';
}

function AreasEntregaAdmin() {
  const navigate = useNavigate();
  const [areas, setAreas] = useState([]);
  const [carregamento, setCarregamento] = useState({ tentativa: 0, concluida: -1, erro: '' });
  const [dados, setDados] = useState(vazio);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [processando, setProcessando] = useState(false);
  const [processandoId, setProcessandoId] = useState(null);

  useEffect(() => {
    let ativo = true;
    const { tentativa } = carregamento;
    listarAreasEntregaApi()
      .then(({ areasEntrega }) => {
        if (!ativo) return;
        setAreas(ordenar(areasEntrega ?? []));
        setCarregamento({ tentativa, concluida: tentativa, erro: '' });
      })
      .catch((falha) => {
        if (ativo) setCarregamento({ tentativa, concluida: tentativa, erro: falha.message });
      });
    return () => { ativo = false; };
    // Recarrega só quando uma nova tentativa é pedida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregamento.tentativa]);

  const carregando = carregamento.concluida !== carregamento.tentativa;
  const ativas = areas.filter((area) => area.ativo).length;
  const filtradas = useMemo(() => areas.filter((area) =>
    area.nome.toLowerCase().includes(busca.trim().toLowerCase())), [areas, busca]);

  function alterar(campo, valor) {
    setDados((atuais) => ({ ...atuais, [campo]: valor }));
  }

  function editar(area) {
    setDados({
      id: area.id,
      nome: area.nome,
      taxaEntrega: area.taxaEntrega.toFixed(2).replace('.', ','),
      tempoEstimadoMin: String(area.tempoEstimadoMin),
      tempoEstimadoMax: String(area.tempoEstimadoMax)
    });
    setErro('');
    setSucesso('');
  }

  function cancelar() {
    setDados(vazio);
    setErro('');
  }

  function substituir(areaAtualizada) {
    setAreas((atuais) => ordenar(atuais.map((area) => (area.id === areaAtualizada.id ? areaAtualizada : area))));
  }

  async function enviar(event) {
    event.preventDefault();
    if (processando) return;
    const problema = erroNoFormulario(dados);
    setSucesso('');
    if (problema) {
      setErro(problema);
      return;
    }
    const campos = {
      nome: dados.nome.trim(),
      taxaEntrega: String(dados.taxaEntrega).trim(),
      tempoEstimadoMin: Number(dados.tempoEstimadoMin),
      tempoEstimadoMax: Number(dados.tempoEstimadoMax)
    };
    setProcessando(true);
    setErro('');
    try {
      if (dados.id) {
        const { areaEntrega } = await atualizarAreaEntregaApi(dados.id, campos);
        substituir(areaEntrega);
        setSucesso(`Área ${areaEntrega.nome} atualizada.`);
      } else {
        const { areaEntrega } = await criarAreaEntregaApi(campos);
        setAreas((atuais) => ordenar([...atuais, areaEntrega]));
        setSucesso(`Área ${areaEntrega.nome} cadastrada.`);
      }
      setDados(vazio);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  async function mudarStatus(area) {
    setProcessandoId(area.id);
    setErro('');
    setSucesso('');
    try {
      const { areaEntrega } = await alterarStatusAreaEntregaApi(area.id, !area.ativo);
      substituir(areaEntrega);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessandoId(null);
    }
  }

  async function excluir(area) {
    if (!window.confirm(`Excluir a área ${area.nome}? Área que já recebeu pedidos não pode ser excluída, só desativada.`)) return;
    setProcessandoId(area.id);
    setErro('');
    setSucesso('');
    try {
      await excluirAreaEntregaApi(area.id);
      setAreas((atuais) => atuais.filter((item) => item.id !== area.id));
      if (dados.id === area.id) setDados(vazio);
      setSucesso(`Área ${area.nome} excluída.`);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessandoId(null);
    }
  }

  const acao = <button type="button" className={styles.botaoSecundario} onClick={() => navigate('/admin/configuracoes')}><ArrowLeft size={17} /> Configurações</button>;

  return (
    <AdminLayout titulo="Áreas de entrega" subtitulo="Bairros ou regiões atendidos pelo delivery, cada um com taxa e tempo estimado." acao={acao}>
      <div className={`${styles.aviso} ${styles.secaoComMargemInferior}`}>
        Sem nenhuma área cadastrada, o checkout usa a taxa única das Configurações. Com áreas cadastradas, o cliente escolhe uma área ativa; se todas estiverem desativadas, o delivery fica indisponível.
      </div>
      <div className={styles.gradeDuasColunas}>
        <section className={styles.card} aria-busy={carregando}>
          <div className={styles.topoCard}>
            <div><h2>Áreas cadastradas</h2><p>{areas.length} {areas.length === 1 ? 'área' : 'áreas'} • {ativas} {ativas === 1 ? 'ativa' : 'ativas'}</p></div>
          </div>
          <label className={styles.busca}><Search size={17} /><input aria-label="Buscar áreas de entrega" value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar área..." /></label>
          {carregando ? (
            <div className={styles.vazio} role="status"><p>Carregando áreas de entrega…</p></div>
          ) : carregamento.erro ? (
            <div className={styles.vazio} role="alert">
              <p className={styles.erro}>{carregamento.erro}</p>
              <button type="button" className={styles.botaoSecundario} onClick={() => setCarregamento((atual) => ({ ...atual, tentativa: atual.tentativa + 1 }))}>Tentar novamente</button>
            </div>
          ) : (
            <div className={styles.listaAdicionaisAdmin}>
              {filtradas.map((area) => (
                <article className={styles.adicionalLinha} key={area.id}>
                  <div>
                    <strong>{area.nome}</strong>
                    <span>Taxa {moeda(area.taxaEntrega)} • {tempoEstimado(area)}</span>
                  </div>
                  <button type="button" disabled={processandoId === area.id} aria-label={`${area.ativo ? 'Desativar' : 'Ativar'} ${area.nome}`} className={`${styles.status} ${area.ativo ? styles.statusAtivo : styles.statusInativo}`} onClick={() => mudarStatus(area)}>{processandoId === area.id ? 'Salvando...' : area.ativo ? 'Ativa' : 'Inativa'}</button>
                  <div className={styles.acoes}>
                    <button type="button" className={styles.botaoIcone} aria-label={`Editar ${area.nome}`} onClick={() => editar(area)}><Edit3 size={16} /></button>
                    <button type="button" className={styles.botaoIcone} disabled={processandoId === area.id} aria-label={`Excluir ${area.nome}`} onClick={() => excluir(area)}><Trash2 size={16} /></button>
                  </div>
                </article>
              ))}
              {filtradas.length === 0 && (
                <div className={styles.vazio}>
                  <MapPin size={30} />
                  <h3>{areas.length === 0 ? 'Nenhuma área cadastrada' : 'Nenhuma área encontrada'}</h3>
                  {areas.length === 0 && <p>Enquanto não houver áreas, o delivery usa a taxa única.</p>}
                </div>
              )}
            </div>
          )}
        </section>

        <section className={styles.card}>
          <div className={styles.topoCard}>
            <div><h2>{dados.id ? 'Editar área' : 'Nova área'}</h2><p>Pedidos já feitos mantêm a taxa cobrada na época.</p></div>
          </div>
          <form className={styles.formulario} onSubmit={enviar} noValidate>
            <div className={styles.campo}><label htmlFor="nomeArea">Nome do bairro ou região</label><input id="nomeArea" maxLength="120" value={dados.nome} onChange={(event) => alterar('nome', event.target.value)} placeholder="Ex: Centro" /></div>
            <div className={styles.campo}><label htmlFor="taxaArea">Taxa de entrega (R$)</label><input id="taxaArea" inputMode="decimal" value={dados.taxaEntrega} onChange={(event) => alterar('taxaEntrega', event.target.value)} placeholder="5,00" /></div>
            <div className={styles.gridFormulario}>
              <div className={styles.campo}><label htmlFor="tempoMinimoArea">Tempo mínimo (min)</label><input id="tempoMinimoArea" type="number" min="1" max="600" step="1" inputMode="numeric" value={dados.tempoEstimadoMin} onChange={(event) => alterar('tempoEstimadoMin', event.target.value)} placeholder="30" /></div>
              <div className={styles.campo}><label htmlFor="tempoMaximoArea">Tempo máximo (min)</label><input id="tempoMaximoArea" type="number" min="1" max="600" step="1" inputMode="numeric" value={dados.tempoEstimadoMax} onChange={(event) => alterar('tempoEstimadoMax', event.target.value)} placeholder="45" /></div>
            </div>
            <div aria-live="polite">
              {erro && <div className={styles.erro} role="alert">{erro}</div>}
              {sucesso && <div className={styles.sucesso} role="status">{sucesso}</div>}
            </div>
            <div className={styles.rodapeFormulario}>
              {dados.id && <button type="button" className={styles.botaoSecundario} onClick={cancelar}><X size={16} /> Cancelar</button>}
              <button type="submit" className={styles.botaoPrimario} disabled={processando}>{dados.id ? <Save size={17} /> : <Plus size={17} />} {processando ? 'Salvando...' : dados.id ? 'Salvar alteração' : 'Cadastrar área'}</button>
            </div>
          </form>
        </section>
      </div>
    </AdminLayout>
  );
}

export default AreasEntregaAdmin;
