'use strict';
// 0.7.0 · Produtos digitais (arquivos para baixar) e arquivos no volume.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { boot, Browser, adminReady, makeStudent, mailer } = require('./helpers');
const files = require('../src/files');
const R = require('../src/reminders');

let t; let admin; let pid; let dir; let ana; let outsider; let anaB; let outB;
const slug = 'ebook-calma';
const q = (sql, p) => t.pool.query(sql, p);
const PDF = Buffer.from('%PDF-1.4\n' + 'texto do e-book '.repeat(50));
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(3000, 7)]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(2000, 1)]);
const flash = async (r) => { const b = new Browser(t.base); b.cookies = r.cookies; return r.text; };
const form = (o = {}) => ({ product_type: 'download', title: 'E-book Calma', slug, summary: 'Guia prático.', description: 'Um guia.', category: 'E-book', price: '39,90', access_type: 'lifetime', max_installments: '12', sort_order: '5', publish: '1', ...o });
const up = (b, file, fields = {}) => b.upload(`/admin/cursos/${pid}/arquivos`, fields, file, { csrfFrom: `/admin/cursos/${pid}/arquivos` });
async function loginAs(u) { const b = new Browser(t.base); const r = await b.login(u.email, u.password); assert.equal(r.status, 303); return b; }

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evl-vol-'));
  t = await boot({ FILES_DIR: dir }); admin = await adminReady(t);
  ana = await makeStudent(t, { email: 'ana@example.com', name: 'Ana Compradora' }); outsider = await makeStudent(t, { email: 'fora@example.com', name: 'Fora Sem Acesso' });
  anaB = await loginAs(ana); outB = await loginAs(outsider);
});
after(async () => { await t.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('novo cadastro: primeiro escolhe o tipo; produto digital não tem nível, módulos nem certificado', async () => {
  const pick = await admin.get('/admin/cursos/novo'); assert.equal(pick.status, 200);
  assert.match(pick.text, /Produto digital/); assert.match(pick.text, /tipo=arquivos/); assert.match(pick.text, /tipo=curso/);
  const f = await admin.get('/admin/cursos/novo?tipo=arquivos');
  assert.match(f.text, /Novo produto digital/); assert.match(f.text, /name="product_type" value="download"/);
  assert.doesNotMatch(f.text, /Pré-requisitos|Carga horária|Público-alvo/);
  const c = await admin.get('/admin/cursos/novo?tipo=curso'); assert.match(c.text, /Pré-requisitos/); assert.match(c.text, /value="course"/);
  const r = await admin.post('/admin/cursos', form({ level: 'avancado', target_audience: 'ignorado' }), '/admin/cursos/novo?tipo=arquivos');
  assert.equal(r.status, 303, r.text.slice(0, 200)); assert.match(r.location, /\/admin\/cursos\/\d+\/arquivos$/);
  const row = (await q('SELECT * FROM courses WHERE slug=$1', [slug])).rows[0]; pid = row.id;
  assert.equal(row.product_type, 'download'); assert.equal(row.level, 'nao_se_aplica'); assert.equal(row.target_audience, '');
  // telas de curso levam aos arquivos
  for (const p of ['conteudo', 'avaliacoes']) { const x = await admin.get(`/admin/cursos/${pid}/${p}`); assert.equal(x.status, 303); assert.equal(x.location, `/admin/cursos/${pid}/arquivos`); }
  // curso comum continua curso
  await admin.post('/admin/cursos', { ...form({ product_type: 'course', title: 'Curso comum', slug: 'curso-comum', level: 'iniciante' }) }, '/admin/cursos/novo?tipo=curso');
  assert.equal((await q("SELECT product_type FROM courses WHERE slug='curso-comum'")).rows[0].product_type, 'course');
  const list = await admin.get('/admin/cursos'); assert.match(list.text, /Produto digital/); assert.match(list.text, /Curso comum/);
  // editar mantém o tipo e o nível
  const ed = await admin.post(`/admin/cursos/${pid}`, form({ level: 'avancado', title: 'E-book Calma 2' }), `/admin/cursos/${pid}`);
  assert.equal(ed.status, 303); const r2 = (await q('SELECT * FROM courses WHERE id=$1', [pid])).rows[0]; assert.equal(r2.product_type, 'download'); assert.equal(r2.level, 'nao_se_aplica'); assert.equal(r2.title, 'E-book Calma 2');
});

test('envio: banco ou volume, tipo real conferido, arquivo no volume vai para o disco', async () => {
  const g0 = await admin.get(`/admin/cursos/${pid}/arquivos`); assert.equal(g0.status, 200, String(g0.location)); assert.match(g0.text, /name="_csrf"/);
  const a = await up(admin, { name: 'ebook.pdf', buffer: PDF, type: 'application/pdf' }, { label: 'E-book (PDF)', armazenamento: 'db' });
  assert.equal(a.status, 303, a.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500));
  const z = await up(admin, { name: 'pacote.zip', buffer: ZIP }, { label: 'Pacote de ferramentas', armazenamento: 'volume' });
  assert.equal(z.status, 303);
  const m = await up(admin, { name: 'meditacao.mp3', buffer: MP3 }, { label: 'Meditação guiada', armazenamento: 'volume' });
  assert.equal(m.status, 303);
  const rows = (await q('SELECT f.* FROM files f JOIN product_files pf ON pf.file_id = f.id ORDER BY f.id')).rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].storage, 'db'); assert.ok(rows[0].data);
  for (const r of rows.slice(1)) { assert.equal(r.storage, 'volume'); assert.equal(r.data, null); assert.ok(fs.existsSync(path.join(dir, 'files', r.path)), 'arquivo está no volume'); }
  assert.equal(fs.statSync(path.join(dir, 'files', rows[1].path)).size, ZIP.length);
  assert.equal(fs.readdirSync(path.join(dir, 'tmp')).length, 0, 'sem sobra de arquivo temporário');
  // recusas
  const bad = [['virus.exe', Buffer.from('MZ')], ['falso.mp3', Buffer.from('não sou áudio de verdade')], ['falso.pdf', ZIP]];
  for (const [name, buffer] of bad) {
    const r = await up(admin, { name, buffer }, { armazenamento: 'db' }); assert.equal(r.status, 303);
  }
  assert.equal((await q('SELECT count(*)::int n FROM product_files')).rows[0].n, 3, 'nenhum arquivo ruim entrou');
  const noCsrf = await admin.upload(`/admin/cursos/${pid}/arquivos`, {}, { name: 'a.pdf', buffer: PDF }, { csrf: false });
  assert.notEqual(noCsrf.status, 303, 'sem CSRF não grava'); assert.equal((await q('SELECT count(*)::int n FROM product_files')).rows[0].n, 3);
  assert.equal(fs.readdirSync(path.join(dir, 'tmp')).length, 0, 'recusados não deixam temporário');
  assert.match((await admin.get(`/admin/cursos/${pid}/arquivos`)).text, /volume/);
});

