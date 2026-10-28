'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent, mailer } = require('./helpers');

let t; let admin; let course; let lesson;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 65)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
const VIDEO = 'dQw4w9WgXcQ';
const form = (o = {}) => ({ title: 'Protocolo ESSÊNCIA', slug: 'protocolo-essencia', summary: 'Um percurso guiado.', description: 'Descrição\n\nSegundo parágrafo', price: '197,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '10', expiry_notice_days: '30,7,1', ...o });

before(async () => {
  t = await boot(); admin = await adminReady(t);
});
after(async () => { await t.close(); });

test('cadastro do curso valida os campos e não aceita endereço repetido', async () => {
  const bad = await admin.post('/admin/cursos', form({ title: 'Ab', slug: 'Slug Ruim', price: '100,00', promo_price: '300,00', access_type: 'months', access_months: '0', expiry_notice_days: '0' }), '/admin/cursos/novo');
  assert.equal(bad.status, 422);
  assert.match((await admin.post('/admin/cursos', form({ price: 'abc' }), '/admin/cursos/novo')).text, /Informe o valor/);
  for (const m of [/mínimo 3 letras/, /letras minúsculas/, /menor que o valor normal/, /1 a 120 meses/, /Use dias separados/]) assert.match(bad.text, m);
  const ok = await admin.post('/admin/cursos', form(), '/admin/cursos/novo');
  assert.equal(ok.status, 303); assert.match(ok.location, /^\/admin\/cursos\/\d+\/conteudo$/);
  course = (await t.pool.query("SELECT * FROM courses WHERE slug='protocolo-essencia'")).rows[0];
  assert.equal(course.price_cents, 19700); assert.equal(course.status, 'draft'); assert.equal(course.published_at, null);
  const dup = await admin.post('/admin/cursos', form(), '/admin/cursos/novo');
  assert.equal(dup.status, 422); assert.match(dup.text, /Já existe um curso com este endereço/);
});

test('rascunho não aparece na landing nem na página pública; administrador pré-visualiza', async () => {
  const anon = new Browser(t.base);
  const home = await anon.get('/'); assert.equal(home.status, 200); assert.doesNotMatch(home.text, /Protocolo ESSÊNCIA/); assert.match(home.text, /Novos cursos em breve/);
  assert.equal((await anon.get('/cursos/protocolo-essencia')).status, 404);
  const prev = await admin.get('/cursos/protocolo-essencia'); assert.equal(prev.status, 200); assert.match(prev.text, /Pré-visualização/);
});

test('módulos, aulas e ordem', async () => {
  for (const title of ['Primeiros passos', 'Aprofundando']) await admin.post(`/admin/cursos/${course.id}/modulos`, { title }, `/admin/cursos/${course.id}/conteudo`);
  const mods = (await t.pool.query('SELECT * FROM modules WHERE course_id=$1 ORDER BY position', [course.id])).rows;
  assert.deepEqual(mods.map((m) => m.position), [1, 2]);
  for (const [i, title] of ['Boas-vindas', 'Respiração', 'Segunda aula'].entries()) await admin.post(`/admin/modulos/${mods[i === 2 ? 1 : 0].id}/aulas`, { title }, `/admin/cursos/${course.id}/conteudo`);
  const ls = (await t.pool.query('SELECT * FROM lessons ORDER BY id')).rows; lesson = ls[0];
  assert.equal((await admin.post(`/admin/aulas/${lesson.id}`, { title: 'Boas-vindas', video: 'https://evil.example/watch?v=dQw4w9WgXcQ', description: '' }, `/admin/cursos/${course.id}/conteudo`)).location, `/admin/cursos/${course.id}/conteudo`);
  assert.equal((await t.pool.query('SELECT youtube_id FROM lessons WHERE id=$1', [lesson.id])).rows[0].youtube_id, null, 'link que não é do YouTube é recusado');
  await admin.post(`/admin/aulas/${lesson.id}`, { title: 'Boas-vindas <b>', video: `https://youtu.be/${VIDEO}?t=5`, description: 'Texto da aula', duration_min: '12' }, `/admin/cursos/${course.id}/conteudo`);
  assert.equal((await t.pool.query('SELECT youtube_id, duration_min FROM lessons WHERE id=$1', [lesson.id])).rows[0].youtube_id, VIDEO);
  await admin.post(`/admin/aulas/${ls[1].id}/mover`, { dir: 'up' }, `/admin/cursos/${course.id}/conteudo`);
  assert.deepEqual((await t.pool.query('SELECT title FROM lessons WHERE module_id=$1 ORDER BY position', [mods[0].id])).rows.map((r) => r.title), ['Respiração', 'Boas-vindas <b>']);
  await admin.post(`/admin/aulas/${ls[1].id}/mover`, { dir: 'down' }, `/admin/cursos/${course.id}/conteudo`);
  const page = await admin.get(`/admin/cursos/${course.id}/conteudo`);
  assert.match(page.text, /Boas-vindas &lt;b&gt;/, 'títulos são escapados'); assert.doesNotMatch(page.text, /Boas-vindas <b>/);
});

test('upload de arquivos: tipo, conteúdo real, tamanho e token', async () => {
  const to = `/admin/aulas/${lesson.id}/arquivos`; const from = `/admin/cursos/${course.id}/conteudo`;
  const ok = await admin.upload(to, { label: 'Apostila 1' }, { name: 'apostila.pdf', buffer: PDF, type: 'application/pdf' }, { csrfFrom: from });
  assert.equal(ok.status, 303); assert.equal((await t.pool.query('SELECT count(*)::int n FROM lesson_files WHERE lesson_id=$1', [lesson.id])).rows[0].n, 1);
  const flash = async (r) => { assert.equal(r.status, 303); return (await admin.get(from)).text; };
  assert.match(await flash(await admin.upload(to, {}, { name: 'virus.exe', buffer: PDF }, { csrfFrom: from })), /Tipo de arquivo não permitido/);
  assert.match(await flash(await admin.upload(to, {}, { name: 'falso.pdf', buffer: Buffer.from('MZ não sou pdf') }, { csrfFrom: from })), /não confere com o tipo PDF/);
  assert.match(await flash(await admin.upload(to, {}, { name: 'grande.pdf', buffer: Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(21 * 1024 * 1024)]) }, { csrfFrom: from })), /passa de 20 MB/);
  assert.match(await flash(await admin.upload(to, {}, null, { csrfFrom: from })), /Escolha um arquivo/);
  const semToken = await admin.upload(to, {}, { name: 'a.pdf', buffer: PDF }, { csrf: false });
  assert.equal(semToken.status, 403);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM lesson_files WHERE lesson_id=$1', [lesson.id])).rows[0].n, 1, 'só o primeiro arquivo foi guardado');
  const outra = await admin.upload('/perfil', {}, { name: 'a.pdf', buffer: PDF }, { csrfFrom: '/perfil' });
  assert.equal(outra.status, 403, 'multipart só vale nas rotas de envio');
  const student = await makeStudent(t, { email: 'invasor@example.com', name: 'Invasor' }); const sb = new Browser(t.base); await sb.login(student.email, student.password);
  assert.equal((await sb.upload(to, {}, { name: 'a.pdf', buffer: PDF }, { csrfFrom: '/meus-cursos' })).status, 403, 'aluno não envia arquivos');
});

