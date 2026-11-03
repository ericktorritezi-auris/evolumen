'use strict';
// 1.3.0 · Cockpit de monitoramento: link com chave secreta, somente leitura, sem dados pessoais.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const K = require('../src/cockpit');

let t; let admin; let course; const slug = 'curso-cockpit';
const q = (sql, p) => t.pool.query(sql, p);
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';
let cpfN = 900; let buyerN = 0;
function genCpf(n) {
  const d = String(100000000 + n * 7919).slice(0, 9).split('').map(Number);
  for (let k = 0; k < 2; k++) { const len = 9 + k; const sum = d.slice(0, len).reduce((a, v, i) => a + v * (len + 1 - i), 0); const r = (sum * 10) % 11; d.push(r === 10 ? 0 : r); }
  return d.join('');
}
const form = (over = {}) => ({ name: 'Bruna Compradora Silva', email: `cliente${++buyerN}@example.com`, phone: '11987654321', cpf: genCpf(++cpfN), cep: '01310100', street: 'Av. Paulista', street_number: '1000', complement: '', district: 'Bela Vista', city: 'São Paulo', state: 'SP', method: 'pix', accept: '1', ...over });
const sim = (pub, result) => admin.post(`/admin/simulador/${pub}`, { result }, '/admin/simulador');
async function buy(over = {}, result = 'approved') {
  const b = new Browser(t.base);
  const r = await b.post(`/checkout/${slug}`, { ...form(over), cupom: '' }, `/checkout/${slug}`);
  assert.equal(r.status, 303, 'checkout');
  const pub = r.location.replace('/pedido/', '');
  if (result) await sim(pub, result);
  return (await q('SELECT * FROM orders WHERE public_id=$1', [pub])).rows[0];
}
const token = async () => (await q('SELECT token FROM cockpit_access WHERE id=1')).rows[0].token;
const get = async (b, path) => b.get(path);

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await admin.post('/admin/cursos', { title: 'Curso Cockpit', slug, summary: 'Resumo.', description: 'Desc', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice_days: '30' }, '/admin/cursos/novo');
  course = (await q('SELECT id FROM courses WHERE slug=$1', [slug])).rows[0].id;
  await q("UPDATE courses SET status='published', published_at=now() - interval '1 day' WHERE id=$1", [course]);
  const mod = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'M',1) RETURNING id", [course])).rows[0].id;
  await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'A',1,'dQw4w9WgXcQ')", [course, mod]);
  await q("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy')", [LONG]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status = 'published' ON CONFLICT DO NOTHING");
});
after(async () => { await t.close(); });

test('migração 017: nasce uma chave aleatória longa e rodar de novo não troca a chave', async () => {
  const a = await token(); assert.ok(a.length >= 32 && /^[0-9a-f]+$/.test(a));
  const fs = require('fs'); const path = require('path');
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/017_cockpit.sql'), 'utf8');
  await q(sql); await q(sql);
  assert.equal(await token(), a);
  assert.equal((await q('SELECT count(*)::int n FROM cockpit_access')).rows[0].n, 1);
});

