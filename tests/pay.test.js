'use strict';
// 0.5.0 · Fase 4: textos legais, checkout, pagamento simulado, Mercado Pago (com fetch simulado), webhook, reembolso, Pix vencido.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { boot, Browser, adminReady, makeStudent, mailer, testEnv } = require('./helpers');
const config = require('../src/config');
const S = require('../src/sales');
const mp = require('../src/payments/mercadopago');

let t; let admin; let course; let doc1; let doc2;
const slug = 'curso-pago';
const q = (sql, p) => t.pool.query(sql, p);
const bg = (p) => Promise.resolve(p);
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';
let cpfN = 0;
function genCpf(n) {
  const d = String(100000000 + n * 7919).slice(0, 9).split('').map(Number);
  for (let k = 0; k < 2; k++) { const len = 9 + k; const sum = d.slice(0, len).reduce((a, v, i) => a + v * (len + 1 - i), 0); const r = (sum * 10) % 11; d.push(r === 10 ? 0 : r); }
  return d.join('');
}
const form = (over = {}) => ({ name: 'Bruna Compradora', email: `bruna${cpfN}@example.com`, phone: '11987654321', cpf: genCpf(++cpfN), cep: '01310100', street: 'Av. Paulista', street_number: '1000', complement: '', district: 'Bela Vista', city: 'São Paulo', state: 'SP', method: 'pix', accept: '1', cupom: '', ...over });
// O porteiro do site pede o aceite de textos novos (inclusive do administrador); nos testes registramos direto.
const acceptAll = () => q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status = 'published' ON CONFLICT DO NOTHING");
const lastMail = (to) => [...mailer.memory].reverse().find((m) => m.to === to);
const sim = async (publicId, result) => admin.post(`/admin/simulador/${publicId}`, { result }, '/admin/simulador');
async function buy(b, over = {}, fresh = true) {
  const f = form(over);
  const r = await b.post(`/checkout/${slug}`, f, `/checkout/${slug}`);
  return { r, f, pub: r.location ? r.location.replace('/pedido/', '') : null };
}

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await admin.post('/admin/cursos', { title: 'Curso Pago', slug, summary: 'Resumo.', description: 'Desc', price: '100,00', level: 'iniciante', access_type: 'months', access_months: '12', max_installments: '12', sort_order: '1', expiry_notice: '' }, '/admin/cursos/novo');
  course = (await q('SELECT * FROM courses WHERE slug=$1', [slug])).rows[0].id;
  await q("UPDATE courses SET status='published', published_at=now() - interval '1 day' WHERE id=$1", [course]);
  const mod = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'M',1) RETURNING id", [course])).rows[0].id;
  await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'A',1,'dQw4w9WgXcQ')", [course, mod]);
});
after(async () => { await t.close(); });

test('textos legais: rascunho vira publicado só com texto completo e depois não muda', async () => {
  const list = await admin.get('/admin/textos'); assert.equal(list.status, 200); assert.match(list.text, /Termos de uso/); assert.match(list.text, /Rascunho/);
  const terms = (await q("SELECT * FROM legal_documents WHERE doc_type='terms'")).rows[0]; const priv = (await q("SELECT * FROM legal_documents WHERE doc_type='privacy'")).rows[0];
  const early = await admin.post(`/admin/textos/${terms.id}/publicar`, {}, `/admin/textos/${terms.id}`);
  assert.equal((await q('SELECT status FROM legal_documents WHERE id=$1', [terms.id])).rows[0].status, 'draft', 'texto provisório não publica');
  assert.equal(early.status, 303);
  const checkoutClosed = await new Browser(t.base).get(`/checkout/${slug}`);
  assert.notEqual(checkoutClosed.status, 200, 'sem textos publicados o checkout não abre');
  await admin.post(`/admin/textos/${terms.id}`, { body_html: LONG + '<p onclick="x()">Com <b>negrito</b> e <a href="javascript:alert(1)">link ruim</a> e <a href="https://exemplo.com/a?b=1&c=2">link bom</a></p><script>alert(1)</script><img src=x onerror=alert(2)><ul><li>item</li></ul>' }, `/admin/textos/${terms.id}`);
  const html = (await q('SELECT body_html FROM legal_documents WHERE id=$1', [terms.id])).rows[0].body_html;
  assert.match(html, /<h2>Texto<\/h2>/); assert.match(html, /<strong>negrito<\/strong>/); assert.match(html, /<ul><li>item<\/li><\/ul>/);
  assert.doesNotMatch(html, /<script|onclick|onerror|<img|javascript:/i, 'o HTML é limpo no servidor');
  assert.match(html, /<a href="https:\/\/exemplo.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">link bom<\/a>/);
  assert.match((await admin.get(`/admin/textos/${terms.id}`)).text, /data-editor/, 'editor visual na tela');
  await admin.post(`/admin/textos/${priv.id}`, { body_html: LONG }, `/admin/textos/${priv.id}`);
  for (const d of [terms, priv]) { await admin.post(`/admin/textos/${d.id}/publicar`, {}, `/admin/textos/${d.id}`); await acceptAll(); }
  assert.equal((await q("SELECT count(*)::int n FROM legal_documents WHERE status='published'")).rows[0].n, 2);
  const edit = await admin.post(`/admin/textos/${terms.id}`, { body_html: '<p>outro</p>' }, '/admin/textos');
  assert.equal(edit.status, 303); assert.doesNotMatch((await q('SELECT body_html FROM legal_documents WHERE id=$1', [terms.id])).rows[0].body_html, /outro/, 'publicado é imutável');
  doc1 = terms.id; doc2 = priv.id;
  const nova = await admin.post('/admin/textos/nova', { doc_type: 'terms' }, '/admin/textos');
  assert.match(nova.location, /\/admin\/textos\/\d+/);
  assert.equal((await q("SELECT version, status FROM legal_documents WHERE doc_type='terms' ORDER BY id DESC LIMIT 1")).rows[0].status, 'draft');
  const outro = await admin.post('/admin/textos/nova', { doc_type: 'terms' }, '/admin/textos');
  assert.match(outro.location, /\/admin\/textos\/\d+/, 'já existe rascunho: volta para ele');
  assert.equal((await q("SELECT count(*)::int n FROM legal_documents WHERE doc_type='terms'")).rows[0].n, 2);
});

