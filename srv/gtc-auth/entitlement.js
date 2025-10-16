const DEFAULT_RPC_URL = process.env.ENTITLEMENT_RPC_URL || 'https://app.gtstor.com/api/rpc/subscription_status';
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.ENTITLEMENT_TIMEOUT_MS ?? '', 10);
const RPC_TIMEOUT_MS = Number.isFinite(DEFAULT_TIMEOUT_MS) && DEFAULT_TIMEOUT_MS > 0 ? DEFAULT_TIMEOUT_MS : 2500;
const USER_ID_FIELD = process.env.ENTITLEMENT_RPC_USER_FIELD || 'p_gtc_user_id';

function normalizeUserIdForRpc(value) {
  if (value === undefined || value === null) {
    throw new TypeError('gtc_user_id_required');
  }
  const numeric = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(numeric)) {
    throw new TypeError('gtc_user_id_invalid');
  }
  return numeric;
}

export async function fetchSubscriptionStatus(gtcUserId, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }

  const normalizedId = normalizeUserIdForRpc(gtcUserId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  try {
    const response = await fetchImpl(DEFAULT_RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ [USER_ID_FIELD]: normalizedId }),
      signal: controller.signal
    });

    if (!response || typeof response.ok !== 'boolean') {
      const error = new Error('entitlement_invalid_response');
      error.cause = response;
      throw error;
    }

    if (!response.ok) {
      const error = new Error('entitlement_request_failed');
      error.status = response.status;
      throw error;
    }

    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('entitlement_request_timeout');
      timeoutError.cause = error;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const entitlementConfig = Object.freeze({
  url: DEFAULT_RPC_URL,
  timeoutMs: RPC_TIMEOUT_MS,
  userIdField: USER_ID_FIELD
});
