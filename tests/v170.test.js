'use strict';
// 1.7.0 · Acompanhamento de alunos: leitura pura dentro de Matrículas, com situação, filtros e detalhe por aluno.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const T = require('../src/tracking');

let t; let admin; let course; let m1; let m2; let L = []; let bonus; let S = {}; let E = {};
const q = (sql, p) => t.pool.query(sql, p);
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';
const ago = (days) => new Date(Date.now() - days * 86400000);
const done = (uid, lesson, days) => q('INSERT INTO lesson_progress (user_id, lesson_id, completed_at) VALUES ($1,$2,$3)', [uid, lesson, ago(days)]);
const enroll = async (key, over = {}) => {
  S[key] = await makeStudent(t, { email: `${key}@example.com`, name: `Aluno ${key}` });
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING", [S[key].id]);
  E[key] = (await q("INSERT INTO enrollments (user_id, course_id, origin, status, expires_at, cancelled_at) VALUES ($1,$2,'manual',$3::text,$4, CASE WHEN $3::text = 'cancelled' THEN now() END) RETURNING id", [S[key].id, course, over.status || 'active', over.expires || null])).rows[0].id;
};
const page = async (qs = '') => (await admin.get(`/admin/cursos/${course}/matriculas${qs}`)).text;

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await q("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy','affiliate')", [LONG]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING");
  await admin.post('/admin/cursos', { title: 'Curso Acompanhado', slug: 'curso-acompanhado', summary: 'Resumo.', description: 'Desc', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice_days: '30', publish: '1' }, '/admin/cursos/novo');
  course = (await q("SELECT id FROM courses WHERE slug='curso-acompanhado'")).rows[0].id;
  m1 = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'Base',1) RETURNING id", [course])).rows[0].id;
  m2 = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'Prática',2) RETURNING id", [course])).rows[0].id;
  const mk = async (m, title, pos, extra = '') => (await q(`INSERT INTO lessons (course_id, module_id, title, position, youtube_id, duration_min ${extra ? ', is_bonus' : ''}) VALUES ($1,$2,$3,$4,'dQw4w9WgX' || lpad($4::int::text, 2, '0'), 10 ${extra ? ', true' : ''}) RETURNING id`, [course, m, title, pos])).rows[0].id;
  L = [await mk(m1, 'Aula 1', 1), await mk(m1, 'Aula 2', 2), await mk(m2, 'Aula 3', 3), await mk(m2, 'Aula 4', 4)];
  bonus = await mk(m2, 'Aula Bônus', 5, true);
  await enroll('novo');
  await enroll('andando'); await done(S.andando.id, L[0], 1);
  await enroll('parado'); await done(S.parado.id, L[0], 12); await done(S.parado.id, L[1], 10);
  await enroll('completo'); for (const l of L) await done(S.completo.id, l, 2);
  await enroll('bonus'); await done(S.bonus.id, bonus, 1);
  await enroll('cancelado', { status: 'cancelled' }); await done(S.cancelado.id, L[0], 3);
  await enroll('vencido', { expires: ago(2) });
  await q('INSERT INTO lesson_watch (user_id, lesson_id, watched_seconds, duration_seconds) VALUES ($1,$2,300,600)', [S.andando.id, L[1]]);
});
after(async () => { await t.close(); });

