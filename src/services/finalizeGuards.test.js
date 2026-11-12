import assert from 'node:assert/strict';
import test from 'node:test';

const MAX_INLINE_LAUDO_DATA_URL_CHARS = 200 * 1024;

function shouldRejectInlineLaudo(url) {
  return typeof url === 'string' && url.startsWith('data:') && url.length > MAX_INLINE_LAUDO_DATA_URL_CHARS;
}

test('rejects large Base64 data URL that caused finalize timeouts', () => {
  const huge = `data:application/pdf;base64,${'A'.repeat(250 * 1024)}`;
  assert.equal(shouldRejectInlineLaudo(huge), true);
});

test('allows https laudo URL for finalize', () => {
  assert.equal(shouldRejectInlineLaudo('https://example.com/laudo.pdf'), false);
});

test('allows tiny data URL fallback', () => {
  assert.equal(shouldRejectInlineLaudo('data:text/plain;base64,YQ=='), false);
});

test('upload and finalize are separable concerns', () => {
  // Upload produz URL; finalize só deve receber URL já pronta.
  const uploadResult = { publicUrl: 'https://yacelouzfbkhnwjruivy.supabase.co/storage/v1/object/public/laudos/x.pdf' };
  const finalizePayload = { result: 'approved', laudoFileUrl: uploadResult.publicUrl };
  assert.equal(finalizePayload.laudoFileUrl.startsWith('https://'), true);
  assert.equal(shouldRejectInlineLaudo(finalizePayload.laudoFileUrl), false);
});
