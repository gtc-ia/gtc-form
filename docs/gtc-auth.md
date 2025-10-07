# Руководство по сервису gtc-auth

Документ описывает архитектуру и эксплуатационные аспекты сервиса аутентификации GTC. Материал предназначен для разработчиков, SRE и специалистов по безопасности, отвечающих за поддержку и интеграцию с внешними системами.

## 1. Архитектура решения

Сервис построен как автономное Node.js-приложение, размещённое в каталоге `srv/gtc-auth` и публикующее REST API по префиксу `/auth/*`.

### Основные компоненты

| Компонент | Назначение | Технологии |
|-----------|------------|------------|
| Клиентские приложения (Apps/agent-registration, веб-форма ProdAn) | Сбор пользовательских данных и вызов REST API | HTML/JS, `fetch` | 
| Сервис аутентификации `gtc-auth` | Обработка регистраций, верификация email, вход и Google SSO | Node.js 18+, Express, bcrypt, google-auth-library |
| Хранилище данных | Долговременное хранение пользователей, credential-данных и токенов | PostgreSQL 13+, расширение `pgcrypto` |
| Интеграции | SMTP для почты, Google OAuth2 для соц. входа | Nodemailer, Google Identity |

### Потоки данных

1. Клиент запрашивает эндпоинты `/auth/*` через HTTPS.
2. Сервис валидирует входящие данные, применяет ограничения частоты (`express-rate-limit`) и шлем (`helmet`).
3. Рабочие данные читаются и записываются в PostgreSQL через `pg.Pool`.
4. При регистрации сервис создаёт верификационный токен и отправляет письмо через SMTP.
5. Для входа по Google сервис валидирует ID-токен, получая email/sub из Google API.

## 2. Процессы аутентификации

### 2.1 Email/пароль

1. `POST /auth/check_email` — проверка занятости адреса.
2. `POST /auth/register` — регистрация: создаётся пользователь, хэш пароля (`bcrypt` c 12 раундами по умолчанию) и запись в `auth_email`.
3. `POST /auth/request_email_verification` — повторная отправка письма (опционально).
4. Пользователь переходит по ссылке из письма (`/verify?token=UUID` на клиенте), который затем вызывает `POST /auth/verify`.
5. `POST /auth/login` — вход возможен только после подтверждения email.

### 2.2 Вход через Google

1. Клиент получает credential (JWT) от Google Identity Services.
2. `POST /auth/google` отправляет credential в сервис.
3. `verifyGoogleCredential` валидирует токен и извлекает поля `email` и `sub`.
4. Если `sub` уже известен — возвращается существующий пользователь; иначе email связывается с новым или уже подтверждённым пользователем.

## 3. Последовательности запросов (для интеграторов)

### Регистрация пользователя (email)

```text
check_email → register → (письмо) → verify → login
```

### Повторная верификация

```text
request_email_verification → (письмо) → verify
```

### Авторизация через Google

```text
(Google OAuth JS) → POST /auth/google → ответ с gtc_user_id
```

## 4. Модель данных

| Таблица | Ключевые поля | Описание |
|---------|----------------|----------|
| `public."user"` | `gtc_user_id` (PK), `created_at` | Базовая сущность пользователя GTC. |
| `public.auth_email` | `email` (PK), `user_id`, `pwd_hash`, `email_verified`, `created_at` | Учетная запись с паролем и состоянием подтверждения email. |
| `public.auth_google` | `google_sub` (PK), `user_id`, `email`, `created_at` | Привязки Google SSO (каждый `sub` и email уникальны). |
| `public.auth_verification` | `token` (PK), `user_id`, `email`, `expires_at`, `used`, `created_at` | Одноразовые токены подтверждения email (TTL по умолчанию 60 минут). |
| `public.subscriptions` | `subscription_id` (PK), `gtc_user_id` (NOT NULL), `status`, `start_date`, `end_date`, `stripe_customer_id`, `stripe_subscription_id`, `plan_code`, `stripe_price_id`, `stripe_product_id`, `created_at`, `updated_at`, `livemode` | Записи о подписках, которые создаёт нода n8n «Save Subscription». Используются методом `getLatestEntitlement` для проверки права доступа в чат. |

Дополнительные индексы (`idx_auth_email_user`, `idx_auth_google_user`, `idx_auth_verif_user`) ускоряют запросы по `user_id` при связке профилей и аудите.

## 5. Обработка ошибок

Все ошибки возвращаются в JSON-формате `{ "code": "<error_code>" }` с HTTP-статусом, соответствующим типу ошибки.

