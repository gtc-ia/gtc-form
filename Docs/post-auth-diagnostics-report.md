# Post-auth redirect diagnostics (local)

## Scope
This note captures the local checks run in the repo and configuration recommendations to stabilize post-auth redirects between the public entrypoints and GTC1 services. No server-side code changes were made; only repository tests were executed.

## Local tests executed
- `npm --prefix srv/gtc-auth test` — validates entitlement evaluation, redirect routing, and safety checks around `/auth/finish`. All suites passed locally.

## Observations
- Automated tests now guard against the earlier `isEntitlementActive` ReferenceError and ensure chat/payment routing is driven solely by subscription state.
- Cookie/redirect behavior still depends on environment variables (`AUTH_COOKIE_*`, `APP_BASE_URL`, `CHAT_REDIRECT_PATH`, `PAYMENT_PORTAL_URL`), which must be aligned with the domains used during registration and finish flows.
- Remote verification of live values on GTC1 was not performed in this run because SSH credentials were not available in this environment. If provided, the checks should include `systemctl cat gtc-auth`, `.env` contents, and a `psql` query for `gtc_user_id = 3001` in `public.subscriptions`.

## Configuration recommendations to reduce redirect breakage
1) **Keep auth and app under the same parent domain**
   - Set `AUTH_COOKIE_DOMAIN` to `.gtstor.com` (or the exact parent used by both the form and `/auth/*`) and ensure registration flows originate from that domain rather than the Vercel preview, so the `gtc_user_id` cookie is sent to `/auth/finish`.
2) **Pin explicit redirect targets**
   - Configure `APP_BASE_URL=https://app.gtstor.com` and `CHAT_REDIRECT_PATH=/chat/` (with trailing slash) to avoid relative URL surprises, and keep `PAYMENT_PORTAL_URL` as a fully qualified HTTPS URL.
3) **Harden SameSite and path**
   - Keep `AUTH_COOKIE_PATH=/auth` and `SameSite=Lax`; if cross-site flows from Vercel remain, consider `SameSite=None; Secure` paired with HTTPS-only usage.
4) **Add runtime health checks and alerts**
   - Expose a lightweight `/auth/healthz` that checks Postgres connectivity and returns the effective redirect config; monitor via Azure/uptime probes to detect misconfiguration early.
5) **Log redirect decisions with user-safe context**
   - Keep hashed lookup emails and subscription status in structured logs to triage why a user was sent to payment vs. chat without exposing PII.
