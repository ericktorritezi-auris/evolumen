'use strict';
// 2.5.2 · Cupom de afiliado durante a promoção: sem desconto, mas a venda é registrada para quem indicou.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady } = require('./helpers');
const P = require('../src/promotions');
const S = require('../src/sales');
const C = require('../src/courses');

let t; let admin; let A; let B; let cpfN = 100; let AF; let CP_AF; let CP_PL; let CP_INACT;
const q = (sql, p) => t.pool.query(sql, p);
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';
function genCpf(n) {
  const d = String(100000000 + n * 7919).slice(0, 9).split('').map(Number);
  for (let k = 0; k < 2; k++) { const len = 9 + k; const sum = d.slice(0, len).reduce((a, v, i) => a + v * (len + 1 - i), 0); const r = (sum * 10) % 11; d.push(r === 10 ? 0 : r); }
  return d.join('');
}
const form = (over = {}) => ({ name: 'Bruna Compradora', email: `aff${cpfN}@example.com`, phone: '11987654321', cpf: genCpf(++cpfN), cep: '01310100', street: 'Av. Paulista', street_number: '1000', complement: '', district: 'Bela Vista', city: 'São Paulo', state: 'SP', method: 'pix', accept: '1', ...over });
const buy = async (slug, over = {}) => { const b = new Browser(t.base); const r = await b.post(`/checkout/${slug}`, form(over), `/checkout/${slug}`); return { b, r, pub: r.location ? r.location.replace('/pedido/', '') : null }; };
const sim = (id, result) => admin.post(`/admin/simulador/${id}`, { result }, '/admin/simulador');
const inH = (h) => P.localInput(new Date(Date.now() + h * 3600000));
const startPromo = async (over = {}) => { await q("UPDATE promotions SET status='inactive'"); await admin.post('/admin/promocoes', { name: 'Black Friday 2026', kind: 'percent', percent: '50', starts_at: inH(-1), ends_at: inH(48), scope: 'all', ...over }, '/admin/promocoes/nova'); await P.refresh(true); };
const endPromos = async () => { await q("UPDATE promotions SET status='inactive'"); P.invalidate(); await P.refresh(true); };
const mk = async (slug, title, price) => {
  await admin.post('/admin/cursos', { title, slug, summary: 'R', description: 'D', price, level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice: '' }, '/admin/cursos/novo');
  const id = (await q('SELECT id FROM courses WHERE slug=$1', [slug])).rows[0].id;
  await q("UPDATE courses SET status='published', published_at=now() - interval '1 day' WHERE id=$1", [id]);
  const mod = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'M',1) RETURNING id", [id])).rows[0].id;
  await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'A',1,'dQw4w9WgXcQ')", [id, mod]);
  return id;
};

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await q("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy','affiliate')", [LONG]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING");
  A = await mk('aff-a', 'Curso A', '200,00'); B = await mk('aff-b', 'Curso B', '100,00');
  AF = (await q("INSERT INTO affiliates (name, email, status) VALUES ('Maria Souza','maria@afiliada.com','active') RETURNING id")).rows[0].id;
  const iaf = (await q("INSERT INTO affiliates (name, email, status) VALUES ('João Inativo','joao@afiliado.com','inactive') RETURNING id")).rows[0].id;
  CP_AF = (await q("INSERT INTO coupons (code, kind, percent, affiliate_id, commission_pct, max_uses) VALUES ('EVO-MARIA20','percent',20,$1,20,50) RETURNING id", [AF])).rows[0].id;
  CP_INACT = (await q("INSERT INTO coupons (code, kind, percent, affiliate_id, commission_pct, max_uses) VALUES ('EVO-JOAO10','percent',10,$1,20,50) RETURNING id", [iaf])).rows[0].id;
  CP_PL = (await q("INSERT INTO coupons (code, kind, percent, max_uses) VALUES ('EVO-LOJA10','percent',10,50) RETURNING id")).rows[0].id;
  for (const id of [CP_AF, CP_INACT, CP_PL]) await q('INSERT INTO coupon_courses (coupon_id, course_id) VALUES ($1,$2),($1,$3)', [id, A, B]);
});
after(async () => { await t.close(); });