| Код | HTTP статус | Сценарий |
|-----|-------------|----------|
| `bad_request` | 400 | Некорректные или отсутствующие параметры запроса. |
| `email_taken` | 409 | Попытка регистрации уже существующего email. |
| `weak_password` | 400 | Пароль не соответствует политике (мин. 8 символов, буква, цифра, спецсимвол). |
| `invalid_or_expired` | 400 | Токен подтверждения не найден, уже использован или протух. |
| `invalid_credentials` | 401 | Неверный email или пароль. |
| `email_not_verified` | 403 | Попытка входа до подтверждения email. |
| `invalid_google_token` | 401 | Некорректный или просроченный credential Google. |
| `server_error` | 500 | Исключения БД/SMTP/внутренние ошибки. |

## 6. Интеграция с SMTP и OAuth

### SMTP

* Переменные окружения: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`true` для SMTPS), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.
* Рекомендуется отдельный сервисный аккаунт с ограничением на исходящий трафик.
* Проверяйте доступ с сервера `gtc-auth` (см. раздел 8) и наличие DKIM/SPF для домена.
* Письмо подтверждения строится из шаблона в `mail.js`; URL формируется по `APP_BASE_URL` и `VERIFY_PATH`.

### Google OAuth2

* Используется библиотека `google-auth-library` и клиентский ID в `GOOGLE_CLIENT_ID`.
* На стороне фронтенда требуется Google Identity Services (кнопка входа или One Tap).
* Токен верифицируется на бэкенде; аудит логов поможет отслеживать неуспешные попытки (`invalid_google_token`).

## 7. Требования к инфраструктуре

* Node.js 18+ (LTS), npm 9+.
* PostgreSQL 13+ с расширением `pgcrypto` (для генерации UUID в SQL).
* Сетевой доступ:
  * входящий HTTPS → реверс-прокси (например, Nginx) → `gtc-auth` на порту `8085`;
  * исходящий TCP 5432 → PostgreSQL;
  * исходящий TCP 465/587 → SMTP.
* Переменные окружения БД: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`.
* Дополнительно: `PORT` (по умолчанию 8085), `RATE_WINDOW_MS`, `RATE_MAX`, `ALLOWED_ORIGINS` (список доменов через запятую).

## 8. Команды диагностики

| Цель | Команда |
|------|---------|
| Проверка живости API | `curl -sS http://127.0.0.1:8085/auth/healthz` |
| Проверка SMTP | `ncat --ssl $SMTP_HOST $SMTP_PORT` → `EHLO gtc-auth.local` |
| Проверка подключения к БД | `psql "$DATABASE_URL" -c 'SELECT now()'` |
| Мониторинг systemd | `sudo systemctl status gtc-auth` |
| Логи сервиса | `sudo journalctl -u gtc-auth -f` |
| Проверка зависимостей npm | `npm audit --production` (в каталоге `srv/gtc-auth`) |
| Юнит-тест логики подписок | `npm test` (из корня репозитория; выполняет `node --test srv/gtc-auth/tests/subscription-status.test.js`, свежие логи см. в `Docs/test-results/`) |

## 9. Деплой и эксплуатация

1. Скопировать `.env.example` в `.env`, заполнить все секреты.
2. Установить зависимости `npm ci` или `npm install`.
3. Применить SQL-схему из `sql/001_auth_schema.sql` к целевой базе.
4. Настроить сервисную единицу `systemd/gtc-auth.service` и включить её (`systemctl enable --now gtc-auth`).
5. Настроить реверс-прокси для HTTPS (пример: Nginx с проксированием на `127.0.0.1:8085`).
6. Мониторить `GET /auth/healthz` и ключевые метрики (скорость отправки писем, ошибки БД).

Для обновления используйте стандартный pipeline: `git pull` → `npm ci` → `systemctl restart gtc-auth`. Перед рестартом убедитесь, что нет активных миграций или зависших писем.

## 10. Контрольная информация для безопасности

* Пароли хэшируются алгоритмом bcrypt (`BCRYPT_ROUNDS` настраивается, дефолт 12).
* Токены подтверждения одноразовые и истекают через 60 минут (TTL задаётся параметром `createVerifyToken`).
* Все email и Google-аккаунты уникальны в системе и связаны с сущностью `user`.
* Ограничение частоты запросов на уровне `/auth/` защищает от brute-force (по умолчанию 60 запросов в минуту).

## 11. Ссылки и полезные материалы

* Исходный код: `srv/gtc-auth/server.js`
* Конфигурация SMTP: `srv/gtc-auth/mail.js`
* Интеграция Google: `srv/gtc-auth/google.js`
* Схема БД: `srv/gtc-auth/sql/001_auth_schema.sql`
* Шаблон systemd: `srv/gtc-auth/systemd/gtc-auth.service`

