import { ESTADOS_MESA, rotuloDoStatus } from '../../utils/statusMesa';
import styles from './index.module.css';

const ESTADOS_PADRAO = ['livre', 'aberta', 'cozinha', 'conta'];

export function LegendaMesas({ estados = ESTADOS_PADRAO }) {
  const visiveis = ESTADOS_MESA.filter((estado) => estados.includes(estado.chave));
  return (
    <ul className={styles.legenda}>
      {visiveis.map((estado) => (
        <li key={estado.chave}>
          <span className={`${styles.marcador} ${styles[estado.chave]}`} aria-hidden="true" />
          {estado.rotulo}
        </li>
      ))}
    </ul>
  );
}

/*
  Grade numerada de mesas: substitui a lista de cards por um mapa do salão
  em que a cor comunica o status e o número é o alvo de toque. O componente
  não conhece regras de negócio — recebe o status já calculado e apenas
  informa qual mesa foi escolhida.
*/
function GradeMesas({
  mesas,
  statusPorMesa,
  selecionadaId = null,
  aoSelecionar,
  mesaBloqueada = () => false,
  rotuloGrade = 'Mesas do salão'
}) {
  return (
    <div className={styles.grade} role="group" aria-label={rotuloGrade}>
      {mesas.map((mesa) => {
        const status = statusPorMesa(mesa);
        const selecionada = selecionadaId != null && String(selecionadaId) === String(mesa.id);
        return (
          <button
            key={mesa.id}
            type="button"
            disabled={mesaBloqueada(mesa, status)}
            aria-pressed={selecionada}
            aria-label={`Mesa ${mesa.numero} — ${rotuloDoStatus(status)}`}
            className={`${styles.mesa} ${styles[status]} ${selecionada ? styles.selecionada : ''}`}
            onClick={() => aoSelecionar(mesa, status)}
          >
            {mesa.numero}
          </button>
        );
      })}
    </div>
  );
}

export default GradeMesas;
