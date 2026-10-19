'use strict';
// 0.3.0 · Etapa de base: fonte, log de 30 dias, cortesia, inativar/excluir, cupons (imagem, QR, envio) e a regra de acesso.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent, mailer } = require('./helpers');
const K = require('../src/coupons');

let t; let admin; let c1; let c2;
const form = (o = {}) => ({ title: 'Protocolo ESSÊNCIA', slug: 'protocolo-essencia', summary: 'Um percurso guiado.', description: 'Descrição', price: '200,00', level: 'iniciante', access_type: 'lifetime', max_installments: '12', sort_order: '10', expiry_notice_days: '30,7,1', publish: '1', ...o });
const wait = async (fn, ms = 1500) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 20)); } };
const courseId = async (slug) => (await t.pool.query('SELECT id FROM courses WHERE slug=$1', [slug])).rows[0].id;
const PNG = [0x89, 0x50, 0x4e, 0x47];

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await admin.post('/admin/cursos', form(), '/admin/cursos/novo');
  await admin.post('/admin/cursos', form({ title: 'Meditação guiada', slug: 'meditacao-guiada', price: '120,00', promo_price: '90,00' }), '/admin/cursos/novo');
  c1 = await courseId('protocolo-essencia'); c2 = await courseId('meditacao-guiada');
});
after(async () => { await t.close(); });

test('fonte: Quicksand e Nunito saem do próprio servidor, sem Google', async () => {
  const b = new Browser(t.base);
  for (const f of ['quicksand', 'nunito']) {
    const r = await fetch(`${t.base}/static/fonts/${f}-latin-wght-normal.woff2`); assert.equal(r.status, 200);
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString(), 'wOF2');
  }
  const home = await b.get('/');
  assert.doesNotMatch(home.text, /fonts\.googleapis|fonts\.gstatic/); assert.match(home.text, /quicksand-latin-wght-normal\.woff2/);
  assert.doesNotMatch(home.headers.get('content-security-policy'), /googleapis|gstatic/);
  const css = await (await fetch(`${t.base}/static/css/app.css`)).text();
  assert.match(css, /@font-face\{font-family:Quicksand/); assert.match(css, /font-family:Nunito/); assert.doesNotMatch(css, /Sora|Manrope/);
});

test('log: registros recentes são imutáveis, os de mais de 30 dias podem sair', async () => {
  await assert.rejects(t.pool.query('DELETE FROM audit_log'), /imutável/);
  await assert.rejects(t.pool.query("UPDATE audit_log SET action = 'x'"), /imutável/);
  await assert.rejects(t.pool.query('TRUNCATE audit_log'), /imutável/);
  await t.pool.query("INSERT INTO audit_log (at, action) VALUES (now() - interval '40 days', 'velho'), (now() - interval '29 days', 'quase_velho')");
  await t.pool.query("DELETE FROM audit_log WHERE at < now() - interval '30 days'");
  assert.equal((await t.pool.query("SELECT count(*)::int n FROM audit_log WHERE action IN ('velho')")).rows[0].n, 0);
  assert.equal((await t.pool.query("SELECT count(*)::int n FROM audit_log WHERE action = 'quase_velho'")).rows[0].n, 1);
  await assert.rejects(t.pool.query("DELETE FROM audit_log WHERE action = 'quase_velho'"), /imutável/);
  await assert.rejects(t.pool.query('TRUNCATE acceptances CASCADE'), /imutável/, 'aceites continuam imutáveis');
});

test('log: tela do administrador, 30 por página, filtros e acesso restrito', async () => {
  await t.pool.query("INSERT INTO audit_log (at, actor_email, action, meta) SELECT now() - (g || ' minutes')::interval, 'fulano@example.com', 'login_success', '{}' FROM generate_series(1, 65) g");
  const total = (await t.pool.query('SELECT count(*)::int n FROM audit_log')).rows[0].n;
  const p1 = await admin.get('/admin/log'); assert.equal(p1.status, 200);
  const rowsOf = (html) => (html.match(/<tr><td data-l="Quando">/g) || []).length;
  assert.equal(rowsOf(p1.text), 30); assert.match(p1.text, new RegExp(`Mostrando 1 a 30 de ${total}`)); assert.match(p1.text, /Página 1 de/);
  const pages = Math.ceil(total / 30);
  const last = await admin.get(`/admin/log?p=${pages}`); assert.equal(rowsOf(last.text), total - 30 * (pages - 1));
  assert.equal(rowsOf((await admin.get('/admin/log?p=9999')).text), total - 30 * (pages - 1), 'página fora do limite vai para a última');
  const f = await admin.get('/admin/log?acao=login_success&q=fulano'); assert.match(f.text, /fulano@example\.com/);
  const onlyOld = await admin.get('/admin/log?de=2001-01-01&ate=2001-01-02'); assert.match(onlyOld.text, /Nenhum registro neste filtro/);
  assert.match((await admin.get('/admin/log?q=%25%5C_')).text, /Nenhum registro neste filtro/, 'curingas do filtro são tratados como texto');
  const s = await makeStudent(t, { email: 'curiosa@example.com', name: 'Curiosa' }); const sb = new Browser(t.base); await sb.login(s.email, s.password);
  for (const u of ['/admin/log', '/admin/cupons', '/admin/cortesias', '/admin/alunos']) assert.equal((await sb.get(u)).status, 403, u);
  assert.notEqual((await new Browser(t.base).get('/admin/log')).status, 200);
});

