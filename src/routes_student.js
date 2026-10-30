'use strict';
// Área do aluno: meus cursos, curso, aula, progresso e download de arquivos.
const express = require('express');
const db = require('./db');
const C = require('./courses');
const IG = require('./instagram');
const files = require('./files');
const A = require('./assess');
const certs = require('./certificates');
const { audit } = require('./audit');
const views = require('./views/student');
const Co = require('./community');
const Set_ = require('./settings');
const notify = require('./notify');
const dl = require('./downloads');

function build(cfg, h) {
  const r = express.Router();
  const guard = [h.needUser, h.gate];
  const deny = () => { const e = new Error('Você não tem acesso a este curso.'); e.status = 403; e.expose = true; return e; };

  r.get('/meus-cursos', ...guard, async (req, res) => {
    const courses = await C.myCourses(req.user.id);
    let resume = null;
    for (const c of courses) {
      if (c.product_type === 'download' || c.pct >= 100 || !c.total) continue;
      const cur = await C.curriculum(c.id);
      const prog = await C.progressFor(req.user.id, c.id);
      const nxt = C.flatLessons(cur).find((l) => !l.is_bonus && !prog.done.has(String(l.id)));
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
    const isAdmin = req.user.role === 'admin';
    if (C.typeOf(course) === 'download') {
      require('./help').setPath('/__produto');
      const items = await C.productFiles(course.id);
      const quota = isAdmin ? {} : await dl.statusFor(req.user.id, items.map((i) => i.file_id));
      // a avaliação só abre depois do primeiro download
      const review = !isAdmin && await dl.hasDownloaded(req.user.id, course.id) ? (await Co.reviewOf(req.user.id, course.id)) || {} : null;
      return res.send(views.produtoHome({ ...h.appCtx(req, res), course, items, access, quota, review }));
    }
    const cur = await C.curriculum(course.id, { all: isAdmin });
    const progress = await C.progressFor(req.user.id, course.id);
    const ov = await A.overview(req.user.id, course);
    const open = (l) => isAdmin || !A.lessonLocked(ov, l.module_id);
    const next_ = C.flatLessons(cur).find((l) => open(l) && !l.is_bonus && !progress.done.has(String(l.id))) || C.flatLessons(cur).find((l) => open(l) && !progress.done.has(String(l.id))) || C.flatLessons(cur).find(open);
    const review = !isAdmin && ov && ov.cert && ov.cert.issued ? (await Co.reviewOf(req.user.id, course.id)) || {} : null;
    res.send(views.cursoHome({ ...h.appCtx(req, res), course, cur, progress, next: next_, access, ov, review }));
  });

  r.get('/curso/:slug/aula/:lessonId', ...guard, async (req, res, next) => {
    const { course, access } = await load(req);
    if (!course || C.typeOf(course) === 'download' || !/^\d{1,12}$/.test(req.params.lessonId)) return next();
    const cur = await C.curriculum(course.id, { withVideo: true, withFiles: true, all: req.user.role === 'admin' });
    const flat = C.flatLessons(cur);
    const lesson = flat.find((l) => String(l.id) === req.params.lessonId);
    if (!lesson) return next();
    const progress = await C.progressFor(req.user.id, course.id);
    const ov = await A.overview(req.user.id, course);
    if (req.user.role !== 'admin' && A.lessonLocked(ov, lesson.module_id)) { h.setFlash(res, 'info', `Passe no quiz do módulo “${ov.modules[lesson.module_id].blockedBy.title}” para avançar.`); return res.redirect(303, `/curso/${course.slug}`); }
    if (lesson.instagram_url) res.setHeader('Content-Security-Policy', IG.allowCsp(res.getHeader('Content-Security-Policy')));
    const st = await Set_.all();
    const posts = st.forum_enabled === '1' ? await Co.listLesson(lesson.id, { admin: req.user.role === 'admin' }) : [];
    res.send(views.aula({ ...h.appCtx(req, res), course, cur, lesson, flat, progress, access, ov, forum: { enabled: st.forum_enabled === '1', posts } }));
  });

  r.post('/curso/:slug/aula/:lessonId/concluir', ...guard, async (req, res, next) => {
    const { course } = await load(req);
    if (!course || !/^\d{1,12}$/.test(req.params.lessonId)) return next();
    const l = await db.q(`SELECT l.id, l.module_id FROM lessons l WHERE l.id = $1 AND l.course_id = $2 AND ${C.LIVE}`, [req.params.lessonId, course.id]);
    if (!l.rowCount) return next();
    if (req.user.role !== 'admin' && A.lessonLocked(await A.overview(req.user.id, course), l.rows[0].module_id)) return res.redirect(303, `/curso/${course.slug}`);
    if (req.body.done !== '1' && req.user.role === 'student' && (await A.overview(req.user.id, course)).cert.issued) {
      h.setFlash(res, 'info', 'Você já recebeu o certificado deste curso. O progresso não pode mais diminuir.');
      return res.redirect(303, `/curso/${course.slug}/aula/${l.rows[0].id}`);
    }
    if (req.body.done === '1') await db.q('INSERT INTO lesson_progress (user_id, lesson_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, l.rows[0].id]);
    else await db.q('DELETE FROM lesson_progress WHERE user_id = $1 AND lesson_id = $2', [req.user.id, l.rows[0].id]);
    const flat = C.flatLessons(await C.curriculum(course.id));
    const i = flat.findIndex((x) => x.id === l.rows[0].id);
    const nxt = req.body.done === '1' ? (flat.slice(i + 1).find((x) => !x.is_bonus) || flat[i + 1]) : null;
    let msg = req.body.done === '1' ? 'Aula concluída.' : 'Aula desmarcada.';
    if (req.body.done === '1' && req.user.role === 'student') {
      const pr = (await db.q(`SELECT count(*)::int AS total, count(p.lesson_id)::int AS done FROM lessons l LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.user_id = $2 WHERE l.course_id = $1 AND ${C.COUNTED}`, [course.id, req.user.id])).rows[0];
      if (pr.total >= 2 && pr.done * 2 >= pr.total) await notify.toAdmins({ kind: 'progress', title: req.user.name + ' chegou a 50% do curso', body: course.title, link: '/admin/alunos', key: `p50:${req.user.id}:${course.id}`, subject: req.user.id });
      if (pr.total >= 1 && pr.done >= pr.total) await notify.toAdmins({ kind: 'progress', title: req.user.name + ' assistiu todas as aulas', body: course.title, link: '/admin/alunos', key: `p100:${req.user.id}:${course.id}`, subject: req.user.id });
    }
    if (req.body.done === '1' && req.user.role === 'student') {
      const c = await certs.maybeIssue(req.user.id, course);
      if (c) { await audit(req, 'certificate_issued', { entity: 'certificate', entityId: c.id, meta: { code: c.code, course: course.id } }); msg = 'Parabéns! Seu certificado foi emitido. Veja em Certificados.'; }
    }
    h.setFlash(res, 'success', msg);
    // se a próxima aula está bloqueada por um quiz, leva ao quiz (ou ao curso)
    let dest = `/curso/${course.slug}/aula/${nxt ? nxt.id : l.rows[0].id}`;
    if (nxt && req.user.role !== 'admin') {
      const ov = await A.overview(req.user.id, course);
      if (A.lessonLocked(ov, nxt.module_id)) { const prevMod = ov.modules[l.rows[0].module_id]; dest = prevMod && prevMod.quizAvailable ? `/curso/${course.slug}/avaliacao/${prevMod.quiz.id}` : `/curso/${course.slug}`; }
    }
    res.redirect(303, dest);
  });

  // Download: só quem tem acesso vigente ao curso da aula (ou o administrador).
  r.get('/arquivos/:id', ...guard, async (req, res, next) => {
    if (!/^\d{1,12}$/.test(req.params.id)) return next();
    const link = await db.q(`SELECT l.course_id, (${C.LIVE}) AS live FROM lesson_files lf JOIN lessons l ON l.id = lf.lesson_id WHERE lf.file_id = $1
      UNION ALL SELECT pf.product_id, TRUE FROM product_files pf WHERE pf.file_id = $1`, [req.params.id]);
    if (!link.rowCount || (!link.rows[0].live && req.user.role !== 'admin')) return next();
    const access = await C.accessFor(req.user, link.rows[0].course_id);
    if (!access.ok) throw deny();
    const isProduct = (await db.q('SELECT 1 FROM product_files WHERE file_id = $1', [req.params.id])).rowCount > 0;
    if (req.user.role !== 'admin' && !isProduct) {
      const lm = (await db.q('SELECT l.module_id FROM lesson_files lf JOIN lessons l ON l.id = lf.lesson_id WHERE lf.file_id = $1', [req.params.id])).rows[0];
      const course = await C.byId(link.rows[0].course_id);
      if (lm && A.lessonLocked(await A.overview(req.user.id, course), lm.module_id)) return next();
    }
    const f = await files.get(req.params.id);
    if (!f) return next();
    // Produto digital: cada aluno baixa cada arquivo um número limitado de vezes (o administrador não tem limite).
    const limited = isProduct && req.user.role !== 'admin';
    if (limited) {
      // HEAD não entrega o arquivo e não pode gastar uma das vezes
      if (req.method === 'HEAD') return res.status(405).set('Allow', 'GET').end();
      // reserva atômica: abas ou requisições simultâneas não passam do limite
      if (!(await dl.reserve(req.user.id, f.id))) return res.redirect(303, `/arquivos/${f.id}/solicitar`);
      // download interrompido ou com erro devolve a reserva (não gasta uma das vezes)
      res.on('close', () => { if (!res.writableFinished || res.statusCode !== 200) dl.release(req.user.id, f.id).catch((e) => require('./logger').warn('cota_nao_devolvida', { error: e.message })); });
    }
    await audit(req, 'file_downloaded', { entity: 'file', entityId: f.id, meta: { storage: f.storage } });
    files.serve(res, f, next);
  });

  return r;
}
module.exports = { build };
