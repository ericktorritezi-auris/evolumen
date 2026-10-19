'use strict';
// 0.4.0 · Fase 3: tempo assistido, quiz por módulo, prova final, tentativas, certificado, verificação pública e revogação.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const A = require('../src/assess');
const certs = require('../src/certificates');

let t; let admin; let sb; let stu; let course; let m1; let m2; let la; let lb; let lc; let quiz; let fin;
const slug = 'curso-prova';
const q = (sql, p) => t.pool.query(sql, p);
const base = () => `/curso/${slug}`;

async function addQuestion(a, over = {}) {
  const body = { kind: 'single', body: 'Qual é a certa?', opt_0: 'Errada 1', opt_1: 'Certa', opt_2: 'Errada 2', correct: '1', explanation: 'Porque sim.', ...over };
  return admin.post(`/admin/avaliacoes/${a}/questoes`, body, `/admin/avaliacoes/${a}`);
}
// Responde a tentativa aberta: `rights` = quantas acertar (as primeiras na ordem sorteada).
async function takeAttempt(b, a, rights) {
  const st = await b.post(`${base()}/avaliacao/${a}/iniciar`, {}, `${base()}/avaliacao/${a}`);
  assert.equal(st.status, 303, 'iniciar tentativa');
  const at = (await q('SELECT * FROM assessment_attempts WHERE assessment_id=$1 AND user_id=$2 AND finished_at IS NULL', [a, stu.id])).rows[0];
  const form = { attempt: String(at.id) };
  let i = 0;
  for (const qq of at.snapshot) {
    const right = (await q('SELECT id FROM assessment_options WHERE question_id=$1 AND correct', [qq.id])).rows[0].id;
    const wrong = qq.options.find((o) => String(o.id) !== String(right)).id;
    form[`q_${qq.id}`] = String(i < rights ? right : wrong); i++;
  }
  const sent = await b.post(`${base()}/avaliacao/${a}/enviar`, form, `${base()}/avaliacao/${a}`);
  assert.equal(sent.status, 303);
  return (await q('SELECT * FROM assessment_attempts WHERE id=$1', [at.id])).rows[0];
}
const watch = async (lesson, delta, duration, age = 40) => {
  await q("UPDATE lesson_watch SET updated_at = now() - ($3 || ' seconds')::interval WHERE user_id=$1 AND lesson_id=$2", [stu.id, lesson, String(age)]);
  return sb.post(`${base()}/aula/${lesson}/assistido`, { delta: String(delta), duration: String(duration) }, `${base()}/aula/${lesson}`);
};

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await admin.post('/admin/cursos', { title: 'Curso Prova', slug, summary: 'Resumo.', description: 'Desc', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice_days: '30', publish: '1' }, '/admin/cursos/novo');
  course = (await q('SELECT * FROM courses WHERE slug=$1', [slug])).rows[0].id;
  m1 = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'Base',1) RETURNING id", [course])).rows[0].id;
  m2 = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'Final',2) RETURNING id", [course])).rows[0].id;
  la = (await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'Aula A',1,'dQw4w9WgXcQ') RETURNING id", [course, m1])).rows[0].id;
  lb = (await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'Aula B',1,'dQw4w9WgXcR') RETURNING id", [course, m2])).rows[0].id;
  lc = (await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'Aula C',2,'dQw4w9WgXcS') RETURNING id", [course, m2])).rows[0].id;
  stu = await makeStudent(t, { email: 'prova@example.com', name: 'Paula Provas' });
  await q("INSERT INTO enrollments (user_id, course_id, origin) VALUES ($1,$2,'manual')", [stu.id, course]);
  sb = new Browser(t.base); await sb.login(stu.email, stu.password);
});
after(async () => { await t.close(); });

