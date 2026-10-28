'use strict';
// 0.6.0 · Fase 5: fórum por aula, avaliação do curso, LGPD, configurações, ajuda e landing.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent, mailer } = require('./helpers');
const Co = require('../src/community');
const L = require('../src/lgpd');

let t; let admin; let course; let lessonId; let ana; let bia; let outsider; let anaB; let biaB; let outB;
const slug = 'curso-forum';
const q = (sql, p) => t.pool.query(sql, p);
const aula = () => `/curso/${slug}/aula/${lessonId}`;
async function loginAs(u) { const b = new Browser(t.base); const r = await b.login(u.email, u.password); assert.equal(r.status, 303); return b; }

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await admin.post('/admin/cursos', { title: 'Curso do Fórum', slug, summary: 'R', description: 'D', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice: '' }, '/admin/cursos/novo');
  course = (await q('SELECT id FROM courses WHERE slug=$1', [slug])).rows[0].id;
  await q("UPDATE courses SET status='published', published_at=now() - interval '1 day' WHERE id=$1", [course]);
  const mod = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'M',1) RETURNING id", [course])).rows[0].id;
  lessonId = (await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'Aula Um',1,'dQw4w9WgXcQ') RETURNING id", [course, mod])).rows[0].id;
  ana = await makeStudent(t, { email: 'ana@example.com', name: 'Ana Paula Souza' }); bia = await makeStudent(t, { email: 'bia@example.com', name: 'Bia Lima' }); outsider = await makeStudent(t, { email: 'fora@example.com', name: 'Fora Sem Acesso' });
  for (const u of [ana, bia]) await q("INSERT INTO enrollments (user_id, course_id, origin) VALUES ($1,$2,'manual')", [u.id, course]);
  anaB = await loginAs(ana); biaB = await loginAs(bia); outB = await loginAs(outsider);
});
after(async () => { await t.close(); });

test('fórum: aluno pergunta, o professor é avisado, responde e o aluno é avisado', async () => {
  mailer.memory.length = 0;
  const bad = await anaB.post(`${aula()}/forum`, { body: 'x' }, aula()); assert.equal(bad.status, 303);
  assert.equal((await q('SELECT count(*)::int AS n FROM forum_posts')).rows[0].n, 0, 'texto curto demais não grava');
  const ok = await anaB.post(`${aula()}/forum`, { body: 'Não entendi o conceito da aula 1.' }, aula()); assert.equal(ok.status, 303);
  const post = (await q('SELECT * FROM forum_posts')).rows[0]; assert.equal(post.by_admin, false); assert.equal(post.parent_id, null);
  await t.app.locals.idle();
  assert.ok(mailer.memory.find((m) => m.to === 'erick@example.com' && /dúvida/i.test(m.subject)), 'professor avisado');
  const page = await biaB.get(aula()); assert.match(page.text, /Não entendi o conceito/); assert.match(page.text, /Ana S\./, 'só primeiro nome e inicial do sobrenome');
  assert.ok(!page.text.includes('Ana Paula Souza'));
  const rep = await admin.post(`${aula()}/forum`, { body: 'Veja o exemplo no minuto 3.', parent: String(post.id) }, aula()); assert.equal(rep.status, 303);
  await t.app.locals.idle();
  assert.ok(mailer.memory.find((m) => m.to === 'ana@example.com' && /respondeu/i.test(m.subject)), 'aluna avisada da resposta');
  assert.equal((await q('SELECT by_admin FROM forum_posts WHERE parent_id IS NOT NULL')).rows[0].by_admin, true);
  const noDel = await anaB.post(`${aula()}/forum/${post.id}/excluir`, {}, aula()); assert.equal(noDel.status, 303);
  assert.equal((await q('SELECT count(*)::int AS n FROM forum_posts WHERE id=$1', [post.id])).rows[0].n, 1, 'com resposta não apaga');
});

test('fórum: sem acesso ao curso não lê nem escreve; resposta a pergunta inexistente é recusada', async () => {
  const r = await outB.post(`${aula()}/forum`, { body: 'Entrando de penetra' }, '/meus-cursos'); assert.equal(r.status, 403);
  assert.equal((await outB.get(aula())).status, 403);
  await assert.rejects(() => Co.create({ user: { id: ana.id, role: 'student' }, course: { id: course }, lesson: { id: lessonId }, body: 'oi tudo bem', parentId: '999999' }), /não encontrada/);
  await assert.rejects(() => Co.create({ user: { id: ana.id, role: 'student' }, course: { id: course }, lesson: { id: lessonId }, body: 'a'.repeat(2001) }), /até 2000/);
});

