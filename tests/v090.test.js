'use strict';
// 0.9.0 · Reset de lançamento (por e-mail, com prévia e confirmação) e checklist de go-live. Reset LIGADO.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, adminReady, makeStudent, ADMIN } = require('./helpers');
const L = require('../src/launch');

let t; let admin; let course; let lesson; let a; let b; let real;
const q = (sql, p) => t.pool.query(sql, p);
let n = 0;
async function order(user, over = {}) {
  const id = `T${String(++n).padStart(23, '0')}`;
  await q("INSERT INTO orders (public_id, user_id, course_id, buyer, list_cents, price_cents, method, provider, provider_payment_id, status, paid_cents, approved_at) VALUES ($1,$2,$3,$4::jsonb,100,100,'pix','mercadopago',$5,$6,100,now())",
    [id, user.id, course, JSON.stringify({ name: user.name, email: user.email }), `pay-${n}`, over.status || 'approved']);
  return (await q('SELECT id FROM orders WHERE public_id=$1', [id])).rows[0].id;
}
async function populate(u) {
  await q('INSERT INTO enrollments (user_id, course_id) VALUES ($1,$2)', [u.id, course]);
  await q('INSERT INTO lesson_progress (user_id, lesson_id) VALUES ($1,$2)', [u.id, lesson]);
  const doc = (await q("SELECT id FROM legal_documents WHERE doc_type='terms' LIMIT 1")).rows[0].id;
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version) VALUES ($1,$2,'terms','v1.0')", [u.id, doc]);
  const oid = await order(u);
  await q("INSERT INTO webhook_events (provider, event_key, payment_id) VALUES ('mercadopago',$1,$2)", [`ev-${u.id}`, `pay-${n}`]);
  await q("INSERT INTO refund_requests (order_id, requested_by, reason, status) VALUES ($1,$2,'teste','rejected')", [oid, u.id]);
  await q("INSERT INTO certificates (code, user_id, course_id, student_name, course_title, body_text) VALUES ($1,$2,$3,'x','y','z')", [`C${u.id}`, u.id, course]);
  const post = (await q("INSERT INTO forum_posts (course_id, lesson_id, user_id, body) VALUES ($1,$2,$3,'Pergunta de teste') RETURNING id", [course, lesson, u.id])).rows[0].id;
  await q("INSERT INTO forum_posts (course_id, lesson_id, user_id, parent_id, by_admin, body) SELECT $1,$2,id,$3,TRUE,'Resposta do professor' FROM users WHERE role='admin' LIMIT 1", [course, lesson, post]);
  await q("INSERT INTO course_reviews (course_id, user_id, stars, nps) VALUES ($1,$2,5,10)", [course, u.id]);
  await q("INSERT INTO email_log (to_email, subject, template, status) VALUES ($1,'x','compra_curso','sent')", [u.email]);
  await q("INSERT INTO data_requests (user_id, type) VALUES ($1,'export')", [u.id]);
  await q("INSERT INTO notifications (user_id, kind, title, ref_key) VALUES ($1,'welcome','Oi','k1')", [u.id]);
}
const total = async (table, where = '') => (await q(`SELECT count(*)::int AS n FROM ${table} ${where}`)).rows[0].n;

before(async () => {
  t = await boot({ ALLOW_LAUNCH_RESET: '1' }); admin = await adminReady(t);
  course = (await q("INSERT INTO courses (title, slug, summary, description, price_cents, level, access_type, status, published_at) VALUES ('Produto','produto','r','d',100,'iniciante','lifetime','published',now() - interval '1 day') RETURNING id")).rows[0].id;
  const m = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'M',1) RETURNING id", [course])).rows[0].id;
  lesson = (await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'Aula',1,'dQw4w9WgXcQ') RETURNING id", [course, m])).rows[0].id;
  a = await makeStudent(t, { email: 'teste1@example.com', name: 'Teste Um' });
  b = await makeStudent(t, { email: 'teste2@example.com', name: 'Teste Dois' });
  real = await makeStudent(t, { email: 'real@example.com', name: 'Aluna Real' });
  for (const u of [a, b, real]) await populate(u);
  await q("INSERT INTO email_log (to_email, subject, template, status) VALUES ('outra@example.com','x','y','sent')");
  // pedido de convidado (sem usuário) feito com o e-mail de uma conta de teste
  await q("INSERT INTO orders (public_id, user_id, course_id, buyer, list_cents, price_cents, method, provider, status) VALUES ('GUEST0000000000000000001',NULL,$1,'{\"name\":\"Teste Um\",\"email\":\"Teste1@Example.com\"}'::jsonb,100,100,'pix','mercadopago','refused')", [course]);
});
after(async () => { await t.close(); });