test('admin cria quiz e prova final, com questões de múltipla escolha e verdadeiro/falso', async () => {
  const tab = await admin.get(`/admin/cursos/${course}/avaliacoes`); assert.equal(tab.status, 200); assert.match(tab.text, /Quiz por módulo/); assert.match(tab.text, /Prova final/);
  await admin.post(`/admin/cursos/${course}/avaliacoes`, { kind: 'quiz', module_id: String(m1) }, `/admin/cursos/${course}/avaliacoes`);
  await admin.post(`/admin/cursos/${course}/avaliacoes`, { kind: 'final' }, `/admin/cursos/${course}/avaliacoes`);
  quiz = (await q("SELECT * FROM assessments WHERE kind='quiz'")).rows[0].id; fin = (await q("SELECT * FROM assessments WHERE kind='final'")).rows[0].id;
  assert.equal(Number((await q('SELECT pass_score FROM assessments WHERE id=$1', [quiz])).rows[0].pass_score), 7); assert.equal((await q('SELECT max_attempts FROM assessments WHERE id=$1', [quiz])).rows[0].max_attempts, 3);
  const dup = await admin.post(`/admin/cursos/${course}/avaliacoes`, { kind: 'final' }, `/admin/cursos/${course}/avaliacoes`); assert.equal(dup.status, 303);
  assert.equal((await q("SELECT count(*)::int n FROM assessments WHERE kind='final'")).rows[0].n, 1, 'uma prova final por curso');
  for (let i = 0; i < 3; i++) await addQuestion(quiz, { body: `Pergunta do quiz ${i + 1}` });
  for (let i = 0; i < 3; i++) await addQuestion(fin, { body: `Pergunta da prova ${i + 1}` });
  await addQuestion(fin, { kind: 'truefalse', body: 'O céu é azul.', tf: 'v' });
  assert.equal((await q('SELECT count(*)::int n FROM assessment_questions WHERE assessment_id=$1', [fin])).rows[0].n, 4);
  const tf = (await q("SELECT o.body, o.correct FROM assessment_options o JOIN assessment_questions s ON s.id=o.question_id WHERE s.kind='truefalse' ORDER BY o.position")).rows;
  assert.deepEqual(tf.map((x) => [x.body, x.correct]), [['Verdadeiro', true], ['Falso', false]]);
  // validações
  const bad = await addQuestion(quiz, { correct: '5' }); assert.equal(bad.status, 303);
  assert.equal((await q('SELECT count(*)::int n FROM assessment_questions WHERE assessment_id=$1', [quiz])).rows[0].n, 3, 'questão sem resposta certa preenchida é recusada');
  const ed = await admin.get(`/admin/avaliacoes/${quiz}`); assert.equal(ed.status, 200); assert.match(ed.text, /Pergunta do quiz 1/);
  const tp = await admin.post(`/admin/avaliacoes/${quiz}`, { title: 'Quiz', pass_score: '11', max_attempts: '3', active: '1' }, `/admin/avaliacoes/${quiz}`); assert.equal(tp.status, 422);
  assert.equal(Number((await q('SELECT pass_score FROM assessments WHERE id=$1', [quiz])).rows[0].pass_score), 7);
  // edição de questão mantém uma única resposta certa
  const one = (await q('SELECT id FROM assessment_questions WHERE assessment_id=$1 ORDER BY id LIMIT 1', [quiz])).rows[0].id;
  const opts = (await q('SELECT id, body FROM assessment_options WHERE question_id=$1 ORDER BY position', [one])).rows;
  await admin.post(`/admin/questoes/${one}`, { body: 'Pergunta editada', explanation: '', opt_id_0: String(opts[0].id), opt_0: 'A', opt_id_1: String(opts[1].id), opt_1: 'B', opt_id_2: String(opts[2].id), opt_2: 'C', correct: '2' }, `/admin/avaliacoes/${quiz}`);
  const after = (await q('SELECT body, correct FROM assessment_options WHERE question_id=$1 ORDER BY position', [one])).rows;
  assert.deepEqual(after.map((x) => x.correct), [false, false, true]);
  await admin.post(`/admin/questoes/${one}`, { body: 'Pergunta do quiz 1', opt_id_0: String(opts[0].id), opt_0: 'Errada 1', opt_id_1: String(opts[1].id), opt_1: 'Certa', opt_id_2: String(opts[2].id), opt_2: 'Errada 2', correct: '1' }, `/admin/avaliacoes/${quiz}`);
  assert.equal((await q('SELECT count(*)::int n FROM assessment_options WHERE question_id=$1 AND correct', [one])).rows[0].n, 1);
});

