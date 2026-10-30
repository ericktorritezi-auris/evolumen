'use strict';
// Vendas: preço, pedido, tratamento do pagamento (webhook), matrícula automática e reembolso.
// Regra central: o acesso ao curso só nasce quando o gateway confirma o pagamento. Nada vale pelo corpo do webhook:
// o sistema sempre consulta o pagamento no gateway e confere o valor antes de liberar.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const C = require('./courses');
const K = require('./coupons');
const V = require('./validation');
const mailer = require('./mailer');
const emails = require('./emails');
const notify = require('./notify');
const certs = require('./certificates');
const AFF = require('./affiliates');
const payments = require('./payments');
const { tempPassword } = require('./access');
const { audit, deviceLabel } = require('./audit');
const log = require('./logger');

const DAY = 86400000;
const newPublicId = () => crypto.randomBytes(18).toString("base64url").replace(/[-_]/g, "x").slice(0, 24);
const fmtLong = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });

// ---------- preço ----------
// Promoção e cupom nunca se somam: vale o menor preço. Renovação usa o preço de renovação, se o curso tiver, e não aceita cupom.
function pricing(course, coupon, { renewal = false } = {}) {
  if (renewal) {
    const cents = course.renewal_price_cents != null ? course.renewal_price_cents : C.effectivePrice(course).cents;
    return { list: course.price_cents, final: cents, source: 'renewal', coupon: null, off: Math.max(0, course.price_cents - cents) };
  }
  const eff = C.effectivePrice(course);
  let final = eff.cents; let source = eff.original != null ? 'promo' : 'full'; let used = null;
  if (coupon) {
    const pw = K.priceWith(coupon, course);
    if (pw && pw.cents < eff.cents) { final = pw.cents; source = 'coupon'; used = coupon; }
  }
  return { list: course.price_cents, final, source, coupon: used, off: course.price_cents - final };
}

// Cupom digitado no checkout: confere agora (situação, curso e uso único por pessoa).
async function checkCoupon(code, course, { userId = null, email = null } = {}) {
  const raw = String(code || '').trim();
  if (!raw) return { coupon: null };
  const c = await K.byCode(raw);
  if (!c || K.stateOf(c, c.uses) !== 'active') return { error: 'Este cupom não está mais válido.' };
  if (!c.courses.some((x) => String(x.id) === String(course.id))) return { error: 'Este cupom não vale para este produto.' };
  let uid = userId;
  if (!uid && email) { const u = (await db.q('SELECT id FROM users WHERE lower(email) = $1', [email])).rows[0]; uid = u ? u.id : null; }
  if (uid && (await db.q('SELECT 1 FROM coupon_redemptions WHERE coupon_id = $1 AND user_id = $2', [c.id, uid])).rowCount) return { error: 'Você já usou este cupom.' };
  // Reserva: compras em andamento (pagamento ainda pendente) também seguram o cupom, para não valer em dois pedidos ao mesmo tempo.
  const mail = String(email || '').toLowerCase();
  const pend = (await db.q(`SELECT course_id, user_id, lower(buyer->>'email') AS email FROM orders WHERE coupon_id = $1 AND status = 'pending' AND created_at > now() - interval '35 minutes'`, [c.id])).rows;
  const mine = (r) => (uid && String(r.user_id) === String(uid)) || (mail && r.email === mail);
  if (pend.some((r) => mine(r) && String(r.course_id) !== String(course.id))) return { error: 'Você já está usando este cupom em outra compra que ainda não foi paga.' };
  if (c.max_uses && c.uses + new Set(pend.filter((r) => !mine(r)).map((r) => r.email)).size >= c.max_uses) return { error: 'Este cupom está reservado em compras em andamento. Tente de novo em alguns minutos.' };
  return { coupon: c };
}

// ---------- situação do aluno diante do curso ----------
// none = pode comprar · live = já tem acesso · renew = pode renovar (vencido ou perto de vencer)
async function buyState(userId, course) {
  if (!userId) return { state: 'none' };
  const e = (await db.q('SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2', [userId, course.id])).rows[0];
  if (!e || e.status !== 'active') return { state: 'none', enrollment: e || null };
  const expired = e.expires_at && new Date(e.expires_at) <= new Date();
  if (course.access_type !== 'months') return { state: expired ? 'renew' : 'live', enrollment: e };
  if (expired || (e.expires_at && new Date(e.expires_at).getTime() - Date.now() <= 30 * DAY)) return { state: 'renew', enrollment: e };
  return { state: 'live', enrollment: e };
}

