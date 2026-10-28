'use strict';
// Área do aluno (Fase 3): tempo assistido, quiz do módulo, prova final, certificados e verificação pública.
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const C = require('./courses');
const A = require('./assess');
const certs = require('./certificates');
const { audit } = require('./audit');
const views = require('./views/assess');

const ID = /^\d{1,12}$/;

function build(cfg, h) {
  const r = express.Router();
  const guard = [h.needUser, h.gate];
  const lim = (ms, n, msg) => (cfg.isTest ? (req, res, next) => next() : rateLimit({ windowMs: ms, limit: n, standardHeaders: true, legacyHeaders: false,
    handler: (req, res, next) => { const e = new Error(msg); e.status = 429; e.expose = true; next(e); } }));
  const publicLimit = lim(60 * 1000, 60, 'Muitas consultas. Aguarde um minuto e tente de novo.');
  const watchLimit = lim(60 * 1000, 90, 'Muitos envios. Aguarde um minuto.');
  const denied = () => { const e = new Error('Você não tem acesso a este curso.'); e.status = 403; e.expose = true; return e; };
  const flashTo = (req, res, type, text, to) => { h.setFlash(res, type, text); res.redirect(303, to); };
  const ctx = (req, res) => h.appCtx(req, res);

  async function loadCourse(req) {
    const course = await C.bySlug(req.params.slug, { includeDrafts: true });
    if (!course) return null;
    const access = await C.accessFor(req.user, course.id);
    if (!access.ok) throw denied();
    return course;
  }

  // Tempo assistido: o player do YouTube informa quanto tocou; o servidor soma com limite pelo tempo real.
  r.post('/curso/:slug/aula/:lessonId/assistido', ...guard, watchLimit, async (req, res, next) => {
    const course = await loadCourse(req);
    if (!course || !ID.test(req.params.lessonId)) return next();
    const l = (await db.q(`SELECT l.id, l.module_id FROM lessons l WHERE l.id = $1 AND l.course_id = $2 AND l.youtube_id IS NOT NULL AND ${C.LIVE}`, [req.params.lessonId, course.id])).rows[0];
    if (!l) return next();
    if (req.user.role === 'admin') return res.json({ ok: true, admin: true });
    const ov = await A.overview(req.user.id, course);
    if (A.lessonLocked(ov, l.module_id)) return res.status(403).json({ ok: false });
    const out = await A.addWatch(req.user.id, l.id, req.body.delta, req.body.duration);
    res.json({ ok: true, ...out });
  });

  // ---- quiz e prova ----
  async function loadAssessment(req, res, next) {
    const course = await loadCourse(req);
    if (!course || !ID.test(req.params.id)) { next(); return null; }
    const a = await A.byId(req.params.id);
    if (!a || a.course_id !== course.id) { next(); return null; }
    if (req.user.role === 'admin') { res.redirect(303, `/admin/avaliacoes/${a.id}`); return null; }
    const ov = await A.overview(req.user.id, course);
    const st = a.kind === 'quiz' ? (ov.modules[a.module_id] && ov.modules[a.module_id].quiz) : ov.final;
    if (!st || st.id !== a.id) { next(); return null; }
    return { course, a, ov, st };
  }
  const nextStep = (ov, a, course) => {
    if (a.kind !== 'quiz') return null;
    const i = ov.cur.findIndex((m) => m.id === a.module_id);
    const nm = ov.cur[i + 1];
    if (nm && nm.lessons[0]) return { href: `/curso/${course.slug}/aula/${nm.lessons[0].id}`, label: 'Ir para o próximo módulo' };
    return ov.final ? { href: `/curso/${course.slug}/avaliacao/${ov.final.id}`, label: 'Ir para a prova final' } : null;
  };

  r.get('/curso/:slug/avaliacao/:id', ...guard, async (req, res, next) => {
    const L = await loadAssessment(req, res, next); if (!L) return;
    const { course, a, ov, st } = L;
    const base = { ...ctx(req, res), course, a, st, ov };
    if (a.kind === 'quiz') {
      const mod = ov.modules[a.module_id];
      if (mod.locked) return res.send(views.notReady({ ...base, title: 'Quiz do módulo', message: `Passe no quiz do módulo “${mod.blockedBy.title}” para chegar aqui.` }));
      if (!mod.quizAvailable) return res.send(views.notReady({ ...base, title: 'Quiz do módulo', message: 'Conclua todas as aulas do módulo para fazer o quiz.' }));
    } else if (!st.unlocked) return res.send(views.notReady({ ...base, title: 'Prova final', message: st.why || 'A prova final ainda não está liberada.' }));
    const step = nextStep(ov, a, course);
    if (ID.test(String(req.query.tentativa || ''))) {
      const at = (await db.q('SELECT * FROM assessment_attempts WHERE id = $1 AND user_id = $2 AND assessment_id = $3 AND finished_at IS NOT NULL', [req.query.tentativa, req.user.id, a.id])).rows[0];
      if (!at) return next();
      return res.send(views.quizPage({ ...base, mode: 'review', attempt: at, rev: st.passed ? await A.review(at, { reveal: true }) : [], next: step }));
    }
    if (st.open_id) {
      const at = (await db.q('SELECT * FROM assessment_attempts WHERE id = $1', [st.open_id])).rows[0];
      if (req.query.retomar === '1') return res.send(views.quizPage({ ...base, mode: 'questions', attempt: at }));
    }
    res.send(views.quizPage({ ...base, mode: 'intro', next: st.passed ? step : null }));
  });

  r.post('/curso/:slug/avaliacao/:id/iniciar', ...guard, async (req, res, next) => {
    const L = await loadAssessment(req, res, next); if (!L) return;
    const { course, a, ov } = L;
    try {
      const at = await A.start(req.user.id, a, ov);
      if (!L.st.open_id) await audit(req, 'assessment_started', { entity: 'assessment', entityId: a.id, meta: { attempt: at.number } });
      res.redirect(303, `/curso/${course.slug}/avaliacao/${a.id}?retomar=1`);
    } catch (e) {
      if (e.status === 403 || e.status === 404) return flashTo(req, res, 'error', e.message, `/curso/${course.slug}`);
      throw e;
    }
  });

  r.post('/curso/:slug/avaliacao/:id/enviar', ...guard, async (req, res, next) => {
    const L = await loadAssessment(req, res, next); if (!L) return;
    const { course, a } = L;
    if (!ID.test(String(req.body.attempt || ''))) return next();
    const answers = {};
    for (const [k, v] of Object.entries(req.body)) { const m = /^q_(\d{1,12})$/.exec(k); if (m) answers[m[1]] = String(v); }
    const at = await A.submit(req.user.id, req.body.attempt, answers, a.id);
    if (!at) return flashTo(req, res, 'info', 'Esta tentativa já foi enviada.', `/curso/${course.slug}/avaliacao/${a.id}`);
    await audit(req, 'assessment_submitted', { entity: 'assessment', entityId: a.id, meta: { attempt: at.number, score: Number(at.score), passed: at.passed } });
    if (at.passed) {
      const c = await certs.maybeIssue(req.user.id, course);
      if (c) { await audit(req, 'certificate_issued', { entity: 'certificate', entityId: c.id, meta: { code: c.code, course: course.id } }); h.setFlash(res, 'success', 'Parabéns! Seu certificado foi emitido. Veja em Certificados.'); }
    }
    res.redirect(303, `/curso/${course.slug}/avaliacao/${a.id}?tentativa=${at.id}`);
  });

  // ---- certificados do aluno ----
  r.get('/certificados', ...guard, async (req, res) => {
    const list = (await db.q('SELECT * FROM certificates WHERE user_id = $1 ORDER BY issued_at DESC, id DESC', [req.user.id])).rows;
    const have = new Set(list.map((c) => String(c.course_id)));
    const going = [];
    if (req.user.role === 'student') {
      for (const c of await C.myCourses(req.user.id)) {
        if (c.product_type === 'download' || have.has(String(c.id))) continue; // produto digital não tem certificado
        going.push({ ...c, cert: (await A.overview(req.user.id, c)).cert });
      }
    }
    res.send(views.certificados({ ...ctx(req, res), certs: list, going }));
  });

  r.get('/certificados/:code/pdf', ...guard, async (req, res, next) => {
    const cert = await certs.byCode(req.params.code);
    if (!cert || (cert.user_id !== req.user.id && req.user.role !== 'admin')) return next();
    if (cert.status !== 'valid' && req.user.role !== 'admin') return next();
    const buf = await certs.pdf(cfg, cert);
    await audit(req, 'certificate_downloaded', { entity: 'certificate', entityId: cert.id });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.attachment(`certificado-${cert.code}.pdf`);
    res.send(buf);
  });

  // ---- verificação pública ----
  r.get('/verificar', publicLimit, async (req, res) => {
    const raw = String(req.query.codigo || '').slice(0, 30);
    if (!raw.trim()) return res.send(views.verificar({ cfg, user: req.user }));
    const code = certs.normalize(raw);
    if (certs.CODE_RE.test(code) && await certs.byCode(code)) return res.redirect(302, `/certificado/${code}`);
    res.status(404).send(views.verificar({ cfg, user: req.user, code: raw, notFound: true }));
  });
  r.get('/certificado/:code', publicLimit, async (req, res) => {
    const cert = await certs.byCode(req.params.code);
    if (!cert) return res.status(404).send(views.verificar({ cfg, user: req.user, code: String(req.params.code).slice(0, 30), notFound: true }));
    res.set('Cache-Control', 'no-store');
    res.send(views.verificar({ cfg, user: req.user, cert }));
  });

  return r;
}
module.exports = { build };
