'use strict';
// Pagamento simulado: só existe em teste e staging (a configuração proíbe em produção).
// O administrador "paga" pela tela do simulador, e o resultado passa pelo mesmo tratamento do webhook real.
const QRCode = require('qrcode');
const db = require('../db');

module.exports = {
  name: 'simulated',

  async createPix(cfg, { order }) {
    const code = `00020126SIMULADO${order.public_id}5204000053039865802BR`;
    const qr = await QRCode.toDataURL(code, { margin: 1, width: 280 });
    return { paymentId: `SIM-${order.public_id}`, code, qrBase64: qr.replace(/^data:image\/png;base64,/, ''), expiresAt: new Date(Date.now() + cfg.pixMinutes * 60000) };
  },

  async createCheckout(cfg, { order }) { return { ref: `SIMPREF-${order.public_id}`, url: null, paymentId: `SIM-${order.public_id}` }; },

  async getPayment(cfg, paymentId) {
    const m = /^SIM-([A-Za-z0-9]+)$/.exec(String(paymentId));
    if (!m) return null;
    const o = (await db.q('SELECT * FROM orders WHERE public_id = $1 AND provider = $2', [m[1], 'simulated'])).rows[0];
    if (!o) return null;
    const st = o.sim_status || 'pending';
    return { id: String(paymentId), status: st, rawStatus: st, detail: st === 'cancelled' ? 'expired' : null, reference: o.public_id, amountCents: o.price_cents, paidCents: o.price_cents, installments: o.method === 'card' ? 1 : null, method: o.method === 'pix' ? 'bank_transfer' : 'credit_card' };
  },

  async refund(cfg, { paymentId }) {
    const m = /^SIM-([A-Za-z0-9]+)$/.exec(String(paymentId));
    if (m) await db.q("UPDATE orders SET sim_status = 'refunded' WHERE public_id = $1 AND provider = 'simulated'", [m[1]]);
    return { id: `SIMREF-${paymentId}`, status: 'approved' };
  },

  verifyWebhook() { return false; },
  paymentIdFrom() { return null; },
};
