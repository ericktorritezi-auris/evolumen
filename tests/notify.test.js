'use strict';
// 0.6.1 · Campainha de avisos para o professor e para o aluno.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const notify = require('../src/notify');
const R = require('../src/reminders');
const S = require('../src/sales');
const L = require('../src/lgpd');

let t; let admin; let course; let lessonId; let ana; let bia; let anaB; let biaB; let adminId;
const slug = 'curso-sino';
const q = (sql, p) => t.pool.query(sql, p);
const bg = (p) => Promise.resolve(p);
const aula = () => `/curso/${slug}/aula/${lessonId}`;
async function loginAs(u) { const b = new Browser(t.base); const r = await b.login(u.email, u.password); assert.equal(r.status, 303); return b; }
const feed = async (b) => JSON.parse((await b.get('/notificacoes.json')).text);

before(async () => {
  t = await boot(); admin = await adminReady(t);
  adminId = (await q("SELECT id FROM users WHERE role='admin'")).rows[0].id;
  await admin.post('/admin/cursos', { title: 'Curso do Sino', slug, summary: 'R', description: 'D', price: '100,00', level: 'iniciante', access_type: 'months', access_months: '12', max_installments: '12', sort_order: '1', expiry_notice: '' }, '/admin/cursos/novo');
  course = (await q('SELECT id FROM courses WHERE slug=$1', [slug])).rows[0].id;
  await q("UPDATE courses SET status='published', published_at=now() - interval '1 day' WHERE id=$1", [course]);
  const mod = (await q("INSERT INTO modules (course_id, title, position) VALUES ($1,'M',1) RETURNING id", [course])).rows[0].id;
  lessonId = (await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'Aula Um',1,'dQw4w9WgXcQ') RETURNING id", [course, mod])).rows[0].id;
  await q("INSERT INTO lessons (course_id, module_id, title, position, youtube_id) VALUES ($1,$2,'Aula Dois',2,'dQw4w9WgXcQ')", [course, mod]);
  ana = await makeStudent(t, { email: 'ana@example.com', name: 'Ana Paula Souza' }); bia = await makeStudent(t, { email: 'bia@example.com', name: 'Bia Lima' });
  for (const u of [ana, bia]) await q("INSERT INTO enrollments (user_id, course_id, origin) VALUES ($1,$2,'manual')", [u.id, course]);
  anaB = await loginAs(ana); biaB = await loginAs(bia);
});
after(async () => { await t.close(); });

test('sino: exige login e cada pessoa vê só os próprios avisos', async () => {
  const anon = await new Browser(t.base).get('/notificacoes.json'); assert.notEqual(anon.status, 200);
  await notify.add(ana.id, { kind: 'x', title: 'Só da Ana', key: 'k1' });
  assert.equal((await feed(anaB)).unread, 1); assert.equal((await feed(biaB)).unread, 0);
  const id = (await q("SELECT id FROM notifications WHERE ref_key='k1'")).rows[0].id;
  assert.equal((await biaB.get(`/notificacoes/${id}/abrir`)).status, 404, 'outro aluno não abre');
  assert.equal((await q('SELECT read_at FROM notifications WHERE id=$1', [id])).rows[0].read_at, null);
  assert.equal(await notify.add(ana.id, { kind: 'x', title: 'repetido', key: 'k1' }), null, 'mesma chave não duplica');
});

test('sino: o endereço de destino só pode ser interno e abrir marca como lido', async () => {
  await notify.add(ana.id, { kind: 'x', title: 'Link externo', link: 'https://evil.example/', key: 'k2' });
  await notify.add(ana.id, { kind: 'x', title: 'Link protocolo', link: '//evil.example/', key: 'k3' });
  await notify.add(ana.id, { kind: 'x', title: 'Link bom', link: '/certificados', key: 'k4' });
  const rows = (await q("SELECT ref_key, link FROM notifications WHERE ref_key IN ('k2','k3','k4') ORDER BY ref_key")).rows;
  assert.equal(rows[0].link, ''); assert.equal(rows[1].link, ''); assert.equal(rows[2].link, '/certificados');
  const id = (await q("SELECT id FROM notifications WHERE ref_key='k4'")).rows[0].id;
  const r = await anaB.get(`/notificacoes/${id}/abrir`); assert.equal(r.status, 303); assert.equal(r.location, '/certificados');
  assert.ok((await q('SELECT read_at FROM notifications WHERE id=$1', [id])).rows[0].read_at);
  const bad = await anaB.get('/notificacoes/abc/abrir'); assert.equal(bad.status, 404);
});

