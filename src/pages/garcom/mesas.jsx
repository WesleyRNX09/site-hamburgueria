import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import GradeMesas from '../../components/GradeMesas';
import WaiterLayout from '../../components/WaiterLayout';
import { useApp } from '../../context/appContext';
import { statusDaMesa } from '../../utils/statusMesa';
import styles from './garcom.module.css';

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
          {/* Só a grade: no salão o garçom precisa do número da mesa, não de
              resumo nem de legenda ocupando a tela do celular. */}
          <GradeMesas
            mesas={mesas}
            statusPorMesa={(mesa) => statusDaMesa(mesa, comandaDaMesa(mesa))}
            mesaBloqueada={() => processando}
            aoSelecionar={acessar}
          />
        </section>
      )}
    </WaiterLayout>
  );
}

export default MesasGarcom;
