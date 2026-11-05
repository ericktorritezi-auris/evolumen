'use strict';
// 1.5.0 · Recibo de repasse: destino (Pix ou conta) no cadastro do afiliado, congelado no repasse; PDF para o admin e para o próprio afiliado.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Browser, adminReady, makeStudent } = require('./helpers');
const R = require('../src/receipts');
const AFF = require('../src/affiliates');

let t; let admin;
const q = (sql, p) => t.pool.query(sql, p);
const LONG = '<h1>Texto</h1><p>' + 'Este é um parágrafo de teste do documento legal, longo o bastante para ser publicado. '.repeat(4) + '</p>';
const newAff = async (name, email, extra = {}) => {
  const r = await admin.post('/admin/afiliados', { name, email, phone: '(11) 98888-7777', note: 'interna', ...extra }, '/admin/afiliados/novo');
  return { r, row: (await q('SELECT * FROM affiliates WHERE lower(email)=$1', [email.toLowerCase()])).rows[0] };
};
const pay = (a, amount, paid_on = '2026-10-24') => admin.post(`/admin/afiliados/${a.id}/repasses`, { amount, paid_on, note: '' }, `/admin/afiliados/${a.id}`);
const lastPayout = async (id) => (await q('SELECT * FROM affiliate_payouts WHERE affiliate_id=$1 ORDER BY id DESC LIMIT 1', [id])).rows[0];

before(async () => {
  t = await boot(); admin = await adminReady(t);
  await q("UPDATE legal_documents SET status='published', published_at=now(), body_html=$1 WHERE doc_type IN ('terms','privacy','affiliate')", [LONG]);
  await q("UPDATE users SET cpf='28075849850' WHERE role='admin'");
  await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT u.id, d.id, d.doc_type, d.version, 'login' FROM users u, legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING");
});
after(async () => { await t.close(); });

test('valor por extenso e data por extenso', () => {
  const casos = { 100: 'um real', 101: 'um real e um centavo', 1: 'um centavo', 5000: 'cinquenta reais', 15020: 'cento e cinquenta reais e vinte centavos',
    110000: 'mil e cem reais', 100100: 'mil e um reais', 250000: 'dois mil e quinhentos reais', 100000000: 'um milhão de reais', 21: 'vinte e um centavos', 0: 'zero real' };
  for (const [c, s] of Object.entries(casos)) assert.equal(R.extenso(Number(c)), s, c);
  assert.equal(R.dataLonga('2026-10-24'), '24 de outubro de 2026');
  assert.equal(R.cpfFmt('28075849850'), '280.758.498-50');
});

test('cadastro: Pix ou conta, com validação do tipo escolhido', async () => {
  const bad = await newAff('Ana Pix Teste', 'anapix@example.com', { dest_kind: 'pix', pix_key: '' });
  assert.equal(bad.row, undefined, 'Pix escolhido sem chave não cadastra');
  const ok = await newAff('Ana Pix Teste', 'anapix@example.com', { dest_kind: 'pix', pix_key: 'ana@pix.com', bank_name: 'Banco X' });
  assert.equal(ok.row.dest_kind, 'pix'); assert.equal(ok.row.pix_key, 'ana@pix.com');
  assert.equal(AFF.destText(ok.row), 'na chave Pix ana@pix.com');
  const noConta = await newAff('Beto Conta', 'betoconta@example.com', { dest_kind: 'conta', bank_name: 'Nubank', bank_agency: '0001', bank_account: '' });
  assert.equal(noConta.row, undefined, 'conta incompleta não cadastra');
  const conta = await newAff('Beto Conta', 'betoconta@example.com', { dest_kind: 'conta', bank_name: 'Nubank', bank_agency: '0001', bank_account: '123-4' });
  assert.equal(AFF.destText(conta.row), 'na conta bancária: banco Nubank, agência 0001, conta 123-4');
  const none = await newAff('Cida Sem Destino', 'cida@example.com');
  assert.equal(none.row.dest_kind, ''); assert.equal(AFF.destText(none.row), '');
  const page = await admin.get(`/admin/afiliados/${ok.row.id}`);
  assert.match(page.text, /Chave Pix/); assert.match(page.text, /value="ana@pix.com"/);
});

