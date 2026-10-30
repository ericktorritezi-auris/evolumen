'use strict';
// Programa de afiliados (1.1.1, parte 1: o administrador controla tudo).
//  - Afiliado: cadastro com nome, e-mail e telefone. Pode ser inativado (o histórico fica).
//  - Comissão: nasce quando o pagamento de um pedido com cupom de afiliado é aprovado. Base = preço do produto já com o
//    desconto do cupom (orders.price_cents, sem juros de parcelamento). O percentual do cupom fica gravado na venda.
//  - Carência: a comissão fica "em carência" até o fim do prazo de reembolso (orders.refund_until); depois está "liberada".
//  - Reembolso ou estorno cancela a comissão. Se o estorno vier depois do repasse, o saldo do afiliado fica negativo.
//  - Saldo a repassar = liberadas − repasses lançados (repasses anulados não contam).
//  - Quem compra com o próprio cupom não gera comissão. Afiliado inativo não gera comissão nova.
const db = require('./db');
const V = require('./validation');
const C = require('./courses');

const DAY = 86400000;
const lower = (s) => String(s || '').trim().toLowerCase();
const num = (v) => Number(v || 0);
// 12.50 → "12,5%" (sem zeros sobrando, com vírgula)
const pctLabel = (v) => String(Number(v)).replace('.', ',') + '%';

// ---------- cadastro ----------
function parse(b) {
  const errors = {};
  const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (name.length < 3) errors.name = 'Informe o nome completo.';
  const email = V.normalizeEmail(b.email);
  if (!email) errors.email = 'Informe um e-mail válido.';
  const phone = V.digits(b.phone);
  if (phone.length < 10 || phone.length > 11) errors.phone = 'Telefone com DDD, 10 ou 11 números.';
  return { errors, values: { name, email, phone, note: String(b.note || '').trim().slice(0, 300) } };
}