async function publishedDocs() {
  const q = async (t) => (await db.q("SELECT * FROM legal_documents WHERE doc_type = $1 AND status = 'published' ORDER BY published_at DESC, id DESC LIMIT 1", [t])).rows[0] || null;
  return { terms: await q('terms'), privacy: await q('privacy') };
}

// ---------- pedido ----------
async function createOrder(cfg, req, { course, buyer, method, user, coupon, renewal, docs }) {
  const price = pricing(course, coupon, { renewal });
  if (!(price.final > 0)) throw Object.assign(new Error('Este produto não tem valor de venda. Fale com o suporte.'), { status: 400, expose: true });
  const publicId = newPublicId();
  const ua = ((req.get && req.get('user-agent')) || '').slice(0, 300);
  const gw = payments.forCfg(cfg);
  // Tudo sob trava por (curso, e-mail): clique duplo ou duas abas não geram duas cobranças.
  return db.tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`order:${course.id}:${buyer.email}`]);
    const dup = (await c.query(method === 'pix'
      ? `SELECT * FROM orders WHERE course_id = $1 AND lower(buyer->>'email') = $2 AND method = 'pix' AND status = 'pending' AND price_cents = $3 AND coupon_id IS NOT DISTINCT FROM $4::bigint AND pix_expires_at > now() + interval '2 minutes' ORDER BY id DESC LIMIT 1`
      : `SELECT * FROM orders WHERE course_id = $1 AND lower(buyer->>'email') = $2 AND method = 'card' AND status = 'pending' AND price_cents = $3 AND coupon_id IS NOT DISTINCT FROM $4::bigint AND checkout_url IS NOT NULL AND created_at > now() - interval '30 minutes' ORDER BY id DESC LIMIT 1`,
    [course.id, buyer.email, price.final, price.coupon ? price.coupon.id : null])).rows[0];
    if (dup) return dup;
    const o = (await c.query(`INSERT INTO orders (public_id, user_id, course_id, kind, buyer, list_cents, price_cents, price_source, coupon_id, method, provider, terms_doc_id, privacy_doc_id, ip, user_agent)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [publicId, user ? user.id : null, course.id, renewal ? 'renewal' : 'purchase', JSON.stringify(buyer), price.list, price.final, price.source, price.coupon ? price.coupon.id : null, method, cfg.paymentProvider,
      docs.terms.id, docs.privacy.id, req.ip || null, ua])).rows[0];
    try {
      if (method === 'pix') {
        const r = await gw.createPix(cfg, { order: o, course });
        return (await c.query('UPDATE orders SET provider_payment_id = $2, pix_code = $3, pix_qr_base64 = $4, pix_expires_at = $5, updated_at = now() WHERE id = $1 RETURNING *', [o.id, r.paymentId, r.code, r.qrBase64, r.expiresAt])).rows[0];
      }
      const r = await gw.createCheckout(cfg, { order: o, course });
      return (await c.query('UPDATE orders SET provider_ref = $2, checkout_url = $3, provider_payment_id = COALESCE($4, provider_payment_id), updated_at = now() WHERE id = $1 RETURNING *', [o.id, r.ref, r.url, r.paymentId || null])).rows[0];
    } catch (e) {
      log.error('pedido_gateway_falhou', { order: o.id, error: e.message });
      throw Object.assign(new Error('Não conseguimos iniciar o pagamento agora. Tente de novo em instantes.'), { status: 502, expose: true });
    }
  });
}

// ---------- webhook / confirmação ----------
// Consulta o pagamento no gateway e aplica no pedido. Pode ser chamado várias vezes para o mesmo pagamento (idempotente).
async function processPayment(cfg, bg, paymentId, req) {
  const gw = payments.forCfg(cfg);
  const pay = await gw.getPayment(cfg, paymentId);
  if (!pay || !pay.reference) return { result: 'ignorado' };
  const order = (await db.q('SELECT id FROM orders WHERE public_id = $1 AND provider = $2', [pay.reference, gw.name])).rows[0];
  if (!order) return { result: 'pedido_desconhecido' };
  return applyPayment(cfg, bg, order.id, pay, req);
}

async function applyPayment(cfg, bg, orderId, pay, req) {
  const out = await db.tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0];
    const course = (await c.query('SELECT * FROM courses WHERE id = $1', [o.course_id])).rows[0];
    const res = { order: o, course, mails: [], audits: [], after: [], result: 'sem_mudanca' };

    if (pay.status === 'approved') {
      if (o.status === 'approved') {
        if (o.provider_payment_id && o.provider_payment_id !== pay.id) { res.result = 'pagamento_duplicado'; res.audits.push(['payment_duplicate', { order: o.id, payment: pay.id }]); }
        return res;
      }
      if (['refunded', 'charged_back'].includes(o.status)) return res;
      if (pay.amountCents < o.price_cents) { res.result = 'valor_divergente'; res.audits.push(['payment_amount_mismatch', { order: o.id, esperado: o.price_cents, recebido: pay.amountCents }]); return res; }
      const fin = await finalize(cfg, c, o, course, pay);
      Object.assign(res, fin, { result: 'aprovado' });
      return res;
    }
    if (pay.status === 'refunded' || pay.status === 'charged_back') {
      // Leitura fora de ordem: o gateway já devolveu antes de aprovarmos. Fecha o pedido sem liberar acesso.
      if (['pending', 'refused', 'expired', 'cancelled'].includes(o.status)) {
        await c.query("UPDATE orders SET status = $2, refunded_at = now(), provider_payment_id = COALESCE($3, provider_payment_id), updated_at = now() WHERE id = $1", [o.id, pay.status, pay.id || null]);
        res.result = 'devolvido_sem_acesso'; res.audits.push(['order_refunded_unpaid', { order: o.id }]);
        return res;
      }
      if (o.provider_payment_id && pay.id && o.provider_payment_id !== pay.id) { res.result = 'outro_pagamento'; return res; }
      if (o.status === 'approved' || (o.status === 'refunded' && pay.status === 'charged_back')) {
        const user = (await c.query('SELECT * FROM users WHERE id = $1', [o.user_id])).rows[0];
        const revoked = await cancelAccess(c, o);
        await c.query(`UPDATE orders SET status = $2, refunded_at = COALESCE(refunded_at, now()), updated_at = now() WHERE id = $1`, [o.id, pay.status]);
        await c.query("UPDATE refund_requests SET status = 'approved', decided_at = COALESCE(decided_at, now()) WHERE order_id = $1 AND status = 'requested'", [o.id]);
        res.result = pay.status; res.audits.push([pay.status === 'refunded' ? 'order_refunded' : 'order_charged_back', { order: o.id, course: o.course_id, user: o.user_id }]);
        let cm = null;
        try { await c.query('SAVEPOINT aff_cancel'); cm = await AFF.cancelFor(c, o.id, pay.status === 'refunded' ? 'Reembolso' : 'Estorno (chargeback)'); await c.query('RELEASE SAVEPOINT aff_cancel'); }
        catch (e) { await c.query('ROLLBACK TO SAVEPOINT aff_cancel'); log.error('comissao_cancelar_falhou', { order: o.id, error: e.message }); res.audits.push(['affiliate_commission_failed', { order: o.id, acao: 'cancelar' }]); }
        if (cm) res.audits.push(['affiliate_commission_cancelled', { order: o.id, affiliate: cm.affiliate_id, commission: cm.id, valor: cm.amount_cents, motivo: pay.status }]);
        if (revoked) res.after.push(() => certs.revokeFor(o.user_id, o.course_id, pay.status === 'refunded' ? 'Reembolso do curso' : 'Estorno (chargeback) do pagamento'));
        if (user && o.status === 'approved') res.mails.push({ to: user.email, ...emails.refundDone(cfg, { name: user.name, course, amountCents: o.paid_cents || o.price_cents }) });
        res.revokedAccess = revoked;
      }
      return res;
    }
    if (o.status === 'pending' || o.status === 'refused') {
      const map = { pending: 'pending', refused: 'refused', cancelled: pay.detail === 'expired' ? 'expired' : 'cancelled' };
      const st = map[pay.status] || 'pending';
      if (st !== o.status || (pay.id && pay.id !== o.provider_payment_id)) {
        await c.query('UPDATE orders SET status = $2, status_detail = $3, provider_payment_id = COALESCE($4, provider_payment_id), updated_at = now() WHERE id = $1', [o.id, st, pay.detail || null, pay.id || null]);
        res.result = st;
      }
    }
    return res;
  });
  for (const [action, meta] of out.audits) await audit(req, action, { entity: 'order', entityId: out.order.id, meta });
  for (const fn of out.after) { try { await fn(); } catch (e) { log.error('pos_pagamento_falhou', { error: e.message }); } }
  for (const m of out.mails) bg(mailer.send(cfg, m));
  await bell(out);
  return { result: out.result, orderId: out.order.id };
}

// Campainha depois da transação (melhor esforço).
async function bell(out) {
  const o = out.order; const title = out.course ? out.course.title : '';
  if (out.result === 'aprovado') {
    const who = (out.user && out.user.name) || (o.buyer && o.buyer.name) || 'Um aluno';
    await notify.toAdmins({ kind: 'sale', title: who + (o.kind === 'renewal' ? ' renovou o acesso' : ' acabou de comprar'), body: title, link: '/admin/vendas', key: 'sale:' + o.id, subject: out.user ? out.user.id : null });
    if (out.user) await notify.add(out.user.id, { kind: 'welcome', title: o.kind === 'renewal' ? 'Seu acesso foi renovado' : 'Pagamento confirmado. Bem-vindo!', body: title + (out.course && out.course.product_type === 'download' ? ' — seus arquivos já estão disponíveis.' : ' — comece pela primeira aula.'), link: '/curso/' + out.course.slug, key: 'welcome:' + o.id });
  } else if (out.result === 'refunded' || out.result === 'charged_back') {
    await notify.resolveRefundsOf(o.id);
    if (out.result === 'charged_back') await notify.toAdmins({ kind: 'chargeback', title: 'Chargeback recebido', body: title, link: '/admin/vendas', key: 'chargeback:' + o.id, subject: o.user_id });
    if (o.user_id && out.revokedAccess) await notify.add(o.user_id, { kind: 'refund', title: out.result === 'refunded' ? 'Seu reembolso foi concluído' : 'Pagamento estornado', body: title, link: '/pagamentos', key: 'refunddone:' + o.id });
  }
}

// Aprovação: cria a conta (se preciso), grava aceites, cria ou estende a matrícula e registra o uso do cupom. Tudo na mesma transação.
async function finalize(cfg, c, o, course, pay) {
  const b = o.buyer;
  let user = o.user_id ? (await c.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [o.user_id])).rows[0] : null;
  if (!user) user = (await c.query('SELECT * FROM users WHERE lower(email) = $1 FOR UPDATE', [b.email])).rows[0] || null;
  let password = null;
  if (!user) {
    password = tempPassword();
    const hash = await bcrypt.hash(password, cfg.bcryptCost);
    const ins = async (cpf) => (await c.query(`INSERT INTO users (email, password_hash, role, name, phone, cpf, cep, street, street_number, complement, district, city, state, must_change_password)
      VALUES ($1,$2,'student',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE) RETURNING *`,
    [b.email, hash, b.name, b.phone || null, cpf, b.cep || null, b.street || null, b.street_number || null, b.complement || null, b.district || null, b.city || null, b.state || null])).rows[0];
    await c.query('SAVEPOINT u1');
    try { user = await ins(b.cpf || null); } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT u1');
      if (e.code === '23505' && /cpf/.test(e.constraint || '')) user = await ins(null); // CPF já é de outra conta: cria sem CPF
      else throw e;
    }
  } else {
    // Completa só o que a conta ainda não tem.
    const dupCpf = b.cpf && !user.cpf ? (await c.query('SELECT 1 FROM users WHERE cpf = $1 AND id <> $2', [b.cpf, user.id])).rowCount : 0;
    await c.query(`UPDATE users SET phone = COALESCE(phone, $2), cpf = COALESCE(cpf, $3), cep = COALESCE(cep, $4), street = COALESCE(street, $5), street_number = COALESCE(street_number, $6),
      complement = COALESCE(complement, $7), district = COALESCE(district, $8), city = COALESCE(city, $9), state = COALESCE(state, $10), updated_at = now() WHERE id = $1`,
    [user.id, b.phone || null, dupCpf ? null : (b.cpf || null), b.cep || null, b.street || null, b.street_number || null, b.complement || null, b.district || null, b.city || null, b.state || null]);
  }
  // aceites do checkout (imutáveis; duplicata é ignorada)
  const ua = o.user_agent || '';
  for (const docId of [o.terms_doc_id, o.privacy_doc_id]) {
    if (!docId) continue;
    const d = (await c.query('SELECT id, doc_type, version FROM legal_documents WHERE id = $1', [docId])).rows[0];
    if (d) await c.query('INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, ip, user_agent, device, origin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id, legal_document_id) DO NOTHING', [user.id, d.id, d.doc_type, d.version, o.ip, ua, deviceLabel(ua), 'checkout']);
  }
  // matrícula
  const months = course.access_type === 'months' ? course.access_months : null;
  const ex = (await c.query('SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 FOR UPDATE', [user.id, course.id])).rows[0];
  const live = !!ex && ex.status === 'active' && (!ex.expires_at || new Date(ex.expires_at) > new Date());
  let newExp = null;
  if (months) newExp = (await c.query("SELECT (GREATEST(COALESCE($1::timestamptz, now()), now()) + ($2::int || ' months')::interval) AS e", [live ? ex.expires_at : null, months])).rows[0].e;
  const renewal = live || (!!ex && ex.status === 'active');
  if (!ex) await c.query("INSERT INTO enrollments (user_id, course_id, origin, expires_at) VALUES ($1,$2,'purchase',$3)", [user.id, course.id, newExp]);
  else if (live && !ex.expires_at) { /* vitalício: nada muda */ }
  else await c.query("UPDATE enrollments SET status = 'active', cancelled_at = NULL, starts_at = LEAST(starts_at, now()), expires_at = $2, origin = CASE WHEN status = 'cancelled' THEN 'purchase' ELSE origin END WHERE id = $1", [ex.id, newExp]);
  let couponFlag = null;
  if (o.coupon_id) {
    const ins = await c.query('INSERT INTO coupon_redemptions (coupon_id, user_id, course_id) VALUES ($1,$2,$3) ON CONFLICT (coupon_id, user_id) DO NOTHING', [o.coupon_id, user.id, course.id]);
    const cp = (await c.query('SELECT max_uses, (SELECT count(*)::int FROM coupon_redemptions WHERE coupon_id = $1) AS uses FROM coupons WHERE id = $1', [o.coupon_id])).rows[0];
    // A venda já foi paga e é honrada, mas fica registrado para você ver se o cupom foi usado além do combinado.
    if (!ins.rowCount) couponFlag = 'coupon_repeated'; else if (cp && cp.max_uses && cp.uses > cp.max_uses) couponFlag = 'coupon_over_limit';
  }
  const paid = pay.paidCents || o.price_cents;
  const row = (await c.query(`UPDATE orders SET status = 'approved', status_detail = $2, user_id = $3, provider_payment_id = $4, paid_cents = $5, installments = $6,
    approved_at = now(), refund_until = now() + ($7 || ' days')::interval, prev_expires_at = $8, prev_enrollment = $9, updated_at = now() WHERE id = $1 RETURNING *`,
  [o.id, pay.detail || null, user.id, pay.id, paid, pay.installments || null, String(cfg.refundDays), live ? ex.expires_at : null, live && !!ex.expires_at])).rows[0];
  const mail = { to: user.email, ...emails.purchaseApproved(cfg, { name: user.name, email: user.email, password, course, order: row, renewal: renewal && !!ex, expiresLabel: newExp ? fmtLong(newExp) : null }) };
  // Cupom de afiliado: a comissão nasce junto com a aprovação (mesma transação) e fica em carência até o fim do prazo de reembolso.
  // Um defeito na comissão nunca pode impedir o acesso de quem pagou: roda em um ponto de retorno e, se falhar, só registra o erro.
  let aff = null; let affFailed = false;
  try { await c.query('SAVEPOINT aff_commission'); aff = await AFF.onApproved(c, row, user); await c.query('RELEASE SAVEPOINT aff_commission'); }
  catch (e) { await c.query('ROLLBACK TO SAVEPOINT aff_commission'); affFailed = true; log.error('comissao_falhou', { order: o.id, error: e.message }); }
  const affAudit = affFailed ? [['affiliate_commission_failed', { order: o.id }]] : aff && aff.commission ? [['affiliate_commission_created', { order: o.id, affiliate: aff.commission.affiliate_id, commission: aff.commission.id, valor: aff.commission.amount_cents, pct: Number(aff.commission.pct) }]]
    : aff && aff.skipped ? [['affiliate_commission_skipped', { order: o.id, affiliate: aff.affiliate, motivo: aff.skipped }]] : [];
  return { order: row, user, mails: [mail], audits: [['order_approved', { order: o.id, course: course.id, user: user.id, valor: paid, novo_usuario: !!password }], ...(couponFlag ? [[couponFlag, { order: o.id, coupon: o.coupon_id, user: user.id }]] : []), ...affAudit] };
}

// Encerra o acesso ligado a este pedido. Renovação volta ao prazo anterior; compra inicial cancela a matrícula.
async function cancelAccess(c, o) {
  if (!o.user_id) return false;
  const course = (await c.query('SELECT access_type, access_months FROM courses WHERE id = $1', [o.course_id])).rows[0];
  // Há outra compra aprovada do mesmo curso depois desta? Então só tira o período desta, sem cancelar a matrícula.
  const later = (await c.query("SELECT count(*)::int AS n FROM orders WHERE user_id = $1 AND course_id = $2 AND status = 'approved' AND id <> $3 AND approved_at >= $4", [o.user_id, o.course_id, o.id, o.approved_at])).rows[0].n;
  if (later > 0) {
    if (course && course.access_type === 'months') await c.query("UPDATE enrollments SET expires_at = expires_at - ($3 || ' months')::interval WHERE user_id = $1 AND course_id = $2 AND status = 'active' AND expires_at IS NOT NULL", [o.user_id, o.course_id, String(course.access_months)]);
    return false;
  }
  if (o.prev_enrollment && o.prev_expires_at) {
    await c.query("UPDATE enrollments SET expires_at = $3 WHERE user_id = $1 AND course_id = $2 AND status = 'active'", [o.user_id, o.course_id, o.prev_expires_at]);
    return false;
  }
  await c.query("UPDATE enrollments SET status = 'cancelled', cancelled_at = now() WHERE user_id = $1 AND course_id = $2 AND status = 'active'", [o.user_id, o.course_id]);
  await require('./downloads').resetFor(c, o.user_id, o.course_id);
  return true;
}

// ---------- reembolso ----------
const canRequestRefund = (o, now = new Date()) => o.status === 'approved' && o.refund_until && new Date(o.refund_until) > now;

async function requestRefund(cfg, bg, req, order, reason) {
  const course = await C.byId(order.course_id);
  const rr = await db.q('INSERT INTO refund_requests (order_id, requested_by, reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id', [order.id, req.user.id, String(reason || '').trim().slice(0, 500)]);
  if (!rr.rowCount) return false;
  await notify.toAdmins({ kind: 'refund', title: 'Pedido de reembolso de ' + req.user.name, body: course.title, link: '/admin/vendas', key: 'refund:' + rr.rows[0].id, subject: req.user.id });
  await audit(req, 'refund_requested', { entity: 'order', entityId: order.id, meta: { course: order.course_id } });
  const admins = (await db.q("SELECT email FROM users WHERE role = 'admin' AND status = 'active'")).rows;
  for (const a of admins) bg(mailer.send(cfg, { to: a.email, ...emails.refundRequested(cfg, { student: req.user, course, reason: String(reason || '').trim().slice(0, 500), orderId: order.id }) }));
  return true;
}

// Aprovação do administrador: estorna no gateway e encerra o acesso. Seguro para repetir (idempotência no gateway).
async function approveRefund(cfg, bg, req, orderId, { requestId = null, note = '' } = {}) {
  const o = (await db.q('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
  if (!o || o.status !== 'approved') throw Object.assign(new Error('Só dá para reembolsar um pagamento aprovado.'), { status: 400, expose: true });
  if (!o.provider_payment_id) throw Object.assign(new Error('Este pedido não tem pagamento registrado no gateway.'), { status: 400, expose: true });
  const gw = payments.forCfg(cfg);
  let r;
  try { r = await gw.refund(cfg, { paymentId: o.provider_payment_id, idem: `refund-${o.public_id}` }); }
  catch (e) {
    log.error('reembolso_gateway_falhou', { order: o.id, error: e.message });
    if (requestId) await db.q("UPDATE refund_requests SET status = 'failed', decided_by = $2, decided_at = now(), admin_note = $3 WHERE id = $1", [requestId, req.user.id, 'Falha no gateway: ' + e.message.slice(0, 200)]);
    throw Object.assign(new Error('O Mercado Pago não conseguiu devolver agora. Tente de novo ou devolva pelo painel dele.'), { status: 502, expose: true });
  }
  if (r.status !== 'approved') {
    await db.q("UPDATE refund_requests SET provider_refund_id = $2, admin_note = $3 WHERE order_id = $1 AND status IN ('requested','failed')", [o.id, r.id, 'Aguardando confirmação do Mercado Pago']);
    return { result: 'reembolso_pendente', orderId: o.id };
  }
  await db.q(`UPDATE refund_requests SET status = 'approved', decided_by = $2, decided_at = now(), admin_note = $3, provider_refund_id = $4 WHERE order_id = $1 AND status IN ('requested','failed')`, [o.id, req.user.id, String(note).slice(0, 300), r.id]);
  await audit(req, 'refund_approved', { entity: 'order', entityId: o.id, meta: { course: o.course_id, refund: r.id } });
  // Aplica na hora (o webhook de reembolso chegará depois e não muda nada, pois o pedido já estará reembolsado).
  const pay = { id: o.provider_payment_id, status: 'refunded', rawStatus: 'refunded', detail: null, reference: o.public_id, amountCents: o.price_cents, paidCents: o.paid_cents || o.price_cents };
  return applyPayment(cfg, bg, o.id, pay, req);
}

async function rejectRefund(cfg, bg, req, requestId, note) {
  const rr = (await db.q("UPDATE refund_requests SET status = 'rejected', decided_by = $2, decided_at = now(), admin_note = $3 WHERE id = $1 AND status IN ('requested','failed') RETURNING *", [requestId, req.user.id, String(note || '').slice(0, 300)])).rows[0];
  if (!rr) return false;
  const o = (await db.q('SELECT * FROM orders WHERE id = $1', [rr.order_id])).rows[0];
  const user = (await db.q('SELECT * FROM users WHERE id = $1', [o.user_id])).rows[0];
  const course = await C.byId(o.course_id);
  await audit(req, 'refund_rejected', { entity: 'order', entityId: o.id });
  await notify.resolveRefundsOf(rr.order_id);
  if (user) await notify.add(user.id, { kind: 'refund', title: 'Seu pedido de reembolso foi analisado', body: course.title, link: '/pagamentos', key: 'refundno:' + rr.id });
  if (user) bg(mailer.send(cfg, { to: user.email, ...emails.refundRejected(cfg, { name: user.name, course, note: rr.admin_note }) }));
  return true;
}

// ---------- Pix vencido ----------
// Marca como vencidos os Pix sem pagamento e avisa o comprador uma única vez, com o link para tentar de novo.
async function sweepExpired(cfg, bg) {
  const cand = (await db.q(`SELECT * FROM orders WHERE status = 'pending' AND method = 'pix' AND pix_expires_at IS NOT NULL AND pix_expires_at < now() - interval '1 minute'`)).rows;
  let n = 0;
  for (const c0 of cand) {
    // Antes de vencer, confere no gateway: o aluno pode ter pago no último minuto e o webhook ter se perdido.
    if (c0.provider_payment_id) { try { await processPayment(cfg, bg, c0.provider_payment_id, null); } catch (e) { log.warn('varredura_consulta_falhou', { order: c0.id, error: e.message }); continue; } }
    const o = (await db.q(`UPDATE orders SET status = 'expired', status_detail = 'pix_expirado', updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING *`, [c0.id])).rows[0];
    if (!o) continue;
    n++;
    const course = await C.byId(o.course_id);
    if (!course) continue;
    bg(mailer.send(cfg, { to: o.buyer.email, ...emails.pixExpired(cfg, { name: o.buyer.name, course, retryUrl: `${cfg.baseUrl}/checkout/${course.slug}` }) }));
    await db.q('UPDATE orders SET reminder_sent_at = now() WHERE id = $1', [o.id]);
  }
  return n;
}

module.exports = { pricing, checkCoupon, buyState, publishedDocs, createOrder, processPayment, applyPayment, canRequestRefund, requestRefund, approveRefund, rejectRefund, sweepExpired, newPublicId };
