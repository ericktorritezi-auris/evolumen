'use strict';
// 1.1.0 · Descrição completa com editor formatado (títulos, listas, negrito, link), sem quebrar as descrições antigas.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, Browser, adminReady } = require('./helpers');

let t; let admin;
const q = (sql, p) => t.pool.query(sql, p);
const base = (o = {}) => ({ title: 'Curso Formatado', slug: 'curso-formatado', summary: 'Resumo.', price: '49,90', access_type: 'lifetime', max_installments: '3', sort_order: '2', level: 'iniciante', ...o });
const publish = (slug) => q("UPDATE courses SET status='published', published_at = now() - interval '1 day' WHERE slug = $1", [slug]);

before(async () => { t = await boot(); admin = await adminReady(t); });
after(async () => { await t.close(); });

test('descrição antiga (texto simples) continua igual na página pública e aparece no editor', async () => {
  await q("INSERT INTO courses (title, slug, summary, description, price_cents, level, access_type, status, published_at) VALUES ('Antigo','antigo','r','Primeiro parágrafo\n\nSegundo parágrafo <b>x</b>',1000,'iniciante','lifetime','published', now() - interval '1 day')");
  const pub = await new Browser(t.base).get('/cursos/antigo');
  assert.match(pub.text, /<p>Primeiro parágrafo<\/p>/); assert.match(pub.text, /<p>Segundo parágrafo &lt;b&gt;x&lt;\/b&gt;<\/p>/); assert.doesNotMatch(pub.text, /class="desc"/);
  const id = (await q("SELECT id FROM courses WHERE slug='antigo'")).rows[0].id;
  const ed = await admin.get(`/admin/cursos/${id}`); assert.equal(ed.status, 200);
  assert.match(ed.text, /data-editor/); assert.match(ed.text, /name="description_html"/); assert.match(ed.text, /formatBlock:h2/);
  assert.match(ed.text, /<p>Primeiro parágrafo<\/p><p>Segundo parágrafo &lt;b&gt;x&lt;\/b&gt;<\/p>/);
});

test('salvar com formatação: HTML limpo na página, texto simples guardado, nada perigoso passa', async () => {
  const html = '<h2>O que você vai aprender</h2><h3>Para quem é</h3><p>Texto com <strong>negrito</strong> e <em>itálico</em>.</p><ul><li>Item um</li><li>Item dois</li></ul><p><a href="https://exemplo.com/x" onclick="alert(1)">Link</a> <a href="javascript:alert(1)">ruim</a></p><script>alert(1)</script><p style="color:red" onmouseover="x()">Fim</p><img src="x" onerror="alert(1)">';
  const r = await admin.post('/admin/cursos', base({ description_html: html }), '/admin/cursos/novo');
  assert.equal(r.status, 303, r.text.slice(0, 300));
  const c = (await q("SELECT * FROM courses WHERE slug='curso-formatado'")).rows[0];
  assert.match(c.description_html, /<h2>O que você vai aprender<\/h2>/); assert.match(c.description_html, /<ul><li>Item um<\/li><li>Item dois<\/li><\/ul>/);
  assert.doesNotMatch(c.description_html, /script|onclick|onmouseover|onerror|javascript:|style=|<img/);
  assert.match(c.description_html, /<a href="https:\/\/exemplo\.com\/x" target="_blank" rel="noopener noreferrer">Link<\/a>/);
  assert.match(c.description, /O que você vai aprender/); assert.match(c.description, /Item um/); assert.doesNotMatch(c.description, /<|script/);
  await publish('curso-formatado');
  const pub = await new Browser(t.base).get('/cursos/curso-formatado');
  assert.match(pub.text, /<div class="desc"><h2>O que você vai aprender<\/h2>/); assert.match(pub.text, /<li>Item dois<\/li>/); assert.match(pub.text, /<strong>negrito<\/strong>/);
  assert.doesNotMatch(pub.text, /alert\(1\)|onclick|javascript:/);
  // o editor reabre com o que foi salvo
  const ed = await admin.get(`/admin/cursos/${c.id}`); assert.match(ed.text, /<h3>Para quem é<\/h3>/);
});

