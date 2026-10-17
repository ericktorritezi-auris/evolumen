'use strict';
// Apoio aos testes: sobe o app contra um Postgres de teste e oferece um "navegador" com cookies.
const config = require('../src/config');
const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { seed } = require('../src/seed');
const { createApp } = require('../src/server');
const mailer = require('../src/mailer');

const ADMIN = { email: 'erick@example.com', password: 'Provisoria123' };

function testEnv(extra = {}) {
  return {
    APP_ENV: 'test', MAIL_TRANSPORT: 'memory', LOG_LEVEL: 'error',
    DATABASE_URL: process.env.TEST_DATABASE_URL, SESSION_SECRET: 'x'.repeat(48),
    ADMIN_EMAIL: ADMIN.email, ADMIN_INITIAL_PASSWORD: ADMIN.password,
    RESEND_FROM_EMAIL: 'noreply@belleplanner.com.br', APP_BASE_URL: 'http://localhost:3000', ...extra,
  };
}

async function boot(extra) {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Defina TEST_DATABASE_URL para rodar os testes.');
  const cfg = config.load(testEnv(extra));
  const pool = db.connect(cfg);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  await seed(pool, cfg);
  const app = createApp(cfg);
  const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = async () => { await app.locals.idle(); await new Promise((ok) => server.close(ok)); await db.close(); };
  return { cfg, app, base, close, pool };
}

class Browser {
  constructor(base) { this.base = base; this.jar = {}; this.ua = 'Mozilla/5.0 (X11; Linux) Chrome/120 Safari/537'; }
  cookieHeader() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';'); const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim();
      if (!v || attrs.some((a) => /max-age=0|expires=Thu, 01 Jan 1970/i.test(a))) delete this.jar[k]; else this.jar[k] = v;
    }
  }
  async req(method, path, form, headers = {}) {
    const res = await fetch(this.base + path, {
      method, redirect: 'manual',
      headers: { cookie: this.cookieHeader(), 'user-agent': this.ua, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    this.store(res);
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
  }
  get(path) { return this.req('GET', path); }
  async csrf(path = '/entrar') {
    const r = await this.get(path);
    const m = r.text.match(/name="_csrf" value="([a-f0-9]{64})"/);
    if (!m) throw new Error('token CSRF não encontrado em ' + path + ' (status ' + r.status + ')');
    return m[1];
  }
  async post(path, form, from) {
    const _csrf = await this.csrf(from || path);
    return this.req('POST', path, { _csrf, ...form });
  }
  async upload(path, fields, file, { csrfFrom, csrf = true } = {}) {
    const token = csrf ? await this.csrf(csrfFrom) : '';
    const fd = new FormData();
    if (csrf) fd.append('_csrf', token);
    for (const [k, v] of Object.entries(fields || {})) fd.append(k, v);
    if (file) fd.append('arquivo', new Blob([file.buffer], { type: file.type || 'application/octet-stream' }), file.name);
    const res = await fetch(this.base + path, { method: 'POST', redirect: 'manual', body: fd, headers: { cookie: this.cookieHeader(), 'user-agent': this.ua } });
    this.store(res);
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  }
  async login(email, password) { return this.post('/entrar', { email, password }, '/entrar'); }
}

// Entra como administrador e completa o primeiro acesso.
async function adminReady(t) {
  const b = new Browser(t.base);
  const r = await b.login(ADMIN.email, ADMIN.password);
  if (r.location !== '/primeiro-acesso') throw new Error('admin não foi para o primeiro acesso: ' + r.status);
  const f = await b.post('/primeiro-acesso', { current: ADMIN.password, password: 'NovaSenha2026', confirm: 'NovaSenha2026' });
  if (f.status !== 303) throw new Error('primeiro acesso falhou: ' + f.status);
  return b;
}

let seq = 0;
async function makeStudent(t, over = {}) {
  const bcrypt = require('bcryptjs');
  const u = { email: 'aluna@example.com', name: 'Maria Souza', password: 'SenhaAluna1', ...over };
  const hash = await bcrypt.hash(u.password, 4);
  const r = await t.pool.query("INSERT INTO users (email, password_hash, role, name, cpf) VALUES ($1,$2,'student',$3,$4) RETURNING *", [u.email, hash, u.name, u.cpf || String(10000000000 + (++seq))]);
  return { ...u, id: r.rows[0].id };
}

module.exports = { boot, Browser, adminReady, makeStudent, ADMIN, mailer, testEnv };
