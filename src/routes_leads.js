'use strict';
// Lead Parceiros (1.6.0): funil interno do administrador. Não toca em usuários, afiliados, cupons nem matrículas.
const express = require('express');
const db = require('./db');
const Lead = require('./leads');
const { audit } = require('./audit');
const views = require('./views/leads');

const ID = /^\d{1,12}$/;

function build(cfg, h) {
  const r = express.Router();
  r.use('/admin/lead-parceiros', h.needUser, h.gate, h.needAdmin);
  const ctx = (req, res) => ({ ...h.appCtx(req, res) });
  const back = (req, res, type, text) => { h.setFlash(res, type, text); res.redirect(303, '/admin/lead-parceiros'); };

  r.get('/admin/lead-parceiros', async (req, res) => res.send(views.page(ctx(req, res), await Lead.board())));

  r.post('/admin/lead-parceiros', async (req, res) => {
    const { errors, values } = Lead.parse(req.body);
    const msg = errors.name || errors.tag || errors.month;
    if (msg) return back(req, res, 'error', msg);
    const id = await Lead.create(values, req.user.id);
    await audit(req, 'partner_lead_created', { entity: 'partner_lead', entityId: id, meta: { tag: values.tag } });
    back(req, res, 'success', `${values.name} entrou no funil, em “Início”.`);
  });

  r.post('/admin/lead-parceiros/:id/mover', async (req, res, next) => {
    if (!ID.test(String(req.params.id))) return next();
    const out = await Lead.move(req.params.id, String(req.body.stage || ''), req.user.id);
    if (!out) return Lead.STAGE_IDS.includes(String(req.body.stage || '')) ? next() : back(req, res, 'error', 'Etapa inválida.');
    if (out.changed) await audit(req, 'partner_lead_moved', { entity: 'partner_lead', entityId: req.params.id, meta: { de: out.from, para: out.to } });
    res.redirect(303, '/admin/lead-parceiros');
  });

  r.post('/admin/lead-parceiros/:id/editar', async (req, res, next) => {
    if (!ID.test(String(req.params.id))) return next();
    const { errors, values } = Lead.parse(req.body);
    const msg = errors.name || errors.tag || errors.month;
    if (msg) return back(req, res, 'error', msg);
    if (!await Lead.update(req.params.id, values)) return next();
    await audit(req, 'partner_lead_updated', { entity: 'partner_lead', entityId: req.params.id });
    back(req, res, 'success', 'Lead atualizado.');
  });

  return r;
}

module.exports = { build };
