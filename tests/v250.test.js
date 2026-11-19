'use strict';
// 2.5.0 · Promoções do site: preço central, cupom suspenso, sobreposição, comissão, vigência, relatórios.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent, mailer } = require('./helpers');
const S = require('../src/sales');
const C = require('../src/courses');
const P = require('../src/promotions');

let t; let admin; let A; let B; let D; let FREE; let cpfN = 0;
const q = (sql, p) => t.pool.query(sql, p);
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';
function genCpf(n) {
  const d = String(100000000 + n * 7919).slice(0, 9).split('').map(Number);
  for (let k = 0; k < 2; k++) { const len = 9 + k; const sum = d.slice(0, len).reduce((a, v, i) => a + v * (len + 1 - i), 0); const r = (sum * 10) % 11; d.push(r === 10 ? 0 : r); }
  return d.join('');
}
const form = (over = {}) => ({ name: 'Bruna Compradora', email: `promo${cpfN}@example.com`, phone: '11987654321', cpf: genCpf(++cpfN), cep: '01310100', street: 'Av. Paulista', street_number: '1000', complement: '', district: 'Bela Vista', city: 'São Paulo', state: 'SP', method: 'pix', accept: '1', ...over });
const buy = async (slug, over = {}) => { const b = new Browser(t.base); const r = await b.post(`/checkout/${slug}`, form(over), `/checkout/${slug}`); return { b, r, pub: r.location ? r.location.replace('/pedido/', '') : null }; };
const sim = (id, result) => admin.post(`/admin/simulador/${id}`, { result }, '/admin/simulador');
const fmtLocal = (d) => P.localInput(d);
const inH = (h) => new Date(Date.now() + h * 3600000);
const promoBody = (over = {}) => ({ name: 'Janeiro Branco', kind: 'percent', percent: '50', starts_at: fmtLocal(inH(-1)), ends_at: fmtLocal(inH(48)), scope: 'all', ...over });
const newPromo = async (over) => { const r = await admin.post('/admin/promocoes', promoBody(over), '/admin/promocoes/nova'); await P.refresh(true); return r; };
const clearPromos = async () => { await q('UPDATE promotions SET status=$1', ['inactive']); P.invalidate(); await P.refresh(true); };
const mk = async (slugName, title, price, extra = '') => {
  await admin.post('/admin/cursos', { title, slug: slugName, summary: 'R', description: 'D', price, level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice: '' }, '/admin/cursos/novo');
  const id = (await q('SELECT id FROM courses WHERE slug=$1', [slugName])).rows[0].id;
  await q("UPDATE courses SET status='published', published_at=now() - interval '1 day' WHERE id=$1", [id]);
  const mod = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'M',1) RETURNING id", [id])).rows[0].id;
  await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'A',1,'dQw4w9WgXcQ')", [id, mod]);
  return id;
};

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await q("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy','affiliate')", [LONG]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING");
  A = await mk('curso-a', 'Curso A', '200,00'); B = await mk('curso-b', 'Curso B', '100,00'); D = await mk('curso-d', 'Curso D', '30,00');
  FREE = await mk('curso-livre', 'Curso Livre', '0,00').catch(() => null);
});
after(async () => { await t.close(); });

test('tela Cupons e promoções: botões, título e menu', async () => {
  const p = (await admin.get('/admin/cupons')).text;
  assert.match(p, /Cupons e promoções/); assert.match(p, /Nova promoção/); assert.match(p, /Novo cupom/); assert.match(p, /Promoções do site/);
  assert.equal((await admin.get('/admin/promocoes/nova')).status, 200);
});

test('validação: nome, desconto, datas e produtos', async () => {
  let r = await admin.post('/admin/promocoes', { ...promoBody(), name: '', percent: '100' }, '/admin/promocoes/nova');
  assert.equal(r.status, 422); assert.match(r.text, /nome da promoção/i); assert.match(r.text, /1 a 99/);
  r = await admin.post('/admin/promocoes', promoBody({ ends_at: fmtLocal(inH(-5)) }), '/admin/promocoes/nova'); assert.equal(r.status, 422); assert.match(r.text, /depois do início/);
  r = await admin.post('/admin/promocoes', promoBody({ scope: 'selected' }), '/admin/promocoes/nova'); assert.equal(r.status, 422); assert.match(r.text, /ao menos um produto/i);
  r = await admin.post('/admin/promocoes', promoBody({ kind: 'fixed', amount: '' }), '/admin/promocoes/nova'); assert.equal(r.status, 422);
  assert.equal((await q('SELECT count(*)::int n FROM promotions')).rows[0].n, 0);
});

