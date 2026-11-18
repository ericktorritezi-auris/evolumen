'use strict';
// 2.4.0 · Lembretes do administrador (alunos que não começaram, afiliados parados) e descadastro.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent, mailer } = require('./helpers');
const N = require('../src/nudges');
const C = require('../src/courses');

let t; let admin; let course; let courseRow; let S = {}; let L; let n = 0;
const q = (sql, p) => t.pool.query(sql, p);
const ago = (d) => new Date(Date.now() - d * 86400000);
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';
const wait = async (fn, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); } return fn(); };
const enroll = async (key, progressDaysAgo = null) => {
  S[key] = await makeStudent(t, { email: `${key}@example.com`, name: `Aluno ${key} Sobrenome` });
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING", [S[key].id]);
  await q("INSERT INTO enrollments (user_id, course_id, origin, status) VALUES ($1,$2,'manual','active')", [S[key].id, course]);
  if (progressDaysAgo !== null) await q('INSERT INTO lesson_progress (user_id, lesson_id, completed_at) VALUES ($1,$2,$3)', [S[key].id, L, ago(progressDaysAgo)]);
};
const affiliate = async (key, { status = 'active', soldAgo = null } = {}) => {
  const a = (await q("INSERT INTO affiliates (name, email, status, created_at) VALUES ($1,$2,$3,$4) RETURNING id", [`Afiliado ${key} Teste`, `${key}@afiliado.com`, status, key === 'novato' ? new Date() : ago(120)])).rows[0].id;
  const cp = (await q("INSERT INTO coupons (code, kind, percent, max_uses, affiliate_id, commission_pct) VALUES ($1,'percent',10,50,$2,10) RETURNING id", [`CUP-${key.toUpperCase()}`, a])).rows[0].id;
  if (soldAgo !== null) {
    n += 1; const u = await makeStudent(t, { email: `cmp${n}@example.com`, name: `Comprador ${n}` });
    const oid = (await q("INSERT INTO orders (public_id, user_id, course_id, buyer, list_cents, price_cents, method, provider, status, paid_cents, approved_at) VALUES ($1,$2,$3,'{\"name\":\"X\",\"email\":\"x@example.com\"}'::jsonb,10000,10000,'pix','simulated','approved',10000,now()) RETURNING id", [`V240${String(n).padStart(20, '0')}`, u.id, course])).rows[0].id;
    await q("INSERT INTO commissions (affiliate_id, order_id, coupon_id, base_cents, pct, amount_cents, release_at, created_at) VALUES ($1,$2,$3,10000,10,1000,now(),$4)", [a, oid, cp, ago(soldAgo)]);
  }
  return a;
};
const base = () => `/admin/cursos/${course}/lembretes`;
const ids = (people) => people.map((p) => p.email.split('@')[0]).sort();

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await q("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy','affiliate')", [LONG]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING");
  await admin.post('/admin/cursos', { title: 'Curso Lembrete', slug: 'curso-lembrete', summary: 'R', description: 'D', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice_days: '30', publish: '1' }, '/admin/cursos/novo');
  course = (await q("SELECT id FROM courses WHERE slug='curso-lembrete'")).rows[0].id; courseRow = await C.byId(course);
  const m = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'M',1) RETURNING id", [course])).rows[0].id;
  L = (await q("INSERT INTO lessons (course_id, module_id, title, position) VALUES ($1,$2,'Aula 1',1) RETURNING id", [course, m])).rows[0].id;
  await q("INSERT INTO lessons (course_id, module_id, title, position) VALUES ($1,$2,'Aula 2',2)", [course, m]);
  await enroll('novo1'); await enroll('novo2'); await enroll('recem'); await enroll('parado20', 20); await enroll('parado10', 10); await enroll('andando', 2);
  await q("UPDATE enrollments SET created_at = $1 WHERE user_id <> $2", [ago(10), S.recem.id]);
});
after(async () => { await t.close(); });