test('cortesia: cria conta e matrícula, avisa por e-mail como presente e não cobra', async () => {
  mailer.memory.length = 0;
  const bad = await admin.post('/admin/cortesias', { course: String(c1), email: 'nova@example.com' }, '/admin/cortesias');
  assert.equal(bad.status, 422); assert.match(bad.text, /Informe o nome/);
  const ok = await admin.post('/admin/cortesias', { course: String(c1), email: 'Presente@Example.com', name: 'Ana Presente' }, '/admin/cortesias');
  assert.equal(ok.status, 200); assert.match(ok.text, /Cortesia concedida/);
  const u = (await t.pool.query("SELECT * FROM users WHERE email='presente@example.com'")).rows[0];
  const e = (await t.pool.query('SELECT * FROM enrollments WHERE user_id=$1', [u.id])).rows[0];
  assert.equal(e.origin, 'gift'); assert.equal(e.status, 'active'); assert.equal(u.must_change_password, true);
  const mail = await wait(() => mailer.memory.find((m) => m.to === 'presente@example.com'));
  assert.ok(mail); assert.equal(mail.template, 'cortesia_acesso'); assert.match(mail.subject, /presente/i); assert.match(mail.html, /cortesia, sem nenhum custo/); assert.match(mail.text, /Senha provisória/);
  // quem já tem conta recebe o aviso do curso, sem senha
  mailer.memory.length = 0;
  const again = await admin.post('/admin/cortesias', { course: String(c2), email: 'presente@example.com' }, '/admin/cortesias');
  assert.equal(again.status, 200); assert.doesNotMatch(again.text, /class="secret"/);
  const mail2 = await wait(() => mailer.memory.find((m) => m.to === 'presente@example.com')); assert.equal(mail2.template, 'cortesia_curso'); assert.doesNotMatch(mail2.text, /Senha provisória/);
  assert.match((await admin.get('/admin/cortesias')).text, /Ana Presente/);
  assert.equal((await t.pool.query("SELECT count(*)::int n FROM audit_log WHERE action = 'gift_granted'")).rows[0].n, 2);
  // validações
  assert.equal((await admin.post('/admin/cortesias', { course: '', email: 'x@example.com', name: 'Xis Ypsilon' }, '/admin/cortesias')).status, 422);
  assert.equal((await admin.post('/admin/cortesias', { course: String(c1), email: 'erick@example.com' }, '/admin/cortesias')).status, 422, 'administrador');
});

test('princípio: conta sem matrícula não acessa curso; matrícula cancelada perde o acesso e reativada volta', async () => {
  const s = await makeStudent(t, { email: 'so-conta@example.com', name: 'Só Conta' });
  const b = new Browser(t.base); await b.login(s.email, s.password);
  assert.equal((await b.get('/curso/protocolo-essencia')).status, 403);
  assert.match((await b.get('/meus-cursos')).text, /ainda não tem cursos/);
  await admin.post('/admin/cortesias', { course: String(c1), email: s.email }, '/admin/cortesias');
  assert.equal((await b.get('/curso/protocolo-essencia')).status, 200);
  const eid = (await t.pool.query('SELECT id FROM enrollments WHERE user_id=$1', [s.id])).rows[0].id;
  await admin.post(`/admin/matriculas/${eid}/cancelar`, { to: 'cortesias' }, '/admin/cortesias');
  assert.equal((await b.get('/curso/protocolo-essencia')).status, 403, 'cancelada');
  assert.doesNotMatch((await b.get('/meus-cursos')).text, /Protocolo ESSÊNCIA/);
  assert.match((await admin.get('/admin/cortesias')).text, /Cancelada/);
  assert.match((await b.get('/cursos/protocolo-essencia')).text, /Matrículas em breve/, 'cancelada não aparece como vencida');
  await admin.post(`/admin/matriculas/${eid}/reativar`, { to: 'cortesias' }, '/admin/cortesias');
  assert.equal((await b.get('/curso/protocolo-essencia')).status, 200);
  // com progresso a matrícula não se exclui
  const lessonId = (await t.pool.query("INSERT INTO modules (course_id, title, position) VALUES ($1,'M',1) RETURNING id", [c1])).rows[0].id;
  const l = (await t.pool.query('INSERT INTO lessons (course_id, module_id, title, position) VALUES ($1,$2,$3,1) RETURNING id', [c1, lessonId, 'Aula única'])).rows[0].id;
  await b.post(`/curso/protocolo-essencia/aula/${l}/concluir`, { done: '1' }, `/curso/protocolo-essencia/aula/${l}`);
  const del = await admin.post(`/admin/matriculas/${eid}/excluir`, { to: 'cortesias' }, '/admin/cortesias');
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM enrollments WHERE id=$1', [eid])).rows[0].n, 1, 'matrícula com histórico fica');
  assert.ok(del.location);
  const page = await admin.get(`/admin/cursos/${c1}/matriculas`);
  assert.doesNotMatch(page.text, new RegExp(`/admin/matriculas/${eid}/excluir`), 'botão Excluir some quando há progresso');
  assert.match(page.text, new RegExp(`/admin/matriculas/${eid}/cancelar`));
});

