'use strict';
// 1.1.1 · Programa de afiliados, parte 1: cadastro, cupom com comissão, comissão automática, carência, cancelamento,
// repasses, saldo negativo, CSV, texto legal de afiliados (rascunho) e reset de lançamento.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const AFF = require('../src/affiliates');
const L = require('../src/launch');
const acceptance = require('../src/acceptance');

let t; let admin; let course; let aff; let coupon; let slug = 'curso-afiliado';
const q = (sql, p) => t.pool.query(sql, p);
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';
let cpfN = 0; let buyerN = 0;
function genCpf(n) {
  const d = String(100000000 + n * 7919).slice(0, 9).split('').map(Number);
  for (let k = 0; k < 2; k++) { const len = 9 + k; const sum = d.slice(0, len).reduce((a, v, i) => a + v * (len + 1 - i), 0); const r = (sum * 10) % 11; d.push(r === 10 ? 0 : r); }
  return d.join('');
}
const form = (over = {}) => ({ name: 'Bruna Compradora', email: `compradora${++buyerN}@example.com`, phone: '11987654321', cpf: genCpf(++cpfN), cep: '01310100', street: 'Av. Paulista', street_number: '1000', complement: '', district: 'Bela Vista', city: 'São Paulo', state: 'SP', method: 'pix', accept: '1', cupom: '', ...over });
const sim = (pub, result) => admin.post(`/admin/simulador/${pub}`, { result }, '/admin/simulador');
async function buy(over = {}, code = null) {
  const b = new Browser(t.base);
  const f = form({ ...over, cupom: code === null ? coupon.code : code });
  const r = await b.post(`/checkout/${slug}`, f, `/checkout/${slug}`);
  assert.equal(r.status, 303, 'checkout: ' + (r.text.match(/field__msg--err[^>]*>[^<]*|alert[^>]*>[^<]*/g) || []).join(' | '));
  const pub = r.location.replace('/pedido/', '');
  const order = (await q('SELECT * FROM orders WHERE public_id=$1', [pub])).rows[0];
  return { pub, f, order };
}
const approve = async (over, code) => { const p = await buy(over, code); await sim(p.pub, 'approved'); return p; };
const commOf = async (orderId) => (await q('SELECT * FROM commissions WHERE order_id=$1', [orderId])).rows[0];
const totals = async (id = aff.id) => AFF.detail(id);
const audits = async (action) => (await q('SELECT * FROM audit_log WHERE action=$1 ORDER BY id', [action])).rows;
const newAffiliate = async (name, email) => {
  await admin.post('/admin/afiliados', { name, email, phone: '(11) 98888-7777', note: '' }, '/admin/afiliados/novo');
  return (await q('SELECT * FROM affiliates WHERE lower(email)=$1', [email.toLowerCase()])).rows[0];
};
const newCoupon = async (affId, pct, code) => {
  await admin.post('/admin/cupons', { code, kind: 'percent', percent: '20', max_uses: '500', courses: [String(course)], affiliate_id: String(affId), commission_pct: pct }, '/admin/cupons/novo');
  return (await q('SELECT * FROM coupons WHERE code=$1', [code])).rows[0];
};

before(async () => {
  t = await boot({ ALLOW_LAUNCH_RESET: '1' }); admin = await adminReady(t);
  await admin.post('/admin/cursos', { title: 'Curso Afiliado', slug, summary: 'Resumo.', description: 'Desc', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice_days: '30' }, '/admin/cursos/novo');
  course = (await q('SELECT id FROM courses WHERE slug=$1', [slug])).rows[0].id;
  await q("UPDATE courses SET status='published', published_at=now() - interval '1 day' WHERE id=$1", [course]);
  const mod = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'M',1) RETURNING id", [course])).rows[0].id;
  await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'A',1,'dQw4w9WgXcQ')", [course, mod]);
  await q("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy')", [LONG]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status = 'published' ON CONFLICT DO NOTHING");
});
after(async () => { await t.close(); });

