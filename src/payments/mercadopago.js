'use strict';
// Mercado Pago: cobrança avulsa por curso.
//  - Pix: criado pela API de pagamentos, com QR Code e "copia e cola" na nossa tela (validade de 30 minutos).
//  - Cartão: pago na página do próprio Mercado Pago (Checkout Pro). Dados de cartão nunca passam pelo nosso sistema.
// Nada aqui é confiado pelo corpo do webhook: o sistema sempre consulta o pagamento direto na API.
const crypto = require('crypto');

const API = 'https://api.mercadopago.com';

async function call(cfg, method, path, body, idem) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(API + path, {
      method, signal: ctrl.signal,
      headers: { Authorization: `Bearer ${cfg.mpAccessToken}`, 'Content-Type': 'application/json', ...(idem ? { 'X-Idempotency-Key': idem } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(`Mercado Pago ${res.status}: ${data.message || data.error || 'erro'}`); e.status = res.status; e.data = data; throw e; }
    return data;
  } finally { clearTimeout(timer); }
}

const money = (cents) => Math.round(cents) / 100;
const mpDate = (d) => new Date(d.getTime() - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00');

function payerOf(buyer) {
  const parts = String(buyer.name || '').trim().split(/\s+/);
  return {
    email: buyer.email, first_name: parts[0] || buyer.name, last_name: parts.slice(1).join(' ') || parts[0],
    ...(buyer.cpf ? { identification: { type: 'CPF', number: String(buyer.cpf).replace(/\D/g, '') } } : {}),
  };
}

const STATUS = { approved: 'approved', authorized: 'pending', pending: 'pending', in_process: 'pending', in_mediation: 'pending', rejected: 'refused', cancelled: 'cancelled', refunded: 'refunded', charged_back: 'charged_back' };

// Resposta do Mercado Pago -> formato único do sistema.
function normalize(p) {
  const status = STATUS[p.status] || 'pending';
  const total = p.transaction_details && p.transaction_details.total_paid_amount != null ? p.transaction_details.total_paid_amount : p.transaction_amount;
  return {
    id: String(p.id), status, rawStatus: p.status, detail: p.status_detail || null,
    reference: p.external_reference || null,
    amountCents: Math.round(Number(p.transaction_amount || 0) * 100),
    paidCents: Math.round(Number(total || 0) * 100),
    installments: p.installments || null,
    method: p.payment_type_id || null,
  };
}

module.exports = {
  name: 'mercadopago',

  async createPix(cfg, { order, course }) {
    const exp = new Date(Date.now() + cfg.pixMinutes * 60000);
    const p = await call(cfg, 'POST', '/v1/payments', {
      transaction_amount: money(order.price_cents),
      description: `${course.title}`.slice(0, 200),
      payment_method_id: 'pix',
      external_reference: order.public_id,
      notification_url: `${cfg.baseUrl}/webhooks/mercadopago`,
      date_of_expiration: mpDate(exp),
      payer: payerOf(order.buyer),
    }, `pix-${order.public_id}`);
    const td = (p.point_of_interaction && p.point_of_interaction.transaction_data) || {};
    if (!td.qr_code) throw new Error('Mercado Pago não devolveu o código Pix');
    return { paymentId: String(p.id), code: td.qr_code, qrBase64: td.qr_code_base64 || null, expiresAt: exp };
  },

  // Cartão: cria a "preferência" e devolve o endereço da página de pagamento do Mercado Pago.
  async createCheckout(cfg, { order, course }) {
    const back = `${cfg.baseUrl}/pedido/${order.public_id}`;
    const pref = await call(cfg, 'POST', '/checkout/preferences', {
      items: [{ id: String(course.id), title: String(course.title).slice(0, 120), quantity: 1, currency_id: 'BRL', unit_price: money(order.price_cents) }],
      payer: payerOf(order.buyer),
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }, { id: 'atm' }], installments: course.max_installments || 12 },
      back_urls: { success: back, pending: back, failure: back },
      auto_return: 'approved',
      external_reference: order.public_id,
      notification_url: `${cfg.baseUrl}/webhooks/mercadopago`,
      statement_descriptor: 'EVOLUMEN',
    }, `pref-${order.public_id}`);
    return { ref: String(pref.id), url: pref.init_point };
  },

  async getPayment(cfg, paymentId) {
    if (!/^\d{3,20}$/.test(String(paymentId))) return null;
    try { return normalize(await call(cfg, 'GET', `/v1/payments/${paymentId}`)); }
    catch (e) { if (e.status === 404) return null; throw e; }
  },

  // Reembolso total. A mesma chave de idempotência evita estornar duas vezes.
  async refund(cfg, { paymentId, idem }) {
    const r = await call(cfg, 'POST', `/v1/payments/${paymentId}/refunds`, {}, idem);
    return { id: String(r.id), status: r.status === 'approved' || r.status === 'refunded' || !r.status ? 'approved' : 'pending' };
  },

  // Confere a assinatura do webhook (cabeçalho x-signature). Sem segredo configurado, recusa.
  verifyWebhook(cfg, req) {
    if (!cfg.mpWebhookSecret) return false;
    const sig = String(req.get('x-signature') || '');
    const parts = Object.fromEntries(sig.split(',').map((x) => x.trim().split('=')).filter((x) => x.length === 2));
    if (!parts.ts || !parts.v1) return false;
    const dataId = String((req.query && req.query['data.id']) || (req.body && req.body.data && req.body.data.id) || '').toLowerCase();
    const reqId = String(req.get('x-request-id') || '');
    const manifest = `${dataId ? `id:${dataId};` : ''}${reqId ? `request-id:${reqId};` : ''}ts:${parts.ts};`;
    const mine = crypto.createHmac('sha256', cfg.mpWebhookSecret).update(manifest).digest('hex');
    const a = Buffer.from(mine); const b = Buffer.from(String(parts.v1));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },

  paymentIdFrom(req) {
    const b = req.body || {};
    const type = String(b.type || req.query.type || req.query.topic || '');
    if (type && !/payment/.test(type)) return null;
    const id = (b.data && b.data.id) || req.query['data.id'] || req.query.id;
    return id ? String(id) : null;
  },
};
