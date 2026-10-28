'use strict';
// Limite de downloads dos produtos digitais: cada aluno baixa cada arquivo um número fixo de vezes.
// Depois disso, só com pedido (e motivo) aprovado pelo administrador. Anexos de aula não têm limite.
const db = require('./db');
const Set_ = require('./settings');
const notify = require('./notify');

const expose = (msg, status = 400) => Object.assign(new Error(msg), { expose: true, status });

async function limitOf() {
  const n = Number((await Set_.all()).download_limit);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 3;
}

// Situação de cada arquivo para um aluno: usados, permitidos, restantes e se há pedido em aberto.
async function statusFor(userId, fileIds) {
  const ids = fileIds.map(Number).filter(Number.isInteger);
  const out = {};
  if (!ids.length) return out;
  const limit = await limitOf();
  const q = (await db.q('SELECT file_id, used, extra FROM file_quota WHERE user_id = $1 AND file_id = ANY($2::bigint[])', [userId, ids])).rows;
  const pend = new Set((await db.q("SELECT file_id FROM download_requests WHERE user_id = $1 AND status = 'pending' AND file_id = ANY($2::bigint[])", [userId, ids])).rows.map((x) => String(x.file_id)));
  for (const id of ids) {
    const row = q.find((x) => Number(x.file_id) === id) || { used: 0, extra: 0 };
    const allowed = limit + row.extra;
    out[id] = { used: row.used, allowed, left: Math.max(0, allowed - row.used), pending: pend.has(String(id)) };
  }
  return out;
}
const one = async (userId, fileId) => (await statusFor(userId, [fileId]))[Number(fileId)];

// Reserva um download antes de enviar o arquivo (atômico). Devolve false se o limite acabou.
async function reserve(userId, fileId) {
  const limit = await limitOf();
  const r = await db.q(`INSERT INTO file_quota (user_id, file_id, used, last_at) VALUES ($1,$2,1,now())
    ON CONFLICT (user_id, file_id) DO UPDATE SET used = file_quota.used + 1, last_at = now()
    WHERE file_quota.used < $3 + file_quota.extra RETURNING used`, [userId, fileId, limit]);
  return r.rowCount > 0;
}
// Devolve a reserva quando o envio não terminou.
const release = (userId, fileId) => db.q('UPDATE file_quota SET used = GREATEST(0, used - 1) WHERE user_id = $1 AND file_id = $2', [userId, fileId]);

// A pessoa já baixou algum arquivo deste produto? (libera a avaliação)
const hasDownloaded = async (userId, courseId) => (await db.q(`SELECT 1 FROM file_quota q JOIN product_files pf ON pf.file_id = q.file_id
  WHERE q.user_id = $1 AND pf.product_id = $2 AND q.used > 0 LIMIT 1`, [userId, courseId])).rowCount > 0;