test('cadastro de afiliado: valida, não repete e-mail, edita, inativa e reativa; só o administrador entra', async () => {
  const bad = await admin.post('/admin/afiliados', { name: 'A', email: 'sem-arroba', phone: '123' }, '/admin/afiliados/novo');
  assert.equal(bad.status, 422); assert.match(bad.text, /nome completo/); assert.match(bad.text, /e-mail válido/); assert.match(bad.text, /Telefone com DDD/);
  assert.equal((await q('SELECT count(*)::int n FROM affiliates')).rows[0].n, 0);
  aff = await newAffiliate('Camila Divulgadora', 'Camila@Example.com');
  assert.equal(aff.email, 'camila@example.com'); assert.equal(aff.phone, '11988887777'); assert.equal(aff.status, 'active'); assert.equal(aff.user_id, null);
  const dup = await admin.post('/admin/afiliados', { name: 'Outra Pessoa', email: 'camila@example.com', phone: '11977776666' }, '/admin/afiliados/novo');
  assert.equal(dup.status, 422); assert.match(dup.text, /Já existe um afiliado/);
  const edit = await admin.post(`/admin/afiliados/${aff.id}`, { name: 'Camila D. Silva', email: 'camila@example.com', phone: '11988887777', note: 'Pix: camila@example.com' }, `/admin/afiliados/${aff.id}`);
  assert.equal(edit.status, 303); assert.equal((await q('SELECT name FROM affiliates WHERE id=$1', [aff.id])).rows[0].name, 'Camila D. Silva');
  const page = await admin.get(`/admin/afiliados/${aff.id}`); assert.equal(page.status, 200); assert.match(page.text, /Saldo a repassar/); assert.match(page.text, /Camila D\. Silva/);
  await admin.post(`/admin/afiliados/${aff.id}/inativar`, {}, `/admin/afiliados/${aff.id}`);
  assert.equal((await q('SELECT status FROM affiliates WHERE id=$1', [aff.id])).rows[0].status, 'inactive');
  await admin.post(`/admin/afiliados/${aff.id}/reativar`, {}, `/admin/afiliados/${aff.id}`);
  assert.equal((await q('SELECT status FROM affiliates WHERE id=$1', [aff.id])).rows[0].status, 'active');
  for (const a of ['affiliate_created', 'affiliate_updated', 'affiliate_inactivated', 'affiliate_reactivated']) assert.equal((await audits(a)).length, 1, a);
  assert.match((await admin.get('/admin/afiliados')).text, /Camila D\. Silva/);
  assert.match((await admin.get('/admin/log')).text, /Cadastrou afiliado/);
  const stu = await makeStudent(t, { email: 'curiosa@example.com', name: 'Curiosa Aluna' }); await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published'", [stu.id]); const sb = new Browser(t.base); await sb.login(stu.email, stu.password);
  for (const u of ['/admin/afiliados', '/admin/afiliados/novo', `/admin/afiliados/${aff.id}`, '/admin/afiliados/vendas.csv', `/admin/afiliados/${aff.id}/vendas.csv`]) assert.equal((await sb.get(u)).status, 403, u);
  assert.notEqual((await new Browser(t.base).get('/admin/afiliados')).status, 200);
  const post = await sb.post('/admin/afiliados', { name: 'Intrusa Teste', email: 'i@example.com', phone: '11999999999' }, '/meus-cursos');
  assert.notEqual(post.status, 303); assert.equal((await q('SELECT count(*)::int n FROM affiliates')).rows[0].n, 1);
});

