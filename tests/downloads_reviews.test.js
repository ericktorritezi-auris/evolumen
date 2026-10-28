'use strict';
// 0.8.0 · Limite de downloads, avaliação com depoimento, média de estrelas, produto fora de Certificados.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const dl = require('../src/downloads');
const Co = require('../src/community');

let t; let admin; let pid; let dir; let ana; let bia; let cris; let dani; let anaB; let biaB; let crisB; let fileA; let fileB;
const slug = 'guia-sono';
const q = (sql, p) => t.pool.query(sql, p);
const PDF = Buffer.from('%PDF-1.4\n' + 'guia do sono '.repeat(60));
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2000, 5)]);
const form = (o = {}) => ({ product_type: 'download', title: 'Guia do Sono', slug, summary: 'Durma melhor.', description: 'Um guia.', category: 'E-book', price: '29,90', access_type: 'lifetime', max_installments: '1', sort_order: '1', ...o });
async function loginAs(u) { const b = new Browser(t.base); const r = await b.login(u.email, u.password); assert.equal(r.status, 303); return b; }
const get = (b, id) => fetch(`${t.base}/arquivos/${id}`, { headers: { cookie: b.cookieHeader(), 'user-agent': b.ua }, redirect: 'manual' });
const bell = async (b) => JSON.parse((await b.get('/notificacoes.json')).text).items;
const waitUsed = async (uid, fid, n) => { for (let i = 0; i < 40; i++) { const r = (await q('SELECT used FROM file_quota WHERE user_id=$1 AND file_id=$2', [uid, fid])).rows[0]; if (r && r.used >= n) return r.used; await new Promise((ok) => setTimeout(ok, 50)); } return 0; };
const ver = async (id) => (await q('SELECT md5(comment) v FROM course_reviews WHERE id=$1', [id])).rows[0].v;
async function enroll(u) { await q("INSERT INTO enrollments (user_id, course_id, origin) VALUES ($1,$2,'manual') ON CONFLICT DO NOTHING", [u.id, pid]); }

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evl-v080-'));
  t = await boot({ FILES_DIR: dir }); admin = await adminReady(t);
  ana = await makeStudent(t, { email: 'ana@example.com', name: 'Ana Costa Lima' }); bia = await makeStudent(t, { email: 'bia@example.com', name: 'Beatriz Souza' });
  cris = await makeStudent(t, { email: 'cris@example.com', name: 'Cristina Alves' }); dani = await makeStudent(t, { email: 'dani@example.com', name: 'Daniela Rocha' });
  anaB = await loginAs(ana); biaB = await loginAs(bia); crisB = await loginAs(cris);
  const r = await admin.post('/admin/cursos', form(), '/admin/cursos/novo?tipo=arquivos'); assert.equal(r.status, 303);
  pid = (await q('SELECT id FROM courses WHERE slug=$1', [slug])).rows[0].id;
  const up = (file, label) => admin.upload(`/admin/cursos/${pid}/arquivos`, { label, armazenamento: 'db' }, file, { csrfFrom: `/admin/cursos/${pid}/arquivos` });
  assert.equal((await up({ name: 'guia.pdf', buffer: PDF, type: 'application/pdf' }, 'Guia (PDF)')).status, 303);
  assert.equal((await up({ name: 'extras.zip', buffer: ZIP }, 'Extras')).status, 303);
  [fileA, fileB] = (await q('SELECT file_id FROM product_files WHERE product_id=$1 ORDER BY id', [pid])).rows.map((x) => x.file_id);
  assert.equal((await admin.post(`/admin/cursos/${pid}`, form({ publish: '1' }), `/admin/cursos/${pid}`)).status, 303);
  for (const u of [ana, bia, cris]) await enroll(u);
});
after(async () => { await t.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('limite: 3 downloads por arquivo, depois só com pedido aprovado', async () => {
  assert.equal(await dl.limitOf(), 3);
  for (let i = 1; i <= 3; i++) { const r = await get(anaB, fileA); assert.equal(r.status, 200); await r.arrayBuffer(); assert.equal(await waitUsed(ana.id, fileA, i), i); }
  const home = await anaB.get(`/curso/${slug}`); assert.match(home.text, /Pedir novo download/); assert.match(home.text, /3 downloads/);
  const other = await anaB.get(`/curso/${slug}`); assert.match(other.text, /3 de 3 downloads restantes/, 'o outro arquivo continua com todos');
  const blocked = await get(anaB, fileA); assert.equal(blocked.status, 303); assert.match(blocked.headers.get('location'), new RegExp(`/arquivos/${fileA}/solicitar$`));
  assert.equal((await q('SELECT used FROM file_quota WHERE user_id=$1 AND file_id=$2', [ana.id, fileA])).rows[0].used, 3, 'bloqueio não gasta');
  // pedido
  assert.equal((await anaB.get(`/arquivos/${fileA}/solicitar`)).status, 200);
  const curto = await anaB.post(`/arquivos/${fileA}/solicitar`, { reason: 'preciso' }, `/arquivos/${fileA}/solicitar`); assert.equal(curto.status, 400); assert.match(curto.text, /pelo menos 10 letras/);
  const ok = await anaB.post(`/arquivos/${fileA}/solicitar`, { reason: 'Troquei de celular e perdi o arquivo.' }, `/arquivos/${fileA}/solicitar`); assert.equal(ok.status, 303);
  const dup = await anaB.post(`/arquivos/${fileA}/solicitar`, { reason: 'Outro pedido igual ao primeiro.' }, `/arquivos/${fileA}/solicitar`); assert.equal(dup.status, 400); assert.match(dup.text, /já tem um pedido/);
  assert.equal((await q("SELECT count(*)::int n FROM download_requests WHERE status='pending'")).rows[0].n, 1);
  const feedAdmin = await bell(admin); assert.ok(feedAdmin.find((x) => /pediu novo download/.test(x.title)), 'campainha do admin');
  const page = await admin.get('/admin/downloads'); assert.equal(page.status, 200); assert.match(page.text, /Troquei de celular/); assert.match(page.text, /Ana Costa Lima/);
  // quem não tem acesso não pede
  assert.equal((await new Browser(t.base).get(`/arquivos/${fileA}/solicitar`)).status, 303, 'sem login vai ao login');
  const dBr = await loginAs(dani);
  assert.notEqual((await dBr.get(`/arquivos/${fileA}/solicitar`)).status, 200);
  // aprovação libera mais um
  const rid = (await q("SELECT id FROM download_requests WHERE status='pending'")).rows[0].id;
  const dec = await admin.post(`/admin/downloads/${rid}/decidir`, { decision: 'approve', response: 'Liberado, bom estudo!' }, '/admin/downloads'); assert.equal(dec.status, 303);
  assert.ok((await bell(anaB)).find((x) => /Novo download liberado/.test(x.title)), 'aluno avisado na campainha');
  const again = await get(anaB, fileA); assert.equal(again.status, 200); await again.arrayBuffer(); await waitUsed(ana.id, fileA, 4);
  const blocked2 = await get(anaB, fileA); assert.equal(blocked2.status, 303);
  const twice = await admin.post(`/admin/downloads/${rid}/decidir`, { decision: 'approve' }, '/admin/downloads'); assert.equal(twice.status, 303);
  assert.equal((await q('SELECT extra FROM file_quota WHERE user_id=$1 AND file_id=$2', [ana.id, fileA])).rows[0].extra, 1, 'decidir duas vezes não libera duas');
});

test('corrida: requisições simultâneas não passam do limite; HEAD não gasta download', async () => {
  const dBr = await loginAs(dani); await enroll(dani);
  await q('INSERT INTO file_quota (user_id, file_id, used) VALUES ($1,$2,2)', [dani.id, fileB]);
  const rs = await Promise.all(Array.from({ length: 8 }, () => get(dBr, fileB)));
  for (const r of rs) await r.arrayBuffer().catch(() => {});
  assert.equal(rs.filter((r) => r.status === 200).length, 1, 'só uma passa com 1 restante');
  assert.equal(rs.filter((r) => r.status === 303).length, 7);
  assert.equal((await q('SELECT used FROM file_quota WHERE user_id=$1 AND file_id=$2', [dani.id, fileB])).rows[0].used, 3);
  const h = await fetch(`${t.base}/arquivos/${fileA}`, { method: 'HEAD', headers: { cookie: dBr.cookieHeader(), 'user-agent': dBr.ua }, redirect: 'manual' });
  assert.equal(h.status, 405); assert.equal((await q('SELECT count(*)::int n FROM file_quota WHERE user_id=$1 AND file_id=$2', [dani.id, fileA])).rows[0].n, 0, 'HEAD não gasta');
  // motivo com emoji conta caracteres, não unidades
  const em = await dBr.post(`/arquivos/${fileB}/solicitar`, { reason: '🌸🌸🌸🌸🌸' }, `/arquivos/${fileB}/solicitar`); assert.equal(em.status, 400);
  const ok = await dBr.post(`/arquivos/${fileB}/solicitar`, { reason: 'Preciso baixar de novo 🌸🌸' }, `/arquivos/${fileB}/solicitar`); assert.equal(ok.status, 303);
  await q("UPDATE download_requests SET status='denied' WHERE user_id=$1", [dani.id]);
});

test('negar o pedido não libera; administrador não tem limite; o limite é configurável', async () => {
  for (let i = 1; i <= 3; i++) { const r = await get(biaB, fileB); assert.equal(r.status, 200); await r.arrayBuffer(); await waitUsed(bia.id, fileB, i); }
  assert.equal((await get(biaB, fileB)).status, 303);
  await biaB.post(`/arquivos/${fileB}/solicitar`, { reason: 'Só quero ter uma cópia extra.' }, `/arquivos/${fileB}/solicitar`);
  const rid = (await q("SELECT id FROM download_requests WHERE user_id=$1 AND status='pending'", [bia.id])).rows[0].id;
  await admin.post(`/admin/downloads/${rid}/decidir`, { decision: 'deny', response: 'Você já tem o arquivo.' }, '/admin/downloads');
  assert.ok((await bell(biaB)).find((x) => /negado/.test(x.title)));
  assert.equal((await get(biaB, fileB)).status, 303);
  assert.equal((await q('SELECT count(*)::int n FROM file_quota WHERE user_id=$1 AND file_id=$2 AND extra > 0', [bia.id, fileB])).rows[0].n, 0);
  for (let i = 0; i < 5; i++) { const r = await get(admin, fileA); assert.equal(r.status, 200); await r.arrayBuffer(); }
  assert.equal((await q('SELECT count(*)::int n FROM file_quota WHERE user_id = (SELECT id FROM users WHERE role=\'admin\' LIMIT 1)')).rows[0].n, 0);
  // configuração
  const cfgPage = await admin.get('/admin/configuracoes'); assert.match(cfgPage.text, /Downloads por arquivo/);
  const bad = await admin.post('/admin/configuracoes', { support_email: '', support_whatsapp: '', download_limit: '0', forum_enabled: '1' }, '/admin/configuracoes'); assert.equal(bad.status, 422);
  const good = await admin.post('/admin/configuracoes', { support_email: '', support_whatsapp: '', download_limit: '5', forum_enabled: '1' }, '/admin/configuracoes'); assert.equal(good.status, 303);
  assert.equal(await dl.limitOf(), 5);
  await admin.post('/admin/configuracoes', { support_email: '', support_whatsapp: '', download_limit: '3', forum_enabled: '1' }, '/admin/configuracoes');
});

test('acesso cancelado zera o contador do produto', async () => {
  assert.ok((await q('SELECT count(*)::int n FROM file_quota WHERE user_id=$1', [bia.id])).rows[0].n > 0);
  await q("INSERT INTO download_requests (user_id, file_id, course_id, reason) VALUES ($1,$2,$3,'pedido em aberto de teste')", [bia.id, fileA, pid]);
  await q("INSERT INTO course_reviews (course_id, user_id, stars, nps, comment, consent_publish, published, published_at) VALUES ($1,$2,5,10,'ótimo',true,true,now())", [pid, bia.id]);
  const e = (await q('SELECT id FROM enrollments WHERE user_id=$1 AND course_id=$2', [bia.id, pid])).rows[0].id;
  assert.equal((await admin.post(`/admin/matriculas/${e}/cancelar`, {}, `/admin/cursos/${pid}/matriculas`)).status, 303);
  assert.equal((await q('SELECT count(*)::int n FROM file_quota WHERE user_id=$1', [bia.id])).rows[0].n, 0);
  assert.equal((await q("SELECT count(*)::int n FROM download_requests WHERE user_id=$1 AND status='pending'", [bia.id])).rows[0].n, 0);
  assert.equal((await q('SELECT published FROM course_reviews WHERE user_id=$1', [bia.id])).rows[0].published, false, 'depoimento sai do ar ao cancelar');
  await q('DELETE FROM course_reviews WHERE user_id=$1', [bia.id]);
  await q("UPDATE enrollments SET status='active', cancelled_at=NULL WHERE id=$1", [e]);
});

test('avaliação do produto só abre depois do primeiro download; depoimento exige aceite e publicação', async () => {
  // cris ainda não baixou
  assert.doesNotMatch((await crisB.get(`/curso/${slug}`)).text, /id="avaliacao"/);
  const no = await crisB.post(`/curso/${slug}/avaliar`, { stars: '5', nps: '10', comment: 'Ótimo' }, `/curso/${slug}`); assert.equal(no.status, 303);
  assert.equal((await q('SELECT count(*)::int n FROM course_reviews WHERE user_id=$1', [cris.id])).rows[0].n, 0, 'sem download não avalia');
  // ana já baixou
  assert.match((await anaB.get(`/curso/${slug}`)).text, /O que você achou do produto/);
  assert.match((await anaB.get(`/curso/${slug}`)).text, /Autorizo publicar/);
  const sem = await anaB.post(`/curso/${slug}/avaliar`, { stars: '5', nps: '10', comment: 'Adorei, ajudou muito no meu sono.' }, `/curso/${slug}`); assert.equal(sem.status, 303);
  const rv = (await q('SELECT * FROM course_reviews WHERE user_id=$1', [ana.id])).rows[0]; assert.equal(rv.consent_publish, false); assert.equal(rv.published, false);
  assert.ok((await bell(admin)).find((x) => /avaliou o produto/.test(x.title)));
  // sem aceite, o administrador não publica
  assert.equal((await admin.post(`/admin/forum/avaliacao/${rv.id}/publicar`, { ver: await ver(rv.id) }, '/admin/forum')).status, 303);
  assert.equal((await q('SELECT published FROM course_reviews WHERE id=$1', [rv.id])).rows[0].published, false);
  // com aceite
  await anaB.post(`/curso/${slug}/avaliar`, { stars: '5', nps: '10', comment: 'Adorei, ajudou muito no meu sono.', consent: '1' }, `/curso/${slug}`);
  assert.equal((await q('SELECT consent_publish FROM course_reviews WHERE id=$1', [rv.id])).rows[0].consent_publish, true);
  const forum = await admin.get('/admin/forum'); assert.match(forum.text, /Publicar depoimento/); assert.match(forum.text, /Aceite dado/);
  assert.ok((await bell(admin)).find((x) => /autorizou publicar/.test(x.title)), 'admin avisado do aceite');
  // texto mudou depois que o admin abriu a lista: não publica o que ele não leu
  const staleVer = await ver(rv.id);
  await anaB.post(`/curso/${slug}/avaliar`, { stars: '5', nps: '10', comment: 'Adorei, ajudou muito no meu sono!!', consent: '1' }, `/curso/${slug}`);
  await admin.post(`/admin/forum/avaliacao/${rv.id}/publicar`, { ver: staleVer }, '/admin/forum');
  assert.equal((await q('SELECT published FROM course_reviews WHERE id=$1', [rv.id])).rows[0].published, false, 'versão antiga não publica');
  await anaB.post(`/curso/${slug}/avaliar`, { stars: '5', nps: '10', comment: 'Adorei, ajudou muito no meu sono.', consent: '1' }, `/curso/${slug}`);
  assert.equal((await admin.post(`/admin/forum/avaliacao/${rv.id}/publicar`, { ver: await ver(rv.id) }, '/admin/forum')).status, 303);
  assert.equal((await q('SELECT published FROM course_reviews WHERE id=$1', [rv.id])).rows[0].published, true);
  assert.ok((await bell(anaB)).find((x) => /depoimento foi publicado/.test(x.title)));
  // público: nome abreviado, sem sobrenome completo, sem e-mail
  const pubPage = await new Browser(t.base).get(`/cursos/${slug}`); assert.equal(pubPage.status, 200);
  assert.match(pubPage.text, /Depoimentos/); assert.match(pubPage.text, /Adorei, ajudou muito/); assert.match(pubPage.text, /Ana L\./);
  assert.doesNotMatch(pubPage.text, /Ana Costa Lima|Costa|ana@example\.com/);
  assert.doesNotMatch(pubPage.text, /★ \d/, 'com menos de 3 avaliações não mostra média');
  // mudar o texto tira do ar
  await anaB.post(`/curso/${slug}/avaliar`, { stars: '5', nps: '10', comment: 'Texto novo, melhor ainda.', consent: '1' }, `/curso/${slug}`);
  assert.equal((await q('SELECT published FROM course_reviews WHERE id=$1', [rv.id])).rows[0].published, false, 'texto editado volta para aprovação');
  assert.doesNotMatch((await new Browser(t.base).get(`/cursos/${slug}`)).text, /Texto novo/);
  await admin.post(`/admin/forum/avaliacao/${rv.id}/publicar`, { ver: await ver(rv.id) }, '/admin/forum');
  // retirar
  await admin.post(`/admin/forum/avaliacao/${rv.id}/despublicar`, {}, '/admin/forum');
  assert.doesNotMatch((await new Browser(t.base).get(`/cursos/${slug}`)).text, /Texto novo/);
  await admin.post(`/admin/forum/avaliacao/${rv.id}/publicar`, { ver: await ver(rv.id) }, '/admin/forum');
});

test('média de estrelas só aparece com 3 avaliações e ignora quem teve o acesso cancelado', async () => {
  const mk = (u, stars) => q('INSERT INTO course_reviews (course_id, user_id, stars, nps) VALUES ($1,$2,$3,9)', [pid, u.id, stars]);
  assert.deepEqual(await Co.ratingFor([pid]), {}, 'só 1 avaliação');
  await mk(bia, 4); assert.deepEqual(await Co.ratingFor([pid]), {}, '2 avaliações');
  await mk(cris, 5);
  const r = (await Co.ratingFor([pid]))[pid]; assert.equal(r.n, 3); assert.equal(r.avg, 4.7);
  const pubPage = await new Browser(t.base).get(`/cursos/${slug}`); assert.match(pubPage.text, /★ 4,7/);
  assert.match((await new Browser(t.base).get('/')).text, /★ 4,7/, 'vitrine mostra a média');
  // reembolso/cancelamento: sai da média
  await q("UPDATE enrollments SET status='cancelled', cancelled_at=now() WHERE user_id=$1 AND course_id=$2", [cris.id, pid]);
  assert.deepEqual(await Co.ratingFor([pid]), {});
  assert.doesNotMatch((await new Browser(t.base).get('/')).text, /★ 4,7/);
  await q("UPDATE enrollments SET status='active', cancelled_at=NULL WHERE user_id=$1 AND course_id=$2", [cris.id, pid]);
});

test('depoimento sai do ar se o acesso for cancelado; a exclusão de dados remove o texto', async () => {
  const rv = (await q('SELECT id FROM course_reviews WHERE user_id=$1', [ana.id])).rows[0].id;
  assert.match((await new Browser(t.base).get(`/cursos/${slug}`)).text, /Texto novo/);
  await q("UPDATE enrollments SET status='cancelled', cancelled_at=now() WHERE user_id=$1 AND course_id=$2", [ana.id, pid]);
  assert.doesNotMatch((await new Browser(t.base).get(`/cursos/${slug}`)).text, /Texto novo/);
  await q("UPDATE enrollments SET status='active', cancelled_at=NULL WHERE user_id=$1 AND course_id=$2", [ana.id, pid]);
  const lgpd = require('../src/lgpd');
  const fn = lgpd.anonymize || lgpd.deleteAccount || lgpd.erase;
  assert.ok(fn, 'função de exclusão existe');
  const exp = await lgpd.exportFor(ana.id); assert.ok(exp.pedidos_de_download.length >= 1, 'cópia dos dados inclui pedidos de download'); assert.ok(exp.downloads_de_arquivos.length >= 1);
  await fn(ana.id);
  assert.equal((await q("SELECT count(*)::int n FROM download_requests WHERE user_id=$1 AND reason <> '[removido a pedido do titular]'", [ana.id])).rows[0].n, 0, 'motivo removido');
  assert.equal((await q('SELECT count(*)::int n FROM file_quota WHERE user_id=$1', [ana.id])).rows[0].n, 0);
  const x = (await q('SELECT comment, consent_publish, published FROM course_reviews WHERE id=$1', [rv])).rows[0];
  assert.equal(x.comment, ''); assert.equal(x.published, false); assert.equal(x.consent_publish, false);
});

test('produto digital não aparece em Certificados', async () => {
  const c = await crisB.get('/certificados'); assert.equal(c.status, 200);
  assert.doesNotMatch(c.text, /Guia do Sono/); assert.doesNotMatch(c.text, /Em andamento/);
});

test('nome abreviado é seguro com emoji, acento decomposto e nome único', () => {
  const { shortName } = require('../src/views/ui');
  assert.equal(shortName('Ana Costa Lima'), 'Ana L.'); assert.equal(shortName('maria silva'), 'maria S.'); assert.equal(shortName('Ana 🌸'), 'Ana 🌸.');
  assert.equal(shortName('Joana E\u0301lida'), 'Joana É.'); assert.equal(shortName('Madonna'), 'Madonna'); assert.equal(shortName('  '), 'Aluno');
});

test('remover o último arquivo tira o produto da vitrine', async () => {
  const c2 = (await admin.post('/admin/cursos', form({ title: 'Mini guia', slug: 'mini-guia' }), '/admin/cursos/novo?tipo=arquivos')); assert.equal(c2.status, 303);
  const id2 = (await q("SELECT id FROM courses WHERE slug='mini-guia'")).rows[0].id;
  await admin.upload(`/admin/cursos/${id2}/arquivos`, { label: 'Único', armazenamento: 'db' }, { name: 'u.pdf', buffer: PDF, type: 'application/pdf' }, { csrfFrom: `/admin/cursos/${id2}/arquivos` });
  assert.equal((await admin.post(`/admin/cursos/${id2}`, form({ title: 'Mini guia', slug: 'mini-guia', publish: '1' }), `/admin/cursos/${id2}`)).status, 303);
  const fid = (await q('SELECT file_id FROM product_files WHERE product_id=$1', [id2])).rows[0].file_id;
  await admin.post(`/admin/arquivos/${fid}/excluir`, {}, `/admin/cursos/${id2}/arquivos`);
  assert.equal((await q('SELECT status FROM courses WHERE id=$1', [id2])).rows[0].status, 'draft');
});
