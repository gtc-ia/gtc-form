#!/usr/bin/env node
import 'dotenv/config';
import { pool } from '../db.js';
import { fetchSubscriptionStatus } from '../entitlement.js';
import {
  buildChatRedirect,
  buildPaymentRedirect,
  determinePostAuthRedirect,
  normalizeUserId
} from '../post-auth-redirect.js';

const DEFAULT_COOKIE_NAME = 'gtc_post_auth';
const DEFAULT_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_APP_BASE_URL = 'https://app.gtstor.com';
const DEFAULT_CHAT_PATH = '/chat/';
const DEFAULT_PAYMENT_URL = 'https://pay.gtstor.com/payment.php';

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

function parseInteger(value) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readEnv(name, fallback = undefined) {
  return process.env[name] ?? fallback;
}

function collectEnvironment() {
  const rawSecure = readEnv('AUTH_COOKIE_SECURE');
  const nodeEnv = readEnv('NODE_ENV');
  const secureFromEnv = coerceBoolean(rawSecure);

  const authCookieSecure =
    typeof secureFromEnv === 'boolean' ? secureFromEnv : nodeEnv === 'production';

  const authCookieMaxAge =
    parseInteger(readEnv('AUTH_COOKIE_MAX_AGE_MS')) ?? DEFAULT_COOKIE_MAX_AGE_MS;

  return {
    authCookie: {
      name: readEnv('AUTH_COOKIE_NAME', DEFAULT_COOKIE_NAME),
      domain: readEnv('AUTH_COOKIE_DOMAIN', '(not set)'),
      secure: authCookieSecure,
      maxAgeMs: authCookieMaxAge,
      source: {
        authCookieSecure: rawSecure ?? '(not set)',
        nodeEnv: nodeEnv ?? '(not set)',
        authCookieMaxAgeMs: readEnv('AUTH_COOKIE_MAX_AGE_MS', '(not set)')
      }
    },
    redirects: {
      appBaseUrl: readEnv('APP_BASE_URL', DEFAULT_APP_BASE_URL),
      chatPath: readEnv('CHAT_REDIRECT_PATH', DEFAULT_CHAT_PATH),
      paymentPortalUrl: readEnv('PAYMENT_PORTAL_URL', DEFAULT_PAYMENT_URL)
    },
    database: {
      host: readEnv('PGHOST', '(not set)'),
      port: readEnv('PGPORT', '(not set)'),
      user: readEnv('PGUSER', '(not set)'),
      database: readEnv('PGDATABASE', '(not set)')
    }
  };
}

function formatSection(title, value) {
  process.stdout.write(`\n## ${title}\n`);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const rawUserId = process.argv[2] ?? process.env.GTC_USER_ID;
  if (!rawUserId) {
    process.stderr.write('Usage: node scripts/post-auth-diagnose.js <gtc_user_id>\n');
    process.exitCode = 1;
    return;
  }

  const normalizedUserId = normalizeUserId(rawUserId);
  const environment = collectEnvironment();

  formatSection('Environment', environment);

  let entitlement;
  let decision;
  try {
    entitlement = await fetchSubscriptionStatus(normalizedUserId);
    decision = await determinePostAuthRedirect({ gtcUserId: normalizedUserId });
  } catch (error) {
    formatSection('Lookup error', { message: error.message, code: error.code || null });
    throw error;
  } finally {
    await pool.end().catch(() => {});
  }

  formatSection('Entitlement', entitlement);
  formatSection('Redirect decision', {
    location: decision?.location,
    isActive: decision?.isActive,
    reason: decision?.activity?.reason ?? null,
    lookupEmailsHashed: decision?.lookupEmailsHashed ?? [],
    paymentExample: buildPaymentRedirect(normalizedUserId),
    chatExample: buildChatRedirect()
  });
}

main().catch((error) => {
  process.stderr.write(`\nDiagnosis failed: ${error.message}\n`);
  process.exitCode = 1;
});
