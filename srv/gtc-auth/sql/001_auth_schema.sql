CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users table (if not exists)
CREATE TABLE IF NOT EXISTS public."user" (
  gtc_user_id BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email auth
CREATE TABLE IF NOT EXISTS public.auth_email (
  user_id      BIGINT REFERENCES public."user"(gtc_user_id) ON DELETE CASCADE,
  email        TEXT NOT NULL UNIQUE,
  pwd_hash     TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pk_auth_email PRIMARY KEY (email)
);

-- Google auth
CREATE TABLE IF NOT EXISTS public.auth_google (
  user_id     BIGINT REFERENCES public."user"(gtc_user_id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  google_sub  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pk_auth_google PRIMARY KEY (google_sub)
);

-- Email verification tokens
CREATE TABLE IF NOT EXISTS public.auth_verification (
  token       UUID PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES public."user"(gtc_user_id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helper views/indexes
CREATE INDEX IF NOT EXISTS idx_auth_email_user ON public.auth_email(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_google_user ON public.auth_google(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_verif_user ON public.auth_verification(user_id);
