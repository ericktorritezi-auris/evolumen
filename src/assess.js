'use strict';
// Regras da Fase 3: quiz por módulo, prova final, tentativas, tempo assistido e liberação do certificado.
//  - Quiz do módulo (opcional): não pesa na nota final. Se existir (ativo e com questões), o aluno só avança para o
//    módulo seguinte com nota >= mínima, em até N tentativas (+ extras liberadas pelo administrador).
//  - Prova final (uma por curso): libera na última aula do último módulo, depois de assistir mais da metade dela.
//  - Certificado: prova aprovada + 95% do curso concluído (ver certificates.js).
const db = require('./db');
const C = require('./courses');

const HALF = 0.5;
const CERT_PCT = 95;

const run = (c, sql, p) => (c ? c.query(sql, p) : db.q(sql, p));
const err = (msg, status = 403) => { const e = new Error(msg); e.status = status; e.expose = true; return e; };
const num = (v) => (v == null ? null : Number(v));
const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = require('crypto').randomInt(i + 1); [x[i], x[j]] = [x[j], x[i]]; } return x; };

// ---------- cadastro ----------
const byId = async (id) => (/^\d{1,12}$/.test(String(id)) ? (await db.q('SELECT * FROM assessments WHERE id = $1', [id])).rows[0] || null : null);

const QCOUNT = `(SELECT count(*)::int FROM assessment_questions x WHERE x.assessment_id = a.id AND x.active
  AND EXISTS (SELECT 1 FROM assessment_options o WHERE o.question_id = x.id AND o.correct)) AS qcount`;

// Avaliações do curso com o número de questões prontas (ativas e com resposta correta).
async function ofCourse(courseId) {
  return (await db.q(`SELECT a.*, ${QCOUNT} FROM assessments a WHERE a.course_id = $1 ORDER BY a.kind DESC, a.id`, [courseId])).rows;
}

async function questions(assessmentId, { all = false } = {}) {
  const qs = (await db.q('SELECT * FROM assessment_questions WHERE assessment_id = $1 AND ($2 OR active) ORDER BY position, id', [assessmentId, all])).rows;
  if (!qs.length) return [];
  const os = (await db.q('SELECT * FROM assessment_options WHERE question_id = ANY($1::bigint[]) ORDER BY position, id', [qs.map((q) => q.id)])).rows;
  return qs.map((q) => ({ ...q, options: os.filter((o) => o.question_id === q.id) }));
}

// ---------- estado do aluno ----------
async function attemptStats(userId, ids) {
  if (!ids.length) return {};
  const rows = (await db.q(`
    SELECT a.id,
      (SELECT count(*)::int FROM assessment_attempts t WHERE t.assessment_id = a.id AND t.user_id = $1) AS used,
      (SELECT max(score) FROM assessment_attempts t WHERE t.assessment_id = a.id AND t.user_id = $1 AND t.finished_at IS NOT NULL) AS best,
      EXISTS (SELECT 1 FROM assessment_attempts t WHERE t.assessment_id = a.id AND t.user_id = $1 AND t.passed) AS passed,
      (SELECT t.id FROM assessment_attempts t WHERE t.assessment_id = a.id AND t.user_id = $1 AND t.finished_at IS NULL) AS open_id,
      COALESCE((SELECT sum(g.extra)::int FROM attempt_grants g WHERE g.assessment_id = a.id AND g.user_id = $1), 0) AS extra,
      EXISTS (SELECT 1 FROM exam_unlocks u WHERE u.assessment_id = a.id AND u.user_id = $1) AS manual_unlock
    FROM assessments a WHERE a.id = ANY($2::bigint[])`, [userId, ids])).rows;
  const out = {};
  for (const r of rows) out[r.id] = { used: r.used, best: num(r.best), passed: r.passed, open_id: r.open_id, extra: r.extra, manual_unlock: r.manual_unlock };
  return out;
}

