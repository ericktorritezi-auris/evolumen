'use strict';
// 2.3.1 · Ver página / Ver como aluno viram ícones nas abas do curso.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, adminReady } = require('./helpers');
let t; let admin; let id;
before(async () => {
  t = await boot(); admin = await adminReady(t);
  await t.pool.query("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy','affiliate')", ['<p>' + 'texto longo de teste para publicar. '.repeat(12) + '</p>']);
  await t.pool.query("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING");
  await admin.post('/admin/cursos', { title: 'Curso Abas', slug: 'curso-abas', summary: 'R', description: 'D', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice_days: '30', publish: '1' }, '/admin/cursos/novo');
  id = (await t.pool.query("SELECT id FROM courses WHERE slug='curso-abas'")).rows[0].id;
});
after(async () => { await t.close(); });
test('abas do curso trazem os dois ícones com rótulo e em nova aba', async () => {
  for (const path of ['', '/conteudo', '/avaliacoes', '/atividades', '/matriculas']) {
    const r = await admin.get(`/admin/cursos/${id}${path}`);
    assert.equal(r.status, 200, path);
    assert.match(r.text, /class="tabs__ico" data-tip="Ver página" aria-label="Ver página \(abre em nova aba\)" target="_blank" rel="noopener"/);
    assert.match(r.text, /href="\/cursos\/curso-abas" class="tabs__ico"/); assert.match(r.text, /href="\/curso\/curso-abas" class="tabs__ico" data-tip="Ver como aluno"[^>]*rel="noopener"/);
    assert.doesNotMatch(r.text, /tabs__ext/);
    assert.doesNotMatch(r.text, /Ver página ↗/);
  }
});
