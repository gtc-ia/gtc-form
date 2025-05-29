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