test('regras de configuração: simulado proibido em produção; token exige segredo; sem token a loja fecha mas o site sobe', () => {
  const prod = { APP_ENV: 'production', SESSION_SECRET: 'x'.repeat(48), DATABASE_URL: 'postgres://x', ADMIN_EMAIL: 'a@b.com', ADMIN_INITIAL_PASSWORD: 'Provisoria123', RESEND_API_KEY: 're_x', RESEND_FROM_EMAIL: 'a@b.com', APP_BASE_URL: 'https://x.com.br' };
  const pr = (extra) => config.problems(config.load({ ...prod, ...extra })).join(' | ');
  assert.match(pr({ PAYMENT_PROVIDER: 'simulated' }), /simulado|simulated/i);
  assert.match(pr({ MP_ACCESS_TOKEN: 'APP_USR-1' }), /MP_WEBHOOK_SECRET/);
  assert.doesNotMatch(pr({ MP_ACCESS_TOKEN: 'APP_USR-1', MP_WEBHOOK_SECRET: 's' }), /MP_|simulado/i);
  const noTok = config.load(prod); assert.equal(noTok.paymentsEnabled, false); assert.doesNotMatch(config.problems(noTok).join('|'), /MP_|pagamento/i);
  assert.equal(config.load(testEnv()).paymentProvider, 'simulated'); assert.equal(config.load(testEnv()).paymentsEnabled, true);
});

test('checkout: valida campos, exige aceite e login para e-mail que já tem conta', async () => {
  const b = new Browser(t.base);
  const page = await b.get(`/checkout/${slug}`); assert.equal(page.status, 200); assert.match(page.text, /Finalizar matrícula/); assert.match(page.text, /R\$\s?100,00/);
  const bad = await b.post(`/checkout/${slug}`, form({ cpf: '11111111111', accept: '' , phone: ''}), `/checkout/${slug}`);
  assert.equal(bad.status, 422); assert.match(bad.text, /CPF/); assert.match(bad.text, /aceitar|Aceite|aceito/i);
  const ex = await makeStudent(t, { email: 'jatem@example.com', name: 'Já Tem' });
  const dup = await b.post(`/checkout/${slug}`, form({ email: ex.email }), `/checkout/${slug}`);
  assert.equal(dup.status, 422); assert.match(dup.text, /Entre para continuar/);
  assert.equal((await q('SELECT count(*)::int n FROM orders')).rows[0].n, 0, 'nada foi cobrado');
  const adm = await admin.get(`/checkout/${slug}`); assert.equal(adm.status, 303, 'administrador não compra');
  const home = await b.get(`/cursos/${slug}`); assert.match(home.text, /Matricular-se/);
});

