import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchSubscriptionStatus,
  entitlementConfig,
  __setSubscriptionQueryVariant,
  __resetSubscriptionEmailQueryVariant
} from '../entitlement.js';

function futureDate(days = 1) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function pastDate(days = 1) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function resetVariants() {
  __setSubscriptionQueryVariant('primary');
  __resetSubscriptionEmailQueryVariant();
}

test('fetchSubscriptionStatus queries Postgres with normalized id', async () => {
  resetVariants();
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
  assert.equal(result.lookup_strategy, 'gtc_user_id');
  assert.match(result.end_date, /Z$/);
});

test('missing subscription rows default to inactive state', async () => {
  resetVariants();
  const result = await fetchSubscriptionStatus(3002, {
    queryImpl: async () => ({ rows: [] })
  });

  assert.equal(result.is_active, false);
  assert.equal(result.status, null);
  assert.equal(result.end_date, null);
  assert.equal(result.lookup_strategy, 'gtc_user_id');
});

test('expired subscriptions are treated as inactive', async () => {
  resetVariants();
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
  assert.equal(result.lookup_strategy, 'gtc_user_id');
});

test('active status without end date is considered active', async () => {
  resetVariants();
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
  resetVariants();
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

test('future end dates keep access even when boolean flag is false', async () => {
  resetVariants();
  const result = await fetchSubscriptionStatus(3005, {
    queryImpl: async () => ({
      rows: [
        {
          status: 'canceled',
          end_date: futureDate(),
          is_active: false
        }
      ]
    })
  });

  assert.equal(result.is_active, true);
});

test('active status without end date stays active despite false boolean flag', async () => {
  resetVariants();
  const result = await fetchSubscriptionStatus(3005, {
    queryImpl: async () => ({
      rows: [
        {
          status: 'active',
          end_date: null,
          is_active: false
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
  resetVariants();
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
  __resetSubscriptionEmailQueryVariant();
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

test('falls back to email-linked subscription when user id lookup returns no rows', async () => {
  resetVariants();
  const emails = ['user@example.com'];
  const calls = [];
  const fakeQuery = async (sql, params) => {
    calls.push(sql);
    if (sql === entitlementConfig.query) {
      return { rows: [] };
    }
    if (sql.includes('FROM public.auth_email')) {
      assert.deepEqual(params, [3008]);
      return {
        rows: emails.map((email) => ({ email }))
      };
    }
    if (sql.includes('stripe_customer_email')) {
      return {
        rows: [
          {
            status: 'active',
            end_date: futureDate(),
            created_at: pastDate(),
            updated_at: futureDate(),
            is_active: true
          }
        ]
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const result = await fetchSubscriptionStatus(3008, { queryImpl: fakeQuery });

  assert.equal(result.is_active, true);
  assert.equal(result.lookup_strategy, 'email');
  assert.deepEqual(result.lookup_emails, emails);
  assert.ok(calls.some((sql) => sql.includes('stripe_customer_email')));
});

test('falls back to email-linked subscription when user id row is inactive', async () => {
  resetVariants();
  const emails = ['user@example.com'];
  const past = pastDate();
  const future = futureDate();
  const fakeQuery = async (sql, params) => {
    if (sql === entitlementConfig.query) {
      assert.deepEqual(params, [3009]);
      return {
        rows: [
          {
            status: 'canceled',
            end_date: past,
            is_active: false,
            created_at: past,
            updated_at: past
          }
        ]
      };
    }
    if (sql.includes('FROM public.auth_email')) {
      return {
        rows: emails.map((email) => ({ email }))
      };
    }
    if (sql.includes('stripe_customer_email')) {
      return {
        rows: [
          {
            status: 'trialing',
            end_date: future,
            created_at: past,
            updated_at: future,
            is_active: false
          }
        ]
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const result = await fetchSubscriptionStatus(3009, { queryImpl: fakeQuery });

  assert.equal(result.is_active, true);
  assert.equal(result.lookup_strategy, 'email');
  assert.deepEqual(result.lookup_emails, emails);
});
