# 📊 Аудит базы данных PostgreSQL

## 🗂 Таблица `auth_telegram`
**Назначение:** Хранение Telegram-пользователей, связанных с таблицей user

| Колонка     | Тип     | Nullable | Примечание                    |
|-------------|---------|----------|-------------------------------|
| id          | serial  | ❌        | Primary key                   |
| user_id     | bigint  | ❌        | FK → user.id                  |
| telegram_id | bigint  | ✅        | Telegram ID пользователя      |
| username    | text    | ✅        | Telegram username             |

## 🗂 Таблица `chat_history`
**Назначение:** Хранение переписки Telegram-бота и пользователя

| Колонка   | Тип       | Nullable | Примечание                         |
|-----------|-----------|----------|------------------------------------|
| id        | integer   | ❌        | Primary key, auto-increment        |
| user_id   | bigint    | ❌        | Telegram user ID                   |
| message   | text      | ❌        | Текст сообщения                    |
| is_bot    | boolean   | ✅        | True = бот, False = человек        |
| created_at| timestamp | ✅        | Дата и время создания              |

## 🗂 Таблица `chat_log`
**Назначение:** Журнал логов чата, возможно агрегированные данные

| Колонка     | Тип     | Nullable | Примечание                       |
|-------------|---------|----------|----------------------------------|
| id          | integer | ❌        | Primary key                      |
| gtc_user_id | bigint  | ✅        | FK → users.gtc_user_id           |