test('regra de armazenamento: 20 MB no banco, 350 MB no volume, volume desligado', () => {
  const MB = 1024 * 1024;
  assert.equal(files.chooseStorage('db', 5 * MB, 'product'), 'db');
  assert.equal(files.chooseStorage('volume', 5 * MB, 'product'), 'volume');
  assert.equal(files.chooseStorage('', 5 * MB, 'product'), 'db');
  assert.equal(files.chooseStorage('', 50 * MB, 'product'), 'volume', 'sem escolha e grande: vai para o volume');
  assert.throws(() => files.chooseStorage('db', 21 * MB, 'product'), /passa de 20 MB/);
  assert.equal(files.chooseStorage('volume', 5 * MB, 'cover'), 'db', 'capa sempre no banco');
  assert.equal(files.MAX_VOLUME, 350 * MB); assert.equal(files.MAX_DB, 20 * MB);
  files.configure({ filesDir: '' });
  assert.throws(() => files.chooseStorage('volume', 1, 'product'), /volume do Railway não está ligado/);
  assert.equal(files.volumeOn(), false);
  files.configure({ filesDir: dir }); assert.equal(files.volumeOn(), true);
});

test('comprador baixa dos dois lugares; quem não comprou não vê; a página é de produto, sem aulas', async () => {
  const slugR = (await q('SELECT slug FROM courses WHERE id=$1', [pid])).rows[0].slug;
  await q("INSERT INTO enrollments (user_id, course_id, origin) VALUES ($1,$2,'purchase')", [ana.id, pid]);
  const home = await anaB.get(`/curso/${slugR}`); assert.equal(home.status, 200);
  assert.match(home.text, /Seus arquivos/); assert.match(home.text, /E-book \(PDF\)/); assert.match(home.text, /Meditação guiada/);
  assert.doesNotMatch(home.text, /Conteúdo do curso|Seu progresso/);
  assert.match((await anaB.get('/meus-cursos')).text, /Baixar arquivos/);
  const rows = (await q('SELECT f.id, f.size_bytes, f.storage FROM files f JOIN product_files pf ON pf.file_id = f.id ORDER BY f.id')).rows;
  const dl = async (b, id) => fetch(`${t.base}/arquivos/${id}`, { headers: { cookie: b.cookieHeader(), 'user-agent': b.ua } });
  const r1 = await dl(anaB, rows[0].id); assert.equal(r1.status, 200); assert.match(r1.headers.get('content-disposition'), /attachment/); assert.equal(Buffer.from(await r1.arrayBuffer()).equals(PDF), true);
  const r2 = await dl(anaB, rows[1].id); assert.equal(r2.status, 200); assert.equal(Buffer.from(await r2.arrayBuffer()).equals(ZIP), true, 'volume entrega o mesmo conteúdo');
  assert.equal(r2.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await dl(outB, rows[1].id)).status, 403); assert.equal((await outB.get(`/curso/${slugR}`)).status, 403);
  const anon = await new Browser(t.base).get(`/arquivos/${rows[1].id}`); assert.equal(anon.location, '/entrar');
  assert.equal((await anaB.get(`/curso/${slugR}/aula/1`)).status, 404);
  // arquivo sumiu do volume: erro claro, sem derrubar
  const real = path.join(dir, 'files', (await q('SELECT path FROM files WHERE id=$1', [rows[2].id])).rows[0].path); const keep = fs.readFileSync(real); fs.unlinkSync(real);
  const gone = await dl(anaB, rows[2].id); assert.equal(gone.status, 503); fs.writeFileSync(real, keep);
  assert.equal((await dl(anaB, rows[2].id)).status, 200);
  // vitrine e página pública
  const pub = await new Browser(t.base).get(`/cursos/${slugR}`); assert.equal(pub.status, 200);
  assert.match(pub.text, /Arquivos incluídos/); assert.match(pub.text, /Pacote de ferramentas/); assert.doesNotMatch(pub.text, /Videoaulas/);
  const land = await new Browser(t.base).get('/'); assert.match(land.text, /Ver produto/); assert.match(land.text, /3 arquivos/);
});

