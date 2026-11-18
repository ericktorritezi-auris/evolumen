'use strict';
// Atividade complementar (2.3.0): envio de links pelo aluno, avaliação, dispensa e reabertura pelo professor.
// A aula só vira concluída (lesson_progress) quando o professor aprova ou dispensa.
const db = require('./db');
const C = require('./courses');
const A = require('./assess');
const certs = require('./certificates');
const notify = require('./notify');
const emails = require('./emails');
const mailer = require('./mailer');

const MAX_LINKS = 5;
const MAX_SUMMARY = 20000;
const err = (msg, status = 400) => { const e = new Error(msg); e.status = status; e.expose = true; return e; };

const LABELS = {
  none: 'Aguardando envio', pending: 'Aguardando aprovação', adjust: 'Ajustes necessários', approved: 'Aprovada', rejected: 'Não aprovada', waived: 'Dispensada',
};

// ---- validação ----
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
function parseLinks(body) {
  const labels = arr(body.label).map((x) => String(x).trim());
  const urls = arr(body.url).map((x) => String(x).trim());
  const n = Math.max(labels.length, urls.length);
  const links = []; const errors = {};
  for (let i = 0; i < n; i++) {
    const label = (labels[i] || '').slice(0, 60); const url = urls[i] || '';
    if (!label && !url) continue; // linha em branco
    let ok = false;
    if (url.length <= 2000 && /^https:\/\/\S+$/i.test(url)) {
      try { const u = new URL(url); ok = u.protocol === 'https:' && u.hostname.includes('.') && !u.username && !u.password; } catch { ok = false; }
    }
    if (!ok) errors[links.length] = url ? 'O endereço precisa começar com https:// e ser um link completo.' : 'Cole o endereço do link.';
    links.push({ label: label || `Link ${links.length + 1}`, url });
  }
  if (!links.length) return { error: 'Envie pelo menos 1 link.', errors, links };
  if (links.length > MAX_LINKS) return { error: `Envie no máximo ${MAX_LINKS} links.`, errors, links };
  if (Object.keys(errors).length) return { error: 'Corrija os links indicados.', errors, links };
  return { links };
}
function parseGrade(raw) {
  const t = String(raw == null ? '' : raw).trim().replace(',', '.');
  if (t === '') return { grade: null };
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return { error: 'Nota inválida. Use um número de 0 a 10, como 8,5.' };
  const g = Math.round(Number(t) * 10) / 10;
  if (g < 0 || g > 10) return { error: 'A nota precisa estar entre 0 e 10.' };
  return { grade: g };
}

// ---- carregamento ----
async function lessonOf(courseId, lessonId) {
  if (!/^\d{1,12}$/.test(String(lessonId))) return null;
  return (await db.q(`SELECT l.* FROM lessons l WHERE l.id = $1 AND l.course_id = $2 AND ${C.LIVE} AND l.is_activity`, [lessonId, courseId])).rows[0] || null;
}
const subById = async (id) => (/^\d{1,12}$/.test(String(id)) ? (await db.q('SELECT * FROM activity_submissions WHERE id = $1', [id])).rows[0] || null : null);

const stateOf = async (userId, course, lessonId) => {
  const flat = C.flatLessons(await C.curriculum(course.id));
  const act = await A.activityState(userId, course.id, flat);
  return act.lessons[lessonId] || null;
};

