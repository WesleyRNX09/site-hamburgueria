import { ChevronLeft, ChevronRight, ScrollText, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import SuperadminLayout from '../../../components/SuperadminLayout';
import { useSuperadmin } from '../../../context/superadminContext';
import styles from './index.module.css';

const PAGINACAO_VAZIA = { pagina: 1, limite: 50, total: 0, paginas: 1 };

/* Rótulos legíveis para as ações que o backend grava. Uma ação nova ainda
   aparece na tela, com o próprio código, em vez de sumir da listagem. */
const ROTULOS_ACAO = {
  'estabelecimento.criado': 'Estabelecimento criado',
  'estabelecimento.atualizado': 'Estabelecimento atualizado',
  'superadministrador.criado': 'Superadministrador criado',
  'superadministrador.ativado': 'Superadministrador reativado',
  'superadministrador.desativado': 'Superadministrador desativado',
  'superadministrador.senha_alterada': 'Senha do superadministrador alterada',
  'administrador.senha_redefinida': 'Senha de administrador redefinida'
};

function rotuloAcao(acao) {
  return ROTULOS_ACAO[acao] ?? acao;
}

function dataHora(valor) {
  if (!valor) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(valor));
}

function resumoDetalhes(detalhes) {
  if (!detalhes || typeof detalhes !== 'object') return '';
  return Object.entries(detalhes)
    .map(([chave, valor]) => `${chave}: ${valor}`)
    .join(' • ');
}

function AuditoriaSuperadmin() {
  const { estabelecimentos, carregarAuditoria } = useSuperadmin();
  const [filtros, setFiltros] = useState({ estabelecimento: '', de: '', ate: '' });
  const [consulta, setConsulta] = useState({ estabelecimento: '', de: '', ate: '', pagina: 1 });
  const [registros, setRegistros] = useState([]);
  const [paginacao, setPaginacao] = useState(PAGINACAO_VAZIA);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  /* O estado de carregamento é ligado junto com a troca de consulta, nos
     próprios handlers: dentro do efeito só entram atualizações assíncronas. */
  useEffect(() => {
    let ativo = true;
    carregarAuditoria(consulta)
      .then((resposta) => {
        if (!ativo) return;
        setRegistros(resposta.registros ?? []);
        setPaginacao(resposta.paginacao ?? PAGINACAO_VAZIA);
        setErro('');
      })
      .catch((falha) => {
        if (!ativo) return;
        setRegistros([]);
        setPaginacao(PAGINACAO_VAZIA);
        setErro(falha.message || 'Não foi possível carregar a auditoria.');
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => { ativo = false; };
  }, [carregarAuditoria, consulta]);

  function filtrar(evento) {
    evento.preventDefault();
    setCarregando(true);
    setConsulta({ ...filtros, pagina: 1 });
  }

  function irPara(pagina) {
    setCarregando(true);
    setConsulta((atual) => ({ ...atual, pagina }));
  }

  return (
    <SuperadminLayout
      titulo="Auditoria"
      subtitulo="Histórico das ações feitas no painel global"
    >
      {erro && <p className={styles.erro} role="alert">{erro}</p>}

      <section className={styles.listaCard}>
        <div className={styles.listaTopo}>
          <div>
            <h2>Registros</h2>
            <p>
              {paginacao.total} registro(s) encontrado(s).
              {paginacao.paginas > 1 ? ` Página ${paginacao.pagina} de ${paginacao.paginas}.` : ''}
            </p>
          </div>
        </div>

        <form className={styles.filtros} onSubmit={filtrar}>
          <label className={styles.campo}>
            <span>Estabelecimento</span>
            <select
              value={filtros.estabelecimento}
              onChange={(evento) => setFiltros((atuais) => ({
                ...atuais, estabelecimento: evento.target.value
              }))}
            >
              <option value="">Todos (inclui ações globais)</option>
              {estabelecimentos.map((item) => (
                <option key={item.id} value={item.id}>{item.nomeFantasia}</option>
              ))}
            </select>
          </label>
          <label className={styles.campo}>
            <span>De</span>
            <input
              type="date"
              value={filtros.de}
              onChange={(evento) => setFiltros((atuais) => ({ ...atuais, de: evento.target.value }))}
            />
          </label>
          <label className={styles.campo}>
            <span>Até</span>
            <input
              type="date"
              value={filtros.ate}
              onChange={(evento) => setFiltros((atuais) => ({ ...atuais, ate: evento.target.value }))}
            />
          </label>
          <button type="submit" className={styles.botaoSecundario} disabled={carregando}>
            <Search size={17} />
            {carregando ? 'Buscando...' : 'Filtrar'}
          </button>
        </form>

        {registros.length === 0 ? (
          <div className={styles.vazio}>
            <ScrollText size={30} />
            <strong>{carregando ? 'Carregando registros...' : 'Nenhum registro encontrado'}</strong>
            <span>Ajuste o estabelecimento ou o período pesquisado.</span>
          </div>
        ) : (
          <>
            <div className={styles.tabelaContainer}>
              <table>
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Ação</th>
                    <th>Estabelecimento</th>
                    <th>Autor</th>
                    <th>Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {registros.map((registro) => (
                    <tr key={registro.id}>
                      <td data-rotulo="Quando">{dataHora(registro.criadoEm)}</td>
                      <td data-rotulo="Ação"><strong>{rotuloAcao(registro.acao)}</strong></td>
                      <td data-rotulo="Estabelecimento">
                        {registro.estabelecimento
                          ? registro.estabelecimento.nomeFantasia
                          : <span className={styles.global}>Global</span>}
                      </td>
                      <td data-rotulo="Autor">
                        {registro.superadministrador?.nome ?? 'Sistema'}
                        {registro.superadministrador?.usuario
                          ? ` (${registro.superadministrador.usuario})`
                          : ''}
                      </td>
                      <td data-rotulo="Detalhes">
                        <small>{resumoDetalhes(registro.detalhes) || '—'}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {paginacao.paginas > 1 && (
              <div className={styles.paginacao}>
                <button
                  type="button"
                  className={styles.botaoSecundario}
                  disabled={carregando || paginacao.pagina <= 1}
                  onClick={() => irPara(paginacao.pagina - 1)}
                >
                  <ChevronLeft size={17} /> Anterior
                </button>
                <span>Página {paginacao.pagina} de {paginacao.paginas}</span>
                <button
                  type="button"
                  className={styles.botaoSecundario}
                  disabled={carregando || paginacao.pagina >= paginacao.paginas}
                  onClick={() => irPara(paginacao.pagina + 1)}
                >
                  Próxima <ChevronRight size={17} />
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </SuperadminLayout>
  );
}

export default AuditoriaSuperadmin;
