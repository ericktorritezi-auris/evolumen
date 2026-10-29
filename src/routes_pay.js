'use strict';
// Compra: checkout, acompanhamento do pedido, "Pagamentos e acessos" do aluno, pedido de reembolso e webhook do gateway.
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const C = require('./courses');
const S = require('./sales');
const V = require('./validation');
const payments = require('./payments');
const log = require('./logger');
const { audit } = require('./audit');
const views = require('./views/pay');

function build(cfg, h) {
  const r = express.Router();
  const limit = cfg.isTest ? (req, res, next) => next() : rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (req, res, next) => { const e = new Error('Muitas tentativas. Aguarde alguns minutos e tente de novo.'); e.status = 429; e.expose = true; next(e); } });
  // Acompanhamento do pedido: a tela consulta de poucos em poucos segundos, então o limite é folgado (só barra abuso).
  const pedLimit = cfg.isTest ? (req, res, next) => next() : rateLimit({ windowMs: 15 * 60 * 1000, limit: 400, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (req, res) => res.status(429).type('text/plain').send('Muitas consultas. Aguarde alguns minutos.') });
  const bad = (status, message) => Object.assign(new Error(message), { status, expose: true });

  async function loadCourse(req, res, next) {
    const course = await C.bySlug(req.params.slug);
    const visible = course && course.status === 'published' && course.published_at && new Date(course.published_at) <= new Date();
    if (!visible) { next(); return null; }
    if (!cfg.paymentsEnabled) { h.setFlash(res, 'info', 'As vendas deste produto ainda não estão abertas.'); res.redirect(303, `/cursos/${course.slug}`); return null; }
    if (req.user && req.user.role === 'admin') { h.setFlash(res, 'info', 'Administradores já veem todos os produtos. Para testar a compra, entre com uma conta de aluno.'); res.redirect(303, `/cursos/${course.slug}`); return null; }
    return course;
  }

  async function context(req, res, course) {
    const bs = await S.buyState(req.user && req.user.id, course);
    if (bs.state === 'live') { h.setFlash(res, 'info', 'Você já tem acesso a este produto.'); res.redirect(303, `/curso/${course.slug}`); return null; }
    const docs = await S.publishedDocs();
    if (!docs.terms || !docs.privacy) throw bad(503, 'As matrículas estão temporariamente indisponíveis. Tente de novo em instantes.');
    return { renewal: bs.state === 'renew', docs };
  }

  const FIELDS = ['name', 'phone', 'cpf', 'cep', 'street', 'street_number', 'complement', 'district', 'city', 'state'];

  function initialValues(user, query) {
    const v = { method: 'pix' };
    if (user) for (const k of [...FIELDS, 'email']) v[k] = user[k] || '';
    return { ...v, ...query };
  }

  r.get('/checkout/:slug', async (req, res, next) => {
    const course = await loadCourse(req, res, next); if (!course) return;
    const ctx = await context(req, res, course); if (!ctx) return;
    const code = String(req.query.cupom || '').trim().toUpperCase().slice(0, 30);
    let coupon = null; let couponErr = ''; let couponMsg = '';
    if (code && !ctx.renewal) {
      const c = await S.checkCoupon(code, course, { userId: req.user && req.user.id });
      if (c.error) couponErr = c.error; else coupon = c.coupon;
    }
    const price = S.pricing(course, coupon, { renewal: ctx.renewal });
    if (coupon) couponMsg = price.source === 'coupon' ? `Cupom ${coupon.code} aplicado.` : 'A promoção atual já é igual ou melhor que o cupom, então vale a promoção.';
    res.send(views.checkoutPage({ ...h.appCtx(req, res), course, price, values: initialValues(req.user, {}), renewal: ctx.renewal, couponCode: coupon ? coupon.code : '', couponMsg, couponErr, docs: ctx.docs }));
  });

  r.post('/checkout/:slug', limit, async (req, res, next) => {
    const course = await loadCourse(req, res, next); if (!course) return;
    const ctx = await context(req, res, course); if (!ctx) return;
    const user = req.user || null;
    const { errors, values } = V.profileFields(req.body, { allowCpf: true });
    const email = user ? user.email : V.normalizeEmail(req.body.email);
    if (!email) errors.email = 'Informe um e-mail válido.';
    if (user && user.cpf) values.cpf = user.cpf;
    if (!values.cpf && !errors.cpf) errors.cpf = 'Informe o CPF.';
    if (!values.phone && !errors.phone) errors.phone = 'Informe o telefone com DDD.';
    if (!values.cep && !errors.cep) errors.cep = 'Informe o CEP.';
    for (const [k, msg] of [['street', 'Informe a rua.'], ['street_number', 'Informe o número.'], ['district', 'Informe o bairro.'], ['city', 'Informe a cidade.'], ['state', 'Informe a UF.']]) if (!values[k] && !errors[k]) errors[k] = msg;
    const method = req.body.method === 'card' ? 'card' : req.body.method === 'pix' ? 'pix' : null;
    if (!method) errors.method = 'Escolha a forma de pagamento.';
    if (req.body.accept !== '1') errors.accept = 'Para continuar, aceite os Termos de uso e a Política de privacidade.';
    if (!user && email && !errors.email) {
      const ex = (await db.q('SELECT role FROM users WHERE lower(email) = $1', [email])).rows[0];
      if (ex) errors.email = ex.role === 'admin' ? 'Este e-mail é de um administrador. Use outro e-mail.' : 'Já existe uma conta com este e-mail. Entre para continuar a compra.';
    }
    if (values.cpf && !errors.cpf && !(user && user.cpf === values.cpf)) {
      const dup = await db.q('SELECT 1 FROM users WHERE cpf = $1 AND id IS DISTINCT FROM $2', [values.cpf, user ? user.id : null]);
      if (dup.rowCount) errors.cpf = 'Este CPF já está em outra conta. Entre com ela para continuar.';
    }
    // O cupom é conferido de novo agora, antes de gerar a cobrança.
    let coupon = null; let couponErr = '';
    const code = String(req.body.cupom || '').trim().toUpperCase().slice(0, 30);
    if (code && !ctx.renewal) {
      const c = await S.checkCoupon(code, course, { userId: user && user.id, email });
      if (c.error) couponErr = c.error; else coupon = c.coupon;
    }
    const show = async (status, extra = {}) => {
      const price = S.pricing(course, coupon, { renewal: ctx.renewal });
      return res.status(status).send(views.checkoutPage({ ...h.appCtx(req, res), course, price, values: { ...req.body, email, ...values, accept: req.body.accept === '1' }, errors, renewal: ctx.renewal,
        couponCode: coupon ? coupon.code : '', couponErr, couponMsg: coupon ? `Cupom ${coupon.code} aplicado.` : '', docs: ctx.docs, ...extra }));
    };
    if (Object.keys(errors).length || couponErr) return show(422);
    const buyer = { name: values.name, email, phone: values.phone, cpf: values.cpf, cep: values.cep, street: values.street, street_number: values.street_number, complement: values.complement, district: values.district, city: values.city, state: values.state };
    const order = await S.createOrder(cfg, req, { course, buyer, method, user, coupon, renewal: ctx.renewal, docs: ctx.docs });
    await audit(req, 'checkout_started', { entity: 'order', entityId: order.id, meta: { course: course.id, method, email: user ? undefined : email } });
    res.redirect(303, `/pedido/${order.public_id}`);
  });

  // ---- pedido: o comprador acompanha aqui. O endereço tem um código aleatório; mostra só o necessário. ----
  async function loadOrder(req) {
    if (!/^[A-Za-z0-9]{20,40}$/.test(req.params.publicId)) return null;
    const o = (await db.q('SELECT * FROM orders WHERE public_id = $1', [req.params.publicId])).rows[0];
    return o || null;
  }

  r.get('/pedido/:publicId', pedLimit, async (req, res, next) => {
    let o = await loadOrder(req); if (!o) return next();
    const course = await C.byId(o.course_id);
    // Volta do Mercado Pago: confirma direto no gateway, sem esperar o webhook.
    if (o.status === 'pending' && cfg.paymentProvider === 'mercadopago' && /^\d{3,20}$/.test(String(req.query.payment_id || ''))) {
      try { await S.processPayment(cfg, h.background, req.query.payment_id, req); o = await loadOrder(req); } catch (e) { log.warn('pedido_confirmacao_falhou', { error: e.message }); }
    }
    if (o.status === 'pending' && o.method === 'pix' && o.pix_expires_at && new Date(o.pix_expires_at) < new Date(Date.now() - 60000)) { await S.sweepExpired(cfg, h.background); o = await loadOrder(req); }
    // "Conta nova": o comprador ainda está com a senha provisória enviada por e-mail.
    let newUser = false;
    if (o.status === 'approved' && !req.user && o.user_id) newUser = !!(await db.q('SELECT 1 FROM users WHERE id = $1 AND must_change_password', [o.user_id])).rowCount;
    res.send(views.orderPage({ ...h.appCtx(req, res), order: o, course, newUser, simulated: cfg.paymentProvider === 'simulated' }));
  });

  r.get('/pedido/:publicId/status', pedLimit, async (req, res, next) => {
    const o = await loadOrder(req); if (!o) return next();
    // Rede de segurança: se o webhook se perder, a própria tela consulta o gateway enquanto o comprador espera.
    if (o.status === 'pending' && o.provider === 'mercadopago' && cfg.paymentProvider === 'mercadopago' && o.provider_payment_id) {
      try { await S.processPayment(cfg, h.background, o.provider_payment_id, req); } catch (e) { log.warn('status_consulta_falhou', { error: e.message }); }
    }
    if (o.status === 'pending' && o.method === 'pix' && o.pix_expires_at && new Date(o.pix_expires_at) < new Date(Date.now() - 60000)) { await S.sweepExpired(cfg, h.background); }
    const fresh = await loadOrder(req);
    res.set('Cache-Control', 'no-store').json({ status: fresh.status });
  });

  // ---- aluno: Pagamentos e acessos ----
  const guard = [h.needUser, h.gate];
  r.get('/pagamentos', ...guard, async (req, res, next) => {
    if (req.user.role === 'admin') return res.redirect(303, '/admin/vendas');
    const rows = (await db.q(`SELECT e.*, c.title, c.slug, c.access_type, c.product_type FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = $1 ORDER BY e.created_at DESC`, [req.user.id])).rows;
    const accesses = [];
    for (const e of rows) {
      const live = e.status === 'active' && new Date(e.starts_at) <= new Date() && (!e.expires_at || new Date(e.expires_at) > new Date());
      const soon = e.access_type === 'months' && e.status === 'active' && e.expires_at && (new Date(e.expires_at) <= new Date() || new Date(e.expires_at).getTime() - Date.now() <= 30 * 86400000);
      accesses.push({ title: e.title, slug: e.slug, product_type: e.product_type, origin: e.origin, expires_at: e.expires_at, live, cancelled: e.status === 'cancelled', renew: !!cfg.paymentsEnabled && !!soon });
    }
    const orders = (await db.q(`SELECT o.*, c.title, cp.code AS coupon_code FROM orders o JOIN courses c ON c.id = o.course_id LEFT JOIN coupons cp ON cp.id = o.coupon_id
      WHERE o.user_id = $1 OR (o.user_id IS NULL AND lower(o.buyer->>'email') = $2) ORDER BY o.created_at DESC LIMIT 60`, [req.user.id, req.user.email.toLowerCase()])).rows
      .filter((o) => o.status !== 'cancelled' || o.status_detail !== 'gateway_error')
      .map((o) => ({ ...o, can_refund: S.canRequestRefund(o) }));
    const open = (await db.q("SELECT order_id FROM refund_requests WHERE status = 'requested' AND order_id = ANY($1::bigint[])", [orders.map((o) => o.id)])).rows;
    res.send(views.pagamentos({ ...h.appCtx(req, res), accesses, orders, refundOpen: new Set(open.map((x) => String(x.order_id))) }));
  });

  r.post('/pagamentos/:publicId/reembolso', limit, ...guard, async (req, res, next) => {
    if (req.user.role !== 'student' || !/^[A-Za-z0-9]{20,40}$/.test(req.params.publicId)) return next();
    const o = (await db.q('SELECT * FROM orders WHERE public_id = $1 AND user_id = $2', [req.params.publicId, req.user.id])).rows[0];
    if (!o) return next();
    if (!S.canRequestRefund(o)) { h.setFlash(res, 'error', `O prazo de ${cfg.refundDays} dias para pedir reembolso terminou.`); return res.redirect(303, '/pagamentos'); }
    const ok = await S.requestRefund(cfg, h.background, req, o, req.body.reason);
    h.setFlash(res, ok ? 'success' : 'info', ok ? 'Pedido de reembolso enviado. Você recebe a resposta por e-mail.' : 'Você já tem um pedido de reembolso em análise.');
    res.redirect(303, '/pagamentos');
  });

  return r;
}