test('situação: ordem das regras e limite de "parado"', () => {
  const base = { status: 'active', expired: false, cert: false, total: 4, done: 1, exam_pending: false, live_progress: 1, last_days: 3 };
  assert.equal(T.situation(base, 7), 'go');
  assert.equal(T.situation({ ...base, last_days: 8 }, 7), 'stop');
  assert.equal(T.situation({ ...base, last_days: 7 }, 7), 'go'); // "mais de" 7 dias
  assert.equal(T.situation({ ...base, last_days: 8 }, 14), 'go');
  assert.equal(T.situation({ ...base, done: 0, live_progress: 0, last_days: null }, 7), 'new');
  assert.equal(T.situation({ ...base, done: 4, exam_pending: true }, 7), 'exam');
  assert.equal(T.situation({ ...base, done: 4 }, 7), 'ok');
  assert.equal(T.situation({ ...base, done: 4, cert: true }, 7), 'cert');
  assert.equal(T.situation({ ...base, status: 'cancelled', cert: true }, 7), 'cancelled');
  assert.equal(T.situation({ ...base, expired: true }, 7), 'expired');
  assert.equal(T.parseDays('14'), 14); assert.equal(T.parseDays('5'), 7); assert.equal(T.parseDays(undefined), 7);
  assert.equal(T.parseFilter('parados'), 'parados'); assert.equal(T.parseFilter('x'), 'todos');
});

test('lista: situação de cada aluno, bônus fora do percentual', async () => {
  const rows = await T.list(course, { days: 7 });
  const by = (k) => rows.find((r) => r.email === `${k}@example.com`);
  assert.equal(rows.length, 7);
  assert.equal(by('novo').state, 'new'); assert.equal(by('andando').state, 'go'); assert.equal(by('parado').state, 'stop');
  assert.equal(by('completo').state, 'ok'); assert.equal(by('cancelado').state, 'cancelled'); assert.equal(by('vencido').state, 'expired');
  assert.equal(by('andando').pct, 25); assert.equal(by('completo').pct, 100); assert.equal(by('completo').total, 4);
  assert.equal(by('bonus').done, 0); assert.equal(by('bonus').pct, 0); assert.equal(by('bonus').state, 'go'); // só bônus: começou, mas não avança o percentual
  assert.equal(by('parado').last_title, 'Aula 2'); assert.equal(by('parado').last_days, 10);
  assert.equal((await T.list(course, { days: 14 })).find((r) => r.email === 'parado@example.com').state, 'go');
});

test('indicadores contam só matrículas vigentes e o filtro/busca funcionam', async () => {
  const rows = await T.list(course, { days: 7 }); const k = T.kpis(rows);
  assert.equal(k.enrolled, 5); assert.equal(k.stopped, 1); assert.equal(k.finished, 1); assert.equal(k.fresh, 1); assert.equal(k.going, 2);
  assert.equal(k.avg, 35); // (0 + 25 + 50 + 100 + 0) / 5: só as vigentes (novo, andando, parado, completo, bônus)
  assert.equal(T.filter(rows, { f: 'parados' }).length, 1);
  assert.equal(T.filter(rows, { f: 'todos' }).length, 7);
  assert.equal(T.filter(rows, { q: 'ALUNO PAR' }).length, 1);
  assert.equal(T.filter(rows, { q: 'completo@example' })[0].name, 'Aluno completo');
  assert.equal(T.filter(rows, { f: 'concluidos' }).length, 1);
});

test('aba Matrículas: indicadores, chips, cancelada/expirada e botão "Ver progresso"', async () => {
  const h = await page();
  assert.match(h, /Matriculados/); assert.match(h, /Parados há mais de 7 dias/); assert.match(h, /Progresso médio/);
  assert.match(h, /1 de 4 aulas · 25%/); assert.match(h, /Parado há 10 dias/); assert.match(h, /Ainda não começou/);
  assert.match(h, /Cancelada/); assert.match(h, /Expirada/); assert.match(h, /Ver progresso/);
  assert.match(h, /Liberar acesso/); assert.match(h, /\/matriculas\/\d+\/cancelar|\/matriculas\/\d+\/reativar/); // ações antigas preservadas
  const p = await page('?f=parados&dias=7'); assert.match(p, /Aluno parado/); assert.doesNotMatch(p, /Aluno completo/);
  const d = await page('?dias=14&f=parados'); assert.doesNotMatch(d, /Aluno parado/); assert.match(d, /Nenhum aluno com esse filtro/);
  const s = await page('?q=%3Cscript%3E'); assert.doesNotMatch(s, /<script>/); assert.match(s, /Nenhum aluno/);
});