test('grupos de alunos: nunca entrou e parado há mais de X dias', async () => {
  assert.deepEqual(ids(await N.studentsOf(courseRow, 'novos')), ['novo1', 'novo2']); // 'recem' tem matrícula de hoje: ainda não conta
  assert.deepEqual(ids(await N.studentsOf(courseRow, '7')), ['parado10', 'parado20']);
  assert.deepEqual(ids(await N.studentsOf(courseRow, '14')), ['parado20']);
  assert.deepEqual(ids(await N.studentsOf(courseRow, '30')), []);
  // matrícula cancelada ou aluno bloqueado não entra
  await q("UPDATE users SET status='blocked' WHERE id=$1", [S.novo2.id]);
  assert.deepEqual(ids(await N.studentsOf(courseRow, 'novos')), ['novo1']);
  await q("UPDATE users SET status='active' WHERE id=$1", [S.novo2.id]);
});

test('tela do aluno: lista, entrada em Matrículas e controle de acesso', async () => {
  assert.match((await admin.get(`/admin/cursos/${course}/matriculas`)).text, /Chamar quem não começou/);
  const page = (await admin.get(`${base()}?grupo=novos`)).text;
  assert.match(page, /Aluno novo1/); assert.match(page, /Aluno novo2/); assert.doesNotMatch(page, /Aluno andando/);
  assert.match(page, /\{nome\}/);
  const b = new Browser(t.base); await b.login(S.andando.email, S.andando.password);
  assert.equal((await b.get(base())).status, 403);
});

test('teste, revisão e envio: e-mail com descadastro, campainha, registro e envio duplo', async () => {
  const body = { grupo: 'novos', sel: [String(S.novo1.id), String(S.novo2.id)], subject: 'Oi, {nome}! Notei que você ainda não começou a {curso}', message: 'Oi, {nome}! Notei que você ainda não começou a {curso}.\n\nResponda este e-mail.' };
  mailer.memory.length = 0;
  let r = await admin.post(`${base()}/teste`, body, `${base()}?grupo=novos`);
  assert.equal(r.status, 303);
  const test_ = await wait(() => mailer.memory.find((m) => m.to === 'erick@example.com'));
  assert.match(test_.subject, /^\[TESTE\]/); assert.equal((await q('SELECT count(*)::int AS n FROM reminder_log')).rows[0].n, 0);
  // revisar: confirmação com contagem
  r = await admin.post(`${base()}/revisar`, { ...body, sel: [String(S.novo1.id)] }, `${base()}?grupo=novos`);
  assert.equal(r.status, 200); assert.match(r.text, /Enviar para 1 aluno\?/); assert.match(r.text, /1 desmarcado/);
  const token = r.text.match(/name="token" value="([a-f0-9]{24})"/)[1];
  // mensagem curta é recusada
  assert.equal((await admin.post(`${base()}/revisar`, { ...body, message: 'oi' }, `${base()}?grupo=novos`)).status, 422);
  assert.equal((await admin.post(`${base()}/revisar`, { ...body, sel: [] }, `${base()}?grupo=novos`)).status, 422);
  mailer.memory.length = 0;
  r = await admin.post(`${base()}/enviar`, { ...body, sel: [String(S.novo1.id)], token }, `${base()}?grupo=novos`);
  assert.equal(r.status, 303);
  const mail = await wait(() => mailer.memory.find((m) => m.to === 'novo1@example.com'));
  assert.ok(mail); assert.equal(mail.template, 'lembrete_aluno');
  assert.match(mail.subject, /Oi, Aluno! Notei que você ainda não começou a Curso Lembrete/);
  assert.match(mail.text, /lembretes\/cancelar\?e=novo1%40example\.com&t=[a-f0-9]{32}/); assert.match(mail.text, /\/curso\/curso-lembrete/);
  assert.equal(mailer.memory.find((m) => m.to === 'novo2@example.com'), undefined);
  assert.equal((await q("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND ref_key LIKE 'nudge:%'", [S.novo1.id])).rows[0].n, 1);
  assert.equal((await q('SELECT sent, skipped FROM reminder_batches WHERE token=$1', [token])).rows[0].sent, 1);
  // duplo clique: nada de novo
  mailer.memory.length = 0;
  r = await admin.post(`${base()}/enviar`, { ...body, sel: [String(S.novo1.id)], token }, `${base()}?grupo=novos`);
  assert.equal(r.status, 303); assert.equal(mailer.memory.length, 0);
  assert.equal((await q('SELECT count(*)::int AS n FROM reminder_log')).rows[0].n, 1);
});

