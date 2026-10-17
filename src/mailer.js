'use strict';
// Envio de e-mails pelo Resend. Em teste, guarda na memória em vez de enviar.
const db = require('./db');
const log = require('./logger');

const memory = [];
const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();

function fromHeader(cfg) {
  const f = cfg.resendFrom.trim();
  return f.includes('<') ? f : `EvoLumen Academy <${f}>`;
}

async function logRow(to, subject, template, status, providerId, error) {
  try {
    await db.q('INSERT INTO email_log (to_email, subject, template, status, provider_id, error) VALUES ($1,$2,$3,$4,$5,$6)',
      [to, subject, template, status, providerId || null, error ? String(error).slice(0, 300) : null]);
  } catch (e) { log.error('email_log_falhou', { error: e.message }); }
}

async function send(cfg, { to, subject, html, text, template }) {
  to = clean(to); subject = clean(subject);
  if (cfg.mailTransport === 'memory') {
    memory.push({ to, subject, html, text, template });
    await logRow(to, subject, template, 'sent', 'memory');
    return { ok: true };
  }
  if (!cfg.resendApiKey || !cfg.resendFrom) {
    log.warn('email_nao_enviado_sem_configuracao', { template });
    await logRow(to, subject, template, 'skipped', null, 'RESEND_API_KEY ou RESEND_FROM_EMAIL ausente');
    return { ok: false, skipped: true };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromHeader(cfg), to: [to], subject, html, text }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Resend ${res.status}: ${data.message || data.name || 'erro'}`);
    await logRow(to, subject, template, 'sent', data.id);
    return { ok: true, id: data.id };
  } catch (e) {
    log.error('email_falhou', { template, error: e.message });
    await logRow(to, subject, template, 'failed', null, e.message);
    return { ok: false, error: e.message };
  } finally { clearTimeout(timer); }
}

module.exports = { send, memory, fromHeader };
