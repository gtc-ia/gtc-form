import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import {
  pool,
  getUserByEmail,
  getEmailRow,
  createEmailUser,
  createVerifyToken,
  useVerifyToken,
  setEmailVerified,
  getGoogleBySub,
  createGoogleUser,
  getLatestEntitlement,
  isEntitlementActive
} from './db.js';
import { sendVerificationEmail } from './mail.js';
import { verifyGoogleCredential } from './google.js';

const PASSWORD_POLICY = {
  minLength: 8,
  letter: /[A-Za-z]/,
  digit: /\d/,
  special: /[^A-Za-z0-9]/
};

function isPasswordStrong(password) {
  const value = String(password);
  return (
    value.length >= PASSWORD_POLICY.minLength &&
    PASSWORD_POLICY.letter.test(value) &&
    PASSWORD_POLICY.digit.test(value) &&
    PASSWORD_POLICY.special.test(value)
  );
}

const app = express();

app.use(helmet());
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: (o, cb) => cb(null, !o || origins.length === 0 || origins.includes(o)),
    credentials: false
  })
);
const limiter = rateLimit({ windowMs: +process.env.RATE_WINDOW_MS || 60000, max: +process.env.RATE_MAX || 60 });
app.use('/auth/', limiter);

app.get('/auth/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'db_unreachable' });
  }
});

app.post('/auth/check_email', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ code: 'bad_request' });
  try {
    const row = await getEmailRow(String(email).toLowerCase());
    res.json({ exists: !!row });
  } catch (e) {
    res.status(500).json({ code: 'server_error' });
  }
});

app.post('/auth/register', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ code: 'bad_request' });
  const em = String(email).toLowerCase();
  try {
    const exists = await getEmailRow(em);
    if (exists) return res.status(409).json({ code: 'email_taken' });

    if (!isPasswordStrong(password)) {
      return res.status(400).json({ code: 'weak_password' });
    }

    const rounds = +process.env.BCRYPT_ROUNDS || 12;
    const hash = await bcrypt.hash(password, rounds);
    const userId = await createEmailUser(em, hash);

    const token = await createVerifyToken(userId, em, 60);
    await sendVerificationEmail(em, token);

    res.json({ queued_verification: true, email: em });
  } catch (e) {
    res.status(500).json({ code: 'server_error' });
  }
});

app.post('/auth/request_email_verification', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ code: 'bad_request' });
  try {
    const row = await getEmailRow(String(email).toLowerCase());
    if (!row) return res.json({ ok: true });
    const token = await createVerifyToken(row.user_id, row.email, 60);
    await sendVerificationEmail(row.email, token);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ code: 'server_error' });
  }
});

app.post('/auth/verify', async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ code: 'bad_request' });
  try {
    const used = await useVerifyToken(token);
    if (!used) return res.status(400).json({ code: 'invalid_or_expired' });
    await setEmailVerified(used.user_id, used.email);
    res.json({ gtc_user_id: used.user_id, email: used.email, verified: true });
  } catch (e) {
    res.status(500).json({ code: 'server_error' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ code: 'bad_request' });
  try {
    const row = await getEmailRow(String(email).toLowerCase());
    if (!row) return res.status(401).json({ code: 'invalid_credentials' });
    const ok = await bcrypt.compare(password, row.pwd_hash);
    if (!ok) return res.status(401).json({ code: 'invalid_credentials' });
    if (!row.email_verified) return res.status(403).json({ code: 'email_not_verified' });
    const u = await getUserByEmail(row.email);
    res.json({ gtc_user_id: u.gtc_user_id, email: row.email });
  } catch (e) {
    res.status(500).json({ code: 'server_error' });
  }
});

app.post('/auth/google', async (req, res) => {
  const { google_credential } = req.body || {};
  if (!google_credential) return res.status(400).json({ code: 'bad_request' });
  try {
    const { email, sub } = await verifyGoogleCredential(google_credential);

    const g = await getGoogleBySub(sub);
    if (g) return res.json({ gtc_user_id: g.gtc_user_id, email: g.email });

    const row = await getEmailRow(email);
    if (row && row.email_verified) {
      await pool.query(
        'INSERT INTO public.auth_google(user_id,email,google_sub) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [row.user_id, email, sub]
      );
      return res.json({ gtc_user_id: row.user_id, email });
    }

    const newId = await createGoogleUser(email, sub);
    return res.json({ gtc_user_id: newId, email });
  } catch (e) {
    res.status(401).json({ code: 'invalid_google_token' });
  }
});

app.get('/auth/subscription_status', async (req, res) => {
  const { gtc_user_id: rawId } = req.query || {};
  if (!rawId) return res.status(400).json({ code: 'bad_request' });

  const trimmed = String(rawId).trim();
  if (!trimmed) return res.status(400).json({ code: 'bad_request' });

  try {
    const entitlement = await getLatestEntitlement(trimmed);
    if (!entitlement) {
      return res.json({ active: false, status: null, expires_at: null });
    }

    const active = isEntitlementActive(entitlement);
    const payload = {
      active,
      status: entitlement.status ?? null,
      expires_at: entitlement.end_date ?? null
    };

    if (Object.prototype.hasOwnProperty.call(entitlement, 'livemode')) {
      payload.livemode = entitlement.livemode;
    }

    res.json(payload);
  } catch (error) {
    console.error('subscription_status error', error);
    res.status(500).json({ code: 'server_error' });
  }
});

const port = +process.env.PORT || 8085;
app.listen(port, () => console.log(`gtc-auth listening on ${port}`));
