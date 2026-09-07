import assert from 'node:assert/strict';
import test from 'node:test';

import {
  algumDiaAberto,
  erroNosHorarios,
  estaAbertoNoHorario,
  horariosVazios,
  normalizarHorarios,
  resumoHorarios
} from './horarios.js';

function grade(dias) {
  return horariosVazios().map((dia) => ({ ...dia, ...(dias[dia.dia] ?? {}) }));
}

test('normaliza a grade recebida e descarta horários inválidos', () => {
  const horarios = normalizarHorarios([
    { dia: 1, aberto: true, abre: '18:00', fecha: '23:00' },
    { dia: 2, aberto: true, abre: '25:00', fecha: '23:00' },
    { dia: 3, aberto: true, abre: '18:00', fecha: '18:00' },
    { dia: 9, aberto: true, abre: '10:00', fecha: '12:00' }
  ]);
  assert.equal(horarios.length, 7);
  assert.deepEqual(horarios[1], { dia: 1, aberto: true, abre: '18:00', fecha: '23:00' });
  assert.equal(horarios[2].aberto, false);
  assert.equal(horarios[3].aberto, false);
  assert.equal(horarios.some((dia) => dia.dia === 9), false);
});

test('aceita a grade gravada como texto JSON e o valor ausente', () => {
  const salvo = JSON.stringify([{ dia: 5, aberto: true, abre: '18:00', fecha: '00:30' }]);
  assert.equal(normalizarHorarios(salvo)[5].aberto, true);
  assert.equal(algumDiaAberto(normalizarHorarios('texto quebrado')), false);
  assert.equal(algumDiaAberto(normalizarHorarios(null)), false);
});

test('recusa dia aberto sem horários válidos', () => {
  assert.match(erroNosHorarios([{ dia: 1, aberto: true, abre: '', fecha: '23:00' }]), /abertura/);
  assert.match(erroNosHorarios([{ dia: 1, aberto: true, abre: '19:00', fecha: '19:00' }]), /diferentes/);
  assert.equal(erroNosHorarios([{ dia: 1, aberto: false, abre: '', fecha: '' }]), '');
  assert.equal(erroNosHorarios([{ dia: 1, aberto: true, abre: '19:00', fecha: '23:00' }]), '');
});

test('a loja abre e fecha sozinha conforme o relógio do fuso da loja', () => {
  const horarios = grade({ 1: { aberto: true, abre: '19:00', fecha: '23:00' } });
  // Segunda-feira, 2026-09-07, no fuso de São Paulo (UTC-3).
  const dezoito = new Date('2026-09-07T21:00:00Z');
  const dezenove = new Date('2026-09-07T22:00:00Z');
  const vinteETres = new Date('2026-09-08T02:00:00Z');
  assert.equal(estaAbertoNoHorario(horarios, dezoito), false);
  assert.equal(estaAbertoNoHorario(horarios, dezenove), true);
  assert.equal(estaAbertoNoHorario(horarios, vinteETres), false);
});

test('intervalo que atravessa a meia-noite continua valendo na madrugada', () => {
  const horarios = grade({ 5: { aberto: true, abre: '18:00', fecha: '00:30' } });
  // Sexta 23h e sábado 0h15, no fuso da loja.
  assert.equal(estaAbertoNoHorario(horarios, new Date('2026-09-12T02:00:00Z')), true);
  assert.equal(estaAbertoNoHorario(horarios, new Date('2026-09-12T03:15:00Z')), true);
  assert.equal(estaAbertoNoHorario(horarios, new Date('2026-09-12T04:00:00Z')), false);
});

test('grade sem nenhum dia aberto mantém a loja fechada', () => {
  assert.equal(estaAbertoNoHorario(horariosVazios(), new Date('2026-09-07T22:00:00Z')), false);
});

test('resume os horários agrupando dias seguidos iguais', () => {
  const horarios = grade({
    1: { aberto: true, abre: '18:00', fecha: '23:00' },
    2: { aberto: true, abre: '18:00', fecha: '23:00' },
    3: { aberto: true, abre: '18:00', fecha: '23:00' },
    4: { aberto: true, abre: '18:00', fecha: '23:00' },
    5: { aberto: true, abre: '18:00', fecha: '00:30' },
    6: { aberto: true, abre: '18:00', fecha: '00:30' }
  });
  assert.equal(
    resumoHorarios(horarios),
    'Segunda-feira a Quinta-feira: 18:00 às 23:00\nSexta-feira e Sábado: 18:00 às 00:30'
  );
  assert.equal(resumoHorarios(horariosVazios()), '');
});
