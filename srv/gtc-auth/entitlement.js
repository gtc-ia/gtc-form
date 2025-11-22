import { pool } from './db.js';

const ACTIVE_STATUSES = new Set(['active', 'trialing']);
const DEFAULT_STALENESS_GRACE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const SUBSCRIPTION_STATUS_QUERY = `
  SELECT
    subscription_id,
    gtc_user_id,
    status,
    plan_code,
    start_date,
    end_date,
    stripe_customer_id,
    stripe_subscription_id,
    livemode,
    is_active,
    created_at,
    updated_at
  FROM public.subscriptions
  WHERE gtc_user_id = $1
  ORDER BY
    COALESCE(
      is_active,
      CASE
        WHEN status IS NULL THEN FALSE
        WHEN lower(status) IN ('active', 'trialing') THEN
          CASE
            WHEN end_date IS NULL THEN TRUE
            ELSE end_date > now()
          END
        ELSE FALSE
      END
    ) DESC,
    end_date DESC NULLS LAST,
    updated_at DESC NULLS LAST,
    created_at DESC NULLS LAST
  LIMIT 1
`;

function normalizeUserIdForQuery(value) {
  if (value === undefined || value === null) {
    throw new TypeError('gtc_user_id_required');
  }
  const numeric = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(numeric)) {
    throw new TypeError('gtc_user_id_invalid');
  }
  return numeric;
}

function resolveQueryExecutor(queryImpl) {
  if (typeof queryImpl === 'function') {
    return queryImpl;
  }
  if (queryImpl && typeof queryImpl.query === 'function') {
    return queryImpl.query.bind(queryImpl);
  }
  if (pool && typeof pool.query === 'function') {
    return pool.query.bind(pool);
  }
  throw new TypeError('subscription_query_unavailable');
}

function coerceBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 't', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', 'f', '0', 'no', 'n'].includes(normalized)) return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }
  return parsed;
}

function toIsoString(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function resolveGracePeriodMs() {
  const raw = process.env.SUBSCRIPTION_STALENESS_GRACE_MS;
  if (raw === undefined) {
    return DEFAULT_STALENESS_GRACE_MS;
  }

  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_STALENESS_GRACE_MS;
  }

  return parsed;
}

function computeIsActive({ explicit, status, endDate, updatedAt }) {
  const coerced = coerceBoolean(explicit);
  if (typeof coerced === 'boolean') {
    return { isActive: coerced, reason: coerced ? 'explicit_true_flag' : 'explicit_false_flag' };
  }

  if (!status) {
    return { isActive: false, reason: 'missing_status' };
  }

  const normalizedStatus = String(status).trim().toLowerCase();
  if (!ACTIVE_STATUSES.has(normalizedStatus)) {
    return { isActive: false, reason: 'inactive_status' };
  }

  const parsedEndDate = toDate(endDate);
  const parsedUpdatedAt = toDate(updatedAt);
  const now = Date.now();

  if (parsedEndDate && parsedEndDate.getTime() > now) {
    return { isActive: true, reason: 'active_status_future_end_date' };
  }

  const graceMs = resolveGracePeriodMs();
  if (parsedUpdatedAt && now - parsedUpdatedAt.getTime() <= graceMs) {
    return { isActive: true, reason: 'active_status_recent_update' };
  }

  if (!parsedEndDate) {
    return { isActive: true, reason: 'active_status_no_end_date' };
  }

  return { isActive: false, reason: 'end_date_expired' };
}

function runSubscriptionQuery(executeQuery, gtcUserId) {
  return executeQuery(SUBSCRIPTION_STATUS_QUERY, [gtcUserId]);
}

export async function fetchSubscriptionStatus(gtcUserId, { queryImpl } = {}) {
  const normalizedId = normalizeUserIdForQuery(gtcUserId);
  const executeQuery = resolveQueryExecutor(queryImpl);

  const result = await runSubscriptionQuery(executeQuery, normalizedId);
  const rows = result?.rows ?? [];

  if (rows.length === 0) {
    return {
      is_active: false,
      status: null,
      end_date: null,
      activity_reason: 'no_entitlement_rows'
    };
  }

  const row = rows[0];
  const status = row.status ?? null;
  const endDateIso = toIsoString(row.end_date);
  const startDateIso = toIsoString(row.start_date);
  const createdAtIso = toIsoString(row.created_at);
  const updatedAtIso = toIsoString(row.updated_at);
  const activity = computeIsActive({
    explicit: row.is_active,
    status,
    endDate: row.end_date,
    updatedAt: row.updated_at
  });

  return {
    subscription_id: row.subscription_id ?? null,
    gtc_user_id: row.gtc_user_id ?? normalizedId,
    status,
    plan_code: row.plan_code ?? null,
    start_date: startDateIso,
    end_date: endDateIso,
    stripe_customer_id: row.stripe_customer_id ?? null,
    stripe_subscription_id: row.stripe_subscription_id ?? null,
    livemode: typeof row.livemode === 'boolean' ? row.livemode : coerceBoolean(row.livemode) ?? null,
    created_at: createdAtIso,
    updated_at: updatedAtIso,
    is_active: activity.isActive,
    activity_reason: activity.reason,
    source: 'sql'
  };
}

export const entitlementConfig = Object.freeze({
  query: SUBSCRIPTION_STATUS_QUERY,
  activeStatuses: [...ACTIVE_STATUSES]
});
