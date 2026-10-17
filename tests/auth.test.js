'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const accept = (s) => t.pool.query("INSERT INTO acceptances (user_id, legal_document_id, doc_type, version) SELECT $1, id, doc_type, version FROM legal_documents WHERE status='published' ON CONFLICT DO NOTHING", [s.id]);
const { boot, Browser, adminReady, makeStudent, ADMIN, mailer } = require('./helpers');

let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

test('saúde, versão, manifest, robots e service worker', async () => {
  const b = new Browser(t.base);
  const h = await b.get('/health'); assert.equal(h.status, 200); assert.equal(JSON.parse(h.text).db, 'ok');
  const v = JSON.parse((await b.get('/version')).text); assert.equal(v.version, t.cfg.version.version);
  const m = await b.get('/manifest.webmanifest'); const mj = JSON.parse(m.text);
  assert.equal(mj.display, 'standalone'); assert.ok(mj.icons.some((i) => i.purpose === 'maskable'));
  assert.match((await b.get('/robots.txt')).text, /Disallow: \//);
  const sw = await b.get('/sw.js'); assert.ok(sw.text.includes(`evl-${v.version}`)); assert.ok(!sw.text.includes('__VERSION__'));
  assert.equal((await b.get('/offline')).status, 200);
  assert.equal((await b.get('/static/css/app.css')).status, 200);
});

test('cabeçalhos de segurança e cookies', async () => {
  const b = new Browser(t.base);
  const r = await b.get('/entrar');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('referrer-policy'), 'same-origin');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const cookies = r.headers.getSetCookie().join('\n');
  assert.match(cookies, /HttpOnly/i); assert.match(cookies, /SameSite=Lax/i);
});

test('login: página tem rodapé único com versão e direitos', async () => {
  const b = new Browser(t.base);
  const r = await b.get('/entrar');
  assert.match(r.text, /© 2026 EvoLumen Academy/);
  assert.match(r.text, /Mais um produto Belle Planner · Desenvolvido por Belle Planner · Versão 0\.1/);
  assert.match(r.text, /Ambiente de testes/);
});

test('rotas protegidas redirecionam para o login', async () => {
  const b = new Browser(t.base);
  for (const p of ['/meus-cursos', '/admin', '/perfil']) { const r = await b.get(p); assert.equal(r.status, 303); assert.equal(r.location, '/entrar'); }
});

test('POST sem token CSRF é recusado', async () => {
  const b = new Browser(t.base); await b.get('/entrar');
  const r = await b.req('POST', '/entrar', { email: ADMIN.email, password: ADMIN.password });
  assert.equal(r.status, 403);
});

