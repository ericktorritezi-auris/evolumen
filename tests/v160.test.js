'use strict';
// 1.6.0 · Lead Parceiros: funil interno, só administrador, sem efeito em afiliados/usuários/cupons, com médias de tempo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const Lead = require('../src/leads');

let t; let admin;
const q = (sql, p) => t.pool.query(sql, p);
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';
const add = (name, tag = 'afiliado', month = '2026-11') => admin.post('/admin/lead-parceiros', { name, tag, month }, '/admin/lead-parceiros');
const row = async (name) => (await q('SELECT * FROM partner_leads WHERE name=$1', [name])).rows[0];
const mv = (id, stage) => admin.post(`/admin/lead-parceiros/${id}/mover`, { stage }, '/admin/lead-parceiros');

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await q("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy','affiliate')", [LONG]);
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING");
});
after(async () => { await t.close(); });

test('etapas, validação e mês de entrada', () => {
  assert.deepEqual(Lead.STAGE_IDS, ['inicio', 'aguardando', 'aceitou', 'acessos', 'explicando', 'confirmado', 'sem']);
  assert.equal(Lead.parse({ name: ' Ana  Lima ', tag: 'divulgador', month: '2026-11' }).values.month, '2026-11-01');
  const e = Lead.parse({ name: 'A', tag: 'x', month: '2026-13' }).errors; assert.ok(e.name && e.tag && e.month);
  assert.equal(Lead.monthLabel('2026-11'), 'nov/2026');
});

test('médias entre etapas e por lead a partir do histórico', () => {
  const H = 3600000; const now = Date.now();
  const mvs = [['inicio', 100], ['aguardando', 90], ['aceitou', 50], ['acessos', 40], ['explicando', 30], ['confirmado', 10]].map(([s, h]) => ({ lead_id: 1, to_stage: s, moved_at: new Date(now - h * H) }));
  mvs.push({ lead_id: 2, to_stage: 'inicio', moved_at: new Date(now - 30 * H) }, { lead_id: 2, to_stage: 'aguardando', moved_at: new Date(now - 10 * H) });
  const leads = [{ id: 1, stage: 'confirmado', stage_since: new Date(now - 10 * H) }, { id: 2, stage: 'aguardando', stage_since: new Date(now - 10 * H) }];
  const m = Lead.metrics(leads, mvs, now);
  const get = (a, b) => m.between.find((x) => x.from === a && x.to === b);
  assert.equal(m.between.length, 5);
  assert.equal(get('inicio', 'aguardando').n, 2); assert.equal(Math.round(get('inicio', 'aguardando').avg), 15); // (10 + 20) / 2
  assert.equal(Math.round(get('aguardando', 'aceitou').avg), 40);
  assert.equal(get('explicando', 'confirmado').avg, 20);
  const p1 = m.perLead.get(1); assert.equal(p1.final, true); assert.equal(p1.since_stage, null); assert.equal(Math.round(p1.avg_move), 18); assert.equal(Math.round(p1.total), 90); // relógio para em "Parceiro confirmado"
  assert.equal(m.perLead.get(2).moves, 1);
});

test('cadastrar: entra em Início, valida e registra no log', async () => {
  const bad = await add('X', 'afiliado'); assert.equal(bad.status, 303); assert.equal(await row('X'), undefined);
  assert.equal((await add('Paula Mendes', 'afiliado', '2026-11')).status, 303);
  const l = await row('Paula Mendes');
  assert.equal(l.stage, 'inicio'); assert.equal(l.tag, 'afiliado'); assert.equal((await q("SELECT to_char(entry_month,'YYYY-MM') m FROM partner_leads WHERE id=$1", [l.id])).rows[0].m, '2026-11');
  const moves = (await q('SELECT * FROM partner_lead_moves WHERE lead_id=$1', [l.id])).rows;
  assert.equal(moves.length, 1); assert.equal(moves[0].from_stage, null); assert.equal(moves[0].to_stage, 'inicio');
  await add('Paula Mendes', 'tag-invalida'); assert.equal((await q('SELECT count(*)::int n FROM partner_leads WHERE name=$1', ['Paula Mendes'])).rows[0].n, 1);
  assert.equal((await q("SELECT count(*)::int n FROM audit_log WHERE action='partner_lead_created'")).rows[0].n, 1);
});

test('mover: registra o movimento, ignora repetido e etapa inválida', async () => {
  await add('Rogério Alves', 'divulgador'); const l = await row('Rogério Alves');
  await mv(l.id, 'aguardando'); await mv(l.id, 'aguardando'); await mv(l.id, 'aceitou'); await mv(l.id, 'nao-existe');
  const cur = await row('Rogério Alves'); assert.equal(cur.stage, 'aceitou');
  const moves = (await q('SELECT from_stage, to_stage FROM partner_lead_moves WHERE lead_id=$1 ORDER BY id', [l.id])).rows;
  assert.deepEqual(moves.map((m) => m.to_stage), ['inicio', 'aguardando', 'aceitou']);
  assert.equal(moves[2].from_stage, 'aguardando');
  assert.equal((await q("SELECT count(*)::int n FROM audit_log WHERE action='partner_lead_moved' AND entity_id=$1", [String(l.id)])).rows[0].n, 2);
  assert.equal((await mv(99999999, 'aceitou')).status, 404);
  assert.equal((await mv('abc', 'aceitou')).status, 404);
  // pode voltar etapa e ir para "sem retorno"
  await mv(l.id, 'inicio'); await mv(l.id, 'sem'); assert.equal((await row('Rogério Alves')).stage, 'sem');
});

