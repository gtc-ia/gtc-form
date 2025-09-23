require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let poolInstance;
let poolInitialized = false;

function parseBoolean(value) {
  if (typeof value !== 'string') {
    return Boolean(value);
  }
  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function buildSslConfig() {
  const { DB_SSL, DB_SSL_REJECT_UNAUTHORIZED } = process.env;
  if (!DB_SSL) {
    return undefined;
  }

  if (!parseBoolean(DB_SSL)) {
    return undefined;
  }

  const rejectUnauthorized = DB_SSL_REJECT_UNAUTHORIZED === undefined
    ? false
    : parseBoolean(DB_SSL_REJECT_UNAUTHORIZED);

  return { rejectUnauthorized };
}

function createPoolFromEnv() {
  const { DATABASE_URL, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  const ssl = buildSslConfig();

  if (DATABASE_URL) {
    return new Pool({
      connectionString: DATABASE_URL,
      ssl,
    });
  }

  if (DB_HOST && DB_USER && DB_NAME) {
    return new Pool({
      host: DB_HOST,
      port: DB_PORT ? Number(DB_PORT) : 5432,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      ssl,
    });
  }

  console.warn(
    'Database environment variables are not configured. ' +
      'Set DATABASE_URL or DB_HOST/DB_USER/DB_NAME for registration endpoints to work.',
  );
  return null;
}

function getPool() {
  if (!poolInitialized) {
    poolInstance = createPoolFromEnv();
    poolInitialized = true;
  }
  return poolInstance;
}

async function healthHandler(_req, res) {
  const pool = getPool();

  if (!pool) {
    res.json({ status: 'ok', database: 'not-configured' });
    return;
  }

  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Database health check failed', error);
    res.status(500).json({ status: 'error', database: 'unavailable' });
  }
}

async function registerHandler(req, res) {
  const action = req.body?.mode || req.body?.executionMode || req.body?.action;
  if (action && action !== 'register') {
    res.status(400).json({ error: 'Unsupported action', details: 'Only register mode is accepted.' });
    return;
  }

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : null;
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Invalid email address.' });
    return;
  }

  if (!password || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    return;
  }

  if (!/[a-z]/i.test(password) || !/\d/.test(password)) {
    res.status(400).json({
      error: 'Password must include at least one letter and one digit.',
    });
    return;
  }

  const pool = getPool();

  if (!pool) {
    res.status(503).json({ error: 'Database connection is not configured.' });
    return;
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT gtc_user_id FROM gtc_users WHERE LOWER(email) = $1 LIMIT 1',
      [email],
    );

    if (existing.rowCount > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Email is already registered.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const insertResult = await client.query(
      'INSERT INTO gtc_users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING gtc_user_id',
      [email, name, passwordHash],
    );

    await client.query('COMMIT');

    res.status(201).json({
      id: insertResult.rows[0].gtc_user_id,
      email,
      name,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Rollback failed after registration error', rollbackError);
      }
    }
    console.error('Failed to register user', error);
    res.status(500).json({ error: 'Failed to register user.' });
  } finally {
    if (client) {
      client.release();
    }
  }
}

app.get('/health', healthHandler);
app.post('/register', registerHandler);
app.post('/api/register', registerHandler);

function start() {
  const port = Number(process.env.PORT) || 3000;
  return app.listen(port, () => {
    console.log(`Registration service listening on port ${port}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  app,
  start,
  registerHandler,
  healthHandler,
};
