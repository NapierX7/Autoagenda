import assert from 'node:assert/strict';
import test from 'node:test';
import { mapAppointmentRecord } from '../utils/appointmentMapper.js';
import {
  isOversizedInlineLaudoDataUrl,
  LAUDO_LIMITS,
} from '../utils/laudoLimits.js';

test('LAUDO limits: inline file bytes align with finalize data-URL char limit', () => {
  assert.ok(LAUDO_LIMITS.MAX_INLINE_FILE_BYTES < LAUDO_LIMITS.MAX_INLINE_DATA_URL_CHARS);
  assert.equal(LAUDO_LIMITS.FALLBACK_MAX_BASE64_BYTES, LAUDO_LIMITS.MAX_INLINE_FILE_BYTES);
  assert.ok(LAUDO_LIMITS.MAX_INLINE_FILE_BYTES < 200 * 1024);
  assert.ok(LAUDO_LIMITS.MAX_STORAGE_UPLOAD_BYTES > LAUDO_LIMITS.MAX_INLINE_FILE_BYTES);
});

test('isOversizedInlineLaudoDataUrl uses the real shared constant', () => {
  const huge = `data:application/pdf;base64,${'A'.repeat(LAUDO_LIMITS.MAX_INLINE_DATA_URL_CHARS)}`;
  assert.equal(isOversizedInlineLaudoDataUrl(huge), true);
  assert.equal(isOversizedInlineLaudoDataUrl('https://example.com/laudo.pdf'), false);
  assert.equal(isOversizedInlineLaudoDataUrl('data:text/plain;base64,YQ=='), false);
});

test('mapAppointmentRecord keeps UI contract for full DB row', () => {
  const mapped = mapAppointmentRecord({
    id: 'a1111111-1111-4111-8111-111111111102',
    appointment_date: '2026-12-10',
    appointment_time: '10:00:00',
    customer_name: 'Cliente S2',
    customer_phone: '11999990002',
    customer_cpf: null,
    seller_name: 'Seller2',
    seller_email: 'req_ok_1794430011469@example.com',
    vehicle_plate: 'BBB2B22',
    vehicle_model: 'Gol',
    vehicle_year: 2021,
    status: 'completed',
    laudo_result: 'approved',
    laudo_finalized_at: '2026-11-12T10:00:00Z',
    is_voucher: false,
    is_encaixe: false,
    rescheduled_count: 0,
  });
  assert.equal(mapped.appointmentDate, '2026-12-10');
  assert.equal(mapped.time, '10:00');
  assert.equal(mapped.customerName, 'Cliente S2');
  assert.equal(mapped.vehicleYear, '2021');
  assert.equal(mapped.status, 'completed');
});

test('mapAppointmentRecord on short finalize select reproduces homolog gap', () => {
  const short = mapAppointmentRecord({
    id: 'a1111111-1111-4111-8111-111111111102',
    status: 'completed',
    laudo_result: 'approved',
    laudo_finalized_at: '2026-11-12T10:00:00Z',
    laudo_file_url: null,
    laudo_file_name: null,
  });
  assert.equal(short.appointmentDate, null);
  assert.equal(short.time, '');
  assert.equal(short.customerName, '');
  assert.equal(short.vehicleYear, '');
});

test('upload URL and finalize payload stay separable', () => {
  const uploadResult = {
    publicUrl: 'https://yacelouzfbkhnwjruivy.supabase.co/storage/v1/object/public/laudos/x.pdf',
  };
  const finalizePayload = { result: 'approved', laudoFileUrl: uploadResult.publicUrl };
  assert.equal(finalizePayload.laudoFileUrl.startsWith('https://'), true);
  assert.equal(isOversizedInlineLaudoDataUrl(finalizePayload.laudoFileUrl), false);
});
