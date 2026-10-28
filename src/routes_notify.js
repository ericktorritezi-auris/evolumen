'use strict';
// Campainha: lista, abrir um aviso e marcar todos como lidos. Cada pessoa só enxerga os próprios avisos.
const express = require('express');
const notify = require('./notify');

function build(cfg, h) {
  const r = express.Router();
  const guard = [h.needUser, h.gate];
  r.get('/notificacoes.json', ...guard, async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await notify.list(req.user.id));
  });
  r.get('/notificacoes/:id/abrir', ...guard, async (req, res, next) => {
    if (req.get('Sec-Fetch-Site') === 'cross-site') return res.redirect(303, '/');
    const link = await notify.open(req.params.id, req.user.id);
    if (link === null) return next();
    res.redirect(303, /^\/(?![\/\\])/.test(link) ? link : '/');
  });
  r.post('/notificacoes/ler-todas', ...guard, async (req, res) => {
    await notify.markAll(req.user.id);
    if (req.get('X-Requested-With') === 'fetch') return res.json({ ok: true });
    res.redirect(303, '/');
  });
  return r;
}

module.exports = { build };
