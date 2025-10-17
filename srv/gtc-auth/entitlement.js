import { createHash } from 'node:crypto';
import { pool } from './db.js';

const ACTIVE_STATUSES = new Set(['active', 'trialing']);
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

const LEGACY_SUBSCRIPTION_STATUS_QUERY = `
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
    NULL::boolean AS is_active,
    created_at,
    updated_at
  FROM public.subscriptions
  WHERE gtc_user_id = $1
  ORDER BY
    CASE
      WHEN status IS NULL THEN FALSE
      WHEN lower(status) IN ('active', 'trialing') THEN
        CASE
          WHEN end_date IS NULL THEN TRUE
          ELSE end_date > now()
        END
      ELSE FALSE
    END DESC,
    end_date DESC NULLS LAST,
    updated_at DESC NULLS LAST,
    created_at DESC NULLS LAST
  LIMIT 1
`;

const USER_EMAILS_QUERY = `
  SELECT lower(email) AS email
  FROM (
    SELECT email FROM public.auth_email WHERE user_id = $1
    UNION
    SELECT email FROM public.auth_google WHERE user_id = $1
  ) AS emails
  WHERE email IS NOT NULL
`;

const EMAIL_QUERY_TEMPLATES = [
  {
    column: 'stripe_customer_email',
    sql: (column) => `
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
      WHERE lower(${column}) = ANY($1)
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
    `
  },
  {
    column: 'customer_email',
    sql: (column) => `
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
      WHERE lower(${column}) = ANY($1)
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
    `
  },
  {
    column: 'email',
    sql: (column) => `
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
      WHERE lower(${column}) = ANY($1)
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
    `
  }
];

const UNDEFINED_COLUMN_CODE = '42703';

let subscriptionQueryVariant = 'primary';
let emailQueryVariant;
const unavailableEmailColumns = new Set();

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

async function runSubscriptionQuery(executeQuery, normalizedId) {
  if (subscriptionQueryVariant === 'legacy') {
    return executeQuery(LEGACY_SUBSCRIPTION_STATUS_QUERY, [normalizedId]);
  }

  try {
    return await executeQuery(SUBSCRIPTION_STATUS_QUERY, [normalizedId]);
  } catch (error) {
    if (error && error.code === UNDEFINED_COLUMN_CODE) {
      subscriptionQueryVariant = 'legacy';
      return executeQuery(LEGACY_SUBSCRIPTION_STATUS_QUERY, [normalizedId]);
    }
    throw error;
  }
}

async function runUserEmailQuery(executeQuery, normalizedId) {
  const result = await executeQuery(USER_EMAILS_QUERY, [normalizedId]);
  const rows = result?.rows ?? [];
  const emails = rows
    .map((row) => (row?.email ? String(row.email).trim().toLowerCase() : ''))
    .filter((email) => email);
  return Array.from(new Set(emails));
}

function resolveEmailQueryTemplate(column) {
  return EMAIL_QUERY_TEMPLATES.find((candidate) => candidate.column === column);
}

function resolveLogger(logger) {
  if (logger && typeof logger === 'object') {
    return logger;
  }
  return console;
}

function emitLog(logger, level, message, payload) {
  const targetLogger = resolveLogger(logger);
  const fn = typeof targetLogger?.[level] === 'function' ? targetLogger[level] : targetLogger.log;
  if (typeof fn !== 'function') {
    return;
  }
  try {
    fn.call(targetLogger, message, payload);
  } catch (err) {
    // Logging should never crash the flow – swallow errors silently
  }
}

function serializeError(error) {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const serialized = {
    message: error.message,
    code: error.code,
    name: error.name
  };
  if (error.severity) {
    serialized.severity = error.severity;
  }
  if (error.detail) {
    serialized.detail = error.detail;
  }
  if (error.hint) {
    serialized.hint = error.hint;
  }
  return serialized;
}

function anonymizeEmailForLog(email) {
  if (typeof email !== 'string') {
    return null;
  }
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  const [, domain = null] = normalized.split('@');
  return domain ? `sha256:${hash}@${domain}` : `sha256:${hash}`;
}