test('fórum: ocultar some para os alunos, apagar só a própria sem respostas, desligar nas configurações', async () => {
  const mine = await biaB.post(`${aula()}/forum`, { body: 'Pergunta da Bia para apagar.' }, aula());
  const bp = (await q("SELECT id FROM forum_posts WHERE user_id=$1", [bia.id])).rows[0].id;
  assert.equal((await admin.post(`/admin/forum/${bp}/ocultar`, { back: aula() }, '/admin/forum')).status, 303);
  assert.ok(!(await anaB.get(aula())).text.includes('Pergunta da Bia'), 'oculta some para outros');
  assert.match((await admin.get(aula())).text, /Pergunta da Bia/); assert.match((await admin.get(aula())).text, /Oculta/);
  await admin.post(`/admin/forum/${bp}/mostrar`, { back: 'https://evil.example/' }, '/admin/forum');
  assert.equal((await q('SELECT status FROM forum_posts WHERE id=$1', [bp])).rows[0].status, 'visible');
  assert.equal((await anaB.post(`${aula()}/forum/${bp}/excluir`, {}, aula())).status, 303);
  assert.equal((await q('SELECT count(*)::int AS n FROM forum_posts WHERE id=$1', [bp])).rows[0].n, 1, 'não apaga a de outra pessoa');
  await biaB.post(`${aula()}/forum/${bp}/excluir`, {}, aula());
  assert.equal((await q('SELECT count(*)::int AS n FROM forum_posts WHERE id=$1', [bp])).rows[0].n, 0, 'apaga a própria');
  // fila do administrador e ajuste de configuração
  const fila = await admin.get('/admin/forum?f=all'); assert.equal(fila.status, 200); assert.match(fila.text, /Fórum e avaliações/);
  await admin.post('/admin/configuracoes', { support_email: 'suporte@example.com', support_whatsapp: '(11) 91234-5678', notify_questions: '1' }, '/admin/configuracoes'); // fórum desligado (checkbox ausente)
  const off = await anaB.get(aula()); assert.match(off.text, /fórum está desativado/);
  const blocked = await anaB.post(`${aula()}/forum`, { body: 'Escrevendo com o fórum desligado' }, aula()); assert.equal(blocked.status, 303);
  assert.equal((await q("SELECT count(*)::int AS n FROM forum_posts WHERE body LIKE 'Escrevendo com%'")).rows[0].n, 0);
  await admin.post('/admin/configuracoes', { support_email: 'suporte@example.com', support_whatsapp: '(11) 91234-5678', forum_enabled: '1', notify_questions: '1' }, '/admin/configuracoes');
});

test('avaliação: só depois do certificado; edita sem duplicar; NPS no painel', async () => {
  const early = await anaB.post(`/curso/${slug}/avaliar`, { stars: '5', nps: '10' }, `/curso/${slug}`); assert.equal(early.status, 303);
  assert.equal((await q('SELECT count(*)::int AS n FROM course_reviews')).rows[0].n, 0, 'sem certificado não avalia');
  assert.doesNotMatch((await anaB.get(`/curso/${slug}`)).text, /Como foi o curso/);
  for (const u of [ana, bia]) await q(`INSERT INTO certificates (code, user_id, course_id, student_name, course_title, body_text) VALUES ($1,$2,$3,'x','Curso do Fórum','x')`, ['EVL-F-' + u.id, u.id, course]);
  assert.match((await anaB.get(`/curso/${slug}`)).text, /Como foi o curso/);
  assert.equal((await anaB.post(`/curso/${slug}/avaliar`, { stars: '9', nps: '10' }, `/curso/${slug}`)).status, 303);
  assert.equal((await q('SELECT count(*)::int AS n FROM course_reviews')).rows[0].n, 0, 'estrelas inválidas');
  await anaB.post(`/curso/${slug}/avaliar`, { stars: '5', nps: '10', comment: 'Excelente!' }, `/curso/${slug}`);
  await anaB.post(`/curso/${slug}/avaliar`, { stars: '4', nps: '9', comment: 'Muito bom.' }, `/curso/${slug}`);
  await biaB.post(`/curso/${slug}/avaliar`, { stars: '2', nps: '3', comment: '' }, `/curso/${slug}`);
  assert.equal((await q('SELECT count(*)::int AS n FROM course_reviews')).rows[0].n, 2);
  assert.equal((await q('SELECT stars FROM course_reviews WHERE user_id=$1', [ana.id])).rows[0].stars, 4, 'a edição vale');
  const sum = (await Co.reviewSummary())[0]; assert.equal(sum.n, 2); assert.equal(sum.stars, 3); assert.equal(sum.nps, 0, '1 promotor e 1 detrator = 0');
  assert.match((await admin.get('/admin/forum')).text, /Muito bom\./);
});

