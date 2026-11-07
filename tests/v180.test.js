'use strict';
// 1.8.0 · Simulador de comissão: só administrador, não grava nada, mesma regra de cálculo das vendas.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const A = require('../src/affiliates');

let t; let admin;
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';
before(async () => {
  t = await boot(); admin = await adminReady(t);
  await t.pool.query("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy','affiliate')", [LONG]);
  await t.pool.query("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING");
});
after(async () => { await t.close(); });

test('botão e janela aparecem para o administrador em Afiliados', async () => {
  const h = (await admin.get('/admin/afiliados')).text;
  assert.match(h, /data-modal-open="sim-modal"[^>]*>Simulação</);
  for (const id of ['sim-v', 'sim-d', 'sim-a', 'sim-paid', 'sim-com', 'sim-plat']) assert.match(h, new RegExp(`id="${id}"`));
  assert.match(h, /Valor do produto para a plataforma/); assert.match(h, /\/static\/js\/simulador\.js/);
  assert.doesNotMatch(h.match(/<dialog id="sim-modal"[\s\S]*?<\/dialog>/)[0], /<form|method="post"/); // sem formulário: nada é enviado
});

test('aluno e visitante não veem o simulador', async () => {
  const s = await makeStudent(t, { email: 'sim@example.com', name: 'Sim' });
  const b = new Browser(t.base); await b.login(s.email, s.password);
  const r = await b.get('/admin/afiliados'); assert.doesNotMatch(r.text || '', /sim-modal/);
  const a = await new Browser(t.base).get('/admin/afiliados'); assert.doesNotMatch(a.text || '', /sim-modal/);
});

test('abrir a tela não grava nada', async () => {
  const c = async () => (await t.pool.query('SELECT (SELECT count(*) FROM commissions) c, (SELECT count(*) FROM coupons) k, (SELECT count(*) FROM affiliates) a, (SELECT count(*) FROM audit_log) l')).rows[0];
  const before_ = await c(); await admin.get('/admin/afiliados'); assert.deepEqual(await c(), before_);
});

test('o cálculo do simulador (JS da tela) bate com a regra real', () => {
  const src = fs.readFileSync(require.resolve('../public/js/simulador.js'), 'utf8');
  const els = {};
  const el = (id) => (els[id] ||= { value: '', textContent: '', hidden: true, addEventListener(_, f) { this.f = f; } });
  for (const id of ['sim-v', 'sim-d', 'sim-a']) { const e = el(id); e.setAttribute = () => {}; e.removeAttribute = () => {}; }
  new Function('document', src)({ getElementById: (id) => el(id) });
  const norm = (x) => x.replace(/\s/g, ' ');
  const run = (v, d, a) => { el('sim-v').value = v; el('sim-d').value = d; el('sim-a').value = a; el('sim-v').f();
    return { paid: norm(el('sim-paid').textContent), com: norm(el('sim-com').textContent), plat: norm(el('sim-plat').textContent), warn: !el('sim-msg').hidden }; };
  assert.deepEqual(run('249,90', '10', '20'), { paid: 'R$ 224,91', com: 'R$ 44,98', plat: 'R$ 179,93', warn: false });
  assert.equal(A.commissionOf(22491, 20), 4498); // mesma conta das vendas reais
  assert.deepEqual(run('1.000,00', '0', '12,5'), { paid: 'R$ 1.000,00', com: 'R$ 125,00', plat: 'R$ 875,00', warn: false });
  assert.deepEqual(run('100', '100', '30'), { paid: 'R$ 0,00', com: 'R$ 0,00', plat: 'R$ 0,00', warn: true });
  assert.equal(run('1.000', '0', '10').paid, 'R$ 1.000,00'); assert.equal(run('1.234.567,50', '0', '10').paid, 'R$ 1.234.567,50');
  assert.equal(run('249.90', '0', '10').paid, 'R$ 249,90'); // ponto decimal digitado à moda inglesa
  assert.equal(run('-5', '0', '10').warn, true); assert.equal(run('abc', '0', '10').warn, true); assert.equal(run('100', '12,5', '10').warn, true);
  assert.equal(run('100', '10', '150').warn, true);
  assert.equal(run('', 'abc', '').paid, 'R$ 0,00');
});

test('regra pura: percentuais quebrados e 0%', () => {
  assert.equal(A.commissionOf(22491, 12.5), Math.round(22491 * 0.125));
  assert.equal(A.commissionOf(22491, 0), 0);
  assert.equal(A.commissionOf(0, 30), 0);
});
