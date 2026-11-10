'use strict';
// 2.0.0 (etapa 1) · EvoLumen Analytics: coleta própria de visitas, origem, aparelho, localização, funil e limpeza de 13 meses.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const A = require('../src/analytics');

const ORIGIN = 'http://localhost:3000'; const LANDING = 'https://masterclass.example.com.br';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_DESK = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
let t; let admin; let course; const slug = 'curso-medido'; let cpfN = 900; let buyerN = 0; let n = 0;
const q = (sql, p) => t.pool.query(sql, p);
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';
const id = (k) => `${k}${String(++n).padStart(20, '0')}`.slice(0, 22);
function genCpf(n) {
  const d = String(100000000 + n * 7919).slice(0, 9).split('').map(Number);
  for (let k = 0; k < 2; k++) { const len = 9 + k; const sum = d.slice(0, len).reduce((a, v, i) => a + v * (len + 1 - i), 0); const r = (sum * 10) % 11; d.push(r === 10 ? 0 : r); }
  return d.join('');
}
const form = (over = {}) => ({ name: 'Bruna Compradora Silva', email: `cliente${++buyerN}@example.com`, phone: '11987654321', cpf: genCpf(++cpfN), cep: '01310100', street: 'Av. Paulista', street_number: '1000', complement: '', district: 'Bela Vista', city: 'São Paulo', state: 'SP', method: 'pix', accept: '1', ...over });
const hit = (body, { origin = ORIGIN, ua = UA, ip = '177.92.10.5' } = {}) => fetch(t.base + '/ea/c', { method: 'POST', headers: { 'content-type': 'text/plain', origin, 'user-agent': ua, 'x-forwarded-for': ip }, body: JSON.stringify(body) });
const ses = (s) => q('SELECT * FROM an_sessions WHERE id = $1', [s]).then((r) => r.rows[0]);

before(async () => {
  t = await boot({ ANALYTICS_ENABLED: '1', ANALYTICS_ORIGINS: LANDING }); admin = await adminReady(t);
  await admin.post('/admin/cursos', { title: 'Curso Medido', slug, summary: 'Resumo.', description: 'Desc', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice_days: '30' }, '/admin/cursos/novo');
  course = (await q('SELECT id FROM courses WHERE slug=$1', [slug])).rows[0].id;
  await q("UPDATE courses SET status='published', published_at=now() - interval '1 day' WHERE id=$1", [course]);
  const mod = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'M',1) RETURNING id", [course])).rows[0].id;
  await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'A',1,'dQw4w9WgXcQ')", [course, mod]);
  await q("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy')", [LONG]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING");
});
after(async () => { try { await t.close(); } catch { /* pool já fechado pelo último teste */ } });

