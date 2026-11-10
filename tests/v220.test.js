'use strict';
// 2.2.0 (etapa 3) · EvoLumen Analytics: a tela com os números, o botão no Dashboard e os filtros.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const R = require('../src/analytics_report');

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


const get = async (qs = '') => (await admin.get('/admin/analytics' + qs));
const seedVisit = async ({ v, s, paths, ip, ua = UA, origin = ORIGIN, host = 'localhost', r = '', qq = {} }) => { for (const [i, p] of paths.entries()) await hit({ v, s, p, h: host, r: i ? '' : r, q: i ? {} : qq }, { origin, ua, ip }); };

test('dashboard tem o botão e a tela abre sem dados', async () => {
  const d = (await admin.get('/admin')).text;
  assert.match(d, /href="\/admin\/analytics"/); assert.match(d, /EvoLumen Analytics/); assert.match(d, /Quer entender de onde vêm as visitas/);
  const r = await get(); assert.equal(r.status, 200);
  for (const x of ['Voltar para o dashboard', 'Visitantes', 'Visitas por dia', 'Funil até a compra', 'De onde vêm', 'Novos e recorrentes', 'Regiões', 'Páginas mais visitadas', 'Landings e afiliados', 'Faixa etária dos alunos', 'Sem visitas no período']) assert.ok(r.text.includes(x), x);
});

test('números: visitas, origem, aparelho, região, funil e compra', async () => {
  const v1 = id('a'); const s1 = id('s'); const v2 = id('b'); const s2 = id('s'); const v3 = id('c'); const s3 = id('s');
  await seedVisit({ v: v1, s: s1, paths: ['/'], r: 'https://l.instagram.com/', qq: { c: 'EVO-TESTE1' }, host: 'masterclass.example.com.br', origin: LANDING });
  // a mesma visita cruza para a plataforma
  await seedVisit({ v: v1, s: s1, paths: ['/cursos/' + slug, '/checkout/' + slug] });
  await seedVisit({ v: v2, s: s2, paths: ['/', '/metodo-epi'], ua: UA_DESK, ip: '8.8.8.8', r: 'https://www.google.com/' });
  await seedVisit({ v: v3, s: s3, paths: ['/'], ip: '177.92.10.5' });
  await q("UPDATE an_visitors SET sessions = 5 WHERE visitor_id = $1", [v3]); await q("UPDATE an_sessions SET is_new = false WHERE id = $1", [s3]);
  const b = new Browser(t.base); b.jar.ea_v = v1; b.jar.ea_s = s1;
  const r = await b.post('/checkout/' + slug, { ...form(), cupom: '' }, '/checkout/' + slug); assert.equal(r.status, 303);
  await admin.post('/admin/simulador/' + r.location.replace('/pedido/', ''), { result: 'approved' }, '/admin/simulador');

  const d = await R.report({ days: 30, site: 'todos' });
  assert.equal(d.kpi.visits, 3); assert.equal(d.kpi.visitors, 3); assert.equal(d.kpi.novos, 2); assert.equal(d.kpi.recorrentes, 1); assert.equal(d.kpi.compras, 1);
  assert.equal(d.kpi.pageviews, 6);
  const lab = (rows) => Object.fromEntries(rows);
  assert.equal(lab(d.src)['Instagram'], 1); assert.equal(lab(d.src)['Google (busca)'], 1); assert.equal(lab(d.src)['Direto'], 1);
  assert.equal(lab(d.dev)['Celular'], 2); assert.equal(lab(d.dev)['Computador'], 1);
  assert.equal(lab(d.nr)['Novos'], 2); assert.equal(lab(d.nr)['Fiéis (4 ou mais visitas)'], 1);
  assert.ok(lab(d.regions)['Paraná'] >= 1); assert.ok(lab(d.regions)['Fora do Brasil'] >= 1);
  const f = Object.fromEntries(d.steps); assert.equal(f['Visitas no período'], 3); assert.equal(d.landingVisits, 1); assert.equal(f['Viram a página de um curso'], 1); assert.equal(f['Abriram o checkout'], 1); assert.equal(f['Pedido criado'], 1); assert.equal(f['Compra aprovada'], 1);
  assert.equal(d.coupons.length, 1); assert.equal(d.coupons[0].coupon, 'EVO-TESTE1'); assert.equal(d.coupons[0].visits, 1); assert.equal(d.coupons[0].checkout, 1); assert.equal(d.coupons[0].buys, 1);
  const home = d.pages.find((p) => p.label === '/' && !p.landing); assert.ok(home && home.entries === 2);
  const land = d.pages.find((p) => p.landing); assert.equal(land.label, 'masterclass.example.com.br'); assert.equal(land.entries, 1);
  assert.ok(d.kpi.conv > 33 && d.kpi.conv < 34); // 1 compra em 3 visitas
  const ck = d.pages.find((p) => p.label === '/checkout/' + slug); assert.equal(ck.exits, 1);
  assert.equal(d.daily.length, 30); assert.equal(d.daily[d.daily.length - 1].visits, 3);
});