test('POST com Origin de outro site é recusado', async () => {
  const b = new Browser(t.base); const _csrf = await b.csrf();
  const r = await b.req('POST', '/entrar', { _csrf, email: 'a@b.com', password: 'x' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('erro de login não revela se o e-mail existe', async () => {
  const b = new Browser(t.base);
  const a = await b.login('naoexiste@example.com', 'qualquer123');
  const c = await b.login(ADMIN.email, 'senhaerrada1');
  assert.equal(a.status, 401); assert.equal(c.status, 401);
  const msg = (x) => x.text.match(/class="alert[^>]*>([^<]*)/)[1];
  assert.equal(msg(a), msg(c));
});

test('admin: primeiro acesso força a troca de senha e depois libera o painel', async () => {
  const b = new Browser(t.base);
  const r = await b.login(ADMIN.email.toUpperCase(), ADMIN.password);
  assert.equal(r.location, '/primeiro-acesso');
  assert.equal((await b.get('/admin')).location, '/primeiro-acesso');
  const weak = await b.post('/primeiro-acesso', { current: ADMIN.password, password: 'curta', confirm: 'curta' });
  assert.equal(weak.status, 422);
  const same = await b.post('/primeiro-acesso', { current: ADMIN.password, password: ADMIN.password, confirm: ADMIN.password });
  assert.equal(same.status, 422);
  const ok = await b.post('/primeiro-acesso', { current: ADMIN.password, password: 'NovaSenha2026', confirm: 'NovaSenha2026' });
  assert.equal(ok.location, '/admin');
  const page = await b.get('/admin'); assert.equal(page.status, 200);
  assert.match(page.text, /Verificação do ambiente/); assert.match(page.text, /noreply@belleplanner\.com\.br/);
  assert.equal((await b.get('/meus-cursos')).status, 200);
});

test('aluno não acessa o painel admin e o menu mostra só o que existe na fase', async () => {
  const s = await makeStudent(t);
  const b = new Browser(t.base);
  assert.equal((await b.login(s.email, s.password)).location, '/meus-cursos');
  assert.equal((await b.get('/admin')).status, 403);
  const page = await b.get('/meus-cursos');
  assert.match(page.text, /href="\/perfil"/); assert.doesNotMatch(page.text, /href="\/admin"/);
});

test('bloqueio após 5 senhas erradas e liberação com o tempo', async () => {
  const s = await makeStudent(t, { email: 'lock@example.com', name: 'Lock Teste' });
  const b = new Browser(t.base);
  for (let i = 0; i < 5; i++) assert.equal((await b.login(s.email, 'errada123')).status, 401);
  assert.equal((await b.login(s.email, s.password)).status, 401, 'senha certa também é barrada durante o bloqueio');
  await t.pool.query("UPDATE users SET locked_until = now() - interval '1 minute' WHERE email = $1", [s.email]);
  assert.equal((await b.login(s.email, s.password)).status, 303);
});

test('sair encerra a sessão', async () => {
  const s = await makeStudent(t, { email: 'sair@example.com', name: 'Sai Teste' });
  const b = new Browser(t.base); await b.login(s.email, s.password);
  const out = await b.post('/sair', {}, '/meus-cursos');
  assert.equal(out.location, '/entrar');
  assert.equal((await b.get('/meus-cursos')).location, '/entrar');
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM sessions WHERE user_id=$1', [s.id])).rows[0].n, 0);
});

test('recuperação de senha: resposta igual, link de uso único, sessões encerradas', async () => {
  const s = await makeStudent(t, { email: 'reset@example.com', name: 'Reset Teste' });
  const logged = new Browser(t.base); await logged.login(s.email, s.password);
  const b = new Browser(t.base);
  mailer.memory.length = 0;
  const a = await b.post('/esqueci-senha', { email: 'ninguem@example.com' }, '/esqueci-senha');
  const c = await b.post('/esqueci-senha', { email: s.email }, '/esqueci-senha');
  assert.equal(a.status, 200); assert.equal(c.status, 200);
  assert.equal(a.text.match(/class="alert[^>]*>([^<]*)/)[1], c.text.match(/class="alert[^>]*>([^<]*)/)[1]);
  await t.app.locals.idle();
  const mail = mailer.memory.find((m) => m.to === s.email); assert.ok(mail, 'e-mail de recuperação enviado');
  assert.equal(mailer.memory.filter((m) => m.to === 'ninguem@example.com').length, 0);
  const link = mail.text.match(/\/redefinir-senha\/([A-Za-z0-9_-]+)/)[1];
  assert.equal((await b.get('/redefinir-senha/' + link)).status, 200);
  assert.equal((await b.post('/redefinir-senha/' + link, { password: 'fraca', confirm: 'fraca' }, '/redefinir-senha/' + link)).status, 422);
  const done = await b.post('/redefinir-senha/' + link, { password: 'NovaSenha777', confirm: 'NovaSenha777' }, '/redefinir-senha/' + link);
  assert.equal(done.location, '/entrar');
  assert.equal((await b.get('/redefinir-senha/' + link)).status, 410, 'link já usado');
  assert.equal((await logged.get('/meus-cursos')).location, '/entrar', 'sessão antiga encerrada');
  assert.equal((await new Browser(t.base).login(s.email, 'NovaSenha777')).location, '/meus-cursos');
  assert.equal((await b.get('/redefinir-senha/tokeninvalido')).status, 410);
  const rows = (await t.pool.query('SELECT token_hash FROM password_resets WHERE user_id=$1', [s.id])).rows;
  assert.ok(rows.every((r) => !mail.text.includes(r.token_hash)), 'token não é guardado em texto puro');
});

test('troca de senha pelo perfil exige senha atual e desconecta outros aparelhos', async () => {
  const s = await makeStudent(t, { email: 'senha@example.com', name: 'Senha Teste' });
  const a = new Browser(t.base); await a.login(s.email, s.password);
  const other = new Browser(t.base); await other.login(s.email, s.password);
  assert.equal((await a.post('/perfil/senha', { current: 'errada', password: 'OutraSenha9', confirm: 'OutraSenha9' }, '/perfil')).status, 422);
  assert.equal((await a.post('/perfil/senha', { current: s.password, password: 'OutraSenha9', confirm: 'OutraSenha9' }, '/perfil')).location, '/perfil');
  assert.equal((await a.get('/perfil')).status, 200);
  assert.equal((await other.get('/perfil')).location, '/entrar');
});

test('perfil: atualiza dados, valida campos e protege o CPF', async () => {
  const s = await makeStudent(t, { email: 'perfil@example.com', name: 'Perfil Teste' });
  const b = new Browser(t.base); await b.login(s.email, s.password);
  const before = (await t.pool.query('SELECT cpf FROM users WHERE id=$1', [s.id])).rows[0];
  const bad = await b.post('/perfil', { name: '', cep: '123', state: 'ZZ' }, '/perfil');
  assert.equal(bad.status, 422);
  const ok = await b.post('/perfil', { name: 'Maria S. Souza', phone: '(11) 98888-7777', cep: '01310-100', state: 'SP', city: 'São Paulo', cpf: '00000000000' }, '/perfil');
  assert.equal(ok.location, '/perfil');
  const row = (await t.pool.query('SELECT name, cpf, state, cep FROM users WHERE id=$1', [s.id])).rows[0];
  assert.equal(row.name, 'Maria S. Souza'); assert.equal(row.cpf, before.cpf); assert.equal(row.state, 'SP');
});

test('troca de e-mail em duas etapas', async () => {
  const s = await makeStudent(t, { email: 'troca@example.com', name: 'Troca Teste' });
  await makeStudent(t, { email: 'ocupado@example.com', name: 'Outro' });
  const b = new Browser(t.base); await b.login(s.email, s.password);
  assert.equal((await b.post('/perfil/email/solicitar', { new_email: 'ocupado@example.com' }, '/perfil/email')).status, 422);
  assert.equal((await b.post('/perfil/email/solicitar', { new_email: 'TROCA@example.com' }, '/perfil/email')).status, 422);
  mailer.memory.length = 0;
  assert.equal((await b.post('/perfil/email/solicitar', { new_email: 'Nova@Example.com' }, '/perfil/email')).location, '/perfil/email');
  await t.app.locals.idle();
  const m1 = mailer.memory.find((m) => m.to === 'troca@example.com'); const m2 = mailer.memory.find((m) => m.to === 'nova@example.com');
  assert.ok(m1 && m2);
  const code = (m) => m.text.match(/\b(\d{6})\b/)[1];
  assert.equal((await b.post('/perfil/email/confirmar', { code_current: code(m1), code_new: '000000' }, '/perfil/email')).status, 422);
  assert.equal((await t.pool.query('SELECT email FROM users WHERE id=$1', [s.id])).rows[0].email, 'troca@example.com');
  const ok = await b.post('/perfil/email/confirmar', { code_current: code(m1), code_new: code(m2) }, '/perfil/email');
  assert.equal(ok.location, '/perfil');
  assert.equal((await t.pool.query('SELECT email FROM users WHERE id=$1', [s.id])).rows[0].email, 'nova@example.com');
  assert.equal((await new Browser(t.base).login('nova@example.com', s.password)).status, 303);
});

test('troca de e-mail: 5 erros cancelam o pedido; pedir ao admin gera registro e e-mail', async () => {
  const s = await makeStudent(t, { email: 'tent@example.com', name: 'Tent Teste' });
  const b = new Browser(t.base); await b.login(s.email, s.password);
  await b.post('/perfil/email/solicitar', { new_email: 'tent2@example.com' }, '/perfil/email');
  for (let i = 0; i < 5; i++) await b.post('/perfil/email/confirmar', { code_current: '111111', code_new: '222222' }, '/perfil/email');
  assert.equal((await t.pool.query("SELECT status FROM email_changes WHERE user_id=$1 ORDER BY id DESC LIMIT 1", [s.id])).rows[0].status, 'cancelled');
  mailer.memory.length = 0;
  assert.equal((await b.post('/perfil/email/admin', { new_email: 'tent3@example.com' }, '/perfil/email?admin=1')).location, '/perfil');
  await t.app.locals.idle();
  assert.equal((await t.pool.query("SELECT count(*)::int n FROM data_requests WHERE user_id=$1 AND type='email_change_admin'", [s.id])).rows[0].n, 1);
  assert.ok(mailer.memory.some((m) => m.to === ADMIN.email));
});

test('LGPD: exportação não vaza o hash da senha; exclusão cria um único pedido', async () => {
  const s = await makeStudent(t, { email: 'lgpd@example.com', name: 'Lgpd Teste' });
  const b = new Browser(t.base); await b.login(s.email, s.password);
  const ex = await b.get('/perfil/meus-dados.json');
  assert.equal(ex.status, 200); assert.ok(!ex.text.includes('password_hash')); assert.ok(!ex.text.includes('$2'));
  assert.equal(JSON.parse(ex.text).usuario.email, s.email);
  await b.post('/perfil/exclusao', {}, '/perfil'); await b.post('/perfil/exclusao', {}, '/perfil');
  assert.equal((await t.pool.query("SELECT count(*)::int n FROM data_requests WHERE user_id=$1 AND type='delete'", [s.id])).rows[0].n, 1);
});

test('aceite LGPD: bloqueia até aceitar o texto publicado e registra IP e aparelho', async () => {
  const s = await makeStudent(t, { email: 'aceite@example.com', name: 'Aceite Teste' });
  const b = new Browser(t.base); await b.login(s.email, s.password);
  assert.equal((await b.get('/meus-cursos')).status, 200, 'rascunho não bloqueia');
  await t.pool.query("UPDATE legal_documents SET status='published', published_at=now(), body_html='<p>Texto de teste</p>'");
  const gate = await b.get('/meus-cursos'); assert.equal(gate.location, '/aceite');
  const page = await b.get('/aceite'); assert.match(page.text, /Texto de teste/);
  assert.equal((await b.post('/aceite', {}, '/aceite')).location, '/aceite', 'sem marcar, não passa');
  const ids = [...page.text.matchAll(/name="doc_(\d+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 2);
  const ok = await b.post('/aceite', Object.fromEntries(ids.map((i) => [`doc_${i}`, '1'])), '/aceite');
  assert.equal(ok.location, '/meus-cursos');
  assert.equal((await b.get('/meus-cursos')).status, 200);
  const acc = (await t.pool.query('SELECT * FROM acceptances WHERE user_id=$1', [s.id])).rows;
  assert.equal(acc.length, 2); assert.ok(acc[0].ip); assert.match(acc[0].device, /Computador · Chrome/);
  assert.match((await b.get('/perfil')).text, /Termos de uso v1\.0: aceito em/);
});

test('aceites e auditoria são imutáveis no banco', async () => {
  await assert.rejects(t.pool.query("UPDATE acceptances SET ip='1.1.1.1'"), /imutável/);
  await assert.rejects(t.pool.query('DELETE FROM acceptances'), /imutável/);
  await assert.rejects(t.pool.query("UPDATE audit_log SET action='x'"), /imutável/);
  await assert.rejects(t.pool.query('DELETE FROM audit_log'), /imutável/);
  await assert.rejects(t.pool.query('TRUNCATE acceptances'), /imutável/);
  await assert.rejects(t.pool.query('TRUNCATE audit_log'), /imutável/);
  const n = (await t.pool.query("SELECT count(*)::int n FROM audit_log WHERE action IN ('login_success','login_failed','login_locked','password_reset_done','first_access_completed')")).rows[0].n;
  assert.ok(n >= 5, 'eventos de segurança foram auditados');
});

test('404 e erro amigável', async () => {
  const b = new Browser(t.base);
  const r = await b.get('/nao-existe'); assert.equal(r.status, 404); assert.match(r.text, /Não achei essa/);
});

test('pedidos paralelos do navegador (ícone, JSON) não trocam o identificador do formulário', async () => {
  const b = new Browser(t.base);
  const page = await b.req('GET', '/entrar', null, { accept: 'text/html' });
  const csrf = page.text.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
  const anon = b.jar.evl_a; assert.ok(anon);
  const jar2 = new Browser(t.base);
  for (const u of ['/favicon.ico', '/health', '/manifest.webmanifest']) await b.req('GET', u, null, { accept: 'image/*,*/*;q=0.8' });
  assert.equal(b.jar.evl_a, anon);
  const r = await b.req('POST', '/entrar', { _csrf: csrf, email: 'x@y.com', password: 'abc' });
  assert.equal(r.status, 401);
  void jar2;
});

test('aceite em duplicidade (duplo clique) grava uma só vez', async () => {
  const s = await makeStudent(t, { email: 'duplo@example.com', name: 'Duplo Clique' });
  const b = new Browser(t.base); await b.login(s.email, s.password);
  const page = await b.get('/aceite');
  const ids = [...page.text.matchAll(/name="doc_(\d+)"/g)].map((m) => m[1]);
  const form = Object.fromEntries(ids.map((i) => [`doc_${i}`, '1']));
  const _csrf = await b.csrf('/aceite');
  await Promise.all([b.req('POST', '/aceite', { _csrf, ...form }), b.req('POST', '/aceite', { _csrf, ...form })]);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM acceptances WHERE user_id=$1', [s.id])).rows[0].n, 2);
});

test('códigos de e-mail: tentativas paralelas não passam do limite e a mensagem não diz qual código errou', async () => {
  const s = await makeStudent(t, { email: 'paralelo@example.com', name: 'Paralelo Teste' });
  await accept(s);
  const b = new Browser(t.base); await b.login(s.email, s.password);
  await b.post('/perfil/email/solicitar', { new_email: 'paralelo2@example.com' }, '/perfil/email');
  const _csrf = await b.csrf('/perfil/email');
  const rs = await Promise.all(Array.from({ length: 12 }, () => b.req('POST', '/perfil/email/confirmar', { _csrf, code_current: '123456', code_new: '654321' })));
  const row = (await t.pool.query('SELECT attempts, status FROM email_changes WHERE user_id=$1 ORDER BY id DESC LIMIT 1', [s.id])).rows[0];
  assert.ok(row.attempts <= 5, 'tentativas: ' + row.attempts); assert.equal(row.status, 'cancelled');
  const wrong = rs.find((r) => r.status === 422);
  if (wrong) { assert.match(wrong.text, /Confira os dois códigos/); assert.doesNotMatch(wrong.text, /Código incorreto/); }
});

test('troca de e-mail invalida links de recuperação antigos', async () => {
  const s = await makeStudent(t, { email: 'antigo@example.com', name: 'Antigo Teste' });
  await accept(s);
  const b = new Browser(t.base); await b.login(s.email, s.password);
  const anon = new Browser(t.base); mailer.memory.length = 0;
  await anon.post('/esqueci-senha', { email: s.email }, '/esqueci-senha'); await t.app.locals.idle();
  const link = mailer.memory.find((m) => m.to === s.email).text.match(/\/redefinir-senha\/([A-Za-z0-9_-]+)/)[1];
  mailer.memory.length = 0;
  await b.post('/perfil/email/solicitar', { new_email: 'novo-antigo@example.com' }, '/perfil/email'); await t.app.locals.idle();
  const code = (to) => mailer.memory.find((m) => m.to === to).text.match(/\b(\d{6})\b/)[1];
  await b.post('/perfil/email/confirmar', { code_current: code(s.email), code_new: code('novo-antigo@example.com') }, '/perfil/email');
  assert.equal((await anon.get('/redefinir-senha/' + link)).status, 410);
});
