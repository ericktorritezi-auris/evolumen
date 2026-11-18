'use strict';
// 2.3.0 · Atividade complementar: opção na aula (padrão desmarcada), bloqueio até a aprovação do professor, envio de 1 a 5 links https,
// avaliação (aprovado, ajustes, não aprovado), dispensa, reabertura, avisos, prova final e certificado.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent, mailer } = require('./helpers');
const A = require('../src/assess');
const C = require('../src/courses');

let t; let admin; let course; let courseRow; let m1; let m2; let L = {}; let S = {}; let B = {};
const q = (sql, p) => t.pool.query(sql, p);
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';
const wait = async (fn, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); } return fn(); };
const enroll = async (key) => {
  S[key] = await makeStudent(t, { email: `${key}@example.com`, name: `Aluno ${key}` });
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING", [S[key].id]);
  await q("INSERT INTO enrollments (user_id, course_id, origin, status) VALUES ($1,$2,'manual','active')", [S[key].id, course]);
  B[key] = new Browser(t.base); await B[key].login(S[key].email, S[key].password);
};
const sub = (key, links) => B[key].post(`/curso/${courseRow.slug}/aula/${L.act}/atividade`, links, `/curso/${courseRow.slug}/aula/${L.act}`);
const ok2 = { label: ['Arquivo', 'Vídeo'], url: ['https://drive.google.com/file/d/abc/view', 'https://youtu.be/xyz12345'] };
const lastSub = async (key) => (await q('SELECT * FROM activity_submissions WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [S[key].id])).rows[0];
const ov = (key) => A.overview(S[key].id, courseRow);
const evalSub = (id, body) => admin.post(`/admin/atividades/${id}/avaliar`, body, `/admin/atividades/${id}`);

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await q("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy','affiliate')", [LONG]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING");
  await admin.post('/admin/cursos', { title: 'Curso Atividade', slug: 'curso-atividade', summary: 'Resumo.', description: 'Desc', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice_days: '30', publish: '1' }, '/admin/cursos/novo');
  course = (await q("SELECT id FROM courses WHERE slug='curso-atividade'")).rows[0].id;
  courseRow = await C.byId(course);
  m1 = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'Base',1) RETURNING id", [course])).rows[0].id;
  m2 = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'Prática',2) RETURNING id", [course])).rows[0].id;
  const mk = async (m, title, pos) => (await q("INSERT INTO lessons (course_id, module_id, title, position) VALUES ($1,$2,$3,$4) RETURNING id", [course, m, title, pos])).rows[0].id;
  L.a1 = await mk(m1, 'Aula 1', 1); L.act = await mk(m1, 'Atividade prática', 2); L.a3 = await mk(m2, 'Aula 3', 3); L.a4 = await mk(m2, 'Aula 4', 4);
  await enroll('ana'); await enroll('bia'); await enroll('caio'); await enroll('dani');
});
after(async () => { await t.close(); });

test('padrão: nenhuma aula é atividade e o fluxo antigo segue igual', async () => {
  assert.equal((await q('SELECT count(*)::int AS n FROM lessons WHERE is_activity')).rows[0].n, 0);
  const r = await B.ana.post(`/curso/${courseRow.slug}/aula/${L.a1}/concluir`, { done: '1' }, `/curso/${courseRow.slug}/aula/${L.a1}`);
  assert.equal(r.status, 303);
  const o = await ov('ana');
  assert.equal(o.act.gate, null); assert.equal(o.cert.actOk, true);
  assert.equal(o.act.blocked.size, 0);
  const page = (await B.ana.get(`/curso/${courseRow.slug}/aula/${L.act}`)).text;
  assert.match(page, /aula\/\d+\/concluir/);
  assert.doesNotMatch(page, /Atividade complementar<\/h2>/);
});