test('alunos: inativar bloqueia o login, reativar libera, só exclui sem vínculo', async () => {
  const linked = await makeStudent(t, { email: 'vinculada@example.com', name: 'Vinculada' });
  await admin.post('/admin/cortesias', { course: String(c2), email: linked.email }, '/admin/cortesias');
  const lone = await makeStudent(t, { email: 'engano@example.com', name: 'Criada por engano' });
  const list = await admin.get('/admin/alunos'); assert.equal(list.status, 200);
  assert.match(list.text, new RegExp(`/admin/alunos/${lone.id}/excluir`)); assert.doesNotMatch(list.text, new RegExp(`/admin/alunos/${linked.id}/excluir`));
  const denied = await admin.post(`/admin/alunos/${linked.id}/excluir`, {}, '/admin/alunos');
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM users WHERE id=$1', [linked.id])).rows[0].n, 1); assert.ok(denied.location);
  const b = new Browser(t.base); assert.equal((await b.login(linked.email, linked.password)).status, 303);
  await admin.post(`/admin/alunos/${linked.id}/inativar`, {}, '/admin/alunos');
  assert.equal((await b.get('/meus-cursos')).status, 303, 'sessão aberta cai ao inativar');
  assert.equal((await new Browser(t.base).login(linked.email, linked.password)).status, 401, 'não entra inativa');
  assert.match((await admin.get('/admin/alunos?situacao=inativos')).text, /Vinculada/);
  assert.doesNotMatch((await admin.get('/admin/alunos?situacao=ativos')).text, /Vinculada/);
  const blocked = await admin.post('/admin/cortesias', { course: String(c1), email: linked.email }, '/admin/cortesias');
  assert.equal(blocked.status, 422); assert.match(blocked.text, /conta deste aluno está inativa/);
  await admin.post(`/admin/alunos/${linked.id}/reativar`, {}, '/admin/alunos');
  assert.equal((await new Browser(t.base).login(linked.email, linked.password)).status, 303);
  await admin.post(`/admin/alunos/${lone.id}/excluir`, {}, '/admin/alunos');
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM users WHERE id=$1', [lone.id])).rows[0].n, 0, 'sem vínculo, exclui');
  assert.equal((await admin.post('/admin/alunos/1/excluir', {}, '/admin/alunos')).status, 404, 'administrador não aparece como aluno');
});

