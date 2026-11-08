'use strict';
// 1.9.0 · Liberar carência: o administrador adianta a liberação das comissões em carência de um afiliado.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const A = require('../src/affiliates');

let t; let admin; let course; let af; let af2; let cp; let n = 0;
const q = (sql, p) => t.pool.query(sql, p);
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';
const days = (d) => new Date(Date.now() + d * 86400000);
// Cria uma venda com comissão; release em `rel` dias (positivo = ainda em carência).
const sale = async (affiliate, coupon, { rel = 5, cents = 1000, status = 'approved', cstatus = 'active', refund = null } = {}) => {
  n += 1;
  const u = await makeStudent(t, { email: `comprador${n}@example.com`, name: `Comprador ${n}` });
  const oid = (await q("INSERT INTO orders (public_id, user_id, course_id, buyer, list_cents, price_cents, method, provider, status, paid_cents, approved_at) VALUES ($1,$2,$3,'{\"name\":\"X\",\"email\":\"x@example.com\"}'::jsonb,10000,10000,'pix','simulated',$4,10000,now()) RETURNING id", [`V190${String(n).padStart(20, '0')}`, u.id, course, status])).rows[0].id;
  const cid = (await q("INSERT INTO commissions (affiliate_id, order_id, coupon_id, base_cents, pct, amount_cents, release_at, status) VALUES ($1,$2,$3,10000,10,$4,$5,$6) RETURNING id", [affiliate, oid, coupon, cents, days(rel), cstatus])).rows[0].id;
  if (refund) await q("INSERT INTO refund_requests (order_id, requested_by, reason, status) VALUES ($1,$2,'teste',$3)", [oid, u.id, refund]);
  return cid;
};

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await q("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy','affiliate')", [LONG]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING");
  await admin.post('/admin/cursos', { title: 'Curso Carencia', slug: 'curso-carencia', summary: 'R', description: 'D', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice_days: '30', publish: '1' }, '/admin/cursos/novo');
  course = (await q("SELECT id FROM courses WHERE slug='curso-carencia'")).rows[0].id;
  af = (await q("INSERT INTO affiliates (name, email, phone) VALUES ('Afiliada Um','af1@example.com','43999991111') RETURNING id")).rows[0].id;
  af2 = (await q("INSERT INTO affiliates (name, email, phone) VALUES ('Afiliada Dois','af2@example.com','43999992222') RETURNING id")).rows[0].id;
  cp = (await q("INSERT INTO coupons (code, kind, percent, max_uses, affiliate_id, commission_pct) VALUES ('EVO-CAR001','percent',10,50,$1,10) RETURNING id", [af])).rows[0].id;
  await q("INSERT INTO coupons (code, kind, percent, max_uses, affiliate_id, commission_pct) VALUES ('EVO-CAR002','percent',10,50,$1,10)", [af2]);
});
after(async () => { await t.close(); });

test('libera só o que está em carência, guarda a data original e soma ao saldo', async () => {
  const a = await sale(af, cp, { rel: 5, cents: 1348 }); const b = await sale(af, cp, { rel: 2, cents: 1000 });
  const done = await sale(af, cp, { rel: -3, cents: 700 }); // já liberada antes
  const review = await sale(af, cp, { rel: 4, cents: 500, refund: 'requested' });
  const canc = await sale(af, cp, { rel: 4, cents: 400, cstatus: 'cancelled' });
  const refunded = await sale(af, cp, { rel: 4, cents: 300, status: 'refunded' });
  let d = await A.detail(af); assert.equal(d.released, 700); assert.equal(d.grace, 1348 + 1000 + 500);
  const pre = await A.releasable(af); assert.deepEqual(pre, { n: 2, cents: 2348 });
  const out = await A.releaseGrace(af, null);
  assert.equal(out.n, 2); assert.equal(out.cents, 2348);
  d = await A.detail(af);
  assert.equal(d.released, 700 + 2348); assert.equal(d.grace, 500); assert.equal(d.balance, 3048); // análise de reembolso continua retida
  const rows = (await q('SELECT id, release_at, release_at_original, released_early_at FROM commissions WHERE id = ANY($1)', [[a, b, done, review, canc, refunded]])).rows;
  const by = (id) => rows.find((r) => String(r.id) === String(id));
  assert.ok(by(a).release_at_original && by(a).released_early_at && new Date(by(a).release_at) <= new Date());
  assert.ok(new Date(by(a).release_at_original) > new Date());
  for (const x of [done, review, canc, refunded]) assert.equal(by(x).released_early_at, null);
  assert.deepEqual(await A.releaseGrace(af, null), { n: 0, cents: 0, ids: [] }); // idempotente
});

