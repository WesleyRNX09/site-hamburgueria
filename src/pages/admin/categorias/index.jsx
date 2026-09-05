import { Edit3, Layers3, Plus, Save, X } from 'lucide-react';
import { useState } from 'react';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import { CANAIS_CATALOGO, canalCatalogo } from '../../../utils/canalCatalogo';
import styles from '../shared.module.css';

const vazio = { nome: '', ordem: 0, canal: 'ambos', ativo: true };

function CategoriasAdmin() {
  const { categorias, produtos, salvarCategoria, alternarCategoria } = useApp();
  const [formulario, setFormulario] = useState(null);
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);

  async function enviar(evento) {
    evento.preventDefault();
    if (processando) return;
    setProcessando(true);
    setErro('');
    try {
      await salvarCategoria({ ...formulario, ordem: Number(formulario.ordem) });
      setFormulario(null);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  async function alternar(categoria) {
    if (processando) return;
    setProcessando(true);
    setErro('');
    try {
      await alternarCategoria(categoria.id);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  const acao = <button type="button" className={styles.botaoPrimario} onClick={() => setFormulario({ ...vazio, ordem: categorias.length })}><Plus size={17} /> Nova categoria</button>;

  return (
    <AdminLayout titulo="Categorias" subtitulo="Organize as seções do cardápio sem valores fixos no código." acao={acao}>
      {formulario && (
        <section className={`${styles.card} ${styles.secaoComMargemInferior}`}>
          <div className={styles.topoCard}>
            <div><h2>{formulario.id ? 'Editar categoria' : 'Cadastrar categoria'}</h2><p>A ordem menor aparece primeiro no cardápio.</p></div>
            <button type="button" className={styles.botaoIcone} aria-label="Fechar formulário" onClick={() => setFormulario(null)}><X size={17} /></button>
          </div>
          <form className={styles.formulario} onSubmit={enviar}>
            <div className={styles.gridFormulario}>
              <div className={styles.campo}><label htmlFor="nomeCategoria">Nome</label><input id="nomeCategoria" required maxLength={100} value={formulario.nome} onChange={(evento) => setFormulario((atual) => ({ ...atual, nome: evento.target.value }))} /></div>
              <div className={styles.campo}><label htmlFor="ordemCategoria">Ordem</label><input id="ordemCategoria" required type="number" min="0" max="9999" value={formulario.ordem} onChange={(evento) => setFormulario((atual) => ({ ...atual, ordem: evento.target.value }))} /></div>
              <div className={styles.campo}>
                <label htmlFor="canalCategoria">Onde aparece</label>
                <select id="canalCategoria" value={formulario.canal ?? 'ambos'} onChange={(evento) => setFormulario((atual) => ({ ...atual, canal: evento.target.value }))}>
                  {CANAIS_CATALOGO.map((canal) => <option key={canal.valor} value={canal.valor}>{canal.rotulo}</option>)}
                </select>
                <small className={styles.textoSecundario}>{canalCatalogo(formulario.canal).ajuda}</small>
              </div>
            </div>
            {erro && <div className={styles.erro} role="alert">{erro}</div>}
            <div className={styles.rodapeFormulario}><button disabled={processando} type="submit" className={styles.botaoPrimario}><Save size={17} /> Salvar categoria</button></div>
          </form>
        </section>
      )}

      <section className={styles.card}>
        <div className={styles.topoCard}><div><h2>Categorias do cardápio</h2><p>Categorias inativas e seus produtos deixam de aparecer ao cliente. "Onde aparece" separa o cardápio do site do cardápio do salão.</p></div></div>
        <div className={styles.listaAdicionaisAdmin}>
          {categorias.map((categoria) => (
            <div className={styles.adicionalLinha} key={categoria.id}>
              <div><strong>{categoria.nome}</strong><span>Ordem {categoria.ordem} • {produtos.filter((produto) => produto.categoriaId === categoria.id).length} produtos • {canalCatalogo(categoria.canal).curto}</span></div>
              <span className={`${styles.status} ${categoria.ativo ? styles.statusAtivo : styles.statusInativo}`}>{categoria.ativo ? 'Ativa' : 'Inativa'}</span>
              <div className={styles.acoes}>
                <button type="button" className={styles.botaoIcone} aria-label={`Editar ${categoria.nome}`} onClick={() => setFormulario({ ...categoria })}><Edit3 size={16} /></button>
                <button disabled={processando} type="button" className={categoria.ativo ? styles.botaoPerigo : styles.botaoSecundario} onClick={() => alternar(categoria)}>{categoria.ativo ? 'Desativar' : 'Ativar'}</button>
              </div>
            </div>
          ))}
          {categorias.length === 0 && <div className={styles.vazio}><Layers3 size={36} /><h3>Nenhuma categoria cadastrada</h3><p>Cadastre uma categoria antes de criar produtos.</p></div>}
        </div>
        {!formulario && erro && <div className={styles.erro} role="alert">{erro}</div>}
      </section>
    </AdminLayout>
  );
}

export default CategoriasAdmin;
