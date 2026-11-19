'use strict';
// Promoções gerais do site (campanhas): desconto em % ou em R$, em todos os produtos ou em alguns, com início e fim.
// O preço é calculado em um lugar só (courses.effectivePrice → priceFor). As definições ficam em memória por poucos
// segundos e a vigência é conferida na hora de cada uso, então começar e acabar não depende de agendador.
const db = require('./db');

const SP = 'America/Sao_Paulo';
const TTL = 15000;
let cache = []; let loadedAt = 0; let loading = null;

async function load() {
  const rows = (await db.q(`SELECT p.*, COALESCE((SELECT array_agg(pc.course_id::text) FROM promotion_courses pc WHERE pc.promotion_id = p.id), '{}') AS course_ids
    FROM promotions p WHERE p.status = 'active' AND p.ends_at > now() - interval '1 day'`)).rows;
  cache = rows.map((r) => ({ ...r, starts: new Date(r.starts_at).getTime(), ends: new Date(r.ends_at).getTime() }));
  loadedAt = Date.now();
}
// Chamado a cada requisição (barato): só vai ao banco se o cache passou do prazo.
async function refresh(force = false) {
  if (!force && Date.now() - loadedAt < TTL) return;
  if (force && loading) await loading.catch(() => {}); // um carregamento em andamento pode ter lido dados antigos: refaz
  if (!loading) loading = load().catch((e) => { loadedAt = Date.now() - TTL + 5000; throw e; }).finally(() => { loading = null; });
  await loading;
}
const invalidate = () => { loadedAt = 0; };

const isLive = (p, t) => t >= p.starts && t <= p.ends;
const brl = (c) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const offLabel = (p) => (p.kind === 'percent' ? `${p.percent}% off` : `${brl(p.amount_cents)} off`);
const tagOf = (p) => (p.tag_text && p.tag_text.trim()) || `${p.name} · ${offLabel(p)}`;
const dayBr = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: SP, day: '2-digit', month: '2-digit' });
const hourBr = (d) => new Date(d).toLocaleTimeString('pt-BR', { timeZone: SP, hour: '2-digit', minute: '2-digit' });
// "30/11" quando termina no fim do dia; com hora quando termina em outro horário.
const untilBr = (d) => (hourBr(d) === '23:59' ? dayBr(d) : `${dayBr(d)} às ${hourBr(d)}`);
const bannerOf = (p) => (p.banner_text && p.banner_text.trim()) || `Estamos com preço promocional! ${p.name}: ${offLabel(p).replace(' off', ' de desconto')}, até ${untilBr(p.ends_at)}.`;

const covers = (p, courseId) => p.all_products || p.course_ids.includes(String(courseId));
// Preço da promoção para um produto, ou null se não vale (fora do período, fora da seleção, desconto que zera ou não baixa o preço).
function priceFor(course, now = new Date()) {
  if (!course || !(course.price_cents > 0)) return null;
  const t = now.getTime(); let best = null;
  for (const p of cache) {
    if (!isLive(p, t) || !covers(p, course.id)) continue;
    const base = course.price_cents;
    const cents = p.kind === 'percent' ? Math.round((base * (100 - p.percent)) / 100) : base - p.amount_cents;
    if (!(cents > 0) || cents >= base) continue;
    if (!best || cents < best.cents) best = { cents, promo: p };
  }
  return best;
}
// Promoções no ar agora (para faixa, tema e home).
const liveNow = (now = new Date()) => cache.filter((p) => isLive(p, now.getTime()));
const theme = (now = new Date()) => (liveNow(now).find((p) => p.theme === 'blackfriday') ? 'blackfriday' : 'none');
const banner = (now = new Date()) => { const live = liveNow(now).sort((a, b) => a.ends - b.ends); const l = live.find((p) => p.theme === 'blackfriday') || live[0]; // Black Friday no ar manda no tema, mesmo que outra promoção termine antes
   return l ? { promo: l, text: bannerOf(l), theme: l.theme, off: offLabel(l), ends: untilBr(l.ends_at), endsIso: new Date(l.ends_at).toISOString() } : null; };

