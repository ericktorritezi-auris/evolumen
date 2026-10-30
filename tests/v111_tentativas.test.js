'use strict';
// 1.1.1 · Tentativas esgotadas: campainha do administrador (quiz e prova final), liberação de 1 a 10 tentativas,
// campainha + e-mail para o aluno e aviso do administrador resolvido.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent, mailer } = require('./helpers');

let t; let admin; let sb; let stu; let other; let course; let quiz; let fin; let la;
const slug = 'curso-tentativas';
const q = (sql, p) => t.pool.query(sql, p);
const base = `/curso/${slug}`;
const bells = async (kind = 'attempts') => (await q("SELECT n.* FROM notifications n WHERE n.kind=$1 ORDER BY n.id", [kind])).rows;
const adminBells = async () => (await bells()).filter((n) => n.user_id === adminId);
let adminId;

async function addQuestions(a, n) {
  for (let i = 0; i < n; i++) await admin.post(`/admin/avaliacoes/${a}/questoes`, { kind: 'single', body: `Pergunta ${i + 1}`, opt_0: 'Errada 1', opt_1: 'Certa', opt_2: 'Errada 2', correct: '1', explanation: 'x' }, `/admin/avaliacoes/${a}`);
}
// Faz uma tentativa e acerta `rights` questões.
async function attempt(b, user, a, rights) {
  const st = await b.post(`${base}/avaliacao/${a}/iniciar`, {}, `${base}/avaliacao/${a}`);
  assert.equal(st.status, 303);
  const at = (await q('SELECT * FROM assessment_attempts WHERE assessment_id=$1 AND user_id=$2 AND finished_at IS NULL', [a, user.id])).rows[0];
  assert.ok(at, 'tentativa aberta');
  const f = { attempt: String(at.id) }; let i = 0;
  for (const qq of at.snapshot) {
    const right = (await q('SELECT id FROM assessment_options WHERE question_id=$1 AND correct', [qq.id])).rows[0].id;
    const wrong = qq.options.find((o) => String(o.id) !== String(right)).id;
    f[`q_${qq.id}`] = String(i < rights ? right : wrong); i++;
  }
  await b.post(`${base}/avaliacao/${a}/enviar`, f, `${base}/avaliacao/${a}`);
  return (await q('SELECT * FROM assessment_attempts WHERE id=$1', [at.id])).rows[0];
}
const grant = (a, user, qtd) => admin.post(`/admin/avaliacoes/${a}/extra`, qtd === undefined ? { user: String(user.id) } : { user: String(user.id), qtd: String(qtd) }, `/admin/avaliacoes/${a}/tentativas`);
const extras = async (a, user) => Number((await q('SELECT COALESCE(sum(extra),0)::int n FROM attempt_grants WHERE assessment_id=$1 AND user_id=$2', [a, user.id])).rows[0].n);
const flush = () => t.app.locals.idle();

before(async () => {
  t = await boot(); admin = await adminReady(t);
  adminId = (await q("SELECT id FROM users WHERE role='admin'")).rows[0].id;
  await admin.post('/admin/cursos', { title: 'Curso Tentativas', slug, summary: 'Resumo.', description: 'Desc', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice_days: '30', publish: '1' }, '/admin/cursos/novo');
  course = (await q('SELECT id FROM courses WHERE slug=$1', [slug])).rows[0].id;
  const m1 = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'Base',1) RETURNING id", [course])).rows[0].id;
  la = (await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'Aula A',1,'dQw4w9WgXcQ') RETURNING id", [course, m1])).rows[0].id;
  await admin.post(`/admin/cursos/${course}/avaliacoes`, { kind: 'quiz', module_id: String(m1) }, `/admin/cursos/${course}/avaliacoes`);
  await admin.post(`/admin/cursos/${course}/avaliacoes`, { kind: 'final' }, `/admin/cursos/${course}/avaliacoes`);
  quiz = (await q("SELECT id FROM assessments WHERE kind='quiz'")).rows[0].id; fin = (await q("SELECT id FROM assessments WHERE kind='final'")).rows[0].id;
  await addQuestions(quiz, 3); await addQuestions(fin, 3);
  stu = await makeStudent(t, { email: 'tentativas@example.com', name: 'Tati Tentativas' });
  other = await makeStudent(t, { email: 'outro@example.com', name: 'Outro Aluno' });
  for (const u of [stu, other]) await q("INSERT INTO enrollments (user_id, course_id, origin) VALUES ($1,$2,'manual')", [u.id, course]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status = 'published' ON CONFLICT DO NOTHING");
  sb = new Browser(t.base); await sb.login(stu.email, stu.password);
  await sb.post(`${base}/aula/${la}/concluir`, { done: '1' }, `${base}/aula/${la}`);
});
after(async () => { await t.close(); });

