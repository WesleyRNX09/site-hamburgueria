import {
  CheckCircle2,
  Clock,
  Database,
  ImageUp,
  Plus,
  Save,
  Store,
  Trash2,
  Type
} from 'lucide-react';
import { useMemo, useState } from 'react';

import AdminLayout from '../../../components/AdminLayout';
import { useApp } from '../../../context/appContext';
import {
  DIAS_SEMANA,
  ORDEM_EXIBICAO,
  estaAbertoNoHorario,
  normalizarHorarios,
  resumoHorarios
} from '../../../utils/horarios';
import { otimizarImagemProduto } from '../../../utils/imageUpload';
import { criarVariaveisTema } from '../../../utils/theme';
import styles from '../shared.module.css';
import configStyles from './index.module.css';

function dadosEditaveis(configuracao) {
  return {
    ...configuracao,
    areasEntrega: Array.isArray(configuracao.areasEntrega) ? configuracao.areasEntrega : [],
    horarios: normalizarHorarios(configuracao.horarios)
  };
}

/* Os três estados possíveis do funcionamento, resolvidos em dois campos:
  o modo automático segue a grade; os manuais ignoram o relógio. */
function modoFuncionamento(dados) {
  if (dados.funcionamentoAutomatico) return 'automatico';
  return dados.lojaAbertaManual ? 'aberta' : 'fechada';
}

/* Fora do corpo do componente porque consulta o relógio. */
function lojaAbertaAgora(dados) {
  return dados.funcionamentoAutomatico
    ? estaAbertoNoHorario(dados.horarios)
    : dados.lojaAbertaManual === true;
}

function UploadIdentidade({ campo, titulo, descricao, valor, proporcao, onSelect, onRemove }) {
  const id = `${campo}Loja`;
  return (
    <div className={`${styles.uploadImagem} ${configStyles.uploadIdentidade}`}>
      <div className={`${styles.previaImagem} ${proporcao === 'logo' ? configStyles.previaLogo : configStyles.previaBanner}`}>
        {valor
          ? <img src={valor} alt={`Prévia de ${titulo.toLowerCase()}`} />
          : <div><ImageUp size={32} /><span>Nenhuma imagem cadastrada</span></div>}
      </div>
      <div className={styles.uploadConteudo}>
        <h2>{titulo}</h2>
        <p>{descricao}</p>
        <div className={styles.acoesCabecalho}>
          <label className={styles.botaoSecundario} htmlFor={id}><ImageUp size={16} /> Selecionar imagem</label>
          {valor && <button type="button" className={styles.botaoPerigo} onClick={() => onRemove(campo, '')}><Trash2 size={16} /> Remover</button>}
        </div>
        <input className={styles.arquivoInput} id={id} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => onSelect(campo, event)} />
      </div>
    </div>
  );
}