test('módulos e aulas: com progresso só inativam (e somem para o aluno); sem progresso excluem', async () => {
  const s = await makeStudent(t, { email: 'estudiosa@example.com', name: 'Estudiosa' });
  await admin.post('/admin/cortesias', { course: String(c2), email: s.email }, '/admin/cortesias');
  const m = (await t.pool.query("INSERT INTO modules (course_id, title, position) VALUES ($1,'Base',1) RETURNING id", [c2])).rows[0].id;
  const m2 = (await t.pool.query("INSERT INTO modules (course_id, title, position) VALUES ($1,'Extra',2) RETURNING id", [c2])).rows[0].id;
  const l1 = (await t.pool.query("INSERT INTO lessons (course_id, module_id, title, position) VALUES ($1,$2,'Aula A',1) RETURNING id", [c2, m])).rows[0].id;
  const l2 = (await t.pool.query("INSERT INTO lessons (course_id, module_id, title, position) VALUES ($1,$2,'Aula B',2) RETURNING id", [c2, m])).rows[0].id;
  const l3 = (await t.pool.query("INSERT INTO lessons (course_id, module_id, title, position) VALUES ($1,$2,'Aula C',1) RETURNING id", [c2, m2])).rows[0].id;
  const sb = new Browser(t.base); await sb.login(s.email, s.password);
  const url = (id) => `/curso/meditacao-guiada/aula/${id}`;
  await sb.post(`${url(l1)}/concluir`, { done: '1' }, url(l1));
  assert.match((await sb.get('/meus-cursos')).text, /33%/);
  const back = `/admin/cursos/${c2}/conteudo`;
  await admin.post(`/admin/aulas/${l1}/excluir`, {}, back);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM lessons WHERE id=$1', [l1])).rows[0].n, 1, 'aula com progresso não exclui');
  await admin.post(`/admin/modulos/${m}/excluir`, {}, back);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM modules WHERE id=$1', [m])).rows[0].n, 1, 'módulo com progresso não exclui');
  const conteudo = await admin.get(back);
  assert.doesNotMatch(conteudo.text, new RegExp(`/admin/aulas/${l1}/excluir`)); assert.match(conteudo.text, new RegExp(`/admin/aulas/${l2}/excluir`)); assert.match(conteudo.text, new RegExp(`/admin/aulas/${l3}/excluir`));
  await admin.post(`/admin/aulas/${l1}/inativar`, {}, back);
  assert.equal((await sb.get(url(l1))).status, 404, 'aula inativa some para o aluno');
  assert.match((await sb.get('/curso/meditacao-guiada')).text, /Aula B/); assert.doesNotMatch((await sb.get('/curso/meditacao-guiada')).text, /Aula A/);
  assert.match((await sb.get('/meus-cursos')).text, /0%/, 'progresso recalculado sem a aula inativa');
  assert.equal((await admin.get(url(l1))).status, 200, 'administrador ainda vê');
  assert.match((await admin.get(back)).text, /Inativa/);
  await admin.post(`/admin/aulas/${l1}/reativar`, {}, back); assert.equal((await sb.get(url(l1))).status, 200);
  await admin.post(`/admin/modulos/${m}/inativar`, {}, back);
  assert.equal((await sb.get(url(l2))).status, 404, 'módulo inativo esconde as aulas'); assert.equal((await sb.get(url(l3))).status, 200);
  await admin.post(`/admin/modulos/${m}/reativar`, {}, back);
  await admin.post(`/admin/aulas/${l3}/excluir`, {}, back); await admin.post(`/admin/modulos/${m2}/excluir`, {}, back);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM lessons WHERE id=$1', [l3])).rows[0].n, 0); assert.equal((await t.pool.query('SELECT count(*)::int n FROM modules WHERE id=$1', [m2])).rows[0].n, 0);
});

test('cupom: cria com código gerado ou próprio e valida as regras', async () => {
  const ok = await admin.post('/admin/cupons', { kind: 'percent', percent: '20', max_uses: '50', courses: String(c1) }, '/admin/cupons/novo');
  assert.equal(ok.status, 303); assert.match(ok.location, /^\/admin\/cupons\/\d+$/);
  const c = (await t.pool.query('SELECT * FROM coupons ORDER BY id DESC LIMIT 1')).rows[0];
  assert.match(c.code, /^EVO-[2-9A-HJ-NP-Z]{6}$/); assert.equal(c.percent, 20); assert.equal(c.status, 'active');
  const own = await admin.post('/admin/cupons', { code: 'natal-2026', kind: 'fixed', amount: '50,00', ends_on: '2099-12-31', courses: [String(c1), String(c2)] }, '/admin/cupons/novo');
  assert.equal(own.status, 303);
  const o = (await t.pool.query("SELECT * FROM coupons WHERE code='NATAL-2026'")).rows[0]; assert.equal(o.amount_cents, 5000);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM coupon_courses WHERE coupon_id=$1', [o.id])).rows[0].n, 2);
  const post = (b) => admin.post('/admin/cupons', b, '/admin/cupons/novo');
  const dup = await post({ code: 'NATAL-2026', kind: 'percent', percent: '10', max_uses: '5', courses: String(c1) }); assert.equal(dup.status, 422); assert.match(dup.text, /Já existe um cupom com este código/);
  assert.match((await post({ kind: 'percent', percent: '10', courses: String(c1) })).text, /Defina um período/);
  assert.match((await post({ kind: 'percent', percent: '100', max_uses: '5', courses: String(c1) })).text, /1 a 99/);
  assert.match((await post({ kind: 'percent', percent: '0', max_uses: '5', courses: String(c1) })).text, /1 a 99/);
  assert.match((await post({ kind: 'fixed', amount: '200,00', max_uses: '5', courses: String(c1) })).text, /menor que o valor do curso/);
  assert.match((await post({ kind: 'fixed', amount: '0', max_uses: '5', courses: String(c1) })).text, /maior que zero/);
  assert.match((await post({ kind: 'percent', percent: '10', max_uses: '5' })).text, /pelo menos um curso/);
  assert.match((await post({ code: 'a b', kind: 'percent', percent: '10', max_uses: '5', courses: String(c1) })).text, /letras maiúsculas/);
  assert.match((await post({ kind: 'percent', percent: '10', starts_on: '2026-12-10', ends_on: '2026-12-01', courses: String(c1) })).text, /fim não pode ser antes/);
  assert.match((await post({ kind: 'percent', percent: '10', max_uses: '0', courses: String(c1) })).text, /número inteiro de usos/);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM coupons')).rows[0].n, 2, 'nada inválido foi gravado');
  assert.equal((await t.pool.query("SELECT count(*)::int n FROM audit_log WHERE action = 'coupon_created'")).rows[0].n, 2);
});

