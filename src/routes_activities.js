'use strict';
// Atividade complementar (2.3.0): envio do aluno e avaliação, dispensa e reabertura pelo professor.
const express = require('express');
const db = require('./db');
const C = require('./courses');
const Act = require('./activities');
const { audit } = require('./audit');
const views = require('./views/activities');

function build(cfg, h) {
  const r = express.Router();
  const guard = [h.needUser, h.gate];
  const admin = [h.needUser, h.gate, h.needAdmin];
  const ctx = (req, res) => h.appCtx(req, res);
  const flashBack = (req, res, type, text, to) => { h.setFlash(res, type, text); res.redirect(303, to); };
  const courseOr404 = async (req, next) => { const c = await C.byId(req.params.id); if (!c) { next(); return null; } return c; };

  // ---------- aluno ----------
  r.post('/curso/:slug/aula/:lessonId/atividade', ...guard, async (req, res, next) => {
    if (req.user.role !== 'student') return flashBack(req, res, 'info', 'O envio da atividade é feito pelos alunos.', `/curso/${req.params.slug}`);
    const course = await C.bySlug(req.params.slug, { includeDrafts: true });
    if (!course || C.typeOf(course) === 'download') return next();
    const access = await C.accessFor(req.user, course.id);
    if (!access.ok) { const e = new Error('Você não tem acesso a este curso.'); e.status = 403; e.expose = true; throw e; }
    const lesson = await Act.lessonOf(course.id, req.params.lessonId);
    if (!lesson) return next();
    const A = require('./assess');
    const ov = await A.overview(req.user.id, course);
    if (A.lessonLocked(ov, lesson.module_id, lesson.id)) return flashBack(req, res, 'info', 'Conclua as aulas anteriores para chegar a esta atividade.', `/curso/${course.slug}`);
    const out = await Act.submit(req.user, course, lesson, req.body);
    if (out.error) return h.renderAula(req, res, next, { error: out.error, errors: out.errors || {}, values: out.links && out.links.length ? out.links : null });
    await audit(req, 'activity_submitted', { entity: 'activity', entityId: out.sub.id, meta: { lesson: lesson.id, course: course.id, links: out.sub.links.length } });
    flashBack(req, res, 'success', 'Atividade enviada! O professor vai avaliar e você receberá um e-mail quando houver resposta.', `/curso/${course.slug}/aula/${lesson.id}#atividade`);
  });

  // ---------- professor ----------
  // 25 por vez; "Carregar mais 25" aumenta o parâmetro mostrar.
  const shown = (req) => { const n = Math.floor(Number(req.query.mostrar)); return Number.isFinite(n) && n > 25 ? Math.min(Math.ceil(n / 25) * 25, 5000) : 25; };
  r.get('/admin/atividades', ...admin, async (req, res) => {
    const filter = req.query.filtro === 'pendentes' ? 'pendentes' : 'todas';
    const n = shown(req);
    const rows = await Act.list({ pendingOnly: filter === 'pendentes', limit: n });
    res.send(views.adminList(ctx(req, res), { rows, filter, pending: await Act.pendingCount(), shown: n }));
  });

  r.get('/admin/cursos/:id/atividades', ...admin, async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    if (C.typeOf(course) === 'download') return next();
    res.send(views.courseTab(ctx(req, res), { course, data: await Act.studentsOf(course), rows: await Act.list({ courseId: course.id, limit: shown(req) }), shown: shown(req) }));
  });

  r.get('/admin/atividades/:subId', ...admin, async (req, res, next) => {
    const sub = await Act.detail(req.params.subId); if (!sub) return next();
    res.send(views.evalPage(ctx(req, res), { sub }));
  });

  r.post('/admin/atividades/:subId/avaliar', ...admin, async (req, res, next) => {
    const sub = await Act.detail(req.params.subId); if (!sub) return next();
    if (sub.status !== 'pending') return flashBack(req, res, 'info', 'Este envio já foi avaliado.', `/admin/atividades/${sub.id}`);
    const out = await Act.evaluate(cfg, h, sub, req.user, req.body);
    if (out.error) return res.status(422).send(views.evalPage(ctx(req, res), { sub, error: out.error, values: { decision: req.body.decision, grade: req.body.grade, summary: req.body.summary } }));
    await audit(req, 'activity_evaluated', { entity: 'activity', entityId: sub.id, meta: { decision: out.row.status, grade: out.row.grade, user: sub.user_id, lesson: sub.lesson_id } });
    const left = await Act.pendingCount();
    const next_ = left ? ' Há outras atividades aguardando.' : '';
    const T = { approved: 'Atividade aprovada. As próximas aulas foram liberadas para o aluno.', adjust: 'Pedido de ajustes enviado ao aluno.', rejected: 'Atividade marcada como não aprovada. O aluno ficará bloqueado até você reabrir.' };
    flashBack(req, res, 'success', `${T[out.row.status]} O aluno foi avisado por e-mail e pela campainha.${next_}`, left ? '/admin/atividades?filtro=pendentes' : `/admin/atividades/${sub.id}`);
  });

  r.post('/admin/atividades/:subId/reabrir', ...admin, async (req, res, next) => {
    const sub = await Act.detail(req.params.subId); if (!sub) return next();
    const out = await Act.reopen(cfg, h, req.user, sub);
    if (out.error) return flashBack(req, res, 'error', out.error, `/admin/atividades/${sub.id}`);
    await audit(req, 'activity_reopened', { entity: 'activity', entityId: sub.id, meta: { user: sub.user_id, lesson: sub.lesson_id } });
    flashBack(req, res, 'success', 'Atividade reaberta. O aluno foi avisado e pode enviar de novo.', `/admin/atividades/${sub.id}`);
  });

  r.post('/admin/cursos/:id/atividades/dispensar', ...admin, async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const back = `/admin/cursos/${course.id}/atividades`;
    const out = await Act.waive(cfg, h, req.user, course, req.body.lesson_id, req.body.user_id, req.body.reason);
    if (out.error) return flashBack(req, res, 'error', out.error, back);
    await audit(req, 'activity_waived', { entity: 'activity', entityId: out.lesson.id, meta: { user: out.user.id, course: course.id } });
    flashBack(req, res, 'success', `Atividade dispensada para ${out.user.name}. As próximas aulas foram liberadas e o aluno foi avisado.`, back);
  });

  return r;
}

module.exports = { build };
