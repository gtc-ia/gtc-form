import test from 'node:test';
import assert from 'node:assert/strict';

import { isEntitlementActive } from '../entitlement.js';

test('inactive when record is null', () => {
  assert.equal(isEntitlementActive(null), false);
});

test('inactive when status missing', () => {
  assert.equal(isEntitlementActive({}), false);
});

test('inactive when status not active', () => {
  assert.equal(
    isEntitlementActive({ status: 'canceled', end_date: new Date(Date.now() + 3600_000).toISOString() }),
    false
  );
});

test('active when status active without end_date', () => {
  assert.equal(isEntitlementActive({ status: 'active', end_date: null }), true);
});

test('active when not expired', () => {
  const future = new Date(Date.now() + 86400_000).toISOString();
  assert.equal(isEntitlementActive({ status: 'trialing', end_date: future }), true);
});

test('inactive when expired', () => {
  const past = new Date(Date.now() - 86400_000).toISOString();
  assert.equal(isEntitlementActive({ status: 'active', end_date: past }), false);
});
