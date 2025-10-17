import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchSubscriptionStatus,
  entitlementConfig,
  __setSubscriptionQueryVariant
} from '../entitlement.js';

function futureDate(days = 1) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function pastDate(days = 1) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

test('fetchSubscriptionStatus queries Postgres with normalized id', async () => {
  __setSubscriptionQueryVariant('primary');
  let captured;
  const fakeQuery = async (sql, params) => {
    captured = { sql, params };
    return {
      rows: [
        {
          subscription_id: 42,
          gtc_user_id: 3001,
          status: 'active',
          end_date: futureDate(),
          plan_code: 'pro',
          stripe_customer_id: 'cus_123',
          stripe_subscription_id: 'sub_123',
          created_at: futureDate(-1),
          updated_at: futureDate()
        }
      ]
    };
  };

  const result = await fetchSubscriptionStatus(' 3001 ', { queryImpl: fakeQuery });

  assert.ok(captured.sql.includes('FROM public.subscriptions'));
  assert.deepEqual(captured.params, [3001]);
  assert.equal(result.status, 'active');
  assert.equal(result.plan_code, 'pro');
  assert.equal(result.is_active, true);
  assert.equal(result.source, 'sql');
  assert.match(result.end_date, /Z$/);
});

test('missing subscription rows default to inactive state', async () => {
  __setSubscriptionQueryVariant('primary');
  const result = await fetchSubscriptionStatus(3002, {
    queryImpl: async () => ({ rows: [] })
  });

  assert.equal(result.is_active, false);
  assert.equal(result.status, null);
  assert.equal(result.end_date, null);
});

test('expired subscriptions are treated as inactive', async () => {
  __setSubscriptionQueryVariant('primary');
  const result = await fetchSubscriptionStatus('3003', {
    queryImpl: async () => ({
      rows: [
        {
          status: 'trialing',
          end_date: pastDate(),
          updated_at: pastDate()
        }
      ]
    })
  });

  assert.equal(result.is_active, false);
});

test('active status without end date is considered active', async () => {
  __setSubscriptionQueryVariant('primary');
  const result = await fetchSubscriptionStatus(3004, {
    queryImpl: async () => ({
      rows: [
        {
          status: 'active',
          end_date: null
        }
      ]
    })
  });

  assert.equal(result.is_active, true);
});

test('boolean flags from SQL override computed status', async () => {
  __setSubscriptionQueryVariant('primary');
  const result = await fetchSubscriptionStatus(3005, {
    queryImpl: async () => ({
      rows: [
        {
          status: 'canceled',
          end_date: futureDate(),
          is_active: true
        }
      ]
    })
  });

  assert.equal(result.is_active, true);
});

test('subscription query prioritizes active rows ahead of stale history', () => {
  assert.match(entitlementConfig.query, /COALESCE\s*\(\s*is_active/);
  assert.match(
    entitlementConfig.query,
    /COALESCE[\s\S]+end_date DESC NULLS LAST,\s*updated_at DESC NULLS LAST,\s*created_at DESC NULLS LAST/s
  );
});

test('falls back to legacy subscription query when is_active column missing', async () => {
  __setSubscriptionQueryVariant('primary');
  const calls = [];
  const fakeQuery = async (sql, params) => {
    calls.push(sql);
    if (calls.length === 1) {
      const error = new Error('column "is_active" does not exist');
      error.code = '42703';
      throw error;
    }
    assert.deepEqual(params, [3006]);
    return {
      rows: [
        {
          status: 'active',
          end_date: futureDate(),
          created_at: futureDate(-2),
          updated_at: futureDate()
        }
      ]
    };
  };

  const result = await fetchSubscriptionStatus(3006, { queryImpl: fakeQuery });

  assert.equal(calls.length, 2);
  assert.equal(calls[0], entitlementConfig.query);
  assert.equal(calls[1], entitlementConfig.legacyQuery);
  assert.equal(result.is_active, true);
  assert.equal(result.source, 'sql');
});

test('legacy query is reused after detection', async () => {
  __setSubscriptionQueryVariant('legacy');
  let callCount = 0;
  const fakeQuery = async (sql) => {
    callCount += 1;
    assert.equal(sql, entitlementConfig.legacyQuery);
    return {
      rows: [
        {
          status: 'active',
          end_date: futureDate(),
          created_at: futureDate(-2),
          updated_at: futureDate()
        }
      ]
    };
  };

  const result = await fetchSubscriptionStatus(3007, { queryImpl: fakeQuery });

  assert.equal(callCount, 1);
  assert.equal(result.is_active, true);
});
