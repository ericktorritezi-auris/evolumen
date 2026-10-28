'use strict';
// Painel do administrador (Fase 4): vendas, reembolsos, simulador (só teste/staging) e textos legais.
const express = require('express');
const db = require('./db');
const C = require('./courses');
const S = require('./sales');
const L = require('./legal');
const F = require('./finance');
const { audit } = require('./audit');
const views = require('./views/sales');

const ID = /^\d{1,12}$/;
const PAGE = 30;
const STATUSES = ['pending', 'approved', 'refused', 'expired', 'cancelled', 'refunded', 'charged_back'];
const SIM = { approved: 'approved', pending: 'pending', refused: 'refused', expired: 'cancelled', refunded: 'refunded', charged_back: 'charged_back' };

function build(cfg, h) {
  const r = express.Router();
  r.use(['/admin/financeiro', '/admin/vendas', '/admin/reembolsos', '/admin/simulador', '/admin/textos'], h.needUser, h.gate, h.needAdmin);
  const ctx = (req, res, extra = {}) => ({ ...h.appCtx(req, res), ...extra });
  const flashBack = (req, res, type, text, to) => { h.setFlash(res, type, text); res.redirect(303, to); };
  const fail = (req, res, e, to) => {
    if (e && e.expose) return flashBack(req, res, 'error', e.message, to);
    throw e;
  };

  // ---------- cockpit financeiro ----------
  r.get('/admin/financeiro', async (req, res) => {
    const per = F.period({ periodo: String(req.query.periodo || ''), de: String(req.query.de || ''), ate: String(req.query.ate || '') });
    const curso = ID.test(String(req.query.curso || '')) ? String(req.query.curso) : '';
    const data = await F.summary(per, curso || null);
    const courses = (await db.q('SELECT id, title FROM courses ORDER BY title')).rows;
    res.send(views.financeiro(ctx(req, res), { per, curso, courses, data }));
  });

  // ---------- vendas ----------
  r.get('/admin/vendas', async (req, res) => {
    const f = { q: String(req.query.q || '').trim().slice(0, 80), status: STATUSES.includes(req.query.status) ? req.query.status : '', curso: ID.test(String(req.query.curso || '')) ? String(req.query.curso) : '', forma: ['pix', 'card'].includes(req.query.forma) ? req.query.forma : '' };
    const page = Math.max(1, parseInt(req.query.p, 10) || 1);
    const w = ['1=1']; const p = [];
    if (f.q) { p.push(`%${f.q.toLowerCase()}%`); w.push(`(lower(o.buyer->>'name') LIKE $${p.length} OR lower(o.buyer->>'email') LIKE $${p.length} OR lower(o.public_id) LIKE $${p.length})`); }
    if (f.status) { p.push(f.status); w.push(`o.status = $${p.length}`); }
    if (f.curso) { p.push(f.curso); w.push(`o.course_id = $${p.length}`); }
    if (f.forma) { p.push(f.forma); w.push(`o.method = $${p.length}`); }
    const where = w.join(' AND ');
    const total = (await db.q(`SELECT count(*)::int AS n FROM orders o WHERE ${where}`, p)).rows[0].n;
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const rows = (await db.q(`SELECT o.*, c.title AS course_title, cp.code AS coupon_code FROM orders o JOIN courses c ON c.id = o.course_id LEFT JOIN coupons cp ON cp.id = o.coupon_id WHERE ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ${PAGE} OFFSET ${(Math.min(page, pages) - 1) * PAGE}`, p)).rows;
    const kpi = (await db.q(`SELECT count(*) FILTER (WHERE status = 'approved')::int AS approved, COALESCE(sum(price_cents) FILTER (WHERE status = 'approved'), 0)::bigint AS paid,
      count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status IN ('refunded','charged_back'))::int AS refunded FROM orders`)).rows[0];
    kpi.paid = Number(kpi.paid);
    const requests = (await db.q(`SELECT rr.*, o.price_cents, o.paid_cents, o.buyer->>'email' AS email, COALESCE(u.name, o.buyer->>'name') AS student_name, c.title AS course_title
      FROM refund_requests rr JOIN orders o ON o.id = rr.order_id JOIN courses c ON c.id = o.course_id LEFT JOIN users u ON u.id = o.user_id WHERE rr.status IN ('requested','failed') AND o.status = 'approved' ORDER BY rr.created_at`)).rows;
    const courses = (await db.q('SELECT id, title FROM courses ORDER BY title')).rows;
    res.send(views.vendas(ctx(req, res), { rows, courses, f, page: Math.min(page, pages), pages, total, kpi, requests }));
  });

  async function loadOrder(id) {
    if (!ID.test(String(id))) return null;
    return (await db.q('SELECT o.*, cp.code AS coupon_code FROM orders o LEFT JOIN coupons cp ON cp.id = o.coupon_id WHERE o.id = $1', [id])).rows[0] || null;
  }

  r.get('/admin/vendas/:id', async (req, res, next) => {
    const o = await loadOrder(req.params.id); if (!o) return next();
    const course = await C.byId(o.course_id);
    const refunds = (await db.q('SELECT * FROM refund_requests WHERE order_id = $1 ORDER BY created_at DESC', [o.id])).rows;
    res.send(views.venda(ctx(req, res), { o, course, refunds, canRefund: o.status === 'approved' && !!o.provider_payment_id }));
  });

  r.post('/admin/vendas/:id/reembolsar', async (req, res, next) => {
    const o = await loadOrder(req.params.id); if (!o) return next();
    const back = `/admin/vendas/${o.id}`;
    try {
      const out = await S.approveRefund(cfg, h.background, req, o.id, { requestId: ID.test(String(req.body.request || '')) ? req.body.request : null });
      if (out && out.result === 'reembolso_pendente') return flashBack(req, res, 'success', 'O Mercado Pago aceitou o pedido e ainda está processando. O acesso é cancelado quando ele confirmar.', back);
      flashBack(req, res, 'success', 'Valor devolvido. O acesso e o certificado foram cancelados.', back);
    } catch (e) { fail(req, res, e, back); }
  });

  r.post('/admin/reembolsos/:id/recusar', async (req, res) => {
    if (!ID.test(String(req.params.id))) return flashBack(req, res, 'error', 'Pedido não encontrado.', '/admin/vendas');
    const ok = await S.rejectRefund(cfg, h.background, req, req.params.id, req.body.note);
    flashBack(req, res, ok ? 'success' : 'error', ok ? 'Pedido recusado. O aluno foi avisado por e-mail.' : 'Este pedido já foi decidido.', '/admin/vendas');
  });

  // ---------- simulador: nunca em produção ----------
  const simOnly = (req, res, next) => (cfg.isProd || cfg.paymentProvider !== 'simulated' ? next('route') : next());
  r.get('/admin/simulador', simOnly, async (req, res) => {
    const rows = (await db.q("SELECT o.*, c.title AS course_title FROM orders o JOIN courses c ON c.id = o.course_id WHERE o.provider = 'simulated' ORDER BY o.created_at DESC LIMIT 50")).rows;
    res.send(views.simulador(ctx(req, res), { rows }));
  });
  r.post('/admin/simulador/:public', simOnly, async (req, res) => {
    const st = SIM[req.body.result];
    const o = (await db.q("SELECT * FROM orders WHERE public_id = $1 AND provider = 'simulated'", [String(req.params.public).slice(0, 40)])).rows[0];
    if (!st || !o) return flashBack(req, res, 'error', 'Pedido ou resultado inválido.', '/admin/simulador');
    await db.q('UPDATE orders SET sim_status = $2 WHERE id = $1', [o.id, st]);
    try {
      const out = await S.processPayment(cfg, h.background, `SIM-${o.public_id}`, req);
      flashBack(req, res, 'success', `Simulado: ${req.body.result}. Resultado: ${out.result || 'ok'}.`, '/admin/simulador');
    } catch (e) { fail(req, res, e, '/admin/simulador'); }
  });

  // ---------- textos legais ----------
  r.get('/admin/textos', async (req, res) => {
    const docs = (await db.q(`SELECT d.*, (SELECT count(*)::int FROM acceptances a WHERE a.legal_document_id = d.id) AS accepts FROM legal_documents d ORDER BY d.doc_type, d.created_at DESC, d.id DESC`)).rows;
    res.send(views.textos(ctx(req, res), { docs }));
  });

  const docOr404 = async (req) => (ID.test(String(req.params.id)) ? (await db.q('SELECT * FROM legal_documents WHERE id = $1', [req.params.id])).rows[0] : null);

  r.post('/admin/textos/nova', async (req, res) => {
    const t = req.body.doc_type === 'privacy' ? 'privacy' : 'terms';
    const last = (await db.q('SELECT * FROM legal_documents WHERE doc_type = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [t])).rows[0];
    if (last && last.status === 'draft') return flashBack(req, res, 'error', 'Já existe um rascunho. Edite ou publique antes de criar outro.', `/admin/textos/${last.id}`);
    const n = (await db.q('SELECT count(*)::int AS n FROM legal_documents WHERE doc_type = $1', [t])).rows[0].n + 1;
    const d = (await db.q(`INSERT INTO legal_documents (doc_type, version, title, body_html, body_src, status) VALUES ($1,$2,$3,$4,$5,'draft') RETURNING id`,
      [t, `v${n}.0`, last ? last.title : (t === 'terms' ? 'Termos de uso' : 'Política de privacidade'), last ? last.body_html : '', null])).rows[0];
    await audit(req, 'legal_draft_created', { entity: 'legal_document', entityId: d.id });
    flashBack(req, res, 'success', 'Nova versão criada em rascunho.', `/admin/textos/${d.id}`);
  });

  r.get('/admin/textos/:id', async (req, res, next) => {
    const d = await docOr404(req); if (!d) return next();
    res.send(views.texto(ctx(req, res), { d }));
  });

  r.post('/admin/textos/:id', async (req, res, next) => {
    const d = await docOr404(req); if (!d) return next();
    if (d.status !== 'draft') return flashBack(req, res, 'error', 'Texto publicado não pode ser alterado. Crie uma nova versão.', `/admin/textos/${d.id}`);
    const clean = L.sanitizeHtml(req.body.body_html);
    await db.q('UPDATE legal_documents SET body_html = $2, body_src = NULL WHERE id = $1 AND status = $3', [d.id, clean, 'draft']);
    await audit(req, 'legal_draft_saved', { entity: 'legal_document', entityId: d.id });
    flashBack(req, res, 'success', 'Rascunho salvo.', `/admin/textos/${d.id}`);
  });

  r.post('/admin/textos/:id/publicar', async (req, res, next) => {
    const d = await docOr404(req); if (!d) return next();
    const back = `/admin/textos/${d.id}`;
    if (d.status !== 'draft') return flashBack(req, res, 'error', 'Este texto já está publicado.', back);
    if (String(d.body_html || '').replace(/<[^>]+>/g, '').trim().length < 200 || /Texto em elaboração/.test(d.body_html)) return flashBack(req, res, 'error', 'O texto ainda está curto ou é o provisório. Escreva o texto completo antes de publicar.', back);
    await db.q("UPDATE legal_documents SET status = 'published', published_at = now() WHERE id = $1 AND status = 'draft'", [d.id]);
    await audit(req, 'legal_published', { entity: 'legal_document', entityId: d.id, meta: { doc_type: d.doc_type, version: d.version } });
    flashBack(req, res, 'success', 'Texto publicado. Quem ainda não aceitou esta versão será solicitado a aceitar.', '/admin/textos');
  });

  return r;
}

module.exports = { build };