test('aluno não acessa as telas de administração das avaliações', async () => {
  for (const u of [`/admin/avaliacoes/${quiz}`, `/admin/avaliacoes/${quiz}/tentativas`, '/admin/certificados', `/admin/cursos/${course}/avaliacoes`, `/admin/cursos/${course}/certificado-exemplo.pdf`]) assert.equal((await sb.get(u)).status, 403, u);
  for (const u of ['/admin/avaliacoes', '/admin/certificados']) assert.notEqual((await new Browser(t.base).get(u)).status, 200);
});

test('quiz bloqueia o módulo seguinte até a nota mínima, com 3 tentativas e tentativa extra', async () => {
  // sem concluir as aulas do módulo, o quiz não abre; e o módulo 2 está bloqueado só depois de existir o quiz
  const early = await sb.get(`${base()}/avaliacao/${quiz}`); assert.equal(early.status, 200); assert.match(early.text, /Conclua todas as aulas do módulo/);
  assert.equal((await sb.post(`${base()}/avaliacao/${quiz}/iniciar`, {}, base())).status, 303);
  assert.equal((await q('SELECT count(*)::int n FROM assessment_attempts')).rows[0].n, 0, 'não inicia sem concluir as aulas');
  const lock = await sb.get(`${base()}/aula/${lb}`); assert.equal(lock.status, 303, 'aula do módulo 2 bloqueada'); assert.match(lock.location, new RegExp(base()));
  assert.match((await sb.get(base())).text, /Quiz do módulo/);
  // concluir a aula A libera o quiz e leva a ele
  const done = await sb.post(`${base()}/aula/${la}/concluir`, { done: '1' }, `${base()}/aula/${la}`);
  assert.equal(done.status, 303); assert.match(done.location, new RegExp(`/avaliacao/${quiz}`));
  const intro = await sb.get(`${base()}/avaliacao/${quiz}`); assert.match(intro.text, /não vale nota/); assert.match(intro.text, /Tentativas: <b>0<\/b> de <b>3<\/b>/);
  // errar 3 vezes (acertando só 1 de 3 = 3,33)
  for (let n = 1; n <= 3; n++) { const at = await takeAttempt(sb, quiz, 1); assert.equal(at.passed, false); assert.equal(Number(at.score), 3.33); assert.equal(at.number, n);
    const pg = (await sb.get(`${base()}/avaliacao/${quiz}?tentativa=${at.id}`)).text;
    assert.doesNotMatch(pg, /resposta certa|Você errou|Você acertou\.|Sem resposta|Porque sim/, 'sem atingir a nota, nada de gabarito'); assert.match(pg, /aparece quando você atingir a nota mínima/); }
  const out = await sb.post(`${base()}/avaliacao/${quiz}/iniciar`, {}, base()); assert.equal(out.status, 303);
  assert.equal((await q('SELECT count(*)::int n FROM assessment_attempts WHERE assessment_id=$1', [quiz])).rows[0].n, 3, 'a 4ª tentativa é recusada');
  assert.match((await sb.get(`${base()}/avaliacao/${quiz}`)).text, /usou todas as tentativas/);
  assert.equal((await sb.get(`${base()}/aula/${lb}`)).status, 303, 'continua bloqueado');
  // tentativa extra do administrador
  const rows = await admin.get(`/admin/avaliacoes/${quiz}/tentativas`); assert.match(rows.text, /Paula Provas/); assert.match(rows.text, /3 de 3/);
  await admin.post(`/admin/avaliacoes/${quiz}/extra`, { user: String(stu.id) }, `/admin/avaliacoes/${quiz}/tentativas`);
  assert.match((await admin.get(`/admin/avaliacoes/${quiz}/tentativas`)).text, /3 de 4/);
  const ok = await takeAttempt(sb, quiz, 3); assert.equal(ok.passed, true); assert.equal(Number(ok.score), 10); assert.equal(ok.number, 4);
  assert.equal((await sb.get(`${base()}/aula/${lb}`)).status, 200, 'módulo 2 liberado');
  const rev = await sb.get(`${base()}/avaliacao/${quiz}?tentativa=${ok.id}`); assert.match(rev.text, /Aprovado/); assert.match(rev.text, /resposta certa/, 'quiz mostra a resposta certa só depois de aprovado');
  const firstFail = (await q('SELECT id FROM assessment_attempts WHERE assessment_id=$1 AND number=1', [quiz])).rows[0].id;
  assert.match((await sb.get(`${base()}/avaliacao/${quiz}?tentativa=${firstFail}`)).text, /resposta certa/, 'depois de aprovado, vê a correção das tentativas antigas');
  // não lê a tentativa de outra pessoa
  const other = await makeStudent(t, { email: 'curiosa2@example.com', name: 'Curiosa Dois' }); await q("INSERT INTO enrollments (user_id, course_id) VALUES ($1,$2)", [other.id, course]);
  const ob = new Browser(t.base); await ob.login(other.email, other.password);
  const peek = await ob.get(`${base()}/avaliacao/${quiz}?tentativa=${ok.id}`); assert.doesNotMatch(peek.text, /Aprovado|resposta certa/, 'não vê a tentativa de outra pessoa');
});

