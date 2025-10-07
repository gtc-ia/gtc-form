import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPaymentUrl,
  buildSubscriptionStatusUrl,
  determineSubscriptionRedirect,
  PAYMENT_RETURN_PATH
} from './subscription.mjs';

function createFetchResponse({ ok = true, status = 200, jsonData = {} } = {}) {
  return async () => ({
    ok,
    status,
    async json() {
      return jsonData;
    }
  });
}

test('buildPaymentUrl encodes the user id and return destination', () => {
  const url = new URL(buildPaymentUrl('3001'));
  assert.equal(url.origin, 'https://pay.gtstor.com');
  assert.equal(url.pathname, '/payment.php');
  assert.equal(url.searchParams.get('user_id'), '3001');
  assert.equal(url.searchParams.get('returnTo'), PAYMENT_RETURN_PATH);
});

test('buildSubscriptionStatusUrl targets the auth endpoint', () => {
  const path = buildSubscriptionStatusUrl('3001');
  assert.equal(path, '/auth/subscription_status?gtc_user_id=3001');
});

test('determineSubscriptionRedirect routes existing subscribers directly to chat', async () => {
  const fetchMock = createFetchResponse({ jsonData: { active: true } });
  const target = await determineSubscriptionRedirect('3001', fetchMock);
  assert.equal(target, PAYMENT_RETURN_PATH);
});

test('determineSubscriptionRedirect sends inactive users to the payment portal', async () => {
  const fetchMock = createFetchResponse({ jsonData: { active: false } });
  const target = await determineSubscriptionRedirect('3001', fetchMock);
  const url = new URL(target);
  assert.equal(url.origin, 'https://pay.gtstor.com');
  assert.equal(url.pathname, '/payment.php');
  assert.equal(url.searchParams.get('user_id'), '3001');
  assert.equal(url.searchParams.get('returnTo'), PAYMENT_RETURN_PATH);
});

test('determineSubscriptionRedirect surfaces network errors with the expected message', async () => {
  const fetchMock = async () => {
    throw new Error('network down');
  };
  await assert.rejects(
    () => determineSubscriptionRedirect('3001', fetchMock),
    (error) => error instanceof Error && error.message === 'subscription_check_failed'
  );
});

test('determineSubscriptionRedirect treats non-OK responses as failures', async () => {
  const fetchMock = createFetchResponse({ ok: false, status: 503 });
  await assert.rejects(
    () => determineSubscriptionRedirect('3001', fetchMock),
    (error) => error instanceof Error && error.message === 'subscription_check_failed' && error.status === 503
  );
});
