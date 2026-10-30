'use strict';
// 1.1.2 · Aula com vídeo do Instagram (só o endereço é guardado, carrega ao clicar) e aula bônus (fora do percentual e do certificado).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const IG = require('../src/instagram');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');

let t; let admin; let sb; let stu; let course; let m1; let m2; let l1; let l2; let l3; let l4;
const slug = 'curso-ig';
const q = (sql, p) => t.pool.query(sql, p);
const base = `/curso/${slug}`;
const EMBED = `<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/reel/C7FlXv2KcSf/?utm_source=ig_embed&amp;utm_campaign=loading" data-instgrm-version="14"><div style="padding:16px;"><a href="https://www.instagram.com/reel/C7FlXv2KcSf/?utm_source=ig_embed&amp;utm_campaign=loading" target="_blank">Ver</a></div></blockquote>\n<script async src="//www.instagram.com/embed.js"></script>`;
const lesson = (id, over = {}) => admin.post(`/admin/aulas/${id}`, { title: 'Aula', video: '', instagram: '', description: '', duration_min: '', ...over }, `/admin/cursos/${course}/conteudo`);
const row = async (id) => (await q('SELECT * FROM lessons WHERE id=$1', [id])).rows[0];

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await admin.post('/admin/cursos', { title: 'Curso IG', slug, summary: 'Resumo.', description: 'Desc', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1' }, '/admin/cursos/novo');
  course = (await q('SELECT id FROM courses WHERE slug=$1', [slug])).rows[0].id;
  m1 = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'Base',1) RETURNING id", [course])).rows[0].id;
  m2 = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'Final',2) RETURNING id", [course])).rows[0].id;
  l1 = (await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'Aula 1',1,'dQw4w9WgXcQ') RETURNING id", [course, m1])).rows[0].id;
  l2 = (await q("INSERT INTO lessons (course_id, module_id, title, position) VALUES ($1,$2,'Live bônus',2) RETURNING id", [course, m1])).rows[0].id;
  l3 = (await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'Aula 3',1,'dQw4w9WgXcQ') RETURNING id", [course, m2])).rows[0].id;
  l4 = (await q("INSERT INTO lessons (course_id, module_id, title, position) VALUES ($1,$2,'Aula 4',2) RETURNING id", [course, m2])).rows[0].id;
  stu = await makeStudent(t, { email: 'ig@example.com', name: 'Aluna IG' });
  await q("INSERT INTO enrollments (user_id, course_id, origin) VALUES ($1,$2,'manual')", [stu.id, course]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status = 'published'", [stu.id]);
  sb = new Browser(t.base); await sb.login(stu.email, stu.password);
});
after(async () => { await t.close(); });

test('leitor de link: aceita o código de incorporação e links, guarda só o endereço limpo', () => {
  const file = '/mnt/user-data/attachments/a23e5775-3bc2-5896-aef8-dc0ef9c9244a/0e33afec-attachment.txt';
  const real = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : EMBED;
  assert.deepEqual(IG.parse(real), { url: 'https://www.instagram.com/reel/C7FlXv2KcSf/' });
  assert.deepEqual(IG.parse(EMBED), { url: 'https://www.instagram.com/reel/C7FlXv2KcSf/' });
  assert.equal(IG.parse('https://www.instagram.com/abraph.br/reel/C7FlXv2KcSf/?igsh=abc').url, 'https://www.instagram.com/reel/C7FlXv2KcSf/');
  assert.equal(IG.parse('instagram.com/reels/C7FlXv2KcSf').url, 'https://www.instagram.com/reel/C7FlXv2KcSf/');
  assert.equal(IG.parse('https://www.instagram.com/p/ABCde12345/').url, 'https://www.instagram.com/p/ABCde12345/');
  assert.equal(IG.parse('https://www.instagram.com/tv/ABCde12345/').url, 'https://www.instagram.com/tv/ABCde12345/');
  assert.deepEqual(IG.parse('   '), {}); assert.deepEqual(IG.parse(null), {});
  for (const bad of ['https://evil.com/reel/ABCDEFG/', 'https://instagram.com.evil.com/reel/ABCDEFG/', 'https://www.instagram.com/stories/x/', 'javascript:alert(1)', 'https://www.instagram.com/share/reel/ABCDEFGH/', 'https://www.instagram.com/reel/ab/', 'x'.repeat(9000)]) assert.ok(IG.parse(bad).error, bad.slice(0, 40));
  assert.equal(IG.isValid('https://www.instagram.com/reel/C7FlXv2KcSf/'), true); assert.equal(IG.isValid('https://www.instagram.com/reel/C7FlXv2KcSf/"><script>'), false);
  assert.equal(IG.embedPermalink('javascript:x'), '');
});