test('editar nome, perfil e mês', async () => {
  await add('Camila Duarte'); const l = await row('Camila Duarte');
  assert.equal((await admin.post(`/admin/lead-parceiros/${l.id}/editar`, { name: 'Camila Duarte Souza', tag: 'divulgador', month: '2026-10' }, '/admin/lead-parceiros')).status, 303);
  const u = (await q('SELECT name, tag, to_char(entry_month,\'YYYY-MM\') m FROM partner_leads WHERE id=$1', [l.id])).rows[0];
  assert.deepEqual([u.name, u.tag, u.m], ['Camila Duarte Souza', 'divulgador', '2026-10']);
  await admin.post(`/admin/lead-parceiros/${l.id}/editar`, { name: '', tag: 'afiliado', month: '2026-10' }, '/admin/lead-parceiros');
  assert.equal((await q('SELECT name FROM partner_leads WHERE id=$1', [l.id])).rows[0].name, 'Camila Duarte Souza');
});

test('página: menu, quadro com as 7 colunas, métricas e escape de HTML', async () => {
  await add('<b>Tiago</b> & Cia', 'divulgador');
  const r = await admin.get('/admin/lead-parceiros'); assert.equal(r.status, 200);
  assert.match(r.text, /href="\/admin\/lead-parceiros"[^>]*>[\s\S]{0,900}?Lead Parceiros/);
  for (const s of Lead.STAGES) assert.ok(r.text.includes(s.name), s.name);
  assert.equal((r.text.match(/class="lp-col[ "]/g) || []).length, 7);
  assert.match(r.text, /Tempo médio entre etapas/); assert.match(r.text, /Tempo por lead/);
  assert.ok(!r.text.includes('<b>Tiago</b>')); assert.match(r.text, /&lt;b&gt;Tiago&lt;\/b&gt;/);
  assert.match(r.text, /src="\/static\/js\/leads\.js/);
  assert.equal((await admin.get('/static/js/leads.js')).status, 200);
});

test('só administrador acessa e nada se espalha para afiliados, usuários ou cupons', async () => {
  const before = (await q('SELECT (SELECT count(*) FROM affiliates)::int a, (SELECT count(*) FROM users)::int u, (SELECT count(*) FROM coupons)::int c, (SELECT count(*) FROM enrollments)::int e')).rows[0];
  await add('Letícia Prado'); const l = await row('Letícia Prado'); await mv(l.id, 'confirmado');
  const after2 = (await q('SELECT (SELECT count(*) FROM affiliates)::int a, (SELECT count(*) FROM users)::int u, (SELECT count(*) FROM coupons)::int c, (SELECT count(*) FROM enrollments)::int e')).rows[0];
  assert.deepEqual(after2, before);
  const stu = await makeStudent(t, { email: 'aluno-lead@example.com', name: 'Aluno Lead' });
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING", [stu.id]);
  const b = new Browser(t.base); await b.login(stu.email, stu.password);
  const g = await b.get('/admin/lead-parceiros'); assert.notEqual(g.status, 200);
  assert.ok(!g.text.includes('Letícia Prado'));
  const anon = await new Browser(t.base).get('/admin/lead-parceiros'); assert.notEqual(anon.status, 200);
  assert.equal(JSON.parse((await new Browser(t.base).get('/version')).text).display, '1.3');
});

test('etapa final para o relógio; horas arredondadas; mover registra o mesmo horário em lead e histórico', async () => {
  const H = 3600000; const now = Date.now();
  const mvs = [['inicio', 100], ['aguardando', 60], ['confirmado', 20]].map(([s, h]) => ({ lead_id: 1, to_stage: s, moved_at: new Date(now - h * H) }));
  const m = Lead.metrics([{ id: 1, stage: 'confirmado', stage_since: new Date(now - 20 * H) }], mvs, now).perLead.get(1);
  assert.equal(m.final, true); assert.equal(m.since_stage, null); assert.equal(Math.round(m.total), 80);
  assert.equal(Lead.hours(9.96), '10 h'); assert.equal(Lead.hours(2.5), '2,5 h'); assert.equal(Lead.hours(null), '—');
  await add('Horário Certo');
  assert.match((await admin.get('/admin/lead-parceiros')).text, /alert--success/);
  const l = await row('Horário Certo'); await mv(l.id, 'aguardando');
  const a = (await q('SELECT stage_since FROM partner_leads WHERE id=$1', [l.id])).rows[0].stage_since;
  const b = (await q("SELECT moved_at FROM partner_lead_moves WHERE lead_id=$1 AND to_stage='aguardando'", [l.id])).rows[0].moved_at;
  assert.equal(a.getTime(), b.getTime());
});
