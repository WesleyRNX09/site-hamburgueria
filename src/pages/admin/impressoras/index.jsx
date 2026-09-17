import { ArrowLeft, Copy, Edit3, KeyRound, Plus, Printer, Save, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import AdminLayout from '../../../components/AdminLayout';
import {
  alterarStatusImpressoraApi,
  atualizarImpressoraApi,
  criarDispositivoImpressaoApi,
  criarImpressoraApi,
  listarImpressorasApi,
  revogarDispositivoImpressaoApi
} from '../../../services/api';
import styles from '../shared.module.css';

const vazio = { id: null, nome: '', host: '', porta: '9100', ehCaixa: false };

function ordenar(impressoras) {
  return [...impressoras].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/*
  Encaixa a impressora salva na lista da tela, criada ou atualizada.

  Quando ela vira a do caixa, o servidor desmarca a anterior na mesma
  transação; a lista precisa acompanhar, senão duas apareceriam marcadas até
  alguém recarregar a página.
*/
function aplicarNaLista(atuais, salva) {
  const demais = atuais.filter((impressora) => impressora.id !== salva.id);
  return ordenar([
    ...(salva.ehCaixa
      ? demais.map((impressora) => (impressora.ehCaixa ? { ...impressora, ehCaixa: false } : impressora))
      : demais),
    salva
  ]);
}

/* Só orienta quem preenche: o servidor valida tudo de novo. */
function erroNoFormulario(dados) {
  if (!dados.nome.trim()) return 'Informe o nome da impressora.';
  const host = dados.host.trim();
  if (!host) return 'Informe o endereço (IP ou nome de rede) da impressora.';
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)) {
    return 'Informe apenas o IP ou o nome de rede, sem "http://", porta, barra ou espaços.';
  }
  const porta = Number(String(dados.porta).trim());
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    return 'Informe uma porta entre 1 e 65535. A padrão das impressoras de rede é 9100.';
  }
  return '';
}