test('cupom com afiliado: afiliado e percentual andam juntos, vírgula é aceita e a retirada é possível enquanto não houve venda', async () => {
  const base = { kind: 'percent', percent: '20', max_uses: '500', courses: [String(course)] };
  const noPct = await admin.post('/admin/cupons', { ...base, code: 'AFF-SEMPCT', affiliate_id: String(aff.id), commission_pct: '' }, '/admin/cupons/novo');
  assert.equal(noPct.status, 422); assert.match(noPct.text, /percentual da comissão/);
  const noAff = await admin.post('/admin/cupons', { ...base, code: 'AFF-SEMAFF', affiliate_id: '', commission_pct: '10' }, '/admin/cupons/novo');
  assert.equal(noAff.status, 422); assert.match(noAff.text, /Escolha o afiliado/);
  for (const bad of ['0', '101', 'abc', '-5', '10,555']) assert.equal((await admin.post('/admin/cupons', { ...base, code: 'AFF-RUIM', affiliate_id: String(aff.id), commission_pct: bad }, '/admin/cupons/novo')).status, 422, bad);
  assert.equal((await q("SELECT count(*)::int n FROM coupons WHERE code LIKE 'AFF-%'")).rows[0].n, 0);
  coupon = await newCoupon(aff.id, '12,5', 'AFF-CAMILA');
  assert.equal(Number(coupon.commission_pct), 12.5); assert.equal(String(coupon.affiliate_id), String(aff.id));
  const det = await admin.get(`/admin/cupons/${coupon.id}`); assert.match(det.text, /Comissão do afiliado/); assert.match(det.text, /Camila D\. Silva/);
  assert.match((await admin.get('/admin/cupons')).text, /Afiliado: Camila D\. Silva · 12,5% de comissão/);
  // sem venda ainda: dá para trocar o percentual e para tirar o afiliado
  await admin.post(`/admin/cupons/${coupon.id}`, { kind: 'percent', percent: '20', max_uses: '500', courses: [String(course)], affiliate_id: String(aff.id), commission_pct: '10' }, `/admin/cupons/${coupon.id}`);
  assert.equal(Number((await q('SELECT commission_pct FROM coupons WHERE id=$1', [coupon.id])).rows[0].commission_pct), 10);
  await admin.post('/admin/cupons', { ...base, code: 'SEM-AFIL', affiliate_id: '', commission_pct: '' }, '/admin/cupons/novo');
  assert.equal((await q("SELECT affiliate_id FROM coupons WHERE code='SEM-AFIL'")).rows[0].affiliate_id, null);
  await admin.post(`/admin/cupons/${coupon.id}`, { kind: 'percent', percent: '20', max_uses: '500', courses: [String(course)], affiliate_id: String(aff.id), commission_pct: '12,5' }, `/admin/cupons/${coupon.id}`);
  assert.equal(Number((await q('SELECT commission_pct FROM coupons WHERE id=$1', [coupon.id])).rows[0].commission_pct), 12.5);
  // o formulário de cupom oferece só afiliados ativos
  const other = await newAffiliate('Inativo Antigo', 'antigo@example.com');
  await admin.post(`/admin/afiliados/${other.id}/inativar`, {}, `/admin/afiliados/${other.id}`);
  assert.doesNotMatch((await admin.get('/admin/cupons/novo')).text, /Inativo Antigo/);
  const inact = await admin.post('/admin/cupons', { ...base, code: 'AFF-INATIVO', affiliate_id: String(other.id), commission_pct: '10' }, '/admin/cupons/novo');
  assert.equal(inact.status, 422); assert.match(inact.text, /afiliado está inativo|inativo/i);
});

test('venda aprovada com cupom de afiliado gera comissão em carência, sobre o valor pago com desconto, e libera depois do prazo', async () => {
  const p = await approve();
  assert.equal(p.order.price_cents, 8000, 'R$ 100,00 com 20% de desconto');
  const cm = await commOf(p.order.id);
  assert.ok(cm, 'comissão criada');
  assert.equal(cm.base_cents, 8000); assert.equal(Number(cm.pct), 12.5); assert.equal(cm.amount_cents, 1000); assert.equal(cm.status, 'active');
  const o = (await q('SELECT refund_until FROM orders WHERE id=$1', [p.order.id])).rows[0];
  assert.equal(new Date(cm.release_at).getTime(), new Date(o.refund_until).getTime(), 'libera quando acaba o prazo de reembolso');
  const days = (new Date(cm.release_at) - Date.now()) / 86400000; assert.ok(days > 6.9 && days <= 7.01, 'carência de 7 dias: ' + days);
  let tot = await totals(); assert.equal(tot.grace, 1000); assert.equal(tot.released, 0); assert.equal(tot.balance, 0); assert.equal(tot.sales, 1);
  const pg = await admin.get(`/admin/afiliados/${aff.id}`); assert.match(pg.text, /Em carência/); assert.match(pg.text, /falta 7 dias para liberar/);
  assert.equal((await audits('affiliate_commission_created')).length, 1);
  // passa o prazo: a comissão fica liberada, sem nenhuma tarefa agendada
  await q("UPDATE commissions SET release_at = now() - interval '1 minute' WHERE id=$1", [cm.id]);
  tot = await totals(); assert.equal(tot.grace, 0); assert.equal(tot.released, 1000); assert.equal(tot.balance, 1000);
  assert.match((await admin.get(`/admin/afiliados/${aff.id}`)).text, /Liberada/);
  // repetir a aprovação (webhook duplicado) não duplica a comissão
  await sim(p.pub, 'approved');
  assert.equal((await q('SELECT count(*)::int n FROM commissions WHERE order_id=$1', [p.order.id])).rows[0].n, 1);
  // o percentual gravado na venda não muda, e agora o cupom trava o afiliado e a comissão
  const lock = await admin.post(`/admin/cupons/${coupon.id}`, { kind: 'percent', percent: '20', max_uses: '500', courses: [String(course)], affiliate_id: '', commission_pct: '50' }, `/admin/cupons/${coupon.id}`);
  assert.equal(lock.status, 303);
  const after = (await q('SELECT affiliate_id, commission_pct FROM coupons WHERE id=$1', [coupon.id])).rows[0];
  assert.equal(String(after.affiliate_id), String(aff.id)); assert.equal(Number(after.commission_pct), 12.5, 'trava depois da primeira venda');
  assert.match((await admin.get(`/admin/cupons/${coupon.id}`)).text, /não mudam mais/);
  // venda sem cupom de afiliado não gera comissão
  const plain = await approve({}, 'SEM-AFIL');
  assert.equal(await commOf(plain.order.id), undefined);
  const none = await approve({}, '');
  assert.equal(await commOf(none.order.id), undefined);
});

