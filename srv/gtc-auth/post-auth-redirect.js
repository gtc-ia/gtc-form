import { fetchSubscriptionStatus } from './entitlement.js';

const PAYMENT_PORTAL_URL = process.env.PAYMENT_PORTAL_URL || 'https://pay.gtstor.com/payment.php';
const CHAT_REDIRECT_PATH = process.env.CHAT_REDIRECT_PATH || '/chat/';
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://app.gtstor.com';
const FORWARDABLE_PARAMS = ['lang', 'next'];
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

function coerceBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (['true', 't', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', 'f', '0', 'no', 'n'].includes(normalized)) return false;
    return undefined;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  return undefined;
}

function parseEndDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return undefined;
  return date;
}

function computeStatusActive(status) {
  if (!status) return false;
  const normalized = String(status).trim().toLowerCase();
  return ACTIVE_STATUSES.has(normalized);
}

function isEntitlementActive(entitlement) {
  if (!entitlement || typeof entitlement !== 'object') {
    return false;
  }

  const endDate = parseEndDate(entitlement.end_date);
  const hasFutureEndDate = endDate ? endDate.getTime() >= Date.now() : false;
  if (hasFutureEndDate) {
    return true;
  }

  const hasActiveStatus = computeStatusActive(entitlement.status);
  if (hasActiveStatus && !endDate) {
    return true;
  }

  const coerced = coerceBoolean(entitlement.is_active);
  if (coerced === true) return true;
  if (coerced === false) return false;

  return false;
}

export function normalizeUserId(value) {
  if (value === undefined || value === null) {
    throw new TypeError('gtc_user_id_missing');
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    throw new TypeError('gtc_user_id_missing');
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new TypeError('gtc_user_id_invalid');
  }
  return trimmed;
}

function sanitizeNextParam(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return undefined;
  }
  if (trimmed.length > 256) {
    return trimmed.slice(0, 256);
  }
  return trimmed;
}

function sanitizeLangParam(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^[-a-zA-Z0-9_.]{1,32}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function extractForwardableParams(query = {}) {
  const result = {};
  if (Object.prototype.hasOwnProperty.call(query, 'lang')) {
    const lang = sanitizeLangParam(query.lang);
    if (lang) {
      result.lang = lang;
    }
  }
  if (Object.prototype.hasOwnProperty.call(query, 'next')) {
    const next = sanitizeNextParam(query.next);
    if (next) {
      result.next = next;
    }
  }
  return result;
}

function applyForwardedParams(url, forwarded) {
  FORWARDABLE_PARAMS.forEach((param) => {
    if (forwarded[param]) {
      url.searchParams.set(param, forwarded[param]);
    }
  });
}

export function buildChatRedirect(forwarded = {}) {
  const url = new URL(CHAT_REDIRECT_PATH, APP_BASE_URL);
  applyForwardedParams(url, forwarded);
  return url.toString();
}

export function buildPaymentRedirect(userId, forwarded = {}) {
  const url = new URL(PAYMENT_PORTAL_URL);
  url.searchParams.set('user_id', userId);
  applyForwardedParams(url, forwarded);
  return url.toString();
}

export async function determinePostAuthRedirect({
  gtcUserId,
  query = {},
  fetchEntitlement = fetchSubscriptionStatus
} = {}) {
  const normalizedId = normalizeUserId(gtcUserId);
  const forwarded = extractForwardableParams(query);

  try {
    const entitlement = await fetchEntitlement(normalizedId);
    const isActive = isEntitlementActive(entitlement);
    const location = isActive ? buildChatRedirect(forwarded) : buildPaymentRedirect(normalizedId, forwarded);
    return {
      location,
      isActive,
      entitlement,
      rawEntitlement: entitlement
    };
  } catch (error) {
    const fallback = buildPaymentRedirect(normalizedId, forwarded);
    return { location: fallback, error };
  }
}

export const postAuthRedirectConfig = Object.freeze({
  paymentUrl: PAYMENT_PORTAL_URL,
  chatPath: CHAT_REDIRECT_PATH,
  forwardableParams: [...FORWARDABLE_PARAMS]
});