// Retrato completo do aluno em um curso: bloqueios por quiz, prova final e certificado.
async function overview(userId, course) {
  const cur = await C.curriculum(course.id);
  const flat = C.flatLessons(cur);
  const progress = await C.progressFor(userId, course.id);
  const asm = (await ofCourse(course.id)).filter((a) => a.active && a.qcount > 0);
  const stats = await attemptStats(userId, asm.map((a) => a.id));
  const withState = (a) => {
    const s = stats[a.id] || { used: 0, best: null, passed: false, open_id: null, extra: 0, manual_unlock: false };
    const limit = a.max_attempts + s.extra;
    return { ...a, ...s, limit, left: Math.max(0, limit - s.used), pass: num(a.pass_score) };
  };
  const modules = {}; let blocked = false; let blockedBy = null;
  for (const m of cur) {
    const q = asm.find((a) => a.kind === 'quiz' && a.module_id === m.id);
    const quiz = q ? withState(q) : null;
    const allDone = m.lessons.every((l) => l.is_bonus || progress.done.has(String(l.id)));
    modules[m.id] = { locked: blocked, blockedBy, quiz, allDone, quizAvailable: !!quiz && !blocked && allDone };
    if (quiz && !quiz.passed && !blocked) { blocked = true; blockedBy = { id: m.id, title: m.title }; }
  }
  // prova final
  const fa = asm.find((a) => a.kind === 'final');
  let final = null;
  if (fa) {
    final = withState(fa);
    const last = flat.filter((l) => !l.is_bonus).pop(); // a última aula que vale para o certificado (bônus não conta)
    let unlocked = false; let why = ''; let watchPct = 0;
    if (final.manual_unlock) unlocked = true;
    else if (!last) why = 'O curso ainda não tem aulas.';
    else if (modules[last.module_id] && modules[last.module_id].locked) why = 'Passe no quiz do módulo anterior para chegar à última aula.';
    else if (last.has_video) {
      const w = (await db.q('SELECT watched_seconds, duration_seconds FROM lesson_watch WHERE user_id = $1 AND lesson_id = $2', [userId, last.id])).rows[0];
      unlocked = !!w && w.duration_seconds > 0 && w.watched_seconds >= w.duration_seconds * HALF;
      watchPct = w && w.duration_seconds > 0 ? Math.min(100, Math.floor((w.watched_seconds / w.duration_seconds) * 100)) : 0;
      why = `Assista a mais da metade da última aula (“${last.title}”) para liberar a prova.`;
    } else {
      unlocked = progress.done.has(String(last.id));
      why = `Conclua a última aula (“${last.title}”) para liberar a prova.`;
    }
    final.watchPct = watchPct; final.unlocked = unlocked; final.why = unlocked ? '' : why; final.lastLesson = last || null;
  }
  const finalPending = (await ofCourse(course.id)).some((a) => a.kind === 'final' && a.active && a.qcount === 0);
  const needExam = !!final || finalPending;
  const pctOk = progress.total > 0 && progress.count * 100 >= CERT_PCT * progress.total;
  const examOk = !needExam || (!!final && final.passed);
  const missing = Math.max(0, Math.ceil((CERT_PCT * progress.total) / 100) - progress.count);
  // Com certificado válido, o progresso só pode subir: desmarcar aulas fica bloqueado.
  const issued = (await db.q("SELECT 1 FROM certificates WHERE user_id = $1 AND course_id = $2 AND status = 'valid'", [userId, course.id])).rowCount > 0;
  const cert = { needExam, examOk, pctOk, pct: progress.pct, missing, eligible: pctOk && examOk, issued };
  return { cur, flat, progress, modules, final, cert };
}

const lessonLocked = (ov, moduleId) => !!(ov.modules[moduleId] && ov.modules[moduleId].locked);

// ---------- tempo assistido ----------
// O navegador informa quanto tempo de vídeo foi tocado desde o último envio. O servidor limita pelo tempo real decorrido.
async function addWatch(userId, lessonId, delta, duration) {
  delta = Math.max(0, Math.min(Math.floor(Number(delta) || 0), 60));
  duration = Math.max(0, Math.min(Math.floor(Number(duration) || 0), 60 * 60 * 12));
  const ref = Number((await db.q('SELECT duration_min FROM lessons WHERE id = $1', [lessonId])).rows[0]?.duration_min || 0) * 60;
  // A duração não é confiável vinda do navegador: com duração cadastrada, só vale perto dela; sem, exige um piso.
  if (ref > 0) duration = Math.min(Math.max(duration, Math.floor(ref * 0.8)), Math.ceil(ref * 1.25));
  else duration = duration >= 60 ? duration : 0;
  return db.tx(async (c) => {
    const cur = (await c.query('SELECT *, EXTRACT(EPOCH FROM (now() - updated_at)) AS elapsed FROM lesson_watch WHERE user_id = $1 AND lesson_id = $2 FOR UPDATE', [userId, lessonId])).rows[0];
    // Primeira chamada: pouco crédito. Depois, no máximo ~1,25x o tempo real decorrido.
    const elapsed = cur ? Number(cur.elapsed) : 8;
    const allowed = Math.floor(elapsed * 1.25) + 2;
    const add = Math.min(delta, allowed);
    // Uma vez gravada, a duração não diminui (impede forçar um vídeo "curto").
    const dur = Math.max(duration, cur ? cur.duration_seconds : 0);
    const r = (await c.query(`INSERT INTO lesson_watch (user_id, lesson_id, watched_seconds, duration_seconds) VALUES ($1,$2,LEAST($3::int, GREATEST($4::int, $3::int)),$4)
      ON CONFLICT (user_id, lesson_id) DO UPDATE SET watched_seconds = CASE WHEN $4::int > 0 THEN LEAST(lesson_watch.watched_seconds + $3::int, $4::int) ELSE lesson_watch.watched_seconds + $3::int END,
        duration_seconds = $4, updated_at = now() RETURNING watched_seconds`, [userId, lessonId, add, dur])).rows[0];
    const watched = r.watched_seconds;
    return { watched, duration: dur, pct: dur ? Math.floor((watched / dur) * 100) : 0 };
  });
}