test('repasse congela o destino; mudar o cadastro depois não muda o recibo', async () => {
  const { row: a } = await newAff('Davi Congela', 'davi@example.com', { dest_kind: 'pix', pix_key: 'davi-antigo@pix.com' });
  await pay(a, '50,00');
  const p = await lastPayout(a.id);
  assert.equal(p.dest_text, 'na chave Pix davi-antigo@pix.com');
  await admin.post(`/admin/afiliados/${a.id}`, { name: a.name, email: a.email, phone: '(11) 98888-7777', note: '', dest_kind: 'conta', bank_name: 'Itaú', bank_agency: '1', bank_account: '2' }, `/admin/afiliados/${a.id}`);
  const rec = await R.forPayout(p.id);
  assert.equal(rec.dest, 'na chave Pix davi-antigo@pix.com');
  assert.equal(rec.signer_cpf, '280.758.498-50');
  assert.equal(rec.paid_on, '2026-10-24');
  await pay(a, '10,00', '2026-10-25');
  assert.equal((await lastPayout(a.id)).dest_text, 'na conta bancária: banco Itaú, agência 1, conta 2');
});

test('repasse antigo (sem destino congelado) usa o cadastro atual; sem destino, o recibo sai sem o trecho', async () => {
  const { row: a } = await newAff('Edu Antigo', 'eduantigo@example.com', { dest_kind: 'pix', pix_key: 'edu@pix.com' });
  await pay(a, '20,00'); const p = await lastPayout(a.id);
  await q('UPDATE affiliate_payouts SET dest_text = NULL WHERE id=$1', [p.id]);
  assert.equal((await R.forPayout(p.id)).dest, 'na chave Pix edu@pix.com');
  const { row: b } = await newAff('Fabi Sem', 'fabisem@example.com');
  await pay(b, '20,00'); const pb = await lastPayout(b.id);
  assert.equal((await R.forPayout(pb.id)).dest, '');
  const buf = await R.pdf(await R.forPayout(pb.id)); assert.equal(buf.slice(0, 4).toString(), '%PDF');
});

test('PDF do admin: baixa, anulado não gera recibo', async () => {
  const { row: a } = await newAff('Gil Admin', 'gil@example.com', { dest_kind: 'pix', pix_key: 'gil@pix.com' });
  await pay(a, '75,50'); const p = await lastPayout(a.id);
  const r = await admin.get(`/admin/afiliados/${a.id}/repasses/${p.id}/recibo.pdf`);
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /application\/pdf/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="recibo-repasse-2026-\d{4}\.pdf"/);
  assert.ok(r.text.startsWith('%PDF'));
  assert.match((await admin.get(`/admin/afiliados/${a.id}`)).text, /Baixar recibo/);
  assert.equal((await q("SELECT count(*)::int n FROM audit_log WHERE action='affiliate_receipt_downloaded'")).rows[0].n, 1);
  await admin.post(`/admin/afiliados/${a.id}/repasses/${p.id}/anular`, { reason: 'valor errado' }, `/admin/afiliados/${a.id}`);
  const r2 = await admin.get(`/admin/afiliados/${a.id}/repasses/${p.id}/recibo.pdf`);
  assert.equal(r2.status, 303); assert.equal(await R.forPayout(p.id), null);
  const outro = await admin.get(`/admin/afiliados/${a.id}/repasses/99999999/recibo.pdf`);
  assert.equal(outro.status, 303);
});

