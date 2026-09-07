/* Horário de funcionamento estruturado.
 *
 * O administrador cadastra um intervalo por dia da semana e o sistema decide
 * sozinho se a loja aparece aberta ou fechada. As funções abaixo são puras e
 * ficam aqui porque o servidor (autoridade sobre o pedido) e o site público
 * (que precisa reagir sem recarregar a página) usam exatamente a mesma regra.
 *
 * O relógio de referência é o fuso da loja, e não o do servidor nem o do
 * visitante: um cliente viajando continua vendo o horário de atendimento real.
 */

export const FUSO_HORARIO_LOJA = 'America/Sao_Paulo';

/* Índice 0 = domingo, igual a Date#getDay. A ordem de exibição começa na
  segunda-feira, que é como as lanchonetes anunciam o horário. */
export const DIAS_SEMANA = Object.freeze([
  { indice: 0, nome: 'Domingo', curto: 'Dom' },
  { indice: 1, nome: 'Segunda-feira', curto: 'Seg' },
  { indice: 2, nome: 'Terça-feira', curto: 'Ter' },
  { indice: 3, nome: 'Quarta-feira', curto: 'Qua' },
  { indice: 4, nome: 'Quinta-feira', curto: 'Qui' },
  { indice: 5, nome: 'Sexta-feira', curto: 'Sex' },
  { indice: 6, nome: 'Sábado', curto: 'Sáb' }
]);

export const ORDEM_EXIBICAO = Object.freeze([1, 2, 3, 4, 5, 6, 0]);

const DIAS_INGLES = new Map([
  ['Sun', 0], ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6]
]);

function normalizarHora(valor) {
  const hora = String(valor ?? '').trim().slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return '';
  return hora;
}

function emMinutos(hora) {
  const [horas, minutos] = hora.split(':');
  return (Number(horas) * 60) + Number(minutos);
}

/* Aceita o array vindo do formulário ou o JSON gravado no banco e devolve
  sempre os sete dias, em ordem de índice, com horas válidas ou dia fechado. */
export function normalizarHorarios(valor) {
  let recebido = valor;
  if (typeof recebido === 'string') {
    try {
      recebido = JSON.parse(recebido);
    } catch {
      recebido = [];
    }
  }
  const porDia = new Map();
  if (Array.isArray(recebido)) {
    recebido.forEach((item) => {
      const dia = Number(item?.dia);
      if (!Number.isInteger(dia) || dia < 0 || dia > 6 || porDia.has(dia)) return;
      const abre = normalizarHora(item?.abre);
      const fecha = normalizarHora(item?.fecha);
      const aberto = item?.aberto === true && Boolean(abre) && Boolean(fecha) && abre !== fecha;
      porDia.set(dia, { dia, aberto, abre, fecha });
    });
  }
  return DIAS_SEMANA.map(({ indice }) => porDia.get(indice) ?? {
    dia: indice,
    aberto: false,
    abre: '',
    fecha: ''
  });
}

/* Mensagem de erro para o backend recusar o salvamento, ou '' quando a grade
  está coerente. Um dia marcado como aberto precisa dos dois horários, e eles
  não podem ser iguais (intervalo de duração zero). */
export function erroNosHorarios(valor) {
  const recebido = Array.isArray(valor) ? valor : [];
  const invalido = recebido.some((item) => {
    if (item?.aberto !== true) return false;
    const abre = normalizarHora(item?.abre);
    const fecha = normalizarHora(item?.fecha);
    return !abre || !fecha || abre === fecha;
  });
  return invalido
    ? 'Informe horário de abertura e de fechamento diferentes nos dias marcados como abertos.'
    : '';
}

export function horariosVazios() {
  return normalizarHorarios([]);
}

export function algumDiaAberto(horarios) {
  return normalizarHorarios(horarios).some((dia) => dia.aberto);
}

/* Dia da semana e minutos decorridos no fuso da loja. */
function momentoDaLoja(agora, fuso) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(agora);
  const valor = (tipo) => partes.find((parte) => parte.type === tipo)?.value ?? '';
  return {
    dia: DIAS_INGLES.get(valor('weekday')) ?? agora.getDay(),
    minutos: (Number(valor('hour')) * 60) + Number(valor('minute'))
  };
}

/* Um intervalo cujo fechamento é menor que a abertura atravessa a meia-noite
  (18h às 0h30, por exemplo) e continua valendo na madrugada do dia seguinte. */
export function estaAbertoNoHorario(horarios, agora = new Date(), fuso = FUSO_HORARIO_LOJA) {
  const grade = normalizarHorarios(horarios);
  const { dia, minutos } = momentoDaLoja(agora, fuso);
  return grade.some((item) => {
    if (!item.aberto) return false;
    const abre = emMinutos(item.abre);
    const fecha = emMinutos(item.fecha);
    if (fecha > abre) return item.dia === dia && minutos >= abre && minutos < fecha;
    const diaSeguinte = (item.dia + 1) % 7;
    return (item.dia === dia && minutos >= abre) || (diaSeguinte === dia && minutos < fecha);
  });
}

/* Texto exibido no site público, agrupando dias seguidos com o mesmo horário:
  "Segunda a quinta: 18:00 às 23:00". */
export function resumoHorarios(horarios) {
  const grade = normalizarHorarios(horarios);
  const linhas = [];
  let bloco = null;
  const fechar = () => {
    if (!bloco) return;
    const primeiro = DIAS_SEMANA[bloco.dias[0]].nome;
    const ultimo = DIAS_SEMANA[bloco.dias[bloco.dias.length - 1]].nome;
    const titulo = bloco.dias.length === 1
      ? primeiro
      : (bloco.dias.length === 2 ? `${primeiro} e ${ultimo}` : `${primeiro} a ${ultimo}`);
    linhas.push(`${titulo}: ${bloco.abre} às ${bloco.fecha}`);
    bloco = null;
  };
  ORDEM_EXIBICAO.forEach((indice) => {
    const dia = grade[indice];
    if (!dia.aberto) {
      fechar();
      return;
    }
    if (bloco && bloco.abre === dia.abre && bloco.fecha === dia.fecha) {
      bloco.dias.push(indice);
      return;
    }
    fechar();
    bloco = { abre: dia.abre, fecha: dia.fecha, dias: [indice] };
  });
  fechar();
  return linhas.join('\n');
}
