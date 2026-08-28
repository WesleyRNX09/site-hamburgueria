import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useApp } from '../../../context/appContext';
import LogoEstabelecimento from '../../../components/LogoEstabelecimento';
import styles from './index.module.css';

function LoginAdmin() {

    const navigate = useNavigate();
    const location = useLocation();
    const { entrarAdmin, configuracao } = useApp();

    const [usuario, setUsuario] = useState('');
    const [senha, setSenha] = useState('');
    const [mostrarSenha, setMostrarSenha] = useState(false);
    const [erro, setErro] = useState('');
    const [processando, setProcessando] = useState(false);

    async function fazerLogin(event) {

        event.preventDefault();

        setErro('');

        if (!usuario.trim() || !senha.trim()) {
            setErro('Preencha o usuário e a senha.');
            return;
        }

        setProcessando(true);
        try {
            if (!await entrarAdmin(usuario, senha)) {
                setErro('Usuário ou senha incorretos.');
                return;
            }

            navigate(location.state?.origem ?? '/admin/dashboard', {
                replace: true
            });
        } catch (falha) {
            setErro(falha.message);
        } finally {
            setProcessando(false);
        }
    }


    return (

        <div className={styles.pagina}>

            {/* ========================= */}
            {/* BARRA SUPERIOR */}
            {/* ========================= */}

            <header className={styles.header}>

                <div className={styles.headerConteudo}>

                    <div
                        className={styles.logo}
                        onClick={() => navigate('/')}
                    >
                        <LogoEstabelecimento
                            configuracao={configuracao}
                            alternativa={configuracao.nomeLoja || 'Administração'}
                        />
                    </div>

                    <button
                        type="button"
                        className={styles.botaoVoltar}
                        onClick={() => navigate('/')}
                    >
                        ← Voltar
                    </button>

                </div>

            </header>


            {/* ========================= */}
            {/* CONTEÚDO */}
            {/* ========================= */}

            <main className={styles.main}>

                <section className={styles.loginContainer}>

                    {/* TÍTULO */}

                    <div className={styles.tituloArea}>

                        <div className={styles.iconeTitulo}>

                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                            >
                                <rect
                                    x="5"
                                    y="11"
                                    width="14"
                                    height="10"
                                    rx="2"
                                />

                                <path d="M8 11V7a4 4 0 0 1 8 0v4" />

                            </svg>

                        </div>

                        <div>

                            <h1>
                                Acesso <span>administrativo</span>
                            </h1>

                            <p>
                                Entre para gerenciar os pedidos e a sua lanchonete.
                            </p>

                        </div>

                    </div>


                    {/* CARD LOGIN */}

                    <div className={styles.card}>

                        <div className={styles.cardCabecalho}>

                            <div>

                                <span className={styles.cardSubtitulo}>
                                    ACESSO RESTRITO
                                </span>

                                <h2>Entrar no painel</h2>

                                <p>
                                    Utilize suas credenciais de administrador.
                                </p>

                            </div>

                            <div className={styles.iconeCadeado}>

                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <rect
                                        x="5"
                                        y="11"
                                        width="14"
                                        height="10"
                                        rx="2"
                                    />

                                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />

                                </svg>

                            </div>

                        </div>


                        <form
                            className={styles.formulario}
                            onSubmit={fazerLogin}
                        >

                            {/* USUÁRIO */}

                            <div className={styles.grupoCampo}>

                                <label htmlFor="usuario">
                                    Usuário ou e-mail
                                </label>

                                <input
                                    id="usuario"
                                    type="text"
                                    placeholder="Digite seu usuário ou e-mail"
                                    value={usuario}
                                    onChange={(event) =>
                                        setUsuario(event.target.value)
                                    }
                                    autoComplete="username"
                                />

                            </div>


                            {/* SENHA */}

                            <div className={styles.grupoCampo}>

                                <label htmlFor="senha">
                                    Senha
                                </label>

                                <div className={styles.inputSenha}>

                                    <input
                                        id="senha"
                                        type={mostrarSenha ? 'text' : 'password'}
                                        placeholder="Digite sua senha"
                                        value={senha}
                                        onChange={(event) =>
                                            setSenha(event.target.value)
                                        }
                                        autoComplete="current-password"
                                    />

                                    <button
                                        type="button"
                                        onClick={() =>
                                            setMostrarSenha(!mostrarSenha)
                                        }
                                    >
                                        {mostrarSenha
                                            ? 'Ocultar'
                                            : 'Mostrar'
                                        }
                                    </button>

                                </div>

                            </div>


                            {/* ERRO */}

                            {erro && (

                                <div className={styles.erro} role="alert">
                                    {erro}
                                </div>

                            )}


                            {/* BOTÃO */}

                            <button
                                type="submit"
                                className={styles.botaoEntrar}
                                disabled={processando}
                            >
                                {processando ? 'Entrando...' : 'Entrar no painel'}

                                <span>
                                    →
                                </span>

                            </button>

                        </form>


                        <div className={styles.rodapeCard}>

                            <span>✓</span>

                            Ambiente exclusivo para administradores.

                        </div>

                        <div className={styles.credenciaisDemo}>
                            <strong>Acesso protegido pelo servidor</strong>
                            <span>Use o usuário e a senha configurados no backend.</span>
                        </div>

                    </div>

                </section>

            </main>

        </div>
    );
}

export default LoginAdmin;