test('arredondamento da comissão em centavos', () => {
  assert.equal(AFF.commissionOf(8000, 12.5), 1000);
  assert.equal(AFF.commissionOf(9990, 10), 999);
  assert.equal(AFF.commissionOf(3333, 15), 500); // 499,95 → 500
  assert.equal(AFF.commissionOf(1999, 33.33), 666); // 666,26
  assert.equal(AFF.commissionOf(100, 0.5), 1); // 0,5 arredonda para cima
  assert.equal(AFF.commissionOf(100, 100), 100);
  assert.equal(AFF.parsePct('12,5'), 12.5); assert.equal(AFF.parsePct('7'), 7); assert.equal(AFF.parsePct('0'), null); assert.equal(AFF.parsePct('100,01'), null); assert.equal(AFF.parsePct(''), null);
});

test('reembolso cancela a comissão; o estorno depois do repasse deixa o saldo negativo, em vermelho', async () => {
  const before = await totals();
  const r1 = await approve();
  const c1 = await commOf(r1.order.id); assert.equal(c1.status, 'active');
  let tot = await totals(); assert.equal(tot.grace, before.grace + 1000);
  await sim(r1.pub, 'refunded');
  const c1b = await commOf(r1.order.id); assert.equal(c1b.status, 'cancelled'); assert.match(c1b.cancel_reason, /Reembolso/); assert.ok(c1b.cancelled_at);
  tot = await totals(); assert.equal(tot.grace, before.grace, 'sai da carência'); assert.equal(tot.cancelled, 1000);
  await sim(r1.pub, 'refunded'); assert.equal((await audits('affiliate_commission_cancelled')).length, 1, 'repetir não cancela duas vezes');
  assert.match((await admin.get(`/admin/afiliados/${aff.id}`)).text, /Cancelada/);

  // venda liberada e já repassada, depois estornada (chargeback)
  const r2 = await approve(); const c2 = await commOf(r2.order.id);
  await q("UPDATE commissions SET release_at = now() - interval '1 minute' WHERE id=$1", [c2.id]);
  tot = await totals(); assert.equal(tot.released, 2000); // a venda do teste anterior + esta
  assert.equal(tot.balance, 2000);
  const pay = await admin.post(`/admin/afiliados/${aff.id}/repasses`, { amount: '20,00', paid_on: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), note: 'Pix' }, `/admin/afiliados/${aff.id}`);
  assert.equal(pay.status, 303);
  tot = await totals(); assert.equal(tot.paid, 2000); assert.equal(tot.balance, 0);
  await sim(r2.pub, 'charged_back');
  assert.equal((await commOf(r2.order.id)).status, 'cancelled');
  tot = await totals(); assert.equal(tot.balance, -1000, 'estorno depois do repasse: saldo negativo');
  const pg = await admin.get(`/admin/afiliados/${aff.id}`);
  assert.match(pg.text, /<span class="bad">-?R\$\s?-?1\.?000|class="bad"/); assert.match(pg.text, /saldo está negativo/);
  const cockpit = await admin.get('/admin/afiliados'); assert.match(cockpit.text, /saldo negativo/);
  assert.equal((await audits('affiliate_commission_cancelled')).length, 2);
});

