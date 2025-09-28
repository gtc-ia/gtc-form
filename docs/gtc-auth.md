# Архитектура и аутентификация GTC Auth

## 1. Общее представление сервиса
- **Назначение:** централизованная аутентификация пользователей для форм регистрации, бота и внутренних консолей.
- **Компоненты:** статический фронтенд (`Client/gtc-form`), API-шлюз (`srv/auth-gateway`), микросервис идентификации (`Apps/agent-registration`), интеграции SMTP/OAuth и очередь событий (n8n).
- **Потоки данных:** клиент → шлюз → сервис идентификации → БД → события в очередь и уведомления.

Диаграмма взаимодействий на верхнем уровне:
```
[Client UI] --HTTPS--> [Auth Gateway] --RPC--> [Identity Service]
      |                                       |
      |                               [Postgres Cluster]
      |                                       |
      +--Webhooks--> [n8n Automation] <--SMTP--> [Mail Relay]
```

## 2. Процессы аутентификации
### 2.1 Email + Magic Link
1. Пользователь вводит email в форме.
2. Gateway валидирует формат и создает запрос `POST /auth/email/start`.
3. Identity Service создает запись `pending_sessions` и генерирует одноразовый токен.
4. SMTP-интеграция отправляет письмо с magic-link (действительно 15 минут).
5. Пользователь переходит по ссылке → gateway вызывает `POST /auth/email/confirm`.
6. Identity Service помечает сессию как активную, создает `sessions` и выдает JWT (HS256, срок 12 часов).

### 2.2 Google OAuth 2.0
1. UI инициирует `GET /auth/google` → редирект на Google OAuth consent.
2. После успешной авторизации Google возвращает код на `/auth/google/callback`.
3. Gateway обменивает код на токен, валидирует `hd` и `email_verified`.
4. Identity Service обновляет/создает пользователя, пишет событие `user_verified` в n8n.
5. Клиент получает JWT и refresh-токен (rotation, срок 7 дней).

### 2.3 Управление сессиями
- Refresh endpoint `POST /auth/session/refresh`.
- Logout endpoint `POST /auth/session/revoke`.
- Webhooks для инвалидирования токенов на стороне UI.

## 3. Структура базы данных
| Таблица | Описание | Ключевые поля |
|---------|----------|---------------|
| `users` | профили пользователей | `id`, `email`, `display_name`, `status`, `created_at` |
| `identities` | привязки провайдеров | `id`, `user_id`, `provider` (`email`, `google`), `provider_uid`, `created_at` |
| `pending_sessions` | незавершённые email-логины | `id`, `email`, `token_hash`, `expires_at`, `retry_count` |
| `sessions` | активные сессии | `id`, `user_id`, `refresh_token_hash`, `expires_at`, `last_used_at` |
| `audit_events` | журнал действий | `id`, `user_id`, `event_type`, `payload`, `logged_at` |

- Репликация `users` и `identities` на read-only экземпляр для аналитики.
- Индексы по `email`, `provider_uid`, `expires_at`.

## 4. Схема обмена ошибками
- Формат ответа: `application/json`.
- Структура: `{ "error": { "code": "<string>", "message": "<human readable>", "details": { ... } } }`.
- Коды ошибок:
  - `AUTH-4001`: некорректный email или формат запроса.
  - `AUTH-4010`: токен просрочен или уже использован.
  - `AUTH-4030`: домен email не разрешён политиками.
  - `AUTH-4090`: пользователь уже существует в другой организации.
  - `AUTH-5000`: внутренние ошибки сервера, повтор с экспоненциальным откатом.
- Заголовки: `X-Request-ID` для трассировки; `Retry-After` при 429.

## 5. Требования к инфраструктуре
- **Сеть:** HTTPS (TLS 1.2+), ALB/Ingress с поддержкой Web Application Firewall.
- **База данных:** PostgreSQL 14, High Availability через Patroni или Cloud SQL.
- **Кэш:** Redis для rate-limit и хранения OTP (TTL 15 мин).
- **Очередь:** n8n / RabbitMQ для асинхронных задач и рассылок.
- **Мониторинг:** Prometheus + Grafana, алерты по `auth_failed`, `smtp_latency`, `oauth_errors`.
- **Секреты:** HashiCorp Vault или KMS для ключей JWT и OAuth.

## 6. Инструкции по деплою
1. Подготовить переменные окружения (`.env.production`) с секретами SMTP и OAuth.
2. Собрать фронтенд: `npm run build --prefix Client/gtc-form`.
3. Собрать Docker-образ `auth-service`: `docker build -f Apps/agent-registration/Dockerfile -t registry.gtstor.com/auth-service:$(git rev-parse --short HEAD) .`.
4. Запушить образ и выполнить `helm upgrade --install gtc-auth deploy/helm/auth`.
5. Применить миграции: `npm run migrate --prefix Apps/agent-registration`.
6. Перезапустить workers n8n для получения новых схем событий.
7. Верифицировать доступность `/auth/healthz` и `/auth/metrics`.

## 7. Приложение для специалистов
### 7.1 Последовательности запросов
- **Email старт → подтверждение:**
  1. `POST /auth/email/start` → `202 Accepted` + `request_id`.
  2. Получаем magic-link по почте.
  3. `POST /auth/email/confirm` с `token` → `200 OK` + `jwt`, `refresh_token`.

- **Refresh цепочка:**
  1. `POST /auth/session/refresh` → `200 OK` + новые токены.
  2. Предыдущий refresh-токен инвалидируется немедленно (rotating refresh tokens).

- **Logout:** `POST /auth/session/revoke` с `refresh_token` → `204 No Content`.

### 7.2 Модель данных (ER-конспект)
- `users (1) -- (N) identities`
- `users (1) -- (N) sessions`
- `users (1) -- (N) audit_events`
- `pending_sessions` не связана внешними ключами, только по `email`.

### 7.3 Детали интеграций
- **SMTP:**
  - Протокол: STARTTLS, порт 587.
  - Аутентификация: OAuth2 client credentials к mail relay.
  - Письма собираются шаблонизатором Handlebars (`templates/email/*`).
  - Rate limit: 5 писем в минуту на email, Redis key `smtp:<email>`.

- **Google OAuth:**
  - Scopes: `openid email profile`.
  - Клиент настроен в GCP Console, `redirect_uri` = `https://auth.gtstor.com/auth/google/callback`.
  - Проверяем `aud` и `iss`, кешируем Google public keys (JWKS) на 12 часов.
  - При первом логине создаём запись в `identities` и связываем с существующим `users` по email.

### 7.4 Контрольные команды диагностики
- Проверка состояния сервиса: `kubectl get pods -l app=gtc-auth`.
- Логи gateway: `kubectl logs deploy/gtc-auth-gateway --tail=100`.
- Метрики: `curl -H "Authorization: Bearer <ops-token>" https://auth.gtstor.com/auth/metrics`.
- SMTP латентность: `n8n-cli jobs run smtp-health-check`.
- Проверка связности с БД: `psql $DATABASE_URL -c 'select count(*) from users;'`.

---

> Последнее обновление: 2025-09-28