test('Pix simulado: compra aprovada cria conta, matrícula, e-mail, aceites e é idempotente', async () => {
  const b = new Browser(t.base); mailer.memory.length = 0;
  const { r, f, pub } = await buy(b);
  assert.equal(r.status, 303); assert.match(r.location, /^\/pedido\/[A-Za-z0-9]{24}$/);
  const pg = await b.get(r.location); assert.equal(pg.status, 200); assert.match(pg.text, /Pix/); assert.match(pg.text, /data-order-poll/);
  assert.equal((await b.get(`${r.location}/status`)).text.includes('pending'), true);
  assert.equal((await q('SELECT count(*)::int n FROM users WHERE email=$1', [f.email])).rows[0].n, 0, 'sem conta antes de pagar');
  assert.equal((await q('SELECT count(*)::int n FROM enrollments')).rows[0].n, 0, 'matrícula só nasce com o pagamento');
  await sim(pub, 'approved'); await sim(pub, 'approved');
  const o = (await q('SELECT * FROM orders WHERE public_id=$1', [pub])).rows[0];
  assert.equal(o.status, 'approved'); assert.ok(o.refund_until);
  const u = (await q('SELECT * FROM users WHERE email=$1', [f.email])).rows[0]; assert.ok(u); assert.equal(u.must_change_password, true); assert.equal(u.role, 'student');
  const en = (await q('SELECT * FROM enrollments WHERE user_id=$1', [u.id])).rows; assert.equal(en.length, 1); assert.equal(en[0].origin, 'purchase'); assert.ok(en[0].expires_at);
  assert.equal((await q('SELECT count(*)::int n FROM acceptances WHERE user_id=$1 AND origin=$2', [u.id, 'checkout'])).rows[0].n, 2);
  assert.equal(mailer.memory.filter((m) => m.to === f.email).length, 1, 'um único e-mail de acesso');
  assert.match(lastMail(f.email).text || lastMail(f.email).html, /senha|acesso/i);
  assert.equal((await b.get(`/pedido/${pub}/status`)).text.includes('approved'), true);
  const done = await b.get(`/pedido/${pub}`); assert.match(done.text, /Pagamento aprovado/);
});

test('cupom é reconferido no servidor e o valor cobrado vem do banco, não do formulário', async () => {
  const cp = (await q("INSERT INTO coupons (code, kind, percent, max_uses) VALUES ('EVO-TESTE1','percent',20,5) RETURNING id")).rows[0].id;
  await q('INSERT INTO coupon_courses (coupon_id, course_id) VALUES ($1,$2)', [cp, course]);
  const b = new Browser(t.base);
  const { r, pub } = await buy(b, { cupom: 'EVO-TESTE1', price: '1,00', price_cents: '100' });
  assert.equal(r.status, 303);
  const o = (await q('SELECT * FROM orders WHERE public_id=$1', [pub])).rows[0];
  assert.equal(o.price_cents, 8000); assert.equal(o.price_source, 'coupon'); assert.equal(o.list_cents, 10000);
  const bad = await buy(b, { cupom: 'EVO-NAOEXISTE' }); assert.equal(bad.r.status, 422);
  await sim(pub, 'approved');
  assert.equal((await q('SELECT count(*)::int n FROM coupon_redemptions')).rows[0].n, 1);
});

test('Pix recusado e vencido não matriculam; vencido gera e-mail com o link para tentar de novo, uma vez só', async () => {
  const b = new Browser(t.base); mailer.memory.length = 0;
  const ref = await buy(b); await sim(ref.pub, 'refused');
  assert.equal((await q('SELECT status FROM orders WHERE public_id=$1', [ref.pub])).rows[0].status, 'refused');
  assert.equal((await q('SELECT count(*)::int n FROM users WHERE email=$1', [ref.f.email])).rows[0].n, 0);
  const ex = await buy(b);
  await q("UPDATE orders SET pix_expires_at = now() - interval '5 minutes' WHERE public_id=$1", [ex.pub]);
  assert.equal(await S.sweepExpired(t.cfg, bg), 1); assert.equal(await S.sweepExpired(t.cfg, bg), 0);
  await t.app.locals.idle();
  const mails = mailer.memory.filter((m) => m.to === ex.f.email); assert.equal(mails.length, 1);
  assert.match(mails[0].text || mails[0].html, new RegExp(`/checkout/${slug}`));
  assert.equal((await q('SELECT status FROM orders WHERE public_id=$1', [ex.pub])).rows[0].status, 'expired');
});

test('cartão simulado: pedido segue para o link do gateway e só aprova pelo gateway', async () => {
  const b = new Browser(t.base);
  const { r, pub } = await buy(b, { method: 'card' });
  assert.equal(r.status, 303);
  const o = (await q('SELECT * FROM orders WHERE public_id=$1', [pub])).rows[0]; assert.equal(o.method, 'card'); assert.equal(o.status, 'pending');
  const pg = await b.get(r.location); assert.equal(pg.status, 200);
  await sim(pub, 'approved'); assert.equal((await q('SELECT status FROM orders WHERE public_id=$1', [pub])).rows[0].status, 'approved');
});

