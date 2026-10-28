'use strict';
// Páginas públicas: landing, página do curso, capas e textos legais.
const express = require('express');
const db = require('./db');
const C = require('./courses');
const files = require('./files');
const pub = require('./views/public');
const K = require('./coupons');
const Co = require('./community');
const rateLimit = require('express-rate-limit');

function build(cfg, h) {
  const r = express.Router();
  const limit = rateLimit({ windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false,
    handler: (req, res, next) => { const e = new Error('Muitas consultas de cupom. Aguarde um minuto.'); e.status = 429; e.expose = true; next(e); } });
  const whenCoupon = (req, res, next) => (req.query.cupom ? limit(req, res, next) : next());

  r.get('/', whenCoupon, async (req, res) => {
    const courses = await C.listPublic();
    const ratings = await Co.ratingFor(courses.map((c) => c.id));
    for (const c of courses) c.rating = ratings[c.id] || null;
    const code = String(req.query.cupom || '').slice(0, 30);
    const coupon = code ? await K.publicView(code) : null;
    res.send(pub.landing({ cfg, user: req.user, courses, coupon }));
  });

  // Endereço do QR Code e do e-mail: leva ao curso (ou à vitrine) com o cupom guardado.
  r.get('/cupom/:code', limit, async (req, res) => {
    const c = await K.byCode(req.params.code);
    if (!c || K.stateOf(c, c.uses) !== 'active') return res.redirect(302, '/?cupom=invalido#cursos');
    const visible = (await db.q(`SELECT c.slug FROM courses c JOIN coupon_courses cc ON cc.course_id = c.id WHERE cc.coupon_id = $1 AND (${C.VISIBLE}) ORDER BY c.sort_order, c.id`, [c.id])).rows;
    if (!visible.length) return res.redirect(302, '/?cupom=invalido#cursos');
    if (visible.length === 1) return res.redirect(302, `/cursos/${visible[0].slug}?cupom=${encodeURIComponent(c.code)}`);
    res.redirect(302, `/?cupom=${encodeURIComponent(c.code)}#cursos`);
  });

  r.get('/cursos/:slug', whenCoupon, async (req, res, next) => {
    const isAdmin = req.user && req.user.role === 'admin';
    const course = await C.bySlug(req.params.slug, { includeDrafts: isAdmin });
    if (!course) return next();
    const visible = course.status === 'published' && course.published_at && new Date(course.published_at) <= new Date();
    const cur = await C.curriculum(course.id, { withFiles: true });
    let state = 'none';
    if (req.user) {
      const access = await C.accessFor(req.user, course.id);
      if (access.ok) state = 'enrolled';
      else if (req.user.role === 'student') { const e = await C.enrollmentState(req.user.id, course.id); if (e && e.expired) state = 'expired'; }
    }
    const code = String(req.query.cupom || '').slice(0, 30);
    const coupon = code ? await K.publicView(code, course) : null;
    const buy = { open: !!cfg.paymentsEnabled && course.price_cents > 0 && !isAdmin && visible, renew: false };
    if (buy.open && state === 'enrolled' && req.user) buy.renew = (await require('./sales').buyState(req.user.id, course)).state === 'renew';
    const items = C.typeOf(course) === 'download' ? await C.productFiles(course.id) : [];
    const rating = (await Co.ratingFor([course.id]))[course.id] || null;
    const testimonials = await Co.testimonials(course.id);
    res.send(pub.coursePage({ cfg, user: req.user, course, cur, state, preview: !visible, coupon, buy, items, rating, testimonials }));
  });

  // Capa: pública para curso publicado; rascunho só para o administrador.
  r.get('/capas/:id', async (req, res, next) => {
    if (!/^\d{1,12}$/.test(req.params.id)) return next();
    const ok = await db.q(`SELECT 1 FROM courses c WHERE c.cover_file_id = $1 AND (${C.VISIBLE})`, [req.params.id]);
    if (!ok.rowCount && !(req.user && req.user.role === 'admin')) return next();
    const f = await files.get(req.params.id);
    if (!f || f.kind !== 'cover') return next();
    res.set({ 'Content-Type': f.mime, 'Content-Length': f.size_bytes, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': ok.rowCount ? 'public, max-age=300' : 'private, no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
    res.send(f.data);
  });

  const legal = (type, title) => async (req, res) => {
    const doc = (await db.q("SELECT * FROM legal_documents WHERE doc_type = $1 AND status = 'published' ORDER BY published_at DESC, id DESC LIMIT 1", [type])).rows[0];
    res.send(pub.legalPage({ cfg, user: req.user, doc, title }));
  };
  r.get('/termos', legal('terms', 'Termos de uso'));
  r.get('/privacidade', legal('privacy', 'Política de privacidade'));
  return r;
}
module.exports = { build };
