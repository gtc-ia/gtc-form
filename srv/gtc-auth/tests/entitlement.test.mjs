import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSubscriptionStatus } from '../entitlement.js';

function futureDate(days = 1) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function pastDate(days = 1) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

test('fetchSubscriptionStatus queries Postgres with normalized id', async () => {
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
  const result = await fetchSubscriptionStatus(3002, {
    queryImpl: async () => ({ rows: [] })
  });

  assert.equal(result.is_active, false);
  assert.equal(result.status, null);
  assert.equal(result.end_date, null);
});

test('expired subscriptions are treated as inactive', async () => {
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
