'use strict';
// 0.5.2: cockpit financeiro (período, números, churn, tela e acesso).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const F = require('../src/finance');

let t; let admin; let c1; let c2;
const q = (sql, p) => t.pool.query(sql, p);
let n = 0;
async function order({ course, user, cents, kind = 'purchase', method = 'pix', status = 'approved', approvedAgo = 2, refundedAgo = null, source = 'full' }) {
  const pub = 'T' + String(++n).padStart(23, '0');
  await q(`INSERT INTO orders (public_id, user_id, course_id, kind, buyer, list_cents, price_cents, price_source, method, provider, paid_cents, status, approved_at, refunded_at)
    VALUES ($1,$2,$3,$4,'{"name":"A","email":"a@x.com"}'::jsonb,$5,$5,$9,$6,'simulated',$5,$7, now() - ($8 || ' days')::interval, ${refundedAgo == null ? 'NULL' : "now() - ($10 || ' days')::interval"})`,
  refundedAgo == null ? [pub, user, course, kind, cents, method, status, String(approvedAgo), source] : [pub, user, course, kind, cents, method, status, String(approvedAgo), source, String(refundedAgo)]);
}

before(async () => {
  t = await boot(); admin = await adminReady(t);
  for (const [s, title] of [['c-um', 'Curso Um'], ['c-dois', 'Curso Dois']]) {
    await admin.post('/admin/cursos', { title, slug: s, summary: 'R', description: 'D', price: '100,00', level: 'iniciante', access_type: 'months', access_months: '12', max_installments: '12', sort_order: '1', expiry_notice: '' }, '/admin/cursos/novo');
  }
  c1 = (await q("SELECT id FROM courses WHERE slug='c-um'")).rows[0].id; c2 = (await q("SELECT id FROM courses WHERE slug='c-dois'")).rows[0].id;
  const u = []; for (let i = 0; i < 6; i++) u.push((await makeStudent(t, { email: `f${i}@example.com`, name: `Aluno ${i}` })).id);
  await order({ course: c1, user: u[0], cents: 10000 });
  await order({ course: c1, user: u[1], cents: 10000, method: 'card', source: 'coupon' });
  await order({ course: c2, user: u[2], cents: 5000 });
  await order({ course: c1, user: u[3], cents: 8000, kind: 'renewal' });
  await order({ course: c1, user: u[4], cents: 10000, status: 'refunded', approvedAgo: 3, refundedAgo: 1 });
  await order({ course: c1, user: u[5], cents: 9999, status: 'pending', approvedAgo: 1 }); // pendente: approved_at é preenchido só para provar que o status não é o filtro? não: aqui NÃO deve contar
  await q("UPDATE orders SET approved_at = NULL WHERE status = 'pending'");
  // matrícula comprada que venceu há 3 dias e não foi renovada
  await q("INSERT INTO enrollments (user_id, course_id, origin, starts_at, expires_at) VALUES ($1,$2,'purchase', now() - interval '400 days', now() - interval '3 days')", [u[0], c2]);
  // vencimento no futuro (não conta) e cortesia vencida (não conta)
  await q("INSERT INTO enrollments (user_id, course_id, origin, starts_at, expires_at) VALUES ($1,$2,'purchase', now(), now() + interval '5 days')", [u[1], c2]);
  await q("INSERT INTO enrollments (user_id, course_id, origin, starts_at, expires_at) VALUES ($1,$2,'manual', now() - interval '400 days', now() - interval '2 days')", [u[2], c1]);
  await q(`INSERT INTO certificates (code, user_id, course_id, student_name, course_title, body_text, issued_at) VALUES ('EVL-T-0001',$1,$2,'A','Curso Um','x', now() - interval '1 day')`, [u[0], c1]);
});
after(async () => { await t.close(); });

test('período: atalhos, datas livres inválidas e invertidas', () => {
  const now = new Date('2026-10-27T15:00:00Z');
  assert.deepEqual([F.period({}, now).from, F.period({}, now).to], ['2026-10-01', '2026-10-27']);
  assert.equal(F.period({ periodo: '30d' }, now).from, '2026-09-28');
  assert.equal(F.period({ periodo: 'ano' }, now).from, '2026-01-01');
  const c = F.period({ periodo: 'custom', de: '2026-03-10', ate: '2026-03-01' }, now);
  assert.deepEqual([c.key, c.from, c.to], ['custom', '2026-03-01', '2026-03-10']);
  assert.equal(F.period({ periodo: 'custom', de: '2026-02-31', ate: 'x' }, now).key, 'mes', 'datas inválidas voltam ao mês atual');
  assert.equal(F.period({ periodo: 'qualquer' }, now).key, 'mes');
});

test('números: vendas, devolução, líquida, churn e efetividade', async () => {
  const per = F.period({ periodo: '30d' });
  const d = await F.summary(per, null);
  // vendas aprovadas no período: 100 + 100 + 50 + 80 (renovação) + 100 (reembolsada depois) = 430
  assert.equal(d.sales.n, 5); assert.equal(d.sales.gross, 43000);
  assert.equal(d.sales.news, 4); assert.equal(d.sales.renewals, 1); assert.equal(d.sales.withCoupon, 1);
  assert.equal(d.sales.avgTicket, 8600);
  assert.equal(d.refunds.n, 1); assert.equal(d.refunds.value, 10000); assert.equal(d.refunds.refunded, 1); assert.equal(d.refunds.chargedBack, 0);
  assert.equal(d.net, 33000);
  assert.equal(d.nonRenewals, 1, 'só a compra vencida e não renovada; cortesia e prazo futuro não contam');
  assert.equal(d.lost, 2); assert.equal(d.base, 4 + 1 + 1);
  assert.ok(Math.abs(d.churn - (2 / 6) * 100) < 1e-9); assert.ok(Math.abs(d.effectiveness - (100 - (2 / 6) * 100)) < 1e-9);
  assert.equal(d.certificates, 1);
  assert.equal(d.byMethod.find((m) => m.method === 'card').n, 1);
  const one = d.byCourse.find((c) => c.id === String(c1)); assert.equal(one.sales, 4); assert.equal(one.gross, 38000); assert.equal(one.refunds, 1); assert.equal(one.net, 28000);
  assert.equal(d.series.length, 30); assert.equal(d.unit, 'day');
  assert.equal(d.series.reduce((s, x) => s + x.gross, 0), 43000); assert.equal(d.series.reduce((s, x) => s + x.refunds, 0), 10000);
});

