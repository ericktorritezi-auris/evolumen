'use strict';
// Liberação de acesso a um curso (manual ou cortesia). Só quem passa por aqui ganha matrícula pelo painel.
// Login e senha não dão acesso a nenhum curso: o acesso nasce de uma matrícula.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const C = require('./courses');
const V = require('./validation');
const mailer = require('./mailer');
const emails = require('./emails');
const { audit } = require('./audit');

function tempPassword() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  for (;;) {
    let p = ''; for (let i = 0; i < 12; i++) p += A[crypto.randomInt(A.length)];
    if (!V.checkPassword(p)) return p;
  }
}

const todaySP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

// Confere os dados do formulário. Devolve { errors, email, name, until, user }.
async function check(body) {
  const errors = {};
  const email = V.normalizeEmail(body.email);
  if (!email) errors.email = 'Informe um e-mail válido.';
  const until = String(body.until || '').trim();
  if (until && !C.dateOnly(until)) errors.until = 'Data inválida.';
  else if (until && until < todaySP()) errors.until = 'A data precisa ser hoje ou depois.';
  const user = email ? (await db.q('SELECT * FROM users WHERE lower(email) = $1', [email])).rows[0] : null;
  if (user && user.role !== 'student') errors.email = 'Este e-mail é de um administrador, que já vê todos os cursos.';
  if (user && user.status !== 'active') errors.email = 'A conta deste aluno está inativa. Reative a conta em Alunos antes de liberar o curso.';
  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (email && !user && name.length < 3) errors.name = 'Informe o nome para criar a conta do aluno.';
  return { errors, email, name, until, user };
}

const CONFLICT = new Error('e-mail já cadastrado');

// Cria a conta (se preciso), grava a matrícula e envia o e-mail. `origin` = 'manual' ou 'gift'.
// Conta e matrícula nascem juntas. Quem já tem acesso vigente nunca perde tempo de acesso e não recebe e-mail repetido.
async function grant(cfg, h, req, { course, checked, origin }) {
  const { email, name, until } = checked;
  const months = course.access_type === 'months' ? course.access_months : null;
  const expiry = until ? `${until}T23:59:59-03:00` : null;
  let out;
  try {
    out = await db.tx(async (c) => {
      let { user } = checked; let password = null;
      if (!user) {
        password = tempPassword();
        const hash = await bcrypt.hash(password, cfg.bcryptCost);
        try { user = (await c.query("INSERT INTO users (email, password_hash, role, name, must_change_password) VALUES ($1,$2,'student',$3,TRUE) RETURNING *", [email, hash, name])).rows[0]; } catch (e) { if (e.code === '23505') throw CONFLICT; throw e; }
      }
      const newExp = (await c.query("SELECT COALESCE($1::timestamptz, CASE WHEN $2::int IS NULL THEN NULL ELSE now() + ($2::int || ' months')::interval END) AS e", [expiry, months])).rows[0].e;
      const ex = (await c.query('SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 FOR UPDATE', [user.id, course.id])).rows[0];
      const live = !!ex && ex.status === 'active' && (!ex.expires_at || new Date(ex.expires_at) > new Date());
      if (!ex) {
        await c.query('INSERT INTO enrollments (user_id, course_id, origin, expires_at, granted_by) VALUES ($1,$2,$3,$4,$5)', [user.id, course.id, origin, newExp, req.user.id]);
      } else if (live) {
        const exp = ex.expires_at == null || newExp == null ? null : (new Date(newExp) > new Date(ex.expires_at) ? newExp : ex.expires_at);
        await c.query('UPDATE enrollments SET expires_at = $2, granted_by = $3 WHERE id = $1', [ex.id, exp, req.user.id]);
      } else {
        await c.query("UPDATE enrollments SET status = 'active', cancelled_at = NULL, starts_at = LEAST(starts_at, now()), expires_at = $2, granted_by = $3, origin = $4 WHERE id = $1",
          [ex.id, newExp, req.user.id, ex.status === 'cancelled' ? origin : ex.origin]);
      }
      return { user, password, already: live };
    });
  } catch (e) { if (e === CONFLICT) return { conflict: true }; throw e; }
  const { user, password, already } = out;
  if (password) await audit(req, 'student_created', { entity: 'user', entityId: user.id });
  await audit(req, origin === 'gift' ? 'gift_granted' : 'enrollment_granted', { entity: 'course', entityId: course.id, meta: { user: user.id, ...(already ? { ja_tinha_acesso: true } : {}) } });
  const gift = origin === 'gift';
  if (!already) h.background(mailer.send(cfg, { to: user.email, ...(password ? emails.accessGranted(cfg, user.name, user.email, password, course.title, { gift }) : emails.courseGranted(cfg, user.name, course.title, course.slug, { gift })) }));
  return { user, password, newUser: !!password, already };
}

module.exports = { tempPassword, check, grant };
