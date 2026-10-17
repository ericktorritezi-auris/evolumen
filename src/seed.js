'use strict';
// Seeds idempotentes: rodar de novo não duplica nada.
const bcrypt = require('bcryptjs');
const log = require('./logger');

const LEGAL_PLACEHOLDER = '<p>Texto em elaboração. A minuta aprovada será publicada pelo painel, na área de Textos legais.</p>';

async function seed(pool, cfg) {
  const out = { admin: 'existente', legal: 0 };
  const admins = await pool.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin'");
  if (admins.rows[0].n === 0) {
    if (!cfg.adminEmail || !cfg.adminInitialPassword) {
      throw new Error('Não há administrador. Defina ADMIN_EMAIL e ADMIN_INITIAL_PASSWORD no Railway deste ambiente.');
    }
    if (cfg.adminInitialPassword.length < 8) throw new Error('ADMIN_INITIAL_PASSWORD precisa ter ao menos 8 caracteres.');
    const hash = await bcrypt.hash(cfg.adminInitialPassword, cfg.bcryptCost);
    const r = await pool.query(
      `INSERT INTO users (email, password_hash, role, name, must_change_password)
       VALUES ($1,$2,'admin','Erick Torritezi',TRUE)
       ON CONFLICT (lower(email)) DO NOTHING RETURNING id`, [cfg.adminEmail, hash]);
    if (r.rowCount) {
      await pool.query(`INSERT INTO audit_log (actor_email, action, entity, entity_id, meta) VALUES ($1,'admin_seeded','user',$2,'{}'::jsonb)`, [cfg.adminEmail, String(r.rows[0].id)]);
      out.admin = 'criado';
      log.info('admin_criado', { email: cfg.adminEmail });
    }
  }
  for (const [type, title] of [['terms', 'Termos de uso'], ['privacy', 'Política de privacidade']]) {
    const r = await pool.query(
      `INSERT INTO legal_documents (doc_type, version, title, body_html, status) VALUES ($1,'v1.0',$2,$3,'draft')
       ON CONFLICT (doc_type, version) DO NOTHING`, [type, title, LEGAL_PLACEHOLDER]);
    out.legal += r.rowCount;
  }
  return out;
}
module.exports = { seed };
