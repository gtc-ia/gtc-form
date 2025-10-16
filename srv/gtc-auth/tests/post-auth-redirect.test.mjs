import test from 'node:test';
import assert from 'node:assert/strict';
import {
  determinePostAuthRedirect,
  extractForwardableParams,
  normalizeUserId
} from '../post-auth-redirect.js';

const noopFetch = async () => ({ is_active: true });

test('string flag from RPC still routes active subscribers to chat', async () => {
  const decision = await determinePostAuthRedirect({
    gtcUserId: '3001',
    fetchEntitlement: async () => ({ is_active: 't' })
  });
  assert.equal(decision.location, 'https://app.gtstor.com/chat/');
  assert.equal(decision.isActive, true);
});

test('status + future end_date imply activity when boolean flag missing', async () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const decision = await determinePostAuthRedirect({
    gtcUserId: '3001',
    fetchEntitlement: async () => ({ status: 'active', end_date: future })
  });
  assert.equal(decision.location, 'https://app.gtstor.com/chat/');
  assert.equal(decision.isActive, true);
});

test('expired trial is treated as inactive even if status is trialing', async () => {
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const decision = await determinePostAuthRedirect({
    gtcUserId: '3001',
    fetchEntitlement: async () => ({ status: 'trialing', end_date: past })
  });
  assert.equal(decision.isActive, false);
  const url = new URL(decision.location);
  assert.equal(url.origin, 'https://pay.gtstor.com');
});

test('buildChatRedirect forwards language hint for active users', async () => {
  const decision = await determinePostAuthRedirect({
    gtcUserId: '3001',
    query: { lang: 'ru' },
    fetchEntitlement: noopFetch
  });
  assert.equal(decision.location, 'https://app.gtstor.com/chat/?lang=ru');
  assert.equal(decision.isActive, true);
});

test('inactive users are routed to the payment portal with their id', async () => {
  const decision = await determinePostAuthRedirect({
    gtcUserId: '3001',
    query: { next: '/chat/history' },
    fetchEntitlement: async () => ({ is_active: false })
  });
  const url = new URL(decision.location);
  assert.equal(url.origin, 'https://pay.gtstor.com');
  assert.equal(url.pathname, '/payment.php');
  assert.equal(url.searchParams.get('user_id'), '3001');
  assert.equal(url.searchParams.get('next'), '/chat/history');
});

test('RPC failures fall back to the payment portal and surface the error', async () => {
  const rpcError = new Error('network down');
  const decision = await determinePostAuthRedirect({
    gtcUserId: '3001',
    fetchEntitlement: async () => {
      throw rpcError;
    }
  });
  const url = new URL(decision.location);
  assert.equal(url.searchParams.get('user_id'), '3001');
  assert.equal(decision.error, rpcError);
});

test('unsafe next parameters are ignored', async () => {
  const decision = await determinePostAuthRedirect({
    gtcUserId: '3001',
    query: { next: 'https://evil.example.com', lang: 'en-US' },
    fetchEntitlement: noopFetch
  });
  const url = new URL(decision.location);
  assert.equal(url.searchParams.get('lang'), 'en-US');
  assert.equal(url.searchParams.has('next'), false);
});

test('normalizeUserId rejects empty or non-numeric identifiers', () => {
  assert.throws(() => normalizeUserId(''), /gtc_user_id_missing/);
  assert.throws(() => normalizeUserId('abc'), /gtc_user_id_invalid/);
});

test('extractForwardableParams trims and validates values', () => {
  const forwarded = extractForwardableParams({ lang: '  ru-RU  ', next: '/chat/history ' });
  assert.deepEqual(forwarded, { lang: 'ru-RU', next: '/chat/history' });
});