test('cupom de afiliado em promoção: fica no campo, sem desconto, com aviso e primeiro nome', async () => {
  await startPromo();
  const page = (await new Browser(t.base).get('/checkout/aff-a?cupom=EVO-MARIA20')).text;
  assert.match(page, /value="EVO-MARIA20"/); assert.match(page, /não será aplicado porque existe uma promoção em vigor/); assert.match(page, /registrada para quem o indicou: Maria\./);
  assert.doesNotMatch(page, /Souza/); assert.doesNotMatch(page, /não pode ser usado agora/);
  assert.match(page, /R\$\s?100,00/, 'preço continua o promocional');
  const prod = (await new Browser(t.base).get('/cursos/aff-a?cupom=EVO-MARIA20')).text; assert.match(prod, /registrada para quem o indicou/); assert.match(prod, /Maria/);
});

test('cupom da plataforma, de afiliado inativo, inexistente ou de outro produto: mensagens de hoje', async () => {
  for (const code of ['EVO-LOJA10', 'EVO-JOAO10', 'EVO-NAOEXISTE']) {
    const page = (await new Browser(t.base).get(`/checkout/aff-a?cupom=${code}`)).text;
    assert.match(page, /não pode ser usado agora porque o site está com preço promocional/, code);
    assert.doesNotMatch(page, /registrada para quem o indicou/, code);
  }
  const post = await buy('aff-a', { cupom: 'EVO-LOJA10' }); assert.equal(post.r.status, 422);
  await q("UPDATE coupons SET max_uses = 1 WHERE id = $1", [CP_AF]); await q('INSERT INTO coupon_redemptions (coupon_id, user_id, course_id) SELECT $1, id, $2 FROM users LIMIT 1', [CP_AF, A]);
  const exh = (await new Browser(t.base).get('/checkout/aff-a?cupom=EVO-MARIA20')).text; assert.match(exh, /não está mais válido/, 'cupom esgotado segue a recusa');
  await q('DELETE FROM coupon_redemptions WHERE coupon_id = $1', [CP_AF]); await q('UPDATE coupons SET max_uses = 50 WHERE id = $1', [CP_AF]);
});

test('compra em promoção com cupom de afiliado: preço promocional, comissão normal e cupom não é gasto', async () => {
  const { r, pub } = await buy('aff-a', { cupom: 'EVO-MARIA20' }); assert.equal(r.status, 303);
  const o = (await q('SELECT * FROM orders WHERE public_id=$1', [pub])).rows[0];
  assert.equal(o.price_cents, 10000); assert.equal(o.price_source, 'campaign'); assert.equal(Number(o.coupon_id), Number(CP_AF)); assert.ok(o.campaign_id);
  await sim(pub, 'approved');
  const cm = (await q('SELECT * FROM commissions WHERE order_id=$1', [o.id])).rows[0];
  assert.ok(cm, 'a venda foi registrada para o afiliado'); assert.equal(Number(cm.affiliate_id), Number(AF)); assert.equal(Number(cm.pct), 20); assert.equal(cm.base_cents, 10000); assert.equal(cm.amount_cents, 2000);
  assert.equal((await q('SELECT count(*)::int n FROM coupon_redemptions WHERE coupon_id=$1', [CP_AF])).rows[0].n, 0, 'não conta como uso');
  const oid = o.id; assert.match((await admin.get(`/admin/vendas/${oid}`)).text, /cupom de afiliado registrado, sem desconto/);
  // a venda aparece no painel do afiliado como qualquer outra (lista de vendas do afiliado)
  const A2 = require('../src/affiliates'); const sales = await A2.salesOf(AF); assert.ok(sales.some((x) => String(x.order_id || x.id) && Number(x.amount_cents) === 2000));
});

