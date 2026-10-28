'use strict';
// Limite de downloads dos produtos digitais: pedido do aluno e decisão do administrador.
const express = require('express');
const db = require('./db');
const C = require('./courses');
const dl = require('./downloads');
const { audit } = require('./audit');
const views = require('./views/downloads');

const ID = /^\d{1,12}$/;

function build(cfg, h) {
  const r = express.Router();
  const guard = [h.needUser, h.gate];
  const flashBack = (req, res, type, text, to) => { h.setFlash(res, type, text); res.redirect(303, to); };

  // O arquivo precisa ser de um produto ao qual a pessoa tem acesso vigente.
  async function load(req) {
    if (!ID.test(req.params.id)) return null;
    const row = (await db.q(`SELECT pf.product_id, pf.label, f.id AS file_id, f.filename FROM product_files pf JOIN files f ON f.id = pf.file_id WHERE f.id = $1`, [req.params.id])).rows[0];
    if (!row) return null;
    const access = await C.accessFor(req.user, row.product_id);
    if (!access.ok || req.user.role === 'admin') return null;
    return { file: row, course: await C.byId(row.product_id) };
  }

  r.get('/arquivos/:id/solicitar', ...guard, async (req, res, next) => {
    const x = await load(req); if (!x) return next();
    const st = await dl.one(req.user.id, x.file.file_id);
    if (st.left > 0) return res.redirect(303, `/arquivos/${x.file.file_id}`);
    res.send(views.pedido({ ...h.appCtx(req, res) }, { ...x, st }));
  });
  r.post('/arquivos/:id/solicitar', ...guard, async (req, res, next) => {
    const x = await load(req); if (!x) return next();
    try {
      const id = await dl.request({ user: req.user, fileId: x.file.file_id, courseId: x.course.id, reason: req.body.reason });
      await audit(req, 'download_requested', { entity: 'file', entityId: x.file.file_id, meta: { request: id } });
      flashBack(req, res, 'success', 'Pedido enviado. Você receberá a resposta na campainha.', `/curso/${x.course.slug}`);
    } catch (e) {
      if (!e.expose) throw e;
      const st = await dl.one(req.user.id, x.file.file_id);
      res.status(e.status || 400).send(views.pedido({ ...h.appCtx(req, res) }, { ...x, st, error: e.message, reason: req.body.reason }));
    }
  });

  r.use('/admin/downloads', h.needUser, h.gate, h.needAdmin);
  r.get('/admin/downloads', async (req, res) => {
    res.send(views.admin({ ...h.appCtx(req, res) }, { pending: await dl.pending(), history: await dl.history() }));
  });
  r.post('/admin/downloads/:id/decidir', async (req, res, next) => {
    if (!ID.test(req.params.id)) return next();
    const approve = req.body.decision === 'approve';
    const row = await dl.decide(req.params.id, approve, req.user.id, req.body.response);
    if (!row) return flashBack(req, res, 'info', 'Este pedido já foi decidido.', '/admin/downloads');
    await audit(req, approve ? 'download_approved' : 'download_denied', { entity: 'file', entityId: row.file_id, meta: { request: row.id, user: row.user_id } });
    flashBack(req, res, 'success', approve ? 'Mais um download liberado. O aluno foi avisado na campainha.' : 'Pedido negado. O aluno foi avisado na campainha.', '/admin/downloads');
  });
  return r;
}
module.exports = { build };