test('sino: ler todas e HTML do título nunca é interpretado (a tela usa só texto)', async () => {
  await notify.add(bia.id, { kind: 'x', title: '<script>alert(1)</script>', key: 'k5' });
  const f = await feed(biaB); assert.equal(f.items[0].title, '<script>alert(1)</script>', 'o JSON entrega texto cru; a tela usa textContent');
  const r = await biaB.post('/notificacoes/ler-todas', {}, '/meus-cursos'); assert.equal(r.status, 303);
  assert.equal((await feed(biaB)).unread, 0);
  const page = await biaB.get('/meus-cursos'); assert.match(page.text, /data-bell/); assert.match(page.text, /id="bell-panel"/);
});

test('fórum: pergunta acende o sino do professor; a resposta apaga o amarelo e avisa a aluna', async () => {
  await q('DELETE FROM notifications');
  await anaB.post(`${aula()}/forum`, { body: 'Não entendi o conceito da aula 1.' }, aula());
  const post = (await q('SELECT * FROM forum_posts')).rows[0];
  let f = await feed(admin); assert.equal(f.unread, 1); assert.match(f.items[0].title, /Ana Paula Souza fez uma pergunta/);
  await admin.post(`${aula()}/forum`, { body: 'Veja o exemplo no minuto 3.', parent: String(post.id) }, aula());
  f = await feed(admin); assert.equal(f.unread, 0, 'professor respondeu: fica cinza'); assert.equal(f.items[0].read, true);
  const fa = await feed(anaB); assert.equal(fa.unread, 1); assert.match(fa.items[0].title, /professor respondeu/i);
  // ocultar também resolve
  await biaB.post(`${aula()}/forum`, { body: 'Outra pergunta para ocultar.' }, aula());
  assert.equal((await feed(admin)).unread, 1);
  const bp = (await q("SELECT id FROM forum_posts WHERE user_id=$1", [bia.id])).rows[0].id;
  await admin.post(`/admin/forum/${bp}/ocultar`, {}, '/admin/forum');
  assert.equal((await feed(admin)).unread, 0);
});

test('venda, reembolso, estorno e certificado geram avisos certos', async () => {
  await q('DELETE FROM notifications');
  const order = async (u, n) => (await q(`INSERT INTO orders (public_id, user_id, course_id, buyer, list_cents, price_cents, method, provider, provider_payment_id, status)
    VALUES ($1,$2,$3,$4,10000,10000,'pix','simulated',$5,'pending') RETURNING *`, [`PUB${n}`, u.id, course, JSON.stringify({ name: u.name, email: u.email }), `SIM-${n}`])).rows[0];
  const pay = (o, status) => ({ id: o.provider_payment_id, status, reference: o.public_id, amountCents: 10000, paidCents: 10000 });
  const o1 = await order(ana, 'A1');
  assert.equal((await S.applyPayment(t.cfg, bg, o1.id, pay(o1, 'approved'), null)).result, 'aprovado');
  let f = await feed(admin); assert.ok(f.items.find((x) => /Ana Paula Souza acabou de comprar/.test(x.title)), 'professor vê a venda');
  assert.ok((await feed(anaB)).items.find((x) => /Pagamento confirmado/.test(x.title)), 'aluna recebe as boas-vindas');
  await S.applyPayment(t.cfg, bg, o1.id, pay(o1, 'approved'), null);
  assert.equal((await q("SELECT count(*)::int n FROM notifications WHERE ref_key LIKE 'sale:%'")).rows[0].n, 1, 'repetição do gateway não duplica o aviso');
  // pedido de reembolso -> professor; rejeitar -> aluna e apaga o amarelo
  const rr = await S.requestRefund(t.cfg, bg, { user: { id: ana.id, name: ana.name, email: ana.email }, ip: '1.1.1.1', get: () => '' }, o1, 'Mudei de ideia');
  assert.equal(rr, true);
  const reqId = (await q('SELECT id FROM refund_requests')).rows[0].id;
  assert.ok((await feed(admin)).items.find((x) => /Pedido de reembolso de Ana/.test(x.title) && !x.read));
  await S.rejectRefund(t.cfg, bg, { user: { id: adminId }, ip: '1.1.1.1', get: () => '' }, reqId, 'Fora do prazo');
  assert.ok((await feed(admin)).items.find((x) => /Pedido de reembolso de Ana/.test(x.title)).read);
  assert.ok((await feed(anaB)).items.find((x) => /pedido de reembolso foi analisado/.test(x.title)));
  // estorno -> professor
  await S.applyPayment(t.cfg, bg, o1.id, pay(o1, 'charged_back'), null);
  assert.ok((await feed(admin)).items.find((x) => /Chargeback/.test(x.title)));
  assert.ok((await feed(anaB)).items.find((x) => /estornado/.test(x.title)));
});