test('cupom: imagem PNG com QR, miniatura que abre em janela, baixar e link', async () => {
  const c = (await t.pool.query("SELECT * FROM coupons WHERE code='NATAL-2026'")).rows[0];
  const page = await admin.get(`/admin/cupons/${c.id}`); assert.equal(page.status, 200);
  assert.match(page.text, new RegExp(`src="/admin/cupons/${c.id}/imagem\\.png"`)); assert.match(page.text, /data-modal-open="cupom-modal"/); assert.match(page.text, /<dialog id="cupom-modal"/);
  assert.match(page.text, new RegExp(`/admin/cupons/${c.id}/imagem\\.png\\?baixar=1`)); assert.match(page.text, /http:\/\/localhost:3000\/cupom\/NATAL-2026/);
  const img = await fetch(`${t.base}/admin/cupons/${c.id}/imagem.png`, { headers: { cookie: admin.cookieHeader() } });
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await img.arrayBuffer()); assert.deepEqual([...buf.subarray(0, 4)], PNG); assert.ok(buf.length > 20000);
  assert.equal(buf.readUInt32BE(16), 1080); assert.equal(buf.readUInt32BE(20), 1350);
  const dl = await fetch(`${t.base}/admin/cupons/${c.id}/imagem.png?baixar=1`, { headers: { cookie: admin.cookieHeader() } });
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="?cupom-NATAL-2026\.png"?/);
  const anon = await fetch(`${t.base}/admin/cupons/${c.id}/imagem.png`, { redirect: 'manual' }); assert.notEqual(anon.status, 200, 'sem login não baixa'); assert.notEqual(anon.headers.get('content-type'), 'image/png');
  const s = await makeStudent(t, { email: 'curiosa2@example.com', name: 'Curiosa Dois' }); const sb = new Browser(t.base); await sb.login(s.email, s.password);
  assert.equal((await sb.get(`/admin/cupons/${c.id}/imagem.png`)).status, 403);
  const long = K.artPng({ baseUrl: 'https://evolumen.ericktorritezi.com.br' }, { code: 'EVO-ABCDEF', kind: 'percent', percent: 15, max_uses: 3, courses: [{ title: 'Um título de curso extremamente longo que precisa quebrar em linhas sem estourar a imagem do cupom' }] });
  assert.deepEqual([...long.subarray(0, 4)], PNG);
  assert.match(K.artSvg({ baseUrl: 'https://x.com' }, { code: 'A<B', kind: 'percent', percent: 5, courses: [{ title: '<script>x</script>' }] }), /A&lt;B/, 'texto é escapado na imagem');
});

test('cupom: envio por e-mail com a imagem, sem criar conta nem liberar acesso', async () => {
  const c = (await t.pool.query("SELECT * FROM coupons WHERE code='NATAL-2026'")).rows[0];
  mailer.memory.length = 0;
  const bad = await admin.post(`/admin/cupons/${c.id}/enviar`, { email: 'invalido' }, `/admin/cupons/${c.id}`); assert.ok(bad.location);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM coupon_sends')).rows[0].n, 0);
  const r = await admin.post(`/admin/cupons/${c.id}/enviar`, { email: 'Lead@Example.com', name: 'Beatriz Lead' }, `/admin/cupons/${c.id}`);
  assert.equal(r.status, 303);
  const mail = mailer.memory.find((m) => m.to === 'lead@example.com');
  assert.ok(mail); assert.equal(mail.template, 'cupom_convite'); assert.match(mail.html, /NATAL-2026/); assert.match(mail.html, /R\$\s?50,00/); assert.match(mail.html, /http:\/\/localhost:3000\/cupom\/NATAL-2026/);
  assert.match(mail.text, /acesso ao curso só é liberado depois da aprovação do pagamento/);
  assert.equal(mail.attachments.length, 1); assert.equal(mail.attachments[0].filename, 'cupom-NATAL-2026.png'); assert.ok(mail.attachments[0].bytes > 20000);
  const row = (await t.pool.query("SELECT * FROM coupon_sends WHERE email='lead@example.com'")).rows[0]; assert.equal(row.status, 'sent'); assert.equal(row.name, 'Beatriz Lead');
  assert.equal((await t.pool.query("SELECT count(*)::int n FROM users WHERE email='lead@example.com'")).rows[0].n, 0, 'lead não vira usuário');
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM acceptances a JOIN users u ON u.id=a.user_id WHERE u.email=$1', ['lead@example.com'])).rows[0].n, 0);
  assert.match((await admin.get(`/admin/cupons/${c.id}`)).text, /Beatriz Lead/);
  assert.equal((await t.pool.query("SELECT count(*)::int n FROM audit_log WHERE action = 'coupon_sent'")).rows[0].n, 1);
});

