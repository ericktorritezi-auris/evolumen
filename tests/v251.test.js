'use strict';
// 2.5.1 · Tema Black Friday: liga e desliga com a promoção, home, cabeçalho, faixa e produtos.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady } = require('./helpers');
const P = require('../src/promotions');

let t; let admin;
const q = (sql, p) => t.pool.query(sql, p);
const inH = (h) => P.localInput(new Date(Date.now() + h * 3600000));
const body = (over = {}) => ({ name: 'Black Friday 2026', kind: 'percent', percent: '50', starts_at: inH(-1), ends_at: inH(48), scope: 'all', theme: 'blackfriday', ...over });
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await q("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy','affiliate')", [LONG]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING");
  await admin.post('/admin/cursos', { title: 'Curso BF', slug: 'curso-bf', summary: 'R', description: 'D', price: '200,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice: '' }, '/admin/cursos/novo');
  await q("UPDATE courses SET status='published', published_at=now() - interval '1 day' WHERE slug='curso-bf'");
});
after(async () => { await t.close(); });

test('formulário tem o interruptor e o tema só liga com a promoção no ar', async () => {
  assert.match((await admin.get('/admin/promocoes/nova')).text, /Tema Black Friday/);
  const normal = (await new Browser(t.base).get('/')).text;
  assert.doesNotMatch(normal, /theme-bf/); assert.doesNotMatch(normal, /bf-hero/);
  const r = await admin.post('/admin/promocoes', body({ starts_at: inH(5), ends_at: inH(9) }), '/admin/promocoes/nova'); assert.equal(r.status, 303);
  await P.refresh(true);
  assert.doesNotMatch((await new Browser(t.base).get('/')).text, /theme-bf/, 'agendada: ainda não muda o site');
  await q("UPDATE promotions SET status='inactive'"); await P.refresh(true);
});

test('no ar: cabeçalho, faixa, abertura com Lumen, contagem e faixa nos produtos', async () => {
  assert.equal((await admin.post('/admin/promocoes', body(), '/admin/promocoes/nova')).status, 303); await P.refresh(true);
  const home = (await new Browser(t.base).get('/')).text;
  assert.match(home, /class="[^"]*theme-bf/); assert.match(home, /promobar--bf/); assert.match(home, /BLACK<br>FRIDAY/); assert.match(home, /50% de desconto<\/b> em nossos produtos/);
  assert.match(home, /data-countdown="/); assert.match(home, /lumen-blackfriday\.svg/); assert.match(home, /bf-rib/);
  assert.doesNotMatch(home, /Evolua com/, 'a abertura normal sai de cena');
  const page = (await new Browser(t.base).get('/cursos/curso-bf')).text; assert.match(page, /ptag--bf/); assert.match(page, /theme-bf/);
  const co = (await new Browser(t.base).get('/checkout/curso-bf')).text; assert.match(co, /theme-bf/);
  assert.equal((await new Browser(t.base).get('/static/img/lumen-blackfriday.svg')).status, 200);
});

test('ao encerrar o site volta ao normal sozinho', async () => {
  await q("UPDATE promotions SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 minute' WHERE status = 'active'"); await P.refresh(true);
  const home = (await new Browser(t.base).get('/')).text;
  assert.doesNotMatch(home, /theme-bf|bf-hero|promobar/); assert.match(home, /Evolua com/);
});

test('promoção comum, sem o tema, não muda o visual do site', async () => {
  await q("UPDATE promotions SET status='inactive'");
  assert.equal((await admin.post('/admin/promocoes', body({ name: 'Comum', theme: '' }), '/admin/promocoes/nova')).status, 303); await P.refresh(true);
  const home = (await new Browser(t.base).get('/')).text;
  assert.match(home, /promobar/); assert.doesNotMatch(home, /theme-bf|bf-hero/); assert.match(home, /Evolua com/);
});

test('revisão: Black Friday manda no tema mesmo com outra promoção terminando antes; contagem já vem preenchida', async () => {
  await q("UPDATE promotions SET status='inactive'");
  const cid = (await q("SELECT id FROM courses WHERE slug='curso-bf'")).rows[0].id;
  await admin.post('/admin/cursos', { title: 'Curso Outro', slug: 'curso-outro', summary: 'R', description: 'D', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '2', expiry_notice: '' }, '/admin/cursos/novo');
  const other = (await q("SELECT id FROM courses WHERE slug='curso-outro'")).rows[0].id;
  assert.equal((await admin.post('/admin/promocoes', { ...body({ name: 'Comum curta', theme: '', scope: 'selected', courses: [String(other)], ends_at: inH(24) }) }, '/admin/promocoes/nova')).status, 303);
  assert.equal((await admin.post('/admin/promocoes', body({ name: 'BF longa', scope: 'selected', courses: [String(cid)], ends_at: inH(72) }), '/admin/promocoes/nova')).status, 303);
  await P.refresh(true);
  const home = (await new Browser(t.base).get('/')).text;
  assert.match(home, /theme-bf/); assert.match(home, /BLACK<br>FRIDAY/); assert.doesNotMatch(home, /data-cd="d">00</, 'contagem já vem calculada do servidor');
});