test('progresso e certificado: 50%, aulas todas vistas e emissão avisam o professor e o aluno', async () => {
  await q('DELETE FROM notifications'); await q("UPDATE enrollments SET status='active', cancelled_at=NULL WHERE user_id=$1", [bia.id]);
  const l1 = lessonId; const l2 = (await q('SELECT id FROM lessons WHERE course_id=$1 AND position=2', [course])).rows[0].id;
  await biaB.post(`/curso/${slug}/aula/${l1}/concluir`, { done: '1' }, aula());
  assert.ok((await feed(admin)).items.find((x) => /Bia Lima chegou a 50%/.test(x.title)));
  await biaB.post(`/curso/${slug}/aula/${l2}/concluir`, { done: '1' }, aula());
  assert.ok((await feed(admin)).items.find((x) => /Bia Lima assistiu todas as aulas/.test(x.title)));
  assert.ok((await feed(biaB)).items.find((x) => /certificado está pronto/i.test(x.title)), 'aluna avisada do certificado');
  assert.ok((await feed(admin)).items.find((x) => /Bia Lima concluiu o curso/.test(x.title)));
  await biaB.post(`/curso/${slug}/avaliar`, { stars: '5', nps: '10', comment: 'Ótimo' }, `/curso/${slug}`);
  assert.ok((await feed(admin)).items.find((x) => /Bia Lima avaliou o curso/.test(x.title)));
});

test('LGPD e troca de e-mail: pedidos acendem o sino e a resposta apaga; exclusão apaga os avisos da pessoa', async () => {
  await q('DELETE FROM notifications');
  await anaB.post('/perfil/exclusao', {}, '/perfil');
  assert.ok((await feed(admin)).items.find((x) => /exclusão de dados de Ana/.test(x.title) && !x.read));
  const req = (await q("SELECT id FROM data_requests WHERE type='delete'")).rows[0].id;
  await admin.post(`/admin/lgpd/pedidos/${req}/resolver`, { action: 'done', note: '' }, '/admin/lgpd');
  assert.ok((await feed(admin)).items.find((x) => /exclusão de dados de Ana/.test(x.title)) === undefined, 'avisos sobre a pessoa anonimizada somem');
  assert.equal((await q('SELECT count(*)::int n FROM notifications WHERE user_id=$1 OR subject_user_id=$1', [ana.id])).rows[0].n, 0);
  const x = await L.exportFor(bia.id); assert.ok(x);
});

