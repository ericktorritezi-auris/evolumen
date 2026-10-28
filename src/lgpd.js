'use strict';
// LGPD: cópia dos dados do titular, anonimização a pedido e consulta dos aceites.
const crypto = require('crypto');
const db = require('./db');

const REMOVED = '[mensagem removida a pedido do titular]';

// Tudo o que o sistema guarda sobre a pessoa (sem o hash da senha).
async function exportFor(userId) {
  const u = (await db.q('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
  if (!u) return null;
  const { password_hash, failed_logins, locked_until, ...user } = u;
  const q = async (sql) => (await db.q(sql, [userId])).rows;
  return {
    gerado_em: new Date().toISOString(), usuario: user,
    aceites: await q('SELECT doc_type, version, accepted_at, ip, device, origin FROM acceptances WHERE user_id = $1 ORDER BY accepted_at'),
    pedidos_de_dados: await q('SELECT type, status, created_at, due_at, resolved_at, response FROM data_requests WHERE user_id = $1 ORDER BY id'),
    compras: await q(`SELECT o.public_id, c.title AS curso, o.kind, o.method, o.status, o.price_cents, o.paid_cents, o.installments, o.created_at, o.approved_at, o.refunded_at
      FROM orders o JOIN courses c ON c.id = o.course_id WHERE o.user_id = $1 ORDER BY o.id`),
    matriculas: await q('SELECT c.title AS curso, e.origin, e.status, e.starts_at, e.expires_at, e.cancelled_at FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = $1 ORDER BY e.id'),
    certificados: await q('SELECT code, course_title, hours, final_score, issued_at, status FROM certificates WHERE user_id = $1 ORDER BY id'),
    tentativas_de_avaliacao: await q('SELECT assessment_id, number, score, passed, started_at, finished_at FROM assessment_attempts WHERE user_id = $1 ORDER BY id'),
    emails_enviados: await q('SELECT subject, template, status, created_at FROM email_log WHERE lower(to_email) = lower((SELECT email FROM users WHERE id = $1)) ORDER BY id'),
    aulas_concluidas: await q('SELECT l.title AS aula, p.completed_at FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = $1 ORDER BY p.completed_at'),
    mensagens_do_forum: await q('SELECT lesson_id, body, status, created_at FROM forum_posts WHERE user_id = $1 ORDER BY id'),
    avaliacoes_de_cursos: await q('SELECT course_id, stars, nps, comment, created_at, updated_at FROM course_reviews WHERE user_id = $1 ORDER BY id'),
    registro_de_atividade: await q('SELECT at, action, ip FROM audit_log WHERE actor_user_id = $1 ORDER BY id'),
  };
}

// Anonimiza a conta. Ficam guardados por obrigação legal: pedidos (registro financeiro), aceites dos termos e certificados.
async function anonymize(userId, client) {
  const run = client ? (fn) => fn(client) : (fn) => db.tx(fn);
  return run(async (c) => {
    const u = (await c.query('SELECT id, role, email FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    if (!u || u.role !== 'student') throw new Error('Conta não pode ser anonimizada');
    await c.query(`UPDATE users SET name = 'Aluno removido', email = $2, phone = NULL, cpf = NULL, birth_date = NULL, cep = NULL, street = NULL, street_number = NULL,
      complement = NULL, district = NULL, city = NULL, state = NULL, status = 'blocked', must_change_password = FALSE, password_hash = $3, mascot_enabled = FALSE, updated_at = now() WHERE id = $1`,
    [userId, `removido-${userId}@removido.invalid`, '!' + crypto.randomBytes(24).toString('hex')]);
    await c.query("UPDATE enrollments SET status = 'cancelled', cancelled_at = now() WHERE user_id = $1 AND status = 'active'", [userId]);
    await c.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await c.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
    await c.query('DELETE FROM email_changes WHERE user_id = $1', [userId]);
    await c.query('UPDATE forum_posts SET body = $2 WHERE user_id = $1', [userId, REMOVED]);
    // Rastros do e-mail antigo que não precisam ser guardados.
    await c.query('UPDATE email_log SET to_email = $2 WHERE lower(to_email) = lower($1)', [u.email, `removido-${userId}@removido.invalid`]);
    await c.query("UPDATE data_requests SET note = NULL WHERE user_id = $1 AND type = 'email_change_admin'", [userId]);
    await c.query("UPDATE webhook_events w SET payload = '{}'::jsonb FROM orders o WHERE o.user_id = $1 AND w.provider = o.provider AND w.payment_id = o.provider_payment_id", [userId]);
    await c.query("UPDATE course_reviews SET comment = '' WHERE user_id = $1", [userId]);
    return true;
  });
}

// O aviso de que a exclusão foi atendida sai para o e-mail antigo; depois dele o registro de envios é limpo de novo.
const scrubEmailLog = (email, userId) => db.q('UPDATE email_log SET to_email = $2 WHERE lower(to_email) = lower($1)', [email, `removido-${userId}@removido.invalid`]);

const csvCell = (v) => {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmula ao abrir no Excel
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function acceptFilter(f) {
  const w = ['1=1']; const p = [];
  if (f.q) { p.push(`%${f.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`); w.push(`(u.name ILIKE $${p.length} OR u.email ILIKE $${p.length})`); }
  if (f.doc) { p.push(f.doc); w.push(`a.doc_type = $${p.length}`); }
  return { where: w.join(' AND '), p };
}
async function listAcceptances(f, { limit = 30, offset = 0 } = {}) {
  const { where, p } = acceptFilter(f);
  const total = (await db.q(`SELECT count(*)::int AS n FROM acceptances a JOIN users u ON u.id = a.user_id WHERE ${where}`, p)).rows[0].n;
  const rows = (await db.q(`SELECT a.*, u.name, u.email FROM acceptances a JOIN users u ON u.id = a.user_id WHERE ${where} ORDER BY a.accepted_at DESC, a.id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, p)).rows;
  return { total, rows };
}

module.exports = { scrubEmailLog, exportFor, anonymize, csvCell, listAcceptances, REMOVED };
