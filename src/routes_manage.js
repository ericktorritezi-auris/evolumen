'use strict';
// Painel do administrador (parte 2): alunos, cortesias, log de atividades e cupons.
// Regra geral: só se exclui o que não tem vínculo. Com vínculo, inativa ou cancela e o histórico fica guardado.
const express = require('express');
const db = require('./db');
const C = require('./courses');
const K = require('./coupons');
const AFF = require('./affiliates');
const access = require('./access');
const mailer = require('./mailer');
const emails = require('./emails');
const V = require('./validation');
const { audit } = require('./audit');
const views = require('./views/manage');

const ID = /^\d{1,12}$/;
const PAGE = 30;

function build(cfg, h) {
  const r = express.Router();
  r.use(['/admin/alunos', '/admin/cortesias', '/admin/log', '/admin/cupons'], h.needUser, h.gate, h.needAdmin);
  const ctx = (req, res, extra = {}) => ({ ...h.appCtx(req, res), ...extra });
  const flashBack = (req, res, type, text, to) => { h.setFlash(res, type, text); res.redirect(303, to); };

  // ---------- alunos ----------
  const STATUS = { ativos: "u.status = 'active'", inativos: "u.status <> 'active'" };
  r.get('/admin/alunos', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    const st = STATUS[req.query.situacao] ? req.query.situacao : '';
    const params = []; const where = ["u.role = 'student'"];
    if (q) { params.push(`%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`); where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
    if (st) where.push(STATUS[st]);
    const rows = (await db.q(`
      SELECT u.id, u.name, u.email, u.status, u.last_login_at, u.created_at,
        (SELECT count(*)::int FROM enrollments e WHERE e.user_id = u.id) AS enrollments,
        (SELECT count(*)::int FROM lesson_progress p WHERE p.user_id = u.id) AS progress,
        (SELECT count(*)::int FROM acceptances a WHERE a.user_id = u.id) AS acceptances,
        (SELECT count(*)::int FROM data_requests d WHERE d.user_id = u.id) AS requests,
        (SELECT count(*)::int FROM coupon_redemptions c WHERE c.user_id = u.id) AS redemptions
      FROM users u WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC, u.id DESC LIMIT 200`, params)).rows;
    res.send(views.alunos(ctx(req, res), { rows, q, st }));
  });

  const student = async (req, next) => {
    if (!ID.test(req.params.id)) { next(); return null; }
    const u = (await db.q("SELECT * FROM users WHERE id = $1 AND role = 'student'", [req.params.id])).rows[0];
    if (!u) { next(); return null; } return u;
  };
  r.post('/admin/alunos/:id/inativar', async (req, res, next) => {
    const u = await student(req, next); if (!u) return;
    await db.tx(async (c) => {
      await c.query("UPDATE users SET status = 'blocked', updated_at = now() WHERE id = $1", [u.id]);
      await c.query('DELETE FROM sessions WHERE user_id = $1', [u.id]);
    });
    await audit(req, 'student_inactivated', { entity: 'user', entityId: u.id });
    flashBack(req, res, 'info', 'Conta inativada. O aluno não consegue mais entrar, e tudo fica guardado.', '/admin/alunos');
  });
  r.post('/admin/alunos/:id/reativar', async (req, res, next) => {
    const u = await student(req, next); if (!u) return;
    await db.q("UPDATE users SET status = 'active', failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1", [u.id]);
    await audit(req, 'student_reactivated', { entity: 'user', entityId: u.id });
    flashBack(req, res, 'success', 'Conta reativada.', '/admin/alunos');
  });
  r.post('/admin/alunos/:id/excluir', async (req, res, next) => {
    const u = await student(req, next); if (!u) return;
    const done = await db.tx(async (c) => {
      await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [u.id]);
      const links = (await c.query(`SELECT (SELECT count(*) FROM enrollments WHERE user_id = $1) + (SELECT count(*) FROM lesson_progress WHERE user_id = $1)
      + (SELECT count(*) FROM acceptances WHERE user_id = $1) + (SELECT count(*) FROM data_requests WHERE user_id = $1) + (SELECT count(*) FROM coupon_redemptions WHERE user_id = $1)
      + (SELECT count(*) FROM assessment_attempts WHERE user_id = $1) + (SELECT count(*) FROM certificates WHERE user_id = $1) AS n`, [u.id])).rows[0].n;
      if (Number(links) > 0) return false;
      await c.query('DELETE FROM users WHERE id = $1', [u.id]);
      return true;
    }).catch((e) => { if (e.code === '23503') return false; throw e; });
    if (!done) return flashBack(req, res, 'error', 'Este aluno tem vínculos (matrículas, aulas feitas ou aceites dos termos) e não pode ser excluído. Use Inativar.', '/admin/alunos');
    await audit(req, 'student_deleted', { entity: 'user', entityId: u.id, meta: { email: u.email } });
    flashBack(req, res, 'info', 'Aluno excluído.', '/admin/alunos');
  });

  // ---------- cortesias ----------
  const giftRows = async () => (await db.q(`
    SELECT e.id, e.status, e.expires_at, e.created_at, (e.expires_at IS NOT NULL AND e.expires_at <= now()) AS expired, u.name, u.email, c.title AS course,
      (SELECT count(*)::int FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = e.user_id AND l.course_id = e.course_id) AS any_progress
    FROM enrollments e JOIN users u ON u.id = e.user_id JOIN courses c ON c.id = e.course_id
    WHERE e.origin = 'gift' ORDER BY e.created_at DESC LIMIT 200`)).rows;
  const allCourses = async () => (await db.q('SELECT id, title, status FROM courses ORDER BY sort_order, id')).rows;
  const giftPage = async (req, res, status, extra = {}) => res.status(status).send(views.cortesias(ctx(req, res), { courses: await allCourses(), rows: await giftRows(), ...extra }));

  r.get('/admin/cortesias', (req, res) => giftPage(req, res, 200));
  r.post('/admin/cortesias', async (req, res) => {
    const course = ID.test(String(req.body.course || '')) ? await C.byId(req.body.course) : null;
    const checked = await access.check(req.body);
    if (!course) checked.errors.course = 'Escolha o curso.';
    const keep = { values: { course: String(req.body.course || ''), email: String(req.body.email || '').slice(0, 254), name: String(req.body.name || '').slice(0, 120), until: String(req.body.until || '') } };
    if (Object.keys(checked.errors).length) return giftPage(req, res, 422, { errors: checked.errors, ...keep });
    const out = await access.grant(cfg, h, req, { course, checked, origin: 'gift' });
    if (out.conflict) return giftPage(req, res, 409, { errors: { email: 'Este e-mail acabou de ser cadastrado. Tente de novo.' }, ...keep });
    return giftPage(req, res, 200, { created: { email: out.user.email, course: course.title, password: out.password || null, newUser: out.newUser, already: out.already } });
  });

  // ---------- log de atividades ----------
  r.get('/admin/log', async (req, res) => {
    const f = {
      de: C.dateOnly(req.query.de) || '', ate: C.dateOnly(req.query.ate) || '',
      q: String(req.query.q || '').trim().slice(0, 80), acao: String(req.query.acao || '').slice(0, 60),
    };
    const params = []; const where = [];
    const add = (sql, v) => { params.push(v); where.push(sql.replace('?', '$' + params.length)); };
    if (f.de) add("at >= (?::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'", f.de);
    if (f.ate) add("at < ((?::date) + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'", f.ate);
    if (f.q) { params.push(`%${f.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`); where.push(`(actor_email ILIKE $${params.length} ESCAPE '\\' OR meta::text ILIKE $${params.length} ESCAPE '\\')`); }
    if (f.acao) add('action = ?', f.acao);
    const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (await db.q(`SELECT count(*)::int n FROM audit_log ${W}`, params)).rows[0].n;
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const page = Math.min(Math.max(parseInt(req.query.p, 10) || 1, 1), pages);
    const rows = (await db.q(`SELECT id, at, actor_email, action, entity, entity_id, meta, ip FROM audit_log ${W} ORDER BY at DESC, id DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, params)).rows;
    const actions = (await db.q('SELECT DISTINCT action FROM audit_log ORDER BY action')).rows.map((x) => x.action);
    res.send(views.log(ctx(req, res), { rows, total, page, pages, f, actions, size: PAGE }));
  });

  // ---------- cupons ----------
  r.get('/admin/cupons', async (req, res) => res.send(views.cuponsList(ctx(req, res), { rows: await K.list() })));

  const formCourses = async () => (await db.q('SELECT id, title, price_cents, status FROM courses ORDER BY sort_order, id')).rows;
  const formAffiliates = async (current = null) => { const l = await AFF.activeList(); if (current && !l.some((a) => String(a.id) === String(current))) { const a = await AFF.byId(current); if (a) l.push({ id: a.id, name: a.name + ' (inativo)', email: a.email }); } return l; };
  r.get('/admin/cupons/novo', async (req, res) => {
    const src = req.query.copiar ? await K.byId(req.query.copiar) : null;
    const values = src ? { kind: src.kind, percent: src.percent, amount: C.brlInput(src.amount_cents), starts_on: '', ends_on: '', max_uses: src.max_uses || '', note: src.note, courses: src.courses.map((x) => String(x.id)), affiliate_id: src.affiliate_id || '', commission_pct: src.commission_pct != null ? String(Number(src.commission_pct)).replace('.', ',') : '' } : { kind: 'percent', courses: [] };
    res.send(views.cupomForm(ctx(req, res), { courses: await formCourses(), affiliates: await formAffiliates(values.affiliate_id), values, from: src }));
  });

  r.post('/admin/cupons', async (req, res) => {
    const { errors, values } = await K.parse(req.body);
    const redo = async (status) => res.status(status).send(views.cupomForm(ctx(req, res), { courses: await formCourses(), affiliates: await formAffiliates(req.body.affiliate_id), values: { ...req.body, courses: [].concat(req.body.courses || []).map(String) }, errors }));
    if (Object.keys(errors).length) return redo(422);
    let id = null;
    for (let tries = 0; tries < 6 && !id; tries++) {
      const code = values.code || K.generateCode();
      try {
        id = await db.tx(async (c) => {
          const ins = await c.query(`INSERT INTO coupons (code, kind, percent, amount_cents, starts_on, ends_on, max_uses, note, created_by, affiliate_id, commission_pct)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [code, values.kind, values.percent, values.amount_cents, values.starts_on, values.ends_on, values.max_uses, values.note, req.user.id, values.affiliate_id, values.commission_pct]);
          for (const cid of values.courses) await c.query('INSERT INTO coupon_courses (coupon_id, course_id) VALUES ($1,$2)', [ins.rows[0].id, cid]);
          return ins.rows[0].id;
        });
        await audit(req, 'coupon_created', { entity: 'coupon', entityId: id, meta: { code, ...(values.affiliate_id ? { affiliate: values.affiliate_id, comissao: values.commission_pct } : {}) } });
      } catch (e) {
        if (e.code !== '23505') throw e;
        if (values.code) { errors.code = 'Já existe um cupom com este código. Escolha outro ou deixe vazio para gerar.'; return redo(422); }
      }
    }
    if (!id) throw new Error('Não foi possível gerar um código único para o cupom.');
    flashBack(req, res, 'success', 'Cupom criado. A imagem dele está abaixo: clique para ampliar, baixar ou enviar.', `/admin/cupons/${id}`);
  });

  const coupon = async (req, next) => { const c = await K.byId(req.params.id); if (!c) { next(); return null; } return c; };

  r.get('/admin/cupons/:id', async (req, res, next) => {
    const c = await coupon(req, next); if (!c) return;
    const sends = (await db.q('SELECT email, name, status, created_at FROM coupon_sends WHERE coupon_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100', [c.id])).rows;
    res.send(views.cupomDetail(ctx(req, res), { c, sends, courses: await formCourses(), affiliates: await formAffiliates(c.affiliate_id), link: K.linkFor(cfg, c) }));
  });

  r.get('/admin/cupons/:id/imagem.png', async (req, res, next) => {
    const c = await coupon(req, next); if (!c) return;
    const png = K.artPng(cfg, c);
    res.set({ 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    if (req.query.baixar) res.attachment(`cupom-${c.code}.png`); else res.set('Content-Disposition', 'inline');
    res.send(png);
  });

  r.post('/admin/cupons/:id', async (req, res, next) => {
    const c = await coupon(req, next); if (!c) return;
    const back = `/admin/cupons/${c.id}`;
    if (c.status === 'inactive') return flashBack(req, res, 'error', 'Cupom inativo não pode ser editado. Crie um novo cupom a partir dele.', back);
    const locked = c.uses > 0 || c.sends > 0 ? c : null;
    const soldAff = c.uses > 0 || c.commissions > 0;
    const { errors, values } = await K.parse({ ...req.body, code: c.code, affiliate_keep: c.affiliate_id || '' }, { locked, lockedAff: soldAff ? c : null });
    if (locked && !errors.courses) {
      const removed = c.courses.filter((x) => !values.courses.map(String).includes(String(x.id)));
      if (removed.length) errors.courses = 'Este cupom já foi enviado ou usado, então os cursos dele não podem ser retirados. Você pode acrescentar cursos ou inativar o cupom.';
    }
    if (!errors.max_uses && values.max_uses && values.max_uses < c.uses) errors.max_uses = `Já houve ${c.uses} ${c.uses === 1 ? 'uso' : 'usos'}. O limite não pode ser menor.`;
    if (!soldAff && !errors.affiliate_id && !errors.commission_pct && (String(c.affiliate_id || '') !== String(values.affiliate_id || '') || Number(c.commission_pct || 0) !== Number(values.commission_pct || 0))) {
      const pend = (await db.q("SELECT count(*)::int n FROM orders WHERE coupon_id = $1 AND status = 'pending'", [c.id])).rows[0].n;
      if (pend) errors.affiliate_id = 'Há compras em andamento com este cupom. Espere o pagamento sair para mudar o afiliado ou a comissão.';
    }
    if (Object.keys(errors).length) {
      const sends = (await db.q('SELECT email, name, status, created_at FROM coupon_sends WHERE coupon_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100', [c.id])).rows;
      return res.status(422).send(views.cupomDetail(ctx(req, res), { c, sends, courses: await formCourses(), affiliates: await formAffiliates(c.affiliate_id), link: K.linkFor(cfg, c), errors, values: { ...req.body, courses: [].concat(req.body.courses || []).map(String) } }));
    }
    await db.tx(async (t) => {
      await t.query('UPDATE coupons SET kind = $2, percent = $3, amount_cents = $4, starts_on = $5, ends_on = $6, max_uses = $7, note = $8, affiliate_id = $9, commission_pct = $10, updated_at = now() WHERE id = $1',
        [c.id, values.kind, values.percent, values.amount_cents, values.starts_on, values.ends_on, values.max_uses, values.note, values.affiliate_id, values.commission_pct]);
      await t.query('DELETE FROM coupon_courses WHERE coupon_id = $1 AND NOT (course_id = ANY($2::bigint[]))', [c.id, values.courses]);
      for (const cid of values.courses) await t.query('INSERT INTO coupon_courses (coupon_id, course_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [c.id, cid]);
    });
    const affChanged = String(c.affiliate_id || '') !== String(values.affiliate_id || '') || Number(c.commission_pct || 0) !== Number(values.commission_pct || 0);
    await audit(req, 'coupon_updated', { entity: 'coupon', entityId: c.id, meta: { code: c.code, ...(affChanged ? { afiliado: values.affiliate_id || 'nenhum', comissao: values.commission_pct } : {}) } });
    flashBack(req, res, 'success', 'Cupom salvo.', back);
  });

  // Inativar é definitivo: o cupom fica no histórico e, para reutilizar, cria-se outro.
  r.post('/admin/cupons/:id/inativar', async (req, res, next) => {
    const c = await coupon(req, next); if (!c) return;
    await db.q("UPDATE coupons SET status = 'inactive', inactivated_at = now(), updated_at = now() WHERE id = $1 AND status = 'active'", [c.id]);
    await audit(req, 'coupon_inactivated', { entity: 'coupon', entityId: c.id, meta: { code: c.code } });
    flashBack(req, res, 'info', 'Cupom inativado. Ele fica guardado no histórico.', `/admin/cupons/${c.id}`);
  });

  r.post('/admin/cupons/:id/enviar', async (req, res, next) => {
    const c = await coupon(req, next); if (!c) return;
    const back = `/admin/cupons/${c.id}`;
    const st = K.stateOf(c, c.uses);
    if (st !== 'active' && st !== 'scheduled') return flashBack(req, res, 'error', 'Este cupom não está disponível para envio.', back);
    const email = V.normalizeEmail(req.body.email);
    if (!email) return flashBack(req, res, 'error', 'Informe um e-mail válido para enviar o cupom.', back);
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const tpl = emails.couponInvite(cfg, name, { code: c.code, discount: K.discountLabel(c), courses: c.courses.map((x) => x.title), link: K.linkFor(cfg, c), validity: K.validityLabel(c) });
    const out = await mailer.send(cfg, { to: email, ...tpl, attachments: [{ filename: `cupom-${c.code}.png`, content: K.artPng(cfg, c) }] });
    const status = out.ok ? 'sent' : (out.skipped ? 'skipped' : 'failed');
    await db.q('INSERT INTO coupon_sends (coupon_id, email, name, sent_by, status) VALUES ($1,$2,$3,$4,$5)', [c.id, email, name, req.user.id, status]);
    await audit(req, 'coupon_sent', { entity: 'coupon', entityId: c.id, meta: { to: email, status } });
    if (status === 'sent') return flashBack(req, res, 'success', `Cupom enviado para ${email}.`, back);
    return flashBack(req, res, 'error', status === 'skipped' ? 'O envio de e-mail não está configurado neste ambiente. O cupom ficou registrado, mas nada foi enviado.' : 'Não foi possível enviar o e-mail agora. Tente de novo em instantes.', back);
  });

  return r;
}
module.exports = { build };