test('detalhe: módulos, aulas, tempo assistido, bônus e certificado', async () => {
  const r = await admin.get(`/admin/matriculas/${E.andando}/progresso`); assert.equal(r.status, 200);
  assert.match(r.text, /Aluno andando/); assert.match(r.text, /Módulo 1 · Base/); assert.match(r.text, /Módulo 2 · Prática/);
  assert.match(r.text, /Concluída em/); assert.match(r.text, /50% assistido/); assert.match(r.text, /Não iniciada/);
  assert.match(r.text, /Bônus · não conta/); assert.match(r.text, /Este curso não tem prova final/); assert.match(r.text, /1 de 4 aulas|1 de 4/);
  assert.match(r.text, /5 min de 40 min/);
  await q("INSERT INTO certificates (code, user_id, course_id, student_name, course_title, body_text, final_score) VALUES ('ABC123',$1,$2,'Aluno completo','Curso','texto',8.5)", [S.completo.id, course]);
  const c = await admin.get(`/admin/matriculas/${E.completo}/progresso`);
  assert.match(c.text, /Certificado emitido/); assert.match(c.text, /Nota final 8,5/);
  const x = await admin.get(`/admin/matriculas/${E.cancelado}/progresso`); assert.match(x.text, /Cancelada/);
  assert.equal((await admin.get('/admin/matriculas/999999/progresso')).status, 404);
  assert.equal((await admin.get('/admin/matriculas/abc/progresso')).status, 404);
});

test('prova final: pendente, liberada e aprovada aparecem no detalhe e na lista', async () => {
  const a = (await q("INSERT INTO assessments (course_id, kind, pass_score, max_attempts, active) VALUES ($1,'final',7,3,true) RETURNING id", [course])).rows[0].id;
  const qs = (await q("INSERT INTO assessment_questions (assessment_id, position, body) VALUES ($1,1,'Pergunta?') RETURNING id", [a])).rows[0].id;
  await q("INSERT INTO assessment_options (question_id, position, body, correct) VALUES ($1,1,'Sim',true), ($1,2,'Não',false)", [qs]);
  const rows = await T.list(course, { days: 7 });
  assert.equal(rows.find((r) => r.email === 'completo@example.com').state, 'cert');
  await enroll('semcert'); for (const l of L) await done(S.semcert.id, l, 1);
  await q('INSERT INTO lesson_watch (user_id, lesson_id, watched_seconds, duration_seconds) VALUES ($1,$2,400,600)', [S.semcert.id, L[3]]);
  assert.equal((await T.list(course, { days: 7 })).find((r) => r.email === 'semcert@example.com').state, 'exam');
  let d = (await admin.get(`/admin/matriculas/${E.semcert}/progresso`)).text; assert.match(d, /Liberada/); assert.match(d, /Prova final/);
  d = (await admin.get(`/admin/matriculas/${E.novo}/progresso`)).text; assert.match(d, /Bloqueada/);
  await q("INSERT INTO assessment_attempts (assessment_id, user_id, number, finished_at, snapshot, correct_count, total, score, passed) VALUES ($1,$2,1,now(),'{}'::jsonb,1,1,10,true)", [a, S.semcert.id]);
  assert.equal((await T.list(course, { days: 7 })).find((r) => r.email === 'semcert@example.com').state, 'ok');
  d = (await admin.get(`/admin/matriculas/${E.semcert}/progresso`)).text; assert.match(d, /Aprovado/);
});