test('varredura: aniversário, prazo de acesso, lembretes; não repete e limpa os lidos antigos', async () => {
  await q('DELETE FROM notifications');
  const now = new Date('2026-10-28T15:00:00Z');
  assert.equal(R.daysToBirthday('1990-10-28', now), 0); assert.equal(R.daysToBirthday('1990-11-02', now), 5);
  assert.equal(R.daysToBirthday('1990-10-27', now) > 300, true); assert.equal(R.daysToBirthday('1990-02-29', new Date('2027-02-28T15:00:00Z')) <= 2, true);
  const cara = await makeStudent(t, { email: 'cara@example.com', name: 'Cara Nova' });
  await q("UPDATE users SET birth_date = '1990-10-30' WHERE id=$1", [cara.id]);
  const e1 = (await q("INSERT INTO enrollments (user_id, course_id, origin, starts_at, expires_at) VALUES ($1,$2,'purchase', $3, $4) RETURNING id", [cara.id, course, '2026-09-01T12:00:00Z', '2026-11-04T15:00:00Z'])).rows[0].id;
  const sent = []; const bgm = (p) => { sent.push(p); return Promise.resolve(p); };
  const r1 = await R.run(t.cfg, bgm, now); await t.app.locals.idle();
  assert.equal(r1.aniversarios, 1); assert.equal(r1.vencendo, 1);
  const fa = await feed(admin); assert.ok(fa.items.find((x) => /Aniversário de Cara Nova/.test(x.title) && /em 2 dias/.test(x.body)));
  const fc = JSON.parse((await q('SELECT 1')).rowCount ? JSON.stringify({ items: (await q('SELECT title FROM notifications WHERE user_id=$1 ORDER BY id', [cara.id])).rows }) : '{}');
  assert.ok(fc.items.find((x) => /vence em 7 dias/.test(x.title)), 'faltam 7 dias: aviso de 7');
  assert.ok(fc.items.find((x) => /começar o seu curso/.test(x.title)), 'sem nenhuma aula há mais de 3 dias');
  assert.ok(sent.length >= 1, 'o e-mail de prazo também sai');
  const before = (await q('SELECT count(*)::int n FROM notifications')).rows[0].n;
  await R.run(t.cfg, bgm, now); assert.equal((await q('SELECT count(*)::int n FROM notifications')).rows[0].n, before, 'segunda varredura não repete nada');
  // 1 dia depois, ainda no mesmo marco (7) mas agora faltam 6 dias: nada novo; quando faltar 1, vem o aviso de 1
  await R.run(t.cfg, bgm, new Date('2026-11-03T15:00:00Z'));
  assert.ok((await q("SELECT 1 FROM notifications WHERE user_id=$1 AND ref_key LIKE $2", [cara.id, `exp:${e1}:1:%`])).rowCount === 1, 'faltando 1 dia chega o aviso de 1 dia');
  // limpeza: lidos há mais de 7 dias saem, não lidos ficam
  await q("UPDATE notifications SET read_at = now() - interval '8 days' WHERE user_id=$1 AND kind='nudge'", [cara.id]);
  await notify.cleanup();
  assert.equal((await feed({ get: async () => ({ text: JSON.stringify(await notify.list(cara.id)) }) })).items.filter((x) => /começar o seu curso/.test(x.title)).length, 0, 'lido há 8 dias sai da lista');
  assert.equal((await q("SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND kind='nudge'", [cara.id])).rows[0].n, 1, 'mas a chave fica guardada: o aviso não volta');
  await R.run(t.cfg, bgm, new Date('2026-11-03T16:00:00Z'));
  assert.equal((await notify.list(cara.id)).items.filter((x) => /começar o seu curso/.test(x.title)).length, 0, 'varredura não recria o aviso lido');
  assert.ok((await q("SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND kind='expiry'", [cara.id])).rows[0].n >= 1);
});

test('perfil: data de nascimento opcional e validada', async () => {
  const ok = await biaB.post('/perfil', { name: 'Bia Lima', phone: '', birth_date: '1991-05-17' }, '/perfil'); assert.equal(ok.status, 303);
  assert.equal((await q('SELECT birth_date FROM users WHERE id=$1', [bia.id])).rows[0].birth_date, '1991-05-17');
  for (const bad of ['2999-01-01', '1800-01-01', '2020-02-31', 'abc']) {
    const r = await biaB.post('/perfil', { name: 'Bia Lima', phone: '', birth_date: bad }, '/perfil'); assert.equal(r.status, 422, bad);
  }
  assert.equal((await q('SELECT birth_date FROM users WHERE id=$1', [bia.id])).rows[0].birth_date, '1991-05-17');
  await biaB.post('/perfil', { name: 'Bia Lima', phone: '', birth_date: '' }, '/perfil');
  assert.equal((await q('SELECT birth_date FROM users WHERE id=$1', [bia.id])).rows[0].birth_date, null);
});
