'use strict';
// Páginas públicas: landing, página do curso, capas e textos legais.
const express = require('express');
const db = require('./db');
const C = require('./courses');
const files = require('./files');
const pub = require('./views/public');

function build(cfg, h) {
  const r = express.Router();

  r.get('/', async (req, res) => {
    const courses = await C.listPublic();
    res.send(pub.landing({ cfg, user: req.user, courses }));
  });

  r.get('/cursos/:slug', async (req, res, next) => {
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
    res.send(pub.coursePage({ cfg, user: req.user, course, cur, state, preview: !visible }));
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
