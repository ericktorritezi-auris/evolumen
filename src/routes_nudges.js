'use strict';
// Lembretes (2.4.0): alunos que não começaram (em Matrículas do curso), afiliados parados (em Afiliados) e descadastro público.
const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const C = require('./courses');
const N = require('./nudges');
const mailer = require('./mailer');
const { audit } = require('./audit');
const views = require('./views/nudges');

function build(cfg, h) {
  const r = express.Router();
  const admin = [h.needUser, h.gate, h.needAdmin];
  const ctx = (req, res) => h.appCtx(req, res);
  const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const sel = (req) => new Set(arr(req.body.sel).map(String));
  const flashBack = (req, res, type, text, to) => { h.setFlash(res, type, text); res.redirect(303, to); };

  // Ambos os tipos usam o mesmo fluxo: lista -> revisar -> enviar (com token contra envio duplo) e teste para o administrador.
  const mount = (kind, base, loadCourse) => {
    const prep = async (req, res, next) => {
      const course = loadCourse ? await loadCourse(req) : null;
      if (loadCourse && !course) { next(); return null; }
      const group = N.parseGroup(kind, req.body && req.body.grupo !== undefined ? req.body.grupo : req.query.grupo);
      const people = kind === 'afiliado' ? await N.affiliatesOf(group) : await N.studentsOf(course, group);
      return { course, group, people };
    };
    const back = (course) => (kind === 'afiliado' ? '/admin/afiliados/lembretes' : `/admin/cursos/${course.id}/lembretes`);

    r.get(base, ...admin, async (req, res, next) => {
      const p = await prep(req, res, next); if (!p) return;
      res.send(views.listPage(ctx(req, res), { kind, ...p, selected: null, subject: N.DEFAULTS[kind].subject, message: N.DEFAULTS[kind].message }));
    });

    const form = (req) => ({ subject: String(req.body.subject || ''), message: String(req.body.message || '') });

    r.post(`${base}/revisar`, ...admin, async (req, res, next) => {
      const p = await prep(req, res, next); if (!p) return;
      const t = N.cleanText(req.body.subject, req.body.message);
      const selected = sel(req);
      const again = (error) => res.status(422).send(views.listPage(ctx(req, res), { kind, ...p, selected, ...form(req), error }));
      if (t.error) return again(t.error);
      const chosen = p.people.filter((x) => x.status === 'send' && selected.has(x.id)).length;
      if (!chosen) return again('Marque pelo menos uma pessoa que possa receber.');
      if (chosen > N.MAX_BATCH) return again(`Envie no máximo ${N.MAX_BATCH} pessoas por vez. Desmarque algumas e envie o restante depois.`);
      res.send(views.confirmPage(ctx(req, res), { kind, ...p, selected, subject: t.subject, message: t.message, token: crypto.randomBytes(12).toString('hex') }));
    });

    // "Voltar e revisar" da tela de confirmação: reabre a lista com o que foi digitado.
    r.post(`${base}/voltar`, ...admin, async (req, res, next) => {
      const p = await prep(req, res, next); if (!p) return;
      res.send(views.listPage(ctx(req, res), { kind, ...p, selected: sel(req), ...form(req) }));
    });

    r.post(`${base}/teste`, ...admin, async (req, res, next) => {
      const p = await prep(req, res, next); if (!p) return;
      const t = N.cleanText(req.body.subject, req.body.message);
      if (t.error) return res.status(422).send(views.listPage(ctx(req, res), { kind, ...p, selected: sel(req), ...form(req), error: t.error }));
      const me = { name: req.user.name, email: req.user.email, code: 'SEUCUPOM10' };
      await mailer.send(cfg, { to: req.user.email, ...N.build(cfg, { kind, person: me, course: p.course, subject: '[TESTE] ' + t.subject, message: t.message }) });
      flashBack(req, res, 'success', `E-mail de teste enviado para ${req.user.email}. Nenhum aluno recebeu nada.`, `${back(p.course)}?grupo=${p.group}`);
    });

    r.post(`${base}/enviar`, ...admin, async (req, res, next) => {
      const p = await prep(req, res, next); if (!p) return;
      const t = N.cleanText(req.body.subject, req.body.message);
      const token = String(req.body.token || '');
      const to = `${back(p.course)}?grupo=${p.group}`;
      if (t.error) return flashBack(req, res, 'error', t.error, to);
      if (!/^[a-f0-9]{24}$/.test(token)) return flashBack(req, res, 'error', 'O formulário expirou. Revise e envie de novo.', to);
      let out;
      try { out = await N.sendBatch(cfg, h, { kind, course: p.course, group: p.group, selected: sel(req), subject: t.subject, message: t.message, token, adminId: req.user.id }); }
      catch (e) { if (e.expose) return flashBack(req, res, 'error', e.message, to); throw e; }
      if (out.duplicate) return flashBack(req, res, 'info', 'Este envio já foi feito. Nada foi enviado de novo.', to);
      await audit(req, 'reminder_sent', { entity: kind === 'afiliado' ? 'affiliate' : 'course', entityId: p.course ? p.course.id : null, meta: { kind, grupo: p.group, enviados: out.sent, pulados: out.skipped } });
      const who = kind === 'afiliado' ? (out.sent === 1 ? 'afiliado' : 'afiliados') : (out.sent === 1 ? 'aluno' : 'alunos');
      flashBack(req, res, 'success', `Lembrete enviado para ${out.sent} ${who}.${out.skipped ? ` ${out.skipped} ${out.skipped === 1 ? 'foi pulado' : 'foram pulados'} (desmarcados, descadastrados ou com lembrete há menos de ${N.MIN_DAYS} dias).` : ''}`, to);
    });
  };
  // Curso em rascunho: o link do e-mail levaria a uma página que o aluno não vê.
  r.use('/admin/cursos/:id/lembretes', async (req, res, next) => {
    if (req.method !== 'POST' || !['/revisar', '/enviar'].includes(req.path)) return next();
    const c = await C.byId(req.params.id);
    if (c && c.status !== 'published') { h.setFlash(res, 'error', 'Publique o curso antes de enviar lembretes: o aluno não conseguiria abrir o link.'); return res.redirect(303, `/admin/cursos/${c.id}/matriculas`); }
    next();
  });
  mount('afiliado', '/admin/afiliados/lembretes', null);
  mount('aluno', '/admin/cursos/:id/lembretes', async (req) => { const c = await C.byId(req.params.id); return c && C.typeOf(c) !== 'download' ? c : null; });

  // ---------- descadastro público ----------
  const limit = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, handler: (req, res, next) => { const e = new Error('Muitas tentativas. Aguarde um minuto.'); e.status = 429; e.expose = true; next(e); } });
  const em = (v) => String(v || '').trim().toLowerCase().slice(0, 254);
  const page = (req, res, email, token, state, status = 200) => res.status(status).send(views.optoutPage({ cfg, user: req.user, csrf: req.csrf, email, token, state }));
  r.get('/lembretes/cancelar', limit, (req, res) => {
    const email = em(req.query.e), t = String(req.query.t || '');
    if (!email || !N.tokenOk(cfg, email, t)) return page(req, res, '', '', 'invalid', 400);
    page(req, res, email, t, 'ask');
  });
  r.post('/lembretes/cancelar', limit, async (req, res) => {
    const email = em(req.body.e), t = String(req.body.t || '');
    if (!email || !N.tokenOk(cfg, email, t)) return page(req, res, '', '', 'invalid', 400);
    await N.optOut(email); page(req, res, email, t, 'done');
  });
  r.post('/lembretes/retomar', limit, async (req, res) => {
    const email = em(req.body.e), t = String(req.body.t || '');
    if (!email || !N.tokenOk(cfg, email, t)) return page(req, res, '', '', 'invalid', 400);
    await N.optIn(email); page(req, res, email, t, 'back');
  });
  return r;
}

module.exports = { build };