test('cadastro: bônus e atividade não convivem; quiz ativo no módulo impede; aluno que avançou é contado', async () => {
  const save = (extra) => admin.post(`/admin/aulas/${L.act}`, { title: 'Atividade prática', video: '', instagram: '', description: '', duration_min: '', ...extra }, `/admin/cursos/${course}/conteudo`);
  let r = await save({ is_bonus: '1', is_activity: '1' });
  assert.equal(r.status, 303); assert.equal((await q('SELECT is_activity FROM lessons WHERE id=$1', [L.act])).rows[0].is_activity, false);
  // quiz ativo no módulo 1
  const qz = (await q("INSERT INTO assessments (course_id, module_id, kind, title, active) VALUES ($1,$2,'quiz','Quiz',true) RETURNING id", [course, m1])).rows[0].id;
  await save({ is_activity: '1' });
  assert.equal((await q('SELECT is_activity FROM lessons WHERE id=$1', [L.act])).rows[0].is_activity, false);
  await q('DELETE FROM assessments WHERE id = $1', [qz]);
  // bia já avançou além da atividade (concluiu aulas do módulo 2)
  await q('INSERT INTO lesson_progress (user_id, lesson_id) VALUES ($1,$2),($1,$3)', [S.bia.id, L.a1, L.a3]);
  r = await save({ is_activity: '1' });
  assert.equal(r.status, 303);
  assert.equal((await q('SELECT is_activity, is_bonus FROM lessons WHERE id=$1', [L.act])).rows[0].is_activity, true);
  const next = await admin.get(`/admin/cursos/${course}/conteudo`);
  assert.match(next.text, /1 aluno já avançou/);
  // criar quiz no módulo com atividade é recusado
  await admin.post(`/admin/cursos/${course}/avaliacoes`, { kind: 'quiz', module_id: String(m1) }, `/admin/cursos/${course}/avaliacoes`);
  assert.equal((await q("SELECT count(*)::int AS n FROM assessments WHERE module_id=$1", [m1])).rows[0].n, 0);
});

test('bloqueio: aulas seguintes, prova final e certificado dependem da aprovação', async () => {
  const o = await ov('ana');
  assert.equal(String(o.act.gate.id), String(L.act));
  assert.equal(o.act.blocked.has(String(L.a3)), true); assert.equal(o.act.blocked.has(String(L.act)), false);
  assert.equal(o.cert.actOk, false); assert.equal(o.cert.eligible, false);
  // a aula bloqueada redireciona para a atividade
  const r = await B.ana.get(`/curso/${courseRow.slug}/aula/${L.a3}`);
  assert.equal(r.status, 303); assert.match(r.location, new RegExp(`/aula/${L.act}$`));
  // "concluir" a atividade pelo aluno é recusado
  const c = await B.ana.post(`/curso/${courseRow.slug}/aula/${L.act}/concluir`, { done: '1' }, `/curso/${courseRow.slug}/aula/${L.act}`);
  assert.equal(c.status, 303);
  assert.equal((await q('SELECT count(*)::int AS n FROM lesson_progress WHERE user_id=$1 AND lesson_id=$2', [S.ana.id, L.act])).rows[0].n, 0);
  // aluno que já tinha avançado também fica bloqueado
  assert.equal((await B.bia.get(`/curso/${courseRow.slug}/aula/${L.a4}`)).status, 303);
  const page = (await B.ana.get(`/curso/${courseRow.slug}/aula/${L.act}`)).text;
  assert.match(page, /Atividade complementar/); assert.match(page, /Enviar para avaliação/); assert.doesNotMatch(page, /aula\/\d+\/concluir/);
  // o administrador não é bloqueado
  assert.equal((await admin.get(`/curso/${courseRow.slug}/aula/${L.a3}`)).status, 200);
});