test('filtros de período e de site mudam os números', async () => {
  const todos = await R.report({ days: 7, site: 'todos' }); const plat = await R.report({ days: 7, site: 'plataforma' }); const land = await R.report({ days: 7, site: 'landings' });
  assert.equal(todos.daily.length, 7); assert.equal(R.parseDays('90'), 90); assert.equal(R.parseDays('15'), 30); assert.equal(R.parseSite('x'), 'todos');
  assert.equal(land.kpi.visits, 1); assert.equal(plat.kpi.visits, 2); assert.equal(land.src[0][0], 'Instagram');
  const old = id('o'); await q("INSERT INTO an_visitors (visitor_id) VALUES ($1)", [old]);
  await q("INSERT INTO an_sessions (id, visitor_id, started_at, last_at, site, source) VALUES ($1,$2, now() - interval '20 days', now() - interval '20 days','plataforma','direto')", [id('s'), old]);
  assert.equal((await R.report({ days: 7 })).kpi.visits, 3); assert.equal((await R.report({ days: 30 })).kpi.visits, 4);
  assert.equal((await R.report({ days: 30 })).kpi.dVisits, null); // sem período anterior para comparar
});

test('a tela mostra os números e os filtros funcionam por link', async () => {
  const r = (await get('?dias=30&onde=todos')).text;
  for (const x of ['EVO-TESTE1', 'Instagram', 'Google (busca)', 'Celular', 'Paraná', 'masterclass.example.com.br', 'Compra aprovada', 'aria-current="page"', 'href="/admin/analytics?dias=7&amp;onde=todos"', 'Visitas por dia', '<svg']) assert.ok(r.includes(x), x);
  const l = (await get('?dias=7&onde=landings')).text; assert.match(l, /Instagram/); assert.doesNotMatch(l, /Computador/);
  const lixo = await get('?dias=abc&onde=<script>'); assert.equal(lixo.status, 200); assert.doesNotMatch(lixo.text, /<script>alert/);
});

test('alunos e faixa etária', async () => {
  const mk = async (email, birth, login) => { const s = await makeStudent(t, { email, name: 'Aluno ' + email }); await q('UPDATE users SET birth_date = $2, last_login_at = $3 WHERE id = $1', [s.id, birth, login]); await q("INSERT INTO enrollments (user_id, course_id, origin, status, starts_at) VALUES ($1,$2,'manual','active', now() - interval '30 days')", [s.id, course]); return s; };
  await mk('a1@example.com', '2005-03-10', new Date()); await mk('a2@example.com', '1985-06-01', new Date(Date.now() - 30 * 86400000)); await mk('a3@example.com', null, null);
  const d = await R.report({ days: 30 });
  assert.equal(d.students.entraram, 1); assert.equal(d.students.semana, 1); assert.equal(d.students.parados, 2); // a2 (último login há 30 dias) e a3 (nunca entrou, matriculado há 30 dias); o comprador recém-matriculado não conta
  assert.equal(d.ages.informaram, 2); assert.equal(Object.fromEntries(d.ages.rows)['18 a 24'], 1); assert.equal(Object.fromEntries(d.ages.rows)['35 a 44'], 1);
  assert.match((await get()).text, /2 de \d+ alunos informaram/);
});

