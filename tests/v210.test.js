'use strict';
// 2.1.0 (etapa 2) · EvoLumen Analytics: aviso de cookies, página pública do Aviso e rodapé.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const A = require('../src/analytics');

let on; let admin;
before(async () => { on = await boot({ ANALYTICS_ENABLED: '1' }); admin = await adminReady(on); });
after(async () => { await on.close(); });

test('página pública do Aviso: acessível sem login, com tabela de cookies e controle', async () => {
  const r = await new Browser(on.base).get('/aviso-de-privacidade-e-cookies');
  assert.equal(r.status, 200);
  for (const t of ['Aviso de Privacidade e Cookies', 'ea_v', 'ea_s', '13 meses', 'não guardamos o seu endereço de rede', 'legítimo interesse', 'data-ea-status', 'data-ea-act="off"', 'data-ea-act="on"', '/privacidade']) assert.ok(r.text.includes(t), t);
  assert.doesNotMatch(r.text, /<script>[^<]/); // sem script inline (CSP)
});

test('faixa de aviso e script presentes quando a medição está ligada, e fora do painel do administrador', async () => {
  const home = (await new Browser(on.base).get('/')).text;
  assert.match(home, /data-ea-banner/); assert.match(home, /\/static\/js\/aviso\.js/); assert.match(home, /Não quero ser medido/); assert.match(home, /href="\/aviso-de-privacidade-e-cookies"/);
  const adm = (await admin.get('/admin')).text; assert.doesNotMatch(adm, /data-ea-banner|aviso\.js/);
});

test('rodapé leva ao Aviso; sem medição ligada não há faixa nem script', async () => {
  const home = (await new Browser(on.base).get('/')).text;
  assert.match(home, /<a href="\/aviso-de-privacidade-e-cookies">Cookies<\/a>/);
});

test('arquivos do navegador: aviso.js e o CSS existem e passam na sintaxe', () => {
  const js = fs.readFileSync(__dirname + '/../public/js/aviso.js', 'utf8');
  new Function(js); // sintaxe
  for (const k of ['ea_ok', 'ea_off', 'ea_v', 'ea_s', 'globalPrivacyControl', 'data-ea-act']) assert.ok(js.includes(k), k);
  assert.doesNotMatch(js, /google|gtag|analytics\.js/i);
  assert.match(fs.readFileSync(__dirname + '/../public/css/app.css', 'utf8'), /\.ea-banner/);
});

test('landing: documento com a linha do script e o texto do aviso', () => {
  const d = fs.readFileSync(__dirname + '/../docs/analytics-landing.md', 'utf8');
  assert.ok(d.includes('<script src="https://evolumen.ericktorritezi.com.br/static/js/ea.js" defer></script>'));
  assert.ok(d.includes('aviso-de-privacidade-e-cookies'));
});

test('recusar apaga as visitas já registradas e solta o vínculo nos pedidos', async () => {
  const q = (s, p) => on.pool.query(s, p); const v = 'zzzz0000000000000001'; const s = 'zzzz0000000000000002';
  await q('INSERT INTO an_visitors (visitor_id) VALUES ($1)', [v]);
  await q("INSERT INTO an_sessions (id, visitor_id, site) VALUES ($1,$2,'plataforma')", [s, v]);
  await q("INSERT INTO an_pageviews (session_id, visitor_id, site, path) VALUES ($1,$2,'plataforma','/')", [s, v]);
  const r = await fetch(on.base + '/ea/c', { method: 'POST', headers: { origin: 'http://localhost:3000', 'user-agent': 'Mozilla/5.0 Chrome/120' }, body: JSON.stringify({ x: 1, v, s }) });
  assert.equal(r.status, 204);
  for (const tb of ['an_pageviews', 'an_sessions', 'an_visitors']) assert.equal((await q(`SELECT count(*)::int n FROM ${tb} WHERE visitor_id = $1`, [v])).rows[0].n, 0, tb);
  assert.equal((await fetch(on.base + '/ea/c', { method: 'POST', headers: { origin: 'https://estranho.com' }, body: JSON.stringify({ x: 1, v }) })).status, 403);
  assert.equal(typeof A.forget, 'function');
});

test('LGPD: exportar e excluir a conta também cobre as visitas ao site', async () => {
  const L = require('../src/lgpd'); const q = (s, p) => on.pool.query(s, p);
  const st = await makeStudent(on, { email: 'lgpd.visitas@example.com', name: 'Aluno Visitas' });
  const v = 'yyyy0000000000000001'; const s = 'yyyy0000000000000002';
  await q('INSERT INTO an_visitors (visitor_id) VALUES ($1)', [v]);
  await q("INSERT INTO an_sessions (id, visitor_id, site, user_id, entry_path) VALUES ($1,$2,'plataforma',$3,'/meus-cursos')", [s, v, st.id]);
  await q("INSERT INTO an_pageviews (session_id, visitor_id, site, path) VALUES ($1,$2,'plataforma','/meus-cursos')", [s, v]);
  const ex = await L.exportFor(st.id); assert.equal(ex.visitas_ao_site.length, 1); assert.equal(ex.visitas_ao_site[0].entry_path, '/meus-cursos');
  await L.anonymize(st.id);
  for (const tb of ['an_pageviews', 'an_sessions', 'an_visitors']) assert.equal((await q(`SELECT count(*)::int n FROM ${tb} WHERE visitor_id = $1`, [v])).rows[0].n, 0, tb);
});

test('ea.js: não mede sem cookies e usa só o cookie para a recusa', () => {
  const js = fs.readFileSync(__dirname + '/../public/js/ea.js', 'utf8');
  assert.match(js, /cookies bloqueados/); assert.doesNotMatch(js, /localStorage/);
  assert.doesNotMatch(fs.readFileSync(__dirname + '/../public/js/aviso.js', 'utf8'), /localStorage/);
});

test('texto do Aviso: IP, cookies de segurança e direitos', async () => {
  const r = (await new Browser(on.base).get('/aviso-de-privacidade-e-cookies')).text;
  for (const t of ['Na medição de visitas não guardamos o seu endereço de rede', 'evl_a', 'Até 30 dias', 'se opor', 'aria-live="polite"', 'Quem é o responsável', 'Erick Torritezi', 'erick.torritezi@gmail.com', '(11) 94985-1250']) assert.ok(r.includes(t), t);
  assert.doesNotMatch(r, /280\.?758/); // CPF não é publicado
  assert.doesNotMatch(r, /Não guardamos o seu endereço de rede \(IP\)<\/b>, não lemos/);
  assert.match(fs.readFileSync(__dirname + '/../public/css/app.css', 'utf8'), /\.btn\[hidden\]\{display:none!important\}/);
});

test('medição desligada: sem faixa e sem script, e a página explica sem controle', async () => {
  const off = await boot();
  try {
    const home = (await new Browser(off.base).get('/')).text; assert.doesNotMatch(home, /data-ea-banner|aviso\.js|ea\.js/);
    const p = await new Browser(off.base).get('/aviso-de-privacidade-e-cookies'); assert.equal(p.status, 200); assert.doesNotMatch(p.text, /data-ea-act/);
  } finally { await off.close(); }
});
