'use strict';
const { Pool } = require('pg');

let pool = null;
function connect(cfg) {
  if (pool) return pool;
  pool = new Pool({
    connectionString: cfg.databaseUrl,
    ssl: cfg.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (e) => require('./logger').error('pg_pool_error', { error: e.message }));
  return pool;
}
const q = (text, params) => pool.query(text, params);
async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* ignora */ }
    throw e;
  } finally { c.release(); }
}
async function close() { if (pool) { await pool.end(); pool = null; } }
module.exports = { connect, q, tx, close, get pool() { return pool; } };
