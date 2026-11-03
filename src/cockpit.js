'use strict';
// Cockpit de monitoramento (1.3.0): painel só de leitura, sem login, aberto por um link com chave secreta.
// Nunca devolve e-mail, telefone, CPF ou nome completo: as pessoas aparecem como "Maria S.".
const crypto = require('crypto');
const db = require('./db');
const A = require('./affiliates');

const TZ = 'America/Sao_Paulo';
const cache = new Map();
const MS_DAY = 86400000;

// ---------- chave ----------
async function current() {
  const r = (await db.q('SELECT token, rotated_at FROM cockpit_access WHERE id = 1')).rows[0];
  return r || null;
}
async function ensure() {
  let r = await current();
  if (!r) {
    await db.q('INSERT INTO cockpit_access (id, token) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [crypto.randomBytes(32).toString('base64url')]);
    r = await current();
  }
  return r;
}
async function rotate(userId) {
  cache.clear();
  const token = crypto.randomBytes(32).toString('base64url');
  await db.q(`INSERT INTO cockpit_access (id, token, rotated_by) VALUES (1, $1, $2)
    ON CONFLICT (id) DO UPDATE SET token = EXCLUDED.token, rotated_at = now(), rotated_by = EXCLUDED.rotated_by`, [token, userId || null]);
  return token;
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
async function check(key) {
  const k = String(key || '');
  if (k.length < 32 || k.length > 128 || !/^[A-Za-z0-9_-]+$/.test(k)) return false;
  const r = await current();
  return !!r && crypto.timingSafeEqual(sha(k), sha(r.token));
}
const urlFor = (cfg, token) => `${String(cfg.baseUrl).replace(/\/+$/, '')}/painel/${token}`;

// Freio simples contra quem fica chutando chaves: 40 erros em 10 minutos por endereço de IP.
const misses = new Map();
function tooMany(ip) {
  const now = Date.now(); const list = (misses.get(ip) || []).filter((t) => now - t < 600000);
  misses.set(ip, list);
  if (misses.size > 5000) misses.clear();
  return list.length >= 40;
}
function miss(ip) { const l = misses.get(ip) || []; l.push(Date.now()); misses.set(ip, l); }

// ---------- datas (sempre no horário de Brasília) ----------
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const parseYmd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(s + 'T12:00:00Z')) ? String(s) : null);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const startOf = (s) => new Date(`${s}T00:00:00-03:00`);
const diffDays = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / MS_DAY);

// Período pedido → { f, from, to (limites em Date, ou null para o acumulado), unit, label }
function period(f, de, ate, now = new Date()) {
  const today = ymd(now);
  if (f === 'today') return { f, from: startOf(today), to: startOf(addDays(today, 1)), unit: 'hour', label: 'hoje', days: [today] };
  if (f === '7d') return { f, from: startOf(addDays(today, -6)), to: startOf(addDays(today, 1)), unit: 'day', label: 'últimos 7 dias', first: addDays(today, -6), last: today };
  if (f === 'month') { const first = today.slice(0, 8) + '01'; return { f, from: startOf(first), to: startOf(addDays(today, 1)), unit: 'day', label: 'este mês', first, last: today }; }
  if (f === 'custom') {
    let a = parseYmd(de); let b = parseYmd(ate);
    if (a && b) {
      if (a > b) [a, b] = [b, a];
      if (b > today) b = today;
      if (a > b) a = b;
      if (diffDays(a, b) > 730) a = addDays(b, -730);
      const span = diffDays(a, b) + 1;
      return { f, from: startOf(a), to: startOf(addDays(b, 1)), unit: span <= 62 ? 'day' : 'week', label: 'período escolhido', first: a, last: b, de: a, ate: b };
    }
  }
  return { f: 'total', from: null, to: null, unit: 'week', label: 'desde o início', first: null, last: today };
}

// ---------- consultas ----------
const brDay = (col) => `to_char((${col}) AT TIME ZONE '${TZ}', 'YYYY-MM-DD')`;

async function metrics(from, to) {
  const P = [from, to];
  const inP = (col) => `($1::timestamptz IS NULL OR ${col} >= $1) AND ($2::timestamptz IS NULL OR ${col} < $2)`;
  const [sales, refunds, students, enroll] = await Promise.all([
    db.q(`SELECT count(*) FILTER (WHERE kind = 'purchase')::int AS sales, count(*) FILTER (WHERE kind = 'renewal')::int AS renew, COALESCE(sum(price_cents), 0)::bigint AS revenue
          FROM orders WHERE status = 'approved' AND ${inP('approved_at')}`, P),
    db.q(`SELECT count(*)::int AS n, COALESCE(sum(price_cents), 0)::bigint AS cents FROM orders WHERE status IN ('refunded','charged_back') AND ${inP('COALESCE(refunded_at, approved_at)')}`, P),
    db.q(`SELECT count(*)::int AS n FROM users WHERE role = 'student' AND ${inP('created_at')}`, P),
    db.q(`SELECT count(*)::int AS n FROM enrollments WHERE status = 'active' AND ${inP('created_at')}`, P),
  ]);
  return { revenue: Number(sales.rows[0].revenue), sales: sales.rows[0].sales, renew: sales.rows[0].renew, refunds: refunds.rows[0].n, refunded_cents: Number(refunds.rows[0].cents), students: students.rows[0].n, enrollments: enroll.rows[0].n };
}