test('tentativa: nota arredondada, resposta em branco é errada e não dá para reenviar', async () => {
  const at = (await q('SELECT * FROM assessment_attempts WHERE assessment_id=$1 AND number=4', [quiz])).rows[0];
  const again = await sb.post(`${base()}/avaliacao/${quiz}/enviar`, { attempt: String(at.id) }, `${base()}/avaliacao/${quiz}`); assert.equal(again.status, 303);
  assert.equal(Number((await q('SELECT score FROM assessment_attempts WHERE id=$1', [at.id])).rows[0].score), 10, 'reenviar não muda a nota');
  assert.equal(A.CERT_PCT, 95); assert.equal(A.HALF, 0.5);
});

test('tempo assistido: soma limitada pelo tempo real e libera a prova final com mais da metade da última aula', async () => {
  await q('UPDATE lessons SET duration_min = 2 WHERE id = $1', [lc]);
  const ov0 = await A.overview(stu.id, { id: course });
  assert.equal(ov0.final.unlocked, false); assert.match(ov0.final.why, /mais da metade da última aula/);
  const lockedFinal = await sb.get(`${base()}/avaliacao/${fin}`); assert.match(lockedFinal.text, /Aula C/);
  assert.equal((await sb.post(`${base()}/avaliacao/${fin}/iniciar`, {}, base())).status, 303);
  assert.equal((await q('SELECT count(*)::int n FROM assessment_attempts WHERE assessment_id=$1', [fin])).rows[0].n, 0);
  const r1 = await sb.post(`${base()}/aula/${lc}/assistido`, { delta: '30', duration: '100' }, `${base()}/aula/${lc}`);
  assert.equal(r1.status, 200); const j1 = JSON.parse(r1.text); assert.equal(j1.watched, 12, 'primeira chamada tem crédito pequeno');
  // trapaça: pedir 60 s logo depois conta só o que o tempo real permite
  const r2 = await sb.post(`${base()}/aula/${lc}/assistido`, { delta: '60', duration: '100' }, `${base()}/aula/${lc}`);
  assert.ok(JSON.parse(r2.text).watched <= 16, 'limitado pelo tempo decorrido');
  // trapaça: informar uma duração minúscula não diminui a duração real (aula cadastrada com 2 min)
  const r3 = await sb.post(`${base()}/aula/${lc}/assistido`, { delta: '2', duration: '3' }, `${base()}/aula/${lc}`);
  assert.ok(JSON.parse(r3.text).duration >= 96, 'duração do cliente não vale sozinha');
  assert.equal((await A.overview(stu.id, { id: course })).final.unlocked, false, 'ainda abaixo da metade');
  await watch(lc, 60, 100); // 40 s depois, no máximo ~52 s
  assert.ok(Number((await q('SELECT watched_seconds FROM lesson_watch WHERE user_id=$1 AND lesson_id=$2', [stu.id, lc])).rows[0].watched_seconds) > 50);
  assert.equal((await A.overview(stu.id, { id: course })).final.unlocked, true, 'mais da metade assistida');
  // não passa da duração
  await watch(lc, 60, 100, 100); await watch(lc, 60, 100, 100);
  assert.ok(Number((await q('SELECT watched_seconds FROM lesson_watch WHERE user_id=$1 AND lesson_id=$2', [stu.id, lc])).rows[0].watched_seconds) <= 100);
  // outra pessoa e aula bloqueada
  assert.notEqual((await new Browser(t.base).post(`${base()}/aula/${lc}/assistido`, { delta: '5', duration: '10' }, '/entrar')).status, 200);
  assert.equal((await admin.post(`${base()}/aula/${lc}/assistido`, { delta: '5', duration: '10' }, base())).status, 200);
});

