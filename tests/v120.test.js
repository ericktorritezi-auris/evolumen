'use strict';
// 1.2.0 · Programa de afiliados, parte 2: convite, primeiro acesso, Termo, painel somente leitura, isolamento,
// avisos no sino, LGPD e reset de lançamento.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent, mailer } = require('./helpers');
const AFF = require('../src/affiliates');
const L = require('../src/launch');
const lgpd = require('../src/lgpd');
const notify = require('../src/notify');
const acceptance = require('../src/acceptance');

let t; let admin; let course; const slug = 'curso-painel';
const q = (sql, p) => t.pool.query(sql, p);
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';
let cpfN = 500; let buyerN = 0;
function genCpf(n) {
  const d = String(100000000 + n * 7919).slice(0, 9).split('').map(Number);
  for (let k = 0; k < 2; k++) { const len = 9 + k; const sum = d.slice(0, len).reduce((a, v, i) => a + v * (len + 1 - i), 0); const r = (sum * 10) % 11; d.push(r === 10 ? 0 : r); }
  return d.join('');
}
const form = (over = {}) => ({ name: 'Bruna Compradora Silva', email: `cliente${++buyerN}@example.com`, phone: '11987654321', cpf: genCpf(++cpfN), cep: '01310100', street: 'Av. Paulista', street_number: '1000', complement: '', district: 'Bela Vista', city: 'São Paulo', state: 'SP', method: 'pix', accept: '1', ...over });
const sim = (pub, result) => admin.post(`/admin/simulador/${pub}`, { result }, '/admin/simulador');
async function buy(code, over = {}) {
  const b = new Browser(t.base);
  const r = await b.post(`/checkout/${slug}`, { ...form(over), cupom: code }, `/checkout/${slug}`);
  assert.equal(r.status, 303, 'checkout');
  const pub = r.location.replace('/pedido/', '');
  await sim(pub, 'approved');
  return (await q('SELECT * FROM orders WHERE public_id=$1', [pub])).rows[0];
}
const newAffiliate = async (name, email) => {
  await admin.post('/admin/afiliados', { name, email, phone: '(11) 98888-7777', note: 'Pix reservado XYZ' }, '/admin/afiliados/novo');
  return (await q('SELECT * FROM affiliates WHERE lower(email)=$1', [email.toLowerCase()])).rows[0];
};
const newCoupon = async (affId, pct, code) => {
  await admin.post('/admin/cupons', { code, kind: 'percent', percent: '20', max_uses: '500', courses: [String(course)], affiliate_id: String(affId), commission_pct: pct }, '/admin/cupons/novo');
  return (await q('SELECT * FROM coupons WHERE code=$1', [code])).rows[0];
};
const invite = (a) => admin.post(`/admin/afiliados/${a.id}/convidar`, {}, `/admin/afiliados/${a.id}`);
const lastMail = (to) => [...mailer.memory].reverse().find((m) => m.to === to);
const accept = (uid) => q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING", [uid]);

let dora; let doraC; let ester; let esterC; let bDora; let bEster;

before(async () => {
  t = await boot({ ALLOW_LAUNCH_RESET: '1' }); admin = await adminReady(t);
  await admin.post('/admin/cursos', { title: 'Curso Painel', slug, summary: 'Resumo.', description: 'Desc', price: '100,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '1', expiry_notice_days: '30' }, '/admin/cursos/novo');
  course = (await q('SELECT id FROM courses WHERE slug=$1', [slug])).rows[0].id;
  await q("UPDATE courses SET status='published', published_at=now() - interval '1 day' WHERE id=$1", [course]);
  const mod = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'M',1) RETURNING id", [course])).rows[0].id;
  await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'A',1,'dQw4w9WgXcQ')", [course, mod]);
  await q("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy')", [LONG]);
  await accept((await q("SELECT id FROM users WHERE role='admin'")).rows[0].id);
});
after(async () => { await t.close(); });