test('afiliado baixa só o recibo dos próprios repasses', async () => {
  const mk = async (name, email, pix) => {
    const { row: a } = await newAff(name, email, { dest_kind: 'pix', pix_key: pix });
    const u = await makeStudent(t, { email, name });
    await q("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version, origin) SELECT $1, d.id, d.doc_type, d.version, 'login' FROM legal_documents d WHERE d.status='published' ON CONFLICT DO NOTHING", [u.id]);
    await q('UPDATE affiliates SET user_id=$2 WHERE id=$1', [a.id, u.id]);
    const b = new Browser(t.base); await b.login(u.email, u.password);
    return { a, b };
  };
  const hel = await mk('Helena Painel', 'helena@example.com', 'helena@pix.com');
  const igo = await mk('Igor Painel', 'igor@example.com', 'igor@pix.com');
  await pay(hel.a, '30,00'); await pay(igo.a, '40,00');
  const ph = await lastPayout(hel.a.id); const pi = await lastPayout(igo.a.id);
  const painel = await hel.b.get('/afiliado');
  assert.match(painel.text, new RegExp(`/afiliado/repasses/${ph.id}/recibo\\.pdf`)); assert.ok(!painel.text.includes(`/repasses/${pi.id}/`));
  const ok = await hel.b.get(`/afiliado/repasses/${ph.id}/recibo.pdf`);
  assert.equal(ok.status, 200); assert.match(ok.headers.get('content-type'), /application\/pdf/); assert.ok(ok.text.startsWith('%PDF'));
  assert.equal((await hel.b.get(`/afiliado/repasses/${pi.id}/recibo.pdf`)).status, 404, 'recibo de outro afiliado');
  assert.equal((await new Browser(t.base).get(`/afiliado/repasses/${ph.id}/recibo.pdf`)).status === 200, false, 'sem login');
  await admin.post(`/admin/afiliados/${hel.a.id}/repasses/${ph.id}/anular`, { reason: 'erro' }, `/admin/afiliados/${hel.a.id}`);
  assert.equal((await hel.b.get(`/afiliado/repasses/${ph.id}/recibo.pdf`)).status, 404, 'anulado');
});

test('pedido de exclusão (LGPD) apaga Pix, conta e destino dos repasses', async () => {
  const lgpd = require('../src/lgpd');
  const { row: a } = await newAff('Jana Lgpd', 'jana@example.com', { dest_kind: 'pix', pix_key: 'jana@pix.com' });
  const u = await makeStudent(t, { email: 'jana@example.com', name: 'Jana Lgpd' });
  await q('UPDATE affiliates SET user_id=$2 WHERE id=$1', [a.id, u.id]);
  await pay(a, '10,00');
  const exp = await lgpd.exportFor(u.id).catch(() => null);
  if (exp) assert.match(JSON.stringify(exp), /jana@pix.com/);
  const c = await t.pool.connect();
  try { await c.query('BEGIN'); await lgpd.anonymize(u.id, c); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  const row = (await q('SELECT * FROM affiliates WHERE id=$1', [a.id])).rows[0];
  assert.equal(row.pix_key, ''); assert.equal(row.dest_kind, '');
  assert.equal((await lastPayout(a.id)).dest_text, '');
});

test('editar sem enviar os campos de destino não apaga o Pix; outro assinante não leva a assinatura do Erick', async () => {
  const { row: a } = await newAff('Kleber Mantém', 'kleber@example.com', { dest_kind: 'pix', pix_key: 'kleber@pix.com' });
  await admin.post(`/admin/afiliados/${a.id}`, { name: a.name, email: a.email, phone: '(11) 98888-7777', note: 'nova' }, `/admin/afiliados/${a.id}`);
  const r = (await q('SELECT * FROM affiliates WHERE id=$1', [a.id])).rows[0];
  assert.equal(r.note, 'nova'); assert.equal(r.pix_key, 'kleber@pix.com'); assert.equal(r.dest_kind, 'pix');
  const base = { id: 1, amount_cents: 1000, paid_on: '2026-10-24', affiliate_name: 'X Y', dest: '', signer_cpf: '' };
  const com = await R.pdf({ ...base, signer: 'Erick Torritezi' }); const sem = await R.pdf({ ...base, signer: 'Outra Pessoa' });
  assert.ok(com.length > sem.length + 5000, 'assinatura manuscrita só para o Erick');
});