test('acesso: só administrador vê a tela', async () => {
  const anon = await new Browser(t.base).get('/admin/analytics'); assert.ok([302, 303, 401, 403].includes(anon.status));
  const st = await makeStudent(t, { email: 'curioso.dash@example.com', name: 'Curioso' });
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING", [st.id]);
  const b = new Browser(t.base); await b.login(st.email, st.password);
  const r = await b.get('/admin/analytics'); assert.ok([302, 303, 403, 404].includes(r.status)); assert.doesNotMatch(r.text || '', /Funil até a compra/);
});

test('conversão por cupom, funil aninhado, pedido sem visita e textos sem erro de escala', async () => {
  const v = id('k'); const s = id('s'); // vai direto ao checkout, sem passar pela página do curso nem por landing
  await seedVisit({ v, s, paths: ['/checkout/' + slug], qq: { c: 'EVO-TESTE1' } });
  const d = await R.report({ days: 30 }); const f = d.steps.map(([, x]) => x);
  for (let i = 1; i < f.length; i++) assert.ok(f[i] <= f[i - 1], 'funil aninhado: ' + f.join(','));
  const cup = d.coupons.find((c) => c.coupon === 'EVO-TESTE1'); assert.equal(cup.visits, 2); assert.equal(cup.buys, 1);
  const html = (await get()).text; assert.match(html, /50,0%/); assert.doesNotMatch(html, /5\.000,0%/); // 1 compra em 2 visitas = 50%
  await q("UPDATE orders SET session_id = NULL, visitor_id = NULL WHERE status = 'approved'");
  assert.equal((await R.report({ days: 30, site: 'todos' })).kpi.semOrigem, 1); assert.match((await get()).text, /1 sem origem identificada/);
});

test('textos vindos do banco saem escapados na tela', async () => {
  const v = id('x'); const s = id('s'); const evil = '<img src=x onerror=alert(1)>';
  await q('INSERT INTO an_visitors (visitor_id) VALUES ($1)', [v]);
  await q("INSERT INTO an_sessions (id, visitor_id, site, source, coupon, entry_host, entry_path, exit_path, device, browser) VALUES ($1,$2,'landing','direto',$3,$4,$5,$5,'celular',$6)", [s, v, 'EVO-X<b>', evil, '/' + evil, evil]);
  await q("INSERT INTO an_pageviews (session_id, visitor_id, site, host, path) VALUES ($1,$2,'landing',$3,$4)", [s, v, evil, '/' + evil]);
  const html = (await get()).text; assert.doesNotMatch(html, /<img src=x onerror/); assert.match(html, /&lt;img src=x onerror/);
});

test('aluno com dois cursos conta uma vez; variação some sem período anterior completo', async () => {
  const s2 = await makeStudent(t, { email: 'dois@example.com', name: 'Aluno Dois' });
  const c2 = (await q("INSERT INTO courses (title, slug, summary, description, price_cents, level, access_type, status) VALUES ('Outro','outro-curso','r','d',1000,'iniciante','lifetime','published') RETURNING id")).rows[0].id;
  for (const c of [course, c2]) await q("INSERT INTO enrollments (user_id, course_id, origin, status, starts_at) VALUES ($1,$2,'manual','active', now() - interval '40 days')", [s2.id, c]);
  const antes = (await R.report({ days: 30 })).students.parados; assert.ok(antes >= 3);
  await q('UPDATE users SET last_login_at = now() - interval \'20 days\' WHERE id = $1', [s2.id]);
  assert.equal((await R.report({ days: 30 })).students.parados, antes); // dois cursos, um aluno
  assert.equal((await R.report({ days: 90 })).kpi.dVisitors, null); // a coleta não cobre o período anterior inteiro
});