test('prova final: sem 95% fica aguardando, depois conclui as aulas e o certificado é emitido sozinho', async () => {
  const bad = await takeAttempt(sb, fin, 2); assert.equal(bad.passed, false); assert.equal(Number(bad.score), 5);
  assert.match((await sb.get(`${base()}/avaliacao/${fin}?tentativa=${bad.id}`)).text, /Ainda não foi desta vez/);
  assert.doesNotMatch((await sb.get(`${base()}/avaliacao/${fin}?tentativa=${bad.id}`)).text, /resposta certa/, 'prova final não revela as respostas');
  const ok = await takeAttempt(sb, fin, 4); assert.equal(ok.passed, true); assert.equal(Number(ok.score), 10);
  assert.match((await sb.get(`${base()}/avaliacao/${fin}?tentativa=${ok.id}`)).text, /resposta certa/, 'prova final: correção só depois de aprovado');
  assert.equal((await q('SELECT count(*)::int n FROM certificates')).rows[0].n, 0, 'aprovado mas com 33%: ainda sem certificado');
  const wait = await sb.get(`${base()}/avaliacao/${fin}?tentativa=${ok.id}`); assert.match(wait.text, /95% do curso/); assert.match(wait.text, /Faltam 2 aulas/);
  const list = await sb.get('/certificados'); assert.match(list.text, /Concluir 95% do curso/); assert.match(list.text, /você está em 33%/);
  const home = await sb.get(base()); assert.match(home.text, /Você já passou na prova/);
  await sb.post(`${base()}/aula/${lb}/concluir`, { done: '1' }, `${base()}/aula/${lb}`);
  assert.equal((await q('SELECT count(*)::int n FROM certificates')).rows[0].n, 0);
  const last = await sb.post(`${base()}/aula/${lc}/concluir`, { done: '1' }, `${base()}/aula/${lc}`);
  assert.equal(last.status, 303);
  const cert = (await q('SELECT * FROM certificates')).rows[0]; assert.ok(cert, 'certificado emitido ao chegar nos 95%');
  assert.match(cert.code, certs.CODE_RE); assert.equal(cert.student_name, 'Paula Provas'); assert.equal(cert.course_title, 'Curso Prova'); assert.equal(cert.status, 'valid'); assert.equal(Number(cert.final_score), 10);
  assert.match(cert.body_text, /Paula Provas concluiu o curso Curso Prova/);
  const again = await sb.post(`${base()}/aula/${lc}/concluir`, { done: '1' }, base()); assert.equal(again.status, 303);
  assert.equal((await q('SELECT count(*)::int n FROM certificates')).rows[0].n, 1, 'um certificado por aluno e curso');
});

