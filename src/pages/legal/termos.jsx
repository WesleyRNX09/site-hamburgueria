import { Link } from 'react-router-dom';

import { useApp } from '../../context/appContext';
import styles from './index.module.css';

function TermosUso() {
  const { configuracao } = useApp();
  const loja = configuracao.nomeLoja || 'a loja responsável por este site';

  return (
    <main className={styles.pagina}>
      <article className={styles.documento}>
        <Link className={styles.voltar} to="/">← Voltar ao cardápio</Link>
        <p className={styles.rotulo}>CONDIÇÕES DE USO</p>
        <h1>Termos de Uso e Pedido</h1>
        <p className={styles.atualizacao}>Última atualização: 22 de agosto de 2026.</p>

        <section>
          <h2>1. Identificação e aceitação</h2>
          <p>Este site recebe pedidos para {loja}. Ao concluir um pedido, o cliente declara que informou dados verdadeiros, revisou os itens, endereço, taxa, total, forma de pagamento e condições apresentadas no checkout.</p>
          <dl>
            <div><dt>Contato</dt><dd>{configuracao.telefone || configuracao.email || 'Canal ainda não configurado pelo responsável da loja.'}</dd></div>
            <div><dt>Endereço da operação</dt><dd>{configuracao.endereco || 'Endereço ainda não configurado pelo responsável da loja.'}</dd></div>
          </dl>
        </section>

        <section>
          <h2>2. Disponibilidade, preços e entrega</h2>
          <p>Produtos, adicionais e promoções dependem de disponibilidade. O servidor confirma os preços e as regras vigentes no momento do envio. Pedido mínimo, área atendida e taxa de entrega são calculados a partir da configuração da loja e podem variar por bairro.</p>
          <p>A estimativa de entrega é {configuracao.tempoEntrega || 'informada no checkout quando configurada'} e não constitui horário garantido, pois pode ser afetada por volume de pedidos, trânsito, clima e eventos fora do controle razoável da operação.</p>
        </section>

        <section>
          <h2>3. Pagamento e troco</h2>
          <p>Somente as formas exibidas no checkout estão disponíveis. O Pix depende de confirmação da loja. Em dinheiro, o cliente deve indicar que não precisa de troco ou informar um valor igual ou superior ao total. Pagamentos com cartão ocorrem na entrega quando essa opção estiver habilitada.</p>
        </section>

        <section>
          <h2>4. Correções, cancelamentos e atendimento</h2>
          <p>{configuracao.politicaCancelamento || 'Após o envio, alterações e cancelamentos dependem do estágio de preparo e das regras legais aplicáveis. O cliente deve entrar em contato imediatamente pelos canais configurados. A loja pode recusar ou cancelar pedidos com dados inconsistentes, indisponibilidade, risco de fraude ou endereço fora da área atendida, comunicando o cliente quando possível.'}</p>
        </section>

        <section>
          <h2>5. Uso adequado</h2>
          <p>É proibido interferir no funcionamento do site, automatizar envios abusivos, tentar acessar áreas restritas ou usar dados de terceiros sem autorização. Reenvios técnicos de uma mesma tentativa são tratados para evitar a criação involuntária de pedidos duplicados.</p>
        </section>

        <section className={styles.alertaLegal}>
          <h2>Revisão necessária antes da venda</h2>
          <p>{configuracao.informacoesLegais || 'Este documento é um modelo e não substitui orientação jurídica. O proprietário deve adequar políticas de cancelamento, atendimento, tributos, responsabilidade, foro e normas locais antes de disponibilizar o sistema ao público.'}</p>
        </section>
      </article>
    </main>
  );
}

export default TermosUso;