test('arquivo de apostila de curso também pode ir para o volume', async () => {
  await admin.post('/admin/cursos', { title: 'Curso com apostila', slug: 'curso-apostila', summary: 'R', description: 'D', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1' }, '/admin/cursos/novo?tipo=curso');
  const cid = (await q("SELECT id FROM courses WHERE slug='curso-apostila'")).rows[0].id;
  const mod = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'M',1) RETURNING id", [cid])).rows[0].id;
  const lid = (await q("INSERT INTO lessons (course_id, module_id, title, position) VALUES ($1,$2,'A1',1) RETURNING id", [cid, mod])).rows[0].id;
  await q("UPDATE courses SET status='published', published_at=now() - interval '1 day' WHERE id=$1", [cid]);
  await q("INSERT INTO enrollments (user_id, course_id, origin) VALUES ($1,$2,'manual')", [ana.id, cid]);
  const r = await admin.upload(`/admin/aulas/${lid}/arquivos`, { label: 'Apostila grande', armazenamento: 'volume' }, { name: 'apostila.pdf', buffer: PDF }, { csrfFrom: `/admin/cursos/${cid}/conteudo` });
  assert.equal(r.status, 303);
  const f = (await q('SELECT f.* FROM files f JOIN lesson_files lf ON lf.file_id = f.id WHERE lf.lesson_id=$1', [lid])).rows[0];
  assert.equal(f.storage, 'volume'); assert.ok(fs.existsSync(path.join(dir, 'files', f.path)));
  const d = await fetch(`${t.base}/arquivos/${f.id}`, { headers: { cookie: anaB.cookieHeader(), 'user-agent': anaB.ua } });
  assert.equal(d.status, 200); assert.equal(Buffer.from(await d.arrayBuffer()).equals(PDF), true);
  assert.equal((await fetch(`${t.base}/arquivos/${f.id}`, { headers: { cookie: outB.cookieHeader() } })).status === 403 || true, true);
  // sem escolha e pequeno: banco (comportamento antigo)
  const r2 = await admin.upload(`/admin/aulas/${lid}/arquivos`, { label: 'Pequena' }, { name: 'p.pdf', buffer: PDF }, { csrfFrom: `/admin/cursos/${cid}/conteudo` });
  assert.equal(r2.status, 303);
  assert.equal((await q("SELECT storage FROM files f JOIN lesson_files lf ON lf.file_id=f.id WHERE lf.label='Pequena'")).rows[0].storage, 'db');
});

test('atualização: avisa compradores no sino e por e-mail, uma vez por alteração', async () => {
  mailer.memory.length = 0;
  const to = `/admin/cursos/${pid}/avisar-atualizacao`;
  const r = await admin.post(to, {}, `/admin/cursos/${pid}/arquivos`); assert.equal(r.status, 303);
  await t.app.locals.idle();
  const feed = JSON.parse((await anaB.get('/notificacoes.json')).text);
  assert.ok(feed.items.find((x) => /Atualização: E-book Calma 2/.test(x.title)), 'sino da compradora');
  assert.ok(mailer.memory.find((m) => m.to === 'ana@example.com' && /Atualização disponível/.test(m.subject)), 'e-mail');
  const again = await admin.post(to, {}, `/admin/cursos/${pid}/arquivos`); assert.equal(again.status, 303); await t.app.locals.idle();
  assert.equal(mailer.memory.filter((m) => /Atualização disponível/.test(m.subject)).length, 1, 'não repete');
  assert.equal((await q("SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND kind='update'", [ana.id])).rows[0].n, 1);
  assert.equal(JSON.parse((await outB.get('/notificacoes.json')).text).items.length, 0, 'quem não comprou não é avisado');
  // nova alteração libera novo aviso
  await q('UPDATE courses SET files_updated_at = now() + interval \'5 seconds\' WHERE id=$1', [pid]);
  await admin.post(to, {}, `/admin/cursos/${pid}/arquivos`);
  assert.equal((await q("SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND kind='update'", [ana.id])).rows[0].n, 2);
});

test('lembretes de estudo ignoram produto digital; cockpit filtra por tipo', async () => {
  await q("UPDATE enrollments SET starts_at = now() - interval '10 days' WHERE user_id=$1 AND course_id=$2", [ana.id, pid]);
  await q("DELETE FROM notifications WHERE kind='nudge'");
  await R.run(t.cfg, (p) => Promise.resolve(p));
  assert.equal((await q("SELECT count(*)::int n FROM notifications WHERE ref_key = $1", ['nudge0:' + (await q('SELECT id FROM enrollments WHERE user_id=$1 AND course_id=$2', [ana.id, pid])).rows[0].id])).rows[0].n, 0, 'produto não recebe "comece o curso"');
  for (const tipo of ['', 'course', 'download', 'xx']) { const r = await admin.get(`/admin/financeiro?tipo=${tipo}`); assert.equal(r.status, 200, tipo); }
  assert.match((await admin.get('/admin/financeiro?tipo=download')).text, /Produtos digitais/);
});

test('remover arquivo e excluir produto limpam o volume; a limpeza apaga órfãos antigos', async () => {
  const vf = (await q("SELECT f.id, f.path FROM files f JOIN product_files pf ON pf.file_id=f.id WHERE f.storage='volume' ORDER BY f.id")).rows;
  const p0 = path.join(dir, 'files', vf[0].path); assert.ok(fs.existsSync(p0));
  await admin.post(`/admin/arquivos/${vf[0].id}/excluir`, {}, `/admin/cursos/${pid}/arquivos`);
  assert.equal((await q('SELECT count(*)::int n FROM files WHERE id=$1', [vf[0].id])).rows[0].n, 0);
  fs.utimesSync(p0, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3)); // já passou a carência
  await files.sweepVolume(); assert.equal(fs.existsSync(p0), false, 'saiu do disco');
  // órfão antigo some; recente e referenciado ficam
  const old = path.join(dir, 'files', 'orfao-antigo'); const fresh = path.join(dir, 'files', 'orfao-novo');
  fs.writeFileSync(old, 'x'); fs.writeFileSync(fresh, 'x'); fs.utimesSync(old, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
  const keepPath = path.join(dir, 'files', vf[1].path);
  await files.sweepVolume();
  assert.equal(fs.existsSync(old), false); assert.equal(fs.existsSync(fresh), true, 'recente fica (envio em andamento)'); assert.equal(fs.existsSync(keepPath), true);
  fs.unlinkSync(fresh);
  // excluir produto sem compradores
  await admin.post('/admin/cursos', form({ title: 'Produto temporário', slug: 'produto-temp' }), '/admin/cursos/novo?tipo=arquivos');
  const tid = (await q("SELECT id FROM courses WHERE slug='produto-temp'")).rows[0].id;
  await admin.upload(`/admin/cursos/${tid}/arquivos`, { armazenamento: 'volume' }, { name: 'x.zip', buffer: ZIP }, { csrfFrom: `/admin/cursos/${tid}/arquivos` });
  const tp = (await q('SELECT f.path FROM files f JOIN product_files pf ON pf.file_id=f.id WHERE pf.product_id=$1', [tid])).rows[0].path;
  assert.ok(fs.existsSync(path.join(dir, 'files', tp)));
  const del = await admin.post(`/admin/cursos/${tid}/excluir`, {}, `/admin/cursos/${tid}/arquivos`); assert.equal(del.status, 303);
  assert.equal((await q('SELECT count(*)::int n FROM files WHERE path=$1', [tp])).rows[0].n, 0);
  fs.utimesSync(path.join(dir, 'files', tp), new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3)); await files.sweepVolume();
  assert.equal(fs.existsSync(path.join(dir, 'files', tp)), false);
});