test('cupom: depois de enviado o desconto não muda; datas, usos e cursos continuam editáveis', async () => {
  const c = (await t.pool.query("SELECT * FROM coupons WHERE code='NATAL-2026'")).rows[0]; const back = `/admin/cupons/${c.id}`;
  const r = await admin.post(back, { kind: 'percent', percent: '90', ends_on: '2098-01-31', max_uses: '10', note: 'Natal', courses: [String(c1), String(c2)] }, back);
  assert.equal(r.status, 303);
  const n = (await t.pool.query('SELECT * FROM coupons WHERE id=$1', [c.id])).rows[0];
  assert.equal(n.kind, 'fixed'); assert.equal(n.amount_cents, 5000); assert.equal(n.percent, null, 'valor do desconto travado');
  assert.equal(String(n.ends_on).slice(0, 10), '2098-01-31'); assert.equal(n.max_uses, 10); assert.equal(n.note, 'Natal'); assert.equal(n.code, 'NATAL-2026');
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM coupon_courses WHERE coupon_id=$1', [c.id])).rows[0].n, 2);
  const sem = await admin.post(back, { ends_on: '2098-01-31', max_uses: '10' }, back); assert.equal(sem.status, 422); assert.match(sem.text, /pelo menos um curso/);
  // o primeiro cupom (20%) ainda não foi enviado nem usado: o desconto pode mudar
  const free = (await t.pool.query("SELECT * FROM coupons WHERE code NOT IN ('NATAL-2026','SOLO-1') ORDER BY id LIMIT 1")).rows[0];
  await admin.post(`/admin/cupons/${free.id}`, { kind: 'percent', percent: '25', max_uses: '50', courses: String(c1) }, `/admin/cupons/${free.id}`);
  assert.equal((await t.pool.query('SELECT percent FROM coupons WHERE id=$1', [free.id])).rows[0].percent, 25);
  await t.pool.query('INSERT INTO coupon_redemptions (coupon_id, user_id, course_id) SELECT $1, id, $2 FROM users WHERE email=$3', [free.id, c1, 'erick@example.com']);
  const low = await admin.post(`/admin/cupons/${free.id}`, { kind: 'percent', percent: '25', max_uses: '0', courses: String(c1) }, `/admin/cupons/${free.id}`); assert.equal(low.status, 422);
  await t.pool.query('DELETE FROM coupon_redemptions WHERE coupon_id=$1', [free.id]);
});

test('cupom: página pública do QR guarda o cupom e mostra o preço sem a promoção', async () => {
  const b = new Browser(t.base);
  const solo = (await t.pool.query("INSERT INTO coupons (code, kind, amount_cents, max_uses) VALUES ('SOLO-1','fixed',5000,5) RETURNING id")).rows[0].id;
  await t.pool.query('INSERT INTO coupon_courses (coupon_id, course_id) VALUES ($1,$2)', [solo, c1]);
  const one = await b.get('/cupom/solo-1'); assert.equal(one.status, 302); assert.equal(one.location, '/cursos/protocolo-essencia?cupom=SOLO-1');
  const page = await b.get(one.location); assert.equal(page.status, 200);
  assert.match(page.text, /Cupom <b>SOLO-1<\/b> guardado/); assert.match(page.text, /R\$\s?50,00 de desconto/); assert.match(page.text, /por <b>R\$\s?150,00<\/b>/); assert.match(page.text, /substitui o preço promocional/);
  // curso com promoção: o cupom vale sobre o preço normal e substitui a promoção
  const free = (await t.pool.query("SELECT * FROM coupons WHERE code NOT IN ('NATAL-2026','SOLO-1') ORDER BY id LIMIT 1")).rows[0];
  await admin.post(`/admin/cupons/${free.id}`, { kind: 'percent', percent: '25', max_uses: '50', courses: [String(c1), String(c2)] }, `/admin/cupons/${free.id}`);
  const both = await b.get(`/cupom/${free.code}`); assert.equal(both.location, `/?cupom=${free.code}#cursos`);
  const home = await b.get(`/?cupom=${free.code}`); assert.match(home.text, new RegExp(`Cupom <b>${free.code}</b> guardado: 25% de desconto`));
  const promoPage = await b.get(`/cursos/meditacao-guiada?cupom=${free.code}`); assert.match(promoPage.text, /de <s>R\$\s?120,00<\/s> por <b>R\$\s?90,00<\/b>/, '25% sobre 120, e não sobre 90 da promoção');
  const notFor = await b.get('/cursos/meditacao-guiada?cupom=SOLO-1'); assert.match(notFor.text, /Este cupom não está disponível/);
  assert.equal((await b.get('/cupom/NAO-EXISTE')).location, '/?cupom=invalido#cursos');
  assert.match((await b.get('/?cupom=invalido')).text, /Este cupom não está disponível/);
  assert.equal((await b.get('/cupom/%00%27')).status, 302);
});

