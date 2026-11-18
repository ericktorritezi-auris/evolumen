'use strict';
// Lembretes enviados pelo administrador (2.4.0): alunos que não começaram o curso e afiliados parados.
// Nada é automático. Regras: no máximo 1 lembrete a cada 10 dias por pessoa, quem se descadastrou fica de fora,
// e o servidor sempre recalcula quem pode receber na hora do envio (nunca confia na lista do navegador).
const crypto = require('crypto');
const db = require('./db');
const C = require('./courses');
const T = require('./tracking');
const K = require('./coupons');
const notify = require('./notify');
const mailer = require('./mailer');
const emails = require('./emails');

const MIN_DAYS = 10;
const MAX_BATCH = 500;
const NEW_GRACE_DAYS = 3; // matrícula recente ainda não é "nunca entrou"
const AFF_GRACE_DAYS = 7; // afiliado recém-criado ainda não é "nunca vendeu"
const err = (m, s = 400) => { const e = new Error(m); e.status = s; e.expose = true; return e; };

const STUDENT_GROUPS = [['novos', 'Nunca entrou (0 aulas)'], ['7', 'Parado há mais de 7 dias'], ['14', 'Parado há mais de 14 dias'], ['30', 'Parado há mais de 30 dias']];
const AFFILIATE_GROUPS = [['nunca', 'Nunca vendeu'], ['30', 'Sem vender há mais de 30 dias'], ['60', 'Sem vender há mais de 60 dias'], ['90', 'Sem vender há mais de 90 dias']];
const groupsOf = (kind) => (kind === 'afiliado' ? AFFILIATE_GROUPS : STUDENT_GROUPS);
const parseGroup = (kind, v) => (groupsOf(kind).some(([k]) => k === String(v)) ? String(v) : groupsOf(kind)[0][0]);

const DEFAULTS = {
  aluno: { subject: 'Oi, {nome}! Notei que você ainda não começou a {curso}', message: 'Oi, {nome}! Notei que você ainda não começou a {curso}. Aconteceu alguma coisa? Ficou com dificuldade no acesso ou no conteúdo?\n\nResponda este e-mail e eu te ajudo. Seu acesso está liberado e o seu lugar continua aqui.' },
  afiliado: { subject: '{nome}, como posso te ajudar a vender mais?', message: 'Oi, {nome}! Faz um tempo que não vemos vendas pelo seu link. Está com alguma dificuldade? Posso ajudar com material, ideia de divulgação ou com o que for.\n\nSeu cupom continua ativo: {cupom}. É só me responder contando como posso te ajudar.' },
};