const cleanReason = (s) => Array.from(String(s || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 500).join('');

// Pedido do aluno. Só vale se o limite acabou e se não há outro pedido em aberto para o mesmo arquivo.
async function request({ user, fileId, courseId, reason }) {
  const why = cleanReason(reason);
  if (Array.from(why).length < 10) throw expose('Conte o motivo com um pouco mais de detalhe (pelo menos 10 letras).');
  const st = await one(user.id, fileId);
  if (st.left > 0) throw expose('Você ainda tem downloads disponíveis para este arquivo.');
  if (st.pending) throw expose('Você já tem um pedido em análise para este arquivo.');
  let id;
  try {
    id = (await db.q('INSERT INTO download_requests (user_id, file_id, course_id, reason) VALUES ($1,$2,$3,$4) RETURNING id', [user.id, fileId, courseId, why])).rows[0].id;
  } catch (e) { if (e.code === '23505') throw expose('Você já tem um pedido em análise para este arquivo.'); throw e; }
  const info = (await db.q('SELECT c.title AS course, f.filename FROM courses c, files f WHERE c.id = $1 AND f.id = $2', [courseId, fileId])).rows[0] || {};
  await notify.toAdmins({ kind: 'dlreq', title: user.name + ' pediu novo download', body: `${info.course || ''} — ${info.filename || ''}`.slice(0, 230), link: '/admin/downloads', key: 'dlreq:' + id, subject: user.id });
  return id;
}

async function pending() {
  return (await db.q(`SELECT r.*, u.name AS student, u.email, c.title AS course, f.filename, COALESCE(q.used, 0) AS used, COALESCE(q.extra, 0) AS extra
    FROM download_requests r JOIN users u ON u.id = r.user_id JOIN courses c ON c.id = r.course_id JOIN files f ON f.id = r.file_id
    LEFT JOIN file_quota q ON q.user_id = r.user_id AND q.file_id = r.file_id
    WHERE r.status = 'pending' ORDER BY r.created_at`)).rows;
}
async function history(limit = 30) {
  return (await db.q(`SELECT r.id, r.status, r.reason, r.response, r.created_at, r.decided_at, u.name AS student, c.title AS course, f.filename
    FROM download_requests r JOIN users u ON u.id = r.user_id JOIN courses c ON c.id = r.course_id JOIN files f ON f.id = r.file_id
    WHERE r.status <> 'pending' ORDER BY r.decided_at DESC NULLS LAST, r.id DESC LIMIT $1`, [limit])).rows;
}
const pendingCount = async () => (await db.q("SELECT count(*)::int AS n FROM download_requests WHERE status = 'pending'")).rows[0].n;

// O administrador decide. Aprovar libera mais um download.
async function decide(id, approve, adminId, response) {
  const note = Array.from(cleanReason(response)).slice(0, 300).join('');
  const row = await db.tx(async (c) => {
    const r = (await c.query("SELECT * FROM download_requests WHERE id = $1 AND status = 'pending' FOR UPDATE", [id])).rows[0];
    if (!r) return null;
    await c.query('UPDATE download_requests SET status = $2, response = $3, decided_at = now(), decided_by = $4 WHERE id = $1', [id, approve ? 'approved' : 'denied', note, adminId]);
    if (approve) await c.query(`INSERT INTO file_quota (user_id, file_id, extra) VALUES ($1,$2,1) ON CONFLICT (user_id, file_id) DO UPDATE SET extra = file_quota.extra + 1`, [r.user_id, r.file_id]);
    return r;
  });
  if (!row) return null;
  await notify.resolveAdmins('dlreq:' + id);
  const info = (await db.q('SELECT c.title, c.slug FROM courses c WHERE c.id = $1', [row.course_id])).rows[0] || {};
  await notify.add(row.user_id, { kind: 'dlres', title: approve ? 'Novo download liberado' : 'Pedido de download negado',
    body: `${info.title || ''}${note ? ' — ' + note : ''}`.slice(0, 230), link: info.slug ? '/curso/' + info.slug : '', key: 'dlres:' + id });
  return row;
}

// Acesso cancelado (reembolso, estorno, cancelamento): o contador do produto volta a zero.
async function resetFor(client, userId, courseId) {
  await client.query("UPDATE notifications SET read_at = now() WHERE read_at IS NULL AND ref_key IN (SELECT 'dlreq:' || id FROM download_requests WHERE user_id = $1 AND course_id = $2 AND status = 'pending')", [userId, courseId]);
  // o depoimento publicado sai do ar; se o acesso voltar, o administrador decide de novo
  await client.query('UPDATE course_reviews SET published = false, published_at = NULL WHERE user_id = $1 AND course_id = $2', [userId, courseId]);
  await client.query('DELETE FROM file_quota WHERE user_id = $1 AND file_id IN (SELECT file_id FROM product_files WHERE product_id = $2)', [userId, courseId]);
  await client.query("UPDATE download_requests SET status = 'denied', response = 'Acesso cancelado', decided_at = now() WHERE user_id = $1 AND course_id = $2 AND status = 'pending'", [userId, courseId]);
}

module.exports = { limitOf, statusFor, one, reserve, release, hasDownloaded, request, pending, history, pendingCount, decide, resetFor, expose };
