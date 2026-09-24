import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import styles from './index.module.css';

function normalizarOpcao(opcao) {
  return typeof opcao === 'object' && opcao !== null
    ? { valor: String(opcao.valor), rotulo: opcao.rotulo }
    : { valor: String(opcao), rotulo: String(opcao) };
}

/*
  Seletor de uma opção, no lugar do <select> nativo: botão que abre uma lista
  (listbox) de botões reais. Setas, Home/End, Enter, Esc e a primeira letra
  funcionam pelo teclado; clicar fora ou escolher uma opção fecha a lista.

  `opcoes` aceita textos ou { valor, rotulo }. `onChange` recebe o valor como
  texto, igual ao `event.target.value` do select que ele substitui.
  `larguraTotal` ocupa a largura do campo em formulários; `required` mantém a
  validação nativa do formulário por um campo oculto.
*/
function SeletorOpcoes({ id, rotulo, opcoes, valor, onChange, icone: Icone, disabled = false, required = false, larguraTotal = false }) {
  const [aberto, setAberto] = useState(false);
  const [indiceFoco, setIndiceFoco] = useState(0);
  const areaRef = useRef(null);
  const botaoRef = useRef(null);
  const opcoesRef = useRef([]);
  const idLista = useId();
  const lista = opcoes.map(normalizarOpcao);
  const valorAtual = valor == null ? '' : String(valor);
  const indiceAtual = Math.max(0, lista.findIndex((opcao) => opcao.valor === valorAtual));
  const selecionada = lista.find((opcao) => opcao.valor === valorAtual);
  const textoAtual = selecionada?.rotulo ?? '';

  useEffect(() => {
    if (!aberto) return undefined;
    function fecharFora(evento) {
      if (!areaRef.current?.contains(evento.target)) setAberto(false);
    }
    document.addEventListener('mousedown', fecharFora);
    return () => document.removeEventListener('mousedown', fecharFora);
  }, [aberto]);

  useEffect(() => {
    if (aberto) opcoesRef.current[indiceFoco]?.focus();
  }, [aberto, indiceFoco]);

  function abrir(indice = indiceAtual) {
    if (disabled) return;
    setIndiceFoco(indice);
    setAberto(true);
  }

  function fechar(devolverFoco = true) {
    setAberto(false);
    if (devolverFoco) botaoRef.current?.focus();
  }

  function escolher(opcao) {
    if (opcao.valor !== valorAtual) onChange(opcao.valor);
    fechar();
  }

  // Mesma busca pela primeira letra do select nativo.
  function indicePorLetra(tecla, aPartirDe) {
    if (tecla.length !== 1 || !/\S/.test(tecla)) return -1;
    const letra = tecla.toLocaleLowerCase('pt-BR');
    for (let passo = 1; passo <= lista.length; passo += 1) {
      const indice = (aPartirDe + passo) % lista.length;
      if (lista[indice].rotulo.toLocaleLowerCase('pt-BR').startsWith(letra)) return indice;
    }
    return -1;
  }

  function teclaNoBotao(evento) {
    if (['ArrowDown', 'ArrowUp'].includes(evento.key)) {
      evento.preventDefault();
      abrir();
      return;
    }
    const indice = indicePorLetra(evento.key, indiceAtual);
    if (indice >= 0) {
      evento.preventDefault();
      abrir(indice);
    }
  }

  function teclaNaLista(evento) {
    const ultimo = lista.length - 1;
    const destinos = {
      ArrowDown: indiceFoco >= ultimo ? 0 : indiceFoco + 1,
      ArrowUp: indiceFoco <= 0 ? ultimo : indiceFoco - 1,
      Home: 0,
      End: ultimo
    };
    if (evento.key in destinos) {
      evento.preventDefault();
      setIndiceFoco(destinos[evento.key]);
    } else if (evento.key === 'Escape') {
      evento.preventDefault();
      evento.stopPropagation();
      fechar();
    } else if (evento.key === 'Tab') {
      fechar(false);
    } else {
      const indice = indicePorLetra(evento.key, indiceFoco);
      if (indice >= 0) {
        evento.preventDefault();
        setIndiceFoco(indice);
      }
    }
  }

  return (
    <div className={`${styles.area} ${larguraTotal ? styles.areaLarga : ''}`} ref={areaRef}>
      <button
        type="button"
        id={id}
        ref={botaoRef}
        className={styles.botao}
        disabled={disabled}
        aria-label={`${rotulo}: ${textoAtual}`}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={aberto ? idLista : undefined}
        onClick={() => (aberto ? fechar() : abrir())}
        onKeyDown={teclaNoBotao}
      >
        {Icone && <Icone size={18} className={styles.icone} aria-hidden="true" />}
        <span className={styles.valor}>{textoAtual}</span>
        <ChevronDown size={18} className={`${styles.seta} ${aberto ? styles.setaAberta : ''}`} aria-hidden="true" />
      </button>

      {required && (
        <input
          className={styles.validacao}
          tabIndex={-1}
          aria-hidden="true"
          required
          value={valorAtual}
          onChange={() => {}}
          onFocus={() => botaoRef.current?.focus()}
        />
      )}

      {aberto && (
        <div id={idLista} className={styles.lista} role="listbox" aria-label={rotulo} onKeyDown={teclaNaLista}>
          {lista.map((opcao, indice) => {
            const ativa = opcao.valor === valorAtual;
            return (
              <button
                type="button"
                key={opcao.valor}
                ref={(elemento) => { opcoesRef.current[indice] = elemento; }}
                role="option"
                aria-selected={ativa}
                tabIndex={indice === indiceFoco ? 0 : -1}
                className={`${styles.opcao} ${ativa ? styles.opcaoSelecionada : ''}`}
                onClick={() => escolher(opcao)}
              >
                <span>{opcao.rotulo}</span>
                {ativa && <Check size={17} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SeletorOpcoes;