test('classificação: origem, aparelho, robôs, caminho e cupom', () => {
  const own = ['evolumen.example.com', 'masterclass.example.com.br'];
  const c = (o) => A.classify({ ownHosts: own, ...o }).source;
  assert.equal(c({ ref: 'https://l.instagram.com/?u=x' }), 'instagram'); assert.equal(c({ ref: 'https://www.google.com.br/' }), 'google');
  assert.equal(c({ ref: 'https://web.whatsapp.com/' }), 'whatsapp'); assert.equal(c({ ref: 'https://m.facebook.com/' }), 'facebook');
  assert.equal(c({ ref: 'https://www.youtube.com/watch' }), 'youtube'); assert.equal(c({ ref: 'https://blog.exemplo.com/post' }), 'outros-sites');
  assert.equal(c({ ref: 'https://masterclass.example.com.br/' }), 'direto'); // interno não é origem
  assert.equal(c({}), 'direto'); assert.equal(c({ ua: 'Mozilla Instagram 300.0' }), 'instagram');
  assert.equal(c({ param: 'whatsapp' }), 'whatsapp'); assert.equal(c({ param: 'ig', ref: 'https://www.google.com/' }), 'instagram'); assert.equal(c({ param: 'qualquer' }), 'direto');
  assert.deepEqual(A.parseUA(UA), { device: 'celular', browser: 'Safari', os: 'iOS' });
  assert.equal(A.parseUA(UA_DESK).device, 'computador'); assert.equal(A.parseUA('Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit Chrome/120 Safari').device, 'tablet');
  assert.equal(A.parseUA('Mozilla/5.0 (iPhone) Instagram 300.0 (iPhone14,2)').browser, 'Instagram (interno)');
  for (const bot of ['', 'curl/8.0', 'Googlebot/2.1 (+http://www.google.com/bot.html)', 'facebookexternalhit/1.1', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'python-requests/2.31 something']) assert.equal(A.isBot(bot), true, bot);
  assert.equal(A.isBot(UA), false); assert.equal(A.isBot(UA_DESK), false);
  assert.equal(A.cleanPath('/cursos/x?y=1#z'), '/cursos/x'); assert.equal(A.cleanPath('/admin/afiliados'), null); assert.equal(A.cleanPath('//a//b/'), '/a/b'); assert.equal(A.cleanPath('http://x'), null);
  assert.equal(A.cleanCoupon('evo-ym4uj6'), 'EVO-YM4UJ6'); assert.equal(A.cleanCoupon('<b>x'), null);
  assert.equal(A.geo('8.8.8.8').country, 'US'); assert.deepEqual(A.geo(''), {});
});

test('coleta: visita nova, segunda página e visitante que volta', async () => {
  const v = id('v'); const s1 = id('s');
  assert.equal((await hit({ v, s: s1, p: '/', h: 'localhost', r: 'https://l.instagram.com/', q: {} })).status, 204);
  let x = await ses(s1); assert.equal(x.site, 'plataforma'); assert.equal(x.source, 'instagram'); assert.equal(x.is_new, true); assert.equal(x.pages, 1);
  assert.equal(x.device, 'celular'); assert.equal(x.browser, 'Safari'); assert.equal(x.country, 'BR'); assert.equal(x.region, 'PR');
  await hit({ v, s: s1, p: '/cursos/curso-medido', h: 'localhost', r: '', q: {} });
  x = await ses(s1); assert.equal(x.pages, 2); assert.equal(x.entry_path, '/'); assert.equal(x.exit_path, '/cursos/curso-medido'); assert.equal(x.source, 'instagram');
  assert.equal((await q('SELECT count(*)::int n FROM an_pageviews WHERE session_id=$1', [s1])).rows[0].n, 2);
  const s2 = id('s'); await hit({ v, s: s2, p: '/', h: 'localhost', r: '', q: {} });
  assert.equal((await ses(s2)).is_new, false); assert.equal((await ses(s2)).source, 'direto');
  assert.equal((await q('SELECT sessions FROM an_visitors WHERE visitor_id=$1', [v])).rows[0].sessions, 2);
});

test('landing: cupom do link, site e origem pelo parâmetro', async () => {
  const v = id('l'); const s = id('s');
  const r = await hit({ v, s, p: '/', h: 'masterclass.example.com.br', r: '', q: { c: 'evo-ym4uj6', o: 'whatsapp' } }, { origin: LANDING });
  assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), LANDING);
  const x = await ses(s); assert.equal(x.site, 'landing'); assert.equal(x.coupon, 'EVO-YM4UJ6'); assert.equal(x.source, 'whatsapp'); assert.equal(x.entry_host, 'masterclass.example.com.br');
  // a mesma visita segue para a plataforma (cookie compartilhado): continua a mesma sessão, com a origem original
  await hit({ v, s, p: '/checkout/curso-medido', h: 'localhost', r: LANDING + '/', q: {} });
  const y = await ses(s); assert.equal(y.pages, 2); assert.equal(y.source, 'whatsapp'); assert.equal(y.coupon, 'EVO-YM4UJ6');
  assert.deepEqual((await q('SELECT site FROM an_pageviews WHERE session_id=$1 ORDER BY id', [s])).rows.map((p) => p.site), ['landing', 'plataforma']);
  const pre = await fetch(t.base + '/ea/c', { method: 'OPTIONS', headers: { origin: LANDING, 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), LANDING);
});