// Percentual da comissão: 0,01 a 100, até duas casas. Aceita vírgula.
function parsePct(v) {
  const s = String(v == null ? '' : v).trim().replace('%', '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 100 ? n : null;
}

const byId = async (id) => (/^\d{1,12}$/.test(String(id)) ? (await db.q('SELECT * FROM affiliates WHERE id = $1', [id])).rows[0] || null : null);
const activeList = async () => (await db.q("SELECT id, name, email FROM affiliates WHERE status = 'active' ORDER BY name")).rows;

async function emailTaken(email, exceptId = null) {
  return (await db.q('SELECT 1 FROM affiliates WHERE lower(email) = $1 AND ($2::bigint IS NULL OR id <> $2::bigint)', [email, exceptId])).rowCount > 0;
}

// ---------- comissão ----------
// Valor da comissão em centavos, com contas inteiras (sem erro de arredondamento do ponto flutuante).
const commissionOf = (baseCents, pct) => Math.round((baseCents * Math.round(Number(pct) * 100)) / 10000);

// Chamado dentro da transação que aprova o pedido. Devolve { commission } ou { skipped: motivo } ou null (pedido sem cupom de afiliado).
async function onApproved(c, order, user) {
  if (!order.coupon_id) return null;
  const cp = (await c.query('SELECT id, affiliate_id, commission_pct FROM coupons WHERE id = $1', [order.coupon_id])).rows[0];
  if (!cp || !cp.affiliate_id || cp.commission_pct == null) return null;
  const af = (await c.query('SELECT * FROM affiliates WHERE id = $1', [cp.affiliate_id])).rows[0];
  if (!af) return null;
  if (af.status !== 'active') return { skipped: 'afiliado_inativo', affiliate: af.id };
  const mails = [lower(order.buyer && order.buyer.email), lower(user && user.email)].filter(Boolean);
  if (mails.includes(lower(af.email)) || (af.user_id && user && String(af.user_id) === String(user.id))) return { skipped: 'compra_propria', affiliate: af.id };
  const base = Number(order.price_cents);
  const amount = commissionOf(base, cp.commission_pct);
  if (!(base > 0)) return null;
  if (!(amount > 0)) return { skipped: 'valor_minimo', affiliate: af.id };
  const r = await c.query(`INSERT INTO commissions (affiliate_id, order_id, coupon_id, base_cents, pct, amount_cents, release_at)
    VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now())) ON CONFLICT (order_id) DO NOTHING RETURNING *`,
  [af.id, order.id, cp.id, base, cp.commission_pct, amount, order.refund_until || null]);
  return r.rows[0] ? { commission: r.rows[0] } : null;
}

// Reembolso ou estorno: cancela a comissão do pedido (se houver e ainda estiver valendo).
async function cancelFor(c, orderId, reason) {
  const r = await c.query("UPDATE commissions SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2 WHERE order_id = $1 AND status = 'active' RETURNING *", [orderId, String(reason || '').slice(0, 120)]);
  return r.rows[0] || null;
}

// ---------- situação e totais ----------
const phaseOf = (cm, now = new Date()) => (cm.status === 'cancelled' || ['refunded', 'charged_back'].includes(cm.order_status) ? 'cancelled' : cm.refund_open ? 'review' : new Date(cm.release_at) > now ? 'grace' : 'released');
const daysLeft = (cm, now = new Date()) => Math.max(1, Math.ceil((new Date(cm.release_at) - now) / DAY));
const PHASE_LABEL = { grace: 'Em carência', review: 'Em análise (reembolso pedido)', released: 'Liberada', cancelled: 'Cancelada' };

const OPEN_REFUND = "EXISTS (SELECT 1 FROM refund_requests rr WHERE rr.order_id = m.order_id AND rr.status IN ('requested','failed'))";
const CM = (cond) => `(SELECT COALESCE(sum(m.amount_cents),0) FROM commissions m JOIN orders o ON o.id = m.order_id WHERE m.affiliate_id = a.id AND ${cond})::bigint`;
// Só conta como a receber a comissão de pedido ainda aprovado. Pedido com reembolso solicitado não libera até ser decidido.
const TOTALS = `
  ${CM(`m.status = 'active' AND o.status = 'approved' AND (m.release_at > now() OR ${OPEN_REFUND})`)} AS grace,
  ${CM(`m.status = 'active' AND o.status = 'approved' AND m.release_at <= now() AND NOT ${OPEN_REFUND}`)} AS released,
  ${CM("(m.status = 'cancelled' OR o.status IN ('refunded','charged_back'))")} AS cancelled,
  COALESCE((SELECT sum(p.amount_cents) FROM affiliate_payouts p WHERE p.affiliate_id = a.id AND p.voided_at IS NULL),0)::bigint AS paid,
  (SELECT count(*)::int FROM commissions m WHERE m.affiliate_id = a.id) AS sales,
  (SELECT count(*)::int FROM coupons k WHERE k.affiliate_id = a.id) AS coupons`;

const withBalance = (r) => {
  const o = { ...r };
  for (const k of ['grace', 'released', 'cancelled', 'paid']) o[k] = num(r[k]);
  o.balance = o.released - o.paid;
  return o;
};

async function list() {
  const rows = (await db.q(`SELECT a.*, ${TOTALS} FROM affiliates a ORDER BY (a.status = 'active') DESC, a.name`)).rows.map(withBalance);
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  return { rows, totals: { grace: sum('grace'), released: sum('released'), cancelled: sum('cancelled'), paid: sum('paid'), balance: sum('balance'), sales: sum('sales'), negative: rows.filter((r) => r.balance < 0).length } };
}
async function detail(id) {
  const r = (await db.q(`SELECT a.*, ${TOTALS} FROM affiliates a WHERE a.id = $1`, [id])).rows[0];
  return r ? withBalance(r) : null;
}

const SALES_SQL = `SELECT m.*, o.public_id, o.approved_at, o.status AS order_status, co.title AS course_title, cp.code AS coupon_code,
    a.name AS affiliate_name, o.buyer->>'name' AS buyer_name,
    EXISTS (SELECT 1 FROM refund_requests rr WHERE rr.order_id = m.order_id AND rr.status IN ('requested','failed')) AS refund_open
  FROM commissions m JOIN orders o ON o.id = m.order_id JOIN courses co ON co.id = o.course_id JOIN coupons cp ON cp.id = m.coupon_id JOIN affiliates a ON a.id = m.affiliate_id`;
const salesOf = async (affiliateId, limit = 300) => (await db.q(`${SALES_SQL} WHERE m.affiliate_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2`, [affiliateId, limit])).rows;
const salesAll = async (limit = 5000) => (await db.q(`${SALES_SQL} ORDER BY m.created_at DESC, m.id DESC LIMIT $1`, [limit])).rows;
const payoutsOf = async (affiliateId) => (await db.q(`SELECT p.*, u.name AS by_name, v.name AS voided_name FROM affiliate_payouts p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN users v ON v.id = p.voided_by
  WHERE p.affiliate_id = $1 ORDER BY p.paid_on DESC, p.id DESC`, [affiliateId])).rows;
const couponsOf = async (affiliateId) => (await db.q(`SELECT k.id, k.code, k.status, k.commission_pct, k.kind, k.percent, k.amount_cents,
    (SELECT count(*)::int FROM commissions m WHERE m.coupon_id = k.id) AS sales FROM coupons k WHERE k.affiliate_id = $1 ORDER BY k.created_at DESC`, [affiliateId])).rows;

// ---------- conta e painel do afiliado (1.2.0) ----------
const byUser = async (userId) => (/^\d{1,12}$/.test(String(userId)) ? (await db.q('SELECT * FROM affiliates WHERE user_id = $1', [userId])).rows[0] || null : null);

// Nome abreviado ("Ana L."): o afiliado nunca vê o nome completo, e-mail, telefone ou CPF do comprador.
function shortName(n) {
  const p = String(n || '').normalize('NFC').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return 'Aluno';
  return p.length > 1 ? `${p[0]} ${Array.from(p[p.length - 1])[0].toLocaleUpperCase('pt-BR')}.` : p[0];
}

// Só os campos que o afiliado pode ver (lista fechada). Nada de pedido, comprador completo, e-mail ou observação interna.
async function panelSales(affiliateId, limit = 200) {
  const rows = await salesOf(affiliateId, limit);
  return rows.map((s) => ({ approved_at: s.approved_at, course_title: s.course_title, coupon_code: s.coupon_code, buyer: shortName(s.buyer_name),
    base_cents: s.base_cents, pct: s.pct, amount_cents: s.amount_cents, release_at: s.release_at, status: s.status, order_status: s.order_status, refund_open: s.refund_open, cancel_reason: null }));
}
async function panelPayouts(affiliateId) {
  return (await db.q('SELECT paid_on, amount_cents FROM affiliate_payouts WHERE affiliate_id = $1 AND voided_at IS NULL ORDER BY paid_on DESC, id DESC LIMIT 200', [affiliateId])).rows;
}
const panelCoupons = async (affiliateId) => (await db.q(`SELECT k.id, k.code, k.status, k.commission_pct, k.kind, k.percent, k.amount_cents,
    (SELECT count(*)::int FROM commissions m WHERE m.coupon_id = k.id) AS sales FROM coupons k WHERE k.affiliate_id = $1 ORDER BY k.created_at DESC`, [affiliateId])).rows;

// Situação do acesso ao painel, para a tela do administrador.
async function accessInfo(a) {
  if (!a.user_id) return null;
  const u = (await db.q('SELECT id, email, must_change_password, status FROM users WHERE id = $1', [a.user_id])).rows[0];
  if (!u) return null;
  const doc = (await db.q("SELECT 1 FROM legal_documents WHERE doc_type = 'affiliate' AND status = 'published' LIMIT 1")).rowCount > 0;
  const acc = (await db.q("SELECT version, accepted_at FROM acceptances WHERE user_id = $1 AND doc_type = 'affiliate' ORDER BY accepted_at DESC LIMIT 1", [a.user_id])).rows[0] || null;
  const student = (await db.q("SELECT 1 FROM enrollments WHERE user_id = $1 AND status = 'active' LIMIT 1", [a.user_id])).rowCount > 0;
  return { user: u, firstAccessPending: !!u.must_change_password, termPublished: doc, term: acc, alsoStudent: student };
}

// Comissões que acabaram de ser liberadas e ainda não avisaram o afiliado (só de quem já tem conta e só depois do convite).
// A chave do aviso garante um único aviso por comissão, mesmo que a rotina rode várias vezes.
async function notifyReleased(notify, now = new Date()) {
  const rows = (await db.q(`SELECT m.id, m.amount_cents, a.user_id, co.title AS course_title
    FROM commissions m JOIN orders o ON o.id = m.order_id JOIN affiliates a ON a.id = m.affiliate_id JOIN courses co ON co.id = o.course_id
    WHERE m.status = 'active' AND o.status = 'approved' AND m.release_at <= $1 AND a.user_id IS NOT NULL AND a.status = 'active'
      AND a.invited_at IS NOT NULL AND m.release_at >= a.invited_at AND m.release_at > $1::timestamptz - interval '30 days' AND NOT ${OPEN_REFUND}
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = a.user_id AND n.ref_key = 'affcom:' || m.id)
    ORDER BY m.id LIMIT 500`, [now.toISOString()])).rows;
  let n = 0;
  for (const r of rows) {
    const id = await notify.add(r.user_id, { kind: 'affiliate', title: 'Comissão liberada', body: `${C.brl(r.amount_cents)} · ${r.course_title}`, link: '/afiliado', key: `affcom:${r.id}` });
    if (id) n++;
  }
  return n;
}

// ---------- repasses ----------
function parsePayout(b, today) {
  const errors = {};
  const m = C.parseMoney(b.amount);
  if (m.error || m.empty || !(m.cents > 0)) errors.amount = 'Informe um valor em reais maior que zero, como 150,00.';
  const paidOn = String(b.paid_on || '').trim();
  if (!C.dateOnly(paidOn)) errors.paid_on = 'Informe a data do repasse.';
  else if (paidOn > today) errors.paid_on = 'A data do repasse não pode estar no futuro.';
  return { errors, values: { cents: m.cents, paid_on: paidOn, note: String(b.note || '').trim().slice(0, 300) } };
}

// ---------- CSV ----------
const brlPlain = (cents) => (num(cents) / 100).toFixed(2).replace('.', ',');
const dateBr = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
function csv(rows, cell, { withAffiliate = false } = {}) {
  const head = [...(withAffiliate ? ['Afiliado'] : []), 'Aprovação', 'Pedido', 'Produto', 'Cupom', 'Comprador', 'Valor base (R$)', 'Percentual', 'Comissão (R$)', 'Situação', 'Liberação'];
  const lines = [head.join(';')].concat(rows.map((r) => [...(withAffiliate ? [r.affiliate_name] : []), dateBr(r.approved_at), r.public_id, r.course_title, r.coupon_code, r.buyer_name,
    brlPlain(r.base_cents), pctLabel(r.pct), brlPlain(r.amount_cents), PHASE_LABEL[phaseOf(r)], phaseOf(r) === 'cancelled' ? '' : dateBr(r.release_at)].map(cell).join(';')));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { accessInfo, byUser, shortName, panelSales, panelPayouts, panelCoupons, notifyReleased, pctLabel, parse, parsePct, parsePayout, byId, activeList, emailTaken, commissionOf, onApproved, cancelFor, phaseOf, daysLeft, PHASE_LABEL, list, detail, salesOf, salesAll, payoutsOf, couponsOf, csv };
