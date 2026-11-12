import assert from 'node:assert/strict';
import test from 'node:test';

/** Espelha a regra do AppointmentModal: vendedor usa o próprio perfil, sem RPC. */
function resolveSellerFormSeed({ role, currentUser, rpcItems, rpcError }) {
  const isSeller = String(role ?? '').toLowerCase() === 'seller';
  if (isSeller) {
    return {
      calledRpc: false,
      sellers: currentUser?.id
        ? [{
            id: currentUser.id,
            fullName: currentUser.fullName || currentUser.email || 'Vendedor',
            email: currentUser.email || '',
          }]
        : [],
      formError: null,
    };
  }
  if (rpcError) {
    return { calledRpc: true, sellers: [], formError: rpcError };
  }
  return { calledRpc: true, sellers: rpcItems || [], formError: null };
}

test('seller form does not call getActiveSellers RPC', () => {
  const result = resolveSellerFormSeed({
    role: 'seller',
    currentUser: {
      id: 'ee3688b3-1fb8-4802-ad5a-ca8f94e19852',
      fullName: 'Vendedor Homolog',
      email: 'vendedor_1794429335830@sandbox.local',
    },
    rpcError: 'Apenas gerentes/avaliadores...',
  });
  assert.equal(result.calledRpc, false);
  assert.equal(result.formError, null);
  assert.equal(result.sellers.length, 1);
  assert.equal(result.sellers[0].email, 'vendedor_1794429335830@sandbox.local');
});

test('admin/evaluator still use RPC list', () => {
  const result = resolveSellerFormSeed({
    role: 'admin',
    currentUser: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', role: 'admin' },
    rpcItems: [{ id: '1', fullName: 'A', email: 'a@x.com' }],
  });
  assert.equal(result.calledRpc, true);
  assert.equal(result.sellers.length, 1);
});

test('admin RPC denial surfaces form error (seller path must not)', () => {
  const denied = resolveSellerFormSeed({
    role: 'admin',
    currentUser: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' },
    rpcError: '42501',
  });
  assert.equal(denied.formError, '42501');
});