test('revisão: nomes herdados, anos absurdos e bordas de fuso', async () => {
  const now = new Date('2026-10-27T15:00:00Z');
  assert.equal(F.period({ periodo: 'constructor' }, now).key, 'mes'); assert.equal(F.period({ periodo: 'toString' }, now).label, 'Este mês');
  assert.equal(F.period({ periodo: 'custom', de: '0000-01-01', ate: '0000-02-01' }, now).key, 'mes');
  const r = await admin.get('/admin/financeiro?periodo=custom&de=0000-01-01&ate=9999-12-31'); assert.equal(r.status, 200);
  // Fuso: 02:59Z do dia 15 é 23:59 do dia 14 em Brasília; 03:00Z já é dia 15.
  const u = (await makeStudent(t, { email: 'fuso@example.com' })).id;
  await order({ course: c2, user: u, cents: 1111, approvedAgo: 400 });
  await q("UPDATE orders SET approved_at = '2031-03-15T02:59:00Z' WHERE price_cents = 1111");
  const a = await F.summary({ from: '2031-03-14', to: '2031-03-14' }, null); assert.equal(a.sales.gross, 1111, '02:59Z cai no dia 14');
  const b = await F.summary({ from: '2031-03-15', to: '2031-03-15' }, null); assert.equal(b.sales.gross, 0);
  await q("UPDATE orders SET approved_at = '2031-03-15T03:00:00Z' WHERE price_cents = 1111");
  const c = await F.summary({ from: '2031-03-15', to: '2031-03-15' }, null); assert.equal(c.sales.gross, 1111, '03:00Z é dia 15 e o fim é inclusivo');
  // chargeback e agrupamento por mês
  await q("UPDATE orders SET status = 'charged_back', refunded_at = '2031-04-20T12:00:00Z' WHERE price_cents = 1111");
  const m = await F.summary({ from: '2031-03-01', to: '2031-05-31' }, null);
  assert.equal(m.unit, 'month'); assert.equal(m.refunds.chargedBack, 1); assert.deepEqual(m.series.map((x) => [x.key, x.gross, x.refunds]), [['2031-03-01', 1111, 0], ['2031-04-01', 0, 1111], ['2031-05-01', 0, 0]]);
  await q("DELETE FROM orders WHERE price_cents = 1111");
});

test('revisão: título de curso com HTML sai escapado na tela', async () => {
  await q("UPDATE courses SET title = $2 WHERE id = $1", [c1, '<img src=x onerror=alert(1)>']);
  const r = await admin.get('/admin/financeiro?periodo=30d');
  assert.ok(!r.text.includes('<img src=x'), 'sem HTML solto'); assert.match(r.text, /&lt;img src=x/);
  await q("UPDATE courses SET title = 'Curso Um' WHERE id = $1", [c1]);
});

test('filtro por curso e período vazio', async () => {
  const d = await F.summary(F.period({ periodo: '30d' }), c2);
  assert.equal(d.sales.n, 1); assert.equal(d.sales.gross, 5000); assert.equal(d.refunds.n, 0); assert.equal(d.nonRenewals, 1);
  const vazio = await F.summary(F.period({ periodo: 'custom', de: '2020-01-01', ate: '2020-01-31' }), null);
  assert.equal(vazio.sales.n, 0); assert.equal(vazio.churn, null); assert.equal(vazio.effectiveness, null); assert.equal(vazio.series.length, 31);
  const longo = await F.summary(F.period({ periodo: 'ano' }), null);
  assert.equal(longo.unit, 'month'); assert.ok(longo.series.every((x) => x.key.endsWith('-01')));
});

test('tela: administrador vê, aluno e visitante não', async () => {
  const r = await admin.get('/admin/financeiro?periodo=30d');
  assert.equal(r.status, 200);
  assert.match(r.text, /Cockpit financeiro/); assert.match(r.text, /R\$\s*430,00/); assert.match(r.text, /33,3%/); assert.match(r.text, /66,7%/); assert.match(r.text, /<svg class="chart"/);
  const f = await admin.get(`/admin/financeiro?periodo=30d&curso=${c2}`); assert.match(f.text, /R\$\s*50,00/);
  const bad = await admin.get('/admin/financeiro?periodo=custom&de=2026-99-99&ate=zzz&curso=abc'); assert.equal(bad.status, 200);
  const guest = await new Browser(t.base).get('/admin/financeiro'); assert.notEqual(guest.status, 200);
  const s = await makeStudent(t, { email: 'solo@example.com' }); const b = new Browser(t.base);
  const tk = await b.csrf('/entrar'); await b.post('/entrar', { email: s.email, password: s.password, _csrf: tk }, '/entrar');
  const no = await b.get('/admin/financeiro'); assert.notEqual(no.status, 200);
});
