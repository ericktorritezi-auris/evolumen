'use strict';
// Roda as migrações em ordem, uma vez cada, com trava para dois processos não rodarem juntos.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const log = require('./logger');

const LOCK_ID = 7421001;
const DIR = path.join(__dirname, '..', 'migrations');

async function migrate(pool) {
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const files = fs.readdirSync(DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    const done = new Map((await c.query('SELECT name, checksum FROM schema_migrations')).rows.map((r) => [r.name, r.checksum]));
    const applied = [];
    for (const f of files) {
      const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
      const sum = crypto.createHash('sha256').update(sql).digest('hex');
      if (done.has(f)) {
        if (done.get(f) !== sum) throw new Error(`Migração ${f} foi alterada depois de aplicada. Crie uma migração nova.`);
        continue;
      }
      try {
        await c.query('BEGIN');
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1,$2)', [f, sum]);
        await c.query('COMMIT');
        applied.push(f);
        log.info('migracao_aplicada', { name: f });
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Falha na migração ${f}: ${e.message}`);
      }
    }
    return { total: files.length, applied };
  } finally {
    try { await c.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); } catch { /* ignora */ }
    c.release();
  }
}
module.exports = { migrate };
