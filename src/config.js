'use strict';
// Configuração única do sistema. Lê só variáveis de ambiente; nenhum segredo fica no código.
const fs = require('fs');
const path = require('path');

process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

const version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8'));

function detectEnv(env) {
  if (env.APP_ENV) return env.APP_ENV.toLowerCase();
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
  return {
    version,
    appEnv,
    isProd,
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
  }
  return p;
}

module.exports = { load, problems, detectEnv };