test('editor vazio limpa; texto longo demais é recusado; sem editor (sem JavaScript) vale o texto simples', async () => {
  const c = (await q("SELECT * FROM courses WHERE slug='curso-formatado'")).rows[0];
  const upd = (o) => admin.post(`/admin/cursos/${c.id}`, base({ ...o }), `/admin/cursos/${c.id}`);
  const long = await upd({ description_html: '<h2>Título que fica</h2><p>' + 'a'.repeat(6100) + '</p>' });
  assert.equal(long.status, 422); assert.match(long.text, /passou de 6\.000 letras/);
  assert.match(long.text, /<h2>Título que fica<\/h2>/); // o erro não apaga a formatação do que foi escrito
  // espaços do navegador (&nbsp;) e marcadores não contam como letras
  const spaces = '<h2>T</h2><p>' + 'abc&nbsp;'.repeat(700) + '</p><ul><li>x</li></ul>';
  assert.equal((await upd({ description_html: spaces })).status, 303);
  assert.doesNotMatch((await q('SELECT description FROM courses WHERE id=$1', [c.id])).rows[0].description, /&nbsp;|&amp;/);
  assert.equal((await upd({ description_html: '<h2>O que você vai aprender</h2><ul><li>Item um</li></ul>' })).status, 303);
  assert.match((await q('SELECT description_html FROM courses WHERE id=$1', [c.id])).rows[0].description_html, /O que você vai aprender/); // nada foi trocado
  // sem JavaScript o formulário não manda a descrição: a que já está salva é mantida
  assert.equal((await upd({})).status, 303);
  assert.match((await q('SELECT description_html FROM courses WHERE id=$1', [c.id])).rows[0].description_html, /O que você vai aprender/);
  assert.equal((await upd({ description: 'Só texto\n\nsimples' })).status, 303);
  let row = (await q('SELECT description, description_html FROM courses WHERE id=$1', [c.id])).rows[0];
  assert.equal(row.description_html, ''); assert.match(row.description, /Só texto/);
  assert.equal((await upd({ description_html: '<br>' })).status, 303);
  row = (await q('SELECT description, description_html FROM courses WHERE id=$1', [c.id])).rows[0];
  assert.equal(row.description, ''); assert.equal(row.description_html, '');
  assert.equal((await upd({ description_html: '', desc_js: '1' })).status, 303); // editor esvaziado com JavaScript
  assert.equal((await q('SELECT description_html FROM courses WHERE id=$1', [c.id])).rows[0].description_html, '');
});

test('duplicar leva a descrição formatada; produto digital também tem o editor', async () => {
  const src = (await q("SELECT id FROM courses WHERE slug='curso-formatado'")).rows[0].id;
  assert.equal((await admin.post(`/admin/cursos/${src}`, base({ description_html: '<h2>Título</h2><p>Corpo</p>' }), `/admin/cursos/${src}`)).status, 303);
  const form = await admin.get(`/admin/cursos/${src}/duplicar`); assert.equal(form.status, 200);
  assert.match(form.text, /<h2>Título<\/h2><p>Corpo<\/p>/);
  const ok = await admin.post('/admin/cursos', base({ title: 'Cópia', slug: 'copia-formatada', description_html: '<h2>Título</h2><p>Corpo</p>', copy_from: String(src) }), `/admin/cursos/${src}/duplicar`);
  assert.equal(ok.status, 303, ok.text.slice(0, 200));
  assert.equal((await q("SELECT description_html FROM courses WHERE slug='copia-formatada'")).rows[0].description_html, '<h2>Título</h2><p>Corpo</p>');
  const prod = await admin.get('/admin/cursos/novo?tipo=arquivos'); assert.match(prod.text, /data-editor/); assert.match(prod.text, /name="description_html"/);
});

test('editor dos textos legais continua funcionando e o script do editor serve aos dois', async () => {
  const doc = (await q("SELECT id FROM legal_documents WHERE status='draft' LIMIT 1")).rows[0].id;
  const page = await admin.get(`/admin/textos/${doc}`); assert.match(page.text, /name="body_html"/); assert.match(page.text, /data-editor/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.match(js, /box\.querySelector\('input\[type=hidden\]'\)/);
});
