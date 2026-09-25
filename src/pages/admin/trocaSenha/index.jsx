import { useState } from 'react';

import { useApp } from '../../../context/appContext';
import LogoEstabelecimento from '../../../components/LogoEstabelecimento';
import { mensagemDeErroDeAcesso } from '../../../services/api';
// Mesmo visual da tela de login: esta é a continuação do primeiro acesso.
import styles from '../login/index.module.css';

// Mesma regra do servidor para a senha escolhida pelo próprio administrador.
const TAMANHO_MINIMO_SENHA = 12;

/*
  Troca obrigatória da senha temporária. Aparece no lugar de qualquer tela do
  painel enquanto o servidor exigir a troca: a senha foi escolhida por outra
  pessoa (primeiro acesso ou redefinição pelo superadmin). Só dá para trocar a
  senha ou sair.
*/
function TrocaSenhaObrigatoria() {
  const { adminSessao, configuracao, concluirTrocaSenhaObrigatoria, sairAdmin } = useApp();
  const [dados, setDados] = useState({ senhaAtual: '', novaSenha: '', confirmacaoSenha: '' });
  const [mostrarSenhas, setMostrarSenhas] = useState(false);
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);

  function alterar(campo, valor) {
    setDados((atuais) => ({ ...atuais, [campo]: valor }));
  }

  async function enviar(evento) {
    evento.preventDefault();
    setErro('');
    if (!dados.senhaAtual) {
      setErro('Informe a senha temporária que você recebeu.');
      return;
    }
    if (dados.novaSenha.length < TAMANHO_MINIMO_SENHA) {
      setErro(`A nova senha deve ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
      return;
    }
    if (dados.novaSenha !== dados.confirmacaoSenha) {
      setErro('A confirmação da nova senha não confere.');
      return;
    }
    setProcessando(true);
    try {
      await concluirTrocaSenhaObrigatoria({
        senhaAtual: dados.senhaAtual,
        novaSenha: dados.novaSenha,
        confirmacaoSenha: dados.confirmacaoSenha
      });
    } catch (falha) {
      setErro(mensagemDeErroDeAcesso(falha));
      setProcessando(false);
    }
  }

  const tipoCampo = mostrarSenhas ? 'text' : 'password';

  return (
    <div className={styles.pagina}>
      <header className={styles.header}>
        <div className={styles.headerConteudo}>
          <div className={styles.logo}>
            <LogoEstabelecimento configuracao={configuracao} alternativa={configuracao.nomeLoja || 'Administração'} />
          </div>
          <button type="button" className={styles.botaoVoltar} onClick={() => sairAdmin()}>
            Sair
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.loginContainer}>
          <div className={styles.tituloArea}>
            <div className={styles.iconeTitulo}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </div>
            <div>
              <h1>Defina uma <span>nova senha</span></h1>
              <p>
                {adminSessao?.nome ? `${adminSessao.nome}, a` : 'A'} senha que você usou foi criada por outra
                pessoa. Escolha a sua para liberar o painel.
              </p>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardCabecalho}>
              <div>
                <span className={styles.cardSubtitulo}>PRIMEIRO ACESSO</span>
                <h2>Trocar senha temporária</h2>
                <p>O restante do painel fica bloqueado até a troca.</p>
              </div>
            </div>

            <form className={styles.formulario} onSubmit={enviar}>
              <div className={styles.grupoCampo}>
                <label htmlFor="senhaTemporaria">Senha temporária</label>
                <div className={styles.inputSenha}>
                  <input
                    id="senhaTemporaria"
                    type={tipoCampo}
                    autoComplete="current-password"
                    value={dados.senhaAtual}
                    onChange={(evento) => alterar('senhaAtual', evento.target.value)}
                  />
                  <button type="button" onClick={() => setMostrarSenhas(!mostrarSenhas)}>
                    {mostrarSenhas ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
              </div>

              <div className={styles.grupoCampo}>
                <label htmlFor="novaSenha">Nova senha</label>
                <input
                  id="novaSenha"
                  type={tipoCampo}
                  autoComplete="new-password"
                  minLength={TAMANHO_MINIMO_SENHA}
                  placeholder={`Mínimo de ${TAMANHO_MINIMO_SENHA} caracteres`}
                  value={dados.novaSenha}
                  onChange={(evento) => alterar('novaSenha', evento.target.value)}
                />
              </div>

              <div className={styles.grupoCampo}>
                <label htmlFor="confirmacaoSenha">Confirmar nova senha</label>
                <input
                  id="confirmacaoSenha"
                  type={tipoCampo}
                  autoComplete="new-password"
                  value={dados.confirmacaoSenha}
                  onChange={(evento) => alterar('confirmacaoSenha', evento.target.value)}
                />
              </div>

              {erro && <div className={styles.erro} role="alert">{erro}</div>}

              <button type="submit" className={styles.botaoEntrar} disabled={processando}>
                {processando ? 'Salvando...' : 'Salvar e entrar no painel'}
                <span>→</span>
              </button>
            </form>

            <div className={styles.rodapeCard}>
              <span>✓</span>
              A nova senha vale só para você e só neste estabelecimento.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default TrocaSenhaObrigatoria;