function ConfiguracoesAdmin() {
  const { configuracao, setConfiguracao } = useApp();
  const [dados, setDados] = useState(() => dadosEditaveis(configuracao));
  const [alterado, setAlterado] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const temaPrevia = useMemo(() => criarVariaveisTema(dados), [dados]);

  function alterar(campo, valor) {
    setDados((atuais) => ({ ...atuais, [campo]: valor }));
    setAlterado(true);
    setSalvo(false);
  }

  function alterarArea(indice, campo, valor) {
    setDados((atuais) => ({
      ...atuais,
      areasEntrega: atuais.areasEntrega.map((area, posicao) => (
        posicao === indice ? { ...area, [campo]: valor } : area
      ))
    }));
    setAlterado(true);
    setSalvo(false);
  }

  function adicionarArea() {
    setDados((atuais) => ({
      ...atuais,
      areasEntrega: [...atuais.areasEntrega, { bairro: '', taxa: atuais.taxaEntrega ?? 0 }]
    }));
    setAlterado(true);
    setSalvo(false);
  }

  function removerArea(indice) {
    setDados((atuais) => ({
      ...atuais,
      areasEntrega: atuais.areasEntrega.filter((_, posicao) => posicao !== indice)
    }));
    setAlterado(true);
    setSalvo(false);
  }

  function alterarModo(valor) {
    setDados((atuais) => ({
      ...atuais,
      funcionamentoAutomatico: valor === 'automatico',
      lojaAbertaManual: valor === 'aberta'
    }));
    setAlterado(true);
    setSalvo(false);
  }

  function alterarHorario(dia, campo, valor) {
    setDados((atuais) => ({
      ...atuais,
      horarios: atuais.horarios.map((item) => (
        item.dia === dia ? { ...item, [campo]: valor } : item
      ))
    }));
    setAlterado(true);
    setSalvo(false);
  }

  async function selecionarImagem(campo, event) {
    const arquivo = event.target.files?.[0];
    event.target.value = '';
    if (!arquivo) return;
    setErro('');
    try {
      alterar(campo, await otimizarImagemProduto(arquivo));
    } catch (falha) {
      setErro(falha.message);
    }
  }

  async function enviar(event) {
    event.preventDefault();
    if (enviando) return;
    setErro('');
    setEnviando(true);
    try {
      const configuracaoSalva = await setConfiguracao({
        ...dados,
        taxaEntrega: Number(dados.taxaEntrega),
        pedidoMinimo: Number(dados.pedidoMinimo),
        areasEntrega: dados.areasEntrega.map((area) => ({
          bairro: area.bairro,
          taxa: Number(area.taxa)
        })),
        horarios: dados.horarios.map((dia) => ({
          dia: dia.dia,
          aberto: dia.aberto === true,
          abre: dia.abre,
          fecha: dia.fecha
        }))
      });
      setDados(dadosEditaveis(configuracaoSalva));
      setAlterado(false);
      setSalvo(true);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AdminLayout titulo="Configurações" subtitulo="Identidade, operação e regras públicas do seu estabelecimento.">
      <form className={configStyles.layoutConfiguracoes} onSubmit={enviar}>
        <div className={configStyles.colunaFormulario}>
          <section className={styles.card}>
            <div className={styles.topoCard}>
              <div><h2>Logo e banner</h2><p>Estas imagens aparecem no site público, no painel e na área do garçom.</p></div>
              <ImageUp className={configStyles.iconeDestaque} size={25} />
            </div>

            <div className={styles.formulario}>
              <UploadIdentidade campo="logo" titulo="Logo da loja" descricao="JPG, PNG ou WebP. Use uma imagem quadrada ou horizontal com fundo transparente." valor={dados.logo} proporcao="logo" onSelect={selecionarImagem} onRemove={alterar} />
              <UploadIdentidade campo="banner" titulo="Banner principal" descricao="JPG, PNG ou WebP. Uma imagem horizontal funciona melhor na capa do cardápio." valor={dados.banner} proporcao="banner" onSelect={selecionarImagem} onRemove={alterar} />
              <div className={styles.aviso}>As cores e a fonte do sistema são definidas pela plataforma e não podem ser alteradas por aqui.</div>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.topoCard}>
              <div><h2>Banner e textos da loja</h2><p>Textos exibidos no banner, no cardápio e na seção sobre do site público.</p></div>
              <Type className={configStyles.iconeDestaque} size={25} />
            </div>
            <div className={styles.gridFormulario}>
              <div className={`${styles.campo} ${styles.campoCompleto}`}><label htmlFor="bannerTitulo">Título do banner <span>(opcional)</span></label><input id="bannerTitulo" maxLength="160" value={dados.bannerTitulo ?? ''} onChange={(event) => alterar('bannerTitulo', event.target.value)} placeholder="Ex.: O Verdadeiro Hambúrguer Artesanal" /></div>
              <div className={`${styles.campo} ${styles.campoCompleto}`}><label htmlFor="bannerSubtitulo">Subtítulo do banner <span>(opcional)</span></label><input id="bannerSubtitulo" maxLength="280" value={dados.bannerSubtitulo ?? ''} onChange={(event) => alterar('bannerSubtitulo', event.target.value)} placeholder="Ex.: Carne grelhada na hora, sempre fresca." /></div>
              <div className={styles.campo}><label htmlFor="bannerBotaoTexto">Texto do botão do banner <span>(opcional)</span></label><input id="bannerBotaoTexto" maxLength="60" value={dados.bannerBotaoTexto ?? ''} onChange={(event) => alterar('bannerBotaoTexto', event.target.value)} placeholder="Ex.: Peça agora" /></div>
              <div className={styles.campo}>
                <label htmlFor="bannerBotaoDestino">Destino do botão</label>
                <select id="bannerBotaoDestino" value={dados.bannerBotaoDestino ?? ''} onChange={(event) => alterar('bannerBotaoDestino', event.target.value)}>
                  <option value="">Selecione um destino</option>
                  <option value="cardapio">Cardápio</option>
                  <option value="promocoes">Promoções</option>
                  <option value="sobre">Sobre</option>
                </select>
              </div>
              <div className={styles.campo}><label htmlFor="tituloCardapio">Título do cardápio <span>(opcional)</span></label><input id="tituloCardapio" maxLength="160" value={dados.tituloCardapio ?? ''} onChange={(event) => alterar('tituloCardapio', event.target.value)} placeholder="Ex.: Nosso cardápio" /></div>
              <div className={styles.campo}><label htmlFor="textoApresentacao">Apresentação do cardápio <span>(opcional)</span></label><input id="textoApresentacao" maxLength="280" value={dados.textoApresentacao ?? ''} onChange={(event) => alterar('textoApresentacao', event.target.value)} placeholder="Ex.: Escolha o seu hambúrguer favorito." /></div>
              <div className={styles.campo}><label htmlFor="tituloSobre">Título da seção sobre <span>(opcional)</span></label><input id="tituloSobre" maxLength="160" value={dados.tituloSobre ?? ''} onChange={(event) => alterar('tituloSobre', event.target.value)} placeholder="Ex.: Hambúrguer de verdade, feito do nosso jeito." /></div>
              <div className={`${styles.campo} ${styles.campoCompleto}`}><label htmlFor="textoSobre">Texto da seção sobre <span>(opcional)</span></label><textarea id="textoSobre" maxLength="600" value={dados.textoSobre ?? ''} onChange={(event) => alterar('textoSobre', event.target.value)} placeholder="Conte um pouco sobre a história e os ingredientes da sua loja." /></div>
              <div className={`${styles.campo} ${styles.campoCompleto}`}><label htmlFor="mensagemRodape">Mensagem do rodapé <span>(opcional)</span></label><input id="mensagemRodape" maxLength="280" value={dados.mensagemRodape ?? ''} onChange={(event) => alterar('mensagemRodape', event.target.value)} placeholder="Ex.: Feito com carinho para você." /></div>
            </div>
            <div className={styles.aviso}>Preencha o texto e o destino do botão do banner juntos, ou deixe os dois vazios.</div>
          </section>

          <section className={styles.card}>
            <div className={styles.topoCard}>
              <div><h2>Informações do estabelecimento</h2><p>Nome, contatos e endereço apresentados aos clientes.</p></div>
              <Store className={configStyles.iconeDestaque} size={25} />
            </div>
            <div className={styles.gridFormulario}>
              <div className={styles.campo}><label htmlFor="nomeLoja">Nome da loja</label><input id="nomeLoja" required maxLength="160" value={dados.nomeLoja ?? ''} onChange={(event) => alterar('nomeLoja', event.target.value)} /></div>
              <div className={styles.campo}><label htmlFor="telefoneLoja">Telefone</label><input id="telefoneLoja" required maxLength="40" value={dados.telefone ?? ''} onChange={(event) => alterar('telefone', event.target.value)} /></div>
              <div className={styles.campo}><label htmlFor="whatsappLoja">WhatsApp <span>(opcional)</span></label><input id="whatsappLoja" maxLength="40" value={dados.whatsapp ?? ''} onChange={(event) => alterar('whatsapp', event.target.value)} placeholder="Número com DDD" /></div>
              <div className={styles.campo}><label htmlFor="emailLoja">E-mail</label><input id="emailLoja" required maxLength="160" type="email" value={dados.email ?? ''} onChange={(event) => alterar('email', event.target.value)} /></div>
              <div className={`${styles.campo} ${styles.campoCompleto}`}><label htmlFor="enderecoLoja">Endereço</label><input id="enderecoLoja" required maxLength="255" value={dados.endereco ?? ''} onChange={(event) => alterar('endereco', event.target.value)} /></div>
              <div className={`${styles.campo} ${styles.campoCompleto}`}><label htmlFor="horarioFuncionamento">Horário exibido no site</label><textarea id="horarioFuncionamento" required maxLength="2000" value={dados.horarioFuncionamento ?? ''} onChange={(event) => alterar('horarioFuncionamento', event.target.value)} placeholder={'Segunda a quinta: 18h às 23h\nSexta e sábado: 18h à 0h'} /></div>
              <div className={styles.campo}><label htmlFor="instagramUrl">Instagram <span>(URL opcional)</span></label><input id="instagramUrl" maxLength="500" type="url" value={dados.instagramUrl ?? ''} onChange={(event) => alterar('instagramUrl', event.target.value)} placeholder="https://instagram.com/sua-loja" /></div>
              <div className={styles.campo}><label htmlFor="facebookUrl">Facebook <span>(URL opcional)</span></label><input id="facebookUrl" maxLength="500" type="url" value={dados.facebookUrl ?? ''} onChange={(event) => alterar('facebookUrl', event.target.value)} placeholder="https://facebook.com/sua-loja" /></div>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.topoCard}><div><h2>Operação e atendimento</h2><p>Disponibilidade dos canais e regras usadas pelo servidor.</p></div></div>
            <div className={styles.gridFormulario}>
              <div className={styles.campo}><label htmlFor="modoFuncionamento">Funcionamento atual</label><select id="modoFuncionamento" value={modoFuncionamento(dados)} onChange={(event) => alterarModo(event.target.value)}><option value="automatico">Automático pelo horário</option><option value="aberta">Loja aberta (manual)</option><option value="fechada">Loja fechada (manual)</option></select></div>
              <div className={styles.campo}><label htmlFor="entregaAtiva">Delivery</label><select id="entregaAtiva" value={dados.entregaAtiva ? 'ativo' : 'inativo'} onChange={(event) => alterar('entregaAtiva', event.target.value === 'ativo')}><option value="ativo">Entrega ativa</option><option value="inativo">Entrega indisponível</option></select></div>
              <div className={styles.campo}><label htmlFor="retiradaAtiva">Retirada no balcão</label><select id="retiradaAtiva" value={dados.retiradaAtiva ? 'ativo' : 'inativo'} onChange={(event) => alterar('retiradaAtiva', event.target.value === 'ativo')}><option value="ativo">Retirada ativa</option><option value="inativo">Retirada indisponível</option></select></div>
              <div className={styles.campo}><label htmlFor="atendimentoGarcomAtivo">Atendimento por garçom</label><select id="atendimentoGarcomAtivo" value={dados.atendimentoGarcomAtivo ? 'ativo' : 'inativo'} onChange={(event) => alterar('atendimentoGarcomAtivo', event.target.value === 'ativo')}><option value="ativo">Salão ativo</option><option value="inativo">Salão indisponível</option></select></div>
              <div className={styles.campo}><label htmlFor="taxaEntrega">Taxa padrão de entrega</label><input id="taxaEntrega" min="0" required type="number" step="0.01" value={dados.taxaEntrega ?? 0} onChange={(event) => alterar('taxaEntrega', event.target.value)} /></div>
              <div className={styles.campo}><label htmlFor="tempoEntrega">Tempo estimado</label><input id="tempoEntrega" required maxLength="60" value={dados.tempoEntrega ?? ''} onChange={(event) => alterar('tempoEntrega', event.target.value)} placeholder="30–45 min" /></div>
              <div className={styles.campo}><label htmlFor="pedidoMinimo">Pedido mínimo</label><input id="pedidoMinimo" min="0" required type="number" step="0.01" value={dados.pedidoMinimo ?? 0} onChange={(event) => alterar('pedidoMinimo', event.target.value)} /></div>
            </div>

            <div className={styles.tituloCampoComAcao}>
              <div><h2>Horário de funcionamento</h2><p>Marque os dias e as horas de abertura. No modo automático, o cardápio abre e fecha sozinho.</p></div>
              <Clock className={configStyles.iconeDestaque} size={22} />
            </div>
            <div className={configStyles.gradeHorarios}>
              {ORDEM_EXIBICAO.map((indice) => {
                const dia = dados.horarios[indice];
                return (
                  <div className={configStyles.linhaHorario} key={dia.dia}>
                    <label className={configStyles.diaHorario} htmlFor={`dia-${dia.dia}`}>
                      <input id={`dia-${dia.dia}`} type="checkbox" checked={dia.aberto} onChange={(event) => alterarHorario(dia.dia, 'aberto', event.target.checked)} />
                      <span>{DIAS_SEMANA[dia.dia].nome}</span>
                    </label>
                    <div className={styles.campo}>
                      <label htmlFor={`abre-${dia.dia}`}>Abre</label>
                      <input id={`abre-${dia.dia}`} type="time" value={dia.abre} disabled={!dia.aberto} onChange={(event) => alterarHorario(dia.dia, 'abre', event.target.value)} />
                    </div>
                    <div className={styles.campo}>
                      <label htmlFor={`fecha-${dia.dia}`}>Fecha</label>
                      <input id={`fecha-${dia.dia}`} type="time" value={dia.fecha} disabled={!dia.aberto} onChange={(event) => alterarHorario(dia.dia, 'fecha', event.target.value)} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={styles.aviso}>
              {resumoHorarios(dados.horarios)
                ? `Texto publicado no site: ${resumoHorarios(dados.horarios).split('\n').join(' • ')}. Um fechamento menor que a abertura atravessa a meia-noite.`
                : 'Sem dias marcados, o site usa o texto livre de "Horário exibido no site" e o funcionamento continua manual.'}
            </div>

            <div className={styles.tituloCampoComAcao}>
              <div><h2>Áreas de entrega</h2><p>Sem bairros cadastrados, qualquer bairro informado usa a taxa padrão.</p></div>
              <button type="button" className={styles.botaoSecundario} onClick={adicionarArea}><Plus size={16} /> Adicionar bairro</button>
            </div>
            {dados.areasEntrega.length === 0 && <div className={styles.aviso}>Nenhuma área específica cadastrada.</div>}
            <div className={styles.listaAreasEntrega}>
              {dados.areasEntrega.map((area, indice) => (
                <div className={styles.linhaAreaEntrega} key={`area-${indice}`}>
                  <div className={styles.campo}><label htmlFor={`bairro-${indice}`}>Bairro</label><input id={`bairro-${indice}`} required maxLength="120" value={area.bairro} onChange={(event) => alterarArea(indice, 'bairro', event.target.value)} /></div>
                  <div className={styles.campo}><label htmlFor={`taxa-${indice}`}>Taxa</label><input id={`taxa-${indice}`} min="0" required type="number" step="0.01" value={area.taxa} onChange={(event) => alterarArea(indice, 'taxa', event.target.value)} /></div>
                  <button type="button" className={styles.botaoIcone} onClick={() => removerArea(indice)} aria-label={`Remover ${area.bairro || 'área'}`}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.topoCard}><div><h2>Formas de pagamento</h2><p>O Pix é habilitado quando chave, beneficiário e cidade estão preenchidos.</p></div></div>
            <div className={styles.gridFormulario}>
              <div className={styles.campo}><label htmlFor="aceitaCartao">Cartão</label><select id="aceitaCartao" value={dados.aceitaCartao ? 'sim' : 'nao'} onChange={(event) => alterar('aceitaCartao', event.target.value === 'sim')}><option value="sim">Aceitar</option><option value="nao">Não aceitar</option></select></div>
              <div className={styles.campo}><label htmlFor="aceitaDinheiro">Dinheiro</label><select id="aceitaDinheiro" value={dados.aceitaDinheiro ? 'sim' : 'nao'} onChange={(event) => alterar('aceitaDinheiro', event.target.value === 'sim')}><option value="sim">Aceitar</option><option value="nao">Não aceitar</option></select></div>
              <div className={styles.campo}><label htmlFor="pixChave">Chave Pix <span>(opcional)</span></label><input id="pixChave" maxLength="180" value={dados.pixChave ?? ''} onChange={(event) => alterar('pixChave', event.target.value)} /></div>
              <div className={styles.campo}><label htmlFor="pixBeneficiario">Beneficiário do Pix</label><input id="pixBeneficiario" maxLength="160" value={dados.pixBeneficiario ?? ''} onChange={(event) => alterar('pixBeneficiario', event.target.value)} disabled={!dados.pixChave} /></div>
              <div className={styles.campo}><label htmlFor="pixCidade">Cidade do beneficiário</label><input id="pixCidade" maxLength="60" value={dados.pixCidade ?? ''} onChange={(event) => alterar('pixCidade', event.target.value)} disabled={!dados.pixChave} placeholder="Ex.: São Paulo" /></div>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.topoCard}><div><h2>Políticas e informações legais</h2><p>Textos exibidos como conteúdo simples, sem aceitar HTML.</p></div></div>
            <div className={styles.formulario}>
              <div className={styles.campo}><label htmlFor="politicaCancelamento">Política de cancelamento <span>(opcional)</span></label><textarea id="politicaCancelamento" maxLength="2000" value={dados.politicaCancelamento ?? ''} onChange={(event) => alterar('politicaCancelamento', event.target.value)} /></div>
              <div className={styles.campo}><label htmlFor="informacoesLegais">Informações legais <span>(opcional)</span></label><textarea id="informacoesLegais" maxLength="2000" value={dados.informacoesLegais ?? ''} onChange={(event) => alterar('informacoesLegais', event.target.value)} /></div>
            </div>
          </section>
        </div>

        <aside className={configStyles.colunaLateral}>
          <section className={styles.card}>
            <div className={styles.topoCard}><div><h2>Prévia do tema</h2><p>Visualização aproximada antes de salvar.</p></div></div>
            <div className={configStyles.previaSite} style={temaPrevia}>
              <div className={configStyles.previaTopo}>
                {dados.logo ? <img src={dados.logo} alt="" /> : <Store size={24} />}
                <strong>{dados.nomeLoja || 'Nome da loja'}</strong>
              </div>
              <div className={configStyles.previaCapa}>
                {dados.banner ? <img src={dados.banner} alt="" /> : <span>Seu banner aparecerá aqui</span>}
              </div>
              <div className={configStyles.previaConteudo}>
                <span>{lojaAbertaAgora(dados) ? 'Aberta para pedidos' : 'Fechada no momento'}</span>
                <div><strong>Destaque do cardápio</strong><small>Produto, descrição e preço</small><b>R$ 29,90</b></div>
                <button type="button" tabIndex="-1">Adicionar</button>
              </div>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.topoCard}><div><h2>Publicação segura</h2><p>O que acontece ao salvar.</p></div><Database className={configStyles.iconeDestaque} size={25} /></div>
            <ul className={configStyles.listaSeguranca}>
              <li><CheckCircle2 size={17} /> A alteração fica restrita ao seu estabelecimento.</li>
              <li><CheckCircle2 size={17} /> Cores e fontes passam por uma lista permitida.</li>
              <li><CheckCircle2 size={17} /> Imagens são validadas e armazenadas pelo servidor.</li>
              <li><CheckCircle2 size={17} /> HTML, CSS e JavaScript personalizados não são aceitos.</li>
            </ul>
          </section>
        </aside>

        <div className={configStyles.barraSalvar}>
          <div aria-live="polite">
            {salvo && <div className={styles.sucesso} role="status">Configurações salvas com sucesso.</div>}
            {erro && <div className={styles.erro} role="alert">{erro}</div>}
            {!salvo && !erro && <span>{alterado ? 'Existem alterações ainda não salvas.' : 'As configurações estão atualizadas.'}</span>}
          </div>
          <button disabled={enviando || !alterado} type="submit" className={styles.botaoPrimario}><Save size={17} /> {enviando ? 'Salvando…' : 'Salvar configurações'}</button>
        </div>
      </form>
    </AdminLayout>
  );
}

export default ConfiguracoesAdmin;
