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
- [GTC Auth Service Guide](docs/gtc-auth.md)

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

## 🚀 Deployment

The registration form is deployed to `/var/www/gtc-form` on the GTC1 server. Use the `deploy.sh` helper script from the repository root to build and sync the static assets:

```bash
ssh -i ~/.ssh/GTC1_key.pem kfilipenko@agent.gtstor.com
cd ~/gtc-form
git pull origin main
./deploy.sh
```

The script installs Node dependencies with `npm ci`, stages the contents of `Client/gtc-form` and `assets`, and then uses `rsync` to update the server directory. Deployment is idempotent—rerunning the script safely refreshes the production files. Set the `DEPLOY_TARGET_DIR` environment variable if you need to test against an alternate path before updating production.

## 🛠 Local Development

The project is a static site rendered from `Client/gtc-form`. To preview changes locally:

1. Install dependencies once with `npm install`.
2. Run `npm start` to launch a local static server on [http://localhost:3000](http://localhost:3000).

The `start` script uses [`serve`](https://www.npmjs.com/package/serve) to host the contents of `Client/gtc-form`, enabling contributors to test changes to the HTML bundle without additional tooling.