test('porcentagem: preço central, tag, faixa e produto fora da seleção', async () => {
  const r = await newPromo({ scope: 'selected', courses: [String(A)] });
  assert.equal(r.status, 303);
  const ca = await C.byId(A); const cb = await C.byId(B);
  assert.equal(C.effectivePrice(ca).cents, 10000); assert.equal(C.effectivePrice(ca).original, 20000);
  assert.equal(C.effectivePrice(cb).cents, 10000); assert.equal(C.effectivePrice(cb).original, null);
  const home = (await new Browser(t.base).get('/')).text;
  assert.match(home, /Janeiro Branco · 50% off/); assert.match(home, /Estamos com preço promocional/); assert.match(home, /promobar/);
  const page = (await new Browser(t.base).get('/cursos/curso-a')).text; assert.match(page, /Janeiro Branco · 50% off/); assert.match(page, /R\$\s?100,00/);
  const pageB = (await new Browser(t.base).get('/cursos/curso-b')).text; assert.doesNotMatch(pageB, /ptag/);
  const co = (await new Browser(t.base).get('/checkout/curso-a')).text; assert.match(co, /Janeiro Branco/); assert.match(co, /R\$\s?100,00/);
});

test('pedido guarda campanha, preço e origem; Mercado Pago/pagamento usa o valor do banco', async () => {
  const { r, pub } = await buy('curso-a'); assert.equal(r.status, 303);
  const o = (await q('SELECT * FROM orders WHERE public_id=$1', [pub])).rows[0];
  assert.equal(o.price_cents, 10000); assert.equal(o.list_cents, 20000); assert.equal(o.price_source, 'campaign'); assert.equal(o.campaign_name, 'Janeiro Branco'); assert.ok(o.campaign_id);
  await sim(pub, 'approved');
  assert.equal((await q('SELECT status FROM orders WHERE public_id=$1', [pub])).rows[0].status, 'approved');
  const oid = (await q('SELECT id FROM orders WHERE public_id=$1', [pub])).rows[0].id; const adm = (await admin.get(`/admin/vendas/${oid}`)).text; assert.match(adm, /promoção do site: Janeiro Branco/);
});

test('cupom da plataforma suspenso durante a promoção, valendo normal no produto fora dela', async () => {
  const cp = (await q("INSERT INTO coupons (code, kind, percent, max_uses, ends_on) VALUES ('EVO-PROMO1','percent',30,50, current_date + 30) RETURNING id")).rows[0].id;
  await q('INSERT INTO coupon_courses (coupon_id, course_id) VALUES ($1,$2),($1,$3)', [cp, A, B]);
  const af = (await q("INSERT INTO affiliates (name, email, status) VALUES ('Afi Promo','afi@promo.com','active') RETURNING id")).rows[0].id;
  const ac = (await q("INSERT INTO coupons (code, kind, percent, affiliate_id, commission_pct, max_uses) VALUES ('EVO-AFI20','percent',20,$1,20,50) RETURNING id", [af])).rows[0].id;
  await q('INSERT INTO coupon_courses (coupon_id, course_id) VALUES ($1,$2),($1,$3)', [ac, A, B]);
  // produto A está em promoção: cupom da plataforma é recusado com aviso (o de afiliado só registra a venda: veja v252)
  for (const code of ['EVO-PROMO1']) {
    const page = (await new Browser(t.base).get(`/checkout/curso-a?cupom=${code}`)).text;
    assert.match(page, /não pode ser usado agora porque o site está com preço promocional/); assert.match(page, /volta a valer/);
    const post = await buy('curso-a', { cupom: code }); assert.equal(post.r.status, 422); assert.match(post.r.text, /preço promocional/);
  }
  assert.match((await new Browser(t.base).get('/cursos/curso-a?cupom=EVO-PROMO1')).text, /não pode ser usado agora/);
  // produto B, fora da promoção: cupom vale normalmente
  const ok = await buy('curso-b', { cupom: 'EVO-PROMO1' }); assert.equal(ok.r.status, 303);
  const o = (await q('SELECT * FROM orders WHERE public_id=$1', [ok.pub])).rows[0]; assert.equal(o.price_cents, 7000); assert.equal(o.price_source, 'coupon');
  // preço central: nunca soma
  const pr = S.pricing(await C.byId(A), (await require('../src/coupons').byCode('EVO-PROMO1')));
  assert.equal(pr.final, 10000); assert.equal(pr.source, 'campaign'); assert.equal(pr.coupon, null);
});