test('pedido pendente em promoção não reserva o cupom e depois da promoção o desconto volta', async () => {
  const pend = await buy('aff-b', { cupom: 'EVO-MARIA20' }); assert.equal(pend.r.status, 303); // fica pendente
  await endPromos();
  const ok = (await new Browser(t.base).get('/checkout/aff-b?cupom=EVO-MARIA20')).text;
  assert.match(ok, /Cupom EVO-MARIA20 aplicado/); assert.doesNotMatch(ok, /Este cupom está reservado|já está usando este cupom|Você já usou/);
  const sale = await buy('aff-b', { cupom: 'EVO-MARIA20' }); assert.equal(sale.r.status, 303);
  const o = (await q('SELECT price_cents, price_source FROM orders WHERE public_id=$1', [sale.pub])).rows[0]; assert.equal(o.price_cents, 8000); assert.equal(o.price_source, 'coupon');
  await sim(sale.pub, 'approved');
  assert.equal((await q('SELECT count(*)::int n FROM coupon_redemptions WHERE coupon_id=$1', [CP_AF])).rows[0].n, 1);
});

test('autocompra do afiliado em promoção: sem comissão, como sempre', async () => {
  await startPromo({ name: 'Segunda' });
  const n = (await q('SELECT count(*)::int n FROM commissions')).rows[0].n;
  const own = await buy('aff-a', { cupom: 'EVO-MARIA20', email: 'maria@afiliada.com', name: 'Maria Souza' }); assert.equal(own.r.status, 303);
  await sim(own.pub, 'approved');
  assert.equal((await q('SELECT count(*)::int n FROM commissions')).rows[0].n, n);
});

test('preço central: pricing não soma cupom e guarda o cupom só para atribuição', async () => {
  await startPromo({ name: 'Terceira' });
  const cp = await require('../src/coupons').byCode('EVO-MARIA20'); const pr = S.pricing(await C.byId(A), cp);
  assert.equal(pr.final, 10000); assert.equal(pr.source, 'campaign'); assert.equal(pr.coupon, null); assert.equal(Number(pr.attributed.id), Number(CP_AF));
});

test('e-mail padrão aos afiliados ao criar a promoção: opção marcada, uma vez só, respeita quem não quer e-mails', async () => {
  const { mailer } = require('./helpers');
  await endPromos();
  const form0 = (await admin.get('/admin/promocoes/nova')).text;
  assert.match(form0, /Avisar os afiliados por e-mail/); assert.match(form0, /name="notify_affiliates" value="1" checked/, 'vem marcada por padrão');
  await q("INSERT INTO affiliates (name, email, status) VALUES ('Sem Cupom','semcupom@afiliado.com','active')");
  const optId = (await q("INSERT INTO affiliates (name, email, status) VALUES ('Quer Silêncio','silencio@afiliado.com','active') RETURNING id")).rows[0].id;
  await q("INSERT INTO coupons (code, kind, percent, affiliate_id, commission_pct, max_uses) VALUES ('EVO-SIL10','percent',10,$1,20,50)", [optId]);
  await q("INSERT INTO email_optouts (email) VALUES ('silencio@afiliado.com') ON CONFLICT DO NOTHING");
  mailer.memory.length = 0;
  const r = await admin.post('/admin/promocoes', { name: 'Aviso Afiliados', kind: 'percent', percent: '30', starts_at: inH(-1), ends_at: inH(48), scope: 'all', notify_form: '1', notify_affiliates: '1' }, '/admin/promocoes/nova');
  assert.equal(r.status, 303);
  await new Promise((ok) => { const w = (n) => (mailer.memory.length || n > 40 ? ok() : setTimeout(() => w(n + 1), 100)); w(0); });
  const to = mailer.memory.map((m) => m.to);
  assert.ok(to.includes('maria@afiliada.com'), 'afiliada ativa com cupom recebe');
  assert.ok(!to.includes('joao@afiliado.com'), 'afiliado inativo não recebe');
  assert.ok(!to.includes('semcupom@afiliado.com'), 'sem cupom em vigor não recebe');
  assert.ok(!to.includes('silencio@afiliado.com'), 'quem pediu para não receber e-mails fica de fora');
  const m = mailer.memory.find((x) => x.to === 'maria@afiliada.com');
  assert.match(m.subject, /Aviso Afiliados/); assert.match(m.html, /Olá, Maria/); assert.match(m.html, /desconto do seu cupom não é aplicado/); assert.match(m.html, /mesmo assim/); assert.match(m.html, /continua sendo afiliado/);
  await new Promise((ok) => setTimeout(ok, 300));
  const id = (await q("SELECT id, affiliates_notified_count n FROM promotions WHERE name='Aviso Afiliados'")).rows[0];
  assert.ok(id.n >= 1);
  assert.match((await admin.get(`/admin/promocoes/${id.id}`)).text, /E-mail aos afiliados enviado em/);
  mailer.memory.length = 0;
  await admin.post(`/admin/promocoes/${id.id}/avisar-afiliados`, {}, `/admin/promocoes/${id.id}`);
  assert.equal(mailer.memory.length, 0, 'não envia duas vezes');
});