test('regra de 10 dias e lembrete anterior', async () => {
  const people = await N.studentsOf(courseRow, 'novos');
  assert.equal(people.find((p) => p.email === 'novo1@example.com').status, 'recent');
  assert.equal(people.find((p) => p.email === 'novo2@example.com').status, 'send');
  // quem recebeu há 11 dias pode receber de novo
  await q("UPDATE reminder_log SET created_at = $1", [ago(11)]);
  assert.equal((await N.studentsOf(courseRow, 'novos')).find((p) => p.email === 'novo1@example.com').status, 'send');
  await q("UPDATE reminder_log SET created_at = $1", [ago(5)]);
  // enviar de novo para quem é "recent" é ignorado pelo servidor, mesmo marcado no formulário
  const tok = 'a'.repeat(24);
  const r = await admin.post(`${base()}/enviar`, { grupo: 'novos', sel: [String(S.novo1.id)], token: tok, subject: 'Assunto de teste', message: 'Mensagem de teste longa o bastante.' }, `${base()}?grupo=novos`);
  assert.equal(r.status, 303);
  assert.equal((await q('SELECT count(*)::int AS n FROM reminder_batches WHERE token=$1', [tok])).rows[0].n, 0);
});

test('descadastro: link assinado, confirmação por POST, só afeta lembretes e dá para voltar', async () => {
  const pub = new Browser(t.base);
  const url = N.unsubUrl(t.cfg, 'novo2@example.com').replace(t.cfg.baseUrl, '');
  let r = await pub.get(url);
  assert.equal(r.status, 200); assert.match(r.text, /Não quero mais receber lembretes/);
  assert.equal(await N.isOptedOut('novo2@example.com'), false); // GET não descadastra
  const tok = url.match(/t=([a-f0-9]+)/)[1];
  assert.equal((await pub.get('/lembretes/cancelar?e=novo2%40example.com&t=' + 'f'.repeat(32))).status, 400);
  assert.equal((await pub.post('/lembretes/cancelar', { e: 'novo2@example.com', t: 'f'.repeat(32) }, url)).status, 400);
  r = await pub.post('/lembretes/cancelar', { e: 'novo2@example.com', t: tok }, url);
  assert.equal(r.status, 200); assert.match(r.text, /não vai mais receber lembretes/);
  assert.equal(await N.isOptedOut('novo2@example.com'), true);
  assert.equal((await N.studentsOf(courseRow, 'novos')).find((p) => p.email === 'novo2@example.com').status, 'optout');
  // e-mails que não são lembrete continuam: o descadastro não toca em users nem em notificações
  assert.equal((await q("SELECT status FROM users WHERE id=$1", [S.novo2.id])).rows[0].status, 'active');
  r = await pub.post('/lembretes/retomar', { e: 'novo2@example.com', t: tok }, url);
  assert.match(r.text, /voltou a receber/); assert.equal(await N.isOptedOut('novo2@example.com'), false);
});