test('comissão do afiliado: percentual igual, valor sobre o preço promocional pago (cupom só fora da promoção)', async () => {
  await clearPromos();
  const afBuy = await buy('curso-b', { cupom: 'EVO-AFI20' }); assert.equal(afBuy.r.status, 303);
  await sim(afBuy.pub, 'approved');
  const c = (await q('SELECT * FROM commissions ORDER BY id DESC LIMIT 1')).rows[0];
  assert.equal(Number(c.pct), 20); assert.equal(c.base_cents, 8000); assert.equal(c.amount_cents, 1600);
  // venda em promoção, sem cupom: não há comissão de cupom e o pedido guarda o valor promocional
  await newPromo({ name: 'Semana Ouro', percent: '40' });
  const n = (await q('SELECT count(*)::int n FROM commissions')).rows[0].n;
  const sale = await buy('curso-b'); await sim(sale.pub, 'approved');
  assert.equal((await q('SELECT count(*)::int n FROM commissions')).rows[0].n, n);
  assert.equal((await q('SELECT price_cents FROM orders WHERE public_id=$1', [sale.pub])).rows[0].price_cents, 6000);
});

test('valor fixo: produto em que o desconto zera fica fora; os demais entram', async () => {
  await clearPromos();
  await newPromo({ name: 'R$ 50', kind: 'fixed', amount: '50,00' });
  assert.equal(C.effectivePrice(await C.byId(A)).cents, 15000);
  assert.equal(C.effectivePrice(await C.byId(B)).cents, 5000);
  const d = C.effectivePrice(await C.byId(D)); assert.equal(d.cents, 3000); assert.equal(d.original, null); assert.equal(d.campaign, undefined, 'sem promoção e sem bloqueio de cupom');
  const tag = (await new Browser(t.base).get('/cursos/curso-d')).text; assert.doesNotMatch(tag, /ptag/);
  if (FREE) assert.equal(C.effectivePrice(await C.byId(FREE)).cents, 0);
});

test('sobreposição: duas promoções ativas no mesmo produto e período não passam; produtos diferentes passam', async () => {
  await clearPromos();
  await newPromo({ name: 'Só A', scope: 'selected', courses: [String(A)] });
  let r = await admin.post('/admin/promocoes', promoBody({ name: 'Conflito', scope: 'selected', courses: [String(A), String(B)] }), '/admin/promocoes/nova');
  assert.equal(r.status, 422); assert.match(r.text, /Já existe a promoção/);
  r = await admin.post('/admin/promocoes', promoBody({ name: 'Todos', scope: 'all' }), '/admin/promocoes/nova'); assert.equal(r.status, 422);
  r = await admin.post('/admin/promocoes', promoBody({ name: 'Só B', scope: 'selected', courses: [String(B)] }), '/admin/promocoes/nova'); assert.equal(r.status, 303);
  r = await admin.post('/admin/promocoes', promoBody({ name: 'Depois', scope: 'selected', courses: [String(A)], starts_at: fmtLocal(inH(100)), ends_at: fmtLocal(inH(150)) }), '/admin/promocoes/nova'); assert.equal(r.status, 303, 'período diferente não conflita');
});

test('promoção do produto + promoção do site: vale o menor; renovação fica de fora', async () => {
  await clearPromos();
  await newPromo({ name: 'Metade', percent: '50' });
  await q('UPDATE courses SET promo_price_cents = 8000 WHERE id=$1', [A]);   // própria: 80,00; site: 100,00
  let e = C.effectivePrice(await C.byId(A)); assert.equal(e.cents, 8000); assert.equal(e.campaignWins, false); assert.ok(e.campaign, 'cupom segue suspenso');
  assert.equal(S.pricing(await C.byId(A), null).source, 'promo');
  await q('UPDATE courses SET promo_price_cents = 15000 WHERE id=$1', [A]);  // própria: 150,00; site: 100,00 vence
  e = C.effectivePrice(await C.byId(A)); assert.equal(e.cents, 10000); assert.equal(e.campaignWins, true);
  const ren = S.pricing(await C.byId(A), null, { renewal: true }); assert.equal(ren.source, 'renewal'); assert.equal(ren.final, 15000, 'renovação usa só a promoção do produto, nunca a do site');
  await q('UPDATE courses SET promo_price_cents = NULL WHERE id=$1', [A]);
});

