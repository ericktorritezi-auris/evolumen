'use strict';
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const log = require('./logger');
const sec = require('./security');
const { audit } = require('./audit');
const acceptance = require('./acceptance');
const mailer = require('./mailer');
const emails = require('./emails');
const V = require('./validation');
const authViews = require('./views/auth');
const appViews = require('./views/app');

const GENERIC_LOGIN_ERROR = 'E-mail ou senha incorretos, ou acesso temporariamente bloqueado.';

function build(cfg, app) {
  const r = express.Router();
  // Hash falso com o mesmo custo dos reais: e-mail inexistente demora igual a e-mail existente.
  const DUMMY_HASH = bcrypt.hashSync('senha-falsa-para-igualar-o-tempo', cfg.bcryptCost);
  const pending = new Set();
  const background = (p) => { const t = p.catch((e) => log.error('tarefa_em_segundo_plano_falhou', { error: e.message })).finally(() => pending.delete(t)); pending.add(t); return t; };
  app.locals.idle = async () => { while (pending.size) await Promise.all([...pending]); };

  // ---- mensagens rápidas (flash), assinadas para não poderem ser forjadas ----
  const flashSig = (v) => crypto.createHmac('sha256', cfg.sessionSecret).update('flash:' + v).digest('base64url');
  const setFlash = (res, type, text) => {
    const v = Buffer.from(JSON.stringify({ type, text })).toString('base64url');
    res.cookie('evl_f', `${v}.${flashSig(v)}`, { httpOnly: true, sameSite: 'lax', secure: cfg.secureCookies, path: '/', maxAge: 60000 });
  };
  const popFlash = (req, res) => {
    const c = req.cookies && req.cookies.evl_f;
    if (!c) return null;
    res.clearCookie('evl_f', { path: '/' });
    const [v, sig] = c.split('.');
    if (!v || !sig || !sec.safeEqual(sig, flashSig(v))) return null;
    try { const o = JSON.parse(Buffer.from(v, 'base64url').toString()); return ['success', 'error', 'info'].includes(o.type) ? o : null; } catch { return null; }
  };

  const limiter = (windowMs, limit) => rateLimit({
    windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (req, res, next) => { const e = new Error('Muitas tentativas. Aguarde alguns minutos e tente de novo.'); e.status = 429; e.expose = true; next(e); },
  });
  const loginLimit = cfg.isTest ? (req, res, next) => next() : limiter(15 * 60 * 1000, 30);
  const mailLimit = cfg.isTest ? (req, res, next) => next() : limiter(60 * 60 * 1000, 12);

  const home = (u) => (u.role === 'admin' ? '/admin' : '/meus-cursos');
  const view = (req, res) => ({ cfg, csrf: req.csrf, flash: popFlash(req, res) });
  const appCtx = (req, res) => ({ cfg, user: req.user, csrf: req.csrf, flash: popFlash(req, res) });

  // ---- porteiros ----
  const needUser = (req, res, next) => (req.user ? next() : res.redirect(303, '/entrar'));
  const gate = async (req, res, next) => {
    if (!req.user) return res.redirect(303, '/entrar');
    const free = ['/primeiro-acesso', '/sair'];
    if (req.user.must_change_password && !free.includes(req.path)) return res.redirect(303, '/primeiro-acesso');
    if (!req.user.must_change_password && !['/aceite', '/sair'].includes(req.path)) {
      const p = await acceptance.pendingFor(req.user.id);
      if (p.length) return res.redirect(303, '/aceite');
    }
    next();
  };
  const needAdmin = (req, res, next) => {
    if (req.user.role === 'admin') return next();
    const e = new Error('Você não tem acesso a esta área.'); e.status = 403; e.expose = true; next(e);
  };


  // ---- login e logout ----
  r.get('/entrar', (req, res) => {
    if (req.user) return res.redirect(303, home(req.user));
    res.send(authViews.login(view(req, res)));
  });

  r.post('/entrar', loginLimit, async (req, res) => {
    const email = V.normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const fail = async (user) => {
      if (user) {
        const u = await db.q(
          `UPDATE users SET failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END,
                  locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END
           WHERE id = $1 RETURNING (locked_until > now() AND failed_logins = 0) AS just_locked`,
          [user.id, cfg.lockAfterFailures, String(cfg.lockMinutes)]);
        if (u.rows[0] && u.rows[0].just_locked) await audit(req, 'login_locked', { actor: user, entity: 'user', entityId: user.id });
      }
      await audit(req, 'login_failed', { entity: 'user', entityId: user ? user.id : null, meta: email ? { email } : {} });
      res.status(401).send(authViews.login({ cfg, csrf: req.csrf, email: email || '', flash: { type: 'error', text: GENERIC_LOGIN_ERROR } }));
    };
    if (!email || !password || password.length > 200) return fail(null);
    const found = await db.q('SELECT * FROM users WHERE lower(email) = $1', [email]);
    const user = found.rows[0] || null;
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    const locked = user && user.locked_until && new Date(user.locked_until) > new Date();
    if (!user || !ok || user.status !== 'active' || locked) return fail(user && !locked ? user : null);
    await db.q('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
    if (req.sessionId) await sec.destroySession(req, res);
    await sec.createSession(cfg, req, res, user.id);
    await audit(req, 'login_success', { actor: user, entity: 'user', entityId: user.id });
    res.redirect(303, user.must_change_password ? '/primeiro-acesso' : home(user));
  });

  r.post('/sair', async (req, res) => {
    if (req.user) await audit(req, 'logout', { entity: 'user', entityId: req.user.id });
    await sec.destroySession(req, res);
    setFlash(res, 'success', 'Você saiu da sua conta.');
    res.redirect(303, '/entrar');
  });

  // ---- primeiro acesso: troca obrigatória da senha provisória ----
  r.get('/primeiro-acesso', needUser, (req, res) => {
    if (!req.user.must_change_password) return res.redirect(303, home(req.user));
    res.send(authViews.firstAccess(view(req, res)));
  });
  r.post('/primeiro-acesso', loginLimit, needUser, async (req, res) => {
    if (!req.user.must_change_password) return res.redirect(303, home(req.user));
    const errors = {};
    const { current = '', password = '', confirm = '' } = req.body;
    if (!(await bcrypt.compare(String(current), req.user.password_hash))) errors.current = 'A senha provisória não confere.';
    const pe = V.checkPassword(password);
    if (pe) errors.password = pe;
    else if (password === current) errors.password = 'Escolha uma senha diferente da provisória.';
    if (!errors.password && password !== confirm) errors.confirm = 'As senhas não são iguais.';
    if (Object.keys(errors).length) return res.status(422).send(authViews.firstAccess({ cfg, csrf: req.csrf, errors }));
    const hash = await bcrypt.hash(String(password), cfg.bcryptCost);
    await db.q('UPDATE users SET password_hash = $2, must_change_password = FALSE, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1', [req.user.id, hash]);
    await sec.destroyOtherSessions(req.user.id, req.sessionId);
    await audit(req, 'first_access_completed', { entity: 'user', entityId: req.user.id });
    background(mailer.send(cfg, { to: req.user.email, ...emails.passwordChanged(cfg, req.user.name) }));
    setFlash(res, 'success', 'Senha criada. Bem-vindo(a)!');
    res.redirect(303, home(req.user));
  });

  // ---- recuperação de senha ----
  r.get('/esqueci-senha', (req, res) => res.send(authViews.forgot(view(req, res))));
  r.post('/esqueci-senha', loginLimit, mailLimit, async (req, res) => {
    const email = V.normalizeEmail(req.body.email);
    const work = async () => {
      if (!email) return;
      const u = (await db.q("SELECT * FROM users WHERE lower(email) = $1 AND status = 'active'", [email])).rows[0];
      if (!u) return;
      const recent = (await db.q("SELECT count(*)::int AS n FROM password_resets WHERE user_id = $1 AND created_at > now() - interval '1 hour'", [u.id])).rows[0].n;
      if (recent >= 3) return;
      const t = sec.newToken();
      await db.q("INSERT INTO password_resets (user_id, token_hash, expires_at, ip) VALUES ($1,$2, now() + ($3 || ' minutes')::interval, $4)", [u.id, t.hash, String(cfg.resetTokenMinutes), req.ip || null]);
      await audit(req, 'password_reset_requested', { actor: u, entity: 'user', entityId: u.id });
      await mailer.send(cfg, { to: u.email, ...emails.resetPassword(cfg, u.name, `${cfg.baseUrl}/redefinir-senha/${t.raw}`) });
    };
    background(work());
    res.send(authViews.forgot({ cfg, csrf: req.csrf, flash: { type: 'success', text: 'Se este e-mail estiver cadastrado, enviamos um link para criar uma nova senha. Confira também a caixa de spam.' } }));
  });

  const findReset = async (token) => {
    if (!/^[A-Za-z0-9_-]{30,64}$/.test(String(token))) return null;
    const x = await db.q('SELECT * FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()', [sec.sha256(token)]);
    return x.rows[0] || null;
  };
  r.get('/redefinir-senha/:token', async (req, res) => {
    const found = await findReset(req.params.token);
    res.status(found ? 200 : 410).send(authViews.reset({ cfg, csrf: req.csrf, token: req.params.token, invalid: !found }));
  });
  r.post('/redefinir-senha/:token', loginLimit, async (req, res) => {
    const found = await findReset(req.params.token);
    if (!found) return res.status(410).send(authViews.reset({ cfg, csrf: req.csrf, token: req.params.token, invalid: true }));
    const errors = {};
    const { password = '', confirm = '' } = req.body;
    const pe = V.checkPassword(password);
    if (pe) errors.password = pe; else if (password !== confirm) errors.confirm = 'As senhas não são iguais.';
    if (Object.keys(errors).length) return res.status(422).send(authViews.reset({ cfg, csrf: req.csrf, token: req.params.token, errors }));
    const hash = await bcrypt.hash(String(password), cfg.bcryptCost);
    const user = await db.tx(async (c) => {
      const used = await c.query('UPDATE password_resets SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING user_id', [found.id]);
      if (!used.rowCount) return null;
      const u = await c.query('UPDATE users SET password_hash = $2, must_change_password = FALSE, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1 RETURNING *', [found.user_id, hash]);
      await c.query('DELETE FROM sessions WHERE user_id = $1', [found.user_id]);
      await c.query("UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [found.user_id]);
      return u.rows[0];
    });
    if (!user) return res.status(410).send(authViews.reset({ cfg, csrf: req.csrf, token: req.params.token, invalid: true }));
    await audit(req, 'password_reset_done', { actor: user, entity: 'user', entityId: user.id });
    background(mailer.send(cfg, { to: user.email, ...emails.passwordChanged(cfg, user.name) }));
    setFlash(res, 'success', 'Senha alterada. Entre com a nova senha.');
    res.redirect(303, '/entrar');
  });

  // ---- aceites LGPD (porta de entrada quando há texto novo publicado) ----
  r.get('/aceite', needUser, gate, async (req, res) => {
    const docs = await acceptance.pendingFor(req.user.id);
    if (!docs.length) return res.redirect(303, home(req.user));
    res.send(appViews.aceite({ ...appCtx(req, res), docs }));
  });
  r.post('/aceite', needUser, gate, async (req, res) => {
    const docs = await acceptance.pendingFor(req.user.id);
    const ok = docs.every((d) => req.body[`doc_${d.id}`] === '1');
    if (!ok) { setFlash(res, 'error', 'Marque o aceite de cada documento para continuar.'); return res.redirect(303, '/aceite'); }
    await acceptance.record(req, req.user, docs, 'login');
    res.redirect(303, home(req.user));
  });

  // ---- telas iniciais (conteúdo real chega nas próximas fases) ----
  r.get('/admin', needUser, gate, needAdmin, async (req, res) => {
    const m = await db.q('SELECT count(*)::int AS n FROM schema_migrations');
    const l = await db.q("SELECT count(*)::int AS n FROM legal_documents WHERE status = 'published'");
    res.send(appViews.adminHome({ ...appCtx(req, res), status: {
      db: true, migrations: m.rows[0].n, legalPublished: l.rows[0].n,
      mail: cfg.mailTransport === 'memory' || !!(cfg.resendApiKey && cfg.resendFrom), mailFrom: cfg.resendFrom ? cfg.resendFrom.replace(/^.*</, '').replace(/>$/, '') : '',
    } }));
  });

  // ---- perfil ----
  const loadProfile = async (req, res, extra = {}) => {
    const [acc, open] = await Promise.all([
      acceptance.listFor(req.user.id),
      db.q("SELECT type FROM data_requests WHERE user_id = $1 AND status = 'open'", [req.user.id]),
    ]);
    const pendingChange = (await db.q("SELECT 1 FROM email_changes WHERE user_id = $1 AND status = 'pending' AND expires_at > now()", [req.user.id])).rowCount > 0;
    return appViews.perfil({ ...appCtx(req, res), acceptances: acc, openRequests: { deleteOpen: open.rows.some((x) => x.type === 'delete'), pendingChange }, ...extra });
  };
  r.get('/perfil', needUser, gate, async (req, res) => res.send(await loadProfile(req, res)));

  r.post('/perfil', needUser, gate, async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const { errors, values } = V.profileFields(req.body, { allowCpf: isAdmin });
    if (isAdmin && values.cpf && !errors.cpf) {
      const dup = await db.q('SELECT 1 FROM users WHERE cpf = $1 AND id <> $2', [values.cpf, req.user.id]);
      if (dup.rowCount) errors.cpf = 'Este CPF já está cadastrado.';
    }
    if (Object.keys(errors).length) return res.status(422).send(await loadProfile(req, res, { errors, values: { ...req.user, ...values } }));
    if (!isAdmin) values.cpf = req.user.cpf; // aluno nunca altera o CPF por aqui
    const changed = Object.keys(values).filter((k) => String(values[k] ?? '') !== String(req.user[k] ?? ''));
    await db.q(`UPDATE users SET name=$2, phone=$3, cep=$4, state=$5, street=$6, street_number=$7, complement=$8, district=$9, city=$10, cpf=$11, updated_at=now() WHERE id=$1`,
      [req.user.id, values.name, values.phone, values.cep, values.state, values.street, values.street_number, values.complement, values.district, values.city, values.cpf ?? null]);
    await audit(req, 'profile_updated', { entity: 'user', entityId: req.user.id, meta: { fields: changed } });
    setFlash(res, 'success', 'Dados atualizados.');
    res.redirect(303, '/perfil');
  });

  r.post('/perfil/senha', loginLimit, needUser, gate, async (req, res) => {
    const errors = {};
    const { current = '', password = '', confirm = '' } = req.body;
    if (!(await bcrypt.compare(String(current), req.user.password_hash))) errors.current = 'A senha atual não confere.';
    const pe = V.checkPassword(password);
    if (pe) errors.password = pe; else if (password !== confirm) errors.confirm = 'As senhas não são iguais.';
    if (Object.keys(errors).length) return res.status(422).send(await loadProfile(req, res, { errors }));
    const hash = await bcrypt.hash(String(password), cfg.bcryptCost);
    await db.q('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [req.user.id, hash]);
    await sec.destroyOtherSessions(req.user.id, req.sessionId);
    await audit(req, 'password_changed', { entity: 'user', entityId: req.user.id });
    background(mailer.send(cfg, { to: req.user.email, ...emails.passwordChanged(cfg, req.user.name) }));
    setFlash(res, 'success', 'Senha alterada. Os outros aparelhos foram desconectados.');
    res.redirect(303, '/perfil');
  });

  r.post('/perfil/preferencias', needUser, gate, async (req, res) => {
    await db.q('UPDATE users SET mascot_enabled = $2, updated_at = now() WHERE id = $1', [req.user.id, req.body.mascot === '1']);
    setFlash(res, 'success', 'Preferência salva.');
    res.redirect(303, '/perfil');
  });

  // ---- troca de e-mail em duas etapas ----
  const pendingChange = async (userId) => (await db.q("SELECT * FROM email_changes WHERE user_id = $1 AND status = 'pending' AND expires_at > now() ORDER BY id DESC LIMIT 1", [userId])).rows[0] || null;
  r.get('/perfil/email', needUser, gate, async (req, res) => {
    res.send(appViews.perfilEmail({ ...appCtx(req, res), pending: await pendingChange(req.user.id), adminMode: req.query.admin === '1' && req.user.role === 'student' }));
  });
  r.post('/perfil/email/solicitar', needUser, gate, mailLimit, async (req, res) => {
    const newEmail = V.normalizeEmail(req.body.new_email);
    const back = (msg) => res.status(422).send(appViews.perfilEmail({ ...appCtx(req, res), errors: { new_email: msg }, newEmail: String(req.body.new_email || '').slice(0, 254) }));
    if (!newEmail) return back('Informe um e-mail válido.');
    if (newEmail === req.user.email.toLowerCase()) return back('Este já é o seu e-mail de acesso.');
    const taken = await db.q('SELECT 1 FROM users WHERE lower(email) = $1', [newEmail]);
    if (taken.rowCount) return back('Não foi possível usar este e-mail. Tente outro.');
    const recent = (await db.q("SELECT count(*)::int AS n FROM email_changes WHERE user_id = $1 AND created_at > now() - interval '1 hour'", [req.user.id])).rows[0].n;
    if (recent >= 5) return back('Muitos pedidos seguidos. Aguarde um pouco e tente de novo.');
    let c1 = sec.newCode(); let c2 = sec.newCode();
    while (c2 === c1) c2 = sec.newCode();
    await db.q("UPDATE email_changes SET status = 'cancelled' WHERE user_id = $1 AND status = 'pending'", [req.user.id]);
    await db.q("INSERT INTO email_changes (user_id, new_email, code_current_hash, code_new_hash, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' minutes')::interval)",
      [req.user.id, newEmail, sec.hashCode(req.user.id, c1), sec.hashCode(req.user.id, c2), String(cfg.emailCodeMinutes)]);
    await audit(req, 'email_change_requested', { entity: 'user', entityId: req.user.id, meta: { new_email: newEmail } });
    background(Promise.all([
      mailer.send(cfg, { to: req.user.email, ...emails.emailChangeCode(cfg, req.user.name, c1, 'current', newEmail) }),
      mailer.send(cfg, { to: newEmail, ...emails.emailChangeCode(cfg, req.user.name, c2, 'new', newEmail) }),
    ]));
    setFlash(res, 'info', 'Enviamos os dois códigos. Digite-os abaixo.');
    res.redirect(303, '/perfil/email');
  });
  r.post('/perfil/email/confirmar', loginLimit, needUser, gate, async (req, res) => {
    const p = await pendingChange(req.user.id);
    if (!p) { setFlash(res, 'error', 'Não há troca de e-mail em andamento, ou o prazo acabou. Peça novos códigos.'); return res.redirect(303, '/perfil/email'); }
    // Contagem atômica: pedidos paralelos não passam do limite de tentativas.
    const upd = await db.q("UPDATE email_changes SET attempts = attempts + 1 WHERE id = $1 AND status = 'pending' AND attempts < $2 RETURNING attempts", [p.id, cfg.emailCodeMaxAttempts]);
    if (!upd.rowCount) { setFlash(res, 'error', 'Muitas tentativas erradas. Peça novos códigos.'); return res.redirect(303, '/perfil/email'); }
    const attempts = upd.rows[0].attempts;
    const a = String(req.body.code_current || '').replace(/\D/g, '');
    const b = String(req.body.code_new || '').replace(/\D/g, '');
    const okA = sec.safeEqual(sec.hashCode(req.user.id, a), p.code_current_hash);
    const okB = sec.safeEqual(sec.hashCode(req.user.id, b), p.code_new_hash);
    if (!(okA && okB)) {
      await audit(req, 'email_change_code_wrong', { entity: 'user', entityId: req.user.id, meta: { attempts } });
      if (attempts >= cfg.emailCodeMaxAttempts) {
        await db.q("UPDATE email_changes SET status = 'cancelled' WHERE id = $1", [p.id]);
        setFlash(res, 'error', 'Muitas tentativas erradas. Peça novos códigos.');
        return res.redirect(303, '/perfil/email');
      }
      return res.status(422).send(appViews.perfilEmail({ ...appCtx(req, res), pending: p, errors: { code_current: 'Confira os dois códigos e tente de novo.' } }));
    }
    const oldEmail = req.user.email;
    const done = await db.tx(async (c) => {
      const t = await c.query('SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2', [p.new_email, req.user.id]);
      if (t.rowCount) return false;
      await c.query('UPDATE users SET email = $2, updated_at = now() WHERE id = $1', [req.user.id, p.new_email]);
      await c.query("UPDATE email_changes SET status = 'done' WHERE id = $1", [p.id]);
      await c.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [req.user.id]);
      return true;
    });
    if (!done) { setFlash(res, 'error', 'Este e-mail não está mais disponível. Escolha outro.'); return res.redirect(303, '/perfil/email'); }
    await sec.destroyOtherSessions(req.user.id, req.sessionId);
    await audit(req, 'email_change_confirmed', { entity: 'user', entityId: req.user.id, meta: { from: oldEmail, to: p.new_email } });
    background(Promise.all([
      mailer.send(cfg, { to: oldEmail, ...emails.emailChanged(cfg, req.user.name, p.new_email) }),
      mailer.send(cfg, { to: p.new_email, ...emails.emailChanged(cfg, req.user.name, p.new_email) }),
    ]));
    setFlash(res, 'success', 'E-mail de acesso alterado.');
    res.redirect(303, '/perfil');
  });
  r.post('/perfil/email/cancelar', needUser, gate, async (req, res) => {
    await db.q("UPDATE email_changes SET status = 'cancelled' WHERE user_id = $1 AND status = 'pending'", [req.user.id]);
    setFlash(res, 'info', 'Troca de e-mail cancelada.');
    res.redirect(303, '/perfil');
  });
  r.post('/perfil/email/admin', needUser, gate, mailLimit, async (req, res) => {
    const newEmail = V.normalizeEmail(req.body.new_email);
    if (req.user.role !== 'student') return res.redirect(303, '/perfil');
    if (!newEmail) return res.status(422).send(appViews.perfilEmail({ ...appCtx(req, res), adminMode: true, errors: { new_email: 'Informe um e-mail válido.' }, newEmail: String(req.body.new_email || '').slice(0, 254) }));
    await db.q("INSERT INTO data_requests (user_id, type, note) VALUES ($1,'email_change_admin',$2)", [req.user.id, newEmail]);
    await audit(req, 'email_change_admin_requested', { entity: 'user', entityId: req.user.id, meta: { new_email: newEmail } });
    const admins = await db.q("SELECT email FROM users WHERE role = 'admin' AND status = 'active'");
    background(Promise.all(admins.rows.map((a) => mailer.send(cfg, { to: a.email, ...emails.adminEmailRequest(cfg, req.user, newEmail) }))));
    setFlash(res, 'success', 'Pedido enviado ao administrador. Ele entra em contato para confirmar.');
    res.redirect(303, '/perfil');
  });

  // ---- LGPD: exportar dados e pedir exclusão ----
  r.get('/perfil/meus-dados.json', needUser, gate, async (req, res) => {
    const u = req.user;
    const [acc, reqs, au] = await Promise.all([
      acceptance.listFor(u.id),
      db.q('SELECT type, status, created_at, resolved_at FROM data_requests WHERE user_id = $1 ORDER BY id', [u.id]),
      db.q('SELECT at, action, ip FROM audit_log WHERE actor_user_id = $1 ORDER BY id', [u.id]),
    ]);
    const { password_hash, failed_logins, locked_until, id_hash, last_seen_at, ...safe } = u; // nunca exportar o hash da senha
    await audit(req, 'data_export', { entity: 'user', entityId: u.id });
    res.set('Content-Disposition', 'attachment; filename="meus-dados-evolumen.json"');
    res.json({ gerado_em: new Date().toISOString(), usuario: safe, aceites: acc, pedidos: reqs.rows, registro_de_atividade: au.rows });
  });
  r.post('/perfil/exclusao', needUser, gate, async (req, res) => {
    const open = await db.q("SELECT 1 FROM data_requests WHERE user_id = $1 AND type = 'delete' AND status = 'open'", [req.user.id]);
    if (!open.rowCount) {
      await db.q("INSERT INTO data_requests (user_id, type) VALUES ($1,'delete')", [req.user.id]);
      await audit(req, 'data_deletion_requested', { entity: 'user', entityId: req.user.id });
    }
    setFlash(res, 'info', 'Pedido de exclusão registrado. O administrador analisa e responde por e-mail.');
    res.redirect(303, '/perfil');
  });

  r.helpers = { setFlash, popFlash, background, home, view, appCtx, needUser, gate, needAdmin, loginLimit };
  return r;
}

module.exports = { build };
