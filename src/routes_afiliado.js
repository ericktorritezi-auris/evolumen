'use strict';
// Painel do afiliado (1.2.0): somente leitura, só os dados do próprio afiliado. Sem rota de escrita.
const express = require('express');
const A = require('./affiliates');
const K = require('./coupons');
const views = require('./views/afiliado');

function build(cfg, h) {
  const r = express.Router();
  // Só conta de aluno marcada como afiliado entra. Administrador e demais contas recebem 404.
  r.use('/afiliado', h.needUser, h.gate, async (req, res, next) => {
    if (req.user.role !== 'student') return next('router');
    const aff = await A.byUser(req.user.id);
    if (!aff) return next('router');
    req.aff = aff; next();
  });

  r.get('/afiliado', async (req, res) => {
    const a = await A.detail(req.aff.id);
    const coupons = await A.panelCoupons(a.id);
    const rows = [];
    for (const k of coupons) { const full = await K.byId(k.id); rows.push({ ...k, label: full ? K.discountLabel(full) : '', link: K.linkFor(cfg, k) }); }
    res.set('Cache-Control', 'private, no-store');
    res.send(views.painel({ ...h.appCtx(req, res) }, { a, coupons: rows, sales: await A.panelSales(a.id), payouts: await A.panelPayouts(a.id) }));
  });

  // Imagem do cupom: só de cupom do próprio afiliado.
  r.get('/afiliado/cupom/:id/imagem.png', async (req, res, next) => {
    const c = await K.byId(req.params.id);
    if (!c || String(c.affiliate_id) !== String(req.aff.id)) return next();
    const png = K.artPng(cfg, c);
    res.set({ 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    if (req.query.baixar) res.attachment(`cupom-${c.code}.png`); else res.set('Content-Disposition', 'inline');
    res.send(png);
  });

  return r;
}

module.exports = { build };