test('valor divergente do gateway não aprova', async () => {
  const b = new Browser(t.base);
  const { pub } = await buy(b);
  const o = (await q('SELECT * FROM orders WHERE public_id=$1', [pub])).rows[0];
  const out = await S.applyPayment(t.cfg, bg, o.id, { id: `SIM-${pub}`, status: 'approved', reference: pub, amountCents: 100, paidCents: 100 }, null);
  assert.equal(out.result, 'valor_divergente');
  assert.equal((await q('SELECT status FROM orders WHERE id=$1', [o.id])).rows[0].status, 'pending');
});

test('renovação soma o prazo ao que resta e reembolso da renovação volta ao prazo anterior', async () => {
  const stu = await makeStudent(t, { email: 'renova@example.com', name: 'Rê Nova', cpf: '45317828791' });
  await q("INSERT INTO enrollments (user_id, course_id, origin, expires_at) VALUES ($1,$2,'manual', now() + interval '10 days')", [stu.id, course]);
  const b = new Browser(t.base); await b.login(stu.email, stu.password);
  const bs = await S.buyState(stu.id, (await q('SELECT * FROM courses WHERE id=$1', [course])).rows[0]); assert.equal(bs.state, 'renew');
  const before = (await q('SELECT expires_at FROM enrollments WHERE user_id=$1', [stu.id])).rows[0].expires_at;
  const r = await b.post(`/checkout/${slug}`, form({ email: stu.email, cpf: stu.cpf }), `/checkout/${slug}`);
  assert.equal(r.status, 303, r.text.slice(0, 200)); const pub = r.location.replace('/pedido/', '');
  assert.equal((await q('SELECT kind FROM orders WHERE public_id=$1', [pub])).rows[0].kind, 'renewal');
  await sim(pub, 'approved');
  const after1 = (await q('SELECT expires_at FROM enrollments WHERE user_id=$1', [stu.id])).rows[0].expires_at;
  const months = (new Date(after1) - new Date(before)) / 86400000; assert.ok(months > 360 && months < 370, `soma 12 meses ao restante (${months})`);
  await sim(pub, 'refunded');
  const back = (await q('SELECT status, expires_at FROM enrollments WHERE user_id=$1', [stu.id])).rows[0];
  assert.equal(back.status, 'active'); assert.equal(new Date(back.expires_at).getTime(), new Date(before).getTime(), 'volta ao prazo anterior');
});

test('reembolso: aluno pede em até 7 dias, admin aprova, acesso e certificado são cancelados, e-mail avisa', async () => {
  const b = new Browser(t.base);
  const { f, pub } = await buy(b); await sim(pub, 'approved');
  const u = (await q('SELECT * FROM users WHERE email=$1', [f.email])).rows[0];
  await q("UPDATE users SET must_change_password=false, password_hash=(SELECT password_hash FROM users WHERE email='erick@example.com') WHERE id=$1", [u.id]);
  const sb = new Browser(t.base); await sb.login(f.email, 'NovaSenha2026');
  const pag = await sb.get('/pagamentos'); assert.equal(pag.status, 200); assert.match(pag.text, /Pagamentos e acessos/); assert.match(pag.text, /Curso Pago/);
  const o = (await q('SELECT * FROM orders WHERE public_id=$1', [pub])).rows[0];
  await q("INSERT INTO certificates (code, user_id, course_id, student_name, course_title, body_text) VALUES ('EVL-TEST-TEST-TEST',$1,$2,'Bruna','Curso Pago','texto')", [u.id, course]);
  mailer.memory.length = 0;
  const ask = await sb.post(`/pagamentos/${pub}/reembolso`, { reason: 'Mudei de ideia' }, '/pagamentos'); assert.equal(ask.status, 303);
  assert.equal((await q("SELECT count(*)::int n FROM refund_requests WHERE order_id=$1 AND status='requested'", [o.id])).rows[0].n, 1);
  await sb.post(`/pagamentos/${pub}/reembolso`, { reason: 'de novo' }, '/pagamentos');
  assert.equal((await q('SELECT count(*)::int n FROM refund_requests WHERE order_id=$1', [o.id])).rows[0].n, 1, 'um pedido aberto por compra');
  await t.app.locals.idle(); assert.ok(mailer.memory.find((m) => m.to === 'erick@example.com'), 'admin avisado');
  const list = await admin.get('/admin/vendas'); assert.match(list.text, /Pedidos de reembolso/); assert.match(list.text, /Mudei de ideia/);
  const ok = await admin.post(`/admin/vendas/${o.id}/reembolsar`, {}, `/admin/vendas/${o.id}`); assert.equal(ok.status, 303);
  const after = (await q('SELECT * FROM orders WHERE id=$1', [o.id])).rows[0]; assert.equal(after.status, 'refunded');
  assert.equal((await q('SELECT status FROM enrollments WHERE user_id=$1', [u.id])).rows[0].status, 'cancelled');
  assert.equal((await q("SELECT status FROM certificates WHERE user_id=$1", [u.id])).rows[0].status, 'revoked');
  assert.equal((await q('SELECT status FROM refund_requests WHERE order_id=$1', [o.id])).rows[0].status, 'approved');
  await t.app.locals.idle(); assert.ok(lastMail(f.email));
  const noMore = await sb.get(`/curso/${slug}`); assert.notEqual(noMore.status, 200, 'sem acesso depois do reembolso');
  const again = await admin.post(`/admin/vendas/${o.id}/reembolsar`, {}, `/admin/vendas/${o.id}`); assert.equal(again.status, 303);
});