test('migração: aceites só podem ser apagados dentro do reset; fora dele continuam imutáveis', async () => {
  await assert.rejects(() => q('DELETE FROM acceptances WHERE user_id = $1', [a.id]), /imutável/);
  await assert.rejects(() => q("UPDATE acceptances SET version = 'v9'"), /imutável/);
  await assert.rejects(() => q('TRUNCATE acceptances'), /imutável/);
  await assert.rejects(() => q('DELETE FROM audit_log'), /imutável/);
  const c = await t.pool.connect();
  try { // a chave vale só dentro da transação e só para DELETE
    await c.query('BEGIN'); await c.query("SELECT set_config('evl.launch_reset','on',true)");
    await assert.rejects(() => c.query("UPDATE acceptances SET version = 'v9'"), /imutável/);
    await c.query('ROLLBACK'); await c.query('BEGIN');
    await assert.rejects(() => c.query('TRUNCATE acceptances'), /imutável/);
    await c.query('ROLLBACK');
  } finally { c.release(); }
  assert.equal(await total('acceptances'), 3);
});

test('lista de e-mails: normaliza, remove repetidos e inválidos', () => {
  assert.deepEqual(L.parseEmails('A@x.com, a@X.com\nb@y.com; lixo  c@z.org'), ['a@x.com', 'b@y.com', 'c@z.org']);
  assert.deepEqual(L.parseEmails(''), []);
});

test('tela: checklist e reset ligado; prévia não apaga nada e conta certo', async () => {
  const page = await admin.get('/admin/lancamento'); assert.equal(page.status, 200);
  for (const s of [/Checklist de go-live/, /Textos legais publicados/, /Mercado Pago/, /Volume de arquivos/, /Reset de lançamento desligado/, /ALLOW_LAUNCH_RESET=1 está ligada/, /E-mails das contas de teste/]) assert.match(page.text, s);
  assert.match(page.text, /href="\/admin\/lancamento"/); // item no menu do administrador
  const bad = await admin.post('/admin/lancamento/previa', { emails: 'teste1@example.com\nreal2@example.com\nerick@example.com' }, '/admin/lancamento');
  assert.match(bad.text, /Não encontrei conta de aluno para: real2@example\.com/);
  assert.match(bad.text, /de administrador e não podem entrar no reset: erick@example\.com/);
  assert.doesNotMatch(bad.text, /APAGAR \d+ CONTA/); // com administrador na lista, não há como confirmar
  const pv = await admin.post('/admin/lancamento/previa', { emails: 'teste1@example.com\nTESTE2@example.com' }, '/admin/lancamento');
  assert.equal(pv.status, 200);
  assert.match(pv.text, /Prévia: o que será apagado/); assert.match(pv.text, /APAGAR 2 CONTAS/);
  assert.match(pv.text, /2 pedidos aprovados/); assert.match(pv.text, /name="ciente"/); // aviso de dinheiro não devolvido
  const { Browser } = require('./helpers');
  const s = new Browser(t.base); await s.login(real.email, real.password);
  const r = await s.get('/admin/lancamento'); assert.ok([302, 303, 403, 404].includes(r.status), String(r.status));
  assert.doesNotMatch(r.text || '', /Checklist de go-live/);
  assert.equal((await s.post('/admin/lancamento/previa', { emails: 'teste1@example.com' }, '/perfil')).status === 200, false);
  assert.equal(await total('users', "WHERE role='student'"), 3); assert.equal(await total('orders'), 4);
});

test('execução recusada: sem frase, frase errada, senha errada, dados mudaram; nada é apagado', async () => {
  const p = await L.preview(['teste1@example.com']);
  assert.equal(p.counts.pedidos, 2); // o de convidado entra na conta
  assert.ok(p.money >= 1);
  const go = (over) => admin.post('/admin/lancamento/executar', { emails: 'teste1@example.com', sig: p.sig, frase: 'APAGAR 1 CONTA', senha: 'NovaSenha2026', ciente: '1', ...over }, '/admin/lancamento');
  assert.match((await go({ ciente: '' })).text, /caixa de ciência/);
  assert.match((await go({ frase: '' })).text, /A frase não confere/);
  assert.match((await go({ frase: 'APAGAR 2 CONTAS' })).text, /A frase não confere/);
  assert.match((await go({ senha: 'errada' })).text, /Senha incorreta/);
  assert.match((await go({ sig: 'abc' })).text, /Os dados mudaram/);
  assert.match((await go({ emails: 'erick@example.com' })).text, /Nada a apagar/);
  assert.equal(await total('users', "WHERE role='student'"), 3); assert.equal(await total('acceptances'), 3);
  assert.equal(await total('audit_log', "WHERE action = 'launch_reset_denied'"), 1);
});

