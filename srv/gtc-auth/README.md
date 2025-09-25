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

## Install & run

Install dependencies and start the service:

```bash
npm install
npm run start
```

By default the server listens on `http://127.0.0.1:8085`.

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
Response: `{ "ok": true }`

### `POST /auth/verify`
Request body: `{ "token": "UUID" }`
Response: `{ "gtc_user_id": 123, "email": "user@example.com", "verified": true }`

### `POST /auth/login`
Request body: `{ "email": "user@example.com", "password": "..." }`
Response: `{ "gtc_user_id": 123, "email": "user@example.com" }`

### `POST /auth/google`
Request body: `{ "google_credential": "<JWT>" }`
Response: `{ "gtc_user_id": 123, "email": "user@example.com" }`

All endpoints return `{ "code": "..." }` on error according to the server logic.

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
