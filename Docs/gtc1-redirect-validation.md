# GTC1 post-auth validation and hardening checklist

Use this runbook after gaining SSH access to GTC1 to confirm redirect behavior for real users (e.g., `gtc_user_id = 3001`) and to reduce the risk of redirect failures between the public entrypoints and `gtc-auth`.

## 1) Verify runtime configuration on GTC1
Run these commands over SSH (`codex@agent.gtstor.com`):

```bash
sudo systemctl cat gtc-auth
sudo cat /var/www/gtc-auth/.env
```

Confirm the values align with the expected baseline:
- `AUTH_COOKIE_DOMAIN=.gtstor.com` (or the exact parent shared by `/auth/*` and the form host).
- `AUTH_COOKIE_NAME=gtc_user_id`, `AUTH_COOKIE_PATH=/auth`, `AUTH_COOKIE_SECURE=true`, `AUTH_COOKIE_MAX_AGE_MS` ~ 10 minutes.
- `APP_BASE_URL=https://app.gtstor.com` and `CHAT_REDIRECT_PATH=/chat/`.
- `PAYMENT_PORTAL_URL=https://pay.gtstor.com/payment.php` (fully qualified, HTTPS).

## 2) Check subscription state for the affected user
Query Postgres on GTC1 to ensure the entitlement exists and is active:

```bash
psql "$PGDATABASE" -h "$PGHOST" -U "$PGUSER" -c "select * from public.subscriptions where gtc_user_id = 3001 order by updated_at desc limit 5;"
```

Confirm at least one row has `status` in (`active`, `trialing`) and an `end_date` in the future or `is_active=true`.

## 3) Run the bundled diagnostic helper in production
From `/var/www/gtc-auth` on GTC1:

```bash
npm install --omit=dev
node scripts/post-auth-diagnose.js 3001
```

The output should show:
- Effective `AUTH_COOKIE_*`, `APP_BASE_URL`, `CHAT_REDIRECT_PATH`, `PAYMENT_PORTAL_URL` values (as seen by the service).
- The latest entitlement fetched from Postgres.
- The computed redirect `location` and `reason` (`chat` vs `payment`).

If Postgres is unreachable or env vars are missing, the script exits non-zero with a descriptive error.

## 4) Spot-check the redirect handler end-to-end
With the service running, validate the `/auth/finish` behavior by simulating the auth cookie (replace `<PORT>` with the listener, usually `8085`):

```bash
curl -I -L -b "gtc_user_id=3001" "http://127.0.0.1:<PORT>/auth/finish?lang=ru"
```

Expected:
- `302` to `https://app.gtstor.com/chat/?lang=ru` when the subscription is active.
- `302` to `https://pay.gtstor.com/payment.php?user_id=3001&lang=ru` when inactive or on lookup errors.

## 5) Configuration hardening to reduce future breakage
- Keep registration and `/auth/*` on the same parent domain; avoid Vercel preview for live flows unless `AUTH_COOKIE_DOMAIN` and CORS are adjusted for cross-site cookies.
- Add a lightweight `/auth/healthz` probe to uptime monitoring; alert on non-200 responses or when Postgres checks fail.
- Freeze redirect targets via env defaults and restrict query param forwarding to `lang`/`next` (already enforced) to prevent open redirects.
- Automate deployment of `.env` and `systemd` units from a single source of truth (e.g., Ansible) to prevent drift between Vercel previews and GTC1.
- Periodically re-run `node scripts/post-auth-diagnose.js <user_id>` against known-good users after deployments to catch regressions before users notice.
