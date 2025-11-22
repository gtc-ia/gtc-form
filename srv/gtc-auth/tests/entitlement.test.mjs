import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSubscriptionStatus } from '../entitlement.js';

function buildQuery(rows) {
  return {
    async query(_sql, params) {
      assert.equal(params[0], 3001);
      return { rows };
    }
  };
}

function withGraceOverride(value, fn) {
  const previous = process.env.SUBSCRIPTION_STALENESS_GRACE_MS;
  if (value === undefined) {
    delete process.env.SUBSCRIPTION_STALENESS_GRACE_MS;
  } else {
    process.env.SUBSCRIPTION_STALENESS_GRACE_MS = String(value);
  }
  return fn().finally(() => {
    if (previous === undefined) {
      delete process.env.SUBSCRIPTION_STALENESS_GRACE_MS;
    } else {
      process.env.SUBSCRIPTION_STALENESS_GRACE_MS = previous;
    }
  });
}

test('active status is honored when updated recently even if the current period has ended', async () => {
  const now = Date.now();
  const endDate = new Date(now - 3 * 24 * 60 * 60 * 1000); // expired three days ago
  const updatedAt = new Date(now - 36 * 60 * 60 * 1000); // touched in the last 2 days
  const rows = [
    {
      subscription_id: 'sub-recent',
      gtc_user_id: 3001,
      status: 'active',
      plan_code: 'standard_monthly',
      start_date: new Date(now - 10 * 24 * 60 * 60 * 1000),
      end_date: endDate,
      created_at: new Date(now - 10 * 24 * 60 * 60 * 1000),
      updated_at: updatedAt,
      stripe_customer_id: 'cus_test',
      stripe_subscription_id: 'sub_test',
      livemode: true
    }
  ];

  await withGraceOverride(21 * 24 * 60 * 60 * 1000, async () => {
    const entitlement = await fetchSubscriptionStatus(3001, { queryImpl: buildQuery(rows) });
    assert.equal(entitlement.is_active, true);
    assert.equal(entitlement.activity_reason, 'active_status_recent_update');
  });
});

test('expired active rows older than the grace window are treated as inactive', async () => {
  const now = Date.now();
  const endDate = new Date(now - 20 * 24 * 60 * 60 * 1000);
  const updatedAt = new Date(now - 15 * 24 * 60 * 60 * 1000);
  const rows = [
    {
      subscription_id: 'sub-stale',
      gtc_user_id: 3001,
      status: 'active',
      plan_code: 'standard_monthly',
      start_date: new Date(now - 40 * 24 * 60 * 60 * 1000),
      end_date: endDate,
      created_at: new Date(now - 40 * 24 * 60 * 60 * 1000),
      updated_at: updatedAt,
      stripe_customer_id: 'cus_test',
      stripe_subscription_id: 'sub_test',
      livemode: true
    }
  ];

  await withGraceOverride(7 * 24 * 60 * 60 * 1000, async () => {
    const entitlement = await fetchSubscriptionStatus(3001, { queryImpl: buildQuery(rows) });
    assert.equal(entitlement.is_active, false);
    assert.equal(entitlement.activity_reason, 'end_date_expired');
  });
});
