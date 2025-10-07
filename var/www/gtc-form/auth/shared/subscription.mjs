export const PAYMENT_BASE_URL = 'https://pay.gtstor.com/payment.php';
export const PAYMENT_RETURN_PATH = '/chat';

function normalizeUserId(userId) {
  if (userId === undefined || userId === null) {
    throw new TypeError('user_id_required');
  }
  const normalized = String(userId).trim();
  if (!normalized) {
    throw new TypeError('user_id_required');
  }
  return normalized;
}

export function buildPaymentUrl(userId) {
  const normalized = normalizeUserId(userId);
  const url = new URL(PAYMENT_BASE_URL);
  url.searchParams.set('user_id', normalized);
  url.searchParams.set('returnTo', PAYMENT_RETURN_PATH);
  return url.toString();
}

export function buildSubscriptionStatusUrl(userId) {
  const normalized = normalizeUserId(userId);
  const url = new URL(`/auth/subscription_status`, 'https://placeholder.local');
  url.searchParams.set('gtc_user_id', normalized);
  return `${url.pathname}${url.search}`;
}

function resolveFetchImplementation(fetchImpl) {
  if (typeof fetchImpl === 'function') {
    return fetchImpl;
  }
  if (typeof fetch === 'function') {
    return fetch;
  }
  throw new TypeError('fetch_function_required');
}

export async function determineSubscriptionRedirect(userId, fetchImpl) {
  const normalized = normalizeUserId(userId);
  const fetchFn = resolveFetchImplementation(fetchImpl);
  const endpoint = buildSubscriptionStatusUrl(normalized);

  let response;
  try {
    response = await fetchFn(endpoint, { method: 'GET' });
  } catch (cause) {
    const error = new Error('subscription_check_failed');
    error.cause = cause;
    throw error;
  }

  if (!response || typeof response.ok !== 'boolean') {
    const error = new Error('subscription_check_failed');
    error.cause = new Error('invalid_response');
    throw error;
  }

  if (!response.ok) {
    const error = new Error('subscription_check_failed');
    error.status = response.status;
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    const error = new Error('subscription_check_failed');
    error.cause = cause;
    throw error;
  }

  if (payload && payload.active) {
    return PAYMENT_RETURN_PATH;
  }

  return buildPaymentUrl(normalized);
}
