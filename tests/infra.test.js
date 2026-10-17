'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');
const config = require('../src/config');
const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { seed } = require('../src/seed');
const { testEnv } = require('./helpers');
const { menuFor } = require('../src/nav');

const root = path.join(__dirname, '..');

test('config: ambiente, URL e segredos obrigatórios', () => {
  assert.equal(config.load({ RAILWAY_ENVIRONMENT_NAME: 'production' }).isProd, true);
  assert.equal(config.load({ RAILWAY_ENVIRONMENT_NAME: 'staging' }).appEnv, 'staging');
  assert.equal(config.load({ RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' }).baseUrl, 'https://x.up.railway.app');
  assert.equal(config.load({ RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' }).secureCookies, true);
  assert.equal(config.problems(config.load({})).length, 2);
  assert.equal(config.problems(config.load({ DATABASE_URL: 'postgres://x', SESSION_SECRET: 'a'.repeat(32) })).length, 0);
  assert.equal(config.load({ APP_ENV: 'production', MAIL_TRANSPORT: 'memory' }).mailTransport, 'resend', 'e-mail em memória só em teste');
});

test('config de produção exige https e Resend', () => {
  const base = { APP_ENV: 'production', DATABASE_URL: 'postgres://x', SESSION_SECRET: 'a'.repeat(32) };
  assert.equal(config.problems(config.load(base)).length, 2);
  assert.equal(config.problems(config.load({ ...base, APP_BASE_URL: 'https://app.exemplo.com', RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'a@b.com' })).length, 0);
});

test('migrações e seed são idempotentes', async () => {
  const cfg = config.load(testEnv());
  const pool = db.connect(cfg);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  assert.ok((await migrate(pool)).applied.length >= 1);
  assert.equal((await migrate(pool)).applied.length, 0);
  const s1 = await seed(pool, cfg); const s2 = await seed(pool, cfg);
  assert.equal(s1.admin, 'criado'); assert.equal(s2.admin, 'existente'); assert.equal(s2.legal, 0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM users WHERE role='admin'")).rows[0].n, 1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM legal_documents')).rows[0].n, 2);
  await db.close();
});

test('seed recusa criar admin sem variáveis', async () => {
  const cfg = config.load(testEnv({ ADMIN_EMAIL: '', ADMIN_INITIAL_PASSWORD: '' }));
  const pool = db.connect(cfg);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  await assert.rejects(seed(pool, cfg), /ADMIN_EMAIL/);
  await db.close();
});

test('menu, cabeçalho e rodapé: cada um em um único arquivo e usados por todas as telas', () => {
  const src = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');
  const all = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter((f) => f.endsWith('.js'));
  for (const f of all) {
    const s = src(f);
    if (!['footer.js'].includes(f)) assert.doesNotMatch(s, /<footer/, `${f} não pode ter rodapé próprio`);
    if (!['layout.js'].includes(f)) assert.doesNotMatch(s, /class="nav__item/, `${f} não pode montar itens de menu`);
  }
  assert.match(src('layout.js'), /require\('\.\/footer'\)/); assert.match(src('layout.js'), /require\('\.\/nav'\)/);
  const labels = (a) => menuFor(a, '/', 1).map((i) => i.label);
  assert.deepEqual(labels('aluno'), ['Meus cursos', 'Perfil']);
  assert.deepEqual(labels('admin'), ['Dashboard', 'Perfil']);
});

test('versões coerentes entre package.json e version.json', () => {
  const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const v = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  assert.equal(p.version, v.version);
  assert.match(v.display, /^\d+\.\d+$/);
});