test('compra do próprio afiliado e afiliado inativo não geram comissão (e ficam registrados)', async () => {
  const self = await approve({ email: 'camila@example.com', name: 'Camila D. Silva' });
  assert.equal(await commOf(self.order.id), undefined, 'comprou com o próprio cupom');
  const sk = await audits('affiliate_commission_skipped'); assert.equal(sk.length, 1); assert.match(JSON.stringify(sk[0].meta), /compra_propria/);
  assert.equal((await q('SELECT status FROM orders WHERE id=$1', [self.order.id])).rows[0].status, 'approved', 'a venda em si é normal');
  await admin.post(`/admin/afiliados/${aff.id}/inativar`, {}, `/admin/afiliados/${aff.id}`);
  const off = await approve();
  assert.equal(await commOf(off.order.id), undefined, 'afiliado inativo');
  assert.match(JSON.stringify((await audits('affiliate_commission_skipped'))[1].meta), /afiliado_inativo/);
  assert.equal((await q('SELECT status FROM orders WHERE id=$1', [off.order.id])).rows[0].status, 'approved');
  assert.match((await admin.get(`/admin/afiliados/${aff.id}`)).text, /Afiliado inativo/, 'histórico e saldo continuam visíveis');
  await admin.post(`/admin/afiliados/${aff.id}/reativar`, {}, `/admin/afiliados/${aff.id}`);
  const on = await approve(); assert.ok(await commOf(on.order.id), 'reativado volta a gerar');
});

test('repasses: validação, registro, aviso de valor acima do saldo, anulação com motivo e histórico', async () => {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const url = `/admin/afiliados/${aff.id}`;
  for (const bad of [{ amount: '', paid_on: day }, { amount: '0', paid_on: day }, { amount: 'abc', paid_on: day }, { amount: '10,00', paid_on: '' }, { amount: '10,00', paid_on: '2999-01-01' }]) {
    const r = await admin.post(`${url}/repasses`, bad, url); assert.equal(r.status, 422, JSON.stringify(bad));
  }
  const n0 = (await q('SELECT count(*)::int n FROM affiliate_payouts')).rows[0].n;
  const ok = await admin.post(`${url}/repasses`, { amount: '1.234,56', paid_on: day, note: 'Pix de teste' }, url);
  assert.equal(ok.status, 303); assert.equal((await q('SELECT count(*)::int n FROM affiliate_payouts')).rows[0].n, n0 + 1);
  const p = (await q('SELECT * FROM affiliate_payouts ORDER BY id DESC LIMIT 1')).rows[0];
  assert.equal(p.amount_cents, 123456); assert.equal(String(p.created_by), String((await q("SELECT id FROM users WHERE role='admin'")).rows[0].id));
  assert.match((await admin.get(url)).text, /Pix de teste/);
  assert.equal((await audits('affiliate_payout_recorded')).length, 2);
  const bal = (await totals()).balance;
  // anular exige motivo, tira do saldo e mantém o histórico
  const noReason = await admin.post(`${url}/repasses/${p.id}/anular`, { reason: '' }, url); assert.equal(noReason.status, 303);
  assert.equal((await q('SELECT voided_at FROM affiliate_payouts WHERE id=$1', [p.id])).rows[0].voided_at, null);
  await admin.post(`${url}/repasses/${p.id}/anular`, { reason: 'Valor lançado errado' }, url);
  const v = (await q('SELECT * FROM affiliate_payouts WHERE id=$1', [p.id])).rows[0]; assert.ok(v.voided_at); assert.equal(v.void_reason, 'Valor lançado errado');
  assert.equal((await totals()).balance, bal + 123456, 'repasse anulado volta ao saldo');
  assert.match((await admin.get(url)).text, /Anulado/); assert.match((await admin.get(url)).text, /Valor lançado errado/);
  await admin.post(`${url}/repasses/${p.id}/anular`, { reason: 'de novo' }, url);
  assert.equal((await audits('affiliate_payout_voided')).length, 1, 'não anula duas vezes');
  // repasse de outro afiliado não é anulado por este endereço
  const other = await newAffiliate('Segundo Afiliado', 'segundo@example.com');
  await admin.post(`/admin/afiliados/${other.id}/repasses`, { amount: '5,00', paid_on: day }, `/admin/afiliados/${other.id}`);
  const op = (await q('SELECT id FROM affiliate_payouts WHERE affiliate_id=$1', [other.id])).rows[0].id;
  await admin.post(`${url}/repasses/${op}/anular`, { reason: 'trocado' }, url);
  assert.equal((await q('SELECT voided_at FROM affiliate_payouts WHERE id=$1', [op])).rows[0].voided_at, null);
  // repasse maior que o saldo é aceito, mas avisa
  const big = await admin.post(`${url}/repasses`, { amount: '99.999,00', paid_on: day }, url);
  assert.equal(big.status, 303); assert.ok((await totals()).balance < 0);
  // registros imutáveis do repasse seguem existindo
  assert.equal((await q('SELECT count(*)::int n FROM affiliate_payouts WHERE affiliate_id=$1', [aff.id])).rows[0].n >= 2, true);
});

