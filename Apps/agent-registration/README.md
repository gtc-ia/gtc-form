# 👤 Agent Registration Module

Handles user registration, login, and validation.

## ✅ Features

- HTML-based registration form
- Webhook integration with n8n
- PostgreSQL user storage
- Email verification via SMTP (optional)
- Google OAuth planned

## 📦 Files

- `/var/www/gtc-form/index.html` — frontend form
- `Docs/business/overview.md` — linked process
- `n8n-workflows/agent-register.json` — workflow logic

## 📊 Data

Stored in table: `gtc_users`  
Includes: `gtc_user_id`, `email`, `name`, `password_hash`, `created_at`, `verified`

## 🔐 Security

- Email checked for uniqueness
- Password hashed before insert
