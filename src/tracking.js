'use strict';
// 1.7.0: acompanhamento de alunos (somente leitura). Não cria tabelas e não muda nada para o aluno:
// só junta o que já é gravado (matrícula, aulas concluídas, tempo assistido, provas e certificado).
const db = require('./db');
const C = require('./courses');
const assess = require('./assess');

const DAYS = [3, 7, 14, 30];
const DEFAULT_DAYS = 7;
const FILTERS = ['todos', 'andamento', 'parados', 'novos', 'concluidos'];
const num = (v) => (v === null || v === undefined ? null : Number(v));

const parseDays = (v) => { const n = parseInt(v, 10); return DAYS.includes(n) ? n : DEFAULT_DAYS; };
const parseFilter = (v) => (FILTERS.includes(v) ? v : 'todos');

// Situação de uma matrícula. Ordem importa: cancelada/vencida primeiro, depois certificado, conclusão, início e inatividade.
function situation(r, days) {
  if (r.status === 'cancelled') return 'cancelled';
  if (r.expired) return 'expired';
  if (r.scheduled) return 'scheduled';
  if (r.cert) return 'cert';
  if (r.total > 0 && r.done >= r.total) return r.exam_pending ? 'exam' : 'ok';
  if (!r.live_progress) return 'new';
  if (r.last_days !== null && r.last_days > days) return 'stop';
  return 'go';
}
const LIVE_STATES = new Set(['cert', 'ok', 'exam', 'go', 'stop', 'new']); // matrículas vigentes
const FILTER_OF = {
  andamento: new Set(['go']),
  parados: new Set(['stop']),
  novos: new Set(['new']),
  concluidos: new Set(['cert', 'ok', 'exam']),
};
const pct = (r) => (r.total ? Math.min(100, Math.floor((r.done / r.total) * 100)) : 0);

async function list(courseId, { days = DEFAULT_DAYS } = {}) {
  const rows = (await db.q(`
    SELECT e.id, e.user_id, e.expires_at, e.starts_at, (e.starts_at > now()) AS scheduled, e.status, e.origin, e.created_at,
      (e.expires_at IS NOT NULL AND e.expires_at <= now()) AS expired,
      u.name, u.email,
      (SELECT count(*)::int FROM lessons l WHERE l.course_id = e.course_id AND ${C.COUNTED}) AS total,
      (SELECT count(*)::int FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = e.user_id AND l.course_id = e.course_id AND ${C.COUNTED}) AS done,
      (SELECT count(*)::int FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = e.user_id AND l.course_id = e.course_id) AS any_progress,
      (SELECT count(*)::int FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = e.user_id AND l.course_id = e.course_id AND ${C.LIVE}) AS live_progress,
      lp.title AS last_title, lp.completed_at AS last_at,
      CASE WHEN lp.completed_at IS NULL THEN NULL ELSE floor(extract(epoch FROM (now() - lp.completed_at)) / 86400)::int END AS last_days,
      floor(extract(epoch FROM (now() - e.created_at)) / 86400)::int AS since_days,
      EXISTS (SELECT 1 FROM certificates c WHERE c.user_id = e.user_id AND c.course_id = e.course_id AND c.status = 'valid') AS cert,
      (EXISTS (SELECT 1 FROM assessments a WHERE a.course_id = e.course_id AND a.kind = 'final' AND a.active
              AND NOT EXISTS (SELECT 1 FROM assessment_questions x WHERE x.assessment_id = a.id AND x.active AND EXISTS (SELECT 1 FROM assessment_options o WHERE o.question_id = x.id AND o.correct)))
       OR EXISTS (SELECT 1 FROM assessments a WHERE a.course_id = e.course_id AND a.kind = 'final' AND a.active
              AND EXISTS (SELECT 1 FROM assessment_questions x WHERE x.assessment_id = a.id AND x.active AND EXISTS (SELECT 1 FROM assessment_options o WHERE o.question_id = x.id AND o.correct))
              AND NOT EXISTS (SELECT 1 FROM assessment_attempts t WHERE t.assessment_id = a.id AND t.user_id = e.user_id AND t.passed))) AS exam_pending
    FROM enrollments e JOIN users u ON u.id = e.user_id
    LEFT JOIN LATERAL (
      SELECT l.title, p.completed_at FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id
      WHERE p.user_id = e.user_id AND l.course_id = e.course_id AND ${C.LIVE}
      ORDER BY p.completed_at DESC, p.lesson_id DESC LIMIT 1) lp ON TRUE
    WHERE e.course_id = $1 ORDER BY e.created_at DESC`, [courseId])).rows;
  return rows.map((r) => ({ ...r, pct: pct(r), state: situation(r, days) }));
}