test('afiliados: nunca vendeu, sem vender há X dias, só ativos; cupom e envio por e-mail', async () => {
  await affiliate('nunca'); await affiliate('antigo', { soldAgo: 70 }); await affiliate('recente', { soldAgo: 2 }); await affiliate('inativo', { status: 'inactive' }); await affiliate('novato');
  assert.deepEqual(ids(await N.affiliatesOf('nunca')), ['nunca']);
  assert.deepEqual(ids(await N.affiliatesOf('30')), ['antigo', 'nunca']);
  assert.deepEqual(ids(await N.affiliatesOf('60')), ['antigo', 'nunca']);
  assert.deepEqual(ids(await N.affiliatesOf('90')), ['nunca']); // 'novato' foi criado hoje: não entra em nenhum grupo
  assert.match((await admin.get('/admin/afiliados')).text, /Reativar afiliados/);
  const page = (await admin.get('/admin/afiliados/lembretes?grupo=nunca')).text;
  assert.match(page, /Afiliado nunca Teste/); assert.doesNotMatch(page, /Afiliado antigo/); assert.match(page, /CUP-NUNCA/);
  const af = (await q("SELECT id FROM affiliates WHERE email='nunca@afiliado.com'")).rows[0].id;
  const body = { grupo: 'nunca', sel: [String(af)], subject: '{nome}, como posso te ajudar a vender mais?', message: 'Oi, {nome}! Seu cupom continua ativo: {cupom}.' };
  const rv = await admin.post('/admin/afiliados/lembretes/revisar', body, '/admin/afiliados/lembretes?grupo=nunca');
  assert.match(rv.text, /Enviar para 1 afiliado\?/);
  const token = rv.text.match(/name="token" value="([a-f0-9]{24})"/)[1];
  mailer.memory.length = 0;
  assert.equal((await admin.post('/admin/afiliados/lembretes/enviar', { ...body, token }, '/admin/afiliados/lembretes?grupo=nunca')).status, 303);
  const mail = await wait(() => mailer.memory.find((m) => m.to === 'nunca@afiliado.com'));
  assert.equal(mail.template, 'lembrete_afiliado'); assert.match(mail.subject, /^Afiliado, como posso/); assert.match(mail.text, /CUP-NUNCA/); assert.match(mail.text, /\/cupom\/CUP-NUNCA/);
  assert.equal((await q("SELECT count(*)::int AS n FROM notifications WHERE ref_key LIKE 'nudge:%' AND user_id IS NOT NULL")).rows[0].n, 1); // só a campainha do aluno enviado antes
  // aluno comum não acessa
  const b = new Browser(t.base); await b.login(S.andando.email, S.andando.password);
  assert.equal((await b.get('/admin/afiliados/lembretes')).status, 403);
});

test('texto do administrador é escapado no e-mail', async () => {
  const mail = N.build(t.cfg, { kind: 'aluno', person: { name: 'Ana Lima', email: 'ana@example.com' }, course: courseRow, subject: 'S {nome}', message: 'Oi <script>alert(1)</script> {nome}' });
  assert.doesNotMatch(mail.html, /<script>/); assert.match(mail.html, /&lt;script&gt;/); assert.match(mail.html, /Ana/);
});

test('LGPD: exportação inclui lembretes e anonimizar apaga o registro e o descadastro', async () => {
  const lg = require('../src/lgpd');
  await N.optOut('novo1@example.com');
  assert.equal((await lg.exportFor(S.novo1.id)).lembretes_recebidos.length, 1);
  await lg.anonymize(S.novo1.id);
  assert.equal((await q("SELECT count(*)::int AS n FROM reminder_log WHERE user_id=$1", [S.novo1.id])).rows[0].n, 0);
  assert.equal(await N.isOptedOut('novo1@example.com'), true); // a lista de quem não quer receber é mantida
});

test('curso em rascunho não recebe envio; comissão cancelada não conta como venda', async () => {
  await q("UPDATE courses SET status='draft' WHERE id=$1", [course]);
  const tok = 'b'.repeat(24);
  const r = await admin.post(`${base()}/enviar`, { grupo: 'novos', sel: [String(S.novo2.id)], token: tok, subject: 'Assunto de teste', message: 'Mensagem de teste longa o bastante.' }, `${base()}?grupo=novos`);
  assert.equal(r.status, 303); assert.equal((await q('SELECT count(*)::int AS n FROM reminder_batches WHERE token=$1', [tok])).rows[0].n, 0);
  await q("UPDATE courses SET status='published' WHERE id=$1", [course]);
  await q("UPDATE commissions SET status='cancelled' WHERE affiliate_id = (SELECT id FROM affiliates WHERE email='antigo@afiliado.com')");
  assert.ok(ids(await N.affiliatesOf('nunca')).includes('antigo'));
});