test('só avisa o administrador quando a última tentativa é gasta sem passar', async () => {
  await attempt(sb, stu, quiz, 1); await attempt(sb, stu, quiz, 1);
  assert.equal((await bells()).length, 0, 'tentativas 1 e 2 de 3: nenhum aviso');
  await attempt(sb, stu, quiz, 1);
  const n = await adminBells();
  assert.equal(n.length, 1);
  assert.match(n[0].title, /Tati Tentativas esgotou as tentativas/); assert.match(n[0].body, /quiz/); assert.match(n[0].body, /Curso Tentativas/);
  assert.equal(n[0].link, `/admin/avaliacoes/${quiz}/tentativas?aluno=${stu.id}`); assert.equal(n[0].read_at, null);
  assert.equal((await bells()).length, 1, 'o aluno não recebe esse aviso');
  // o aviso aparece na campainha do administrador e abre direto na tela de liberação
  const list = JSON.parse((await admin.get('/notificacoes.json')).text); assert.equal(list.unread >= 1, true);
  assert.ok(list.items.some((x) => /esgotou as tentativas/.test(x.title)));
  const open = await admin.get(`/notificacoes/${n[0].id}/abrir`); assert.equal(open.status, 303); assert.equal(open.location, n[0].link, 'a campainha leva direto à liberação');
  const page = await admin.get(n[0].link);
  assert.equal(page.status, 200); assert.match(page.text, /Liberar tentativas/); assert.match(page.text, /is-focus/); assert.match(page.text, /autofocus/); assert.match(page.text, /name="qtd" type="number" min="1" max="10"/);
  assert.match(page.text, /Sem tentativas/);
  // outro aluno que ainda tem tentativa não aparece com campo de foco
  const ok = await admin.get(`/admin/avaliacoes/${quiz}/tentativas?aluno=${other.id}`); assert.match(ok.text, /is-focus/);
});

test('liberar quantidade: valida de 1 a 10, grava, resolve o aviso do admin e avisa o aluno por campainha e e-mail', async () => {
  const url = `/admin/avaliacoes/${quiz}/tentativas`;
  for (const bad of ['0', '11', '-1', 'abc', '', '2.5', '100']) {
    const r = await grant(quiz, stu, bad); assert.equal(r.status, 303, bad);
    assert.equal(await extras(quiz, stu), 0, `"${bad}" não libera`);
  }
  assert.equal((await q('SELECT count(*)::int n FROM audit_log WHERE action=$1', ['attempt_granted'])).rows[0].n, 0);
  mailer.memory.length = 0;
  const r = await grant(quiz, stu, 2); assert.equal(r.status, 303);
  assert.equal(await extras(quiz, stu), 2);
  const aud = (await q("SELECT meta FROM audit_log WHERE action='attempt_granted'")).rows; assert.equal(aud.length, 1); assert.equal(aud[0].meta.qtd, 2); assert.equal(String(aud[0].meta.user), String(stu.id));
  const adm = await adminBells(); assert.ok(adm[0].read_at, 'aviso do administrador resolvido');
  const mine = (await bells()).filter((n) => n.user_id === stu.id);
  assert.equal(mine.length, 1); assert.equal(mine[0].title, 'Mais 2 tentativas foram liberadas para você'); assert.equal(mine[0].link, `${base}/avaliacao/${quiz}`); assert.equal(mine[0].read_at, null);
  await flush();
  const mail = mailer.memory.find((m) => m.to === stu.email);
  assert.ok(mail, 'e-mail enviado ao aluno'); assert.match(mail.subject, /Mais 2 tentativas liberadas/); assert.match(mail.html, /mais 2 tentativas/); assert.match(mail.html, new RegExp(`http://localhost:3000${base}/avaliacao/${quiz}`)); assert.equal(mail.template, 'tentativas_liberadas');
  assert.equal(mailer.memory.filter((m) => m.to !== stu.email && /tentativa/i.test(m.subject)).length, 0, 'ninguém mais recebe');
  assert.match((await admin.get(url)).text, /3 de 5/); assert.match((await admin.get(url)).text, /\(\+2 extra\)/);
  // a campainha do aluno mostra o aviso, e o aluno volta a poder tentar
  assert.ok(JSON.parse((await sb.get('/notificacoes.json')).text).items.some((x) => /Mais 2 tentativas/.test(x.title)));
  const again = await attempt(sb, stu, quiz, 1); assert.equal(again.number, 4);
  assert.equal((await adminBells()).length, 1, 'ainda sobra 1 tentativa: sem novo aviso');
  await attempt(sb, stu, quiz, 1);
  const now = await adminBells();
  assert.equal(now.length, 2, 'esgotou de novo (5 de 5): novo aviso'); assert.equal(now[1].read_at, null); assert.match(now[1].link, new RegExp(`aluno=${stu.id}`));
  // sem o campo (formulário antigo) libera uma
  mailer.memory.length = 0;
  await grant(quiz, stu); assert.equal(await extras(quiz, stu), 3);
  await flush(); assert.match(mailer.memory.find((m) => m.to === stu.email).subject, /Mais uma tentativa liberada/);
  assert.equal((await bells()).filter((n) => n.user_id === stu.id).pop().title, 'Mais uma tentativa foi liberada para você');
  assert.ok((await adminBells())[1].read_at, 'o segundo aviso também foi resolvido');
});

