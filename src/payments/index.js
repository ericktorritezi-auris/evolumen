'use strict';
// Camada de pagamento atrás de uma interface única (createPix, createCheckout, getPayment, refund, verifyWebhook).
// Trocar de gateway é trocar este arquivo, sem mexer no resto do sistema.
const mercadopago = require('./mercadopago');
const simulated = require('./simulated');

function forCfg(cfg) {
  if (cfg.paymentProvider === 'simulated') {
    if (cfg.isProd) throw new Error('Pagamento simulado é proibido em produção');
    return simulated;
  }
  return mercadopago;
}

module.exports = { forCfg, mercadopago, simulated };
