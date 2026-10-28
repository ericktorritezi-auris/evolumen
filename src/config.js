'use strict';
// Configuração única do sistema. Lê só variáveis de ambiente; nenhum segredo fica no código.
const fs = require('fs');
const path = require('path');

process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

const version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8'));

function detectEnv(env) {
  if (env.APP_ENV) { const a = env.APP_ENV.toLowerCase(); return a === 'prod' ? 'production' : a; }
  const r = (env.RAILWAY_ENVIRONMENT_NAME || '').toLowerCase();
  if (r === 'production') return 'production';
  if (r) return 'staging';
  return 'staging';
}

function load(env = process.env) {
  const port = Number(env.PORT || 3000);
  const appEnv = detectEnv(env);
  const baseUrl = (env.APP_BASE_URL
    || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`)).replace(/\/+$/, '');
  const isProd = appEnv === 'production';
  // Ambiente declarado de verdade (APP_ENV ou Railway). Sem isso, nunca se liga o pagamento simulado.
  const envExplicit = !!(env.APP_ENV || env.RAILWAY_ENVIRONMENT_NAME);
  return {
    version,
    appEnv,
    isProd,
    envExplicit,
    isTest: appEnv === 'test',
    port,
    baseUrl,
    secureCookies: baseUrl.startsWith('https://'),
    databaseUrl: env.DATABASE_URL || '',
    databaseSsl: env.DATABASE_SSL === 'true' || /rlwy\.net/.test(env.DATABASE_URL || ''),
    sessionSecret: env.SESSION_SECRET || '',
    adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
    adminInitialPassword: env.ADMIN_INITIAL_PASSWORD || '',
    resendApiKey: env.RESEND_API_KEY || '',
    resendFrom: env.RESEND_FROM_EMAIL || '',
    mailTransport: appEnv === 'test' && env.MAIL_TRANSPORT === 'memory' ? 'memory' : 'resend',
    logLevel: env.LOG_LEVEL || 'info',
    // Pagamentos. O modo simulado só existe fora de produção; em produção a configuração recusa ligá-lo.
    mpAccessToken: (env.MP_ACCESS_TOKEN || '').trim(),
    mpWebhookSecret: (env.MP_WEBHOOK_SECRET || '').trim(),
    paymentProvider: ((env.PAYMENT_PROVIDER || '').trim().toLowerCase()) || (appEnv === 'production' || env.MP_ACCESS_TOKEN || !(envExplicit || appEnv === 'test') ? 'mercadopago' : 'simulated'),
    // Sem credencial do Mercado Pago em produção, o checkout fica fechado ("em breve"), sem derrubar o site.
    paymentsEnabled: ((env.PAYMENT_PROVIDER || '').trim().toLowerCase() === 'simulated' && appEnv !== 'production' && (envExplicit || appEnv === 'test')) || !!(env.MP_ACCESS_TOKEN && (env.PAYMENT_PROVIDER || 'mercadopago').toLowerCase() === 'mercadopago') || (appEnv !== 'production' && (envExplicit || appEnv === 'test') && !env.MP_ACCESS_TOKEN && !env.PAYMENT_PROVIDER),
    // Pasta de arquivos grandes: o volume do Railway (caminho vem sozinho) ou FILES_DIR (testes e desenvolvimento).
    filesDir: (env.FILES_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || '').trim(),
    pixMinutes: 30,
    refundDays: 7,
    sessionDays: 30,
    sessionIdleDays: 14,
    lockAfterFailures: 5,
    lockMinutes: 15,
    resetTokenMinutes: 60,
    emailCodeMinutes: 15,
    emailCodeMaxAttempts: 5,
    bcryptCost: appEnv === 'test' ? 4 : 12,
  };
}

// Erros de configuração que impedem o sistema de subir de forma segura.
function problems(cfg) {
  const p = [];
  if (!cfg.databaseUrl) p.push('DATABASE_URL não definida');
  if (!cfg.sessionSecret || cfg.sessionSecret.length < 32) p.push('SESSION_SECRET ausente ou com menos de 32 caracteres');
  if (cfg.isProd) {
    if (!cfg.baseUrl.startsWith('https://')) p.push('Em produção, APP_BASE_URL (ou o domínio público do Railway) precisa começar com https://');
    if (!cfg.resendApiKey || !cfg.resendFrom) p.push('Em produção, RESEND_API_KEY e RESEND_FROM_EMAIL são obrigatórias');
    if (cfg.paymentProvider !== 'mercadopago') p.push('Em produção, o pagamento simulado é proibido: use PAYMENT_PROVIDER=mercadopago (ou deixe em branco)');
    if (cfg.mpAccessToken && !cfg.mpWebhookSecret) p.push('Em produção, com MP_ACCESS_TOKEN definido, MP_WEBHOOK_SECRET (assinatura secreta do webhook) também é obrigatória');
  }
  if (cfg.paymentProvider === 'simulated' && !cfg.isTest && !cfg.envExplicit) p.push('O pagamento simulado exige APP_ENV=staging (ambiente declarado)');
  if (!['mercadopago', 'simulated'].includes(cfg.paymentProvider)) p.push('PAYMENT_PROVIDER deve ser mercadopago ou simulated');
  if (cfg.paymentProvider === 'mercadopago' && !cfg.isProd && !cfg.isTest && cfg.envExplicit && !cfg.mpAccessToken) p.push('PAYMENT_PROVIDER=mercadopago exige MP_ACCESS_TOKEN');
  return p;
}

module.exports = { load, problems, detectEnv };
