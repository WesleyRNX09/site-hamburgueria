import { Edit3, ListPlus, Package, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import { rotuloCanal } from '../../../utils/canalCatalogo';
import { usarPlaceholderProduto } from '../../../utils/productImage';
import styles from '../shared.module.css';

function CardapioAdmin() {
  const { produtos, removerProduto, alternarProduto } = useApp();
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('Todos');
  const [erro, setErro] = useState('');
  const [processandoId, setProcessandoId] = useState(null);

  const categorias = ['Todos', ...new Set(produtos.map((produto) => produto.categoria))];
  const filtrados = produtos.filter((produto) => {
    const correspondeBusca = produto.nome.toLowerCase().includes(busca.toLowerCase());
    const correspondeCategoria = categoria === 'Todos' || produto.categoria === categoria;
    return correspondeBusca && correspondeCategoria;
  });

  const acao = (
    <div className={styles.acoesCabecalho}>
      <button type="button" className={styles.botaoSecundario} onClick={() => navigate('/admin/adicionais')}><ListPlus size={17} /> Adicionais</button>
      <button type="button" className={styles.botaoPrimario} onClick={() => navigate('/admin/cardapio/novo')}><Plus size={17} /> Novo produto</button>
    </div>
  );

  async function excluir(produto) {
    if (!window.confirm(`Remover ${produto.nome} do cardápio?`)) return;
    setProcessandoId(produto.id);
    setErro('');
    try {
      await removerProduto(produto.id);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessandoId(null);
    }
  }

  async function mudarStatus(produto) {
    setProcessandoId(produto.id);
    setErro('');
    try {
      await alternarProduto(produto.id);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessandoId(null);
    }
  }

  return (
    <AdminLayout titulo="Cardápio / Produtos" subtitulo="Gerencie os mesmos produtos usados no site e nas comandas." acao={acao}>
      <section className={styles.card}>
        <div className={styles.filtros}>
          <label className={styles.busca}><Search size={17} /><input aria-label="Buscar produtos" value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar produto..." /></label>
          <div className={styles.abas}>
            {categorias.map((item) => <button type="button" key={item} aria-pressed={categoria === item} className={`${styles.aba} ${categoria === item ? styles.abaAtiva : ''}`} onClick={() => setCategoria(item)}>{item}</button>)}
          </div>
        </div>
      </section>

      <section className={`${styles.gradeProdutos} ${styles.secaoSeparada}`}>
        {filtrados.map((produto) => (
          <article className={styles.produtoCard} key={produto.id}>
            <div className={styles.produtoImagem}>
              <img src={produto.imagem} alt={produto.nome} loading="lazy" decoding="async" onError={usarPlaceholderProduto} />
              <button type="button" disabled={processandoId === produto.id} className={`${styles.status} ${produto.ativo ? styles.statusAtivo : styles.statusInativo}`} onClick={() => mudarStatus(produto)}>{processandoId === produto.id ? 'Salvando...' : produto.ativo ? 'Ativo' : 'Inativo'}</button>
            </div>
            <div className={styles.produtoConteudo}>
              <span className={styles.categoria}>{produto.categoria} • {rotuloCanal(produto.canal)}</span>
              <h3>{produto.nome}</h3>
              <p>{produto.descricao}</p>
              <small className={styles.contagemAdicionais}>{produto.adicionaisIds?.length ?? 0} adicionais disponíveis</small>
              <div className={styles.produtoRodape}>
                <span className={styles.preco}>R$ {produto.preco}</span>
                <div className={styles.acoes}>
                  <button type="button" className={styles.botaoIcone} aria-label={`Editar ${produto.nome}`} onClick={() => navigate(`/admin/cardapio/${produto.id}/editar`)}><Edit3 size={16} /></button>
                  <button type="button" className={styles.botaoIcone} aria-label={`Remover ${produto.nome}`} onClick={() => excluir(produto)}><Trash2 size={16} /></button>
                </div>
              </div>
            </div>
          </article>
        ))}
      </section>

      {erro && <div className={styles.erro} role="alert">{erro}</div>}

      {filtrados.length === 0 && <section className={styles.card}><div className={styles.vazio}><Package size={36} /><h3>Nenhum produto encontrado</h3><p>Use outros filtros ou cadastre um novo produto.</p></div></section>}
    </AdminLayout>
  );
}

export default CardapioAdmin;
