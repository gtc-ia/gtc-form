# Интеграция `/auth` в страницу `/chat`

Документ описывает, как уже реализованные бекенд‑маршруты `/auth/*` работают (ответы, куки, редиректы), и даёт готовый сниппет для встраивания форм логина/регистрации прямо в страницу `/chat` без изменений сервера.

## Кратко о поведении бекенда
- **Куки.** После успешного логина/верификации/Google входа сервер ставит HTTP‑only куку с `gtc_user_id` (`AUTH_COOKIE_NAME`, по умолчанию `gtc_post_auth`) с параметрами `SameSite=Lax`, `path=/auth`, `secure` в проде и доменом из `AUTH_COOKIE_DOMAIN`; максимальный возраст по умолчанию 10 минут. Кука очищается в `/auth/finish` после редиректа.
- **JWT не выдаётся.** Фронт полагается только на указанную куку; токены JWT не формируются.
- **Роуты OTP отсутствуют.** Маршрутов `/auth/otp/*` в коде нет.

## Маршруты и ответы
- `POST /auth/register` → `{ queued_verification: true, email }`; проверяет уникальность email, силу пароля, создаёт пользователя и отправляет письмо.
- `POST /auth/request_email_verification` → `{ ok: true }` (или `already_verified: true`).
- `POST /auth/verify` → `{ gtc_user_id, email, verified: true }` и установка куки.
- `POST /auth/login` → `{ gtc_user_id, email }` и установка куки (только после подтверждения email).
- `POST /auth/google` → `{ gtc_user_id, email }` и установка куки; при плохом токене `{ code: 'invalid_google_token' }` с HTTP 401.
- `GET /auth/finish` читает куку: если её нет — 302 на `/auth/`; если есть — решает, активна ли подписка, и делает 302 либо на чат (`APP_BASE_URL + CHAT_REDIRECT_PATH`), либо на оплату (`PAYMENT_PORTAL_URL`). После редиректа кука очищается.

## Готовый сниппет для фронта `/chat`
Вставьте этот код в страницу `/chat`, чтобы вызвать существующие бекенд‑маршруты. Он не требует изменений на сервере.

```html
<script>
  async function postJSON(path, payload) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.code || res.statusText);
    }
    return res.json();
  }

  async function login(email, password) {
    await postJSON('/auth/login', { email, password });
    window.location.href = '/auth/finish' + (window.location.search || '');
  }

  async function register(name, email, password) {
    await postJSON('/auth/register', { name, email, password });
    alert('Проверьте почту и подтвердите email, затем нажмите «Перейти в чат».');
  }

  async function loginWithGoogle(idToken) {
    await postJSON('/auth/google', { google_credential: idToken });
    window.location.href = '/auth/finish' + (window.location.search || '');
  }

  async function resendVerification(email) {
    await postJSON('/auth/request_email_verification', { email });
    alert('Если аккаунт найден, письмо отправлено повторно.');
  }
</script>
```

### Что ожидает чатовая страница
1) Вызвать один из POST‑маршрутов (`/auth/login`, `/auth/register`, `/auth/google`, `/auth/verify`) — сервер сам поставит куку `AUTH_COOKIE_NAME` с `gtc_user_id`.
2) Перейти на `/auth/finish` (как показано в примере) — сервер проверит подписку и перенаправит в чат или на оплату.
3) Дополнительных токенов или параметров передавать не нужно; все решения принимаются на сервере.