test('CSV de vendas: cabeçalho, linhas, proteção contra fórmula e registro de quem baixou', async () => {
  const weird = await approve({ name: '=HYPERLINK("http://x")' });
  const own = await admin.get(`/admin/afiliados/${aff.id}/vendas.csv`);
  assert.equal(own.status, 200); assert.match(own.headers.get('content-type'), /text\/csv/); assert.match(own.headers.get('content-disposition'), /attachment; filename="vendas-camila-d-silva\.csv"/);
  const lines = own.text.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Aprovação;Pedido;Produto;Cupom;Comprador;Valor base (R$);Percentual;Comissão (R$);Situação;Liberação');
  const row = lines.find((l) => l.includes(weird.pub)); assert.ok(row);
  assert.match(row, /;"'=HYPERLINK/, 'nome que começa com = vira texto'); assert.match(row, /;"80,00";"12,5%";"10,00";Em carência;/);
  assert.ok(lines.some((l) => /;Cancelada;/.test(l)), 'cancelada aparece');
  assert.ok(lines.length >= 4);
  const all = await admin.get('/admin/afiliados/vendas.csv');
  assert.equal(all.status, 200); assert.match(all.text, /^Afiliado;Aprovação;Pedido/); assert.match(all.text, /Camila D\. Silva;/);
  assert.equal((await audits('affiliate_csv_exported')).length, 2);
  assert.equal((await new Browser(t.base).get('/admin/afiliados/vendas.csv')).status === 200, false);
});

test('defeito na comissão nunca bloqueia o acesso de quem pagou nem o estorno: fica só registrado', async () => {
  await q("CREATE FUNCTION evl_test_boom() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falha de teste'; END; $$ LANGUAGE plpgsql");
  await q('CREATE TRIGGER evl_test_boom_t BEFORE INSERT ON commissions FOR EACH ROW EXECUTE FUNCTION evl_test_boom()');
  try {
    const p = await approve();
    const o = (await q('SELECT status, user_id FROM orders WHERE id=$1', [p.order.id])).rows[0];
    assert.equal(o.status, 'approved', 'pedido aprovado mesmo assim');
    assert.equal((await q('SELECT count(*)::int n FROM enrollments WHERE user_id=$1 AND course_id=$2 AND status=$3', [o.user_id, course, 'active'])).rows[0].n, 1, 'acesso liberado');
    assert.equal(await commOf(p.order.id), undefined);
    assert.equal((await audits('affiliate_commission_failed')).length, 1, 'a falha fica registrada para você conferir');
  } finally {
    await q('DROP TRIGGER evl_test_boom_t ON commissions'); await q('DROP FUNCTION evl_test_boom()');
  }
  const b = await approve(); const cm = await commOf(b.order.id); assert.ok(cm, 'voltou ao normal');
  await q('CREATE FUNCTION evl_test_boom2() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION \'falha de teste\'; END; $$ LANGUAGE plpgsql');
  await q('CREATE TRIGGER evl_test_boom2_t BEFORE UPDATE ON commissions FOR EACH ROW EXECUTE FUNCTION evl_test_boom2()');
  try {
    await sim(b.pub, 'refunded');
    assert.equal((await q('SELECT status FROM orders WHERE id=$1', [b.order.id])).rows[0].status, 'refunded', 'o reembolso conclui');
    assert.equal((await commOf(b.order.id)).status, 'active', 'comissão não cancelou, mas a falha foi registrada');
    assert.equal((await audits('affiliate_commission_failed')).length, 2);
  } finally {
    await q('DROP TRIGGER evl_test_boom2_t ON commissions'); await q('DROP FUNCTION evl_test_boom2()');
  }
  await q("UPDATE commissions SET status='cancelled', cancelled_at=now(), cancel_reason='Reembolso' WHERE id=$1", [cm.id]); // acerto manual do cenário de teste
});

test('Termo do Programa de Afiliados: nasce como rascunho e não é exigido de ninguém; só de quem é afiliado ativo', async () => {
  const d = (await q("SELECT * FROM legal_documents WHERE doc_type='affiliate'")).rows;
  assert.equal(d.length, 1); assert.equal(d[0].status, 'draft'); assert.equal(d[0].title, 'Termo do Programa de Afiliados');
  const page = await admin.get('/admin/textos'); assert.match(page.text, /Termo do Programa de Afiliados/);
  const again = await admin.post('/admin/textos/nova', { doc_type: 'affiliate' }, '/admin/textos');
  assert.match(again.location, new RegExp(`/admin/textos/${d[0].id}`), 'já existe rascunho: volta para ele');
  assert.equal((await q("SELECT count(*)::int n FROM legal_documents WHERE doc_type='affiliate'")).rows[0].n, 1);
  const stu = await makeStudent(t, { email: 'comum@example.com', name: 'Aluna Comum' });
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published'", [stu.id]);
  assert.deepEqual(await acceptance.pendingFor(stu.id), [], 'rascunho não é exigido');
  // mesmo publicado, usuário comum nunca vê o termo de afiliados
  await admin.post(`/admin/textos/${d[0].id}`, { body_html: LONG }, `/admin/textos/${d[0].id}`);
  await admin.post(`/admin/textos/${d[0].id}/publicar`, {}, `/admin/textos/${d[0].id}`);
  assert.equal((await q('SELECT status FROM legal_documents WHERE id=$1', [d[0].id])).rows[0].status, 'published');
  assert.deepEqual(await acceptance.pendingFor(stu.id), [], 'aluno comum não vê o termo de afiliados');
  const sb = new Browser(t.base); await sb.login(stu.email, stu.password);
  const home = await sb.get('/meus-cursos'); assert.equal(home.status, 200, 'sem tela de aceite'); assert.doesNotMatch(home.text, /Termo do Programa de Afiliados/);
  assert.deepEqual((await acceptance.pendingFor((await q("SELECT id FROM users WHERE role='admin'")).rows[0].id)), [], 'administrador também não');
  // usuário ligado a um afiliado ativo passa a ser exigido (usado na 1.2.0)
  await q('UPDATE affiliates SET user_id=$1 WHERE id=$2', [stu.id, aff.id]);
  const pend = await acceptance.pendingFor(stu.id); assert.deepEqual(pend.map((x) => x.doc_type), ['affiliate']);
  await q("UPDATE affiliates SET status='inactive' WHERE id=$1", [aff.id]);
  assert.deepEqual(await acceptance.pendingFor(stu.id), [], 'afiliado inativo não é exigido');
  await q('UPDATE affiliates SET user_id=NULL, status=\'active\' WHERE id=$1', [aff.id]);
  // aceites do tipo novo aparecem no relatório de LGPD
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) VALUES ($1,$2,'affiliate','v1.0','teste')", [stu.id, d[0].id]);
  assert.match((await admin.get('/admin/lgpd?aba=aceites&doc=affiliate')).text, /Termo de afiliados/);
});

