import { ArrowLeft, Check, ImagePlus, ListPlus, Save, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import AdminLayout from '../../../components/AdminLayout';
import SeletorOpcoes from '../../../components/SeletorOpcoes';
import { useApp } from '../../../context/appContext';
import { CANAIS_CATALOGO, canalCatalogo } from '../../../utils/canalCatalogo';
import { otimizarImagemProduto } from '../../../utils/imageUpload';
import { imagemProdutoPadrao, usarPlaceholderProduto } from '../../../utils/productImage';
import styles from '../shared.module.css';

const formularioVazio = {
  nome: '',
  categoriaId: '',
  canal: 'ambos',
  descricao: '',
  preco: '',
  imagem: '',
  adicionaisIds: [],
  destaque: '',
  // Vazio = herda a impressora da categoria.
  impressoraId: '',
  ativo: true
};

function FormularioProduto() {
  const { id } = useParams();
  const { produtos, adicionais, categorias, impressoras, salvarProduto } = useApp();
  const navigate = useNavigate();
  const existente = produtos.find((produto) => String(produto.id) === id);
  const [dados, setDados] = useState(() => existente
    ? { ...existente, adicionaisIds: existente.adicionaisIds ?? adicionais.map((adicional) => adicional.id) }
    : { ...formularioVazio, categoriaId: categorias.find((categoria) => categoria.ativo)?.id ?? '' });
  const [erro, setErro] = useState('');
  const [processandoImagem, setProcessandoImagem] = useState(false);
  const [salvando, setSalvando] = useState(false);

  function alterar(campo, valor) {
    setDados((atuais) => ({ ...atuais, [campo]: valor }));
  }

  function alternarAdicional(idAdicional) {
    setDados((atuais) => ({
      ...atuais,
      adicionaisIds: atuais.adicionaisIds.includes(idAdicional)
        ? atuais.adicionaisIds.filter((id) => id !== idAdicional)
        : [...atuais.adicionaisIds, idAdicional]
    }));
  }

  async function selecionarImagem(event) {
    const arquivo = event.target.files?.[0];
    event.target.value = '';
    if (!arquivo) return;

    setProcessandoImagem(true);
    setErro('');
    try {
      const imagem = await otimizarImagemProduto(arquivo);
      alterar('imagem', imagem);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessandoImagem(false);
    }
  }

  async function enviar(event) {
    event.preventDefault();
    if (!dados.nome.trim() || !dados.descricao.trim() || !String(dados.preco).trim()) {
      setErro('Preencha nome, descrição e preço do produto.');
      return;
    }

    setSalvando(true);
    try {
      await salvarProduto({
        ...dados,
        preco: String(dados.preco).replace('.', ','),
        impressoraId: dados.impressoraId === '' || dados.impressoraId == null
          ? null
          : Number(dados.impressoraId)
      });
      navigate('/admin/cardapio');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setSalvando(false);
    }
  }

  // O placeholder do cardápio não é foto do produto: sem essa distinção o
  // formulário ofereceria "remover" uma imagem que não existe no banco.
  const temFoto = Boolean(dados.imagem) && dados.imagem !== imagemProdutoPadrao;

  /* "Usar da categoria" precisa dizer qual é essa impressora, senão o
     administrador não sabe o que está herdando. */
  const impressorasAtivas = impressoras.filter((impressora) => impressora.ativa);
  const categoriaEscolhida = categorias.find((categoria) => categoria.id === Number(dados.categoriaId));
  const herdada = impressoras.find((impressora) => impressora.id === categoriaEscolhida?.impressoraId);
  const impressoraDaCategoria = herdada
    ? `A categoria ${categoriaEscolhida.nome} imprime em ${herdada.nome}.`
    : 'A categoria escolhida não imprime. Sem exceção aqui, este produto também não é impresso.';

  const acao = <button type="button" className={styles.botaoSecundario} onClick={() => navigate('/admin/cardapio')}><ArrowLeft size={17} /> Voltar</button>;

  return (
    <AdminLayout titulo={existente ? 'Editar produto' : 'Cadastrar produto'} subtitulo="As alterações aparecem no cardápio do cliente e do garçom." acao={acao}>
      <section className={styles.card}>
        <form className={styles.formulario} onSubmit={enviar}>
          <div className={styles.uploadImagem}>
            <div className={styles.previaImagem}>
              {temFoto
                ? <img src={dados.imagem} alt="Prévia do produto" onError={usarPlaceholderProduto} />
                : <div><ImagePlus size={34} /><span>A foto do produto aparecerá aqui</span></div>}
            </div>
            <div className={styles.uploadConteudo}>
              <h2>Foto do produto</h2>
              <p>Envie uma imagem JPG, PNG ou WebP. Ela será otimizada e usada no site do cliente, no painel e na comanda do garçom.</p>
              <div className={styles.acoes}>
                <label htmlFor="imagemProduto" className={styles.botaoSecundario}>
                  <Upload size={17} /> {processandoImagem ? 'Otimizando...' : temFoto ? 'Trocar foto' : 'Escolher foto'}
                </label>
                {temFoto && (
                  <button type="button" className={styles.botaoPerigo} disabled={processandoImagem} onClick={() => alterar('imagem', '')}><Trash2 size={17} /> Remover foto</button>
                )}
              </div>
              <input id="imagemProduto" className={styles.arquivoInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={processandoImagem} onChange={selecionarImagem} />
            </div>
          </div>

          <div className={styles.gridFormulario}>
            <div className={styles.campo}><label htmlFor="nome">Nome do produto</label><input id="nome" value={dados.nome} onChange={(event) => alterar('nome', event.target.value)} placeholder="Ex: X-Bacon Especial" /></div>
            <div className={styles.campo}><label htmlFor="categoria">Categoria</label><SeletorOpcoes id="categoria" rotulo="Categoria" larguraTotal required valor={dados.categoriaId ?? ''} onChange={(valor) => alterar('categoriaId', Number(valor))} opcoes={[{ valor: '', rotulo: 'Selecione' }, ...categorias.filter((categoria) => categoria.ativo || categoria.id === dados.categoriaId).map((categoria) => ({ valor: categoria.id, rotulo: `${categoria.nome}${categoria.ativo ? '' : ' (inativa)'}` }))]} /></div>
            <div className={`${styles.campo} ${styles.campoCompleto}`}><label htmlFor="descricao">Descrição</label><textarea id="descricao" value={dados.descricao} onChange={(event) => alterar('descricao', event.target.value)} placeholder="Descreva ingredientes e características..." /></div>
            <div className={styles.campo}><label htmlFor="preco">Preço</label><input id="preco" inputMode="decimal" value={dados.preco} onChange={(event) => alterar('preco', event.target.value)} placeholder="34,90" /></div>
            <div className={styles.campo}><label htmlFor="destaque">Destaque <span>(opcional)</span></label><input id="destaque" value={dados.destaque ?? ''} onChange={(event) => alterar('destaque', event.target.value)} placeholder="Ex: Mais vendido" /></div>
            <div className={styles.campo}>
              <label htmlFor="canalProduto">Onde aparece</label>
              <SeletorOpcoes id="canalProduto" rotulo="Onde aparece" larguraTotal valor={dados.canal ?? 'ambos'} onChange={(valor) => alterar('canal', valor)} opcoes={CANAIS_CATALOGO} />
              <small className={styles.textoSecundario}>{canalCatalogo(dados.canal).ajuda}</small>
            </div>
            <div className={styles.campo}>
              <label htmlFor="impressoraProduto">Impressora <span>(exceção)</span></label>
              <SeletorOpcoes
                id="impressoraProduto"
                rotulo="Impressora"
                larguraTotal
                valor={dados.impressoraId ?? ''}
                onChange={(valor) => alterar('impressoraId', valor)}
                opcoes={[{ valor: '', rotulo: 'Usar da categoria' }, ...impressorasAtivas.map((impressora) => ({ valor: impressora.id, rotulo: impressora.nome }))]}
              />
              <small className={styles.textoSecundario}>{impressoraDaCategoria}</small>
            </div>

            <div className={`${styles.campo} ${styles.campoCompleto}`}>
              <div className={styles.tituloCampoComAcao}>
                <div><strong>Adicionais permitidos</strong><p>Marque somente os extras que podem ser escolhidos neste produto.</p></div>
                <button type="button" className={styles.botaoSecundario} onClick={() => navigate('/admin/adicionais')}><ListPlus size={16} /> Gerenciar adicionais</button>
              </div>
              <div className={styles.gradeSelecaoAdicionais}>
                {adicionais.map((adicional) => {
                  const selecionado = dados.adicionaisIds.includes(adicional.id);
                  const indisponivel = adicional.ativo === false && !selecionado;
                  return (
                    <button
                      type="button"
                      key={adicional.id}
                      className={`${styles.opcaoAdicional} ${selecionado ? styles.opcaoAdicionalAtiva : ''}`}
                      aria-pressed={selecionado}
                      disabled={indisponivel}
                      onClick={() => alternarAdicional(adicional.id)}
                    >
                      <span>{selecionado && <Check size={15} />}</span>
                      <div><strong>{adicional.nome}</strong><small>+ R$ {Number(adicional.preco).toFixed(2).replace('.', ',')}{adicional.ativo === false ? ' • inativo' : ''}</small></div>
                    </button>
                  );
                })}
                {adicionais.length === 0 && <div className={styles.aviso}>Cadastre pelo menos um adicional antes de vinculá-lo ao produto.</div>}
              </div>
            </div>
          </div>
          {erro && <div className={styles.erro} role="alert">{erro}</div>}
          <div className={styles.rodapeFormulario}>
            <button type="button" className={styles.botaoSecundario} onClick={() => navigate('/admin/cardapio')}>Cancelar</button>
            <button type="submit" className={styles.botaoPrimario} disabled={salvando || processandoImagem}><Save size={17} /> {salvando ? 'Salvando...' : 'Salvar produto'}</button>
          </div>
        </form>
      </section>
    </AdminLayout>
  );
}

export default FormularioProduto;