test('segurança: origem não autorizada, robô, caminho de admin, ids inválidos e corpo ruim', async () => {
  const cnt = async () => (await q('SELECT count(*)::int n FROM an_pageviews')).rows[0].n;
  const base = await cnt(); const ok = { v: id('b'), s: id('s'), p: '/', h: 'localhost', r: '', q: {} };
  assert.equal((await hit(ok, { origin: 'https://site-estranho.com' })).status, 403);
  assert.equal((await fetch(t.base + '/ea/c', { method: 'POST', headers: { 'user-agent': UA }, body: JSON.stringify(ok) })).status, 403); // sem Origin
  assert.equal((await hit(ok, { ua: 'Googlebot/2.1' })).status, 204);
  assert.equal((await hit({ ...ok, p: '/admin/afiliados' })).status, 204);
  assert.equal((await hit({ ...ok, v: 'curto' })).status, 204);
  assert.equal((await hit({ ...ok, s: '<script>alert(1)</script>' })).status, 204);
  assert.equal((await fetch(t.base + '/ea/c', { method: 'POST', headers: { origin: ORIGIN, 'user-agent': UA }, body: '{nao é json' })).status, 204);
  assert.equal(await cnt(), base); // nada foi gravado
  // visita com visitante diferente do dono da sessão é ignorada
  const s = id('s'); await hit({ ...ok, s }); const antes = await cnt(); await hit({ ...ok, v: id('x'), s }); assert.equal(await cnt(), antes);
  // valores esquisitos ficam inofensivos
  await hit({ v: id('z'), s: id('s'), p: '/' + 'a'.repeat(500), h: 'localhost', r: 'x'.repeat(2000), q: { c: "'; DROP TABLE an_sessions;--", o: {} } });
  const tabela = await q("SELECT to_regclass('an_sessions') AS t"); assert.ok(tabela.rows[0].t);
  const p = (await q("SELECT path FROM an_pageviews WHERE path LIKE '/aaaa%' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(p.path.length, 200); // caminho cortado
  assert.equal((await q("SELECT coupon FROM an_sessions WHERE coupon LIKE '%DROP%'")).rowCount, 0);
});

test('segredos na URL não são guardados; Não rastrear e corpo ruim são respeitados', async () => {
  for (const [raw, norm] of [['/redefinir-senha/abc123SEGREDO', '/redefinir-senha/:token'], ['/pedido/PED-XYZ-998', '/pedido/:id'], ['/certificado/COD123', '/certificado/:codigo'], ['/painel/tokensecreto/vendas', '/painel/:token/vendas'], ['/cupom/EVO-ABC', '/cupom/:codigo']]) {
    assert.equal(A.cleanPath(raw), norm);
    const s = id('s'); await hit({ v: id('q'), s, p: raw, h: 'localhost', r: '', q: {} });
    assert.equal((await ses(s)).entry_path, norm);
  }
  const antes = (await q('SELECT count(*)::int n FROM an_pageviews')).rows[0].n; const ok = { v: id('d'), s: id('s'), p: '/', h: 'localhost', r: '', q: {} };
  for (const hd of [{ dnt: '1' }, { 'sec-gpc': '1' }]) assert.equal((await fetch(t.base + '/ea/c', { method: 'POST', headers: { origin: ORIGIN, 'user-agent': UA, ...hd }, body: JSON.stringify(ok) })).status, 204);
  assert.equal((await fetch(t.base + '/ea/c', { method: 'POST', headers: { origin: ORIGIN, 'user-agent': UA }, body: 'null' })).status, 204);
  assert.equal((await fetch(t.base + '/ea/c', { method: 'POST', headers: { origin: ORIGIN, 'user-agent': UA }, body: 'x'.repeat(9000) })).status, 204);
  assert.equal((await hit({ ...ok, h: 'site-estranho.com' })).status, 204);
  assert.equal((await q('SELECT count(*)::int n FROM an_pageviews')).rows[0].n, antes);
});

test('duas abas abrindo a mesma visita ao mesmo tempo contam uma só vez', async () => {
  const v = id('c'); const s = id('s');
  await Promise.all([1, 2, 3].map(() => hit({ v, s, p: '/', h: 'localhost', r: '', q: {} })));
  assert.equal((await q('SELECT sessions FROM an_visitors WHERE visitor_id=$1', [v])).rows[0].sessions, 1);
  assert.equal((await ses(s)).pages, 3);
});

test('privacidade: o endereço de rede não é guardado em lugar nenhum', async () => {
  const v = id('p'); const s = id('s'); await hit({ v, s, p: '/', h: 'localhost', r: '', q: {} }, { ip: '177.92.10.5' });
  const dump = JSON.stringify([(await q('SELECT * FROM an_sessions WHERE id=$1', [s])).rows, (await q('SELECT * FROM an_pageviews WHERE session_id=$1', [s])).rows, (await q('SELECT * FROM an_visitors WHERE visitor_id=$1', [v])).rows]);
  assert.doesNotMatch(dump, /177\.92|127\.0\.0\.1/);
  const cols = (await q("SELECT column_name FROM information_schema.columns WHERE table_name IN ('an_sessions','an_pageviews','an_visitors')")).rows.map((r) => r.column_name);
  assert.ok(!cols.some((c) => /(^|_)ip($|_)/.test(c)));
});

test('aluno logado na plataforma fica ligado ao acesso; visita de administrador não é medida', async () => {
  const st = await makeStudent(t, { email: 'aluno.medido@example.com', name: 'Aluno Medido' });
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING", [st.id]);
  const b = new Browser(t.base); await b.login(st.email, st.password);
  const v = id('a'); const s = id('s');
  await fetch(t.base + '/ea/c', { method: 'POST', headers: { 'content-type': 'text/plain', origin: ORIGIN, 'user-agent': UA, cookie: b.cookieHeader() }, body: JSON.stringify({ v, s, p: '/meus-cursos', h: 'localhost', r: '', q: {} }) });
  assert.equal(String((await ses(s)).user_id), String(st.id));
  // o script entra nas páginas públicas e do aluno, e fica fora do painel do administrador
  assert.match((await new Browser(t.base).get('/')).text, /\/static\/js\/ea\.js/);
  assert.match((await b.get('/meus-cursos')).text, /\/static\/js\/ea\.js/);
  assert.doesNotMatch((await admin.get('/admin')).text, /ea\.js/);
});

test('funil: a compra fica ligada ao visitante e à visita', async () => {
  const v = id('f'); const s = id('s');
  await hit({ v, s, p: '/', h: 'masterclass.example.com.br', r: '', q: { c: 'DORA20' } }, { origin: LANDING });
  const b = new Browser(t.base); b.jar.ea_v = v; b.jar.ea_s = s;
  const r = await b.post(`/checkout/${slug}`, { ...form(), cupom: '' }, `/checkout/${slug}`);
  assert.equal(r.status, 303);
  const o = (await q('SELECT visitor_id, session_id FROM orders WHERE public_id=$1', [r.location.replace('/pedido/', '')])).rows[0];
  assert.equal(o.visitor_id, v); assert.equal(o.session_id, s);
  // cookies inválidos não entram
  const b2 = new Browser(t.base); b2.jar.ea_v = '<x>'; b2.jar.ea_s = 'curto';
  const r2 = await b2.post(`/checkout/${slug}`, { ...form(), cupom: '' }, `/checkout/${slug}`);
  const o2 = (await q('SELECT visitor_id, session_id FROM orders WHERE public_id=$1', [r2.location.replace('/pedido/', '')])).rows[0];
  assert.equal(o2.visitor_id, null); assert.equal(o2.session_id, null);
});

test('verificação da coleta: só administrador e mostra as visitas', async () => {
  const h = await admin.get('/admin/analytics/verificacao'); assert.equal(h.status, 200);
  assert.match(h.text, /Verificação da coleta/); assert.match(h.text, /Visitantes hoje/); assert.match(h.text, /instagram/); assert.match(h.text, /Medição ligada/);
  const an = await new Browser(t.base).get('/admin/analytics/verificacao'); assert.ok([302, 303, 401, 403].includes(an.status));
  const st = await makeStudent(t, { email: 'curioso.an@example.com', name: 'Curioso' });
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING", [st.id]);
  const b = new Browser(t.base); await b.login(st.email, st.password);
  const r = await b.get('/admin/analytics/verificacao'); assert.ok([302, 303, 403, 404].includes(r.status)); assert.doesNotMatch(r.text || '', /Visitantes hoje/);
});

test('limpeza: apaga o que passou de 13 meses e guarda os totais por dia', async () => {
  const old = new Date(Date.now() - 14 * 31 * 86400000); const keep = new Date(Date.now() - 2 * 86400000);
  const vo = id('o'); const so = id('s'); const vk = id('k'); const sk = id('s');
  await q("INSERT INTO an_visitors (visitor_id, first_seen, last_seen) VALUES ($1,$3,$3), ($2,$4,$4)", [vo, vk, old, keep]);
  await q("INSERT INTO an_sessions (id, visitor_id, started_at, last_at, site, is_new) VALUES ($1,$2,$3,$3,'landing',true), ($4,$5,$6,$6,'landing',true)", [so, vo, old, sk, vk, keep]);
  await q("INSERT INTO an_pageviews (session_id, visitor_id, site, path, created_at) VALUES ($1,$2,'landing','/',$3), ($1,$2,'landing','/b',$3), ($4,$5,'landing','/',$6)", [so, vo, old, sk, vk, keep]);
  const oid = (await q('SELECT id FROM orders ORDER BY id LIMIT 1')).rows[0].id;
  await q('UPDATE orders SET visitor_id=$2, session_id=$3, created_at=$4 WHERE id=$1', [oid, vo, so, old]);
  const out = await A.purge(t.cfg);
  assert.ok(out.pageviews >= 2 && out.sessions >= 1 && out.visitors >= 1);
  assert.equal((await q('SELECT count(*)::int n FROM an_sessions WHERE id=$1', [so])).rows[0].n, 0);
  assert.equal((await q('SELECT count(*)::int n FROM an_sessions WHERE id=$1', [sk])).rows[0].n, 1); // recente continua
  const day = (await q("SELECT * FROM an_daily WHERE site='landing' ORDER BY day LIMIT 1")).rows[0];
  assert.equal(day.pageviews, 2); assert.equal(day.visits, 1); assert.equal(day.visitors, 1); assert.equal(day.new_visitors, 1);
  assert.equal((await q('SELECT visitor_id FROM orders WHERE visitor_id=$1', [vo])).rowCount, 0);
  assert.deepEqual(await A.purge(t.cfg), { pageviews: 0, sessions: 0, visitors: 0 }); // repetir é inofensivo
});

test('script: entregue às landings (CORP aberto) e desligado sem ANALYTICS_ENABLED', async () => {
  const r = await fetch(t.base + '/static/js/ea.js');
  assert.equal(r.status, 200); assert.equal(r.headers.get('cross-origin-resource-policy'), 'cross-origin'); assert.match(r.headers.get('content-type'), /javascript/);
  const src = await r.text(); assert.match(src, /ea_v/); assert.doesNotMatch(src, /google-analytics|googletagmanager/);
  const t2 = await boot();
  try {
    assert.equal((await fetch(t2.base + '/ea/c', { method: 'POST', headers: { origin: 'http://localhost:3000', 'user-agent': UA }, body: '{}' })).status, 204);
    assert.doesNotMatch((await new Browser(t2.base).get('/')).text, /ea\.js/);
    assert.equal((await t2.pool.query('SELECT count(*)::int n FROM an_pageviews')).rows[0].n, 0);
  } finally { await t2.close(); } // fecha o pool compartilhado: por isso este é o último teste
});

