import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isExternalLaudoUrl,
  isInlineLaudoDataUrl,
  isStorageLaudoRef,
  toLaudoStoragePath,
  toPersistedLaudoRef,
} from './laudoRefs.js';

const PATH =
  '11111111-1111-4111-8111-111111111111/a1111111-1111-4111-8111-111111111102/smoke.pdf';

test('toLaudoStoragePath extracts durable path from legacy public URL', () => {
  const publicUrl = `https://yacelouzfbkhnwjruivy.supabase.co/storage/v1/object/public/laudos/${PATH}`;
  assert.equal(toLaudoStoragePath(publicUrl), PATH);
  assert.equal(toPersistedLaudoRef(publicUrl), PATH);
});

test('toLaudoStoragePath strips query from signed URL and keeps path', () => {
  const signed = `https://yacelouzfbkhnwjruivy.supabase.co/storage/v1/object/sign/laudos/${PATH}?token=abc`;
  assert.equal(toLaudoStoragePath(signed), PATH);
  assert.equal(toPersistedLaudoRef(signed), PATH);
});

test('raw path is persisted as-is', () => {
  assert.equal(toPersistedLaudoRef(PATH), PATH);
  assert.equal(isStorageLaudoRef(PATH), true);
});

test('external https and data: stay as external/inline refs', () => {
  assert.equal(isExternalLaudoUrl('https://drive.google.com/file/x'), true);
  assert.equal(toLaudoStoragePath('https://drive.google.com/file/x'), null);
  assert.equal(toPersistedLaudoRef('https://drive.google.com/file/x'), 'https://drive.google.com/file/x');
  assert.equal(isInlineLaudoDataUrl('data:application/pdf;base64,YQ=='), true);
  assert.equal(toPersistedLaudoRef('data:application/pdf;base64,YQ=='), 'data:application/pdf;base64,YQ==');
});
