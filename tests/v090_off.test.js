'use strict';
// 0.9.0 · Com ALLOW_LAUNCH_RESET desligada, o reset não executa nada, nem com tudo certo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, adminReady, makeStudent } = require('./helpers');

let t; let admin;
before(async () => { t = await boot(); admin = await adminReady(t); });
after(async () => { await t.close(); });

test('reset desligado: tela explica, prévia e execução recusam, nada é apagado', async () => {
  assert.equal(t.cfg.allowLaunchReset, false);
  const u = await makeStudent(t, { email: 'teste@example.com' });
  const page = await admin.get('/admin/lancamento');
  assert.match(page.text, /O reset está <b>desligado<\/b>/); assert.match(page.text, /ALLOW_LAUNCH_RESET/); assert.doesNotMatch(page.text, /Ver prévia/);
  const pv = await admin.post('/admin/lancamento/previa', { emails: u.email }, '/admin/lancamento');
  assert.equal(pv.status, 303);
  const ex = await admin.post('/admin/lancamento/executar', { emails: u.email, sig: 'x', frase: 'APAGAR 1 CONTA', senha: 'NovaSenha2026' }, '/admin/lancamento');
  assert.equal(ex.status, 303);
  assert.equal((await t.pool.query("SELECT count(*)::int AS n FROM users WHERE email='teste@example.com'")).rows[0].n, 1);
  assert.equal((await t.pool.query("SELECT count(*)::int AS n FROM audit_log WHERE action LIKE 'launch_%'")).rows[0].n, 0);
});