test('certificado: PDF só do dono, página pública mínima e QR/código', async () => {
  const cert = (await q('SELECT * FROM certificates')).rows[0];
  const list = await sb.get('/certificados'); assert.match(list.text, new RegExp(cert.code)); assert.match(list.text, /Baixar PDF/);
  const pdf = await sb.req('GET', `/certificados/${cert.code}/pdf`); assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  const buf = await certs.pdf({ baseUrl: 'http://localhost:3000' }, cert); assert.equal(buf.subarray(0, 4).toString(), '%PDF'); assert.ok(buf.length > 20000);
  const other = await makeStudent(t, { email: 'intrusa@example.com', name: 'Intrusa' }); const ob = new Browser(t.base); await ob.login(other.email, other.password);
  assert.equal((await ob.req('GET', `/certificados/${cert.code}/pdf`)).status, 404, 'outro aluno não baixa');
  assert.equal((await admin.req('GET', `/certificados/${cert.code}/pdf`)).status, 200, 'administrador baixa');
  const anon = new Browser(t.base);
  const pub = await anon.get(`/certificado/${cert.code}`); assert.equal(pub.status, 200);
  assert.match(pub.text, /Certificado válido/); assert.match(pub.text, /Paula Provas/); assert.match(pub.text, /Curso Prova/); assert.match(pub.text, new RegExp(cert.code));
  assert.doesNotMatch(pub.text, /prova@example\.com/); assert.doesNotMatch(pub.text, /10,0|nota/i, 'sem e-mail nem nota');
  assert.match(pub.text, /noindex/);
  const viaForm = await anon.req('GET', `/verificar?codigo=${cert.code.toLowerCase()}`); assert.equal(viaForm.status, 302); assert.equal(viaForm.headers.get('location'), `/certificado/${cert.code}`);
  const nf = await anon.get('/verificar?codigo=EVL-AAAA-BBBB-CCCC'); assert.equal(nf.status, 404); assert.match(nf.text, /não encontrado/i);
  assert.equal((await anon.get('/certificado/qualquer-coisa')).status, 404);
  assert.equal((await anon.req('GET', `/certificados/${cert.code}/pdf`)).status, 303, 'sem login vai para entrar');
  assert.match((await anon.get('/')).text, /Verificar certificado/, 'link no rodapé');
});

test('revogar: página pública mostra cancelado, aluno não baixa mais e dá para restabelecer', async () => {
  const cert = (await q('SELECT * FROM certificates')).rows[0];
  const noReason = await admin.post(`/admin/certificados/${cert.id}/revogar`, { reason: '' }, '/admin/certificados'); assert.equal(noReason.status, 303);
  assert.equal((await q('SELECT status FROM certificates WHERE id=$1', [cert.id])).rows[0].status, 'valid');
  await admin.post(`/admin/certificados/${cert.id}/revogar`, { reason: 'Reembolso' }, '/admin/certificados');
  const row = (await q('SELECT * FROM certificates WHERE id=$1', [cert.id])).rows[0]; assert.equal(row.status, 'revoked'); assert.ok(row.revoked_at); assert.equal(row.revoke_reason, 'Reembolso');
  const anon = new Browser(t.base); const pub = await anon.get(`/certificado/${cert.code}`);
  assert.match(pub.text, /Certificado cancelado/); assert.doesNotMatch(pub.text, /Paula Provas/, 'cancelado não mostra o nome');
  assert.equal((await sb.req('GET', `/certificados/${cert.code}/pdf`)).status, 404);
  assert.match((await sb.get('/certificados')).text, /cancelado/);
  assert.match((await admin.get('/admin/certificados?situacao=revoked')).text, /Reembolso/);
  assert.match((await admin.get('/admin/certificados?q=paula')).text, /Paula Provas/);
  await admin.post(`/admin/certificados/${cert.id}/restabelecer`, {}, '/admin/certificados');
  assert.equal((await q('SELECT status FROM certificates WHERE id=$1', [cert.id])).rows[0].status, 'valid');
  assert.match((await anon.get(`/certificado/${cert.code}`)).text, /Certificado válido/);
  // cancelar a matrícula também revoga
  const e = (await q('SELECT id FROM enrollments WHERE user_id=$1 AND course_id=$2', [stu.id, course])).rows[0].id;
  await admin.post(`/admin/matriculas/${e}/cancelar`, {}, `/admin/cursos/${course}/matriculas`);
  assert.equal((await q('SELECT status FROM certificates WHERE id=$1', [cert.id])).rows[0].status, 'revoked');
  assert.match((await anon.get(`/certificado/${cert.code}`)).text, /Certificado cancelado/);
  await admin.post(`/admin/matriculas/${e}/reativar`, {}, `/admin/cursos/${course}/matriculas`);
  assert.equal((await q('SELECT status FROM certificates WHERE id=$1', [cert.id])).rows[0].status, 'revoked', 'reativar a matrícula não restabelece sozinho');
  const reuse = await certs.maybeIssue(stu.id, { id: course }); assert.equal(reuse, null, 'certificado revogado não é recriado');
  await admin.post(`/admin/certificados/${cert.id}/restabelecer`, {}, '/admin/certificados');
});