test('vigência: início, fim e inativação (sem agendador) e volta ao normal', async () => {
  await clearPromos();
  await newPromo({ name: 'Futura', starts_at: fmtLocal(inH(5)), ends_at: fmtLocal(inH(9)) });
  const a = await C.byId(A);
  assert.equal(C.effectivePrice(a).cents, 20000, 'ainda não começou');
  assert.equal(C.effectivePrice(a, inH(6)).cents, 10000, 'dentro do período');
  assert.equal(C.effectivePrice(a, inH(10)).cents, 20000, 'depois do fim volta ao normal');
  assert.doesNotMatch((await new Browser(t.base).get('/')).text, /promobar/);
  await clearPromos();
  await newPromo({ name: 'Ativa' }); const id = (await q("SELECT id FROM promotions WHERE name='Ativa'")).rows[0].id;
  assert.equal(C.effectivePrice(a).cents, 10000);
  await admin.post(`/admin/promocoes/${id}/inativar`, {}, `/admin/promocoes/${id}`);
  assert.equal(C.effectivePrice(a).cents, 20000); assert.doesNotMatch((await new Browser(t.base).get('/')).text, /Estamos com preço promocional/);
});

test('pedido antigo não muda quando a promoção muda; edição e relatório financeiro', async () => {
  await clearPromos();
  await newPromo({ name: 'Relatório', percent: '25' });
  const s1 = await buy('curso-b'); await sim(s1.pub, 'approved');
  const o = (await q('SELECT price_cents, list_cents, price_source FROM orders WHERE public_id=$1', [s1.pub])).rows[0]; assert.equal(o.price_cents, 7500);
  const id = (await q("SELECT id FROM promotions WHERE name='Relatório'")).rows[0].id;
  const edit = await admin.post(`/admin/promocoes/${id}`, promoBody({ name: 'Relatório', percent: '60' }), `/admin/promocoes/${id}`); assert.equal(edit.status, 303);
  assert.equal((await q('SELECT price_cents FROM orders WHERE public_id=$1', [s1.pub])).rows[0].price_cents, 7500);
  const F = require('../src/finance'); const per = F.period('mes', new Date());
  const d = await F.summary(per, null); assert.ok(d.sales.withCampaign >= 2); assert.ok(d.sales.campaignOff > 0); assert.ok(d.sales.campaignGross > 0);
  assert.match((await admin.get('/admin/financeiro')).text, /Vendas em promoção/);
  assert.match((await admin.get(`/admin/promocoes/${id}`)).text, /vendas? nesta promoção/);
});

test('acesso: só administrador mexe em promoções', async () => {
  const anon = new Browser(t.base);
  assert.notEqual((await anon.get('/admin/promocoes/nova')).status, 200);
  const r = await anon.post('/admin/promocoes', promoBody(), '/entrar'); assert.notEqual(r.status, 303 === r.status && /promocoes\/\d/.test(r.location || '') ? 0 : 999);
  const n = (await q('SELECT count(*)::int n FROM promotions')).rows[0].n;
  await anon.post('/admin/promocoes', promoBody({ name: 'Intruso' }), '/entrar');
  assert.equal((await q('SELECT count(*)::int n FROM promotions')).rows[0].n, n);
});

test('revisão: fim com hora aparece na faixa, ids inexistentes não quebram e envio simultâneo não duplica', async () => {
  await clearPromos();
  await newPromo({ name: 'Hora', ends_at: fmtLocal(new Date(new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T03:00:00Z')) });
  assert.match((await new Browser(t.base).get('/')).text, /até \d\d\/\d\d às \d\d:\d\d/);
  await clearPromos();
  const bad = await admin.post('/admin/promocoes', promoBody({ scope: 'selected', courses: ['999999'] }), '/admin/promocoes/nova');
  assert.equal(bad.status, 422);
  const [r1, r2] = await Promise.all([admin.post('/admin/promocoes', promoBody({ name: 'Par 1' }), '/admin/promocoes/nova'), admin.post('/admin/promocoes', promoBody({ name: 'Par 2' }), '/admin/promocoes/nova')]);
  assert.equal([r1.status, r2.status].sort().join(), '303,422');
  assert.equal((await q("SELECT count(*)::int n FROM promotions WHERE status='active' AND name LIKE 'Par%'")).rows[0].n, 1);
});