async function series(p, now) {
  const range = p.from ? [p.from, p.to] : null;
  let keys = []; let sqlKey; let from; let to;
  if (p.unit === 'hour') {
    const day = ymd(now); from = startOf(day); to = startOf(addDays(day, 1));
    keys = Array.from({ length: 24 }, (_, h) => ({ k: `${day} ${String(h).padStart(2, '0')}`, l: `${h}h` }));
    sqlKey = `to_char((approved_at) AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24')`;
  } else if (p.unit === 'day') {
    const a = p.first; const n = Math.min(62, diffDays(a, p.last) + 1);
    from = startOf(a); to = startOf(addDays(a, n));
    keys = Array.from({ length: n }, (_, i) => { const d = addDays(a, i); return { k: d, l: d.slice(8) + '/' + d.slice(5, 7) }; });
    sqlKey = brDay('approved_at');
  } else {
    // semanas (segunda a domingo), até 26 semanas terminando hoje; o acumulado mostra as últimas 12
    const anchor = p.f === 'total' ? ymd(now) : p.last; const dow = (new Date(anchor + 'T12:00:00Z').getUTCDay() + 6) % 7;
    const monday = addDays(anchor, -dow);
    const count = p.f === 'total' ? 12 : Math.min(26, Math.max(1, Math.ceil((diffDays(p.first, p.last) + 1) / 7) + 1));
    const firstMonday = addDays(monday, -7 * (count - 1));
    from = range && range[0] > startOf(firstMonday) ? range[0] : startOf(firstMonday); to = startOf(addDays(monday, 7));
    keys = Array.from({ length: count }, (_, i) => { const d = addDays(firstMonday, 7 * i); return { k: d, l: d.slice(8) + '/' + d.slice(5, 7) }; });
    sqlKey = `to_char(date_trunc('week', (approved_at) AT TIME ZONE '${TZ}'), 'YYYY-MM-DD')`;
  }
  const rows = (await db.q(`SELECT ${sqlKey} AS k, sum(price_cents)::bigint AS cents, count(*)::int AS n FROM orders WHERE status = 'approved' AND approved_at >= $1 AND approved_at < $2 GROUP BY 1`, [from, to])).rows;
  const by = new Map(rows.map((r) => [r.k, r]));
  return { unit: p.unit, points: keys.map((x) => ({ l: x.l, cents: Number((by.get(x.k) || {}).cents || 0), n: (by.get(x.k) || {}).n || 0 })) };
}