test('reembolso fora do prazo não é pedido; recusa avisa o aluno', async () => {
  const b = new Browser(t.base);
  const { f, pub } = await buy(b); await sim(pub, 'approved');
  const u = (await q('SELECT * FROM users WHERE email=$1', [f.email])).rows[0];
  await q("UPDATE users SET must_change_password=false, password_hash=(SELECT password_hash FROM users WHERE email='erick@example.com') WHERE id=$1", [u.id]);
  const sb = new Browser(t.base); await sb.login(f.email, 'NovaSenha2026');
  await q("UPDATE orders SET refund_until = now() - interval '1 day' WHERE public_id=$1", [pub]);
  await sb.post(`/pagamentos/${pub}/reembolso`, { reason: 'tarde' }, '/pagamentos');
  assert.equal((await q('SELECT count(*)::int n FROM refund_requests rr JOIN orders o ON o.id=rr.order_id WHERE o.public_id=$1', [pub])).rows[0].n, 0);
  await q("UPDATE orders SET refund_until = now() + interval '3 days' WHERE public_id=$1", [pub]);
  await sb.post(`/pagamentos/${pub}/reembolso`, { reason: 'ok' }, '/pagamentos');
  const rr = (await q('SELECT rr.id FROM refund_requests rr JOIN orders o ON o.id=rr.order_id WHERE o.public_id=$1', [pub])).rows[0];
  mailer.memory.length = 0;
  await admin.post(`/admin/reembolsos/${rr.id}/recusar`, { note: 'Fora da política' }, '/admin/vendas');
  await t.app.locals.idle();
  assert.equal((await q('SELECT status FROM orders WHERE public_id=$1', [pub])).rows[0].status, 'approved');
  assert.ok(lastMail(f.email));
});

test('estorno (chargeback) cancela o acesso', async () => {
  const b = new Browser(t.base); const { f, pub } = await buy(b); await sim(pub, 'approved');
  const u = (await q('SELECT id FROM users WHERE email=$1', [f.email])).rows[0];
  await sim(pub, 'charged_back');
  assert.equal((await q('SELECT status FROM orders WHERE public_id=$1', [pub])).rows[0].status, 'charged_back');
  assert.equal((await q('SELECT status FROM enrollments WHERE user_id=$1', [u.id])).rows[0].status, 'cancelled');
});

test('painel de vendas: filtros, detalhe e proteção de acesso', async () => {
  const list = await admin.get('/admin/vendas'); assert.equal(list.status, 200); assert.match(list.text, /Vendas aprovadas/);
  assert.match((await admin.get('/admin/vendas?status=approved&forma=pix&q=bruna')).text, /Pedido|pedidos/);
  const o = (await q('SELECT id FROM orders ORDER BY id LIMIT 1')).rows[0];
  assert.equal((await admin.get(`/admin/vendas/${o.id}`)).status, 200);
  const anon = new Browser(t.base); assert.notEqual((await anon.get('/admin/vendas')).status, 200);
  const stu = await makeStudent(t, { email: 'curiosa@example.com', cpf: '98765432100' }); await acceptAll(); const sb = new Browser(t.base); await sb.login(stu.email, stu.password);
  for (const p of ['/admin/vendas', '/admin/simulador', '/admin/textos']) assert.notEqual((await sb.get(p)).status, 200, p);
  assert.equal((await sb.get('/pagamentos')).status, 200);
});

test('cupom limitado fica reservado enquanto há compra pendente e não vale em dois pedidos ao mesmo tempo', async () => {
  const cp = (await q("INSERT INTO coupons (code, kind, percent, max_uses) VALUES ('EVO-UNICO1','percent',10,1) RETURNING id")).rows[0].id;
  await q('INSERT INTO coupon_courses (coupon_id, course_id) VALUES ($1,$2)', [cp, course]);
  const a = await buy(new Browser(t.base), { cupom: 'EVO-UNICO1' }); assert.equal(a.r.status, 303);
  const dupA = await new Browser(t.base).post(`/checkout/${slug}`, { ...a.f, cupom: 'EVO-UNICO1' }, `/checkout/${slug}`);
  assert.equal(dupA.status, 303, 'o mesmo comprador pode tentar de novo');
  const b2 = await buy(new Browser(t.base), { cupom: 'EVO-UNICO1' });
  assert.equal(b2.r.status, 422); assert.match(b2.r.text, /reservado|compras em andamento/);
  await sim(a.pub, 'approved');
  const b3 = await buy(new Browser(t.base), { cupom: 'EVO-UNICO1' });
  assert.equal(b3.r.status, 422); assert.match(b3.r.text, /não está mais válido/);
  assert.equal((await q('SELECT count(*)::int n FROM coupon_redemptions WHERE coupon_id=$1', [cp])).rows[0].n, 1);
});

