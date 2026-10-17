'use strict';
// Auditoria: grava quem fez o quê, quando e de onde. A tabela não aceita edição nem exclusão.
const db = require('./db');
const log = require('./logger');

async function audit(req, action, { actor, entity = null, entityId = null, meta = {} } = {}) {
  const who = actor || (req && req.user) || null;
  try {
    await db.q(
      `INSERT INTO audit_log (actor_user_id, actor_email, action, entity, entity_id, meta, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [who ? who.id : null, who ? who.email : (meta && meta.email) || null, action, entity, entityId == null ? null : String(entityId),
        JSON.stringify(meta || {}), req ? (req.ip || null) : null, req ? ((req.get && req.get('user-agent')) || '').slice(0, 300) : null]);
  } catch (e) {
    log.error('audit_falhou', { action, error: e.message });
  }
}

function deviceLabel(ua = '') {
  const mobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  let browser = 'Navegador';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return `${mobile ? 'Celular' : 'Computador'} · ${browser}`;
}

module.exports = { audit, deviceLabel };
