# gtc-form
Форма для регистрации на ProdAn
Создана для регистрации пользователей с проверкой повторения @адресов. 
Данные формы передаются во внешнее хранилище GT
Новая запись передается в WF на n8n
---

## 📁 Documentation

- [Infrastructure Overview](Docs/infrastructure.md)
- [Business Workflows](Docs/business/overview.md)
- [Agents Logic](Docs/business/agents.md)
- [Real Case Studies](Docs/business/case-001.md)

## 🌐 Live Endpoints

- [Registration Form](https://app.gtstor.com)
- [n8n Workflow Automation](https://agent.gtstor.com)
- [VS Code Server (OAuth2 Protected)](https://vs.gtstor.com)

## 📦 Apps Structure

Each application is located under `Apps/`:

- `Apps/agent-registration/`: user onboarding and authentication
- `Apps/telegram-bot/`: messenger automation and AI interaction
- `Apps/data-enrichment/`: catalog normalization and product hashing
- `Apps/ui-dashboard/`: future visual interface for managing system

## 🚀 Local Registration API

The server-side registration service now lives at the repository root (`index.js`).
It loads configuration from environment variables via [`dotenv`](https://www.npmjs.com/package/dotenv)
and exposes REST endpoints for direct PostgreSQL inserts into `gtc_users`.

### 1. Configure environment variables

Create a `.env` file (or export the variables manually) with one of the following setups:

```
# Option A – connection string
DATABASE_URL=postgres://username:password@host:5432/gtc_db

# Option B – discrete settings
DB_HOST=localhost
DB_PORT=5432
DB_USER=gtc_user
DB_PASSWORD=secret
DB_NAME=gtc_db

# Optional SSL tuning
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false

# Optional HTTP port (defaults to 3000)
PORT=3000
```

### 2. Install dependencies & start the service

```
npm install
npm start
```

The API listens on `PORT` (defaults to `3000`) and provides the following handlers:

- `GET /health` — confirms the process is running and checks database connectivity.
- `POST /register` and `POST /api/register` — accepts the registration payload (`email`, `name`, `password`) and writes it to `gtc_users`.