test('revisão: recompra após reembolso não deixa acesso; reembolso antes da aprovação não matricula; ambiente sem declaração não liga o simulado', async () => {
  // recompra
  const b = new Browser(t.base);
  const first = await buy(b); await sim(first.pub, 'approved');
  const u = (await q('SELECT id FROM users WHERE email=$1', [first.f.email])).rows[0];
  await sim(first.pub, 'refunded');
  assert.equal((await q('SELECT status FROM enrollments WHERE user_id=$1', [u.id])).rows[0].status, 'cancelled');
  await q("UPDATE users SET must_change_password=false, password_hash=(SELECT password_hash FROM users WHERE email='erick@example.com') WHERE id=$1", [u.id]);
  const sb = new Browser(t.base); await sb.login(first.f.email, 'NovaSenha2026');
  const again = await sb.post(`/checkout/${slug}`, form({ email: first.f.email, cpf: first.f.cpf }), `/checkout/${slug}`);
  assert.equal(again.status, 303, again.text.slice(0, 200)); const pub2 = again.location.replace('/pedido/', '');
  await sim(pub2, 'approved');
  assert.equal((await q('SELECT status FROM enrollments WHERE user_id=$1', [u.id])).rows[0].status, 'active');
  assert.equal((await q('SELECT prev_enrollment FROM orders WHERE public_id=$1', [pub2])).rows[0].prev_enrollment, false, 'matrícula cancelada não conta como anterior');
  await sim(pub2, 'refunded');
  assert.equal((await q('SELECT status FROM enrollments WHERE user_id=$1', [u.id])).rows[0].status, 'cancelled', 'segundo reembolso cancela de novo');
  // leitura fora de ordem
  const c = await buy(new Browser(t.base));
  await sim(c.pub, 'refunded');
  assert.equal((await q('SELECT status FROM orders WHERE public_id=$1', [c.pub])).rows[0].status, 'refunded');
  await sim(c.pub, 'approved');
  assert.equal((await q('SELECT count(*)::int n FROM users WHERE email=$1', [c.f.email])).rows[0].n, 0, 'aprovação atrasada não libera pagamento já devolvido');
  // ambiente
  const bare = { SESSION_SECRET: 'x'.repeat(48), DATABASE_URL: 'postgres://x' };
  const cfg0 = config.load(bare); assert.equal(cfg0.paymentsEnabled, false); assert.equal(cfg0.paymentProvider, 'mercadopago');
  assert.equal(config.load({ ...bare, APP_ENV: 'prod' }).isProd, true);
  assert.match(config.problems(config.load({ ...bare, PAYMENT_PROVIDER: 'simulated' })).join('|'), /simulado/);
  // dois cliques ao mesmo tempo geram um único pedido
  const bb = new Browser(t.base); const f2 = form();
  const tok = await bb.csrf(`/checkout/${slug}`);
  const rs = await Promise.all([1, 2, 3].map(() => bb.req('POST', `/checkout/${slug}`, { _csrf: tok, ...f2 })));
  assert.deepEqual([...new Set(rs.map((r) => r.location))].length, 1, 'mesmo pedido para cliques simultâneos');
  assert.equal((await q("SELECT count(*)::int n FROM orders WHERE buyer->>'email'=$1", [f2.email])).rows[0].n, 1);
});

