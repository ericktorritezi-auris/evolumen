'use strict';
// Admin: promoções do site (Cupons e promoções > Nova promoção).
const express = require('express');
const db = require('./db');
const P = require('./promotions');
const views = require('./views/promos');
const { audit } = require('./audit');

function build(cfg, h) {
  const r = express.Router();
  r.use('/admin/promocoes', h.needUser, h.gate, h.needAdmin);
  const ctx = (req, res) => h.appCtx(req, res);
  const courses = async () => (await db.q('SELECT id, title, price_cents, status FROM courses ORDER BY sort_order, id')).rows;
  const flashBack = (req, res, type, text, to) => { h.setFlash(res, type, text); res.redirect(303, to); };
  const fromRow = (p) => ({ name: p.name, kind: p.kind, percent: p.percent || '', amount_cents: p.amount_cents, starts_at: P.localInput(p.starts_at), ends_at: P.localInput(p.ends_at), tag_text: p.tag_text || '', banner_text: p.banner_text || '', scope: p.all_products ? 'all' : 'selected', courses: p.courses.map((x) => String(x.id)), theme: p.theme });

  r.get('/admin/promocoes/nova', async (req, res) => res.send(views.form(ctx(req, res), { courses: await courses(), values: { scope: 'all', kind: 'percent' } })));

  r.post('/admin/promocoes', async (req, res) => {
    const { errors, values } = await P.parse(req.body);
    if (Object.keys(errors).length) return res.status(422).send(views.form(ctx(req, res), { courses: await courses(), values: { ...req.body, courses: [].concat(req.body.courses || []).map(String) }, errors }));
    const out = await P.saveChecked(values, req.user.id);
    if (out.clash) return res.status(422).send(views.form(ctx(req, res), { courses: await courses(), values: { ...req.body, courses: [].concat(req.body.courses || []).map(String) }, errors: { starts_at: `Já existe a promoção "${out.clash.name}" ativa nesse período para esses produtos. Ajuste as datas ou os produtos, ou inative a outra.` } }));
    const id = out.id;
    await audit(req, 'promotion_created', { entity: 'promotion', entityId: id, meta: { name: values.name } });
    flashBack(req, res, 'success', 'Promoção criada. Ela começa e termina sozinha nas datas informadas.', `/admin/promocoes/${id}`);
  });

  const load = async (req, next) => { const p = await P.byId(req.params.id); if (!p) { next(); return null; } return p; };

  r.get('/admin/promocoes/:id', async (req, res, next) => {
    const p = await load(req, next); if (!p) return;
    res.send(views.form(ctx(req, res), { courses: await courses(), values: fromRow(p), p }));
  });

  r.post('/admin/promocoes/:id', async (req, res, next) => {
    const p = await load(req, next); if (!p) return;
    if (p.status !== 'active') return flashBack(req, res, 'info', 'Esta promoção está inativa e não pode ser editada. Crie uma nova.', `/admin/promocoes/${p.id}`);
    const { errors, values } = await P.parse(req.body, { id: p.id });
    if (Object.keys(errors).length) return res.status(422).send(views.form(ctx(req, res), { courses: await courses(), values: { ...req.body, courses: [].concat(req.body.courses || []).map(String) }, errors, p }));
    const out = await P.saveChecked(values, req.user.id, p.id);
    if (out.clash) return res.status(422).send(views.form(ctx(req, res), { courses: await courses(), values: { ...req.body, courses: [].concat(req.body.courses || []).map(String) }, errors: { starts_at: `Já existe a promoção "${out.clash.name}" ativa nesse período para esses produtos. Ajuste as datas ou os produtos, ou inative a outra.` }, p }));
    await audit(req, 'promotion_updated', { entity: 'promotion', entityId: p.id, meta: { name: values.name } });
    flashBack(req, res, 'success', 'Promoção atualizada.', `/admin/promocoes/${p.id}`);
  });

  r.post('/admin/promocoes/:id/inativar', async (req, res, next) => {
    const p = await load(req, next); if (!p) return;
    await P.deactivate(p.id);
    await audit(req, 'promotion_deactivated', { entity: 'promotion', entityId: p.id, meta: { name: p.name } });
    flashBack(req, res, 'info', 'Promoção inativada. O site voltou aos preços normais.', `/admin/promocoes/${p.id}`);
  });
  return r;
}
module.exports = { build };