test('Configurações: linha Endereço do painel com Copiar, Abrir e Atualizar; só o administrador vê', async () => {
  const tk = await token();
  const page = await admin.get('/admin/configuracoes'); assert.equal(page.status, 200);
  assert.match(page.text, /Endereço do painel/); assert.ok(page.text.includes(`/painel/${tk}`));
  assert.match(page.text, /action="\/admin\/configuracoes\/painel\/atualizar"/); assert.match(page.text, /data-copy="panel-url"/); assert.match(page.text, /data-confirm="Isso gera um endereço novo/);
  const stu = await makeStudent(t, { email: 'curioso@example.com', name: 'Curioso Aluno' });
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published'", [stu.id]);
  const sb = new Browser(t.base); await sb.login(stu.email, stu.password);
  assert.equal((await sb.get('/admin/configuracoes')).status, 403);
  const csrf = await sb.csrf('/meus-cursos');
  assert.ok([403, 404].includes((await sb.req('POST', '/admin/configuracoes/painel/atualizar', { _csrf: csrf })).status));
  assert.equal(await token(), tk, 'aluno não troca a chave');
});

test('acesso: chave certa abre a página e os dados; chave errada, curta ou estranha é 404; cabeçalhos de proteção', async () => {
  const tk = await token(); const b = new Browser(t.base);
  const ok = await b.get(`/painel/${tk}`); assert.equal(ok.status, 200);
  assert.match(ok.text, /Cockpit/); assert.doesNotMatch(ok.text, /<script(?![^>]*\bsrc=)[^>]*>/, 'nenhum script embutido');
  assert.match(ok.headers.get('cache-control'), /no-store/); assert.match(ok.headers.get('x-robots-tag'), /noindex/); assert.equal(ok.headers.get('referrer-policy'), 'no-referrer');
  assert.match(ok.headers.get('content-security-policy'), /script-src 'self'/);
  assert.doesNotMatch(ok.text, /href="\/(admin|meus-cursos|sair|entrar)/, 'sem menu nem sair');
  const dados = await b.get(`/painel/${tk}/dados`); assert.equal(dados.status, 200); assert.match(dados.headers.get('content-type'), /json/);
  const j = JSON.parse(dados.text); for (const k of ['kpi', 'sales', 'students', 'online', 'rank', 'funnel', 'chart', 'aff', 'health', 'period']) assert.ok(k in j, k);
  assert.equal(j.period.f, 'total');
  for (const bad of ['x'.repeat(64), 'curta', tk.slice(0, -1) + (tk.endsWith('a') ? 'b' : 'a'), tk + 'x', '%27%20OR%201=1', '%2e%2e%2fadmin']) {
    assert.equal((await b.get(`/painel/${bad}`)).status, 404, bad); assert.equal((await b.get(`/painel/${bad}/dados`)).status, 404, bad);
  }
  assert.equal((await b.get('/painel')).status, 404); assert.equal((await b.get('/painel/')).status, 404);
  assert.match(require('fs').readFileSync(require('path').join(__dirname, '../src/server.js'), 'utf8'), /Disallow: \/painel/, 'robots em produção');
  assert.equal((await b.get('/static/js/cockpit.js')).status, 200); assert.equal((await b.get('/static/css/cockpit.css')).status, 200);
});

test('somente leitura: nenhuma rota de escrita no painel', async () => {
  const tk = await token(); const b = new Browser(t.base);
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.ok([403, 404].includes((await b.req(m, `/painel/${tk}`, m === 'POST' ? { x: '1' } : null)).status), m);
  assert.ok([403, 404].includes((await b.req('POST', `/painel/${tk}/dados`, { x: '1' })).status));
});

test('atualizar: a chave antiga morre na hora, a nova funciona e fica registrado', async () => {
  const old = await token();
  const r = await admin.post('/admin/configuracoes/painel/atualizar', {}, '/admin/configuracoes'); assert.equal(r.status, 303);
  const now = await token(); assert.notEqual(now, old); assert.ok(now.length >= 32);
  const b = new Browser(t.base);
  assert.equal((await b.get(`/painel/${old}`)).status, 404); assert.equal((await b.get(`/painel/${old}/dados`)).status, 404);
  assert.equal((await b.get(`/painel/${now}`)).status, 200);
  assert.ok(now.includes(' ') === false && /^[A-Za-z0-9_-]+$/.test(now));
  assert.equal((await q("SELECT count(*)::int n FROM audit_log WHERE action='cockpit_key_rotated'")).rows[0].n, 1);
  assert.doesNotMatch(JSON.stringify((await q("SELECT meta FROM audit_log WHERE action='cockpit_key_rotated'")).rows), new RegExp(now), 'chave nunca no log');
  assert.ok((await admin.get('/admin/configuracoes')).text.includes(`/painel/${now}`));
});

test('dados reais: vendas, alunos, reembolso, funil e afiliado; nada de dados pessoais; períodos', async () => {
  const o1 = await buy({ name: 'Fernanda Almeida Prado', email: 'fernanda.prado@example.com' });
  const o2 = await buy({ name: 'Gustavo Henrique Lima', email: 'gustavo.lima@example.com' });
  const o3 = await buy({ name: 'Marina Souza Costa', email: 'marina.costa@example.com' });
  await sim(o3.public_id, 'refunded');
  await buy({ name: 'Rafael Pendente Dias', email: 'rafael.dias@example.com' }, null);
  const tk = await token(); const b = new Browser(t.base);
  const j = JSON.parse((await b.get(`/painel/${tk}/dados`)).text);
  assert.equal(j.kpi.period.sales, 2); assert.equal(j.kpi.period.revenue, o1.price_cents + o2.price_cents);
  assert.equal(j.kpi.period.refunds, 1); assert.equal(j.kpi.total.sales, 2); assert.equal(j.kpi.today.sales, 2);
  assert.equal(j.kpi.studentsTotal, (await q("SELECT count(*)::int n FROM users WHERE role='student'")).rows[0].n);
  assert.equal(j.funnel.started, 4); assert.equal(j.funnel.paid, 2, "reembolsado não conta como pago"); assert.equal(j.funnel.pending, 1);
  assert.equal(j.sales[0].who, 'Gustavo L.'); assert.deepEqual(j.sales.map((s) => s.who).sort(), ['Fernanda P.', 'Gustavo L.']);
  assert.equal(j.rank[0].n, 2); assert.equal(j.rank[0].title, 'Curso Cockpit');
  const raw = JSON.stringify(j);
  for (const secret of ['fernanda.prado@example.com', '11987654321', 'Fernanda Almeida Prado', 'Gustavo Henrique', 'Av. Paulista', '@example.com', o1.public_id]) assert.equal(raw.includes(secret), false, 'vaza: ' + secret);
  assert.ok(!/"cpf"|"email"|"phone"|"password|"token"/.test(raw));
  const cpf = (await q('SELECT cpf FROM users WHERE id=$1', [o1.user_id])).rows[0].cpf; assert.equal(raw.includes(cpf), false);
  // período: hoje, 7 dias, este mês, personalizado (de/até trocados, futuro cortado, lixo vira total)
  for (const f of ['today', '7d', 'month']) { const x = JSON.parse((await b.get(`/painel/${tk}/dados?f=${f}`)).text); assert.equal(x.kpi.period.sales, 2, f); assert.equal(x.period.f, f); }
  const y = new Date().toISOString().slice(0, 10);
  const c1 = JSON.parse((await b.get(`/painel/${tk}/dados?f=custom&de=2999-01-01&ate=${y}`)).text); assert.equal(c1.period.f, 'custom'); assert.equal(c1.kpi.period.sales, 2);
  const c2 = JSON.parse((await b.get(`/painel/${tk}/dados?f=custom&de=${y}&ate=2000-01-01`)).text); assert.equal(c2.period.f, 'custom');
  const c3 = JSON.parse((await b.get(`/painel/${tk}/dados?f=custom&de=2000-01-01&ate=2000-01-31`)).text); assert.equal(c3.kpi.period.sales, 0); assert.equal(c3.kpi.total.sales, 2, 'acumulado continua à vista');
  const bad = JSON.parse((await b.get(`/painel/${tk}/dados?f=custom&de=lixo&ate=%27;DROP`)).text); assert.equal(bad.period.f, 'total');
  const weird = JSON.parse((await b.get(`/painel/${tk}/dados?f=${encodeURIComponent("x' OR 1=1")}`)).text); assert.equal(weird.period.f, 'total');
  // venda velha fica fora de "hoje" e dentro do total
  await q("UPDATE orders SET approved_at = now() - interval '40 days' WHERE id=$1", [o1.id]);
  const m = JSON.parse((await b.get(`/painel/${tk}/dados?f=month`)).text); const tt = JSON.parse((await b.get(`/painel/${tk}/dados?f=total`)).text);
  assert.equal(tt.kpi.period.sales, 2); assert.ok(m.kpi.period.sales <= 2);
  assert.equal(tt.chart.points.length, 12); assert.equal(JSON.parse((await b.get(`/painel/${tk}/dados?f=today`)).text).chart.points.length, 24);
  assert.equal(tt.chart.points.reduce((s, p) => s + p.cents, 0) <= tt.kpi.period.revenue, true);
});

test('gráfico de período personalizado longo fica ancorado no fim do período escolhido', async () => {
  const o = (await q("SELECT id, price_cents FROM orders WHERE status='approved' ORDER BY id LIMIT 1")).rows[0];
  await q("UPDATE orders SET approved_at = now() - interval '120 days' WHERE id=$1", [o.id]);
  const d = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const tk = await token(); const b = new Browser(t.base);
  const j = JSON.parse((await b.get(`/painel/${tk}/dados?f=custom&de=${d(150)}&ate=${d(100)}`)).text);
  assert.equal(j.kpi.period.sales, 1); assert.equal(j.chart.unit, 'day');
  const k = JSON.parse((await b.get(`/painel/${tk}/dados?f=custom&de=${d(300)}&ate=${d(90)}`)).text);
  assert.equal(k.chart.unit, 'week'); assert.equal(k.kpi.period.revenue, o.price_cents);
  assert.equal(k.chart.points.reduce((s, p) => s + p.cents, 0), o.price_cents, 'o gráfico soma o mesmo valor do período');
});

test('afiliados e acessos: comissões acumuladas, ranking de afiliado e quem está online (nome abreviado)', async () => {
  await admin.post('/admin/afiliados', { name: 'Camila Divulgadora', email: 'camila@example.com', phone: '(11) 98888-7777', note: '' }, '/admin/afiliados/novo');
  const af = (await q("SELECT id FROM affiliates WHERE email='camila@example.com'")).rows[0].id;
  await admin.post('/admin/cupons', { code: 'CAMI20', kind: 'percent', percent: '20', max_uses: '500', courses: [String(course)], affiliate_id: String(af), commission_pct: '10' }, '/admin/cupons/novo');
  const b0 = new Browser(t.base);
  const r = await b0.post(`/checkout/${slug}`, { ...form({ name: 'Henrique Comprador Souza' }), cupom: 'CAMI20' }, `/checkout/${slug}`);
  await sim(r.location.replace('/pedido/', ''), 'approved');
  const stu = await makeStudent(t, { email: 'online@example.com', name: 'Larissa Online Alves' });
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published'", [stu.id]);
  const sb = new Browser(t.base); await sb.login(stu.email, stu.password); await sb.get('/meus-cursos');
  const tk = await token(); const j = JSON.parse((await new Browser(t.base).get(`/painel/${tk}/dados`)).text);
  assert.ok(j.aff.grace > 0, 'comissão em carência'); assert.equal(j.aff.top[0].who, 'Camila D.'); assert.match(j.aff.top[0].codes, /CAMI20/); assert.equal(j.aff.top[0].n, 1);
  assert.ok(j.online.list.some((x) => x.who === 'Larissa A.'), 'aparece online'); assert.ok(j.online.now >= 1); assert.ok(j.online.today >= 1);
  assert.equal(JSON.stringify(j).includes('online@example.com'), false);
  assert.ok(j.students.some((x) => x.who === 'Larissa A.'));
  // administrador logado não conta como aluno online
  assert.equal(j.online.list.some((x) => /administrador|admin/i.test(x.who)), false);
});

test('freio contra chute de chave e cálculo de períodos', () => {
  for (let i = 0; i < 40; i++) K.miss('9.9.9.9');
  assert.equal(K.tooMany('9.9.9.9'), true); assert.equal(K.tooMany('8.8.8.8'), false);
  const now = new Date('2026-11-04T15:00:00Z');
  const m = K.period('month', null, null, now); assert.equal(m.first, '2026-11-01'); assert.equal(m.last, '2026-11-04');
  const w = K.period('7d', null, null, now); assert.equal(w.first, '2026-10-29');
  const c = K.period('custom', '2026-11-03', '2026-10-01', now); assert.equal(c.de, '2026-10-01'); assert.equal(c.ate, '2026-11-03');
  const f = K.period('custom', '2026-10-01', '2030-01-01', now); assert.equal(f.ate, '2026-11-04');
  assert.equal(K.period('custom', 'x', 'y', now).f, 'total'); assert.equal(K.period('nada', null, null, now).f, 'total');
  assert.equal(K.period('today', null, null, new Date('2026-11-04T02:30:00Z')).from.toISOString(), '2026-11-03T03:00:00.000Z', 'dia vira à meia-noite de Brasília');
});