test('LGPD: pedido de exclusão, anonimização e o que fica guardado', async () => {
  await q("INSERT INTO forum_posts (course_id, lesson_id, user_id, body) VALUES ($1,$2,$3,'Texto pessoal da Bia')", [course, lessonId, bia.id]);
  await q("INSERT INTO orders (public_id, user_id, course_id, buyer, list_cents, price_cents, method, provider, status, approved_at) VALUES ('LGPD00000000000000000001',$1,$2,'{\"name\":\"Bia\",\"email\":\"bia@example.com\"}'::jsonb,1000,1000,'pix','simulated','approved',now())", [bia.id, course]);
  assert.equal((await biaB.post('/perfil/exclusao', {}, '/perfil')).status, 303);
  const req = (await q("SELECT * FROM data_requests WHERE user_id=$1 AND type='delete'", [bia.id])).rows[0];
  assert.ok(req.due_at && new Date(req.due_at) > new Date(Date.now() + 14 * 86400000), 'prazo de 15 dias');
  assert.match((await admin.get('/admin/lgpd')).text, /Exclusão dos dados/);
  const dump = await admin.get(`/admin/lgpd/pedidos/${req.id}/dados.json`); assert.equal(dump.status, 200);
  const j = JSON.parse(dump.text); assert.equal(j.usuario.email, 'bia@example.com'); assert.ok(!('password_hash' in j.usuario)); assert.ok(j.compras.length === 1 && j.mensagens_do_forum.length >= 1);
  mailer.memory.length = 0;
  assert.equal((await admin.post(`/admin/lgpd/pedidos/${req.id}/resolver`, { action: 'done', note: 'Feito.' }, '/admin/lgpd')).status, 303);
  await t.app.locals.idle();
  assert.ok(mailer.memory.find((m) => m.to === 'bia@example.com'), 'avisada no e-mail antigo');
  const u = (await q('SELECT * FROM users WHERE id=$1', [bia.id])).rows[0];
  assert.equal(u.name, 'Aluno removido'); assert.match(u.email, /^removido-\d+@removido\.invalid$/); assert.equal(u.cpf, null); assert.equal(u.status, 'blocked');
  assert.equal((await q('SELECT count(*)::int AS n FROM sessions WHERE user_id=$1', [bia.id])).rows[0].n, 0);
  assert.equal((await q("SELECT count(*)::int AS n FROM forum_posts WHERE user_id=$1 AND body = $2", [bia.id, L.REMOVED])).rows[0].n, 1);
  assert.equal((await q('SELECT count(*)::int AS n FROM orders WHERE user_id=$1', [bia.id])).rows[0].n, 1, 'pedido fica por obrigação legal');
  assert.equal((await q("SELECT status FROM enrollments WHERE user_id=$1", [bia.id])).rows[0].status, 'cancelled');
  assert.equal((await new Browser(t.base).login('bia@example.com', bia.password)).status, 401, 'não entra mais');
  const again = await admin.post(`/admin/lgpd/pedidos/${req.id}/resolver`, { action: 'done' }, '/admin/lgpd'); assert.equal(again.status, 303);
  const adminId = (await q("SELECT id FROM users WHERE role='admin'")).rows[0].id;
  await assert.rejects(() => L.anonymize(adminId), /não pode ser anonimizada/, 'administrador nunca é anonimizado');
});

