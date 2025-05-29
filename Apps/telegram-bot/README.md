# 💬 Telegram Bot Module

Provides user interaction via Telegram messenger using n8n automation and AI integration.

## ✅ Features

- Receives user messages through Telegram webhook
- Interprets intent via GPT-4o (optional)
- Sends product recommendations or performs registration steps
- Supports command-based and free-text modes
- Logs all requests in PostgreSQL or Google Sheets

## ⚙️ Workflow

- Telegram → n8n webhook → GPT-4o (or internal logic) → Response
- Optional: call external APIs or database queries

## 📦 Files & Structure

- `n8n-workflows/telegram-bot.json` — main flow
- Google Sheets integration (for logging and analytics)
- AI connection via `Continue` in VS Code or API

## 🔐 Authentication

- Each Telegram user is identified by `telegram_id`
- Stored in `gtc_users` with cross-reference to their email (if provided)

## 📈 Use Cases

- Product lookup
- Order status
- Simple AI chat
- Lead capture