test('somente leitura e só administrador', async () => {
  const before = (await q('SELECT (SELECT count(*) FROM enrollments) e, (SELECT count(*) FROM lesson_progress) p, (SELECT count(*) FROM audit_log) a')).rows[0];
  await admin.get(`/admin/cursos/${course}/matriculas?f=parados`); await admin.get(`/admin/matriculas/${E.parado}/progresso`);
  const after_ = (await q('SELECT (SELECT count(*) FROM enrollments) e, (SELECT count(*) FROM lesson_progress) p, (SELECT count(*) FROM audit_log) a')).rows[0];
  assert.deepEqual(after_, before);
  const st = new Browser(t.base); await st.login(S.andando.email, S.andando.password);
  const r = await st.get(`/admin/matriculas/${E.andando}/progresso`); assert.ok([302, 303, 403, 404].includes(r.status)); assert.doesNotMatch(r.text || '', /Módulo 1/);
  const anon = new Browser(t.base); const a = await anon.get(`/admin/matriculas/${E.andando}/progresso`); assert.ok([302, 303, 401, 403].includes(a.status));
});

test('liberar acesso e o aviso continuam funcionando na aba', async () => {
  const r = await admin.post(`/admin/cursos/${course}/matriculas`, { email: 'novinho@example.com', name: 'Novinho Teste' }, `/admin/cursos/${course}/matriculas`);
  assert.ok([200, 303].includes(r.status));
  const h = await page(); assert.match(h, /novinho@example\.com/); assert.match(h, /Avisar alunos sobre uma novidade/);
});

test('revisão: matrícula agendada, busca sem acento, dias no detalhe, sem duração e download', async () => {
  await enroll('futuro'); await q("UPDATE enrollments SET starts_at = now() + interval '5 days' WHERE id = $1", [E.futuro]);
  const rows = await T.list(course, { days: 7 });
  assert.equal(rows.find((r) => r.email === 'futuro@example.com').state, 'scheduled');
  assert.equal(T.kpis(rows).enrolled, T.kpis(rows.filter((r) => r.state !== 'scheduled')).enrolled); // agendada não entra nos indicadores
  assert.match(await page(), /Começa em/);
  await q("UPDATE users SET name = 'José Ávila' WHERE id = $1", [S.novo.id]);
  assert.equal(T.filter(await T.list(course, { days: 7 }), { q: 'jose avila' }).length, 1);
  // detalhe respeita ?dias=
  assert.match((await admin.get(`/admin/matriculas/${E.parado}/progresso`)).text, /Parado há 10 dias/);
  const d30 = (await admin.get(`/admin/matriculas/${E.parado}/progresso?dias=30`)).text; assert.doesNotMatch(d30, /Parado há/); assert.match(d30, /Em andamento/);
  assert.match(await page('?dias=30'), /progresso\?dias=30/);
  // tempo assistido nunca passa do total
  await q("UPDATE lessons SET duration_min = NULL WHERE id = $1", [L[2]]);
  await q('INSERT INTO lesson_watch (user_id, lesson_id, watched_seconds, duration_seconds) VALUES ($1,$2,9000,0)', [S.parado.id, L[2]]);
  const det = await T.detail({ user_id: S.parado.id }, { id: course });
  assert.ok(det.watchedSec <= det.totalSec, `${det.watchedSec} <= ${det.totalSec}`);
  // produto de download: sem acompanhamento
  await admin.post('/admin/cursos', { title: 'Produto Baixavel', slug: 'produto-baixavel', summary: 'R', description: 'D', price: '10,00', product_type: 'download', sort_order: '2' }, '/admin/cursos/novo');
  const dl = (await q("SELECT id FROM courses WHERE slug='produto-baixavel'")).rows[0];
  assert.ok(dl, 'produto criado');
  {
    await q("UPDATE courses SET product_type='download' WHERE id=$1", [dl.id]);
    const eid = (await q("INSERT INTO enrollments (user_id, course_id, origin) VALUES ($1,$2,'manual') RETURNING id", [S.novo.id, dl.id])).rows[0].id;
    const h = (await admin.get(`/admin/cursos/${dl.id}/matriculas`)).text; assert.doesNotMatch(h, /Ver progresso/); assert.match(h, /Comprador/);
    assert.equal((await admin.get(`/admin/matriculas/${eid}/progresso`)).status, 404);
  }
});