test('aluno aprovado não recebe tentativa; aprovar na última tentativa não avisa; aluno comum não libera', async () => {
  const ok = await attempt(sb, stu, quiz, 3); assert.equal(ok.passed, true); assert.equal(ok.number, 6);
  assert.equal((await adminBells()).length, 2, 'passou na última tentativa disponível (6 de 6): nenhum aviso novo');
  const before = await extras(quiz, stu);
  await grant(quiz, stu, 3); assert.equal(await extras(quiz, stu), before, 'já aprovado: não libera');
  assert.equal((await adminBells()).length, 2);
  assert.equal((await sb.post(`/admin/avaliacoes/${quiz}/extra`, { user: String(other.id), qtd: '5' }, '/meus-cursos')).status, 403);
  assert.equal(await extras(quiz, other), 0);
  assert.equal((await new Browser(t.base).get(`/admin/avaliacoes/${quiz}/tentativas`)).status === 200, false);
});

test('prova final: esgotar as tentativas também avisa, com o texto da prova, e a liberação funciona igual', async () => {
  await q('INSERT INTO exam_unlocks (assessment_id, user_id, granted_by) VALUES ($1,$2,$3)', [fin, other.id, adminId]);
  const ob = new Browser(t.base); await ob.login(other.email, other.password);
  // o outro aluno precisa ter o quiz aprovado para chegar à prova
  await ob.post(`${base}/aula/${la}/concluir`, { done: '1' }, `${base}/aula/${la}`);
  const startQuiz = async () => { const at = await (async () => { await ob.post(`${base}/avaliacao/${quiz}/iniciar`, {}, `${base}/avaliacao/${quiz}`); return (await q('SELECT * FROM assessment_attempts WHERE assessment_id=$1 AND user_id=$2 AND finished_at IS NULL', [quiz, other.id])).rows[0]; })(); return at; };
  const qa = await startQuiz(); const f = { attempt: String(qa.id) };
  for (const qq of qa.snapshot) f[`q_${qq.id}`] = String((await q('SELECT id FROM assessment_options WHERE question_id=$1 AND correct', [qq.id])).rows[0].id);
  await ob.post(`${base}/avaliacao/${quiz}/enviar`, f, `${base}/avaliacao/${quiz}`);
  const startsBefore = (await bells()).length;
  for (let i = 0; i < 3; i++) await attempt(ob, other, fin, 0);
  const all = (await bells()).filter((n) => n.user_id === adminId && String(n.subject_user_id) === String(other.id));
  assert.equal(all.length, 1); assert.match(all[0].title, /Outro Aluno esgotou as tentativas/); assert.match(all[0].body, /^A prova final · Curso Tentativas$/);
  assert.equal(all[0].link, `/admin/avaliacoes/${fin}/tentativas?aluno=${other.id}`);
  assert.ok((await bells()).length > startsBefore);
  const r = await grant(fin, other, 10); assert.equal(r.status, 303); assert.equal(await extras(fin, other), 10);
  assert.ok((await q('SELECT read_at FROM notifications WHERE id=$1', [all[0].id])).rows[0].read_at);
  const mine = (await bells()).filter((n) => n.user_id === other.id).pop(); assert.equal(mine.title, 'Mais 10 tentativas foram liberadas para você'); assert.match(mine.body, /Prova final/);
  assert.equal((await attempt(ob, other, fin, 0)).number, 4);
  // o aluno não consegue abrir a tela de liberação nem ver avisos do administrador
  const lst = JSON.parse((await ob.get('/notificacoes.json')).text); assert.ok(!lst.items.some((x) => /esgotou as tentativas/.test(x.title)));
});

test('duplo clique em Liberar não libera duas vezes', async () => {
  const before = await extras(fin, other);
  await grant(fin, other, 3); await grant(fin, other, 3);
  assert.equal(await extras(fin, other), before + 3);
});
