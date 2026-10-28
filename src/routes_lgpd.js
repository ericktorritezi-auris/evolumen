'use strict';
// Ajuda, LGPD (pedidos do titular e aceites) e Configurações.
const express = require('express');
const db = require('./db');
const L = require('./lgpd');
const Set_ = require('./settings');
const mailer = require('./mailer');
const emails = require('./emails');
const notify = require('./notify');
const { audit } = require('./audit');
const views = require('./views/lgpd');

const ID = /^\d{1,12}$/;
const PAGE = 30;

function build(cfg, h) {
  const r = express.Router();
  const ctx = (req, res) => h.appCtx(req, res);
  const flashBack = (req, res, type, text, to) => { h.setFlash(res, type, text); res.redirect(303, to); };

  r.get('/ajuda', h.needUser, h.gate, async (req, res) => res.send(views.ajuda(ctx(req, res), { settings: await Set_.all() })));

  r.use(['/admin/lgpd', '/admin/configuracoes'], h.needUser, h.gate, h.needAdmin);

  // ---- LGPD ----
  const accFilter = (req) => ({ q: String(req.query.q || '').trim().slice(0, 80), doc: ['terms', 'privacy'].includes(req.query.doc) ? req.query.doc : '' });

  r.get('/admin/lgpd', async (req, res) => {
    const aba = req.query.aba === 'aceites' ? 'aceites' : 'pedidos';
    if (aba === 'aceites') {
      const f = accFilter(req);
      const page = Math.max(1, parseInt(req.query.p, 10) || 1);
      const first = await L.listAcceptances(f, { limit: PAGE, offset: 0 });
      const pages = Math.max(1, Math.ceil(first.total / PAGE));
      const cur = Math.min(page, pages);
      const out = cur === 1 ? first : await L.listAcceptances(f, { limit: PAGE, offset: (cur - 1) * PAGE });
      return res.send(views.lgpd(ctx(req, res), { aba, aceites: out.rows, f, page: cur, pages, total: out.total, docTypes: [['terms', 'Termos de uso'], ['privacy', 'Política de privacidade']] }));
    }
    const pedidos = (await db.q(`SELECT d.*, u.name, u.email FROM data_requests d JOIN users u ON u.id = d.user_id ORDER BY (d.status = 'open') DESC, d.created_at DESC LIMIT 200`)).rows;
    res.send(views.lgpd(ctx(req, res), { aba, pedidos }));
  });

  r.get('/admin/lgpd/aceites.csv', async (req, res) => {
    const f = accFilter(req);
    const { rows } = await L.listAcceptances(f, { limit: 50000, offset: 0 });
    const head = ['data_hora', 'aluno', 'email', 'documento', 'versao', 'ip', 'dispositivo', 'origem'];
    const lines = [head.join(';')].concat(rows.map((a) => [a.accepted_at, a.name, a.email, a.doc_type, a.version, a.ip, a.device, a.origin].map(L.csvCell).join(';')));
    await audit(req, 'data_acceptances_exported', { meta: { rows: rows.length } });
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="aceites-evolumen.csv"').send('﻿' + lines.join('\r\n') + '\r\n');
  });

  const loadReq = async (id) => (ID.test(String(id)) ? (await db.q('SELECT d.*, u.name, u.email, u.role FROM data_requests d JOIN users u ON u.id = d.user_id WHERE d.id = $1', [id])).rows[0] : null);

  r.get('/admin/lgpd/pedidos/:id/dados.json', async (req, res, next) => {
    const d = await loadReq(req.params.id); if (!d) return next();
    const data = await L.exportFor(d.user_id);
    await audit(req, 'data_export_admin', { entity: 'user', entityId: d.user_id, meta: { request: d.id } });
    res.set('Content-Disposition', `attachment; filename="dados-aluno-${d.user_id}.json"`).json(data);
  });

  r.post('/admin/lgpd/pedidos/:id/resolver', async (req, res, next) => {
    const d = await loadReq(req.params.id); if (!d) return next();
    const ok = req.body.action === 'done'; const note = String(req.body.note || '').trim().slice(0, 500);
    const wipe = ok && d.type === 'delete';
    if (wipe && d.role !== 'student') return flashBack(req, res, 'error', 'Esta conta não pode ser anonimizada por aqui.', '/admin/lgpd');
    // Pedido e anonimização na mesma transação: ou tudo vale, ou nada muda.
    const done = await db.tx(async (c) => {
      const upd = await c.query("UPDATE data_requests SET status = $2, resolved_at = now(), resolved_by = $3, response = $4 WHERE id = $1 AND status = 'open' RETURNING id", [d.id, ok ? 'done' : 'denied', req.user.id, note]);
      if (!upd.rowCount) return 'already';
      if (wipe) await L.anonymize(d.user_id, c);
      return 'ok';
    });
    if (done === 'already') return flashBack(req, res, 'info', 'Este pedido já foi respondido.', '/admin/lgpd');
    await notify.resolveAdmins('lgpd:' + d.id);
    if (!wipe) await notify.add(d.user_id, { kind: 'lgpd', title: ok ? 'Seu pedido foi atendido' : 'Seu pedido foi analisado', body: note ? note.slice(0, 200) : 'Veja os detalhes no seu e-mail.', link: '/perfil', key: 'lgpdans:' + d.id });
    if (d.type !== 'email_change_admin') {
      const send = mailer.send(cfg, { to: d.email, ...emails.dataRequestDone(cfg, { name: d.name, kind: d.type, ok, note }) }); // endereço lido antes da anonimização
      if (wipe) { try { await send; } catch { /* o aviso é melhor esforço */ } await L.scrubEmailLog(d.email, d.user_id); } else h.background(send);
    }
    await audit(req, wipe ? 'data_deletion_done' : ok ? 'data_request_done' : 'data_request_denied', { entity: 'user', entityId: d.user_id, meta: { request: d.id, type: d.type } });
    flashBack(req, res, 'success', wipe ? 'Conta anonimizada e acessos cancelados. O aluno foi avisado por e-mail.' : ok ? 'Pedido marcado como atendido.' : 'Pedido negado. O aluno foi avisado.', '/admin/lgpd');
  });

  // ---- Configurações ----
  const statusInfo = async () => {
    const l = await db.q("SELECT count(DISTINCT doc_type)::int AS n FROM legal_documents WHERE status = 'published'");
    return {
      version: cfg.version.version, env: cfg.appEnv, baseUrl: cfg.baseUrl,
      mail: cfg.mailTransport === 'memory' || !!(cfg.resendApiKey && cfg.resendFrom),
      payments: cfg.paymentProvider === 'mercadopago' ? (cfg.mpAccessToken ? 'Mercado Pago ligado' : 'Mercado Pago sem token') : 'Simulador (somente teste)',
      paymentsOn: cfg.paymentProvider === 'mercadopago' ? !!cfg.mpAccessToken : false, legal: l.rows[0].n,
    };
  };
  r.get('/admin/configuracoes', async (req, res) => res.send(views.configuracoes(ctx(req, res), { settings: await Set_.all(), status: await statusInfo() })));
  r.post('/admin/configuracoes', async (req, res) => {
    const b = req.body; const errors = {};
    const email = String(b.support_email || '').trim().slice(0, 200);
    const wa = String(b.support_whatsapp || '').trim().slice(0, 25);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.support_email = 'Informe um e-mail válido.';
    if (wa && !/^[0-9 ()+.-]{8,25}$/.test(wa)) errors.support_whatsapp = 'Use só números, espaços, parênteses e traços.';
    const dl = b.download_limit === undefined ? String((await Set_.all()).download_limit) : String(b.download_limit).trim();
    if (!/^\d{1,2}$/.test(dl) || Number(dl) < 1 || Number(dl) > 50) errors.download_limit = 'Informe um número de 1 a 50.';
    const values = { support_email: email, support_whatsapp: wa, download_limit: dl, forum_enabled: b.forum_enabled === '1' ? '1' : '0', notify_questions: b.notify_questions === '1' ? '1' : '0' };
    if (Object.keys(errors).length) return res.status(422).send(views.configuracoes(ctx(req, res), { settings: { ...(await Set_.all()), ...values }, status: await statusInfo(), errors }));
    await Set_.save(values, req.user.id);
    await audit(req, 'settings_saved', { meta: { forum: values.forum_enabled, notify: values.notify_questions, download_limit: values.download_limit } });
    flashBack(req, res, 'success', 'Configurações salvas.', '/admin/configuracoes');
  });
  return r;
}

module.exports = { build };
