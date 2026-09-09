import { Plus, Power, ShieldAlert, ShieldCheck, UserPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import SuperadminLayout from '../../../components/SuperadminLayout';
import { useSuperadmin } from '../../../context/superadminContext';
import styles from './index.module.css';

const TAMANHO_MINIMO_SENHA = 12;

function formularioVazio() {
  return { nome: '', usuario: '', email: '', senha: '', confirmacaoSenha: '' };
}

function dataCurta(valor) {
  if (!valor) return '—';
  return new Intl.DateTimeFormat('pt-BR').format(new Date(valor));
}

function FormularioConta({ processando, onCancelar, onSalvar }) {
  const [dados, setDados] = useState(formularioVazio);
  const [erro, setErro] = useState('');

  function alterar(campo, valor) {
    setDados((atuais) => ({ ...atuais, [campo]: valor }));
  }

  async function enviar(evento) {
    evento.preventDefault();
    setErro('');
    if (dados.senha.length < TAMANHO_MINIMO_SENHA) {
      setErro(`A senha deve ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
      return;
    }
    if (dados.senha !== dados.confirmacaoSenha) {
      setErro('A confirmação da senha não confere.');
      return;
    }
    try {
      await onSalvar(dados);
      setDados(formularioVazio());
    } catch (falha) {
      setErro(falha.message || 'Não foi possível criar a conta.');
    }
  }

  return (
    <section className={styles.formularioCard}>
      <div className={styles.formularioTopo}>
        <div>
          <span>ACESSO GLOBAL</span>
          <h2>Novo superadministrador</h2>
          <p>A conta nasce ativa e com os mesmos poderes da sua.</p>
        </div>
        <button type="button" className={styles.fechar} aria-label="Fechar formulário" onClick={onCancelar}>
          <X size={20} />
        </button>
      </div>

      {erro && <p className={styles.erro} role="alert">{erro}</p>}

      <form className={styles.formulario} onSubmit={enviar}>
        <div className={styles.gridCampos}>
          <label className={styles.campo}>
            <span>Nome</span>
            <input
              type="text"
              value={dados.nome}
              maxLength={160}
              required
              onChange={(evento) => alterar('nome', evento.target.value)}
            />
          </label>
          <label className={styles.campo}>
            <span>Usuário</span>
            <input
              type="text"
              value={dados.usuario}
              maxLength={80}
              required
              onChange={(evento) => alterar('usuario', evento.target.value)}
            />
            <small>Letras minúsculas, números, ponto, hífen ou sublinhado.</small>
          </label>
          <label className={styles.campo}>
            <span>E-mail</span>
            <input
              type="email"
              value={dados.email}
              maxLength={160}
              required
              onChange={(evento) => alterar('email', evento.target.value)}
            />
          </label>
          <label className={styles.campo}>
            <span>Senha</span>
            <input
              type="password"
              value={dados.senha}
              autoComplete="new-password"
              minLength={TAMANHO_MINIMO_SENHA}
              required
              onChange={(evento) => alterar('senha', evento.target.value)}
            />
            <small>Mínimo de {TAMANHO_MINIMO_SENHA} caracteres.</small>
          </label>
          <label className={styles.campo}>
            <span>Confirmar senha</span>
            <input
              type="password"
              value={dados.confirmacaoSenha}
              autoComplete="new-password"
              minLength={TAMANHO_MINIMO_SENHA}
              required
              onChange={(evento) => alterar('confirmacaoSenha', evento.target.value)}
            />
          </label>
        </div>
        <div className={styles.acoesFormulario}>
          <button type="button" className={styles.botaoSecundario} onClick={onCancelar}>
            Cancelar
          </button>
          <button type="submit" className={styles.botaoPrimario} disabled={processando}>
            <UserPlus size={17} />
            {processando ? 'Criando...' : 'Criar conta'}
          </button>
        </div>
      </form>
    </section>
  );
}

function SuperadministradoresSuperadmin() {
  const {
    sessao,
    superadministradores,
    dadosCarregando,
    carregarSuperadministradores,
    criarContaGlobal,
    alterarStatusContaGlobal
  } = useSuperadmin();
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');

  useEffect(() => {
    carregarSuperadministradores().catch(() => {
      setErro('Não foi possível carregar as contas globais.');
    });
  }, [carregarSuperadministradores]);

  async function salvar(dados) {
    setProcessando(true);
    setErro('');
    setSucesso('');
    try {
      const criado = await criarContaGlobal(dados);
      setSucesso(`Conta "${criado.usuario}" criada com acesso global.`);
      setFormularioAberto(false);
    } finally {
      setProcessando(false);
    }
  }

  async function alternar(conta) {
    setErro('');
    setSucesso('');
    setProcessando(true);
    try {
      const atualizada = await alterarStatusContaGlobal(conta.id, !conta.ativo);
      setSucesso(atualizada.ativo
        ? `Conta "${atualizada.usuario}" reativada.`
        : `Conta "${atualizada.usuario}" desativada. As sessões dela foram encerradas.`);
    } catch (falha) {
      setErro(falha.message || 'Não foi possível alterar o status da conta.');
    } finally {
      setProcessando(false);
    }
  }

  const ativos = superadministradores.filter((conta) => conta.ativo).length;

  return (
    <SuperadminLayout
      titulo="Superadministradores"
      subtitulo="Contas com acesso global à plataforma"
      acao={!formularioAberto && (
        <button type="button" className={styles.botaoPrimario} onClick={() => setFormularioAberto(true)}>
          <Plus size={17} /> Nova conta
        </button>
      )}
    >
      <div className={styles.aviso}>
        <ShieldAlert size={17} />
        <span>
          Mantenha pelo menos duas contas ativas. Se a única conta se perder, o acesso global
          só volta pelo script <code>npm run criar-superadmin</code> no servidor.
        </span>
      </div>

      {erro && <p className={styles.erro} role="alert">{erro}</p>}
      {sucesso && <p className={styles.sucesso} role="status">{sucesso}</p>}

      {formularioAberto && (
        <FormularioConta
          processando={processando}
          onCancelar={() => setFormularioAberto(false)}
          onSalvar={salvar}
        />
      )}

      <section className={styles.listaCard}>
        <div className={styles.listaTopo}>
          <div>
            <h2>Contas cadastradas</h2>
            <p>{superadministradores.length} conta(s), {ativos} ativa(s).</p>
          </div>
        </div>

        {superadministradores.length === 0 ? (
          <div className={styles.vazio}>
            <ShieldCheck size={30} />
            <strong>{dadosCarregando ? 'Carregando contas...' : 'Nenhuma conta encontrada'}</strong>
            <span>Crie uma segunda conta para não depender de um único acesso.</span>
          </div>
        ) : (
          <div className={styles.tabelaContainer}>
            <table>
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>E-mail</th>
                  <th>Status</th>
                  <th>Criada em</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {superadministradores.map((conta) => {
                  const euMesmo = conta.id === sessao?.id;
                  return (
                    <tr key={conta.id}>
                      <td data-rotulo="Conta">
                        <strong>{conta.nome}</strong>
                        <small>{conta.usuario}{euMesmo ? ' (você)' : ''}</small>
                      </td>
                      <td data-rotulo="E-mail">{conta.email}</td>
                      <td data-rotulo="Status">
                        <span className={`${styles.status} ${conta.ativo ? styles.ativo : styles.inativo}`}>
                          {conta.ativo ? 'Ativa' : 'Desativada'}
                        </span>
                      </td>
                      <td data-rotulo="Criada em">{dataCurta(conta.criadoEm)}</td>
                      <td data-rotulo="Ações">
                        <div className={styles.acoes}>
                          <button
                            type="button"
                            disabled={processando || euMesmo}
                            title={euMesmo
                              ? 'Você não pode desativar o próprio acesso'
                              : conta.ativo ? 'Desativar conta' : 'Reativar conta'}
                            aria-label={conta.ativo
                              ? `Desativar ${conta.usuario}`
                              : `Reativar ${conta.usuario}`}
                            onClick={() => alternar(conta)}
                          >
                            <Power size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </SuperadminLayout>
  );
}

export default SuperadministradoresSuperadmin;
