'use strict';
// Configurações da plataforma (chave e valor). Valores padrão cobrem o que ainda não foi salvo.
const db = require('./db');

const DEFAULTS = { support_email: '', support_whatsapp: '', forum_enabled: '1', notify_questions: '1' };

async function all() {
  const rows = (await db.q('SELECT key, value FROM platform_settings')).rows;
  const out = { ...DEFAULTS };
  for (const r of rows) if (Object.hasOwn(DEFAULTS, r.key)) out[r.key] = r.value;
  return out;
}

async function save(values, userId) {
  await db.tx(async (c) => {
    for (const [k, v] of Object.entries(values)) {
      if (!Object.hasOwn(DEFAULTS, k)) continue;
      await c.query(`INSERT INTO platform_settings (key, value, updated_by) VALUES ($1,$2,$3)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`, [k, String(v), userId || null]);
    }
  });
}

module.exports = { all, save, DEFAULTS };
