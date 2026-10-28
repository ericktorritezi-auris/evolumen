'use strict';
// Fórum por aula, avaliação do curso e a fila do administrador.
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const C = require('./courses');
const A = require('./assess');
const Co = require('./community');
const Set_ = require('./settings');
const mailer = require('./mailer');
const emails = require('./emails');
const notify = require('./notify');
const { audit } = require('./audit');
const views = require('./views/community');

const ID = /^\d{1,12}$/;

function build(cfg, h) {
  const r = express.Router();
  const guard = [h.needUser, h.gate];
  const limit = cfg.isTest ? (req, res, next) => next() : rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (req, res, next) => { const e = new Error('Muitas mensagens em pouco tempo. Aguarde alguns minutos.'); e.status = 429; e.expose = true; next(e); } });
  const flashBack = (req, res, type, text, to) => { h.setFlash(res, type, text); res.redirect(303, to); };
  const safeBack = (b, fallback) => (/^\/[A-Za-z0-9/_#-]*$/.test(String(b || '')) ? String(b) : fallback);

  async function loadLesson(req) {
    const course = await C.bySlug(req.params.slug, { includeDrafts: true });
    if (!course || !ID.test(String(req.params.lessonId))) return {};
    const access = await C.accessFor(req.user, course.id);
    if (!access.ok) throw Object.assign(new Error('Você não tem acesso a este curso.'), { status: 403, expose: true });
    const admin = req.user.role === 'admin';
    const lesson = (await db.q(`SELECT l.id, l.title, l.module_id FROM lessons l WHERE l.id = $1 AND l.course_id = $2 ${admin ? '' : 'AND ' + C.LIVE}`, [req.params.lessonId, course.id])).rows[0];
    // Mesma regra da leitura: aula travada por quiz não aceita nem escrita.
    if (lesson && !admin && A.lessonLocked(await A.overview(req.user.id, course), lesson.module_id)) return {};
    return { course, lesson };
  }

  r.post('/curso/:slug/aula/:lessonId/forum', ...guard, limit, async (req, res, next) => {
    const { course, lesson } = await loadLesson(req);
    if (!course || !lesson) return next();
    const back = `/curso/${course.slug}/aula/${lesson.id}`;
    const st = await Set_.all();
    if (st.forum_enabled !== '1') return flashBack(req, res, 'info', 'O fórum está desativado no momento.', back);
    try {
      const { post, parent } = await Co.create({ user: req.user, course, lesson, body: req.body.body, parentId: req.body.parent || null });
      await audit(req, 'forum_post', { entity: 'forum_post', entityId: post.id, meta: { course: course.id, lesson: lesson.id, reply: !!parent } });
      const postLink = `${back}#post-${post.id}`;
      if (req.user.role === 'student' && !parent) await notify.toAdmins({ kind: 'forum', title: req.user.name + ' fez uma pergunta', body: lesson.title, link: postLink, key: 'forum:' + post.id, subject: req.user.id });
      if (req.user.role === 'admin' && parent) {
        await notify.resolveAdmins('forum:' + parent.id);
        if (parent.user_id !== req.user.id) await notify.add(parent.user_id, { kind: 'forumans', title: 'O professor respondeu sua dúvida', body: lesson.title, link: postLink, key: 'forumans:' + post.id });
      }
      if (req.user.role === 'student' && !parent && st.notify_questions === '1') {
        const admins = (await db.q("SELECT email FROM users WHERE role = 'admin' AND status = 'active'")).rows;
        for (const a of admins) h.background(mailer.send(cfg, { to: a.email, ...emails.forumQuestion(cfg, { student: req.user, course, lesson, body: post.body, postId: post.id }) }));
      }
      if (req.user.role === 'admin' && parent && parent.user_id !== req.user.id) {
        const u = (await db.q('SELECT name, email FROM users WHERE id = $1 AND status = \'active\'', [parent.user_id])).rows[0];
        if (u) h.background(mailer.send(cfg, { to: u.email, ...emails.forumAnswer(cfg, { name: u.name, course, lesson, body: post.body, postId: post.id }) }));
      }
      return flashBack(req, res, 'success', parent ? 'Resposta publicada.' : 'Mensagem publicada.', `${back}#post-${post.id}`);
    } catch (e) { if (e.expose) return flashBack(req, res, 'error', e.message, `${back}#forum`); throw e; }
  });

  r.post('/curso/:slug/aula/:lessonId/forum/:id/excluir', ...guard, async (req, res, next) => {
    const { course, lesson } = await loadLesson(req);
    if (!course || !lesson) return next();
    const ok = await Co.removeOwn(req.params.id, req.user.id);
    if (ok) { await audit(req, 'forum_post_deleted', { entity: 'forum_post', entityId: req.params.id }); await notify.resolveAdmins('forum:' + req.params.id); }
    flashBack(req, res, ok ? 'success' : 'error', ok ? 'Mensagem apagada.' : 'Não foi possível apagar: a mensagem já tem respostas ou não é sua.', `/curso/${course.slug}/aula/${lesson.id}#forum`);
  });

  // Avaliação do curso: só quem recebeu o certificado.
  r.post('/curso/:slug/avaliar', ...guard, limit, async (req, res, next) => {
    const course = await C.bySlug(req.params.slug, { includeDrafts: true });
    if (!course) return next();
    const back = `/curso/${course.slug}#avaliacao`;
    if (req.user.role !== 'student') return flashBack(req, res, 'info', 'A avaliação é feita pelos alunos.', back);
    const access = await C.accessFor(req.user, course.id);
    if (!access.ok) throw Object.assign(new Error('Você não tem acesso a este curso.'), { status: 403, expose: true });
    const ov = await A.overview(req.user.id, course);
    if (!(ov && ov.cert && ov.cert.issued)) return flashBack(req, res, 'info', 'A avaliação abre quando você concluir o curso e receber o certificado.', `/curso/${course.slug}`);
    try {
      await Co.saveReview({ userId: req.user.id, courseId: course.id, stars: req.body.stars, nps: req.body.nps, comment: req.body.comment });
      await audit(req, 'course_reviewed', { entity: 'course', entityId: course.id });
      await notify.toAdmins({ kind: 'review', title: req.user.name + ' avaliou o curso', body: `${course.title} — ${Number(req.body.stars) || ''} estrelas`, link: '/admin/forum', key: `review:${req.user.id}:${course.id}`, subject: req.user.id });
      flashBack(req, res, 'success', 'Obrigado pela sua avaliação!', back);
    } catch (e) { if (e.expose) return flashBack(req, res, 'error', e.message, back); throw e; }
  });

  // ---- administrador ----
  r.use('/admin/forum', h.needUser, h.gate, h.needAdmin);
  r.get('/admin/forum', async (req, res) => {
    const filter = ['open', 'all', 'hidden'].includes(req.query.f) ? req.query.f : 'open';
    const curso = ID.test(String(req.query.curso || '')) ? String(req.query.curso) : '';
    const [rows, courses, reviews, comments, openN] = await Promise.all([
      Co.queue({ filter, courseId: curso || null }), db.q('SELECT id, title FROM courses ORDER BY title').then((x) => x.rows), Co.reviewSummary(), Co.latestReviews(), Co.openCount()]);
    res.send(views.adminForum({ ...h.appCtx(req, res) }, { rows, filter, courses, curso, reviews, comments, openN }));
  });
  for (const [path, hidden] of [['ocultar', true], ['mostrar', false]]) {
    r.post(`/admin/forum/:id/${path}`, async (req, res, next) => {
      const p = await Co.setHidden(req.params.id, hidden); if (!p) return next();
      if (hidden) await notify.resolveAdmins('forum:' + p.id);
      if (hidden && p.by_admin && p.parent_id) await db.q("UPDATE notifications SET read_at = NULL WHERE ref_key = $1 AND user_id IN (SELECT id FROM users WHERE role = 'admin')", ['forum:' + p.parent_id]);
      await audit(req, hidden ? 'forum_post_hidden' : 'forum_post_shown', { entity: 'forum_post', entityId: p.id });
      flashBack(req, res, 'success', hidden ? 'Mensagem ocultada. Os alunos não a veem mais.' : 'Mensagem visível de novo.', safeBack(req.body.back, '/admin/forum'));
    });
  }
  return r;
}

module.exports = { build };