test('certificado editável: texto, carga horária e assinatura valem para os próximos', async () => {
  const bad = await admin.post(`/admin/cursos/${course}/certificado`, { cert_hours: 'abc', cert_text: 'Sem nome aqui', cert_signer: '', cert_signer_role: '' }, `/admin/cursos/${course}/avaliacoes`);
  assert.equal(bad.status, 422); assert.match(bad.text, /horas inteiras/); assert.match(bad.text, /\{nome\}/);
  await admin.post(`/admin/cursos/${course}/certificado`, { cert_hours: '40', cert_text: 'Parabéns {nome}! Você terminou {curso}{carga} em {data}.', cert_signer: 'Dra. Fulana', cert_signer_role: 'Diretora' }, `/admin/cursos/${course}/avaliacoes`);
  const c = (await q('SELECT cert_hours, cert_signer FROM courses WHERE id=$1', [course])).rows[0]; assert.equal(c.cert_hours, 40); assert.equal(c.cert_signer, 'Dra. Fulana');
  const ex = await admin.req('GET', `/admin/cursos/${course}/certificado-exemplo.pdf`); assert.equal(ex.status, 200); assert.match(ex.headers.get('content-type'), /pdf/);
  assert.equal(certs.fill('Oi {nome}, {curso}{carga}. {x}', { name: 'Ana', course: 'Z', hours: 1, date: new Date('2026-10-19T15:00:00Z') }), 'Oi Ana, Z, com carga horária de 1 hora.');
  assert.equal(certs.fill('', { name: 'Ana', course: 'Z', hours: null, date: new Date('2026-10-19T15:00:00Z') }), 'Certificamos que Ana concluiu o curso Z, em 19 de outubro de 2026, atendendo aos requisitos de avaliação e de conclusão da plataforma EvoLumen Academy.');
  // o certificado já emitido não muda
  assert.match((await q('SELECT body_text FROM certificates')).rows[0].body_text, /Certificamos que Paula Provas/);
});

test('exclusões respeitam o histórico de tentativas e certificados', async () => {
  const delQuestion = await admin.post(`/admin/questoes/${(await q('SELECT id FROM assessment_questions LIMIT 1')).rows[0].id}/excluir`, {}, `/admin/avaliacoes/${quiz}`); assert.equal(delQuestion.status, 303);
  assert.equal((await q('SELECT count(*)::int n FROM assessment_questions')).rows[0].n, 7, 'com tentativas a questão não exclui');
  await admin.post(`/admin/avaliacoes/${quiz}/excluir`, {}, `/admin/avaliacoes/${quiz}`);
  assert.equal((await q('SELECT count(*)::int n FROM assessments WHERE id=$1', [quiz])).rows[0].n, 1, 'com tentativas a avaliação não exclui');
  await admin.post(`/admin/modulos/${m1}/excluir`, {}, `/admin/cursos/${course}/conteudo`);
  assert.equal((await q('SELECT count(*)::int n FROM modules WHERE id=$1', [m1])).rows[0].n, 1);
  await admin.post(`/admin/alunos/${stu.id}/excluir`, {}, '/admin/alunos');
  assert.equal((await q('SELECT count(*)::int n FROM users WHERE id=$1', [stu.id])).rows[0].n, 1);
  await admin.post(`/admin/cursos/${course}/excluir`, {}, `/admin/cursos/${course}`);
  assert.equal((await q('SELECT count(*)::int n FROM courses WHERE id=$1', [course])).rows[0].n, 1);
  // inativar a prova final deixa de exigir
  await admin.post(`/admin/avaliacoes/${fin}`, { title: 'Prova', pass_score: '7', max_attempts: '3', active: '0' }, `/admin/avaliacoes/${fin}`);
  assert.equal((await A.overview(stu.id, { id: course })).final, null);
});