function anonymizeEmailsForLog(emails = []) {
  return emails
    .map(anonymizeEmailForLog)
    .filter(Boolean);
}

async function runEmailSubscriptionQuery(executeQuery, emails, { logger, gtcUserId, phase } = {}) {
  if (!emails || emails.length === 0) {
    emitLog(logger, 'info', 'entitlement.lookup.email_skipped', {
      gtcUserId,
      phase,
      reason: 'no_emails'
    });
    return null;
  }

  const orderedCandidates = [];
  if (emailQueryVariant && emailQueryVariant !== 'unavailable') {
    const preferred = resolveEmailQueryTemplate(emailQueryVariant);
    if (preferred && !unavailableEmailColumns.has(preferred.column)) {
      orderedCandidates.push(preferred);
    } else if (preferred && unavailableEmailColumns.has(preferred.column)) {
      emailQueryVariant = undefined;
    }
  }

  for (const candidate of EMAIL_QUERY_TEMPLATES) {
    if (unavailableEmailColumns.has(candidate.column)) {
      continue;
    }
    if (orderedCandidates.some((existing) => existing.column === candidate.column)) {
      continue;
    }
    orderedCandidates.push(candidate);
  }

  const tried = new Set();

  for (const candidate of orderedCandidates) {
    if (!candidate || tried.has(candidate.column)) {
      continue;
    }
    tried.add(candidate.column);

    try {
      const result = await executeQuery(candidate.sql(candidate.column), [emails]);
      const rows = result?.rows ?? [];
      if (rows.length > 0) {
        emailQueryVariant = candidate.column;
        emitLog(logger, 'info', 'entitlement.lookup.email_candidate_success', {
          gtcUserId,
          phase,
          column: candidate.column,
          rowCount: rows.length
        });
        return result;
      }
      emitLog(logger, 'info', 'entitlement.lookup.email_candidate_empty', {
        gtcUserId,
        phase,
        column: candidate.column,
        rowCount: 0
      });
    } catch (error) {
      if (error && error.code === UNDEFINED_COLUMN_CODE) {
        unavailableEmailColumns.add(candidate.column);
        emitLog(logger, 'warn', 'entitlement.lookup.email_column_unavailable', {
          gtcUserId,
          phase,
          column: candidate.column,
          error: serializeError(error)
        });
        continue;
      }
      emitLog(logger, 'error', 'entitlement.lookup.email_candidate_failed', {
        gtcUserId,
        phase,
        column: candidate.column,
        error: serializeError(error)
      });
      throw error;
    }
  }

  if (orderedCandidates.length === 0 && EMAIL_QUERY_TEMPLATES.every(({ column }) => unavailableEmailColumns.has(column))) {
    emailQueryVariant = 'unavailable';
    emitLog(logger, 'warn', 'entitlement.lookup.email_columns_unavailable', {
      gtcUserId,
      phase,
      unavailableColumns: Array.from(unavailableEmailColumns)
    });
  } else {
    emitLog(logger, 'info', 'entitlement.lookup.email_candidates_exhausted', {
      gtcUserId,
      phase,
      triedColumns: Array.from(tried)
    });
  }

  return null;
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

function computeIsActive({ explicit, status, endDate }) {
  const parsedEndDate = toDate(endDate);
  const hasFutureEndDate = parsedEndDate ? parsedEndDate.getTime() >= Date.now() : false;
  const normalizedStatus = status ? String(status).trim().toLowerCase() : '';
  const hasActiveStatus = normalizedStatus ? ACTIVE_STATUSES.has(normalizedStatus) : false;
  const coerced = coerceBoolean(explicit);

  if (coerced === true) {
    return true;
  }

  if (hasFutureEndDate) {
    return true;
  }

  if (hasActiveStatus && !parsedEndDate) {
    return true;
  }

  if (coerced === false) {
    return false;
  }

  return false;
}

function mapSubscriptionRow(row, normalizedId) {
  const status = row.status ?? null;
  const endDateIso = toIsoString(row.end_date);
  const startDateIso = toIsoString(row.start_date);
  const createdAtIso = toIsoString(row.created_at);
  const updatedAtIso = toIsoString(row.updated_at);

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
    is_active: computeIsActive({
      explicit: row.is_active,
      status,
      endDate: row.end_date
    }),
    source: 'sql'
  };
}

