import { KeyRound, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

import SuperadminLayout from '../../../components/SuperadminLayout';
import { useSuperadmin } from '../../../context/superadminContext';
import styles from './index.module.css';

const TAMANHO_MINIMO = 12;

function formularioVazio() {
  return { senhaAtual: '', novaSenha: '', confirmacaoSenha: '' };
}

function SenhaSuperadmin() {
  const { alterarSenha } = useSuperadmin();
  const [dados, setDados] = useState(formularioVazio);
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);

  function alterar(campo, valor) {
    setDados((atuais) => ({ ...atuais, [campo]: valor }));
  }

  async function enviar(evento) {
    evento.preventDefault();
    setErro('');
    if (dados.novaSenha.length < TAMANHO_MINIMO) {
      setErro(`A nova senha deve ter pelo menos ${TAMANHO_MINIMO} caracteres.`);
      return;
    }
    if (dados.novaSenha !== dados.confirmacaoSenha) {
      setErro('A confirmação da nova senha não confere.');
      return;
    }
    setProcessando(true);
    try {
      /* Em caso de sucesso o provider derruba a sessão e o guard redireciona
         para o login, então não há estado de "salvo" para exibir aqui. */
      await alterarSenha(dados);
    } catch (falha) {
      setErro(falha.message || 'Não foi possível alterar a senha.');
      setProcessando(false);
    }
  }

  return (
    <SuperadminLayout
      titulo="Minha senha"
      subtitulo="Troque a senha da sua conta de acesso global"
    >
      <div className={styles.cartao}>
        <div className={styles.topo}>
          <span className={styles.icone}><KeyRound size={22} /></span>
          <div>
            <h2>Alterar senha do superadministrador</h2>
            <p>
              Confirme a senha atual para definir uma nova. Ela precisa ter no mínimo
              {` ${TAMANHO_MINIMO} `}
              caracteres.
            </p>
          </div>
        </div>

        <div className={styles.aviso}>
          <ShieldAlert size={17} />
          <span>
            Ao concluir, todas as sessões abertas do superadministrador são encerradas,
            inclusive esta. Você voltará ao login para entrar com a nova senha.
          </span>
        </div>

        {erro && <p className={styles.erro} role="alert">{erro}</p>}

        <form className={styles.formulario} onSubmit={enviar}>
          <label className={styles.campo}>
            <span>Senha atual</span>
            <input
              type="password"
              value={dados.senhaAtual}
              autoComplete="current-password"
              required
              onChange={(evento) => alterar('senhaAtual', evento.target.value)}
            />
          </label>
          <label className={styles.campo}>
            <span>Nova senha</span>
            <input
              type="password"
              value={dados.novaSenha}
              autoComplete="new-password"
              minLength={TAMANHO_MINIMO}
              required
              onChange={(evento) => alterar('novaSenha', evento.target.value)}
            />
            <small>Mínimo de {TAMANHO_MINIMO} caracteres.</small>
          </label>
          <label className={styles.campo}>
            <span>Confirmar nova senha</span>
            <input
              type="password"
              value={dados.confirmacaoSenha}
              autoComplete="new-password"
              minLength={TAMANHO_MINIMO}
              required
              onChange={(evento) => alterar('confirmacaoSenha', evento.target.value)}
            />
          </label>
          <div className={styles.acoes}>
            <button type="submit" className={styles.botaoPrimario} disabled={processando}>
              {processando ? 'Alterando...' : 'Alterar senha'}
            </button>
          </div>
        </form>
      </div>
    </SuperadminLayout>
  );
}

export default SenhaSuperadmin;
