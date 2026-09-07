import { ArrowLeft, Edit3, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import styles from '../shared.module.css';

const vazio = { nome: '', preco: '' };

function moeda(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

function AdicionaisAdmin() {
  const { adicionais, produtos, salvarAdicional, removerAdicional, alternarAdicional } = useApp();
  const navigate = useNavigate();
  const [dados, setDados] = useState(vazio);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);
  const [processandoId, setProcessandoId] = useState(null);

  const filtrados = useMemo(() => adicionais.filter((adicional) =>
    adicional.nome.toLowerCase().includes(busca.toLowerCase())), [adicionais, busca]);

  function alterar(campo, valor) {
    setDados((atuais) => ({ ...atuais, [campo]: valor }));
  }

  function editar(adicional) {
    setDados({ ...adicional, preco: String(adicional.preco).replace('.', ',') });
    setErro('');
  }

  function cancelar() {
    setDados(vazio);
    setErro('');
  }

  async function enviar(event) {
    event.preventDefault();
    if (!dados.nome.trim() || !String(dados.preco).trim()) {
      setErro('Informe o nome e o preço do adicional.');
      return;
    }

    setProcessando(true);
    try {
      await salvarAdicional({ ...dados, nome: dados.nome.trim() });
      cancelar();
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  async function excluir(adicional) {
    if (window.confirm(`Remover ${adicional.nome}? Ele também sairá dos produtos vinculados.`)) {
      setProcessandoId(adicional.id);
      setErro('');
      try {
        await removerAdicional(adicional.id);
        if (dados.id === adicional.id) cancelar();
      } catch (falha) {
        setErro(falha.message);
      } finally {
        setProcessandoId(null);
      }
    }
  }

  async function mudarStatus(adicional) {
    setProcessandoId(adicional.id);
    setErro('');
    try {
      await alternarAdicional(adicional.id);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessandoId(null);
    }
  }

  function quantidadeProdutos(adicionalId) {
    return produtos.filter((produto) => (produto.adicionaisIds ?? []).includes(adicionalId)).length;
  }

  const acao = <button type="button" className={styles.botaoSecundario} onClick={() => navigate('/admin/cardapio')}><ArrowLeft size={17} /> Cardápio</button>;

  return (
    <AdminLayout titulo="Adicionais" subtitulo="Crie os extras e escolha em quais produtos cada um poderá aparecer." acao={acao}>
      <div className={styles.gradeDuasColunas}>
        <section className={styles.card}>
          <div className={styles.topoCard}>
            <div><h2>Catálogo de adicionais</h2><p>{adicionais.length} opções cadastradas</p></div>
          </div>
          <label className={styles.busca}><Search size={17} /><input aria-label="Buscar adicionais" value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar adicional..." /></label>
          <div className={styles.listaAdicionaisAdmin}>
            {filtrados.map((adicional) => (
              <article className={styles.adicionalLinha} key={adicional.id}>
                <div>
                  <strong>{adicional.nome}</strong>
                  <span>{moeda(adicional.preco)} • usado em {quantidadeProdutos(adicional.id)} produto(s)</span>
                </div>
                <button type="button" disabled={processandoId === adicional.id} className={`${styles.status} ${adicional.ativo !== false ? styles.statusAtivo : styles.statusInativo}`} onClick={() => mudarStatus(adicional)}>{processandoId === adicional.id ? 'Salvando...' : adicional.ativo !== false ? 'Ativo' : 'Inativo'}</button>
                <div className={styles.acoes}>
                  <button type="button" className={styles.botaoIcone} aria-label={`Editar ${adicional.nome}`} onClick={() => editar(adicional)}><Edit3 size={16} /></button>
                  <button type="button" className={styles.botaoIcone} aria-label={`Remover ${adicional.nome}`} onClick={() => excluir(adicional)}><Trash2 size={16} /></button>
                </div>
              </article>
            ))}
            {filtrados.length === 0 && <div className={styles.vazio}><Plus size={30} /><h3>Nenhum adicional encontrado</h3></div>}
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.topoCard}>
            <div><h2>{dados.id ? 'Editar adicional' : 'Novo adicional'}</h2><p>O vínculo com cada lanche é feito na edição do produto.</p></div>
          </div>
          <form className={styles.formulario} onSubmit={enviar}>
            <div className={styles.campo}><label htmlFor="nomeAdicional">Nome</label><input id="nomeAdicional" value={dados.nome} onChange={(event) => alterar('nome', event.target.value)} placeholder="Ex: Bacon extra" /></div>
            <div className={styles.campo}><label htmlFor="precoAdicional">Preço</label><input id="precoAdicional" inputMode="decimal" value={dados.preco} onChange={(event) => alterar('preco', event.target.value)} placeholder="5,00" /></div>
            {erro && <div className={styles.erro} role="alert">{erro}</div>}
            <div className={styles.rodapeFormulario}>
              {dados.id && <button type="button" className={styles.botaoSecundario} onClick={cancelar}><X size={16} /> Cancelar</button>}
              <button type="submit" className={styles.botaoPrimario} disabled={processando}>{dados.id ? <Save size={17} /> : <Plus size={17} />} {processando ? 'Salvando...' : dados.id ? 'Salvar alteração' : 'Adicionar extra'}</button>
            </div>
          </form>
        </section>
      </div>
    </AdminLayout>
  );
}

export default AdicionaisAdmin;
