import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertMutableAppointmentId,
  getSelectionAppointment,
  isOccupancyAppointmentId,
  isOccupancyOnlySelection,
  isRealAppointmentId,
} from './appointmentIds.js';

test('detects occupancy synthetic ids', () => {
  assert.equal(isOccupancyAppointmentId('occupancy:2026-12-10:09:00:0'), true);
  assert.equal(isOccupancyAppointmentId('a1111111-1111-4111-8111-111111111101'), false);
});

test('validates real uuid appointment ids', () => {
  assert.equal(isRealAppointmentId('a1111111-1111-4111-8111-111111111101'), true);
  assert.equal(isRealAppointmentId('occupancy:x'), false);
  assert.equal(isRealAppointmentId('not-a-uuid'), false);
});

test('reads appointment from WeeklySchedulePreview selection shape { day, slot }', () => {
  const selection = {
    day: { id: '2026-12-10' },
    slot: {
      time: '09:00',
      appointment: { id: 'occupancy:2026-12-10:09:00:0', isOccupancyOnly: true },
    },
  };
  assert.equal(getSelectionAppointment(selection)?.isOccupancyOnly, true);
  assert.equal(isOccupancyOnlySelection(selection), true);
});

test('wrong-level guard reproduces homolog bug (top-level appointment missing)', () => {
  const selection = {
    day: { id: '2026-12-10' },
    slot: {
      time: '09:00',
      appointment: { id: 'occupancy:2026-12-10:09:00:0', isOccupancyOnly: true },
    },
  };
  // Bug antigo: checava selection.appointment (undefined) e liberava o modal.
  assert.equal(Boolean(selection?.appointment?.isOccupancyOnly), false);
  // Correção: checa selection.slot.appointment
  assert.equal(isOccupancyOnlySelection(selection), true);
});

test('assertMutableAppointmentId blocks occupancy ids before DB calls', () => {
  assert.throws(
    () => assertMutableAppointmentId('occupancy:2026-12-10:09:00:0', 'cancelar'),
    /ocupa|fict[ií]cio|leitura/i,
  );
  assert.equal(
    assertMutableAppointmentId('a1111111-1111-4111-8111-111111111101', 'cancelar'),
    'a1111111-1111-4111-8111-111111111101',
  );
});
