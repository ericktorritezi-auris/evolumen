'use strict';
// Cockpit de monitoramento (1.3.0): /painel/<chave>. Sem login, sem menu, só leitura.
// Chave errada ou trocada: 404, igual a qualquer endereço que não existe.
const express = require('express');
const K = require('./cockpit');
const views = require('./views/cockpit');
const log = require('./logger');

function build(cfg) {
  const r = express.Router();
  r.use('/painel/:key', async (req, res, next) => {
    try {
      if (K.tooMany(req.ip)) { res.set('Retry-After', '600'); return res.status(429).type('text/plain').send('Muitas tentativas. Aguarde alguns minutos.'); }
      if (!(await K.check(req.params.key))) { K.miss(req.ip); return next('router'); }
      res.set({ 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer' });
      next();
    } catch (e) { next(e); }
  });
  r.get('/painel/:key', (req, res) => res.send(views.page(cfg)));
  r.get('/painel/:key/dados', async (req, res, next) => {
    try { res.json(await K.payload({ f: String(req.query.f || 'total'), de: req.query.de, ate: req.query.ate }, cfg)); }
    catch (e) { log.error('cockpit_falhou', { error: e.message }); next(e); }
  });
  return r;
}

module.exports = { build };
