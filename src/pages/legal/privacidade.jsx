import { Link } from 'react-router-dom';

import { useApp } from '../../context/appContext';
import styles from './index.module.css';

function PoliticaPrivacidade() {
  const { configuracao } = useApp();
  const loja = configuracao.nomeLoja || 'a loja responsável por este site';

  return (
    <main className={styles.pagina}>
      <article className={styles.documento}>
        <Link className={styles.voltar} to="/">← Voltar ao cardápio</Link>
        <p className={styles.rotulo}>DOCUMENTO INFORMATIVO</p>
        <h1>Política de Privacidade</h1>
        <p className={styles.atualizacao}>Última atualização: 22 de agosto de 2026.</p>

        <section>
          <h2>1. Quem trata os dados</h2>
          <p>{loja} é responsável pelos dados pessoais usados para receber e acompanhar pedidos feitos neste site.</p>
          <dl>
            <div><dt>E-mail de contato</dt><dd>{configuracao.email || 'Canal ainda não configurado pelo responsável da loja.'}</dd></div>
            <div><dt>Endereço</dt><dd>{configuracao.endereco || 'Endereço ainda não configurado pelo responsável da loja.'}</dd></div>
          </dl>
        </section>

        <section>
          <h2>2. Dados coletados e finalidade</h2>
          <p>Para processar a entrega, coletamos nome, telefone, e-mail, endereço, itens, observações do produto, forma de pagamento e informações de troco. Esses dados são usados para validar, preparar, entregar, acompanhar e prestar suporte ao pedido.</p>
          <p>O site também mantém o carrinho no navegador e uma referência temporária ao pedido atual para permitir continuidade e acompanhamento. As sessões de administrador e atendente ficam restritas às respectivas áreas autenticadas.</p>
        </section>

        <section>
          <h2>3. Compartilhamento, armazenamento e segurança</h2>
          <p>Os dados ficam armazenados no banco de dados da operação e podem ser acessados por pessoas autorizadas que precisam preparar, entregar ou administrar o pedido. Eles poderão ser compartilhados com provedores de infraestrutura e entrega somente quando isso for necessário à prestação do serviço ou ao cumprimento de obrigação legal.</p>
          <p>São aplicadas medidas técnicas de controle de acesso, limitação de tentativas e proteção de credenciais. Nenhum sistema elimina todos os riscos, por isso incidentes relevantes devem ser avaliados e tratados pelo responsável da operação.</p>
        </section>

        <section>
          <h2>4. Retenção e direitos</h2>
          <p>Os dados devem ser mantidos apenas pelo período necessário para executar o pedido, atender obrigações fiscais ou legais, prevenir fraude e exercer direitos. O prazo concreto precisa ser definido pelo responsável da loja conforme sua operação.</p>
          <p>O titular pode solicitar confirmação do tratamento, acesso, correção, informação sobre compartilhamento e, quando aplicável, exclusão, oposição ou portabilidade. O pedido deve ser enviado ao canal de contato informado acima.</p>
        </section>

        <section className={styles.alertaLegal}>
          <h2>Revisão necessária antes da venda</h2>
          <p>{configuracao.informacoesLegais || 'Este texto é um modelo operacional e não substitui orientação jurídica. O proprietário deve revisar base legal, prazos de retenção, fornecedores, canais do titular e obrigações aplicáveis à sua cidade e ao seu negócio antes de publicar o sistema comercialmente.'}</p>
        </section>
      </article>
    </main>
  );
}

export default PoliticaPrivacidade;