// Webhook do gateway: sem sessão e sem CSRF (quem chama é o Mercado Pago). A autenticidade vem da assinatura.
function mountWebhook(cfg, h, router) {
  router.post('/mercadopago', async (req, res) => {
    if (cfg.paymentProvider !== 'mercadopago') return res.status(404).json({ ok: false });
    const gw = payments.mercadopago;
    if (!gw.verifyWebhook(cfg, req)) { log.warn('webhook_assinatura_invalida', { ip: req.ip, assinatura: !!req.get('x-signature'), request_id: !!req.get('x-request-id'), data_id: !!(req.query['data.id'] || (req.body && req.body.data && req.body.data.id)), formato: req.query.topic ? 'ipn' : (req.body && req.body.type ? 'webhook' : 'desconhecido'), segredo_configurado: !!cfg.mpWebhookSecret }); return res.status(401).json({ ok: false }); }
    const pid = gw.paymentIdFrom(req);
    if (!pid) return res.json({ ok: true, ignored: true });
    const key = `${pid}:${req.get('x-request-id') || Date.now()}`;
    const ev = await db.q('INSERT INTO webhook_events (provider, event_key, payment_id, payload) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (provider, event_key) DO NOTHING RETURNING id', ['mercadopago', key, pid, JSON.stringify(req.body || {})]);
    if (!ev.rowCount) return res.json({ ok: true, duplicate: true });
    try {
      const out = await S.processPayment(cfg, h.background, pid, req);
      await db.q('UPDATE webhook_events SET result = $2, processed_at = now() WHERE id = $1', [ev.rows[0].id, out.result]);
      res.json({ ok: true });
    } catch (e) {
      log.error('webhook_falhou', { payment: pid, error: e.message });
      await db.q('UPDATE webhook_events SET result = $2 WHERE id = $1', [ev.rows[0].id, ('erro: ' + e.message).slice(0, 200)]);
      await db.q('DELETE FROM webhook_events WHERE id = $1', [ev.rows[0].id]); // o gateway tentará de novo
      res.status(500).json({ ok: false });
    }
  });
}

module.exports = { build, mountWebhook };
