# gtc-auth

Node.js authentication microservice that powers the GTC web application. It exposes `/auth/*` endpoints, persists state in PostgreSQL, and sends transactional emails through SMTP.

## Prerequisites

* Node.js 18+
* PostgreSQL database with access credentials
* SMTP account for transactional email delivery

## Database setup

Apply the schema to your PostgreSQL instance (requires `pgcrypto` extension):

```bash
psql "postgresql://postgres@localhost:5432/gtc_db" -f sql/001_auth_schema.sql
```

## Configuration

Copy the environment template and fill in secrets:

```bash
cp .env.example .env
# edit .env and provide SMTP_PASS, GOOGLE_CLIENT_ID, etc.
```

Key variables for the post-auth redirect pipeline:

- `PAYMENT_PORTAL_URL` — hosted payment page that accepts `user_id` in the query string.
- `CHAT_REDIRECT_PATH` — relative path to the chat workspace (defaults to `/chat/`).
- `ENTITLEMENT_RPC_URL` / `ENTITLEMENT_TIMEOUT_MS` — PostgREST RPC used to resolve subscription status.
- `AUTH_COOKIE_NAME`, `AUTH_COOKIE_DOMAIN`, `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_MAX_AGE_MS` — configure the transient cookie that stores `gtc_user_id` between `/auth/*` handlers and `/auth/finish`.

## Install & run

Install dependencies and start the service:

```bash
npm install
npm run start
```

By default the server listens on `http://127.0.0.1:8085`.

## Tests

Execute the unit suite with:

```bash
npm test
```

## Health check

```
GET /auth/healthz -> { "ok": true }
```

## API overview

### `POST /auth/check_email`
Request body: `{ "email": "user@example.com" }`
Response: `{ "exists": true|false }`

### `POST /auth/register`
Request body: `{ "email": "user@example.com", "password": "...", "name": "Full Name" }`
Response: `{ "queued_verification": true, "email": "user@example.com" }`

### `POST /auth/request_email_verification`
Request body: `{ "email": "user@example.com" }`
Response: `{ "ok": true }` (adds `already_verified: true` when the email was confirmed earlier)

### `POST /auth/verify`
Request body: `{ "token": "UUID" }`
Response: `{ "gtc_user_id": 123, "email": "user@example.com", "verified": true }`

### `POST /auth/login`
Request body: `{ "email": "user@example.com", "password": "..." }`
Response: `{ "gtc_user_id": 123, "email": "user@example.com" }`

### `POST /auth/google`
Request body: `{ "google_credential": "<JWT>" }`
Response: `{ "gtc_user_id": 123, "email": "user@example.com" }`

Successful auth responses also set an HTTP-only cookie (see `AUTH_COOKIE_*`). Clients should simply navigate to `/auth/finish` to let the server decide the final destination. All endpoints return `{ "code": "..." }` on error according to the server logic.

### `GET /auth/finish`
Reads `gtc_user_id` from the transient cookie, calls the entitlement RPC, and issues a `302` redirect:

- Active subscription (`is_active` truthy **или** `status IN ('active','trialing')` с `end_date` в будущем) → `https://app.gtstor.com/chat/`
- Missing/expired subscription or RPC failure → `https://pay.gtstor.com/payment.php?user_id=<gtc_user_id>`

The handler forwards validated `lang` and `next` query parameters to the target.

> **Important:** Entitlement decisions are based exclusively on the PostgREST `subscription_status` RPC. Stripe Customer Portal
> interactions are only triggered by explicit user actions (for example, `/billing/portal`) and never as part of the post-login
> flow.

## systemd unit

The repository includes `systemd/gtc-auth.service`. Deploy it to `/etc/systemd/system/gtc-auth.service` and enable the service:

```bash
sudo cp systemd/gtc-auth.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gtc-auth
```

Confirm the service is healthy:

```bash
curl -sS http://127.0.0.1:8085/auth/healthz
```
