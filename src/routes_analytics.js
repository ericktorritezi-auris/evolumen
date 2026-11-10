'use strict';
// EvoLumen Analytics (2.0.0): coleta de visitas e página de verificação (administrador).
const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const A = require('./analytics');
const db = require('./db');
const log = require('./logger');

// Coleta pública: montada ANTES da sessão e do CSRF, porque a landing (outro endereço) não tem token.
// Só aceita avisos vindos do próprio site e das landings autorizadas (ANALYTICS_ORIGINS).
function mount(cfg) {
  const r = express.Router();
  const own = new URL(cfg.baseUrl).origin.toLowerCase();
  const allowed = new Set([own, ...cfg.analytics.origins]);
  const siteOf = (origin) => (origin === own ? 'plataforma' : 'landing');
  const limit = cfg.isTest ? (req, res, next) => next() : rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, handler: (req, res) => res.status(429).end() });
  const cors = (req, res) => {
    const o = String(req.get('origin') || '').toLowerCase();
    if (!allowed.has(o)) return null;
    res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' });
    return o;
  };
  r.options('/ea/c', (req, res) => { cors(req, res); res.status(204).end(); });
  r.post('/ea/c', limit, express.text({ type: () => true, limit: '4kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!cfg.analytics.enabled) return res.status(204).end();
    if (req.get('dnt') === '1' || req.get('sec-gpc') === '1') return res.status(204).end(); // pessoa pediu para não ser medida
    const origin = cors(req, res);
    if (!origin) return res.status(403).end();
    try {
      let b = {}; try { const j = JSON.parse(typeof req.body === 'string' ? req.body : '{}'); if (j && typeof j === 'object') b = j; } catch { /* corpo inválido */ }
      if (b.x === 1 && A.ID_RE.test(b.v || '')) { await A.forget(b.v); return res.status(204).end(); } // recusou: apaga o que já foi registrado
      let userId = null;
      if (origin === own) {
        const sid = require('./security').parseCookies(req.headers.cookie).evl_sid || '';
        if (/^[A-Za-z0-9_-]{30,64}$/.test(sid)) {
          const u = (await db.q('SELECT user_id FROM sessions WHERE id_hash = $1 AND expires_at > now()', [crypto.createHash('sha256').update(sid).digest('hex')])).rows[0];
          userId = u ? u.user_id : null;
        }
      }
      await A.record(cfg, { v: b.v, s: b.s, p: b.p, r: b.r, q: b.q && typeof b.q === 'object' ? b.q : {}, h: b.h, ua: req.get('user-agent') || '', ip: req.ip, site: siteOf(origin), userId });
    } catch (e) { log.warn('analytics_falhou', { error: e.message }); }
    res.status(204).end();
  });
  // Corpo grande ou ilegível: responde em silêncio, a medição nunca vira erro para a página.
  r.use('/ea/c', (err, req, res, next) => { cors(req, res); res.status(204).end(); }); // eslint-disable-line no-unused-vars
  return r;
}

// Verificação da coleta (só administrador): confirma que as visitas estão chegando. Sem item de menu.
function build(cfg, h) {
  const r = express.Router();
  r.use('/admin/analytics', h.needUser, h.gate, h.needAdmin);
  r.get('/admin/analytics/verificacao', async (req, res, next) => {
    try { res.send(require('./views/analytics').verificacao(h.appCtx(req, res), { data: await A.check(), cfg })); } catch (e) { next(e); }
  });
  return r;
}

module.exports = { mount, build };