// ---- descadastro (link assinado, vale só para lembretes) ----
const tokenFor = (cfg, email) => crypto.createHmac('sha256', cfg.sessionSecret).update('unsub:' + String(email).toLowerCase()).digest('hex').slice(0, 32);
const tokenOk = (cfg, email, t) => { const a = Buffer.from(tokenFor(cfg, email)); const b = Buffer.from(String(t || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const unsubUrl = (cfg, email) => `${cfg.baseUrl}/lembretes/cancelar?e=${encodeURIComponent(String(email).toLowerCase())}&t=${tokenFor(cfg, email)}`;
const optOut = (email) => db.q('INSERT INTO email_optouts (email) VALUES (lower($1)) ON CONFLICT DO NOTHING', [email]);
const optIn = (email) => db.q('DELETE FROM email_optouts WHERE email = lower($1)', [email]);
const isOptedOut = async (email) => (await db.q('SELECT 1 FROM email_optouts WHERE email = lower($1)', [email])).rowCount > 0;

// ---- texto com {nome}, {curso}, {cupom} ----
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const fill = (tpl, vars) => String(tpl).replace(/\{(nome|curso|cupom)\}/g, (_, k) => vars[k] || '');
function cleanText(subject, message) {
  const s = String(subject || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = String(message || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (s.length < 3 || s.length > 140) return { error: 'O assunto precisa ter de 3 a 140 letras.' };
  if (m.length < 10 || m.length > 3000) return { error: 'A mensagem precisa ter de 10 a 3000 letras.' };
  return { subject: s, message: m };
}

// ---- quem pode receber ----
async function annotate(rows, kind) {
  const mails = rows.map((r) => r.email.toLowerCase());
  const out = new Set((await db.q('SELECT email FROM email_optouts WHERE email = ANY($1::text[])', [mails])).rows.map((r) => r.email));
  const last = new Map((await db.q('SELECT lower(email) AS email, max(created_at) AS at FROM reminder_log WHERE kind = $2 AND lower(email) = ANY($1::text[]) GROUP BY 1', [mails, kind])).rows.map((r) => [r.email, r.at]));
  return rows.map((r) => {
    const e = r.email.toLowerCase(); const at = last.get(e) || null;
    const recent = at && Date.now() - new Date(at).getTime() < MIN_DAYS * 86400000;
    return { ...r, lastReminder: at, status: out.has(e) ? 'optout' : recent ? 'recent' : 'send' };
  });
}

async function studentsOf(course, group) {
  const days = group === 'novos' ? 7 : parseInt(group, 10);
  const want = group === 'novos' ? 'new' : 'stop';
  const rows = (await T.list(course.id, { days })).filter((r) => r.state === want && (want !== 'new' || r.since_days >= NEW_GRACE_DAYS));
  if (!rows.length) return [];
  const ok = new Set((await db.q("SELECT id FROM users WHERE id = ANY($1::bigint[]) AND status = 'active' AND role = 'student'", [rows.map((r) => r.user_id)])).rows.map((r) => String(r.id)));
  return annotate(rows.filter((r) => ok.has(String(r.user_id))).map((r) => ({ id: String(r.user_id), userId: r.user_id, name: r.name, email: r.email, since: r.created_at, lastAt: r.last_at, lastDays: r.last_days })), 'aluno');
}

async function affiliatesOf(group) {
  const rows = (await db.q(`SELECT a.id, a.name, a.email, a.user_id,
      (SELECT count(*)::int FROM commissions m WHERE m.affiliate_id = a.id AND m.status = 'active') AS sales,
      (SELECT max(m.created_at) FROM commissions m WHERE m.affiliate_id = a.id AND m.status = 'active') AS last_sale, a.created_at,
      (SELECT k.code FROM coupons k WHERE k.affiliate_id = a.id AND k.status = 'active' ORDER BY k.created_at, k.id LIMIT 1) AS code
    FROM affiliates a WHERE a.status = 'active' ORDER BY a.name, a.id`)).rows;
  const days = group === 'nunca' ? null : parseInt(group, 10);
  const age = (d) => (Date.now() - new Date(d).getTime()) / 86400000;
  // Sem venda: conta a partir do cadastro do afiliado (um afiliado novo não entra).
  const pick = rows.filter((a) => (days === null ? a.sales === 0 && age(a.created_at) >= AFF_GRACE_DAYS : age(a.last_sale || a.created_at) > days));
  return annotate(pick.map((a) => ({ id: String(a.id), affiliateId: a.id, userId: a.user_id, name: a.name, email: a.email, lastSale: a.last_sale, code: a.code })), 'afiliado');
}

const counts = (people, selected) => {
  const send = people.filter((p) => p.status === 'send');
  return { total: people.length, send: send.length, recent: people.filter((p) => p.status === 'recent').length, optout: people.filter((p) => p.status === 'optout').length,
    chosen: selected ? send.filter((p) => selected.has(p.id)).length : send.length, unchecked: selected ? send.filter((p) => !selected.has(p.id)).length : 0 };
};

// ---- envio ----
function build(cfg, { kind, person, course, subject, message }) {
  const vars = { nome: firstName(person.name), curso: course ? course.title : '', cupom: person.code || '' };
  const cta = kind === 'afiliado'
    ? { url: person.code ? K.linkFor(cfg, { code: person.code }) : `${cfg.baseUrl}/afiliado`, label: person.code ? 'Abrir meu link de divulgação' : 'Abrir meu painel' }
    : { url: `${cfg.baseUrl}/curso/${course.slug}`, label: 'Continuar o curso' };
  const why = kind === 'afiliado' ? 'Você recebe este lembrete porque é afiliado(a) da EvoLumen Academy.' : `Você recebe este lembrete porque tem acesso a ${course.title}.`;
  return emails.reminder(cfg, { kind, name: person.name, subject: fill(subject, vars), message: fill(message, vars), cta, unsubUrl: unsubUrl(cfg, person.email), why });
}

async function sendBatch(cfg, h, { kind, course, group, selected, subject, message, token, adminId }) {
  const people = kind === 'afiliado' ? await affiliatesOf(group) : await studentsOf(course, group);
  const pick = people.filter((p) => p.status === 'send' && selected.has(p.id));
  if (!pick.length) throw err('Ninguém para receber: todos foram desmarcados ou já receberam um lembrete nos últimos 10 dias.');
  if (pick.length > MAX_BATCH) throw err(`Envie no máximo ${MAX_BATCH} pessoas por vez. Desmarque algumas e envie o restante depois.`);
  const skipped = people.length - pick.length;
  const ins = await db.q("INSERT INTO reminder_batches (token, kind, course_id, grupo, subject, sent, skipped, sent_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING token",
    [token, kind, course ? course.id : null, group, subject.slice(0, 140), pick.length, skipped, adminId]);
  if (!ins.rowCount) return { duplicate: true, sent: 0, skipped };
  let sent = 0;
  for (const p of pick) {
    // Reserva a pessoa só se ninguém a avisou nos últimos 10 dias e ela não se descadastrou (vale também para dois envios ao mesmo tempo).
    const row = (await db.q(`INSERT INTO reminder_log (batch_token, kind, email, user_id, affiliate_id)
      SELECT $1,$2,lower($3),$4,$5 WHERE NOT EXISTS (SELECT 1 FROM reminder_log x WHERE x.kind = $2 AND lower(x.email) = lower($3) AND x.created_at > now() - make_interval(days => $6))
        AND NOT EXISTS (SELECT 1 FROM email_optouts o WHERE o.email = lower($3)) RETURNING id`, [token, kind, p.email, p.userId || null, p.affiliateId || null, MIN_DAYS])).rows[0];
    if (!row) continue;
    sent++;
    if (kind === 'aluno') await notify.add(p.userId, { kind: 'update', title: 'Sentimos a sua falta por aqui', body: `${course.title}: seu acesso continua liberado.`, link: `/curso/${course.slug}`, key: `nudge:${token}:${p.userId}` });
    // Se o e-mail não saiu, a pessoa volta a poder receber (não fica bloqueada por 10 dias sem ter recebido nada).
    const send = mailer.send(cfg, { to: p.email, ...build(cfg, { kind, person: p, course, subject, message }) })
      .then(async (r) => { if (!r || !r.ok) await db.q('DELETE FROM reminder_log WHERE id = $1', [row.id]); })
      .catch(async () => { await db.q('DELETE FROM reminder_log WHERE id = $1', [row.id]).catch(() => {}); });
    if (h && h.background) h.background(send); else await send;
  }
  await db.q('UPDATE reminder_batches SET sent = $2, skipped = $3 WHERE token = $1', [token, sent, people.length - sent]);
  return { sent, skipped: people.length - sent };
}

module.exports = { MIN_DAYS, MAX_BATCH, STUDENT_GROUPS, AFFILIATE_GROUPS, DEFAULTS, groupsOf, parseGroup, tokenFor, tokenOk, unsubUrl, optOut, optIn, isOptedOut,
  firstName, fill, cleanText, studentsOf, affiliatesOf, counts, build, sendBatch };