test('administrador cola o código: só o endereço é guardado; lixo, os dois vídeos juntos e nada ficam recusados', async () => {
  const r = await lesson(l2, { title: 'Live bônus', instagram: EMBED, is_bonus: '1' });
  assert.equal(r.status, 303);
  const l = await row(l2);
  assert.equal(l.instagram_url, 'https://www.instagram.com/reel/C7FlXv2KcSf/'); assert.equal(l.is_bonus, true); assert.equal(l.youtube_id, null);
  assert.ok(!JSON.stringify(l).includes('blockquote') && !JSON.stringify(l).includes('<script'), 'o código colado não é guardado');
  // o formulário mostra o endereço limpo e a caixa marcada
  const page = await admin.get(`/admin/cursos/${course}/conteudo`);
  assert.match(page.text, /instagram\.com\/reel\/C7FlXv2KcSf\//); assert.match(page.text, /name="is_bonus" value="1" checked/);
  // inválido, vazio mantém, YouTube + Instagram juntos
  const bad = await lesson(l1, { title: 'Aula 1', video: 'https://youtu.be/dQw4w9WgXcQ', instagram: 'https://evil.com/x' }); assert.equal(bad.status, 303);
  assert.equal((await row(l1)).instagram_url, null);
  const both = await lesson(l1, { title: 'Aula 1', video: 'https://youtu.be/dQw4w9WgXcQ', instagram: 'https://www.instagram.com/reel/C7FlXv2KcSf/' });
  assert.equal((await row(l1)).instagram_url, null, 'os dois vídeos na mesma aula são recusados');
  assert.equal((await row(l1)).youtube_id, 'dQw4w9WgXcQ');
  // a base também recusa endereços fora do padrão e os dois vídeos
  await assert.rejects(q("UPDATE lessons SET instagram_url='https://evil.com/reel/ABCDEFG/' WHERE id=$1", [l2]));
  await assert.rejects(q("UPDATE lessons SET instagram_url='https://www.instagram.com/reel/C7FlXv2KcSf/' WHERE id=$1", [l1]));
  // aula bônus sem marcar volta a contar
  await lesson(l2, { title: 'Live bônus', instagram: 'https://www.instagram.com/reel/C7FlXv2KcSf/' });
  assert.equal((await row(l2)).is_bonus, false);
  await lesson(l2, { title: 'Live bônus', instagram: 'https://www.instagram.com/reel/C7FlXv2KcSf/', is_bonus: '1' });
});

test('aluno vê o cartão "Carregar vídeo": nada do Instagram é carregado antes do clique e a CSP só abre nessa página', async () => {
  const a = await sb.get(`${base}/aula/${l2}`); assert.equal(a.status, 200);
  assert.match(a.text, /data-ig="https:\/\/www\.instagram\.com\/reel\/C7FlXv2KcSf\/\?utm_source=ig_embed&amp;utm_campaign=loading"/);
  assert.match(a.text, /Carregar vídeo/); assert.match(a.text, /Abrir no Instagram/); assert.match(a.text, /Política de privacidade/);
  assert.doesNotMatch(a.text, /instagram\.com\/embed\.js/); assert.doesNotMatch(a.text, /<blockquote/); assert.doesNotMatch(a.text, /<iframe/);
  assert.match(a.text, /Bônus/); assert.match(a.text, /não conta para o seu percentual/); assert.match(a.text, /não mede o tempo assistido/);
  const csp = a.headers.get('content-security-policy');
  assert.match(csp, /script-src[^;]*https:\/\/www\.instagram\.com/); assert.match(csp, /frame-src[^;]*https:\/\/www\.instagram\.com/); assert.match(csp, /frame-src[^;]*youtube-nocookie/);
  const y = await sb.get(`${base}/aula/${l1}`);
  assert.doesNotMatch(y.headers.get('content-security-policy'), /instagram/, 'aula de YouTube continua sem liberar o Instagram');
  assert.match(y.text, /youtube-nocookie\.com\/embed/);
  // o script do clique fica no arquivo do sistema, sem código na página
  const js = fs.readFileSync(require('node:path').join(__dirname, '../public/js/app.js'), 'utf8');
  assert.match(js, /data-ig-load/); assert.match(js, /https:\/\/www\.instagram\.com\/embed\.js/); assert.match(js, /Embeds\.process/);
  // sem o aluno matriculado a aula não abre (o Instagram não muda a regra de acesso)
  const out = new Browser(t.base); const o = await makeStudent(t, { email: 'fora@example.com', name: 'Fora' }); await out.login(o.email, o.password);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status = 'published'", [o.id]);
  const no = await out.get(`${base}/aula/${l2}`); assert.notEqual(no.status, 200); assert.doesNotMatch(no.text, /instagram\.com\/reel/);
});

test('bônus fica fora do percentual, do quiz do módulo e do certificado; concluir manualmente funciona', async () => {
  const C = require('../src/courses');
  let p = await C.progressFor(stu.id, course);
  assert.equal(p.total, 3, '4 aulas, 1 bônus: 3 contam');
  await sb.post(`${base}/aula/${l2}/concluir`, { done: '1' }, `${base}/aula/${l2}`);
  p = await C.progressFor(stu.id, course);
  assert.equal(p.count, 0); assert.equal(p.pct, 0); assert.ok(p.done.has(String(l2)), 'o visto aparece na lista');
  const home = await sb.get(base); assert.match(home.text, /0 de 3 aulas concluídas/); assert.match(home.text, /Bônus/);
  await sb.post(`${base}/aula/${l1}/concluir`, { done: '1' }, `${base}/aula/${l1}`);
  p = await C.progressFor(stu.id, course); assert.equal(p.count, 1); assert.equal(p.pct, 33);
  // quiz do módulo 1 libera com a aula 1 concluída, mesmo sem o bônus (testado também sem o bônus concluído)
  await q('DELETE FROM lesson_progress WHERE lesson_id=$1', [l2]);
  const A = require('../src/assess');
  const ov = await A.overview(stu.id, await C.byId(course));
  assert.equal(ov.modules[m1].allDone, true, 'bônus não impede o módulo de ser dado como concluído');
  assert.equal(ov.cert.pct, 33);
  // lista dos alunos / matrículas usam a mesma conta
  const en = await admin.get(`/admin/cursos/${course}/matriculas`); assert.equal(en.status, 200); assert.match(en.text, /1\/3|1 de 3/);
});

test('a última aula que vale para o certificado ignora o bônus; Instagram por último bloqueia a publicação quando há prova final', async () => {
  const C = require('../src/courses'); const A = require('../src/assess');
  // l4 vira Instagram (não bônus) e é a última: sem prova final ativa não há aviso
  await lesson(l4, { title: 'Aula 4', instagram: 'https://www.instagram.com/reel/AAAAAAAAAA/' });
  assert.equal(await C.lastLessonIssue(course), null, 'sem prova final, nada a avisar');
  await admin.post(`/admin/cursos/${course}/avaliacoes`, { kind: 'final' }, `/admin/cursos/${course}/avaliacoes`);
  const msg = await C.lastLessonIssue(course);
  assert.match(msg, /Aula 4/); assert.match(msg, /Instagram/);
  // o editor avisa e a publicação é recusada
  assert.match((await admin.get(`/admin/cursos/${course}/conteudo`)).text, /Atenção: a última aula/);
  const f = { title: 'Curso IG', slug, summary: 'Resumo.', description: 'Desc', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', publish: '1' };
  const pub = await admin.post(`/admin/cursos/${course}`, f, `/admin/cursos/${course}`);
  assert.equal(pub.status, 422); assert.match(pub.text, /vídeo do Instagram/); assert.equal((await q('SELECT status FROM courses WHERE id=$1', [course])).rows[0].status, 'draft');
  // marcando como bônus, a última que vale passa a ser a Aula 3 (YouTube) e a publicação é aceita
  await lesson(l4, { title: 'Aula 4', instagram: 'https://www.instagram.com/reel/AAAAAAAAAA/', is_bonus: '1' });
  assert.equal(await C.lastLessonIssue(course), null);
  const ok = await admin.post(`/admin/cursos/${course}`, f, `/admin/cursos/${course}`); assert.equal(ok.status, 303);
  const ov = await A.overview(stu.id, await C.byId(course));
  assert.equal(ov.progress.total, 2, 'Aula 1 e Aula 3 contam; Live e Aula 4 são bônus' ) ;
});

test('copiar o curso leva o endereço do Instagram e a marca de bônus', async () => {
  const dup = await admin.post('/admin/cursos', { title: 'Curso IG cópia', slug: 'curso-ig-copia', summary: 'Resumo.', description: 'Desc', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', copy_from: String(course) }, `/admin/cursos/${course}/duplicar`);
  assert.equal(dup.status, 303);
  const rows = (await q("SELECT l.title, l.instagram_url, l.is_bonus FROM lessons l JOIN courses c ON c.id = l.course_id WHERE c.slug='curso-ig-copia' ORDER BY l.module_id, l.position")).rows;
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.filter((r) => r.instagram_url).map((r) => [r.title, r.is_bonus]), [['Live bônus', true], ['Aula 4', true]]);
});

test('vitrine pública conta o vídeo do Instagram sem expor o endereço; a privacidade ganha o rascunho do Instagram', async () => {
  const pub = await new Browser(t.base).get(`/cursos/${slug}`);
  assert.equal(pub.status, 200); assert.doesNotMatch(pub.text, /instagram\.com\/reel/);
  const d = (await q("SELECT body_html, status FROM legal_documents WHERE doc_type='privacy' AND body_html ILIKE '%Instagram%'")).rows;
  if ((await q("SELECT 1 FROM legal_documents WHERE doc_type='privacy' AND status='published'")).rowCount) { assert.equal(d.length, 1); assert.equal(d[0].status, 'draft', 'nasce como rascunho: ninguém precisa aceitar de novo'); assert.match(d[0].body_html, /Carregar vídeo/); }
  const pending = await q("SELECT 1 FROM legal_documents WHERE doc_type='privacy' AND status='published' AND body_html ILIKE '%Instagram%'"); assert.equal(pending.rowCount, 0);
});

test('allowCsp: acrescenta só o Instagram e preserva as outras diretivas', () => {
  assert.equal(IG.allowCsp(''), ''); assert.equal(IG.allowCsp(undefined), undefined);
  const out = IG.allowCsp("default-src 'self'; script-src 'self'; style-src 'self'; upgrade-insecure-requests");
  assert.match(out, /script-src 'self' https:\/\/www\.instagram\.com(;|$)/); assert.match(out, /style-src 'self'(;|$)/); assert.match(out, /upgrade-insecure-requests/); assert.doesNotMatch(out, /cdninstagram[^;]*;?.*script/);
  assert.doesNotMatch(out.split(';').find((d) => d.trim().startsWith('script-src')), /cdninstagram/);
});

test('"Continuar" prefere aula que conta; a mensagem da prova final acompanha a última aula', async () => {
  const C = require('../src/courses');
  const home = await sb.get(base); assert.equal(home.status, 200);
  const cur = C.flatLessons(await C.curriculum(course));
  assert.ok(cur.some((l) => l.is_bonus));
  const m = home.text.match(/Continuar|Começar o curso/); assert.ok(m);
  assert.doesNotMatch(home.text.match(/class="resume"[\s\S]{0,600}/)[0], new RegExp(`aula/${l2}"|aula/${l4}"`), 'o botão não aponta para o bônus');
});