test('registros de afiliado ficam 5 anos (guarda do banco) e o reset de lançamento apaga as comissões das contas de teste', async () => {
  const guard = (await q("SELECT pg_get_functiondef('evl_audit_guard'::regproc) AS d")).rows[0].d; assert.match(guard, /affiliate_/);
  // o reset: conta de teste que comprou com cupom de afiliado
  const buyer = new Browser(t.base);
  const f = form({ email: 'testeafiliado@example.com' });
  const r = await buyer.post(`/checkout/${slug}`, { ...f, cupom: coupon.code }, `/checkout/${slug}`);
  const pub = r.location.replace('/pedido/', ''); await sim(pub, 'approved');
  const oid = (await q('SELECT id FROM orders WHERE public_id=$1', [pub])).rows[0].id;
  assert.ok(await commOf(oid));
  const prev = await L.preview(['testeafiliado@example.com']);
  assert.equal(prev.counts.comissoes, 1);
  const out = await L.run(['testeafiliado@example.com'], prev.sig);
  assert.equal(out.comissoes, 1);
  assert.equal((await q('SELECT count(*)::int n FROM commissions WHERE order_id=$1', [oid])).rows[0].n, 0);
  assert.equal((await q("SELECT count(*)::int n FROM users WHERE lower(email)='testeafiliado@example.com'")).rows[0].n, 0);
  // afiliado, cupom e comissões das outras contas ficam
  assert.equal((await q('SELECT count(*)::int n FROM affiliates')).rows[0].n >= 2, true);
  assert.equal((await q('SELECT count(*)::int n FROM commissions')).rows[0].n >= 3, true);
  assert.equal((await q("SELECT count(*)::int n FROM coupons WHERE code=$1", [coupon.code])).rows[0].n, 1);
});