function ImpressorasAdmin() {
  const navigate = useNavigate();
  const [impressoras, setImpressoras] = useState([]);
  const [dispositivos, setDispositivos] = useState([]);
  const [carregamento, setCarregamento] = useState({ tentativa: 0, concluida: -1, erro: '' });
  const [dados, setDados] = useState(vazio);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [processando, setProcessando] = useState(false);
  const [processandoId, setProcessandoId] = useState(null);
  const [nomeDispositivo, setNomeDispositivo] = useState('');
  const [gerandoToken, setGerandoToken] = useState(false);
  // Token recém-gerado: só existe nesta tela, até o administrador sair dela.
  const [tokenNovo, setTokenNovo] = useState(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let ativo = true;
    const { tentativa } = carregamento;
    listarImpressorasApi()
      .then((resposta) => {
        if (!ativo) return;
        setImpressoras(ordenar(resposta.impressoras ?? []));
        setDispositivos(resposta.dispositivos ?? []);
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
  const ativas = impressoras.filter((impressora) => impressora.ativa).length;
  // No máximo uma, garantido pelo servidor; aqui só é lida para orientar.
  const caixaAtual = impressoras.find((impressora) => impressora.ehCaixa) ?? null;
  const filtradas = useMemo(() => impressoras.filter((impressora) =>
    impressora.nome.toLowerCase().includes(busca.trim().toLowerCase())
    || impressora.host.toLowerCase().includes(busca.trim().toLowerCase())), [impressoras, busca]);
  const dispositivosAtivos = dispositivos.filter((dispositivo) => dispositivo.ativo);

  function alterar(campo, valor) {
    setDados((atuais) => ({ ...atuais, [campo]: valor }));
  }

  function editar(impressora) {
    setDados({
      id: impressora.id,
      nome: impressora.nome,
      host: impressora.host,
      porta: String(impressora.porta),
      ehCaixa: Boolean(impressora.ehCaixa)
    });
    setErro('');
    setSucesso('');
  }

  function substituir(atualizada) {
    setImpressoras((atuais) => ordenar(atuais.map((impressora) => (
      impressora.id === atualizada.id ? atualizada : impressora
    ))));
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
      host: dados.host.trim(),
      porta: Number(String(dados.porta).trim()),
      ehCaixa: dados.ehCaixa
    };
    // Quem era o caixa antes, para avisar que a marcação trocou de dono.
    const caixaAnterior = impressoras.find((impressora) => impressora.ehCaixa) ?? null;
    setProcessando(true);
    setErro('');
    try {
      const { impressora } = dados.id
        ? await atualizarImpressoraApi(dados.id, campos)
        : await criarImpressoraApi(campos);
      setImpressoras((atuais) => aplicarNaLista(atuais, impressora));
      const trocouOCaixa = impressora.ehCaixa
        && caixaAnterior !== null
        && caixaAnterior.id !== impressora.id;
      setSucesso(
        `Impressora ${impressora.nome} ${dados.id ? 'atualizada' : 'cadastrada'}.`
        + (impressora.ehCaixa ? ' Agora é a impressora do caixa.' : '')
        + (trocouOCaixa ? ` ${caixaAnterior.nome} deixou de ser.` : '')
      );
      setDados(vazio);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  async function mudarStatus(impressora) {
    setProcessandoId(impressora.id);
    setErro('');
    setSucesso('');
    try {
      const resposta = await alterarStatusImpressoraApi(impressora.id, !impressora.ativa);
      substituir(resposta.impressora);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessandoId(null);
    }
  }

  async function gerarDispositivo(event) {
    event.preventDefault();
    if (gerandoToken) return;
    if (!nomeDispositivo.trim()) {
      setErro('Dê um nome ao dispositivo, como "PC da cozinha".');
      return;
    }
    setGerandoToken(true);
    setErro('');
    setSucesso('');
    setCopiado(false);
    try {
      const resposta = await criarDispositivoImpressaoApi({ nome: nomeDispositivo.trim() });
      setDispositivos((atuais) => [...atuais, resposta.dispositivo]);
      setTokenNovo({ nome: resposta.dispositivo.nome, token: resposta.token });
      setNomeDispositivo('');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setGerandoToken(false);
    }
  }

  async function revogar(dispositivo) {
    if (!window.confirm(`Revogar o acesso de ${dispositivo.nome}? O agente instalado nele para de imprimir na hora.`)) return;
    setProcessandoId(`dispositivo-${dispositivo.id}`);
    setErro('');
    setSucesso('');
    try {
      await revogarDispositivoImpressaoApi(dispositivo.id);
      setDispositivos((atuais) => atuais.map((item) => (
        item.id === dispositivo.id ? { ...item, ativo: false, revogadoEm: new Date().toISOString() } : item
      )));
      if (tokenNovo?.nome === dispositivo.nome) setTokenNovo(null);
      setSucesso(`Acesso de ${dispositivo.nome} revogado.`);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessandoId(null);
    }
  }

  async function copiarToken() {
    try {
      await navigator.clipboard.writeText(tokenNovo.token);
      setCopiado(true);
    } catch {
      setErro('Não foi possível copiar. Selecione o código e copie manualmente.');
    }
  }

  const acao = (
    <button type="button" className={styles.botaoSecundario} onClick={() => navigate('/admin/configuracoes')}>
      <ArrowLeft size={17} /> Configurações
    </button>
  );

  return (
    <AdminLayout
      titulo="Impressoras"
      subtitulo="Cadastre as impressoras da cozinha e do balcão e pareie o computador que imprime."
      acao={acao}
    >
      <div className={`${styles.aviso} ${styles.secaoComMargemInferior}`}>
        Cada categoria do cardápio aponta para uma impressora, e um produto pode ter a sua própria como exceção. Produto sem impressora configurada não é impresso — e isso nunca impede o pedido de ser feito nem a comanda de ir para a cozinha.
      </div>

      <div className={styles.gradeDuasColunas}>
        <section className={styles.card} aria-busy={carregando}>
          <div className={styles.topoCard}>
            <div>
              <h2>Impressoras cadastradas</h2>
              <p>
                {impressoras.length} {impressoras.length === 1 ? 'impressora' : 'impressoras'} • {ativas} {ativas === 1 ? 'ativa' : 'ativas'}
                {caixaAtual ? ` • caixa: ${caixaAtual.nome}` : ' • nenhuma marcada como caixa'}
              </p>
            </div>
          </div>
          <label className={styles.busca}>
            <Search size={17} />
            <input aria-label="Buscar impressoras" value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar por nome ou endereço..." />
          </label>
          {carregando ? (
            <div className={styles.vazio} role="status"><p>Carregando impressoras…</p></div>
          ) : carregamento.erro ? (
            <div className={styles.vazio} role="alert">
              <p className={styles.erro}>{carregamento.erro}</p>
              <button type="button" className={styles.botaoSecundario} onClick={() => setCarregamento((atual) => ({ ...atual, tentativa: atual.tentativa + 1 }))}>Tentar novamente</button>
            </div>
          ) : (
            <div className={styles.listaAdicionaisAdmin}>
              {filtradas.map((impressora) => (
                <article className={styles.adicionalLinha} key={impressora.id}>
                  <div>
                    <strong>
                      {impressora.nome}
                      {impressora.ehCaixa && <span className={styles.seloCaixa}>Caixa</span>}
                    </strong>
                    <span>{impressora.host}:{impressora.porta}</span>
                  </div>
                  <button
                    type="button"
                    disabled={processandoId === impressora.id}
                    aria-label={`${impressora.ativa ? 'Desativar' : 'Ativar'} ${impressora.nome}`}
                    className={`${styles.status} ${impressora.ativa ? styles.statusAtivo : styles.statusInativo}`}
                    onClick={() => mudarStatus(impressora)}
                  >
                    {processandoId === impressora.id ? 'Salvando...' : impressora.ativa ? 'Ativa' : 'Inativa'}
                  </button>
                  <div className={styles.acoes}>
                    <button type="button" className={styles.botaoIcone} aria-label={`Editar ${impressora.nome}`} onClick={() => editar(impressora)}><Edit3 size={16} /></button>
                  </div>
                </article>
              ))}
              {filtradas.length === 0 && (
                <div className={styles.vazio}>
                  <Printer size={30} />
                  <h3>{impressoras.length === 0 ? 'Nenhuma impressora cadastrada' : 'Nenhuma impressora encontrada'}</h3>
                  {impressoras.length === 0 && <p>Enquanto não houver impressora, nada é impresso automaticamente.</p>}
                </div>
              )}
            </div>
          )}
        </section>

        <section className={styles.card}>
          <div className={styles.topoCard}>
            <div>
              <h2>{dados.id ? 'Editar impressora' : 'Nova impressora'}</h2>
              <p>Use o IP fixo da impressora na rede da loja. A porta padrão das térmicas de rede é 9100.</p>
            </div>
          </div>
          <form className={styles.formulario} onSubmit={enviar} noValidate>
            <div className={styles.campo}>
              <label htmlFor="nomeImpressora">Nome</label>
              <input id="nomeImpressora" maxLength="120" value={dados.nome} onChange={(event) => alterar('nome', event.target.value)} placeholder="Ex: Cozinha" />
            </div>
            <div className={styles.gridFormulario}>
              <div className={styles.campo}>
                <label htmlFor="hostImpressora">Endereço na rede (IP ou nome)</label>
                <input id="hostImpressora" maxLength="255" value={dados.host} onChange={(event) => alterar('host', event.target.value)} placeholder="192.168.0.50" />
              </div>
              <div className={styles.campo}>
                <label htmlFor="portaImpressora">Porta</label>
                <input id="portaImpressora" type="number" min="1" max="65535" step="1" inputMode="numeric" value={dados.porta} onChange={(event) => alterar('porta', event.target.value)} placeholder="9100" />
              </div>
            </div>
            <label className={`${styles.opcaoCaixa} ${dados.ehCaixa ? styles.opcaoCaixaAtiva : ''}`} htmlFor="ehCaixaImpressora">
              <input
                id="ehCaixaImpressora"
                type="checkbox"
                checked={dados.ehCaixa}
                onChange={(event) => alterar('ehCaixa', event.target.checked)}
              />
              <span>
                <strong>Usar como impressora do caixa</strong>
                <small>
                  {caixaAtual && caixaAtual.id !== dados.id
                    ? `Só uma por loja: marcar esta desmarca ${caixaAtual.nome}.`
                    : 'Só uma por loja: marcar outra depois desmarca esta.'}
                </small>
              </span>
            </label>
            <div aria-live="polite">
              {erro && <div className={styles.erro} role="alert">{erro}</div>}
              {sucesso && <div className={styles.sucesso} role="status">{sucesso}</div>}
            </div>
            <div className={styles.rodapeFormulario}>
              {dados.id && <button type="button" className={styles.botaoSecundario} onClick={() => { setDados(vazio); setErro(''); }}><X size={16} /> Cancelar</button>}
              <button type="submit" className={styles.botaoPrimario} disabled={processando}>
                {dados.id ? <Save size={17} /> : <Plus size={17} />} {processando ? 'Salvando...' : dados.id ? 'Salvar alteração' : 'Cadastrar impressora'}
              </button>
            </div>
          </form>
        </section>
      </div>

      <section className={`${styles.card} ${styles.secaoSeparada}`}>
        <div className={styles.topoCard}>
          <div>
            <h2>Dispositivos de impressão</h2>
            <p>O computador ou Raspberry Pi da loja que roda o agente e envia os recibos às impressoras.</p>
          </div>
          <KeyRound size={30} color="#ffc107" />
        </div>

        {tokenNovo && (
          <div className={styles.aviso}>
            <strong>Token de {tokenNovo.nome}</strong>
            <p>Copie agora e cole no <code>.env</code> do agente. Ele aparece uma única vez: se perder, gere outro dispositivo e revogue este.</p>
            <p className={styles.codigo}>{tokenNovo.token}</p>
            <div className={styles.acoes}>
              <button type="button" className={styles.botaoPrimario} onClick={copiarToken}>
                <Copy size={17} /> {copiado ? 'Token copiado' : 'Copiar token'}
              </button>
              <button type="button" className={styles.botaoSecundario} onClick={() => setTokenNovo(null)}>
                <X size={17} /> Já guardei
              </button>
            </div>
          </div>
        )}

        <form className={styles.formulario} onSubmit={gerarDispositivo} noValidate>
          <div className={styles.campo}>
            <label htmlFor="nomeDispositivo">Nome do dispositivo</label>
            <input id="nomeDispositivo" maxLength="120" value={nomeDispositivo} onChange={(event) => setNomeDispositivo(event.target.value)} placeholder="Ex: PC da cozinha" />
          </div>
          <div className={styles.rodapeFormulario}>
            <button type="submit" className={styles.botaoPrimario} disabled={gerandoToken}>
              <Plus size={17} /> {gerandoToken ? 'Gerando…' : 'Gerar dispositivo'}
            </button>
          </div>
        </form>

        <div className={styles.listaAdicionaisAdmin}>
          {dispositivos.map((dispositivo) => (
            <article className={styles.adicionalLinha} key={dispositivo.id}>
              <div>
                <strong>{dispositivo.nome}</strong>
                <span>
                  {dispositivo.ultimoContatoEm
                    ? `Último contato em ${new Date(dispositivo.ultimoContatoEm).toLocaleString('pt-BR')}`
                    : 'Ainda não se conectou'}
                </span>
              </div>
              <span className={`${styles.status} ${dispositivo.ativo ? styles.statusAtivo : styles.statusInativo}`}>
                {dispositivo.ativo ? 'Ativo' : 'Revogado'}
              </span>
              <div className={styles.acoes}>
                {dispositivo.ativo && (
                  <button
                    type="button"
                    className={styles.botaoIcone}
                    disabled={processandoId === `dispositivo-${dispositivo.id}`}
                    aria-label={`Revogar ${dispositivo.nome}`}
                    onClick={() => revogar(dispositivo)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </article>
          ))}
          {dispositivosAtivos.length === 0 && (
            <div className={styles.vazio}>
              <KeyRound size={30} />
              <h3>Nenhum dispositivo ativo</h3>
              <p>Gere um dispositivo e instale o agente no computador da loja para começar a imprimir.</p>
            </div>
          )}
        </div>
      </section>
    </AdminLayout>
  );
}

export default ImpressorasAdmin;
