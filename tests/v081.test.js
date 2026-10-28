'use strict';
// 0.8.1 · Dashboard e saúde do sistema, duplicar curso/produto, padrão único de caixas de seleção.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { boot, adminReady } = require('./helpers');
const health = require('../src/health');

let t; let admin; let dir;
const q = (sql, p) => t.pool.query(sql, p);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n' + 'conteudo '.repeat(80));
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2500, 3)]);
const base = (o = {}) => ({ title: 'Original', slug: 'original', summary: 'Resumo.', description: 'Descrição.', category: 'Cat', price: '49,90', access_type: 'lifetime', max_installments: '3', sort_order: '2', level: 'iniciante', ...o });

before(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evl-v081-')); t = await boot({ FILES_DIR: dir }); admin = await adminReady(t); });
after(async () => { await t.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('dashboard: resumo, pendências, saúde do sistema; sem texto antigo', async () => {
  await q("INSERT INTO users (name, email, password_hash, role, status) VALUES ('Aluno Pendente','pend@example.com','x','student','active')");
  const uid = (await q("SELECT id FROM users WHERE email='pend@example.com'")).rows[0].id;
  await q("INSERT INTO data_requests (user_id, type, status) VALUES ($1,'export','open')", [uid]);
  const page = await admin.get('/admin'); assert.equal(page.status, 200);
  assert.match(page.text, /Saúde do sistema/); assert.match(page.text, /Banco de dados/); assert.match(page.text, /Conectado/);
  assert.match(page.text, /Tempo de resposta das páginas/); assert.match(page.text, /Volume de arquivos/); assert.match(page.text, /Tarefas automáticas/);
  assert.match(page.text, /Pendências/); assert.match(page.text, /Pedidos de dados \(LGPD\)/); assert.match(page.text, /Vendas no mês/); assert.match(page.text, /Atalhos/);
  assert.doesNotMatch(page.text, /Fase entregue|O painel completo chega/);
  const h = await health.snapshot(t.cfg);
  assert.ok(['ok', 'warn', 'bad'].includes(h.level)); for (const k of ['servidor', 'banco', 'resposta', 'email', 'pagamento', 'tarefas', 'volume', 'memoria']) assert.ok(h.items.find((i) => i.key === k), k);
  assert.equal(h.items.find((i) => i.key === 'banco').level, 'ok');
  assert.ok(health.response(), 'tempo de resposta é medido');
  health.mark('tarefas', true); assert.match((await health.snapshot(t.cfg)).items.find((i) => i.key === 'tarefas').text, /Última execução/);
});

test('duplicar produto digital: formulário sem slug, cópia independente com capa e arquivos', async () => {
  assert.equal((await admin.post('/admin/cursos', base({ product_type: 'download', title: 'E-book 1', slug: 'ebook-1', category: 'E-book' }), '/admin/cursos/novo?tipo=arquivos')).status, 303);
  const src = (await q("SELECT id FROM courses WHERE slug='ebook-1'")).rows[0].id;
  assert.equal((await admin.upload(`/admin/cursos/${src}/capa`, {}, { name: 'c.png', buffer: PNG }, { csrfFrom: `/admin/cursos/${src}` })).status, 303);
  const up = (file, label, st) => admin.upload(`/admin/cursos/${src}/arquivos`, { label, armazenamento: st }, file, { csrfFrom: `/admin/cursos/${src}/arquivos` });
  assert.equal((await up({ name: 'a.pdf', buffer: PDF, type: 'application/pdf' }, 'PDF', 'db')).status, 303);
  assert.equal((await up({ name: 'b.zip', buffer: ZIP }, 'ZIP', 'volume')).status, 303);
  assert.match((await admin.get('/admin/cursos')).text, new RegExp(`/admin/cursos/${src}/duplicar`));
  const form = await admin.get(`/admin/cursos/${src}/duplicar`); assert.equal(form.status, 200);
  assert.match(form.text, /Duplicar produto digital/); assert.match(form.text, /value="Cópia de E-book 1"/); assert.match(form.text, /name="copy_from" value="\d+"/);
  assert.match(form.text, /2 arquivos/); assert.match(form.text, /name="slug"[^>]*value=""/); assert.match(form.text, /Não leva: vendas/);
  // slug repetido: volta ao formulário com a cópia preservada
  const dup = await admin.post('/admin/cursos', base({ product_type: 'download', title: 'Cópia', slug: 'ebook-1', copy_from: String(src), copy_files: '1' }), `/admin/cursos/${src}/duplicar`);
  assert.equal(dup.status, 422); assert.match(dup.text, /name="copy_from"/);
  // salvar com arquivos
  const ok = await admin.post('/admin/cursos', base({ product_type: 'download', title: 'E-book 2', slug: 'ebook-2', category: 'E-book', copy_from: String(src), copy_files: '1' }), `/admin/cursos/${src}/duplicar`);
  assert.equal(ok.status, 303, ok.text.slice(0, 300));
  const nw = (await q("SELECT * FROM courses WHERE slug='ebook-2'")).rows[0];
  assert.equal(nw.status, 'draft'); assert.equal(nw.product_type, 'download'); assert.equal(nw.price_cents, 4990);
  const a = (await q('SELECT f.* FROM product_files pf JOIN files f ON f.id = pf.file_id WHERE pf.product_id=$1 ORDER BY pf.position, pf.id', [src])).rows;
  const b = (await q('SELECT f.*, pf.label FROM product_files pf JOIN files f ON f.id = pf.file_id WHERE pf.product_id=$1 ORDER BY pf.position, pf.id', [nw.id])).rows;
  assert.equal(b.length, 2); assert.deepEqual(b.map((x) => x.label), ['PDF', 'ZIP']);
  for (let i = 0; i < 2; i++) { assert.notEqual(a[i].id, b[i].id); assert.equal(a[i].sha256, b[i].sha256); assert.equal(a[i].storage, b[i].storage); }
  assert.notEqual(a[1].path, b[1].path); assert.ok(fs.existsSync(path.join(dir, 'files', b[1].path)), 'cópia do volume no disco');
  assert.ok(nw.cover_file_id && nw.cover_file_id !== (await q('SELECT cover_file_id FROM courses WHERE id=$1', [src])).rows[0].cover_file_id, 'capa copiada');
  assert.equal((await q('SELECT count(*)::int n FROM enrollments WHERE course_id=$1', [nw.id])).rows[0].n, 0);
  // independência: apagar o arquivo da cópia não afeta o original
  await admin.post(`/admin/arquivos/${b[1].id}/excluir`, {}, `/admin/cursos/${nw.id}/arquivos`);
  assert.ok(fs.existsSync(path.join(dir, 'files', a[1].path)), 'original intacto no volume');
  assert.equal((await q('SELECT count(*)::int n FROM product_files WHERE product_id=$1', [src])).rows[0].n, 2);
  // sem a caixa de arquivos: cópia vazia
  const sem = await admin.post('/admin/cursos', base({ product_type: 'download', title: 'E-book 3', slug: 'ebook-3', copy_from: String(src) }), `/admin/cursos/${src}/duplicar`);
  assert.equal(sem.status, 303);
  assert.equal((await q("SELECT count(*)::int n FROM product_files pf JOIN courses c ON c.id=pf.product_id WHERE c.slug='ebook-3'")).rows[0].n, 0);
  // o original continua igual
  assert.equal((await q("SELECT title, status FROM courses WHERE id=$1", [src])).rows[0].title, 'E-book 1');
  // duplicar o que não existe
  assert.equal((await admin.get('/admin/cursos/999999/duplicar')).status, 404);
});

test('duplicar curso: módulos, aulas e anexos (sem provas); desmarcar anexos', async () => {
  assert.equal((await admin.post('/admin/cursos', base({ product_type: 'course', title: 'Curso A', slug: 'curso-a' }), '/admin/cursos/novo?tipo=curso')).status, 303);
  const src = (await q("SELECT id FROM courses WHERE slug='curso-a'")).rows[0].id;
  const m = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'Módulo 1',1) RETURNING id", [src])).rows[0].id;
  const l1 = (await q("INSERT INTO lessons (course_id, module_id, title, description, youtube_id, duration_min, position) VALUES ($1,$2,'Aula 1','Texto','dQw4w9WgXcQ',12,1) RETURNING id", [src, m])).rows[0].id;
  await q("INSERT INTO lessons (course_id, module_id, title, position, active) VALUES ($1,$2,'Aula 2 inativa',2,false)", [src, m]);
  assert.equal((await admin.upload(`/admin/aulas/${l1}/arquivos`, { label: 'Apostila', armazenamento: 'db' }, { name: 'ap.pdf', buffer: PDF, type: 'application/pdf' }, { csrfFrom: `/admin/cursos/${src}/conteudo` })).status, 303);
  const form = await admin.get(`/admin/cursos/${src}/duplicar`); assert.match(form.text, /Duplicar curso/); assert.match(form.text, /1 módulo e 2 aulas/); assert.match(form.text, /1 anexo/);
  const ok = await admin.post('/admin/cursos', base({ product_type: 'course', title: 'Curso B', slug: 'curso-b', copy_from: String(src), copy_files: '1' }), `/admin/cursos/${src}/duplicar`);
  assert.equal(ok.status, 303); assert.match(ok.location, /\/conteudo$/);
  const nw = (await q("SELECT id, status FROM courses WHERE slug='curso-b'")).rows[0]; assert.equal(nw.status, 'draft');
  const ls = (await q('SELECT l.*, m.title AS mt FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.course_id=$1 ORDER BY l.position', [nw.id])).rows;
  assert.equal(ls.length, 2); assert.equal(ls[0].mt, 'Módulo 1'); assert.equal(ls[0].youtube_id, 'dQw4w9WgXcQ'); assert.equal(ls[0].duration_min, 12); assert.equal(ls[1].active, false);
  assert.notEqual(ls[0].id, l1); assert.equal((await q('SELECT count(*)::int n FROM lesson_files WHERE lesson_id=$1', [ls[0].id])).rows[0].n, 1);
  // sem anexos
  assert.equal((await admin.post('/admin/cursos', base({ product_type: 'course', title: 'Curso C', slug: 'curso-c', copy_from: String(src) }), `/admin/cursos/${src}/duplicar`)).status, 303);
  const c3 = (await q("SELECT id FROM courses WHERE slug='curso-c'")).rows[0].id;
  assert.equal((await q('SELECT count(*)::int n FROM lessons WHERE course_id=$1', [c3])).rows[0].n, 2);
  assert.equal((await q('SELECT count(*)::int n FROM lesson_files lf JOIN lessons l ON l.id=lf.lesson_id WHERE l.course_id=$1', [c3])).rows[0].n, 0);
  // o original tem 1 anexo e continua com ele
  assert.equal((await q('SELECT count(*)::int n FROM lesson_files lf JOIN lessons l ON l.id=lf.lesson_id WHERE l.course_id=$1', [src])).rows[0].n, 1);
});

test('caixas de seleção: um padrão único no CSS e o aniversário só diz "Opcional."', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
  assert.match(css, /\.field label\.chk/); assert.match(css, /\.field input\[type=checkbox\]/);
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'app.js'), 'utf8');
  assert.match(app, /note: 'Opcional\.'/); assert.doesNotMatch(app, /lembrar do seu aniversário/);
});