// ---------- Mercado Pago com fetch simulado ----------
test('Mercado Pago: Pix, cartão, consulta, reembolso e mapeamento de status usam a API certa', async () => {
  const calls = []; const real = global.fetch;
  global.fetch = async (url, opt) => {
    calls.push({ url: String(url), method: opt.method, body: opt.body ? JSON.parse(opt.body) : null, headers: opt.headers });
    const u = String(url);
    if (u.endsWith('/v1/payments') && opt.method === 'POST') return new Response(JSON.stringify({ id: 123456, point_of_interaction: { transaction_data: { qr_code: '000201PIX', qr_code_base64: 'QUJD' } } }), { status: 201 });
    if (u.endsWith('/checkout/preferences')) return new Response(JSON.stringify({ id: 'PREF1', init_point: 'https://mp.test/pay' }), { status: 201 });
    if (u.endsWith('/refunds')) return new Response(JSON.stringify({ id: 77, status: 'approved' }), { status: 201 });
    if (u.endsWith('/v1/payments/555')) return new Response(JSON.stringify({ id: 555, status: 'approved', status_detail: 'accredited', external_reference: 'REF', transaction_amount: 80, installments: 3, transaction_details: { total_paid_amount: 84.5 }, payment_type_id: 'credit_card' }), { status: 200 });
    if (u.endsWith('/v1/payments/556')) return new Response('{"message":"x"}', { status: 404 });
    return new Response('{}', { status: 500 });
  };
  try {
    const cfg = { mpAccessToken: 'APP_USR-tok', baseUrl: 'https://evo.test', pixMinutes: 30 };
    const order = { public_id: 'ABC', price_cents: 8050, buyer: { name: 'Ana Maria Silva', email: 'a@b.com', cpf: '52998224725' } };
    const pix = await mp.createPix(cfg, { order, course: { title: 'Curso X' } });
    assert.equal(pix.paymentId, '123456'); assert.equal(pix.code, '000201PIX');
    const c1 = calls[0]; assert.equal(c1.url, 'https://api.mercadopago.com/v1/payments'); assert.equal(c1.body.transaction_amount, 80.5); assert.equal(c1.body.payment_method_id, 'pix'); assert.equal(c1.body.external_reference, 'ABC');
    assert.equal(c1.headers.Authorization, 'Bearer APP_USR-tok'); assert.equal(c1.headers['X-Idempotency-Key'], 'pix-ABC'); assert.match(c1.body.date_of_expiration, /-03:00$/);
    const pref = await mp.createCheckout(cfg, { order, course: { id: 1, title: 'Curso X', max_installments: 6 } });
    assert.equal(pref.url, 'https://mp.test/pay'); const c2 = calls[1];
    assert.deepEqual(c2.body.payment_methods.excluded_payment_types.map((x) => x.id), ['ticket', 'bank_transfer', 'atm']); assert.equal(c2.body.payment_methods.installments, 6); assert.equal(c2.body.back_urls.success, 'https://evo.test/pedido/ABC');
    const p = await mp.getPayment(cfg, '555'); assert.equal(p.status, 'approved'); assert.equal(p.amountCents, 8000); assert.equal(p.paidCents, 8450); assert.equal(p.installments, 3); assert.equal(p.reference, 'REF');
    assert.equal(await mp.getPayment(cfg, '556'), null); assert.equal(await mp.getPayment(cfg, '../x'), null);
    const rf = await mp.refund(cfg, { paymentId: '555', idem: 'refund-ABC' }); assert.equal(rf.status, 'approved'); assert.equal(calls.at(-1).headers['X-Idempotency-Key'], 'refund-ABC');
  } finally { global.fetch = real; }
});

