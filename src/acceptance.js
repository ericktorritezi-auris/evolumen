'use strict';
// Aceites LGPD: prova de quem aceitou qual documento e versão, quando e de onde.
const db = require('./db');
const { audit, deviceLabel } = require('./audit');

// Documentos publicados (a versão mais recente de cada tipo) que o usuário ainda não aceitou.
async function pendingFor(userId) {
  const r = await db.q(PENDING_SQL, [userId]);
  return r.rows;
}
const PENDING_SQL = `
  SELECT d.* FROM legal_documents d
  WHERE d.status = 'published'
    AND d.id = (SELECT d2.id FROM legal_documents d2 WHERE d2.doc_type = d.doc_type AND d2.status = 'published'
                ORDER BY d2.published_at DESC, d2.id DESC LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM acceptances a WHERE a.user_id = $1 AND a.legal_document_id = d.id)
  ORDER BY d.doc_type`;

async function record(req, user, docs, origin = 'login') {
  const ua = (req.get('user-agent') || '').slice(0, 300);
  // Uma transação e ON CONFLICT: duplo clique não grava aceite repetido (a tabela é imutável).
  const fresh = await db.tx(async (c) => {
    const done = [];
    for (const d of docs) {
      const r = await c.query(
        `INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, ip, user_agent, device, origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id, legal_document_id) DO NOTHING`,
        [user.id, d.id, d.doc_type, d.version, req.ip || null, ua, deviceLabel(ua), origin]);
      if (r.rowCount) done.push(d);
    }
    return done;
  });
  for (const d of fresh) await audit(req, 'acceptance_recorded', { actor: user, entity: 'legal_document', entityId: d.id, meta: { doc_type: d.doc_type, version: d.version, origin } });
}

async function listFor(userId) {
  const r = await db.q('SELECT doc_type, version, accepted_at, ip, device, origin FROM acceptances WHERE user_id = $1 ORDER BY accepted_at DESC, id DESC', [userId]);
  return r.rows;
}

module.exports = { pendingFor, record, listFor };