test('convite: cria a conta com senha provisória, manda e-mail, pede primeiro acesso e só então abre o painel', async () => {
  dora = await newAffiliate('Dora Divulgadora', 'dora@example.com');
  doraC = await newCoupon(dora.id, '10', 'DORA20');
  assert.match((await admin.get(`/admin/afiliados/${dora.id}`)).text, /Acesso ao painel/);
  mailer.memory.length = 0;
  const r = await invite(dora); assert.equal(r.status, 303);
  const u = (await q("SELECT * FROM users WHERE email='dora@example.com'")).rows[0];
  assert.ok(u); assert.equal(u.role, 'student'); assert.equal(u.must_change_password, true);
  const a = (await q('SELECT * FROM affiliates WHERE id=$1', [dora.id])).rows[0];
  assert.equal(String(a.user_id), String(u.id)); assert.ok(a.invited_at);
  await t.app.locals.idle();
  const mail = lastMail('dora@example.com'); assert.ok(mail, 'e-mail de convite'); assert.equal(mail.template, 'afiliado_convite');
  const pass = mail.text.match(/Senha provisória: (\S+)/)[1];
  const aud = (await q("SELECT meta FROM audit_log WHERE action='affiliate_invited'")).rows; assert.equal(aud.length, 1); assert.equal(aud[0].meta.modo, 'created');
  assert.doesNotMatch(JSON.stringify(aud[0].meta), new RegExp(pass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'senha nunca no log');
  // reenvio antes do primeiro acesso: senha nova, a antiga deixa de valer
  mailer.memory.length = 0;
  await invite(dora); await t.app.locals.idle();
  const pass2 = lastMail('dora@example.com').text.match(/Senha provisória: (\S+)/)[1]; assert.notEqual(pass2, pass);
  const bad = new Browser(t.base); const old = await bad.login('dora@example.com', pass); assert.equal(old.status === 303 && old.location === '/primeiro-acesso', false, 'senha antiga não entra');
  bDora = new Browser(t.base);
  const lg = await bDora.login('dora@example.com', pass2); assert.equal(lg.location, '/primeiro-acesso');
  assert.equal((await bDora.get('/afiliado')).status, 303, 'sem trocar a senha não vê o painel');
  const fa = await bDora.post('/primeiro-acesso', { current: pass2, password: 'SenhaDora2026', confirm: 'SenhaDora2026' });
  assert.equal(fa.status, 303); assert.equal(fa.location, '/afiliado', 'afiliado puro vai para o painel');
  await accept((await q("SELECT id FROM users WHERE email='dora@example.com'")).rows[0].id);
  // depois do primeiro acesso, convidar de novo não gera senha
  mailer.memory.length = 0;
  const again = await invite(dora); assert.equal(again.status, 303);
  assert.equal(mailer.memory.length, 0);
  assert.equal((await q("SELECT count(*)::int n FROM audit_log WHERE action='affiliate_invited'")).rows[0].n, 2);
  // e-mail do afiliado com conta não muda mais
  const ed = await admin.post(`/admin/afiliados/${dora.id}`, { name: 'Dora Divulgadora', email: 'outro@example.com', phone: '11988887777', note: '' }, `/admin/afiliados/${dora.id}`);
  assert.equal((await q('SELECT email FROM affiliates WHERE id=$1', [dora.id])).rows[0].email, 'dora@example.com'); assert.ok(ed.status === 422 || ed.status === 303);
});

test('convite: conta de aluno existente é ligada sem senha nova; administrador e conta bloqueada são recusados', async () => {
  const edu = await makeStudent(t, { email: 'edu@example.com', name: 'Edu Aluno' }); await accept(edu.id);
  await q("INSERT INTO enrollments (user_id, course_id, origin) VALUES ($1,$2,'manual')", [edu.id, course]);
  const ea = await newAffiliate('Edu Aluno', 'edu@example.com'); await newCoupon(ea.id, '8', 'EDU8');
  mailer.memory.length = 0;
  await invite(ea); await t.app.locals.idle();
  const u = (await q('SELECT * FROM users WHERE id=$1', [edu.id])).rows[0]; assert.equal(u.must_change_password, false, 'senha dele continua valendo');
  assert.equal((await q('SELECT user_id FROM affiliates WHERE id=$1', [ea.id])).rows[0].user_id, String(edu.id) === String(edu.id) ? u.id : null);
  const m = lastMail('edu@example.com'); assert.ok(m); assert.doesNotMatch(m.text, /Senha provisória/);
  const b = new Browser(t.base); const lg = await b.login(edu.email, edu.password); assert.equal(lg.location, '/meus-cursos', 'aluno continua indo para os cursos');
  const menu = await b.get('/meus-cursos'); assert.match(menu.text, /href="\/afiliado"/); assert.match(menu.text, /Meus produtos/);
  const pg = await b.get('/afiliado'); assert.equal(pg.status, 200); assert.match(pg.text, /EDU8/);
  // administrador
  const adm = (await q("SELECT email FROM users WHERE role='admin'")).rows[0].email;
  const aa = await newAffiliate('Admin Mesmo', adm); await invite(aa);
  assert.equal((await q('SELECT user_id FROM affiliates WHERE id=$1', [aa.id])).rows[0].user_id, null);
  // bloqueada
  const bl = await makeStudent(t, { email: 'bloq@example.com', name: 'Bloq Aluno' }); await q("UPDATE users SET status='blocked' WHERE id=$1", [bl.id]);
  const ba = await newAffiliate('Bloq Aluno', 'bloq@example.com'); await invite(ba);
  assert.equal((await q('SELECT user_id FROM affiliates WHERE id=$1', [ba.id])).rows[0].user_id, null);
  // afiliado inativo não é convidado
  const ia = await newAffiliate('Inativa Pessoa', 'inativa@example.com');
  await admin.post(`/admin/afiliados/${ia.id}/inativar`, {}, `/admin/afiliados/${ia.id}`); await invite(ia);
  assert.equal((await q('SELECT user_id FROM affiliates WHERE id=$1', [ia.id])).rows[0].user_id, null);
  // a mesma conta não liga a dois afiliados (índice único)
  await assert.rejects(q('INSERT INTO affiliates (name,email,phone,user_id) VALUES ($1,$2,$3,$4)', ['Dup', 'dup@example.com', '11999990000', u.id]));
});

test('painel: mostra só os dados do próprio afiliado, com nomes abreviados e sem dados pessoais do comprador', async () => {
  ester = await newAffiliate('Ester Parceira', 'ester@example.com'); esterC = await newCoupon(ester.id, '20', 'ESTER20');
  await invite(ester); await t.app.locals.idle();
  const pass = lastMail('ester@example.com').text.match(/Senha provisória: (\S+)/)[1];
  bEster = new Browser(t.base); await bEster.login('ester@example.com', pass);
  await bEster.post('/primeiro-acesso', { current: pass, password: 'SenhaEster2026', confirm: 'SenhaEster2026' });
  await accept((await q("SELECT id FROM users WHERE email='ester@example.com'")).rows[0].id);
  const o1 = await buy('DORA20', { name: 'Fernanda Almeida Prado', email: 'fernanda.prado@example.com' });
  const o2 = await buy('ESTER20', { name: 'Gustavo Henrique Lima', email: 'gustavo.lima@example.com' });
  const cpf1 = (await q('SELECT cpf FROM users WHERE id=$1', [o1.user_id])).rows[0].cpf;
  const pd = await bDora.get('/afiliado'); assert.equal(pd.status, 200);
  assert.match(pd.headers.get('cache-control') || pd.headers['cache-control'] || '', /no-store/);
  assert.match(pd.text, /DORA20/); assert.match(pd.text, /Fernanda P\./); assert.match(pd.text, /10(,0)?%/);
  assert.doesNotMatch(pd.text, /ESTER20/); assert.doesNotMatch(pd.text, /Gustavo/); assert.doesNotMatch(pd.text, /EDU8/);
  for (const secret of ['fernanda.prado@example.com', '11987654321', cpf1, 'Fernanda Almeida Prado', 'Pix reservado XYZ', o1.public_id]) assert.equal(pd.text.includes(secret), false, 'vaza: ' + secret);
  const pe = await bEster.get('/afiliado'); assert.match(pe.text, /ESTER20/); assert.match(pe.text, /Gustavo L\./); assert.doesNotMatch(pe.text, /DORA20|Fernanda/);
  // menu enxuto do afiliado puro
  const hrefs = [...pd.text.matchAll(/<a[^>]+class="[^"]*nav[^"]*"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  for (const bad of ['/meus-cursos', '/admin', '/loja']) assert.equal(hrefs.includes(bad), false, 'menu: ' + bad);
  assert.match(pd.text, /href="\/perfil"/);
  // imagem do cupom: só o próprio
  const mine = await bDora.get(`/afiliado/cupom/${doraC.id}/imagem.png`); assert.equal(mine.status, 200);
  assert.equal((await bDora.get(`/afiliado/cupom/${esterC.id}/imagem.png`)).status, 404);
  assert.equal((await bDora.get('/afiliado/cupom/999999/imagem.png')).status, 404);
  // sem rota de escrita
  const csrf = await bDora.csrf('/afiliado');
  for (const m of ['POST', 'PUT', 'DELETE']) assert.ok([403, 404, 405].includes((await bDora.req(m, '/afiliado', m === 'POST' ? { _csrf: csrf } : null)).status), m);
  // comissão liberada e repasse aparecem nos números
  await q("UPDATE commissions SET release_at = now() - interval '1 minute' WHERE order_id=$1", [o1.id]);
  const rel = await bDora.get('/afiliado'); assert.match(rel.text, /Liberad/);
  await admin.post(`/admin/afiliados/${dora.id}/repasses`, { amount: '3,00', paid_on: new Date().toISOString().slice(0, 10), note: 'nota interna sigilosa' }, `/admin/afiliados/${dora.id}`);
  const pay = await bDora.get('/afiliado'); assert.match(pay.text, /3,00/); assert.doesNotMatch(pay.text, /nota interna sigilosa/);
});

test('isolamento: aluno comum, administrador e anônimo recebem 404/redirecionamento; afiliado puro não entra em áreas dos outros', async () => {
  const stu = await makeStudent(t, { email: 'comum2@example.com', name: 'Aluna Comum' }); await accept(stu.id);
  const sb = new Browser(t.base); await sb.login(stu.email, stu.password);
  assert.equal((await sb.get('/afiliado')).status, 404);
  assert.equal((await sb.get(`/afiliado/cupom/${doraC.id}/imagem.png`)).status, 404);
  assert.doesNotMatch((await sb.get('/meus-cursos')).text, /href="\/afiliado"/);
  assert.equal((await admin.get('/afiliado')).status, 404, 'administrador não tem painel de afiliado');
  const anon = new Browser(t.base); const ra = await anon.get('/afiliado'); assert.ok([302, 303].includes(ra.status)); assert.match(ra.location, /entrar/);
  // afiliado puro: sem acesso a admin nem a curso sem matrícula
  assert.equal((await bDora.get('/admin')).status === 200, false);
  assert.equal((await bDora.get('/admin/afiliados')).status === 200, false);
  const aula = await bDora.get(`/curso/${slug}`); assert.equal(aula.status === 200 && /dQw4w9WgXcQ/.test(aula.text), false, 'login não dá acesso ao curso');
  const rootHome = await bDora.get('/meus-cursos'); assert.ok(!/dQw4w9WgXcQ/.test(rootHome.text));
  // afiliado inativo perde o painel mas a conta continua
  await admin.post(`/admin/afiliados/${ester.id}/inativar`, {}, `/admin/afiliados/${ester.id}`);
  assert.equal((await bEster.get('/afiliado')).status, 200, 'inativo ainda vê histórico (somente leitura)');
  await admin.post(`/admin/afiliados/${ester.id}/reativar`, {}, `/admin/afiliados/${ester.id}`);
});

test('Termo do Programa de Afiliados: depois de publicado, só o afiliado é parado no aceite; aluno comum segue livre', async () => {
  const d = (await q("SELECT id FROM legal_documents WHERE doc_type='affiliate'")).rows[0];
  const stu = (await q("SELECT id FROM users WHERE email='comum2@example.com'")).rows[0];
  await admin.post(`/admin/textos/${d.id}`, { body_html: LONG }, `/admin/textos/${d.id}`);
  await admin.post(`/admin/textos/${d.id}/publicar`, {}, `/admin/textos/${d.id}`);
  assert.deepEqual(await acceptance.pendingFor(stu.id), []);
  const du = (await q("SELECT id FROM users WHERE email='dora@example.com'")).rows[0];
  assert.deepEqual((await acceptance.pendingFor(du.id)).map((x) => x.doc_type).includes('affiliate'), true);
  const r = await bDora.get('/afiliado'); assert.equal(r.status, 303); assert.equal(r.location, '/aceite');
  const page = await bDora.get('/aceite'); assert.match(page.text, /Termo do Programa de Afiliados/);
  assert.match((await admin.get(`/admin/afiliados/${dora.id}`)).text, /Termo/);
  await accept(du.id);
  assert.equal((await bDora.get('/afiliado')).status, 200);
  assert.match((await admin.get(`/admin/afiliados/${dora.id}`)).text, /aceit/i);
});

test('avisos no sino: comissão liberada (uma vez só) e repasse registrado; reembolso aberto e comissão cancelada não avisam', async () => {
  const du = (await q("SELECT id FROM users WHERE email='dora@example.com'")).rows[0];
  const eu = (await q("SELECT id FROM users WHERE email='ester@example.com'")).rows[0];
  const pay = (await notify.list(du.id)).items.filter((x) => x.title === 'Repasse registrado'); assert.equal(pay.length, 1);
  await q("UPDATE affiliates SET invited_at = now() - interval '3 days' WHERE id=$1", [dora.id]);
  const n1 = await AFF.notifyReleased(notify, new Date()); assert.ok(n1 >= 1);
  const rel = (await notify.list(du.id)).items.filter((x) => x.title === 'Comissão liberada'); assert.equal(rel.length, 1);
  assert.equal(await AFF.notifyReleased(notify, new Date()), 0, 'idempotente');
  assert.equal((await notify.list(du.id)).items.filter((x) => x.title === 'Comissão liberada').length, 1);
  // Ester: venda com reembolso aberto não avisa; cancelada não avisa
  const o = (await q("SELECT o.id, o.public_id FROM orders o JOIN commissions m ON m.order_id=o.id WHERE m.affiliate_id=$1", [ester.id])).rows[0];
  await q("UPDATE commissions SET release_at = now() - interval '1 minute' WHERE order_id=$1", [o.id]);
  await q("UPDATE commissions SET status='cancelled', cancelled_at=now(), cancel_reason='Reembolso' WHERE order_id=$1", [o.id]);
  await AFF.notifyReleased(notify, new Date());
  assert.equal((await notify.list(eu.id)).items.filter((x) => x.title === 'Comissão liberada').length, 0);
  // venda anterior ao convite não gera aviso
  await q("UPDATE commissions SET status='active', cancelled_at=NULL, cancel_reason='', release_at = (SELECT invited_at FROM affiliates WHERE id=$2) - interval '1 day' WHERE order_id=$1", [o.id, ester.id]);
  await AFF.notifyReleased(notify, new Date());
  assert.equal((await notify.list(eu.id)).items.filter((x) => x.title === 'Comissão liberada').length, 0, 'anterior ao convite');
  // e-mail do repasse
  assert.ok(mailer.memory.some((m) => m.to === 'dora@example.com' && m.template === 'afiliado_repasse'), 'e-mail de repasse');
  // a tarefa agendada roda o passo de afiliados sem quebrar
  const R = require('../src/reminders');
  await assert.doesNotReject(R.run(t.cfg, new Date()));
});

test('LGPD: exportação inclui os dados de afiliado e a anonimização limpa o cadastro, preservando os valores', async () => {
  const eu = (await q("SELECT id FROM users WHERE email='ester@example.com'")).rows[0];
  const ex = await lgpd.exportFor(eu.id);
  assert.ok(ex.afiliado, 'afiliado'); assert.ok(Array.isArray(ex.afiliado_comissoes)); assert.ok(Array.isArray(ex.afiliado_repasses));
  assert.equal(ex.afiliado[0].email, 'ester@example.com');
  const before = (await q('SELECT count(*)::int n FROM commissions WHERE affiliate_id=$1', [ester.id])).rows[0].n;
  await t.pool.query('BEGIN'); await t.pool.query('ROLLBACK');
  const c = await t.pool.connect();
  try { await c.query('BEGIN'); await lgpd.anonymize(eu.id, c); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  const a = (await q('SELECT * FROM affiliates WHERE id=$1', [ester.id])).rows[0];
  assert.equal(a.name, 'Afiliado removido'); assert.match(a.email, /^removido-afiliado-\d+@removido\.invalid$/); assert.equal(a.status, 'inactive'); assert.ok(!a.phone); assert.equal(a.note === null || a.note === '', true);
  assert.equal((await q('SELECT count(*)::int n FROM commissions WHERE affiliate_id=$1', [ester.id])).rows[0].n, before, 'valores ficam para a contabilidade');
});

test('reset de lançamento: conta de afiliado de teste é apagada e o cadastro do afiliado fica, sem vínculo', async () => {
  const du = (await q("SELECT id FROM users WHERE email='dora@example.com'")).rows[0];
  const prev = await L.preview(['dora@example.com']);
  const out = await L.run(['dora@example.com'], prev.sig); assert.ok(out);
  assert.equal((await q("SELECT count(*)::int n FROM users WHERE id=$1", [du.id])).rows[0].n, 0);
  const a = (await q('SELECT * FROM affiliates WHERE id=$1', [dora.id])).rows[0];
  assert.ok(a, 'afiliado continua'); assert.equal(a.user_id, null); assert.equal(a.invited_at, null);
  // pode ser convidado de novo
  await invite(dora); assert.ok((await q('SELECT user_id FROM affiliates WHERE id=$1', [dora.id])).rows[0].user_id);
});

test('migração 016: roda duas vezes sem erro e mantém o índice único', async () => {
  const fs = require('fs'); const path = require('path');
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/016_affiliate_panel.sql'), 'utf8');
  await q(sql); await q(sql);
  assert.equal((await q("SELECT count(*)::int n FROM pg_indexes WHERE indexname='affiliates_user_uq'")).rows[0].n, 1);
});

test('1.2.1: link do criador na página inicial abre o site do Erick em nova aba, com rel seguro', async () => {
  const home = await new Browser(t.base).get('/');
  assert.match(home.text, /<a href="https:\/\/www\.ericktorritezi\.com\.br" target="_blank" rel="noopener noreferrer">Saiba mais sobre o psicoterapeuta Erick Torritezi/);
});