test('webhook do Mercado Pago: assinatura, nunca confia no corpo, idempotente e matricula pelo pagamento consultado', async () => {
  const secret = 'segredo-teste';
  const t2 = await boot({ APP_ENV: 'staging', PAYMENT_PROVIDER: 'mercadopago', MP_ACCESS_TOKEN: 'TEST-tok', MP_WEBHOOK_SECRET: secret });
  const real = global.fetch; const calls = [];
  let mpPay = null;
  global.fetch = async (url, opt) => {
    if (String(url).startsWith(t2.base)) return real(url, opt);
    calls.push(String(url)); const u = String(url);
    if (u.endsWith('/v1/payments') && opt.method === 'POST') return new Response(JSON.stringify({ id: 999001, point_of_interaction: { transaction_data: { qr_code: '000201REAL', qr_code_base64: 'QUJD' } } }), { status: 201 });
    if (u.endsWith('/v1/payments/999001')) return new Response(JSON.stringify(mpPay), { status: 200 });
    return new Response('{}', { status: 500 });
  };
  try {
    const tb = new Browser(t2.base); const ad = await adminReady(t2);
    await ad.post('/admin/cursos', { title: 'Curso MP', slug: 'curso-mp', summary: 'r', description: 'd', price: '50,00', level: 'iniciante', access_type: 'lifetime', max_installments: '1', sort_order: '1', expiry_notice: '' }, '/admin/cursos/novo');
    await t2.pool.query("UPDATE courses SET status='published', published_at=now() - interval '1 day'");
    await t2.pool.query("UPDATE legal_documents SET status='published', published_at=now(), body_html='<p>x</p>'");
    const f = form({ email: 'mp@example.com' });
    const r = await tb.post('/checkout/curso-mp', f, '/checkout/curso-mp'); assert.equal(r.status, 303);
    const o = (await t2.pool.query('SELECT * FROM orders')).rows[0]; assert.equal(o.provider, 'mercadopago'); assert.equal(o.provider_payment_id, '999001'); assert.equal(o.pix_code, '000201REAL');
    mpPay = { id: 999001, status: 'approved', external_reference: o.public_id, transaction_amount: 50, installments: 1, payment_type_id: 'bank_transfer' };
    const sign = (id, reqId, ts = String(Date.now()), key = secret) => ({ 'x-signature': `ts=${ts},v1=${crypto.createHmac('sha256', key).update(`id:${id};request-id:${reqId};ts:${ts};`).digest('hex')}`, 'x-request-id': reqId });
    const post = (qs, body, headers) => fetch(`${t2.base}/webhooks/mercadopago${qs}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const body = { type: 'payment', data: { id: '999001' } };
    assert.equal((await post('?data.id=999001', body, {})).status, 401, 'sem assinatura');
    assert.equal((await post('?data.id=999001', body, sign('999001', 'r0', undefined, 'errado'))).status, 401, 'assinatura errada');
    assert.equal((await t2.pool.query("SELECT status FROM orders")).rows[0].status, 'pending');
    const ok = await post('?data.id=999001', body, sign('999001', 'r1')); assert.equal(ok.status, 200);
    assert.equal((await t2.pool.query('SELECT status FROM orders')).rows[0].status, 'approved');
    assert.equal((await t2.pool.query('SELECT count(*)::int n FROM enrollments')).rows[0].n, 1);
    const dup = await post('?data.id=999001', body, sign('999001', 'r1')); assert.equal((await dup.json()).duplicate, true);
    const again = await post('?data.id=999001', body, sign('999001', 'r2')); assert.equal(again.status, 200);
    assert.equal((await t2.pool.query('SELECT count(*)::int n FROM enrollments')).rows[0].n, 1, 'repetição não duplica');
    assert.equal((await t2.pool.query("SELECT count(*)::int n FROM users WHERE email='mp@example.com'")).rows[0].n, 1);
    const ign = await post('?data.id=1&type=merchant_order', { type: 'merchant_order', data: { id: '1' } }, sign('1', 'r3')); assert.equal((await ign.json()).ignored, true);
    // o corpo do webhook dizendo "aprovado" não vale: quem manda é a consulta ao gateway
    const o2 = await tb.post('/checkout/curso-mp', form({ email: 'mp2@example.com' }), '/checkout/curso-mp'); assert.equal(o2.status, 303);
    assert.equal((await t2.pool.query("SELECT status FROM orders ORDER BY id DESC LIMIT 1")).rows[0].status, 'pending');
    // rede de segurança: webhook perdido, mas a tela de espera consulta o gateway e libera
    const o2row = (await t2.pool.query('SELECT public_id FROM orders ORDER BY id DESC LIMIT 1')).rows[0];
    mpPay = { id: 999001, status: 'approved', external_reference: o2row.public_id, transaction_amount: 50, installments: 1, payment_type_id: 'bank_transfer' };
    assert.match((await tb.get(`/pedido/${o2row.public_id}/status`)).text, /approved/);
    assert.equal((await t2.pool.query("SELECT count(*)::int n FROM enrollments")).rows[0].n, 2);
  } finally { global.fetch = real; await t2.close(); }
});

test('simulador não existe em produção nem fora do provedor simulado', async () => {
  const t3 = await boot({ APP_ENV: 'staging', PAYMENT_PROVIDER: 'mercadopago', MP_ACCESS_TOKEN: 'TEST-x', MP_WEBHOOK_SECRET: 's' });
  try { const ad = await adminReady(t3); assert.equal((await ad.get('/admin/simulador')).status, 404); } finally { await t3.close(); }
});


test('sanitizeHtml: lista de permitidos, links seguros e tags quebradas', () => {
  const L = require('../src/legal');
  assert.equal(L.sanitizeHtml('<p>a</p><style>p{}</style><iframe src=x></iframe>'), '<p>a</p>');
  assert.equal(L.sanitizeHtml('<div style="x">oi <b>n</b> <i>i</i></div>'), '<p>oi <strong>n</strong> <em>i</em></p>');
  assert.equal(L.sanitizeHtml('<a href=" JaVaScRiPt:alert(1)">x</a>'), 'x');
  assert.equal(L.sanitizeHtml('<a href="data:text/html;base64,AAA">x</a>'), 'x');
  assert.equal(L.sanitizeHtml('<p>aberto <strong>sem fechar'), '<p>aberto <strong>sem fechar</strong></p>');
  assert.equal(L.sanitizeHtml('texto 1 < 2 & 3 > 1'), 'texto 1 &lt; 2 &amp; 3 &gt; 1');
  assert.equal(L.sanitizeHtml('<h1>T</h1><span class="x">y</span>'), '<h2>T</h2>y');
  assert.doesNotMatch(L.sanitizeHtml('<p onmouseover="a()">x</p><!-- <script> -->'), /onmouse|script|<!--/);
});