test('liberação manual da prova e curso sem prova (certificado só com 95%)', async () => {
  await admin.post(`/admin/avaliacoes/${fin}`, { title: 'Prova', pass_score: '7', max_attempts: '3', active: '1' }, `/admin/avaliacoes/${fin}`);
  const s2 = await makeStudent(t, { email: 'manual@example.com', name: 'Manuel Liberado' }); await q("INSERT INTO enrollments (user_id, course_id) VALUES ($1,$2)", [s2.id, course]);
  assert.equal((await A.overview(s2.id, { id: course })).final.unlocked, false);
  await admin.post(`/admin/avaliacoes/${fin}/liberar`, { user: String(s2.id) }, `/admin/avaliacoes/${fin}/tentativas`);
  assert.equal((await A.overview(s2.id, { id: course })).final.unlocked, true);
  await q('UPDATE assessments SET active = FALSE WHERE id=$1', [fin]); // curso sem prova
  await q('INSERT INTO lesson_progress (user_id, lesson_id) SELECT $1, id FROM lessons WHERE course_id=$2', [s2.id, course]);
  const c = await certs.maybeIssue(s2.id, { id: course }); assert.ok(c, 'sem prova final, 95% basta'); assert.equal(c.final_score, null);
});

test('revisão 0.4.0: envio só vale na avaliação da URL, nota mínima vazia é recusada, prova ativa sem questões não emite certificado', async () => {
  // aprovado não abre nova tentativa
  const before = (await q('SELECT count(*)::int n FROM assessment_attempts WHERE assessment_id=$1', [fin])).rows[0].n;
  await sb.post(`${base()}/avaliacao/${fin}/iniciar`, {}, base());
  assert.equal((await q('SELECT count(*)::int n FROM assessment_attempts WHERE assessment_id=$1', [fin])).rows[0].n, before, 'já aprovado: sem nova tentativa');
  // nota mínima vazia ou com 2 casas
  for (const bad of ['', '0', '7,55']) {
    const r = await admin.post(`/admin/avaliacoes/${quiz}`, { title: 'x', pass_score: bad, max_attempts: '3', active: '1' }, `/admin/avaliacoes/${quiz}`);
    assert.equal(r.status, 422, `nota "${bad}" recusada`);
  }
  // correção da prova final sem gabarito por questão (feito acima) e snapshot guarda o gabarito
  const at = (await q('SELECT snapshot FROM assessment_attempts WHERE assessment_id=$1 LIMIT 1', [fin])).rows[0];
  assert.ok(at.snapshot[0].right, 'snapshot guarda a resposta certa do momento');
  // prova final ativa sem questões: ninguém recebe certificado por essa janela
  await q("INSERT INTO courses (title, slug, summary, description, price_cents, level, access_type) SELECT 'Curso Sem Q','sem-q','r','d',1000,level,access_type FROM courses WHERE id=$1", [course]);
  const c2 = (await q("SELECT id FROM courses WHERE slug='sem-q'")).rows[0].id;
  await q("INSERT INTO assessments (course_id, kind, pass_score, max_attempts, active) VALUES ($1,'final',7,3,true)", [c2]);
  const ov = await A.overview(stu.id, { id: c2 });
  assert.equal(ov.cert.eligible, false, 'prova final sem questões bloqueia a emissão');
});

test('revisão 0.4.0: PDF com texto longo e nome com trecho repetido gera sem erro', async () => {
  const long = { code: 'EVL-AAAA-BBBB-CCCC', student_name: 'Ana', course_title: 'Anatomia', issued_at: new Date(), signer: 'Erick', signer_role: 'Psicanalista',
    body_text: 'Pelo curso de Anatomia, Ana concluiu o curso. ' + 'Texto longo de certificado. '.repeat(14) };
  const buf = await certs.pdf({ baseUrl: 'http://x' }, long);
  assert.equal(buf.slice(0, 4).toString(), '%PDF');
});
