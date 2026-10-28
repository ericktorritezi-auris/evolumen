'use strict';
// Varredura diária da campainha: aniversários, prazo de acesso acabando e lembretes de estudo.
// Cada aviso tem uma chave: rodar de novo no mesmo dia não repete nada.
const db = require('./db');
const C = require('./courses');
const notify = require('./notify');
const mailer = require('./mailer');
const emails = require('./emails');
const log = require('./logger');

const TZ = 'America/Sao_Paulo';
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const DAY = 86400000;
const fmtDay = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

// Dias inteiros até o próximo aniversário (0 = hoje), no calendário de Brasília.
function daysToBirthday(birth, now = new Date()) {
  const today = ymd(now); const y = Number(today.slice(0, 4));
  const [, m, d] = String(birth).split('-').map(Number);
  const at = (yy) => Date.UTC(yy, m - 1, d, 12);
  let t = at(y); const base = Date.UTC(y, Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)), 12);
  if (t < base) t = at(y + 1);
  return Math.round((t - base) / DAY);
}

async function birthdays(now) {
  const rows = (await db.q("SELECT id, name, birth_date FROM users WHERE role = 'student' AND status = 'active' AND birth_date IS NOT NULL")).rows;
  const year = Number(ymd(now).slice(0, 4)); let n = 0;
  for (const u of rows) {
    const left = daysToBirthday(u.birth_date, now);
    if (left > 7) continue;
    const when = left === 0 ? 'é hoje' : left === 1 ? 'é amanhã' : `em ${left} dias`;
    await notify.toAdmins({ kind: 'birthday', title: `Aniversário de ${u.name}`, body: `Dia ${String(u.birth_date).slice(8, 10)}/${String(u.birth_date).slice(5, 7)} (${when} na data do envio).`, link: '/admin/alunos', key: `bday:${u.id}:${new Date(Date.parse(ymd(now) + 'T12:00:00Z') + left * DAY).getUTCFullYear()}`, subject: u.id });
    if (left === 0) await notify.add(u.id, { kind: 'birthday', title: `Feliz aniversário, ${u.name.split(' ')[0]}!`, body: 'A equipe EvoLumen deseja um dia de muita luz e aprendizado.', link: '/meus-cursos', key: `hbd:${u.id}:${year}` });
    n++;
  }
  return n;
}

// Avisa nos dias definidos no curso (padrão 30, 7 e 1). Escolhe o prazo mais próximo já alcançado.
async function expiring(cfg, bg, now) {
  const rows = (await db.q(`SELECT e.id, e.user_id, e.course_id, e.expires_at, c.title, c.slug, c.expiry_notice_days, u.name, u.email
    FROM enrollments e JOIN courses c ON c.id = e.course_id JOIN users u ON u.id = e.user_id
    WHERE e.status = 'active' AND e.expires_at IS NOT NULL AND e.expires_at > $1 AND e.expires_at < $1::timestamptz + interval '366 days' AND u.status = 'active' AND u.role = 'student'`, [now.toISOString()])).rows;
  let n = 0;
  for (const e of rows) {
    const left = Math.round((Date.parse(ymd(new Date(e.expires_at)) + 'T12:00:00Z') - Date.parse(ymd(now) + 'T12:00:00Z')) / DAY);
    const marks = String(e.expiry_notice_days || '30,7,1').split(',').map((x) => parseInt(x, 10)).filter((x) => x > 0).sort((a, b) => a - b);
    const mark = marks.find((m) => left <= m);
    if (!mark) continue;
    const key = `exp:${e.id}:${mark}:${Math.floor(new Date(e.expires_at).getTime() / DAY)}`;
    const id = await notify.add(e.user_id, { kind: 'expiry', title: left <= 0 ? 'Seu acesso vence hoje' : left === 1 ? 'Seu acesso vence amanhã' : `Seu acesso vence em ${left} dias`, body: e.title, link: `/curso/${e.slug}`, key });
    if (id) { bg(mailer.send(cfg, { to: e.email, ...emails.accessExpiring(cfg, { name: e.name, course: e, days: left, whenLabel: fmtDay(new Date(e.expires_at)) }) })); n++; }
  }
  return n;
}

// Lembretes: nunca começou o curso (3 dias) e terminou as aulas mas falta o certificado.
async function nudges(now) {
  let n = 0;
  const idle = (await db.q(`SELECT e.id, e.user_id, c.title, c.slug FROM enrollments e JOIN courses c ON c.id = e.course_id JOIN users u ON u.id = e.user_id
    WHERE e.status = 'active' AND u.status = 'active' AND u.role = 'student' AND e.starts_at <= $1::timestamptz - interval '3 days' AND (e.expires_at IS NULL OR e.expires_at > $1)
      AND NOT EXISTS (SELECT 1 FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = e.user_id AND l.course_id = e.course_id)`, [now.toISOString()])).rows;
  for (const e of idle) if (await notify.add(e.user_id, { kind: 'nudge', title: 'Que tal começar o seu curso?', body: e.title + ' — a primeira aula leva poucos minutos.', link: `/curso/${e.slug}`, key: 'nudge0:' + e.id })) n++;
  const done = (await db.q(`SELECT e.id, e.user_id, c.id AS course_id, c.title, c.slug FROM enrollments e JOIN courses c ON c.id = e.course_id JOIN users u ON u.id = e.user_id
    WHERE e.status = 'active' AND u.status = 'active' AND u.role = 'student' AND (e.expires_at IS NULL OR e.expires_at > $1)
      AND NOT EXISTS (SELECT 1 FROM certificates ce WHERE ce.user_id = e.user_id AND ce.course_id = e.course_id)
      AND (SELECT count(*) FROM lessons l WHERE l.course_id = c.id AND ${C.LIVE}) > 0
      AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id AND ${C.LIVE} AND NOT EXISTS (SELECT 1 FROM lesson_progress p WHERE p.lesson_id = l.id AND p.user_id = e.user_id))`, [now.toISOString()])).rows;
  for (const e of done) if (await notify.add(e.user_id, { kind: 'nudge', title: 'Falta pouco para o seu certificado', body: e.title + ' — confira a prova final ou emita o certificado.', link: `/curso/${e.slug}`, key: 'nudgecert:' + e.id })) n++;
  return n;
}

async function run(cfg, bg, now = new Date()) {
  const out = {};
  for (const [k, fn] of [['aniversarios', () => birthdays(now)], ['vencendo', () => expiring(cfg, bg, now)], ['lembretes', () => nudges(now)], ['limpeza', () => notify.cleanup()]]) {
    try { out[k] = await fn(); } catch (e) { log.warn('varredura_diaria_falhou', { etapa: k, error: e.message }); }
  }
  return out;
}

module.exports = { run, daysToBirthday };
