'use strict';
// Área do aluno: meus cursos, curso, aula, progresso e download de arquivos.
const express = require('express');
const db = require('./db');
const C = require('./courses');
const files = require('./files');
const { audit } = require('./audit');
const views = require('./views/student');

function build(cfg, h) {
  const r = express.Router();
  const guard = [h.needUser, h.gate];
  const deny = () => { const e = new Error('Você não tem acesso a este curso.'); e.status = 403; e.expose = true; return e; };

  r.get('/meus-cursos', ...guard, async (req, res) => {
    const courses = await C.myCourses(req.user.id);
    let resume = null;
    for (const c of courses) {
      if (c.pct >= 100 || !c.total) continue;
      const cur = await C.curriculum(c.id);
      const prog = await C.progressFor(req.user.id, c.id);
      const nxt = C.flatLessons(cur).find((l) => !prog.done.has(String(l.id)));
      if (nxt) { resume = { course: c, lesson: nxt }; break; }
    }
    res.send(views.meusCursos({ ...h.appCtx(req, res), courses, resume }));
  });

  async function load(req) {
    const course = await C.bySlug(req.params.slug, { includeDrafts: true });
    if (!course) return {};
    const access = await C.accessFor(req.user, course.id);
    if (!access.ok) throw deny();
    return { course, access };
  }

  r.get('/curso/:slug', ...guard, async (req, res, next) => {
    const { course, access } = await load(req);
    if (!course) return next();
    const cur = await C.curriculum(course.id);
    const progress = await C.progressFor(req.user.id, course.id);
    const next_ = C.flatLessons(cur).find((l) => !progress.done.has(String(l.id))) || C.flatLessons(cur)[0];
    res.send(views.cursoHome({ ...h.appCtx(req, res), course, cur, progress, next: next_, access }));
  });

  r.get('/curso/:slug/aula/:lessonId', ...guard, async (req, res, next) => {
    const { course, access } = await load(req);
    if (!course || !/^\d{1,12}$/.test(req.params.lessonId)) return next();
    const cur = await C.curriculum(course.id, { withVideo: true, withFiles: true });
    const flat = C.flatLessons(cur);
    const lesson = flat.find((l) => String(l.id) === req.params.lessonId);
    if (!lesson) return next();
    const progress = await C.progressFor(req.user.id, course.id);
    res.send(views.aula({ ...h.appCtx(req, res), course, cur, lesson, flat, progress, access }));
  });

  r.post('/curso/:slug/aula/:lessonId/concluir', ...guard, async (req, res, next) => {
    const { course } = await load(req);
    if (!course || !/^\d{1,12}$/.test(req.params.lessonId)) return next();
    const l = await db.q('SELECT id FROM lessons WHERE id = $1 AND course_id = $2', [req.params.lessonId, course.id]);
    if (!l.rowCount) return next();
    if (req.body.done === '1') await db.q('INSERT INTO lesson_progress (user_id, lesson_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, l.rows[0].id]);
    else await db.q('DELETE FROM lesson_progress WHERE user_id = $1 AND lesson_id = $2', [req.user.id, l.rows[0].id]);
    const flat = C.flatLessons(await C.curriculum(course.id));
    const i = flat.findIndex((x) => x.id === l.rows[0].id);
    const nxt = req.body.done === '1' ? flat[i + 1] : null;
    h.setFlash(res, 'success', req.body.done === '1' ? 'Aula concluída.' : 'Aula desmarcada.');
    res.redirect(303, `/curso/${course.slug}/aula/${nxt ? nxt.id : l.rows[0].id}`);
  });

  // Download: só quem tem acesso vigente ao curso da aula (ou o administrador).
  r.get('/arquivos/:id', ...guard, async (req, res, next) => {
    if (!/^\d{1,12}$/.test(req.params.id)) return next();
    const link = await db.q('SELECT l.course_id FROM lesson_files lf JOIN lessons l ON l.id = lf.lesson_id WHERE lf.file_id = $1', [req.params.id]);
    if (!link.rowCount) return next();
    const access = await C.accessFor(req.user, link.rows[0].course_id);
    if (!access.ok) throw deny();
    const f = await files.get(req.params.id);
    if (!f) return next();
    await audit(req, 'file_downloaded', { entity: 'file', entityId: f.id });
    res.set({ 'Content-Type': f.mime, 'Content-Length': f.size_bytes, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.attachment(f.filename);
    res.send(f.data);
  });

  return r;
}
module.exports = { build };