test('capa: envia imagem, publicação libera a vitrine e a capa só aparece para o público depois de publicado', async () => {
  const from = `/admin/cursos/${course.id}`;
  assert.equal((await admin.upload(`${from}/capa`, {}, { name: 'capa.png', buffer: PNG }, { csrfFrom: from })).status, 303);
  const coverId = (await t.pool.query('SELECT cover_file_id FROM courses WHERE id=$1', [course.id])).rows[0].cover_file_id; assert.ok(coverId);
  const anon = new Browser(t.base);
  assert.equal((await anon.get(`/capas/${coverId}`)).status, 404, 'rascunho: capa não é pública');
  assert.equal((await admin.get(`/capas/${coverId}`)).status, 200);
  const pub = await admin.post(`/admin/cursos/${course.id}`, form({ publish: '1', featured: '1', category: 'Autoconhecimento', learn_items: 'Item um\nItem dois', faq_q1: 'Tem certificado?', faq_a1: 'Em breve.', workload_hours: '24', intro_video: `https://youtu.be/${VIDEO}` }), from);
  assert.equal(pub.status, 303);
  const home = await anon.get('/'); assert.match(home.text, /Protocolo ESSÊNCIA/); assert.match(home.text, /R\$\s?197,00/); assert.match(home.text, /Destaque/);
  const r = await anon.get(`/capas/${coverId}`); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  await t.pool.query("UPDATE courses SET published_at = now() + interval '3 days' WHERE id=$1", [course.id]);
  assert.doesNotMatch((await anon.get('/')).text, /Protocolo ESSÊNCIA/, 'agendado para o futuro não aparece');
  await t.pool.query("UPDATE courses SET published_at = now() - interval '1 minute' WHERE id=$1", [course.id]);
});