// ---------- tentativas ----------
// Abre (ou retoma) uma tentativa. Cada início conta como tentativa usada, para não dar para "sortear" a prova.
async function start(userId, a, ov) {
  const s = a.kind === 'quiz' ? ov.modules[a.module_id] && ov.modules[a.module_id].quiz : ov.final;
  if (!s) throw err('Esta avaliação não está disponível.', 404);
  if (s.passed) throw err('Você já foi aprovado nesta avaliação.');
  if (a.kind === 'quiz' && !ov.modules[a.module_id].quizAvailable) throw err('Conclua todas as aulas do módulo para fazer o quiz.');
  if (a.kind === 'final' && !ov.final.unlocked) throw err(ov.final.why || 'A prova final ainda não está liberada.');
  return db.tx(async (c) => {
    await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const open = (await c.query('SELECT * FROM assessment_attempts WHERE assessment_id = $1 AND user_id = $2 AND finished_at IS NULL', [a.id, userId])).rows[0];
    if (open) return open;
    const used = (await c.query('SELECT count(*)::int n FROM assessment_attempts WHERE assessment_id = $1 AND user_id = $2', [a.id, userId])).rows[0].n;
    const extra = (await c.query('SELECT COALESCE(sum(extra),0)::int n FROM attempt_grants WHERE assessment_id = $1 AND user_id = $2', [a.id, userId])).rows[0].n;
    if (used >= a.max_attempts + extra) throw err('Você usou todas as tentativas. Fale com o suporte para pedir uma tentativa extra.');
    const qs = await questions(a.id);
    const ready = qs.filter((q) => q.options.some((o) => o.correct));
    if (!ready.length) throw err('Esta avaliação ainda não tem questões.', 404);
    const snapshot = shuffle(ready).map((q) => ({
      id: q.id, kind: q.kind, body: q.body, right: String((q.options.find((o) => o.correct) || {}).id), explanation: q.explanation || '',
      options: (q.kind === 'truefalse' ? q.options : shuffle(q.options)).map((o) => ({ id: o.id, body: o.body })),
    }));
    return (await c.query('INSERT INTO assessment_attempts (assessment_id, user_id, number, snapshot, total) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [a.id, userId, used + 1, JSON.stringify(snapshot), snapshot.length])).rows[0];
  });
}

// Corrige a tentativa aberta. Resposta em branco conta como errada.
async function submit(userId, attemptId, answers, assessmentId) {
  return db.tx(async (c) => {
    const at = (await c.query('SELECT t.*, a.pass_score FROM assessment_attempts t JOIN assessments a ON a.id = t.assessment_id WHERE t.id = $1 AND t.user_id = $2 AND t.assessment_id = $3 FOR UPDATE OF t', [attemptId, userId, assessmentId])).rows[0];
    if (!at || at.finished_at) return null;
    const qids = at.snapshot.map((q) => q.id);
    const right = (await c.query('SELECT question_id, id FROM assessment_options WHERE question_id = ANY($1::bigint[]) AND correct', [qids])).rows;
    const rightBy = new Map(right.map((r) => [String(r.question_id), String(r.id)]));
    for (const q of at.snapshot) if (q.right) rightBy.set(String(q.id), q.right);
    const clean = {}; let ok = 0;
    for (const q of at.snapshot) {
      const picked = String((answers || {})[q.id] || '');
      if (!q.options.some((o) => String(o.id) === picked)) continue;
      clean[q.id] = picked;
      if (rightBy.get(String(q.id)) === picked) ok++;
    }
    const score = Math.round((ok / at.total) * 1000) / 100;
    const passed = score >= Number(at.pass_score);
    const row = (await c.query('UPDATE assessment_attempts SET answers = $2, finished_at = now(), correct_count = $3, score = $4, passed = $5 WHERE id = $1 RETURNING *',
      [at.id, JSON.stringify(clean), ok, score, passed])).rows[0];
    return row;
  });
}

// Correção detalhada para a tela de resultado. `reveal` mostra a resposta certa (só nos quizzes).
async function review(attempt, { reveal }) {
  const qids = attempt.snapshot.map((q) => q.id);
  const rows = (await db.q('SELECT q.id, q.explanation, (SELECT o.id FROM assessment_options o WHERE o.question_id = q.id AND o.correct) AS right_id FROM assessment_questions q WHERE q.id = ANY($1::bigint[])', [qids])).rows;
  const by = new Map(rows.map((r) => [String(r.id), r]));
  return attempt.snapshot.map((q) => {
    const info = by.get(String(q.id)) || {};
    const picked = attempt.answers[q.id] ? String(attempt.answers[q.id]) : null;
    const rightId = q.right || String(info.right_id);
    const ok = picked != null && rightId === picked;
    return { ...q, picked, ok, rightId: reveal ? rightId : null, explanation: reveal ? (q.explanation != null ? q.explanation : info.explanation || '') : '' };
  });
}

module.exports = { HALF, CERT_PCT, byId, ofCourse, questions, overview, lessonLocked, addWatch, start, submit, review, attemptStats };