function buildDefaultEntitlement(normalizedId) {
  return {
    subscription_id: null,
    gtc_user_id: normalizedId,
    status: null,
    plan_code: null,
    start_date: null,
    end_date: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    livemode: null,
    created_at: null,
    updated_at: null,
    is_active: false,
    source: 'sql'
  };
}

export async function fetchSubscriptionStatus(gtcUserId, options = {}) {
  const { queryImpl, logger } = options;
  const normalizedId = normalizeUserIdForQuery(gtcUserId);
  const executeQuery = resolveQueryExecutor(queryImpl);
  const logBase = { gtcUserId: normalizedId };

  emitLog(logger, 'info', 'entitlement.lookup.start', {
    ...logBase,
    subscriptionQueryVariant
  });

  const initialVariant = subscriptionQueryVariant;

  let result;
  try {
    result = await runSubscriptionQuery(executeQuery, normalizedId);
  } catch (error) {
    emitLog(logger, 'error', 'entitlement.lookup.primary_failed', {
      ...logBase,
      initialVariant,
      error: serializeError(error)
    });
    throw error;
  }
  const rows = result?.rows ?? [];

  emitLog(logger, 'info', 'entitlement.lookup.primary_complete', {
    ...logBase,
    initialVariant,
    finalVariant: subscriptionQueryVariant,
    rowCount: rows.length
  });

  if (rows.length > 0) {
    const entitlement = mapSubscriptionRow(rows[0], normalizedId);
    entitlement.lookup_strategy = 'gtc_user_id';
    emitLog(logger, 'info', 'entitlement.lookup.primary_row_evaluated', {
      ...logBase,
      rowCount: rows.length,
      isActive: entitlement.is_active,
      status: entitlement.status,
      endDate: entitlement.end_date
    });
    if (entitlement.is_active) {
      emitLog(logger, 'info', 'entitlement.lookup.resolved', {
        ...logBase,
        resolution: 'primary_active',
        lookupStrategy: entitlement.lookup_strategy,
        isActive: entitlement.is_active,
        status: entitlement.status,
        endDate: entitlement.end_date,
        subscriptionQueryVariant,
        emailQueryVariant: emailQueryVariant === 'unavailable' ? null : emailQueryVariant,
        lookupEmails: []
      });
      return entitlement;
    }

    const emails = await runUserEmailQuery(executeQuery, normalizedId);
    emitLog(logger, 'info', 'entitlement.lookup.email_candidates', {
      ...logBase,
      phase: 'primary_inactive',
      emailCount: emails.length,
      emails: anonymizeEmailsForLog(emails)
    });
    const emailResult = await runEmailSubscriptionQuery(executeQuery, emails, {
      logger,
      gtcUserId: normalizedId,
      phase: 'primary_inactive'
    });
    const emailRows = emailResult?.rows ?? [];
    emitLog(logger, 'info', 'entitlement.lookup.email_result', {
      ...logBase,
      phase: 'primary_inactive',
      emailCount: emails.length,
      emailQueryVariant: emailQueryVariant === 'unavailable' ? null : emailQueryVariant,
      rowCount: emailRows.length
    });
    if (emailRows.length === 0) {
      emitLog(logger, 'info', 'entitlement.lookup.resolved', {
        ...logBase,
        resolution: 'primary_inactive',
        lookupStrategy: entitlement.lookup_strategy,
        isActive: entitlement.is_active,
        status: entitlement.status,
        endDate: entitlement.end_date,
        subscriptionQueryVariant,
        emailQueryVariant: emailQueryVariant === 'unavailable' ? null : emailQueryVariant,
        lookupEmails: []
      });
      return entitlement;
    }

    const fallbackEntitlement = mapSubscriptionRow(emailRows[0], normalizedId);
    fallbackEntitlement.lookup_strategy = 'email';
    fallbackEntitlement.lookup_emails = emails;
    emitLog(logger, 'info', 'entitlement.lookup.resolved', {
      ...logBase,
      resolution: 'email_fallback',
      lookupStrategy: fallbackEntitlement.lookup_strategy,
      isActive: fallbackEntitlement.is_active,
      status: fallbackEntitlement.status,
      endDate: fallbackEntitlement.end_date,
      subscriptionQueryVariant,
      emailQueryVariant: emailQueryVariant === 'unavailable' ? null : emailQueryVariant,
      lookupEmails: anonymizeEmailsForLog(emails)
    });
    return fallbackEntitlement;
  }

  const emails = await runUserEmailQuery(executeQuery, normalizedId);
  emitLog(logger, 'info', 'entitlement.lookup.email_candidates', {
    ...logBase,
    phase: 'no_primary_rows',
    emailCount: emails.length,
    emails: anonymizeEmailsForLog(emails)
  });
  const emailResult = await runEmailSubscriptionQuery(executeQuery, emails, {
    logger,
    gtcUserId: normalizedId,
    phase: 'no_primary_rows'
  });
  const emailRows = emailResult?.rows ?? [];
  emitLog(logger, 'info', 'entitlement.lookup.email_result', {
    ...logBase,
    phase: 'no_primary_rows',
    emailCount: emails.length,
    emailQueryVariant: emailQueryVariant === 'unavailable' ? null : emailQueryVariant,
    rowCount: emailRows.length
  });
  if (emailRows.length > 0) {
    const fallbackEntitlement = mapSubscriptionRow(emailRows[0], normalizedId);
    fallbackEntitlement.lookup_strategy = 'email';
    fallbackEntitlement.lookup_emails = emails;
    emitLog(logger, 'info', 'entitlement.lookup.resolved', {
      ...logBase,
      resolution: 'email_only',
      lookupStrategy: fallbackEntitlement.lookup_strategy,
      isActive: fallbackEntitlement.is_active,
      status: fallbackEntitlement.status,
      endDate: fallbackEntitlement.end_date,
      subscriptionQueryVariant,
      emailQueryVariant: emailQueryVariant === 'unavailable' ? null : emailQueryVariant,
      lookupEmails: anonymizeEmailsForLog(emails)
    });
    return fallbackEntitlement;
  }

  const defaultEntitlement = buildDefaultEntitlement(normalizedId);
  defaultEntitlement.lookup_strategy = emails.length ? 'email' : 'gtc_user_id';
  if (emails.length) {
    defaultEntitlement.lookup_emails = emails;
  }
  emitLog(logger, 'info', 'entitlement.lookup.resolved', {
    ...logBase,
    resolution: 'default',
    lookupStrategy: defaultEntitlement.lookup_strategy,
    isActive: defaultEntitlement.is_active,
    status: defaultEntitlement.status,
    endDate: defaultEntitlement.end_date,
    subscriptionQueryVariant,
    emailQueryVariant: emailQueryVariant === 'unavailable' ? null : emailQueryVariant,
    lookupEmails: anonymizeEmailsForLog(defaultEntitlement.lookup_emails || [])
  });
  return defaultEntitlement;
}

export const entitlementConfig = Object.freeze({
  query: SUBSCRIPTION_STATUS_QUERY,
  legacyQuery: LEGACY_SUBSCRIPTION_STATUS_QUERY,
  activeStatuses: [...ACTIVE_STATUSES]
});

export function __setSubscriptionQueryVariant(variant = 'primary') {
  if (variant !== 'primary' && variant !== 'legacy') {
    throw new TypeError('invalid_subscription_query_variant');
  }
  subscriptionQueryVariant = variant;
}

export function __resetSubscriptionEmailQueryVariant() {
  emailQueryVariant = undefined;
  unavailableEmailColumns.clear();
}