test('cupom: matemática do preço, situação e inativação definitiva', async () => {
  const course = { price_cents: 20000 };
  assert.deepEqual(K.priceWith({ kind: 'percent', percent: 25 }, course), { cents: 15000, original: 20000, off: 5000 });
  assert.equal(K.priceWith({ kind: 'fixed', amount_cents: 5000 }, course).cents, 15000);
  assert.equal(K.priceWith({ kind: 'fixed', amount_cents: 20000 }, course), null, 'cupom não zera o preço');
  assert.equal(K.priceWith({ kind: 'percent', percent: 33 }, { price_cents: 1001 }).cents, 671);
  const base = { status: 'active', starts_on: null, ends_on: null, max_uses: null };
  assert.equal(K.stateOf(base, 0), 'active'); assert.equal(K.stateOf({ ...base, status: 'inactive' }, 0), 'inactive');
  assert.equal(K.stateOf({ ...base, starts_on: '2999-01-01' }, 0), 'scheduled'); assert.equal(K.stateOf({ ...base, ends_on: '2000-01-01' }, 0), 'expired');
  assert.equal(K.stateOf({ ...base, max_uses: 3 }, 3), 'exhausted'); assert.equal(K.stateOf({ ...base, max_uses: 3 }, 2), 'active');
  const c = (await t.pool.query("SELECT * FROM coupons WHERE code='NATAL-2026'")).rows[0];
  mailer.memory.length = 0;
  await admin.post(`/admin/cupons/${c.id}/inativar`, {}, `/admin/cupons/${c.id}`);
  assert.equal((await t.pool.query('SELECT status FROM coupons WHERE id=$1', [c.id])).rows[0].status, 'inactive');
  const b = new Browser(t.base);
  assert.equal((await b.get('/cupom/NATAL-2026')).location, '/?cupom=invalido#cursos', 'inativo não funciona no QR');
  const edit = await admin.post(`/admin/cupons/${c.id}`, { kind: 'percent', percent: '10', max_uses: '5', courses: String(c1) }, `/admin/cupons/${c.id}`);
  assert.equal((await t.pool.query('SELECT kind FROM coupons WHERE id=$1', [c.id])).rows[0].kind, 'fixed'); assert.ok(edit.location);
  await admin.post(`/admin/cupons/${c.id}/enviar`, { email: 'outro@example.com' }, `/admin/cupons/${c.id}`);
  assert.equal(mailer.memory.length, 0, 'inativo não envia');
  const page = await admin.get(`/admin/cupons/${c.id}`); assert.match(page.text, /Cupom inativo/); assert.doesNotMatch(page.text, /inativar<\/button>/i);
  assert.equal((await admin.post(`/admin/cupons/${c.id}/excluir`, {}, `/admin/cupons/${c.id}`)).status, 404, 'cupom não tem exclusão');
  await assert.rejects(t.pool.query('DELETE FROM coupons WHERE id=$1', [c.id]), /violates foreign key/, 'nem no banco, com cursos ligados');
  const copy = await admin.get(`/admin/cupons/novo?copiar=${c.id}`); assert.equal(copy.status, 200); assert.match(copy.text, /Baseado no cupom NATAL-2026/);
  assert.match((await admin.get('/admin/cupons')).text, /Inativo/);
  // curso ligado a cupom não se exclui
  await admin.post(`/admin/cursos/${c2}/excluir`, {}, `/admin/cursos/${c2}`);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM courses WHERE id=$1', [c2])).rows[0].n, 1);
});