test('LGPD: aceites filtrados, CSV seguro e acesso só do administrador', async () => {
  const docs = (await q("INSERT INTO legal_documents (doc_type, version, title, body_html, status, published_at) VALUES ('terms','1','Termos','<p>x</p>','published',now()) RETURNING id")).rows[0].id;
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, ip, device, origin) VALUES ($1,$2,'terms','1','10.1.2.3','Chrome em Linux','login')", [ana.id, docs]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, ip, origin) SELECT id, $1, 'terms', '1', '10.0.0.1', 'login' FROM users WHERE role = 'admin'", [docs]);
  await q("UPDATE users SET name = '=HYPERLINK(\"http://x\")' WHERE id = $1", [outsider.id]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, ip, origin) VALUES ($1,$2,'terms','1','10.9.9.9','login')", [outsider.id, docs]);
  const page = await admin.get('/admin/lgpd?aba=aceites&q=ana'); assert.match(page.text, /10\.1\.2\.3/); assert.ok(!page.text.includes('10.9.9.9'));
  const csv = await admin.get('/admin/lgpd/aceites.csv'); assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text, /10\.1\.2\.3/); assert.ok(!csv.text.includes(';=HYPERLINK'), 'fórmula neutralizada'); assert.match(csv.text, /'=HYPERLINK/);
  for (const path of ['/admin/lgpd', '/admin/lgpd/aceites.csv', '/admin/configuracoes', '/admin/forum']) {
    assert.notEqual((await anaB.get(path)).status, 200, path + ' fechado ao aluno'); assert.notEqual((await new Browser(t.base).get(path)).status, 200);
  }
  assert.equal((await anaB.post('/admin/lgpd/pedidos/1/resolver', { action: 'done' }, '/perfil')).status === 200, false);
});

test('configurações, ajuda e landing', async () => {
  const bad = await admin.post('/admin/configuracoes', { support_email: 'sem-arroba', support_whatsapp: 'abc' }, '/admin/configuracoes'); assert.equal(bad.status, 422);
  assert.match(bad.text, /e-mail válido/);
  const cfgPage = await admin.get('/admin/configuracoes'); assert.match(cfgPage.text, /Situação do sistema/); assert.match(cfgPage.text, /0\.6\.1/); assert.ok(!/SESSION_SECRET|ACCESS_TOKEN/.test(cfgPage.text));
  const aj = await anaB.get('/ajuda'); assert.equal(aj.status, 200); assert.match(aj.text, /suporte@example\.com/); assert.match(aj.text, /Perguntas frequentes/);
  const lesson = await anaB.get(aula()); assert.match(lesson.text, /data-help-open/); assert.match(lesson.text, /Assistindo a uma aula/, 'ajuda contextual da aula, não a do menu');
  assert.match((await admin.get('/admin/forum')).text, /Fórum e avaliações/); assert.match((await admin.get('/admin/forum')).text, /Ajuda da Lumen/);
  const home = await new Browser(t.base).get('/'); assert.equal(home.status, 200); assert.ok(!home.text.includes('Sociedade Brasileira de Coaching')); assert.match(home.text, /ABRAPH/); assert.match(home.text, /ATH/);
});

test('revisão 0.6.0: mensagem repetida, pedido de exclusão duplicado, e-mail antigo limpo e exportação completa', async () => {
  const before_ = (await q('SELECT count(*)::int AS n FROM forum_posts')).rows[0].n;
  await anaB.post(`${aula()}/forum`, { body: 'Mensagem repetida por duplo clique.' }, aula());
  await anaB.post(`${aula()}/forum`, { body: 'Mensagem repetida por duplo clique.' }, aula());
  assert.equal((await q('SELECT count(*)::int AS n FROM forum_posts')).rows[0].n, before_ + 1, 'a repetida é recusada');
  await anaB.post('/perfil/exclusao', {}, '/perfil'); await anaB.post('/perfil/exclusao', {}, '/perfil');
  assert.equal((await q("SELECT count(*)::int AS n FROM data_requests WHERE user_id=$1 AND type='delete' AND status='open'", [ana.id])).rows[0].n, 1);
  await q("INSERT INTO email_log (to_email, subject, template, status) VALUES ('ana@example.com','x','t','sent')");
  const dump = JSON.parse((await anaB.get('/perfil/meus-dados.json')).text);
  assert.ok(Array.isArray(dump.tentativas_de_avaliacao) && dump.emails_enviados.length >= 1);
  const rq = (await q("SELECT id FROM data_requests WHERE user_id=$1 AND type='delete'", [ana.id])).rows[0].id;
  await admin.post(`/admin/lgpd/pedidos/${rq}/resolver`, { action: 'done' }, '/admin/lgpd');
  assert.equal((await q("SELECT count(*)::int AS n FROM email_log WHERE lower(to_email)='ana@example.com'")).rows[0].n, 0, 'e-mail antigo sai do registro de envios');
  assert.equal((await q('SELECT name FROM users WHERE id=$1', [ana.id])).rows[0].name, 'Aluno removido');
});
