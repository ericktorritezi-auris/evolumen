'use strict';
// Campainha: avisos dentro do sistema, para o aluno e para o professor. Melhor esforço: uma falha aqui nunca derruba a ação principal.
const db = require('./db');
const log = require('./logger');

const KEEP_DAYS = 7;

const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { log.warn('campainha_falhou', { error: e.message }); return null; } };
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

// Um aviso para uma pessoa. A mesma chave (ref_key) nunca gera dois avisos.
const add = safe(async (userId, { kind, title, body = '', link = '', key, subject = null }) => {
  if (!userId || !key) return null;
  const safeLink = /^\/(?![\/\\])[\x21-\x7e]*$/.test(link) ? link : '';
  const r = await db.q(`INSERT INTO notifications (user_id, subject_user_id, kind, title, body, link, ref_key) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (user_id, ref_key) DO NOTHING RETURNING id`, [userId, subject, clip(kind, 30), clip(title, 160), clip(body, 240), safeLink, clip(key, 120)]);
  return r.rows[0] ? r.rows[0].id : null;
});

// Um aviso para cada administrador ativo.
const toAdmins = safe(async (opts) => {
  const admins = (await db.q("SELECT id FROM users WHERE role = 'admin' AND status = 'active'")).rows;
  for (const a of admins) await add(a.id, opts);
});

// A pessoa interagiu (respondeu, decidiu): os avisos com essa chave ficam cinza.
const resolveAdmins = safe(async (key) => {
  await db.q("UPDATE notifications SET read_at = now() WHERE ref_key = $1 AND read_at IS NULL AND user_id IN (SELECT id FROM users WHERE role = 'admin')", [key]);
});
// Resolve todos os avisos dos administradores cuja chave começa com o prefixo (ex.: todos os níveis de "tentativas esgotadas" de um aluno).
const resolveAdminsPrefix = safe(async (prefix) => {
  await db.q("UPDATE notifications SET read_at = now() WHERE left(ref_key, $2) = $1 AND read_at IS NULL AND user_id IN (SELECT id FROM users WHERE role = 'admin')", [prefix, String(prefix).length]);
});
const resolveFor = safe(async (userId, key) => { await db.q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND ref_key = $2 AND read_at IS NULL', [userId, key]); });

const resolveRefundsOf = safe(async (orderId) => {
  await db.q("UPDATE notifications SET read_at = now() WHERE read_at IS NULL AND ref_key IN (SELECT 'refund:' || id FROM refund_requests WHERE order_id = $1) AND user_id IN (SELECT id FROM users WHERE role = 'admin')", [orderId]);
});

async function list(userId, limit = 30) {
  const rows = (await db.q('SELECT id, kind, title, body, created_at, read_at FROM notifications WHERE user_id = $1 AND (read_at IS NULL OR read_at > now() - interval \'7 days\') ORDER BY created_at DESC, id DESC LIMIT $2', [userId, limit])).rows;
  const unread = (await db.q('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId])).rows[0].n;
  return { unread, items: rows.map((x) => ({ id: String(x.id), kind: x.kind, title: x.title, body: x.body, at: x.created_at, read: !!x.read_at })) };
}

// Abrir um aviso: marca como lido e devolve o endereço de destino (só caminhos do próprio site).
async function open(id, userId) {
  if (!/^\d{1,12}$/.test(String(id))) return null;
  const r = await db.q('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING link', [id, userId]);
  return r.rows[0] ? (r.rows[0].link || '') : null;
}
const markAll = (userId) => db.q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);

// Lidos há mais de 7 dias saem da lista; os que ninguém abriu saem depois de 90 dias.
const cleanup = safe(async () => {
  // Lidos há mais de 7 dias só saem da lista; o registro (e sua chave) fica 1 ano para o mesmo aviso não voltar.
  await db.q("DELETE FROM notifications WHERE COALESCE(read_at, created_at) < now() - interval '400 days'");
});

module.exports = { add, toAdmins, resolveAdmins, resolveAdminsPrefix, resolveFor, resolveRefundsOf, list, open, markAll, cleanup, KEEP_DAYS };
