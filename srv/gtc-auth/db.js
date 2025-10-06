import pg from 'pg';
const { Pool } = pg;

import { ACTIVE_STATUSES } from './entitlement.js';

const allowTestModeSubscriptions = process.env.ALLOW_TEST_MODE_SUBSCRIPTIONS !== 'false';

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

function isRelationMissing(error) {
  return error && error.code === '42P01';
}

function isColumnMissing(error) {
  return error && error.code === '42703';
}

export async function getLatestEntitlement(userId) {
  if (!userId) return null;

  const paramsWithMode = [userId, ACTIVE_STATUSES];
  const baseWhereParts = [
    'WHERE gtc_user_id=$1',
    'AND status = ANY($2)',
    'AND (end_date IS NULL OR end_date > NOW())'
  ];
  const baseWhereClause = baseWhereParts.join('\n        ');

  const whereParts = [...baseWhereParts];
  if (!allowTestModeSubscriptions) {
    whereParts.push('AND (livemode IS DISTINCT FROM false)');
  }
  const whereClauseWithLivemode = whereParts.join('\n        ');
  const orderClauseWithLivemode = `${allowTestModeSubscriptions ? 'CASE WHEN livemode THEN 0 ELSE 1 END, ' : ''}end_date DESC NULLS LAST`;

  try {
    const { rows } = await pool.query(
      `SELECT status, end_date, livemode
         FROM public.v_user_entitlement
        ${whereClauseWithLivemode}
        ORDER BY ${orderClauseWithLivemode}
        LIMIT 1`,
      paramsWithMode
    );
    if (rows[0]) return rows[0];
  } catch (error) {
    if (!isRelationMissing(error) && !isColumnMissing(error)) throw error;
  }

  try {
    const { rows } = await pool.query(
      `SELECT status, end_date, livemode
         FROM public.subscriptions
        ${whereClauseWithLivemode}
        ORDER BY ${orderClauseWithLivemode}
        LIMIT 1`,
      paramsWithMode
    );
    if (rows[0]) return rows[0];
  } catch (error) {
    if (!isRelationMissing(error) && !isColumnMissing(error)) throw error;
    const { rows } = await pool.query(
      `SELECT status, end_date
         FROM public.subscriptions
        ${baseWhereClause}
        ORDER BY end_date DESC NULLS LAST
        LIMIT 1`,
      paramsWithMode
    );
    if (rows[0]) return rows[0];
  }

  return null;
}