test('desmarcar a opção não envia e-mail; o botão envia depois', async () => {
  const { mailer } = require('./helpers');
  await endPromos(); mailer.memory.length = 0;
  const r = await admin.post('/admin/promocoes', { name: 'Sem Aviso', kind: 'percent', percent: '10', starts_at: inH(-1), ends_at: inH(48), scope: 'all', notify_form: '1' }, '/admin/promocoes/nova');
  assert.equal(r.status, 303); assert.equal(mailer.memory.length, 0);
  const id = (await q("SELECT id FROM promotions WHERE name='Sem Aviso'")).rows[0].id;
  assert.match((await admin.get(`/admin/promocoes/${id}`)).text, /Enviar e-mail aos afiliados/);
  await admin.post(`/admin/promocoes/${id}/avisar-afiliados`, {}, `/admin/promocoes/${id}`);
  await new Promise((ok) => { const w = (n) => (mailer.memory.length || n > 40 ? ok() : setTimeout(() => w(n + 1), 100)); w(0); });
  assert.ok(mailer.memory.some((m) => m.to === 'maria@afiliada.com'));
});

test('revisão: dois cliques no botão enviam uma vez; cupom agendado não conta; promoção encerrada não oferece o botão', async () => {
  const { mailer } = require('./helpers');
  await endPromos();
  // afiliado só com cupom agendado: não é avisado
  const a2 = (await q("INSERT INTO affiliates (name, email, status) VALUES ('Agendado','agendado@afiliado.com','active') RETURNING id")).rows[0].id;
  await q("INSERT INTO coupons (code, kind, percent, affiliate_id, commission_pct, max_uses, starts_on) VALUES ('EVO-AG10','percent',10,$1,20,50, current_date + 10)", [a2]);
  mailer.memory.length = 0;
  await admin.post('/admin/promocoes', { name: 'Duplo Clique', kind: 'percent', percent: '10', starts_at: inH(-1), ends_at: inH(48), scope: 'all', notify_form: '1' }, '/admin/promocoes/nova');
  const id = (await q("SELECT id FROM promotions WHERE name='Duplo Clique'")).rows[0].id;
  await Promise.all([admin.post(`/admin/promocoes/${id}/avisar-afiliados`, {}, `/admin/promocoes/${id}`), admin.post(`/admin/promocoes/${id}/avisar-afiliados`, {}, `/admin/promocoes/${id}`)]);
  await new Promise((ok) => setTimeout(ok, 600));
  const to = mailer.memory.map((m) => m.to);
  assert.equal(to.filter((x) => x === 'maria@afiliada.com').length, 1, 'uma vez só');
  assert.ok(!to.includes('semcom@afiliado.com') && !to.includes('agendado@afiliado.com'));
  await q("UPDATE promotions SET starts_at = now() - interval '3 days', ends_at = now() - interval '1 day', affiliates_notified_at = NULL, affiliates_notified_count = NULL WHERE id = $1", [id]);
  assert.doesNotMatch((await admin.get(`/admin/promocoes/${id}`)).text, /Enviar e-mail aos afiliados/);
});