// Indicadores da faixa do topo: só entram matrículas vigentes (ativas e dentro do prazo).
function kpis(rows) {
  const live = rows.filter((r) => LIVE_STATES.has(r.state));
  const count = (s) => live.filter((r) => s.has(r.state)).length;
  return {
    enrolled: live.length,
    going: count(FILTER_OF.andamento),
    stopped: count(FILTER_OF.parados),
    fresh: count(FILTER_OF.novos),
    finished: count(FILTER_OF.concluidos),
    avg: live.length ? Math.round(live.reduce((s, r) => s + r.pct, 0) / live.length) : 0,
  };
}

function filter(rows, { q = '', f = 'todos' } = {}) {
  const norm = (v) => String(v || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const term = norm(String(q || '').trim());
  const set = FILTER_OF[f];
  return rows.filter((r) => (!set || set.has(r.state)) && (!term || norm(r.name).includes(term) || norm(r.email).includes(term)));
}

const agoDays = (n) => (n === null || n === undefined ? '' : n <= 0 ? 'hoje' : n === 1 ? 'há 1 dia' : `há ${n} dias`);

// Detalhe de uma matrícula: o curso inteiro, módulo a módulo, com o que o aluno já fez.
async function detail(enr, course) {
  const userId = enr.user_id;
  const [cur, prog, watch, ov, cert] = await Promise.all([
    C.curriculum(course.id),
    db.q('SELECT lesson_id, completed_at FROM lesson_progress WHERE user_id = $1', [userId]),
    db.q('SELECT lesson_id, watched_seconds, duration_seconds FROM lesson_watch WHERE user_id = $1', [userId]),
    assess.overview(userId, course),
    db.q("SELECT final_score, issued_at, status FROM certificates WHERE user_id = $1 AND course_id = $2 ORDER BY issued_at DESC LIMIT 1", [userId, course.id]),
  ]);
  const doneAt = new Map(prog.rows.map((p) => [String(p.lesson_id), p.completed_at]));
  const w = new Map(watch.rows.map((x) => [String(x.lesson_id), x]));
  let watchedSec = 0; let totalSec = 0; let last = null;
  const modules = cur.map((m) => {
    const lessons = m.lessons.map((l) => {
      const at = doneAt.get(String(l.id)) || null;
      const wt = w.get(String(l.id));
      const dur = wt && wt.duration_seconds > 0 ? wt.duration_seconds : (l.duration_min ? l.duration_min * 60 : 0);
      const watched = wt ? Math.min(wt.watched_seconds, dur || wt.watched_seconds) : 0;
      const wpct = dur > 0 ? Math.min(100, Math.floor((watched / dur) * 100)) : 0;
      if (!l.is_bonus && dur > 0) { totalSec += dur; watchedSec += watched; }
      if (at && (!last || new Date(at) > new Date(last.at))) last = { title: l.title, at };
      return { id: l.id, title: l.title, bonus: !!l.is_bonus, doneAt: at, wpct, state: at ? 'done' : (watched > 0 ? 'part' : 'none') };
    });
    const counted = lessons.filter((l) => !l.bonus);
    const mo = ov.modules[m.id] || {};
    return { id: m.id, title: m.title, lessons, done: counted.filter((l) => l.doneAt).length, total: counted.length, quiz: mo.quiz || null, locked: !!mo.locked };
  });
  const done = modules.reduce((s, m) => s + m.done, 0);
  const total = modules.reduce((s, m) => s + m.total, 0);
  return {
    modules, done, total, pct: total ? Math.floor((done / total) * 100) : 0,
    watchedSec, totalSec, last,
    final: ov.final ? { ...ov.final, best: num(ov.final.best) } : null,
    finalPending: ov.cert.needExam && !ov.final,
    cert: cert.rows[0] && cert.rows[0].status === 'valid' ? cert.rows[0] : null,
    certRevoked: !!(cert.rows[0] && cert.rows[0].status !== 'valid'),
    eligible: ov.cert.eligible,
  };
}

module.exports = { DAYS, DEFAULT_DAYS, FILTERS, parseDays, parseFilter, situation, list, kpis, filter, detail, agoDays, LIVE_STATES };