test('correções da revisão: reembolso pedido segura a liberação, pedido devolvido sai do saldo, cupom diferente não reaproveita pedido, repasse e troca de comissão protegidos', async () => {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const url = `/admin/afiliados/${aff.id}`;
  // M1: pedido de reembolso aberto não deixa a comissão ser liberada
  const t0 = await totals();
  const p = await approve(); const cm = await commOf(p.order.id);
  await q("UPDATE commissions SET release_at = now() - interval '1 minute' WHERE id=$1", [cm.id]);
  assert.equal((await totals()).released, t0.released + 1000);
  const uid = (await q('SELECT user_id FROM orders WHERE id=$1', [p.order.id])).rows[0].user_id;
  const rr = (await q("INSERT INTO refund_requests (order_id, requested_by, reason, status) VALUES ($1,$2,'quero devolver','requested') RETURNING id", [p.order.id, uid])).rows[0].id;
  let tt = await totals(); assert.equal(tt.released, t0.released, 'sai do liberado'); assert.equal(tt.grace, t0.grace + 1000, 'fica aguardando a decisão');
  assert.match((await admin.get(url)).text, /Em análise/);
  await q("UPDATE refund_requests SET status='rejected' WHERE id=$1", [rr]);
  assert.equal((await totals()).released, t0.released + 1000, 'recusado: volta a ser liberada');
  // M2: pedido devolvido nunca conta como a receber, mesmo se a comissão não foi cancelada
  await q("UPDATE orders SET status='refunded' WHERE id=$1", [p.order.id]);
  tt = await totals(); assert.equal(tt.released, t0.released); assert.equal(tt.cancelled, t0.cancelled + 1000);
  await q("UPDATE orders SET status='approved' WHERE id=$1", [p.order.id]);
  // M3: outro cupom, mesmo comprador e mesmo valor: pedido novo, comissão do afiliado certo
  const b2 = await newAffiliate('Bia Segunda', 'bia@example.com'); const c2 = await newCoupon(b2.id, '5', 'AFF-BIA');
  const same = { email: 'mesmo.comprador@example.com' };
  const o1 = await buy(same, coupon.code); const o2 = await buy({ ...same, cpf: o1.f.cpf }, c2.code);
  assert.notEqual(o1.pub, o2.pub, 'cupom diferente gera outro pedido');
  assert.equal(String(o2.order.coupon_id), String(c2.id));
  await sim(o2.pub, 'approved'); assert.equal(String((await commOf(o2.order.id)).affiliate_id), String(b2.id));
  // M4: repasse enviado duas vezes seguidas grava uma vez
  const n0 = (await q('SELECT count(*)::int n FROM affiliate_payouts WHERE affiliate_id=$1', [aff.id])).rows[0].n;
  await admin.post(`${url}/repasses`, { amount: '7,77', paid_on: day }, url); await admin.post(`${url}/repasses`, { amount: '7,77', paid_on: day }, url);
  assert.equal((await q('SELECT count(*)::int n FROM affiliate_payouts WHERE affiliate_id=$1', [aff.id])).rows[0].n, n0 + 1);
  // M5: com compra em andamento, o afiliado e a comissão do cupom não mudam
  const c3 = await newCoupon(b2.id, '5', 'AFF-PEND'); await buy({}, c3.code);
  const chg = await admin.post(`/admin/cupons/${c3.id}`, { kind: 'percent', percent: '20', max_uses: '500', courses: [String(course)], affiliate_id: String(b2.id), commission_pct: '40' }, `/admin/cupons/${c3.id}`);
  assert.equal(chg.status, 422); assert.match(chg.text, /compras em andamento/);
  assert.equal(Number((await q('SELECT commission_pct FROM coupons WHERE id=$1', [c3.id])).rows[0].commission_pct), 5);
});