async function payload(q, cfg, now = new Date()) {
  // Cache curto: um painel aberto recarrega a cada 30 s e vários visitantes não multiplicam as consultas.
  if (cfg.isTest) return build(q, cfg, now);
  const key = [q.f, q.de, q.ate].join('|'); const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10000) return hit.data;
  const data = await build(q, cfg, now);
  if (cache.size > 50) cache.clear();
  cache.set(key, { at: Date.now(), data });
  return data;
}
async function build({ f, de, ate }, cfg, now) {
  const p = period(f, de, ate, now);
  const today = period('today', null, null, now);
  const [mP, mT, mD] = await Promise.all([metrics(p.from, p.to), p.from ? metrics(null, null) : null, metrics(today.from, today.to)]);
  const P = [p.from, p.to];
  const inP = (col) => `($1::timestamptz IS NULL OR ${col} >= $1) AND ($2::timestamptz IS NULL OR ${col} < $2)`;
  const startToday = startOf(ymd(now));

  const [feedSales, feedNew, online, onlineCount, todayCount, studentsTotal, activeNow, rank, funnel, affTop, affTotals, refundOpen, chart, legal] = await Promise.all([
    db.q(`SELECT o.kind, o.price_cents, o.approved_at AS at, COALESCE(NULLIF(o.buyer->>'name',''), u.name) AS name, c.title AS course
          FROM orders o JOIN courses c ON c.id = o.course_id LEFT JOIN users u ON u.id = o.user_id
          WHERE o.status = 'approved' ORDER BY o.approved_at DESC, o.id DESC LIMIT 8`),
    db.q(`SELECT u.name, u.created_at AS at, EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = u.id AND e.status = 'active') AS enrolled
          FROM users u WHERE u.role = 'student' ORDER BY u.created_at DESC, u.id DESC LIMIT 8`),
    db.q(`SELECT u.id, u.name, max(s.last_seen_at) AS at,
            (SELECT c.title FROM lesson_watch w JOIN lessons l ON l.id = w.lesson_id JOIN courses c ON c.id = l.course_id
              WHERE w.user_id = u.id AND w.updated_at > now() - interval '40 minutes' ORDER BY w.updated_at DESC LIMIT 1) AS course
          FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE u.role = 'student' AND u.status = 'active' AND s.last_seen_at > now() - interval '40 minutes' AND s.expires_at > now()
          GROUP BY u.id, u.name ORDER BY max(s.last_seen_at) DESC LIMIT 8`),
    db.q(`SELECT count(DISTINCT s.user_id)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.role = 'student' AND s.last_seen_at > now() - interval '15 minutes' AND s.expires_at > now()`),
    db.q(`SELECT count(DISTINCT s.user_id)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.role = 'student' AND s.last_seen_at >= $1`, [startToday]),
    db.q(`SELECT count(*)::int AS n FROM users WHERE role = 'student'`),
    db.q(`SELECT count(*)::int AS n FROM enrollments WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())`),
    db.q(`SELECT c.title, count(*)::int AS n, sum(o.price_cents)::bigint AS cents FROM orders o JOIN courses c ON c.id = o.course_id
          WHERE o.status = 'approved' AND ${inP('o.approved_at')} GROUP BY c.id, c.title ORDER BY count(*) DESC, sum(o.price_cents) DESC LIMIT 6`, P),
    db.q(`SELECT count(*)::int AS started,
            count(*) FILTER (WHERE status = 'approved')::int AS paid,
            count(*) FILTER (WHERE status = 'pending' AND (pix_expires_at IS NULL OR pix_expires_at > now()))::int AS pending,
            count(*) FILTER (WHERE status = 'expired')::int AS expired,
            count(*) FILTER (WHERE status IN ('refused','cancelled'))::int AS refused
          FROM orders WHERE ${inP('created_at')}`, P),
    db.q(`SELECT a.name, string_agg(DISTINCT cp.code, ', ') AS codes, count(*)::int AS n, sum(m.amount_cents)::bigint AS cents
          FROM commissions m JOIN affiliates a ON a.id = m.affiliate_id JOIN coupons cp ON cp.id = m.coupon_id
          WHERE m.status = 'active' AND ${inP('m.created_at')} GROUP BY a.id, a.name ORDER BY sum(m.amount_cents) DESC LIMIT 5`, P),
    A.list(),
    db.q(`SELECT count(*)::int AS n FROM refund_requests WHERE status IN ('requested','failed')`),
    series(p, now),
    db.q(`SELECT count(DISTINCT doc_type)::int AS n FROM legal_documents WHERE status = 'published' AND doc_type IN ('terms','privacy')`),
  ]);

  const f0 = funnel.rows[0];
  const sn = (n) => A.shortName(n);
  const totals = affTotals.totals;
  return {
    now: now.toISOString(), version: cfg.version.version, env: cfg.appEnv,
    period: { f: p.f, label: p.label, de: p.de || null, ate: p.ate || null },
    kpi: { period: mP, total: mT || mP, today: mD, studentsTotal: studentsTotal.rows[0].n, activeNow: activeNow.rows[0].n },
    sales: feedSales.rows.map((r) => ({ who: sn(r.name), course: r.course, cents: r.price_cents, renew: r.kind === 'renewal', at: r.at })),
    students: feedNew.rows.map((r) => ({ who: sn(r.name), enrolled: r.enrolled, at: r.at })),
    online: { now: onlineCount.rows[0].n, today: todayCount.rows[0].n, list: online.rows.map((r) => ({ who: sn(r.name), course: r.course || null, at: r.at })) },
    rank: rank.rows.map((r) => ({ title: r.title, n: r.n, cents: Number(r.cents) })),
    funnel: { started: f0.started, paid: f0.paid, pending: f0.pending, expired: f0.expired, refused: f0.refused },
    chart,
    aff: { grace: totals.grace, released: totals.released, paid: totals.paid, balance: totals.balance, top: affTop.rows.map((r) => ({ who: sn(r.name), codes: r.codes, n: r.n, cents: Number(r.cents) })) },
    health: { mail: cfg.mailTransport === 'memory' || !!(cfg.resendApiKey && cfg.resendFrom), payments: cfg.paymentProvider === 'mercadopago' ? (cfg.mpAccessToken ? 'Mercado Pago ligado' : 'Mercado Pago sem token') : 'Simulador (só teste)', paymentsOn: cfg.paymentProvider === 'mercadopago' && !!cfg.mpAccessToken, legal: legal.rows[0].n, refundsOpen: refundOpen.rows[0].n },
  };
}

module.exports = { ensure, current, rotate, check, urlFor, tooMany, miss, period, payload, metrics };