test('envio: só https, de 1 a 5 links; um por vez; professor é avisado', async () => {
  let r = await sub('ana', { label: ['x'], url: ['http://inseguro.com/a'] });
  assert.equal(r.status, 422); assert.match(r.text, /https:\/\//);
  r = await sub('ana', { label: [''], url: [''] }); assert.equal(r.status, 422);
  r = await sub('ana', { label: ['a'], url: ['javascript:alert(1)'] }); assert.equal(r.status, 422);
  r = await sub('ana', { label: ['a'], url: ['https://usuario:senha@site.com/x'] }); assert.equal(r.status, 422);
  const six = { label: [1, 2, 3, 4, 5, 6].map((n) => `L${n}`), url: [1, 2, 3, 4, 5, 6].map((n) => `https://site${n}.com/a`) };
  r = await sub('ana', six); assert.equal(r.status, 422);
  assert.equal((await q('SELECT count(*)::int AS n FROM activity_submissions')).rows[0].n, 0);
  // um só link (campo único, sem lista)
  r = await sub('ana', ok2); assert.equal(r.status, 303);
  const s1 = await lastSub('ana'); assert.equal(s1.status, 'pending'); assert.equal(s1.links.length, 2); assert.equal(s1.attempt_no, 1);
  const n = (await q("SELECT * FROM notifications WHERE ref_key = $1 AND user_id IN (SELECT id FROM users WHERE role='admin')", [`act:${s1.id}`])).rows;
  assert.equal(n.length, 1); assert.equal(n[0].link, `/admin/atividades/${s1.id}`); assert.equal(n[0].read_at, null);
  r = await sub('ana', ok2); assert.equal(r.status, 409);
  assert.match((await B.ana.get(`/curso/${courseRow.slug}/aula/${L.act}`)).text, /Aguardando aprovação/);
  assert.equal((await ov('ana')).act.lessons[L.act].state, 'pending');
  // links com 5 itens são aceitos
  const five = { label: [1, 2, 3, 4, 5].map((x) => `L${x}`), url: [1, 2, 3, 4, 5].map((x) => `https://site${x}.com/a`) };
  assert.equal((await sub('bia', five)).status, 303);
  assert.equal((await lastSub('bia')).links.length, 5);
});

test('telas do professor: dashboard, lista, aba do curso e avaliação', async () => {
  assert.match((await admin.get('/admin')).text, /2 atividades aguardando sua avaliação/);
  const list = (await admin.get('/admin/atividades?filtro=pendentes')).text;
  assert.match(list, /Aluno ana/); assert.match(list, /Aluno bia/);
  const tab = (await admin.get(`/admin/cursos/${course}/atividades`)).text;
  assert.match(tab, /Dispensar atividade/); assert.match(tab, /Aluno caio/);
  const s1 = await lastSub('ana');
  const ev = (await admin.get(`/admin/atividades/${(await q("SELECT id FROM activity_submissions WHERE user_id=$1", [S.ana.id])).rows[0].id}`)).text;
  assert.match(ev, /drive\.google\.com/); assert.match(ev, /target="_blank"/); assert.match(ev, /Ajustes necessários/);
  assert.equal((await B.ana.get('/admin/atividades')).status, 403);
  void s1;
});

test('avaliação: validações, ajustes, reenvio, aprovação com nota e vírgula', async () => {
  const s = (await q("SELECT id FROM activity_submissions WHERE user_id=$1 AND status='pending'", [S.ana.id])).rows[0].id;
  let r = await evalSub(s, { decision: '', grade: '', summary: 'x' }); assert.equal(r.status, 422);
  r = await evalSub(s, { decision: 'approved', grade: '', summary: 'Bom' }); assert.equal(r.status, 422); assert.match(r.text, /nota/i);
  r = await evalSub(s, { decision: 'approved', grade: '11', summary: 'Bom' }); assert.equal(r.status, 422);
  r = await evalSub(s, { decision: 'approved', grade: 'abc', summary: 'Bom' }); assert.equal(r.status, 422);
  r = await evalSub(s, { decision: 'approved', grade: '8,5', summary: '  ' }); assert.equal(r.status, 422);
  mailer.memory.length = 0;
  r = await evalSub(s, { decision: 'adjust', grade: '', summary: 'O segundo link não abre.' }); assert.equal(r.status, 303);
  const row = (await q('SELECT * FROM activity_submissions WHERE id=$1', [s])).rows[0];
  assert.equal(row.status, 'adjust'); assert.equal(row.grade, null);
  assert.equal((await q("SELECT read_at FROM notifications WHERE ref_key=$1 LIMIT 1", [`act:${s}`])).rows[0].read_at != null, true);
  const mail = await wait(() => mailer.memory.find((m) => m.to === 'ana@example.com' && m.template === 'atividade_resultado'));
  assert.ok(mail); assert.match(mail.text, /O segundo link não abre/); assert.match(mail.subject, /ajustes/i);
  assert.equal((await q("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND kind='activity'", [S.ana.id])).rows[0].n, 1);
  assert.equal((await evalSub(s, { decision: 'approved', grade: '9', summary: 'x' })).status, 303); // já avaliado: só avisa
  assert.equal((await q('SELECT status FROM activity_submissions WHERE id=$1', [s])).rows[0].status, 'adjust');
  // aluno vê o pedido e reenvia
  const pg = (await B.ana.get(`/curso/${courseRow.slug}/aula/${L.act}`)).text;
  assert.match(pg, /Ajustes necessários/); assert.match(pg, /O segundo link não abre/); assert.match(pg, /Reenviar para avaliação/);
  assert.equal((await ov('ana')).act.lessons[L.act].state, 'adjust');
  assert.equal((await sub('ana', { label: ['Vídeo'], url: ['https://youtu.be/correto123'] })).status, 303);
  const s2 = await lastSub('ana'); assert.equal(s2.attempt_no, 2);
  mailer.memory.length = 0;
  r = await evalSub(s2.id, { decision: 'approved', grade: '8,5', summary: 'Excelente trabalho.' }); assert.equal(r.status, 303);
  const ap = (await q('SELECT * FROM activity_submissions WHERE id=$1', [s2.id])).rows[0];
  assert.equal(ap.status, 'approved'); assert.equal(Number(ap.grade), 8.5);
  assert.equal((await q('SELECT count(*)::int AS n FROM lesson_progress WHERE user_id=$1 AND lesson_id=$2', [S.ana.id, L.act])).rows[0].n, 1);
  const o = await ov('ana');
  assert.equal(o.act.gate, null); assert.equal(o.cert.actOk, true); assert.equal(o.act.lessons[L.act].state, 'approved');
  assert.equal((await B.ana.get(`/curso/${courseRow.slug}/aula/${L.a3}`)).status, 200);
  assert.match((await B.ana.get(`/curso/${courseRow.slug}/aula/${L.act}`)).text, /Aprovada · nota 8,5/);
  const m2_ = await wait(() => mailer.memory.find((m) => m.to === 'ana@example.com'));
  assert.match(m2_.text, /8,5/); assert.match(m2_.subject, /aprovada/i);
  // aprovada: não aceita novo envio
  assert.equal((await sub('ana', ok2)).status, 409);
});

test('não aprovado bloqueia e só a reabertura libera novo envio; dispensa libera sem nota', async () => {
  const b = (await q("SELECT id FROM activity_submissions WHERE user_id=$1 AND status='pending'", [S.bia.id])).rows[0].id;
  assert.equal((await evalSub(b, { decision: 'rejected', grade: '4', summary: 'Não demonstra a prática.' })).status, 303);
  assert.equal((await ov('bia')).act.lessons[L.act].state, 'rejected');
  assert.equal((await sub('bia', ok2)).status, 409);
  assert.match((await B.bia.get(`/curso/${courseRow.slug}/aula/${L.act}`)).text, /Não aprovada/);
  assert.equal((await B.bia.get(`/curso/${courseRow.slug}/aula/${L.a4}`)).status, 303);
  assert.equal((await admin.post(`/admin/atividades/${b}/reabrir`, {}, `/admin/atividades/${b}`)).status, 303);
  assert.equal((await ov('bia')).act.lessons[L.act].state, 'adjust');
  assert.equal((await sub('bia', ok2)).status, 303);
  assert.equal((await lastSub('bia')).attempt_no, 2);
  // reabrir algo que não está reprovado é recusado
  const n0 = (await q('SELECT count(*)::int AS n FROM activity_submissions')).rows[0].n;
  await admin.post(`/admin/atividades/${b}/reabrir`, {}, `/admin/atividades/${b}`);
  assert.equal((await q('SELECT count(*)::int AS n FROM activity_submissions')).rows[0].n, n0);
  // dispensa
  const dp = (body) => admin.post(`/admin/cursos/${course}/atividades/dispensar`, body, `/admin/cursos/${course}/atividades`);
  assert.equal((await dp({ user_id: S.caio.id, lesson_id: L.act, reason: '' })).status, 303);
  assert.equal((await q("SELECT count(*)::int AS n FROM activity_submissions WHERE user_id=$1", [S.caio.id])).rows[0].n, 0);
  mailer.memory.length = 0;
  assert.equal((await dp({ user_id: S.caio.id, lesson_id: L.act, reason: 'Apresentou presencialmente' })).status, 303);
  assert.equal((await ov('caio')).act.lessons[L.act].state, 'waived');
  assert.equal((await ov('caio')).cert.actOk, true);
  assert.match((await B.caio.get(`/curso/${courseRow.slug}/aula/${L.act}`)).text, /Atividade dispensada pelo professor/);
  assert.equal((await B.caio.get(`/curso/${courseRow.slug}/aula/${L.a3}`)).status, 200);
  assert.ok(await wait(() => mailer.memory.find((m) => m.to === 'caio@example.com' && /dispensada/i.test(m.subject))));
  // não dispensa aluno com envio aguardando, nem quem não é do curso
  await sub('dani', ok2);
  await dp({ user_id: S.dani.id, lesson_id: L.act, reason: 'x' });
  assert.equal((await ov('dani')).act.lessons[L.act].state, 'pending');
});

test('prova final e certificado só com a atividade concluída', async () => {
  const fa = (await q("INSERT INTO assessments (course_id, kind, title, active, pass_score, max_attempts) VALUES ($1,'final','Prova final',true,7,3) RETURNING id", [course])).rows[0].id;
  const qq = (await q("INSERT INTO assessment_questions (assessment_id, body, position) VALUES ($1,'Pergunta?',1) RETURNING id", [fa])).rows[0].id;
  await q("INSERT INTO assessment_options (question_id, body, correct, position) VALUES ($1,'A',true,1),($1,'B',false,2)", [qq]);
  for (const l of [L.a1, L.a3, L.a4]) await q('INSERT INTO lesson_progress (user_id, lesson_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [S.dani.id, l]);
  let o = await ov('dani');
  assert.equal(o.final.unlocked, false); assert.match(o.final.why, /atividade complementar/i);
  assert.equal(o.cert.pctOk, false); // a atividade conta no percentual e ainda não foi aprovada
  assert.equal(o.cert.eligible, false);
  const d = await lastSub('dani');
  assert.equal((await evalSub(d.id, { decision: 'approved', grade: '10', summary: 'Perfeito' })).status, 303);
  o = await ov('dani');
  assert.equal(o.cert.pctOk, true); assert.equal(o.cert.actOk, true);
  assert.equal(o.final.unlocked, true);
});

test('aluno que já tem certificado não é bloqueado ao marcar a aula como atividade', async () => {
  await q("INSERT INTO users (email, password_hash, role, name, cpf) VALUES ('x@example.com','x','student','X','99999999999')");
  const u = (await q("SELECT id FROM users WHERE email='x@example.com'")).rows[0].id;
  await q("INSERT INTO enrollments (user_id, course_id, origin, status) VALUES ($1,$2,'manual','active')", [u, course]);
  await q("INSERT INTO certificates (user_id, course_id, code, course_title, student_name, body_text, status) VALUES ($1,$2,'COD-TESTE-1','Curso Atividade','X','t','valid')", [u, course]);
  const o = await A.overview(u, courseRow);
  assert.equal(o.act.blocked.size, 0); assert.equal(o.act.gate, null);
});

test('integrações: duplicar copia a opção; acompanhamento mostra o estado; exportação e anonimização', async () => {
  const D = require('../src/duplicate');
  const nc = (await q("INSERT INTO courses (title, slug, summary, description, price_cents, level, access_type, status) SELECT 'Cópia', 'copia-atividade', summary, description, price_cents, level, access_type, 'draft' FROM courses WHERE id=$1 RETURNING id", [course])).rows[0].id;
  await t.pool.connect().then(async (c) => { try { await D.copyInto(c, course, nc, 1, { withFiles: false }); } finally { c.release(); } });
  assert.equal((await q("SELECT count(*)::int AS n FROM lessons WHERE course_id=$1 AND is_activity", [nc])).rows[0].n, 1);
  const T = require('../src/tracking');
  const enr = (await q('SELECT * FROM enrollments WHERE user_id=$1 AND course_id=$2', [S.ana.id, course])).rows[0];
  const det = await T.detail(enr, courseRow);
  const lessons = det.modules.flatMap((m) => m.lessons);
  assert.equal(lessons.find((l) => l.id === L.act).activity.state, 'approved');
  const lg = require('../src/lgpd');
  const ex = await lg.exportFor(S.ana.id);
  assert.equal(ex.atividades_complementares.length, 2);
  await lg.anonymize(S.ana.id);
  assert.equal((await q('SELECT count(*)::int AS n FROM activity_submissions WHERE user_id=$1', [S.ana.id])).rows[0].n, 0);
});

test('paginação de 25 em 25 e checagem de quiz ao reativar aula e módulo', async () => {
  const mm = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'Extra',9) RETURNING id", [course])).rows[0].id;
  for (let i = 0; i < 30; i++) await q("INSERT INTO activity_submissions (user_id, lesson_id, course_id, status, attempt_no, links, grade, summary, evaluated_at) VALUES ($1,$2,$3,'adjust',$4,'[]'::jsonb,NULL,'x',now())", [S.dani.id, L.act, course, 100 + i]);
  const p1 = (await admin.get('/admin/atividades')).text;
  assert.equal((p1.match(/href=\"\/admin\/atividades\/\d+\"/g) || []).length, 25);
  assert.match(p1, /Carregar mais 25/); assert.match(p1, /mostrar=50/);
  const p2 = (await admin.get('/admin/atividades?mostrar=50')).text;
  assert.ok((p2.match(/href=\"\/admin\/atividades\/\d+\"/g) || []).length > 25);
  // reativar aula-atividade com quiz ativo no módulo é recusado
  const la = (await q("INSERT INTO lessons (course_id, module_id, title, position, is_activity, active) VALUES ($1,$2,'Ativ extra',1,true,false) RETURNING id", [course, mm])).rows[0].id;
  await q("INSERT INTO assessments (course_id, module_id, kind, title, active) VALUES ($1,$2,'quiz','Q',true)", [course, mm]);
  await admin.post(`/admin/aulas/${la}/reativar`, {}, `/admin/cursos/${course}/conteudo`);
  assert.equal((await q('SELECT active FROM lessons WHERE id=$1', [la])).rows[0].active, false);
  // reativar módulo com atividade ativa e quiz ativo é recusado
  await q('UPDATE lessons SET active = true WHERE id=$1', [la]); await q('UPDATE modules SET active = false WHERE id=$1', [mm]);
  await admin.post(`/admin/modulos/${mm}/reativar`, {}, `/admin/cursos/${course}/conteudo`);
  assert.equal((await q('SELECT active FROM modules WHERE id=$1', [mm])).rows[0].active, false);
});
