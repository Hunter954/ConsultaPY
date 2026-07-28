import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversation_sessions (
      jid TEXT PRIMARY KEY,
      step TEXT NOT NULL DEFAULT 'idle',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS search_cache (
      cache_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bot_logs (
      id BIGSERIAL PRIMARY KEY,
      level TEXT NOT NULL,
      event TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at ON bot_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON search_cache(expires_at);
  `);
}

export async function getSession(jid) {
  const { rows } = await pool.query('SELECT step, payload FROM conversation_sessions WHERE jid=$1', [jid]);
  return rows[0] || { step: 'idle', payload: {} };
}

export async function saveSession(jid, step, payload = {}) {
  await pool.query(`
    INSERT INTO conversation_sessions(jid, step, payload, updated_at)
    VALUES($1,$2,$3,NOW())
    ON CONFLICT(jid) DO UPDATE SET step=EXCLUDED.step, payload=EXCLUDED.payload, updated_at=NOW()
  `, [jid, step, payload]);
}

export async function clearSession(jid) {
  await saveSession(jid, 'idle', {});
}

export async function getCache(key) {
  const { rows } = await pool.query('SELECT payload FROM search_cache WHERE cache_key=$1 AND expires_at > NOW()', [key]);
  return rows[0]?.payload || null;
}

export async function setCache(key, payload, ttlSeconds) {
  await pool.query(`
    INSERT INTO search_cache(cache_key,payload,expires_at)
    VALUES($1,$2,NOW()+($3 * INTERVAL '1 second'))
    ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload, expires_at=EXCLUDED.expires_at
  `, [key, payload, ttlSeconds]);
}

export async function logEvent(level, event, details = {}) {
  try { await pool.query('INSERT INTO bot_logs(level,event,details) VALUES($1,$2,$3)', [level, event, details]); }
  catch (error) { console.error('Falha ao gravar log:', error.message); }
}

export async function recentLogs(limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { rows } = await pool.query('SELECT * FROM bot_logs ORDER BY created_at DESC LIMIT $1', [safeLimit]);
  return rows;
}
