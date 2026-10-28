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
    const product = C.typeOf(course) === 'download';
    if (product) {
      if (!(await require('./downloads').hasDownloaded(req.user.id, course.id))) return flashBack(req, res, 'info', 'A avaliação abre depois que você baixar o primeiro arquivo.', `/curso/${course.slug}`);
    } else {
      const ov = await A.overview(req.user.id, course);
      if (!(ov && ov.cert && ov.cert.issued)) return flashBack(req, res, 'info', 'A avaliação abre quando você concluir o curso e receber o certificado.', `/curso/${course.slug}`);
    }
    try {
      await Co.saveReview({ userId: req.user.id, courseId: course.id, stars: req.body.stars, nps: req.body.nps, comment: req.body.comment, consent: req.body.consent === '1' });
      await audit(req, 'course_reviewed', { entity: 'course', entityId: course.id, meta: { consent_publish: req.body.consent === '1' && !!String(req.body.comment || '').trim() } });
      await notify.toAdmins({ kind: 'review', title: req.user.name + (product ? ' avaliou o produto' : ' avaliou o curso'), body: `${course.title} — ${Number(req.body.stars) || ''} estrelas`, link: '/admin/forum', key: `review:${req.user.id}:${course.id}`, subject: req.user.id });
      const txt = String(req.body.comment || '').trim();
      if (req.body.consent === '1' && txt) await notify.toAdmins({ kind: 'review', title: req.user.name + ' autorizou publicar o depoimento', body: course.title, link: '/admin/forum#depoimentos', key: `reviewc:${req.user.id}:${course.id}:${require('crypto').createHash('md5').update(txt).digest('hex').slice(0, 10)}`, subject: req.user.id });
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
  // Depoimentos: o administrador escolhe o que vai a público (só com o aceite do aluno).
  for (const [path, on] of [['publicar', true], ['despublicar', false]]) {
    r.post(`/admin/forum/avaliacao/:id/${path}`, async (req, res, next) => {
      if (!ID.test(req.params.id)) return next();
      const rv = await Co.setPublished(req.params.id, on, req.body.ver);
      if (!rv) return flashBack(req, res, 'error', on ? 'Não foi possível publicar: o aluno não deu o aceite, não escreveu texto ou alterou o texto depois que você abriu a lista. Revise e tente de novo.' : 'Avaliação não encontrada.', '/admin/forum#depoimentos');
      await audit(req, on ? 'testimonial_published' : 'testimonial_unpublished', { entity: 'course', entityId: rv.course_id, meta: { review: rv.id } });
      if (on) {
        const c = await C.byId(rv.course_id);
        await notify.add(rv.user_id, { kind: 'testi', title: 'Seu depoimento foi publicado', body: `${c ? c.title + ' — ' : ''}aparece com seu primeiro nome e a inicial do sobrenome.`.slice(0, 230), link: c ? '/curso/' + c.slug : '', key: 'testi:' + rv.id });
      }
      flashBack(req, res, 'success', on ? 'Depoimento publicado na página pública. O aluno foi avisado na campainha.' : 'Depoimento retirado da página pública.', '/admin/forum#depoimentos');
    });
  }
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