test('reset apaga só as contas escolhidas e tudo o que é delas; o resto fica; auditoria só com contagens', async () => {
  // pedido ainda esperando pagamento bloqueia (o dinheiro chegaria sem pedido)
  await q("INSERT INTO orders (public_id, user_id, course_id, buyer, list_cents, price_cents, method, provider, status) VALUES ('PEND0000000000000000001',$1,$2,'{}'::jsonb,100,100,'pix','mercadopago','pending')", [b.id, course]);
  const blockedP = await L.preview(['teste2@example.com']); assert.equal(blockedP.pending, 1);
  const pg = await admin.post('/admin/lancamento/executar', { emails: 'teste2@example.com', sig: blockedP.sig, frase: 'APAGAR 1 CONTA', senha: 'NovaSenha2026', ciente: '1' }, '/admin/lancamento');
  assert.match(pg.text, /aguardando pagamento/); assert.equal(await total('users', "WHERE email='teste2@example.com'"), 1);
  await q("DELETE FROM orders WHERE public_id='PEND0000000000000000001'");
  // assinatura conferida dentro da transação: prévia velha não executa
  await assert.rejects(() => L.run(['teste2@example.com'], 'assinatura-velha'), /mudaram desde a prévia/);
  assert.equal(await total('users', "WHERE email='teste2@example.com'"), 1);
  const p = await L.preview(['teste1@example.com', 'teste2@example.com']);
  assert.equal(p.counts.contas, 2); assert.equal(p.counts.pedidos, 3); assert.equal(p.counts.aceites, 2); assert.equal(p.counts.forum, 4); assert.equal(p.paid.n, 2);
  const r = await admin.post('/admin/lancamento/executar', { emails: 'teste1@example.com\nteste2@example.com', sig: p.sig, frase: ' apagar 2  contas ', senha: 'NovaSenha2026', ciente: '1' }, '/admin/lancamento');
  assert.equal(r.status, 303, r.text.slice(0, 300));
  assert.match((await admin.get('/admin/lancamento')).text, /Reset concluído: 2 contas apagadas/);
  const gone = ['enrollments', 'orders', 'certificates', 'acceptances', 'forum_posts', 'course_reviews', 'data_requests', 'notifications', 'lesson_progress', 'refund_requests'];
  for (const tb of gone) assert.equal(await total(tb), tb === 'forum_posts' ? 2 : 1, tb);
  assert.equal(await total('orders', "WHERE user_id IS NULL"), 0); // o pedido de convidado também saiu // fica só o conjunto da aluna real (forum: pergunta + resposta)
  assert.equal(await total('users', "WHERE email IN ('teste1@example.com','teste2@example.com')"), 0);
  assert.equal(await total('users', "WHERE email = 'real@example.com'"), 1); assert.equal(await total('users', "WHERE role='admin'"), 1);
  assert.equal(await total('webhook_events'), 1);
  assert.equal(await total('email_log', "WHERE to_email IN ('teste1@example.com','teste2@example.com')"), 0); assert.equal(await total('email_log', "WHERE to_email IN ('real@example.com','outra@example.com')"), 2);
  assert.equal(await total('courses'), 1); assert.equal(await total('lessons'), 1); assert.equal(await total('legal_documents'), 2);
  const log = (await q("SELECT * FROM audit_log WHERE action='launch_reset'")).rows;
  assert.equal(log.length, 1); assert.equal(log[0].meta.counts.contas, 2); assert.equal(log[0].meta.counts.aceites, 2);
  assert.doesNotMatch(JSON.stringify(log[0]), /teste1|teste2|Teste Um/);
  // o aceite da aluna real continua imutável
  await assert.rejects(() => q('DELETE FROM acceptances WHERE user_id = $1', [real.id]), /imutável/);
});

test('checklist de go-live reflete o estado do sistema', async () => {
  const items = await L.checklist(t.cfg);
  const by = (label) => items.find((i) => i.label.startsWith(label));
  assert.equal(by('Produto na vitrine').level, 'ok'); assert.equal(by('Preço de lançamento').level, 'warn'); // R$ 1,00 = preço de teste
  assert.equal(by('Compra de teste real').level, 'ok'); assert.equal(by('Reembolso de teste').level, 'warn');
  assert.equal(by('Textos legais publicados').level, 'bad'); assert.equal(by('Reset de lançamento desligado').level, 'warn');
  assert.equal(by('Ambiente de produção').level, 'warn');
  await q("UPDATE legal_documents SET status='published', published_at=now() WHERE status='draft'");
  assert.equal((await L.checklist(t.cfg)).find((i) => i.label.startsWith('Textos legais')).level, 'ok');
});
