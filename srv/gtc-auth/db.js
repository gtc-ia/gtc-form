import pg from 'pg';
const { Pool } = pg;

export { isEntitlementActive } from './entitlement.js';

export const pool = new Pool({
  host: process.env.PGHOST,
  port: +process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  max: 10,
  idleTimeoutMillis: 30000
});

export async function getUserByEmail(email) {
  const { rows } = await pool.query(
    'SELECT u.gtc_user_id, a.email, a.email_verified FROM public.auth_email a JOIN public."user" u ON u.gtc_user_id=a.user_id WHERE a.email=$1',
    [email]
  );
  return rows[0] || null;
}

export async function getGoogleBySub(sub) {
  const { rows } = await pool.query(
    'SELECT u.gtc_user_id, g.email, g.google_sub FROM public.auth_google g JOIN public."user" u ON u.gtc_user_id=g.user_id WHERE g.google_sub=$1',
    [sub]
  );
  return rows[0] || null;
}

export async function createEmailUser(email, pwdHash) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query('INSERT INTO public."user" DEFAULT VALUES RETURNING gtc_user_id');
    const userId = u.rows[0].gtc_user_id;
    await client.query(
      'INSERT INTO public.auth_email(user_id,email,pwd_hash,email_verified) VALUES ($1,$2,$3,false)',
      [userId, email, pwdHash]
    );
    await client.query('COMMIT');
    return userId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function createGoogleUser(email, sub) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query('INSERT INTO public."user" DEFAULT VALUES RETURNING gtc_user_id');
    const userId = u.rows[0].gtc_user_id;
    await client.query(
      'INSERT INTO public.auth_google(user_id,email,google_sub) VALUES ($1,$2,$3)',
      [userId, email, sub]
    );
    await client.query('COMMIT');
    return userId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getEmailRow(email) {
  const { rows } = await pool.query('SELECT * FROM public.auth_email WHERE email=$1', [email]);
  return rows[0] || null;
}

export async function setEmailVerified(userId, email) {
  await pool.query('UPDATE public.auth_email SET email_verified=true WHERE user_id=$1 AND email=$2', [userId, email]);
}

export async function createVerifyToken(userId, email, ttlMinutes = 60) {
  const { rows } = await pool.query(
    `INSERT INTO public.auth_verification(token,user_id,email,expires_at)
     VALUES (gen_random_uuid(),$1,$2,now() + ($3 || ' minutes')::interval)
     RETURNING token`,
    [userId, email, ttlMinutes]
  );
  return rows[0].token;
}

export async function useVerifyToken(token) {
  const { rows } = await pool.query(
    `UPDATE public.auth_verification
       SET used=true
     WHERE token=$1
       AND used=false
       AND expires_at>now()
     RETURNING user_id, email`,
    [token]
  );
  return rows[0] || null;
}

const ACTIVE_STATUSES = ['active', 'trialing'];

function isRelationMissing(error) {
  return error && error.code === '42P01';
}

function isColumnMissing(error) {
  return error && error.code === '42703';
}

export async function getLatestEntitlement(userId) {
  if (!userId) return null;

  const params = [userId];
  try {
    const { rows } = await pool.query(
      `SELECT status, end_date, livemode
         FROM public.v_user_entitlement
        WHERE gtc_user_id=$1
        ORDER BY end_date DESC NULLS LAST
        LIMIT 1`,
      params
    );
    if (rows[0]) return rows[0];
  } catch (error) {
    if (!isRelationMissing(error)) throw error;
  }

  try {
    const { rows } = await pool.query(
      `SELECT status, end_date, livemode
         FROM public.subscriptions
        WHERE gtc_user_id=$1
        ORDER BY end_date DESC NULLS LAST
        LIMIT 1`,
      params
    );
    if (rows[0]) return rows[0];
  } catch (error) {
    if (!isRelationMissing(error) && !isColumnMissing(error)) throw error;
    const { rows } = await pool.query(
      `SELECT status, end_date
         FROM public.subscriptions
        WHERE gtc_user_id=$1
        ORDER BY end_date DESC NULLS LAST
        LIMIT 1`,
      params
    );
    if (rows[0]) return rows[0];
  }

  return null;
}

export function isEntitlementActive(record) {
  if (!record) return false;
  const status = record.status ? String(record.status).toLowerCase() : '';
  if (!ACTIVE_STATUSES.includes(status)) return false;
  if (!record.end_date) return true;
  const expiresAt = new Date(record.end_date);
  if (Number.isNaN(expiresAt.getTime())) return true;
  return expiresAt.getTime() > Date.now();
}
