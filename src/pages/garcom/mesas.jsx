import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import GradeMesas, { LegendaMesas } from '../../components/GradeMesas';
import WaiterLayout from '../../components/WaiterLayout';
import { useApp } from '../../context/appContext';
import { statusDaMesa } from '../../utils/statusMesa';
import styles from './garcom.module.css';

const ESTADOS_GARCOM = ['livre', 'aberta', 'pendente', 'cozinha', 'conta', 'outro'];

function MesasGarcom() {
  const { mesas, comandas, abrirComanda } = useApp();
  const navigate = useNavigate();
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);

  function comandaDaMesa(mesa) {
    return comandas.find((item) => item.mesaId === mesa.id && item.status !== 'Encerrada') ?? null;
  }

  async function acessar(mesa) {
    if (processando) return;
    setErro('');
    setProcessando(true);
    try {
      await abrirComanda(mesa.id);
      navigate(`/garcom/comanda/${mesa.id}`);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setProcessando(false);
    }
  }

  const minhas = mesas.filter((mesa) => comandaDaMesa(mesa)).length;
  const livres = mesas.filter((mesa) => mesa.status !== 'Ocupada').length;

  return (
    <WaiterLayout
      titulo="Mesas do salão"
      subtitulo="Toque no número da mesa para abrir a comanda ou continuar o atendimento."
    >
      {erro && <div className={styles.erro} role="alert">{erro}</div>}

      {mesas.length === 0 ? (
        <div className={`${styles.painel} ${styles.vazio}`} role="status">
          Nenhuma mesa foi cadastrada para atendimento.
        </div>
      ) : (
        <section className={`${styles.painel} ${styles.painelSalao}`}>
          <div className={styles.resumoSalao}>
            <div><span>Livres</span><strong>{livres}</strong></div>
            <div><span>Comigo</span><strong>{minhas}</strong></div>
            <div><span>Mesas</span><strong>{mesas.length}</strong></div>
          </div>

          <GradeMesas
            mesas={mesas}
            statusPorMesa={(mesa) => statusDaMesa(mesa, comandaDaMesa(mesa))}
            mesaBloqueada={(mesa, status) => processando || status === 'outro'}
            aoSelecionar={acessar}
          />

          <LegendaMesas estados={ESTADOS_GARCOM} />
        </section>
      )}
    </WaiterLayout>
  );
}

export default MesasGarcom;