test('envio que falha não bloqueia a pessoa por 10 dias', async () => {
  await q("DELETE FROM reminder_log"); await q("DELETE FROM email_optouts");
  const orig = mailer.send; const mm = require('../src/mailer');
  const real = mm.send; mm.send = async () => ({ ok: false, error: 'falhou' });
  try {
    await N.sendBatch(t.cfg, null, { kind: 'aluno', course: courseRow, group: 'novos', selected: new Set([String(S.novo2.id)]), subject: 'Assunto de teste', message: 'Mensagem de teste longa o bastante.', token: 'c'.repeat(24), adminId: null });
  } finally { mm.send = real; }
  void orig;
  assert.equal((await q("SELECT count(*)::int AS n FROM reminder_log WHERE lower(email)='novo2@example.com'")).rows[0].n, 0);
});

test('regra dos 10 dias vale só dentro do mesmo tipo (curso x afiliado)', async () => {
  await q('DELETE FROM reminder_log'); await q('DELETE FROM email_optouts');
  const u = await makeStudent(t, { email: 'duplo@example.com', name: 'Duplo Papel' });
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING", [u.id]);
  await q("INSERT INTO enrollments (user_id, course_id, origin, status, created_at) VALUES ($1,$2,'manual','active',$3)", [u.id, course, ago(10)]);
  await q("INSERT INTO affiliates (name, email, user_id, status, created_at) VALUES ('Duplo Papel','duplo@example.com',$1,'active',$2)", [u.id, ago(30)]);
  const st = async (fn) => (await fn()).find((p) => p.email === 'duplo@example.com');
  assert.equal((await st(() => N.studentsOf(courseRow, 'novos'))).status, 'send');
  assert.equal((await st(() => N.affiliatesOf('nunca'))).status, 'send');
  // lembrete de CURSO: bloqueia o curso, não o afiliado
  const course_ = { kind: 'aluno', course: courseRow, group: 'novos', selected: new Set([String(u.id)]), subject: 'Assunto de teste', message: 'Mensagem de teste longa o bastante.', adminId: null };
  const mm = require('../src/mailer'); const real = mm.send; mm.send = async () => ({ ok: true });
  try {
    await N.sendBatch(t.cfg, null, { ...course_, token: 'd'.repeat(24) });
    assert.equal((await st(() => N.studentsOf(courseRow, 'novos'))).status, 'recent');
    assert.equal((await st(() => N.affiliatesOf('nunca'))).status, 'send');
    assert.equal((await st(() => N.affiliatesOf('nunca'))).lastReminder, null);
    // lembrete de AFILIADO: agora bloqueia o afiliado, e o curso segue como estava
    const aff = (await q("SELECT id FROM affiliates WHERE email='duplo@example.com'")).rows[0].id;
    await N.sendBatch(t.cfg, null, { kind: 'afiliado', course: null, group: 'nunca', selected: new Set([String(aff)]), subject: 'Assunto de teste', message: 'Mensagem de teste longa o bastante.', token: 'e'.repeat(24), adminId: null });
    assert.equal((await st(() => N.affiliatesOf('nunca'))).status, 'recent');
    assert.notEqual((await st(() => N.affiliatesOf('nunca'))).lastReminder, null);
    assert.equal((await st(() => N.studentsOf(courseRow, 'novos'))).status, 'recent'); // o do curso segue com o prazo próprio
    // um segundo envio de afiliado com outro token é barrado (mesma regra dentro do tipo)
    await assert.rejects(() => N.sendBatch(t.cfg, null, { kind: 'afiliado', course: null, group: 'nunca', selected: new Set([String(aff)]), subject: 'Assunto de teste', message: 'Mensagem de teste longa o bastante.', token: 'f'.repeat(24), adminId: null }), /Ninguém para receber/);
  } finally { mm.send = real; }
  assert.equal((await q("SELECT count(*)::int AS n FROM reminder_log WHERE lower(email)='duplo@example.com'")).rows[0].n, 2);
});