// ---- ações ----
async function afterApproved(user, course, lessonId) {
  await db.q('INSERT INTO lesson_progress (user_id, lesson_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [user.id, lessonId]);
  try { return await certs.maybeIssue(user.id, course); } catch (e) { require('./logger').warn('certificado_apos_atividade', { error: e.message }); return null; }
}

async function submit(user, course, lesson, body) {
  const p = parseLinks(body);
  if (p.error) return { error: p.error, errors: p.errors, links: p.links };
  const st = await stateOf(user.id, course, lesson.id);
  if (!st || !['none', 'adjust'].includes(st.state)) throw err(st && st.state === 'pending' ? 'Você já enviou esta atividade e ela está aguardando a avaliação do professor.' : 'Esta atividade não aceita novos envios agora.', 409);
  let sub;
  try {
    sub = (await db.q('INSERT INTO activity_submissions (user_id, lesson_id, course_id, status, attempt_no, links) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *',
      [user.id, lesson.id, course.id, 'pending', st.sent + 1, JSON.stringify(p.links)])).rows[0];
  } catch (e) { if (e.code === '23505') throw err('Você já enviou esta atividade e ela está aguardando a avaliação do professor.', 409); throw e; }
  await notify.toAdmins({ kind: 'activity', title: `${user.name} ${sub.attempt_no > 1 ? 'reenviou' : 'enviou'} a atividade complementar`, body: `${course.title} · ${lesson.title}`, link: `/admin/atividades/${sub.id}`, key: `act:${sub.id}`, subject: user.id });
  return { sub };
}

async function tellStudent(cfg, h, { user, course, lesson, result, grade, summary }) {
  const url = `/curso/${course.slug}/aula/${lesson.id}`;
  const T = { approved: 'Sua atividade foi aprovada', adjust: 'Sua atividade precisa de ajustes', rejected: 'Sua atividade não foi aprovada', waived: 'Atividade dispensada pelo professor', reopened: 'Sua atividade foi reaberta para novo envio' };
  const g = grade == null ? '' : ` · nota ${Number(grade).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  await notify.add(user.id, { kind: 'activity', title: T[result], body: `${lesson.title} · ${course.title}${g}`, link: url, key: `actres:${user.id}:${lesson.id}:${Date.now()}`, subject: user.id });
  const send = mailer.send(cfg, { to: user.email, ...emails.activityResult(cfg, { name: user.name, course, lesson, result, grade, summary, url: cfg.baseUrl + url }) });
  if (h && h.background) h.background(send); else await send;
}

// Avaliação do professor sobre um envio aguardando.
async function evaluate(cfg, h, sub, admin, { decision, grade: gradeRaw, summary }) {
  const map = { approved: 'approved', adjust: 'adjust', rejected: 'rejected' };
  const status = map[decision];
  if (!status) return { error: 'Escolha o resultado: Aprovado, Ajustes necessários ou Não aprovado.' };
  const g = parseGrade(gradeRaw); if (g.error) return { error: g.error };
  if (status !== 'adjust' && g.grade == null) return { error: 'Informe a nota, de 0 a 10.' };
  const text = String(summary || '').trim();
  if (!text) return { error: 'Escreva o resumo para o aluno.' };
  if (text.length > MAX_SUMMARY) return { error: 'O resumo ficou grande demais. Reduza o texto.' };
  const r = await db.q("UPDATE activity_submissions SET status = $2, grade = $3, summary = $4, actor_id = $5, evaluated_at = now() WHERE id = $1 AND status = 'pending' RETURNING *", [sub.id, status, g.grade, text, admin.id]);
  if (!r.rowCount) throw err('Este envio já foi avaliado.', 409);
  const user = (await db.q('SELECT id, name, email FROM users WHERE id = $1', [sub.user_id])).rows[0];
  const course = await C.byId(sub.course_id);
  const lesson = (await db.q('SELECT * FROM lessons WHERE id = $1', [sub.lesson_id])).rows[0];
  let cert = null;
  if (status === 'approved') cert = await afterApproved(user, course, lesson.id);
  await notify.resolveAdmins(`act:${sub.id}`);
  if (user) await tellStudent(cfg, h, { user, course, lesson, result: status, grade: g.grade, summary: text });
  return { row: r.rows[0], user, course, lesson, cert };
}

// Dispensa: o professor conclui a atividade do aluno sem envio.
async function waive(cfg, h, admin, course, lessonId, userId, reason) {
  const lesson = await lessonOf(course.id, lessonId); if (!lesson) throw err('Atividade não encontrada.', 404);
  if (!/^\d{1,12}$/.test(String(userId))) throw err('Aluno não encontrado.', 404);
  const user = (await db.q(`SELECT u.id, u.name, u.email FROM users u JOIN enrollments e ON e.user_id = u.id WHERE u.id = $1 AND u.role = 'student' AND e.course_id = $2 AND e.status = 'active' LIMIT 1`, [userId, course.id])).rows[0];
  if (!user) throw err('Este aluno não está matriculado neste curso.', 404);
  const text = String(reason || '').trim().slice(0, 500);
  if (!text) return { error: 'Informe o motivo da dispensa (uma frase curta).' };
  const st = await stateOf(user.id, course, lesson.id);
  if (st && st.ok) return { error: 'Este aluno já concluiu esta atividade.' };
  if (st && st.state === 'pending') return { error: 'Há um envio aguardando avaliação. Avalie o envio em vez de dispensar.' };
  const w = await db.q(`INSERT INTO activity_submissions (user_id, lesson_id, course_id, status, attempt_no, summary, actor_id, evaluated_at)
    SELECT $1,$2,$3,'waived',$4,$5,$6,now() WHERE NOT EXISTS (SELECT 1 FROM activity_submissions x WHERE x.user_id = $1 AND x.lesson_id = $2 AND x.status IN ('approved','waived','pending')) RETURNING id`,
  [user.id, lesson.id, course.id, (st ? st.sent : 0) + 1, text, admin.id]);
  if (!w.rowCount) return { error: 'Este aluno já concluiu a atividade ou tem um envio aguardando avaliação.' };
  await afterApproved(user, course, lesson.id);
  await tellStudent(cfg, h, { user, course, lesson, result: 'waived', grade: null, summary: text });
  return { user, lesson };
}

// Reabre uma atividade "Não aprovada" para um novo envio.
async function reopen(cfg, h, admin, sub) {
  const ins = await db.q(`INSERT INTO activity_submissions (user_id, lesson_id, course_id, status, attempt_no, actor_id, evaluated_at)
    SELECT $1,$2,$3,'reopened',(SELECT x.attempt_no FROM activity_submissions x WHERE x.user_id = $1 AND x.lesson_id = $2 ORDER BY x.id DESC LIMIT 1),$4,now()
    WHERE (SELECT x.status FROM activity_submissions x WHERE x.user_id = $1 AND x.lesson_id = $2 ORDER BY x.id DESC LIMIT 1) = 'rejected' RETURNING id`, [sub.user_id, sub.lesson_id, sub.course_id, admin.id]);
  if (!ins.rowCount) return { error: 'Só é possível reabrir uma atividade que está como Não aprovada.' };
  const user = (await db.q('SELECT id, name, email FROM users WHERE id = $1', [sub.user_id])).rows[0];
  const course = await C.byId(sub.course_id);
  const lesson = (await db.q('SELECT * FROM lessons WHERE id = $1', [sub.lesson_id])).rows[0];
  if (user) await tellStudent(cfg, h, { user, course, lesson, result: 'reopened', grade: null, summary: '' });
  return { user, lesson };
}

// ---- listas do professor ----
const BASE = `FROM activity_submissions s JOIN users u ON u.id = s.user_id JOIN lessons l ON l.id = s.lesson_id JOIN courses c ON c.id = s.course_id`;
// Linhas com envio (não conta dispensa nem reabertura). Cada uma mostra o estado atual daquele aluno naquela aula.
async function list({ courseId = null, pendingOnly = false, limit = 25, offset = 0 } = {}) {
  const where = ["(s.status <> 'reopened')"]; const p = [];
  if (courseId) { p.push(courseId); where.push(`s.course_id = $${p.length}`); }
  if (pendingOnly) where.push("s.status = 'pending'");
  p.push(limit + 1); p.push(offset);
  const all = (await db.q(`SELECT s.*, u.name AS user_name, u.email AS user_email, l.title AS lesson_title, c.title AS course_title, c.slug AS course_slug,
      (SELECT x.status FROM activity_submissions x WHERE x.user_id = s.user_id AND x.lesson_id = s.lesson_id ORDER BY x.id DESC LIMIT 1) AS current_status
    ${BASE} WHERE ${where.join(' AND ')}
    ORDER BY (s.status = 'pending') DESC, CASE WHEN s.status = 'pending' THEN s.created_at END ASC, s.id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
  all.more = all.length > limit; if (all.more) all.pop();
  return all;
}
const pendingCount = async (courseId = null) => (await db.q(`SELECT count(*)::int AS n FROM activity_submissions WHERE status = 'pending' ${courseId ? 'AND course_id = $1' : ''}`, courseId ? [courseId] : [])).rows[0].n;
async function detail(id) {
  const s = (await db.q(`SELECT s.*, u.name AS user_name, u.email AS user_email, l.title AS lesson_title, c.title AS course_title, c.slug AS course_slug ${BASE} WHERE s.id = $1`, [id])).rows[0];
  if (!s) return null;
  s.history = (await db.q('SELECT s.*, a.name AS actor_name FROM activity_submissions s LEFT JOIN users a ON a.id = s.actor_id WHERE s.user_id = $1 AND s.lesson_id = $2 ORDER BY s.id', [s.user_id, s.lesson_id])).rows;
  s.current = s.history[s.history.length - 1].status;
  return s;
}
// Alunos matriculados com a situação em cada atividade do curso (para a aba "Atividades" e o botão Dispensar).
async function studentsOf(course) {
  const flat = C.flatLessons(await C.curriculum(course.id)).filter((l) => l.is_activity);
  if (!flat.length) return { lessons: [], rows: [] };
  const people = (await db.q(`SELECT DISTINCT u.id, u.name, u.email FROM enrollments e JOIN users u ON u.id = e.user_id AND u.role = 'student' WHERE e.course_id = $1 AND e.status = 'active' ORDER BY u.name, u.id`, [course.id])).rows;
  const subs = (await db.q('SELECT user_id, lesson_id, status, grade, id FROM activity_submissions WHERE course_id = $1 ORDER BY id', [course.id])).rows;
  const byKey = new Map();
  for (const x of subs) { const k = `${x.user_id}:${x.lesson_id}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(x); }
  const rows = people.map((u) => ({ ...u, cells: flat.map((l) => {
    const mine = byKey.get(`${u.id}:${l.id}`) || [];
    const last = mine[mine.length - 1];
    const okRow = mine.filter((x) => x.status === 'approved' || x.status === 'waived').pop();
    const state = okRow ? okRow.status : !last ? 'none' : last.status === 'reopened' ? 'adjust' : last.status;
    return { lessonId: l.id, state, grade: okRow && okRow.grade != null ? okRow.grade : last && last.grade, subId: (mine.filter((x) => x.status === 'pending').pop() || last || {}).id || null };
  }) }));
  return { lessons: flat, rows };
}

module.exports = { MAX_LINKS, LABELS, parseLinks, parseGrade, lessonOf, subById, stateOf, submit, evaluate, waive, reopen, list, pendingCount, detail, studentsOf };