test('página pública do curso não vaza vídeos nem arquivos das aulas', async () => {
  const anon = new Browser(t.base);
  const p = await anon.get('/cursos/protocolo-essencia'); assert.equal(p.status, 200);
  assert.match(p.text, /Item dois/); assert.match(p.text, /Tem certificado\?/); assert.match(p.text, /Módulo 1 · Primeiros passos/);
  assert.match(p.text, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/, 'só o vídeo de apresentação');
  await t.pool.query("UPDATE courses SET intro_youtube_id = NULL WHERE id=$1", [course.id]);
  const p2 = await anon.get('/cursos/protocolo-essencia');
  assert.doesNotMatch(p2.text, new RegExp(VIDEO)); assert.doesNotMatch(p2.text, /\/arquivos\//); assert.match(p2.text, /Matricular-se/);
  assert.match(p2.text, /Aulas|aulas/);
  assert.equal((await anon.get('/arquivos/1')).location, '/entrar'); assert.equal((await anon.get('/curso/protocolo-essencia')).location, '/entrar');
});

test('acesso ao conteúdo: sem matrícula, matriculado, vencido e removido', async () => {
  const s = await makeStudent(t, { email: 'aluno1@example.com', name: 'Aluno Um' });
  const b = new Browser(t.base); await b.login(s.email, s.password);
  const fileId = (await t.pool.query('SELECT file_id FROM lesson_files LIMIT 1')).rows[0].file_id;
  const lessonUrl = `/curso/protocolo-essencia/aula/${lesson.id}`;
  for (const u of ['/curso/protocolo-essencia', lessonUrl, `/arquivos/${fileId}`]) assert.equal((await b.get(u)).status, 403, 'sem matrícula: ' + u);
  assert.match((await b.get('/meus-cursos')).text, /ainda não tem cursos/);
  const en = await admin.post(`/admin/cursos/${course.id}/matriculas`, { email: s.email }, `/admin/cursos/${course.id}/matriculas`);
  assert.equal(en.status, 200); assert.match(en.text, /Matrícula criada/);
  const home = await b.get('/meus-cursos'); assert.match(home.text, /Protocolo ESSÊNCIA/); assert.match(home.text, /acesso vitalício/);
  const aula = await b.get(lessonUrl); assert.equal(aula.status, 200); assert.match(aula.text, new RegExp(`youtube-nocookie\\.com/embed/${VIDEO}`)); assert.match(aula.text, /apostila\.pdf/);
  const dl = await b.get(`/arquivos/${fileId}`); assert.equal(dl.status, 200); assert.match(dl.headers.get('content-disposition'), /attachment; filename="?apostila\.pdf"?/); assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  await t.pool.query("UPDATE enrollments SET expires_at = now() - interval '1 day' WHERE user_id=$1", [s.id]);
  assert.equal((await b.get(lessonUrl)).status, 403, 'vencido'); assert.equal((await b.get(`/arquivos/${fileId}`)).status, 403);
  assert.match((await b.get('/cursos/protocolo-essencia')).text, /Renovar acesso/);
  await t.pool.query("UPDATE enrollments SET expires_at = now() + interval '5 days' WHERE user_id=$1", [s.id]);
  assert.equal((await b.get(lessonUrl)).status, 200); assert.match((await b.get('/meus-cursos')).text, /acesso até/);
  const eid = (await t.pool.query('SELECT id FROM enrollments WHERE user_id=$1', [s.id])).rows[0].id;
  await admin.post(`/admin/matriculas/${eid}/excluir`, {}, `/admin/cursos/${course.id}/matriculas`);
  assert.equal((await b.get(lessonUrl)).status, 403, 'acesso removido');
  assert.equal((await admin.get(lessonUrl)).status, 200, 'administrador sempre vê'); assert.equal((await admin.get(`/arquivos/${fileId}`)).status, 200);
});

test('progresso: concluir, desmarcar, ir para a próxima aula e retomar de onde parou', async () => {
  const s = await makeStudent(t, { email: 'aluno2@example.com', name: 'Aluno Dois' });
  await admin.post(`/admin/cursos/${course.id}/matriculas`, { email: s.email }, `/admin/cursos/${course.id}/matriculas`);
  const b = new Browser(t.base); await b.login(s.email, s.password);
  const ids = (await t.pool.query('SELECT l.id FROM lessons l JOIN modules m ON m.id=l.module_id ORDER BY m.position, l.position')).rows.map((r) => r.id);
  const url = (id) => `/curso/protocolo-essencia/aula/${id}`;
  const done = await b.post(`${url(ids[0])}/concluir`, { done: '1' }, url(ids[0]));
  assert.equal(done.location, url(ids[1]), 'depois de concluir vai para a próxima aula');
  assert.match((await b.get('/meus-cursos')).text, /33% concluído/);
  assert.match((await b.get('/meus-cursos')).text, new RegExp(`aula/${ids[1]}`), 'continuar de onde parou');
  await b.post(`${url(ids[0])}/concluir`, { done: '1' }, url(ids[0]));
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM lesson_progress WHERE user_id=$1', [s.id])).rows[0].n, 1, 'sem duplicar');
  await b.post(`${url(ids[0])}/concluir`, { done: '0' }, url(ids[0]));
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM lesson_progress WHERE user_id=$1', [s.id])).rows[0].n, 0);
  const outro = await makeStudent(t, { email: 'aluno3@example.com', name: 'Aluno Três' }); const ob = new Browser(t.base); await ob.login(outro.email, outro.password);
  assert.equal((await ob.post(`${url(ids[0])}/concluir`, { done: '1' }, '/meus-cursos')).status, 403, 'sem matrícula não grava progresso');
});

test('liberar acesso a e-mail novo cria o aluno com senha provisória e troca obrigatória', async () => {
  mailer.memory.length = 0;
  const r = await admin.post(`/admin/cursos/${course.id}/matriculas`, { email: 'Nova.Aluna@Example.com', name: 'Nova Aluna' }, `/admin/cursos/${course.id}/matriculas`);
  assert.equal(r.status, 200); assert.match(r.text, /Aluno criado e matriculado/);
  const pass = r.text.match(/class="secret">([^<]+)</)[1]; assert.equal(pass.length, 12);
  await t.app.locals.idle();
  const mail = mailer.memory.find((m) => m.to === 'nova.aluna@example.com'); assert.ok(mail && mail.text.includes(pass));
  const b = new Browser(t.base);
  assert.equal((await b.login('nova.aluna@example.com', pass)).location, '/primeiro-acesso');
  assert.equal((await b.get('/curso/protocolo-essencia')).location, '/primeiro-acesso', 'antes de trocar a senha não entra no curso');
  assert.equal((await admin.post(`/admin/cursos/${course.id}/matriculas`, { email: 'sem-nome@example.com' }, `/admin/cursos/${course.id}/matriculas`)).status, 422);
  assert.equal((await admin.post(`/admin/cursos/${course.id}/matriculas`, { email: 'erick@example.com' }, `/admin/cursos/${course.id}/matriculas`)).status, 422, 'e-mail de administrador');
});

test('curso por prazo calcula o vencimento da matrícula', async () => {
  const c2 = await admin.post('/admin/cursos', form({ title: 'Vivendo GenuinaMENTE', slug: 'vivendo-genuinamente', access_type: 'months', access_months: '6', renewal_price: '97,00' }), '/admin/cursos/novo');
  const id = c2.location.match(/cursos\/(\d+)/)[1];
  const s = await makeStudent(t, { email: 'prazo@example.com', name: 'Prazo Teste' });
  await admin.post(`/admin/cursos/${id}/matriculas`, { email: s.email }, `/admin/cursos/${id}/matriculas`);
  const e = (await t.pool.query("SELECT expires_at > now() + interval '5 months 25 days' AND expires_at < now() + interval '6 months 1 day' AS ok FROM enrollments WHERE user_id=$1", [s.id])).rows[0];
  assert.equal(e.ok, true);
  const row = (await t.pool.query('SELECT renewal_price_cents, access_months FROM courses WHERE id=$1', [id])).rows[0]; assert.equal(row.renewal_price_cents, 9700);
  await admin.post(`/admin/cursos/${id}/matriculas`, { email: s.email, until: '2030-01-31' }, `/admin/cursos/${id}/matriculas`);
  assert.match((await t.pool.query("SELECT to_char(expires_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') d FROM enrollments WHERE user_id=$1", [s.id])).rows[0].d, /2030-01-31/);
});

test('exclusão: bloqueada com alunos; sem alunos remove arquivos, aulas e capa', async () => {
  const blocked = await admin.post(`/admin/cursos/${course.id}/excluir`, {}, `/admin/cursos/${course.id}`);
  assert.equal(blocked.location, `/admin/cursos/${course.id}`);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM courses WHERE id=$1', [course.id])).rows[0].n, 1);
  await t.pool.query('DELETE FROM enrollments WHERE course_id=$1', [course.id]);
  await admin.post(`/admin/cursos/${course.id}/excluir`, {}, `/admin/cursos/${course.id}`);
  const n = async (q) => (await t.pool.query(q)).rows[0].n;
  assert.equal(await n('SELECT count(*)::int n FROM courses WHERE slug=\'protocolo-essencia\''), 0);
  assert.equal(await n('SELECT count(*)::int n FROM files'), 0, 'arquivos e capa foram removidos');
  assert.equal(await n('SELECT count(*)::int n FROM lessons WHERE course_id=' + course.id), 0);
});

test('textos legais públicos e rodapé com links', async () => {
  const anon = new Browser(t.base);
  assert.match((await anon.get('/termos')).text, /em elaboração/);
  await t.pool.query("UPDATE legal_documents SET status='published', published_at=now(), body_html='<p>Cláusula de teste</p>' WHERE doc_type='terms'");
  const r = await anon.get('/termos'); assert.match(r.text, /Cláusula de teste/); assert.match(r.text, /href="\/privacidade"/);
});

test('administrador sem sessão não acessa o painel de cursos', async () => {
  const anon = new Browser(t.base);
  for (const u of ['/admin/cursos', '/admin/cursos/novo', '/admin/cursos/1/conteudo']) assert.equal((await anon.get(u)).location, '/entrar');
});

test('datas: promoção com validade aplica o preço, datas inexistentes são recusadas e a data não recua ao salvar', async () => {
  await t.pool.query("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version) SELECT u.id, d.id, d.doc_type, d.version FROM users u, legal_documents d WHERE u.role='admin' AND d.status='published' ON CONFLICT DO NOTHING");
  const mk = await admin.post('/admin/cursos', form({ title: 'Promo Teste', slug: 'promo-teste', promo_price: '99,00', promo_until: '2099-12-31', publish: '1' }), '/admin/cursos/novo');
  const id = mk.location.match(/cursos\/(\d+)/)[1];
  assert.match((await new Browser(t.base).get('/')).text, /R\$\s?99,00/);
  for (let i = 0; i < 2; i++) { // salvar de novo não muda a data
    const page = await admin.get(`/admin/cursos/${id}`); assert.match(page.text, /value="2099-12-31"/);
    await admin.post(`/admin/cursos/${id}`, { ...form({ title: 'Promo Teste', slug: 'promo-teste', promo_price: '99,00', promo_until: '2099-12-31', publish: '1' }) }, `/admin/cursos/${id}`);
  }
  assert.equal((await t.pool.query('SELECT to_char(promo_until,\'YYYY-MM-DD\') d FROM courses WHERE id=$1', [id])).rows[0].d, '2099-12-31');
  await t.pool.query("UPDATE courses SET promo_until = '2000-01-01' WHERE id=$1", [id]);
  assert.match((await new Browser(t.base).get('/cursos/promo-teste')).text, /R\$\s?197,00/, 'promoção vencida não vale');
  const bad = await admin.post(`/admin/cursos/${id}`, form({ title: 'Promo Teste', slug: 'promo-teste', promo_price: '99,00', promo_until: '2026-02-31' }), `/admin/cursos/${id}`);
  assert.equal(bad.status, 422); assert.match(bad.text, /Data inválida/);
  assert.equal((await admin.post(`/admin/cursos/${course ? id : id}/matriculas`, { email: 'x@y.com', name: 'Xis Ypsilon', until: '2026-02-31' }, `/admin/cursos/${id}/matriculas`)).status, 422);
});

test('rematricular não apaga a origem da matrícula', async () => {
  await t.pool.query("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version) SELECT u.id, d.id, d.doc_type, d.version FROM users u, legal_documents d WHERE u.role='admin' AND d.status='published' ON CONFLICT DO NOTHING");
  const s = await makeStudent(t, { email: 'compra@example.com', name: 'Compra Teste' });
  const id = (await t.pool.query("SELECT id FROM courses WHERE slug='vivendo-genuinamente'")).rows[0].id;
  await t.pool.query("INSERT INTO enrollments (user_id, course_id, origin, starts_at) VALUES ($1,$2,'purchase', now() - interval '10 days')", [s.id, id]);
  await admin.post(`/admin/cursos/${id}/matriculas`, { email: s.email }, `/admin/cursos/${id}/matriculas`);
  const e = (await t.pool.query('SELECT origin, starts_at < now() - interval \'9 days\' AS kept FROM enrollments WHERE user_id=$1', [s.id])).rows[0];
  assert.equal(e.origin, 'purchase'); assert.equal(e.kept, true);
});

test('nível "Não se aplica": salva, aparece como opção e não mostra selo de nível ao público', async () => {
  const f = await admin.get('/admin/cursos/novo?tipo=curso');
  assert.match(f.text, /Não se aplica/);
  const ok = await admin.post('/admin/cursos', form({ title: 'Meditação guiada', slug: 'meditacao-guiada', level: 'nao_se_aplica' }), '/admin/cursos/novo');
  assert.equal(ok.status, 303);
  const row = (await t.pool.query("SELECT id, level FROM courses WHERE slug='meditacao-guiada'")).rows[0];
  assert.equal(row.level, 'nao_se_aplica');
  await t.pool.query("UPDATE courses SET status='published', published_at=now() WHERE id=$1", [row.id]);
  const pub = await new Browser(t.base).get('/cursos/meditacao-guiada');
  assert.equal(pub.status, 200); assert.doesNotMatch(pub.text, /Não se aplica/);
  const home = await new Browser(t.base).get('/');
  assert.doesNotMatch(home.text, /Não se aplica/);
});
