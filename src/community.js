'use strict';
// Fórum por aula e avaliação do curso (estrelas e NPS).
const db = require('./db');

const MIN = 2; const MAX = 2000;
const clean = (s) => String(s || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\n{3,}/g, '\n\n').trim();

// Pergunta e respostas de uma aula. O aluno só vê o que está visível; o administrador vê tudo.
async function listLesson(lessonId, { admin = false } = {}) {
  const rows = (await db.q(`SELECT p.*, u.name AS author FROM forum_posts p JOIN users u ON u.id = p.user_id
    WHERE p.lesson_id = $1 ${admin ? '' : "AND p.status = 'visible'"} ORDER BY p.created_at, p.id`, [lessonId])).rows;
  const tops = rows.filter((x) => !x.parent_id).map((x) => ({ ...x, replies: [] }));
  const byId = Object.fromEntries(tops.map((t) => [String(t.id), t]));
  for (const x of rows) if (x.parent_id && byId[String(x.parent_id)]) byId[String(x.parent_id)].replies.push(x);
  return tops.reverse(); // perguntas mais novas primeiro; respostas em ordem de conversa
}

async function create({ user, course, lesson, body, parentId }) {
  const text = clean(body);
  if (text.length < MIN) throw Object.assign(new Error('Escreva pelo menos algumas palavras.'), { expose: true, status: 400 });
  if (text.length > MAX) throw Object.assign(new Error(`O texto pode ter até ${MAX} caracteres.`), { expose: true, status: 400 });
  const dup = await db.q("SELECT 1 FROM forum_posts WHERE user_id = $1 AND lesson_id = $2 AND body = $3 AND created_at > now() - interval '30 seconds'", [user.id, lesson.id, text]);
  if (dup.rowCount) throw Object.assign(new Error('Esta mensagem acabou de ser publicada.'), { expose: true, status: 409 });
  let parent = null;
  if (parentId) {
    if (!/^\d{1,12}$/.test(String(parentId))) throw Object.assign(new Error('Pergunta não encontrada.'), { expose: true, status: 404 });
    parent = (await db.q("SELECT * FROM forum_posts WHERE id = $1 AND lesson_id = $2 AND parent_id IS NULL AND status = 'visible'", [parentId, lesson.id])).rows[0];
    if (!parent) throw Object.assign(new Error('Pergunta não encontrada.'), { expose: true, status: 404 });
  }
  const r = await db.q('INSERT INTO forum_posts (course_id, lesson_id, user_id, parent_id, by_admin, body) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [course.id, lesson.id, user.id, parent ? parent.id : null, user.role === 'admin', text]);
  return { post: r.rows[0], parent };
}

async function setHidden(id, hidden) {
  if (!/^\d{1,12}$/.test(String(id))) return null;
  const r = await db.q(`UPDATE forum_posts SET status = $2, hidden_at = ${hidden ? 'COALESCE(hidden_at, now())' : 'NULL'} WHERE id = $1 RETURNING *`, [id, hidden ? 'hidden' : 'visible']);
  return r.rows[0] || null;
}

// O aluno só apaga o que escreveu e que ainda não tem respostas de outras pessoas.
async function removeOwn(id, userId) {
  if (!/^\d{1,12}$/.test(String(id))) return false;
  try {
    const r = await db.q(`DELETE FROM forum_posts p WHERE p.id = $1 AND p.user_id = $2 AND p.by_admin = false
      AND NOT EXISTS (SELECT 1 FROM forum_posts c WHERE c.parent_id = p.id)`, [id, userId]);
    return r.rowCount > 0;
  } catch (e) { if (e.code === '23503') return false; throw e; } // chegou uma resposta no meio do caminho
}

// Fila do administrador: perguntas de alunos, com a situação (sem resposta, respondida, oculta).
async function queue({ filter = 'open', courseId = null, limit = 100 } = {}) {
  const w = ["p.parent_id IS NULL", 'p.by_admin = false'];
  const p = [];
  if (courseId) { p.push(courseId); w.push(`p.course_id = $${p.length}`); }
  if (filter === 'open') w.push("p.status = 'visible' AND NOT EXISTS (SELECT 1 FROM forum_posts a WHERE a.parent_id = p.id AND a.by_admin AND a.status = 'visible')");
  else if (filter === 'hidden') w.push("p.status = 'hidden'");
  p.push(limit);
  return (await db.q(`SELECT p.id, p.body, p.status, p.created_at, p.lesson_id, u.name AS author, c.title AS course_title, c.slug, l.title AS lesson_title,
      (SELECT count(*)::int FROM forum_posts a WHERE a.parent_id = p.id AND a.by_admin AND a.status = 'visible') AS answers
    FROM forum_posts p JOIN users u ON u.id = p.user_id JOIN courses c ON c.id = p.course_id JOIN lessons l ON l.id = p.lesson_id
    WHERE ${w.join(' AND ')} ORDER BY ${filter === 'open' ? 'p.created_at ASC' : 'p.created_at DESC'} LIMIT $${p.length}`, p)).rows;
}

async function openCount() {
  return (await db.q("SELECT count(*)::int AS n FROM forum_posts p WHERE p.parent_id IS NULL AND p.by_admin = false AND p.status = 'visible' AND NOT EXISTS (SELECT 1 FROM forum_posts a WHERE a.parent_id = p.id AND a.by_admin AND a.status = 'visible')")).rows[0].n;
}

// ---- avaliação do curso ----
const reviewOf = async (userId, courseId) => (await db.q('SELECT * FROM course_reviews WHERE user_id = $1 AND course_id = $2', [userId, courseId])).rows[0] || null;

async function saveReview({ userId, courseId, stars, nps, comment }) {
  const s = Number(stars); const n = Number(nps); const c = clean(comment).slice(0, 1000);
  if (!Number.isInteger(s) || s < 1 || s > 5) throw Object.assign(new Error('Escolha de 1 a 5 estrelas.'), { expose: true, status: 400 });
  if (!/^\d{1,2}$/.test(String(nps)) || n < 0 || n > 10) throw Object.assign(new Error('Escolha uma nota de 0 a 10 para a pergunta de indicação.'), { expose: true, status: 400 });
  await db.q(`INSERT INTO course_reviews (course_id, user_id, stars, nps, comment) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (user_id, course_id) DO UPDATE SET stars = EXCLUDED.stars, nps = EXCLUDED.nps, comment = EXCLUDED.comment, updated_at = now()`, [courseId, userId, s, n, c]);
}

// Resumo por curso: média de estrelas e NPS (% promotores 9–10 menos % detratores 0–6).
async function reviewSummary() {
  return (await db.q(`SELECT c.id, c.title, count(r.id)::int AS n, round(avg(r.stars)::numeric, 2)::float AS stars,
      CASE WHEN count(r.id) = 0 THEN NULL ELSE round(100.0 * (count(*) FILTER (WHERE r.nps >= 9) - count(*) FILTER (WHERE r.nps <= 6)) / count(r.id))::int END AS nps
    FROM courses c LEFT JOIN course_reviews r ON r.course_id = c.id GROUP BY c.id, c.title HAVING count(r.id) > 0 ORDER BY c.title`)).rows;
}
const latestReviews = async (limit = 30) => (await db.q(`SELECT r.*, u.name AS author, c.title AS course_title FROM course_reviews r JOIN users u ON u.id = r.user_id JOIN courses c ON c.id = r.course_id
  WHERE r.comment <> '' ORDER BY r.updated_at DESC LIMIT $1`, [limit])).rows;

module.exports = { clean, listLesson, create, setHidden, removeOwn, queue, openCount, reviewOf, saveReview, reviewSummary, latestReviews, MAX };
