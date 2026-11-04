'use strict';
// 1.4.0 · Método EPI: selo no certificado, página própria, menu e selo nas páginas de curso.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const certs = require('../src/certificates');

let t; let admin; let course; let dlc; const slug = 'curso-epi'; const dlSlug = 'ebook-epi';
const q = (sql, p) => t.pool.query(sql, p);
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';

before(async () => {
  t = await boot(); admin = await adminReady(t);
  const mk = async (title, s, type) => {
    await admin.post('/admin/cursos', { title, slug: s, summary: 'Resumo.', description: 'Desc', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice_days: '30' }, '/admin/cursos/novo');
    const id = (await q('SELECT id FROM courses WHERE slug=$1', [s])).rows[0].id;
    await q("UPDATE courses SET status='published', published_at=now() - interval '1 day', product_type=$2 WHERE id=$1", [id, type]);
    return id;
  };
  course = await mk('Curso EPI', slug, 'course');
  dlc = await mk('Ebook EPI', dlSlug, 'download');
  const mod = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'M',1) RETURNING id", [course])).rows[0].id;
  await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'A',1,'dQw4w9WgXcQ')", [course, mod]);
  await q("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy')", [LONG]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status = 'published' ON CONFLICT DO NOTHING");
});
after(async () => { await t.close(); });

test('texto padrão do certificado cita o Método EPI e preenche os campos', () => {
  assert.match(certs.DEFAULT_TEXT, /Método EPI - Escuta, Pausa e Integração/);
  assert.ok(certs.DEFAULT_TEXT.length <= 400);
  const s = certs.fill(certs.DEFAULT_TEXT, { name: 'Ana Lima', course: 'Curso X', hours: 20, date: new Date('2026-10-19T12:00:00Z') });
  assert.match(s, /Certificamos que Ana Lima concluiu o curso Curso X, com carga horária de 20 horas, em 19 de outubro de 2026/);
  assert.ok(!/[{}]/.test(s));
});

test('PDF do certificado é gerado com o selo', async () => {
  const buf = await certs.pdf({ baseUrl: 'https://x.test' }, { code: 'EVL-ABCD-EFGH-JKLM', student_name: 'Ana Lima', course_title: 'Curso X', body_text: certs.fill(null, { name: 'Ana Lima', course: 'Curso X', hours: 20, date: new Date() }), signer: 'Erick Torritezi', signer_role: 'Psicanalista', issued_at: new Date(), status: 'valid' });
  assert.equal(buf.slice(0, 4).toString(), '%PDF'); assert.ok(buf.length > 200000, 'selo embutido');
});

test('página /metodo-epi é pública, indexável e traz o texto e a arte', async () => {
  const b = new Browser(t.base);
  const r = await b.get('/metodo-epi');
  assert.equal(r.status, 200);
  assert.match(r.text, /Escuta\. Pausa\. Integração\./);
  assert.match(r.text, /Aprender também exige tempo para refletir/);
  assert.match(r.text, /Da informação à ação/);
  assert.match(r.text, /src="\/static\/img\/metodo-epi\.jpg"/);
  assert.match(r.text, /<title>Método EPI/);
  assert.equal((await b.get('/static/img/metodo-epi.jpg')).status, 200);
  assert.equal((await b.get('/static/img/selo-epi-360.webp')).status, 200);
});

test('menu superior e rodapé têm o link Método EPI', async () => {
  const r = await new Browser(t.base).get('/');
  assert.match(r.text, /href="\/metodo-epi"[^>]*>[\s\S]{0,200}Método EPI/);
});

test('curso mostra o selo abaixo da caixa de matrícula; produto digital não', async () => {
  const b = new Browser(t.base);
  const a = await b.get(`/cursos/${slug}`); assert.equal(a.status, 200);
  assert.match(a.text, /class="buy__epi"[\s\S]*epi-seal[\s\S]*href="\/metodo-epi"/);
  const d = await b.get(`/cursos/${dlSlug}`); assert.equal(d.status, 200);
  assert.ok(!/epi-seal/.test(d.text.replace(/<footer[\s\S]*$/, '')), 'sem selo em digital');
});

test('aluno matriculado vê o selo na home do curso e na aula', async () => {
  const stu = await makeStudent(t, { email: 'epi@example.com', name: 'Aluna Epi' });
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published'", [stu.id]);
  await q("INSERT INTO enrollments (user_id, course_id, origin) VALUES ($1,$2,'manual')", [stu.id, course]);
  const b = new Browser(t.base); await b.login(stu.email, stu.password);
  const h = await b.get(`/curso/${slug}`);
  assert.match(h.text, /epi-seal/);
  const lid = (await q('SELECT id FROM lessons WHERE course_id=$1', [course])).rows[0].id;
  const l = await b.get(`/curso/${slug}/aula/${lid}`);
  assert.equal(l.status, 200); assert.match(l.text, /epi-seal/);
});
