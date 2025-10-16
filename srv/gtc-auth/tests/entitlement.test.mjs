import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchSubscriptionStatus,
  setEntitlementFallbackFetch,
  getEntitlementFallbackFetch
} from '../entitlement.js';

const ORIGINAL_FALLBACK = getEntitlementFallbackFetch();

test.after(() => {
  setEntitlementFallbackFetch(ORIGINAL_FALLBACK);
});

test('fetchSubscriptionStatus posts normalized numeric id to the RPC', async () => {
  let captured;
  const response = {
    ok: true,
    json: async () => ({ is_active: true })
  };
  const fakeFetch = async (url, options) => {
    captured = { url, options };
    return response;
  };

  const result = await fetchSubscriptionStatus(' 3001 ', { fetchImpl: fakeFetch });

  assert.deepEqual(result, { is_active: true });
  assert.equal(captured.url, 'https://app.gtstor.com/api/rpc/subscription_status');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(captured.options.body), { p_gtc_user_id: 3001 });
  assert.equal(typeof captured.options.signal, 'object');
  assert.equal(typeof captured.options.signal?.aborted, 'boolean');
});

test('non-ok RPC responses bubble up with entitlement_request_failed', async () => {
  await assert.rejects(
    () =>
      fetchSubscriptionStatus(3001, {
        fetchImpl: async () => ({ ok: false, status: 503 })
      }),
    (error) => error.message === 'entitlement_request_failed' && error.status === 503
  );
});

test('default global fetch is used when no override provided', async () => {
  const originalFetch = globalThis.fetch;
  let invoked = false;
  globalThis.fetch = async () => {
    invoked = true;
    return { ok: true, json: async () => ({ status: 'active' }) };
  };

  try {
    const result = await fetchSubscriptionStatus(3001);
    assert.deepEqual(result, { status: 'active' });
    assert.equal(invoked, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fallback fetch implementation is used when global fetch is absent', async () => {
  const originalFetch = globalThis.fetch;
  const originalFallback = getEntitlementFallbackFetch();
  let invoked = false;
  const fakeFallback = async () => {
    invoked = true;
    return { ok: true, json: async () => ({ is_active: 't' }) };
  };

  try {
    globalThis.fetch = undefined;
    setEntitlementFallbackFetch(fakeFallback);

    const result = await fetchSubscriptionStatus('3001');
    assert.equal(invoked, true);
    assert.deepEqual(result, { is_active: 't' });
  } finally {
    globalThis.fetch = originalFetch;
    setEntitlementFallbackFetch(originalFallback);
  }
});

test('setEntitlementFallbackFetch enforces function contract', () => {
  assert.throws(() => setEntitlementFallbackFetch(null), /fallback_fetch_must_be_function/);
});