// ---------- cadastro ----------
const toDate = (s) => { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(s || '').trim()); if (!m) return null; const d = new Date(`${m[1]}T${m[2]}:00-03:00`); return Number.isNaN(d.getTime()) ? null : d; };
const localInput = (d) => { if (!d) return ''; const p = new Intl.DateTimeFormat('sv-SE', { timeZone: SP, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(d)); return p.replace(' ', 'T'); };

async function parse(body, { id = null } = {}) {
  const errors = {}; const b = body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  if (name.length < 3) errors.name = 'Informe o nome da promoção (mínimo 3 letras).';
  const kind = b.kind === 'fixed' ? 'fixed' : 'percent';
  let percent = null; let amount = null;
  if (kind === 'percent') { const n = Number(String(b.percent || '').replace(',', '.')); if (!Number.isInteger(n) || n < 1 || n > 99) errors.percent = 'Informe uma porcentagem inteira de 1 a 99.'; else percent = n; }
  else { const m = require('./courses').parseMoney(b.amount); if (!m.cents || !(m.cents > 0)) errors.amount = 'Informe o valor do desconto em reais (ex.: 50,00).'; else amount = m.cents; }
  const starts = toDate(b.starts_at); const ends = toDate(b.ends_at);
  if (!starts) errors.starts_at = 'Informe o início.';
  if (!ends) errors.ends_at = 'Informe o fim.';
  if (starts && ends && ends <= starts) errors.ends_at = 'O fim precisa ser depois do início.';
  const all = b.scope !== 'selected';
  let ids = [...new Set([].concat(b.courses || []).map(String).filter((x) => /^\d{1,12}$/.test(x)))];
  if (ids.length) ids = (await db.q('SELECT id::text FROM courses WHERE id = ANY($1::bigint[])', [ids])).rows.map((x) => x.id);
  if (!all && !ids.length) errors.courses = 'Escolha ao menos um produto.';
  const tag = String(b.tag_text || '').trim().slice(0, 60) || null;
  const bannerText = String(b.banner_text || '').trim().slice(0, 160) || null;
  const themeV = b.theme === 'blackfriday' ? 'blackfriday' : 'none';
  if (!Object.keys(errors).length) {
    const clash = await conflict({ starts, ends, all, ids, id });
    if (clash) errors.starts_at = `Já existe a promoção "${clash.name}" ativa nesse período para ${clash.all_products || all ? 'esses produtos' : 'um dos produtos escolhidos'}. Ajuste as datas ou os produtos, ou inative a outra.`;
  }
  return { errors, values: { name, kind, percent, amount_cents: amount, starts_at: starts, ends_at: ends, all_products: all, courses: ids, tag_text: tag, banner_text: bannerText, theme: themeV } };
}

// Duas promoções ativas no mesmo produto no mesmo período não são permitidas.
async function conflict({ starts, ends, all, ids, id }) {
  const r = (await db.q(`SELECT p.id, p.name, p.all_products FROM promotions p
    WHERE p.status = 'active' AND ($1::bigint IS NULL OR p.id <> $1::bigint) AND p.starts_at < $3 AND p.ends_at > $2
      AND ($4::boolean OR p.all_products OR EXISTS (SELECT 1 FROM promotion_courses pc WHERE pc.promotion_id = p.id AND pc.course_id = ANY($5::bigint[])))
    ORDER BY p.starts_at LIMIT 1`, [id, starts, ends, all, ids])).rows[0];
  return r || null;
}

const stateOf = (p, now = new Date()) => (p.status !== 'active' ? 'inactive' : now < new Date(p.starts_at) ? 'scheduled' : now > new Date(p.ends_at) ? 'ended' : 'live');
const STATE_LABEL = { live: 'Ativa', scheduled: 'Agendada', ended: 'Encerrada', inactive: 'Inativa' };

const withCourses = `SELECT p.*, COALESCE((SELECT json_agg(json_build_object('id', x.id, 'title', x.title) ORDER BY x.title) FROM promotion_courses pc JOIN courses x ON x.id = pc.course_id WHERE pc.promotion_id = p.id), '[]'::json) AS courses,
  (SELECT count(*)::int FROM orders o WHERE o.campaign_id = p.id AND o.status IN ('approved','refunded','charged_back')) AS orders FROM promotions p`;
const list = async () => (await db.q(`${withCourses} ORDER BY p.starts_at DESC, p.id DESC`)).rows;
const byId = async (id) => (/^\d{1,12}$/.test(String(id)) ? (await db.q(`${withCourses} WHERE p.id = $1`, [id])).rows[0] || null : null);

async function save(c, v, userId, id = null) {
  const cols = [v.name, v.kind, v.percent, v.amount_cents, v.tag_text, v.banner_text, v.starts_at, v.ends_at, v.all_products, v.theme];
  let pid = id;
  if (id) await c.query('UPDATE promotions SET name=$2, kind=$3, percent=$4, amount_cents=$5, tag_text=$6, banner_text=$7, starts_at=$8, ends_at=$9, all_products=$10, theme=$11 WHERE id=$1', [id, ...cols]);
  else pid = (await c.query('INSERT INTO promotions (name, kind, percent, amount_cents, tag_text, banner_text, starts_at, ends_at, all_products, theme, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id', [...cols, userId])).rows[0].id;
  await c.query('DELETE FROM promotion_courses WHERE promotion_id = $1', [pid]);
  if (!v.all_products) for (const cid of v.courses) await c.query('INSERT INTO promotion_courses (promotion_id, course_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [pid, cid]);
  return pid;
}
// Confere a sobreposição e grava na mesma transação, sob trava: dois envios ao mesmo tempo não passam juntos.
async function saveChecked(v, userId, id = null) {
  const out = await db.tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('promotions'))");
    const clash = await conflict({ starts: v.starts_at, ends: v.ends_at, all: v.all_products, ids: v.courses, id });
    if (clash) return { clash };
    return { id: await save(c, v, userId, id) };
  });
  if (!out.clash) { invalidate(); await refresh(true); }
  return out;
}
async function deactivate(id) { await db.q("UPDATE promotions SET status = 'inactive' WHERE id = $1", [id]); invalidate(); await refresh(true); }

module.exports = { saveChecked, refresh, invalidate, priceFor, liveNow, theme, banner, tagOf, offLabel, bannerOf, parse, conflict, stateOf, STATE_LABEL, list, byId, save, deactivate, localInput, covers };