test('log: as ações novas ficam registradas e aparecem na tela com nome em português', async () => {
  const p = await admin.get('/admin/log?de=2020-01-01'); assert.equal(p.status, 200);
  for (const txt of ['Criou cupom', 'Enviou cupom por e-mail', 'Concedeu cortesia', 'Inativou aluno', 'Inativou aula', 'Inativou cupom']) assert.match(p.text, new RegExp(txt), txt);
});

test('revisão: cortesia para quem já tem acesso não encurta o prazo nem manda e-mail repetido', async () => {
  await admin.post('/admin/cortesias', { course: String(c1), email: 'dupla@example.com', name: 'Dupla Teste' }, '/admin/cortesias');
  const u = (await t.pool.query("SELECT id FROM users WHERE email='dupla@example.com'")).rows[0];
  await t.pool.query("UPDATE enrollments SET origin='purchase', expires_at = NULL WHERE user_id=$1", [u.id]);
  mailer.memory.length = 0;
  const r = await admin.post('/admin/cortesias', { course: String(c1), email: 'dupla@example.com', until: '2099-01-01' }, '/admin/cortesias');
  assert.equal(r.status, 200); assert.match(r.text, /já tinha acesso/);
  const e = (await t.pool.query('SELECT * FROM enrollments WHERE user_id=$1 AND course_id=$2', [u.id, c1])).rows[0];
  assert.equal(e.expires_at, null, 'acesso vitalício não vira prazo'); assert.equal(e.origin, 'purchase');
  await new Promise((x) => setTimeout(x, 100)); assert.equal(mailer.memory.filter((m) => m.to === 'dupla@example.com').length, 0);
});

test('revisão: data de acesso no passado é recusada', async () => {
  const r = await admin.post('/admin/cortesias', { course: String(c1), email: 'passado@example.com', name: 'Passado Teste', until: '2020-01-01' }, '/admin/cortesias');
  assert.equal(r.status, 422); assert.match(r.text, /hoje ou depois/);
  assert.equal((await t.pool.query("SELECT count(*)::int n FROM users WHERE email='passado@example.com'")).rows[0].n, 0);
});

test('revisão: cupom de curso oculto não aparece e caracteres de controle não quebram a imagem', async () => {
  const r = await admin.post('/admin/cupons', { kind: 'percent', percent: '10', max_uses: '5', note: 'x\u0001y', courses: String(c2) }, '/admin/cupons/novo');
  assert.equal(r.status, 303);
  const c = (await t.pool.query('SELECT * FROM coupons ORDER BY id DESC LIMIT 1')).rows[0];
  await t.pool.query("UPDATE courses SET status='draft' WHERE id=$1", [c2]);
  assert.equal((await K.publicView(c.code)).invalid, true);
  await t.pool.query("UPDATE courses SET status='published' WHERE id=$1", [c2]);
  assert.equal((await K.publicView(c.code)).invalid, undefined);
  const png = await K.artPng({ baseUrl: 'http://localhost:3000' }, { ...c, note: 'a\u0001b', courses: [] });
  assert.deepEqual([...png.subarray(0, 4)], PNG);
});

test('revisão: cupom já enviado não perde cursos, mas pode ganhar', async () => {
  await admin.post('/admin/cupons', { code: 'KEEP-2', kind: 'percent', percent: '10', max_uses: '5', courses: [String(c1), String(c2)] }, '/admin/cupons/novo');
  const c = (await t.pool.query("SELECT * FROM coupons WHERE code='KEEP-2'")).rows[0]; const back = `/admin/cupons/${c.id}`;
  await t.pool.query("INSERT INTO coupon_sends (coupon_id, email) VALUES ($1, 'x@example.com')", [c.id]);
  const rem = await admin.post(back, { ends_on: '2098-01-31', max_uses: '5', courses: String(c2) }, back);
  const have = (await t.pool.query('SELECT course_id FROM coupon_courses WHERE coupon_id=$1', [c.id])).rows.map((x) => String(x.course_id));
  assert.ok(have.includes(String(c1)), 'curso original continua');
  assert.equal(rem.status, 422); assert.match(rem.text, /não podem ser retirados/);
});

test('revisão: excluir matrícula de compra é recusado', async () => {
  const u = (await t.pool.query("SELECT id FROM users WHERE email='dupla@example.com'")).rows[0];
  const e = (await t.pool.query('SELECT id FROM enrollments WHERE user_id=$1 AND course_id=$2', [u.id, c1])).rows[0];
  await admin.post(`/admin/matriculas/${e.id}/excluir`, {}, `/admin/cursos/${c1}/matriculas`);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM enrollments WHERE id=$1', [e.id])).rows[0].n, 1);
});