test('reembolso aprovado, afiliado inativo e cliques simultâneos', async () => {
  const k = (await q("SELECT id FROM coupons WHERE code='EVO-CAR001'")).rows[0].id;
  const blocked = await sale(af, k, { rel: 3, cents: 222, refund: 'approved' });
  const [x, y] = await Promise.all([A.releaseGrace(af, null), A.releaseGrace(af, null)]);
  assert.equal(x.n + y.n, (x.n ? x.n : y.n)); // cada comissão só é liberada por uma das chamadas
  assert.equal((await q('SELECT released_early_at FROM commissions WHERE id=$1', [blocked])).rows[0].released_early_at, null);
  const s2 = await sale(af, k, { rel: 3, cents: 50 });
  const [p1, p2] = await Promise.all([A.releaseGrace(af, null), A.releaseGrace(af, null)]);
  assert.equal(p1.n + p2.n, 1); assert.ok(s2);
});

test('não mexe nas comissões de outro afiliado', async () => {
  const x = await sale(af2, (await q("SELECT id FROM coupons WHERE code='EVO-CAR002'")).rows[0].id, { rel: 6, cents: 900 });
  await sale(af, cp, { rel: 3, cents: 100 });
  await A.releaseGrace(af, null);
  assert.equal((await q('SELECT released_early_at FROM commissions WHERE id=$1', [x])).rows[0].released_early_at, null);
  assert.equal((await A.detail(af2)).grace, 900);
});

test('tela: botão com confirmação, ação, auditoria, aviso e marca na venda', async () => {
  const cp2 = (await q("SELECT id FROM coupons WHERE code='EVO-CAR002'")).rows[0].id;
  await sale(af2, cp2, { rel: 4, cents: 1348 });
  let h = (await admin.get(`/admin/afiliados/${af2}`)).text;
  assert.match(h, /data-modal-open="liberar-modal"[^>]*>Liberar carência</); assert.match(h, /id="liberar-modal"/);
  assert.match(h, /R\$\s?22,48/); assert.match(h, /de 2 vendas em carência de <b>Afiliada Dois/); assert.match(h, new RegExp(`/admin/afiliados/${af2}/liberar-carencia`));
  const r = await admin.post(`/admin/afiliados/${af2}/liberar-carencia`, {}, `/admin/afiliados/${af2}`);
  assert.equal(r.status, 303);
  h = (await admin.get(`/admin/afiliados/${af2}`)).text;
  assert.match(h, /liberada antecipadamente em/); assert.doesNotMatch(h, /data-modal-open="liberar-modal"/); // nada mais a liberar: sem botão
  const log = (await q("SELECT meta FROM audit_log WHERE action = 'affiliate_grace_released' AND entity_id = $1", [String(af2)])).rows;
  assert.equal(log.length, 1); assert.equal(log[0].meta.sales, 2); assert.equal(log[0].meta.cents, 2248);
  // repetir é inofensivo
  const again = await admin.post(`/admin/afiliados/${af2}/liberar-carencia`, {}, `/admin/afiliados/${af2}`); assert.equal(again.status, 303);
  assert.equal((await q("SELECT count(*)::int n FROM audit_log WHERE action = 'affiliate_grace_released' AND entity_id = $1", [String(af2)])).rows[0].n, 1);
});

test('aviso ao afiliado quando já tem conta', async () => {
  const u = await makeStudent(t, { email: 'afconta@example.com', name: 'Afiliado Conta' });
  const id = (await q("INSERT INTO affiliates (name, email, phone, user_id, invited_at) VALUES ('Afiliado Conta','afconta@example.com','43999993333',$1, now() - interval '10 days') RETURNING id", [u.id])).rows[0].id;
  const k = (await q("INSERT INTO coupons (code, kind, percent, max_uses, affiliate_id, commission_pct) VALUES ('EVO-CAR003','percent',10,50,$1,10) RETURNING id", [id])).rows[0].id;
  await sale(id, k, { rel: 5, cents: 800 });
  await admin.post(`/admin/afiliados/${id}/liberar-carencia`, {}, `/admin/afiliados/${id}`);
  const nt = (await q("SELECT title FROM notifications WHERE user_id = $1 AND kind = 'affiliate'", [u.id])).rows;
  assert.equal(nt.length, 1); assert.equal(nt[0].title, 'Comissão liberada');
});

test('só administrador executa; aluno e visitante não', async () => {
  const k = (await q("SELECT id FROM coupons WHERE code='EVO-CAR001'")).rows[0].id;
  const c = await sale(af, k, { rel: 5, cents: 111 });
  const s = await makeStudent(t, { email: 'curioso@example.com', name: 'Curioso' });
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING", [s.id]);
  const b = new Browser(t.base); await b.login(s.email, s.password);
  const r = await b.post(`/admin/afiliados/${af}/liberar-carencia`, {}, '/perfil');
  assert.ok([302, 303, 403, 404].includes(r.status));
  const an = await new Browser(t.base).post(`/admin/afiliados/${af}/liberar-carencia`, {}, '/entrar');
  assert.ok([302, 303, 401, 403].includes(an.status));
  assert.equal((await q('SELECT released_early_at FROM commissions WHERE id=$1', [c])).rows[0].released_early_at, null);
  assert.equal((await admin.post('/admin/afiliados/999999/liberar-carencia', {}, '/admin/afiliados')).status, 404);
});
