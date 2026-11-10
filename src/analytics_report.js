'use strict';
// EvoLumen Analytics (2.2.0): números da tela. Tudo calculado no banco, sem terceiros.
const db = require('./db');
const SP = 'America/Sao_Paulo';
const DAYS = [7, 30, 90];
const SITES = { todos: null, plataforma: 'plataforma', landings: 'landing' };
const parseDays = (v) => (DAYS.includes(Number(v)) ? Number(v) : 30);
const parseSite = (v) => (Object.prototype.hasOwnProperty.call(SITES, v) ? v : 'todos');

const SOURCE = { instagram: 'Instagram', facebook: 'Facebook', google: 'Google (busca)', 'outras-buscas': 'Outras buscas', youtube: 'YouTube', whatsapp: 'WhatsApp', linkedin: 'LinkedIn', tiktok: 'TikTok', x: 'X (Twitter)', telegram: 'Telegram', pinterest: 'Pinterest', email: 'E-mail', site: 'Outro endereço do EvoLumen', 'outros-sites': 'Outros sites', direto: 'Direto' };
const UF = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
const DEVICE = { celular: 'Celular', computador: 'Computador', tablet: 'Tablet' };
let regionNames; try { regionNames = new Intl.DisplayNames(['pt-BR'], { type: 'region' }); } catch { regionNames = null; }
const countryName = (c) => { try { return (regionNames && regionNames.of(c)) || c; } catch { return c; } };

const q0 = async (sql, p) => (await db.q(sql, p)).rows;
// No máximo 3 consultas ao mesmo tempo: a tela não pode ocupar todas as conexões do banco (checkout e webhooks usam o mesmo conjunto).
function limiter(max) { let run = 0; const wait = []; const next = () => { if (run < max && wait.length) { run++; const { fn, ok, bad } = wait.shift(); fn().then(ok, bad).finally(() => { run--; next(); }); } }; return (fn) => new Promise((ok, bad) => { wait.push({ fn, ok, bad }); next(); }); }
const n = (x) => Number(x || 0);

async function report({ days = 30, site = 'todos' } = {}) {
  days = parseDays(days); site = parseSite(site); const st = SITES[site];
  const lim = limiter(3); const q = (sql, p) => lim(() => q0(sql, p));
  const t = (await q(`SELECT (date_trunc('day', now() AT TIME ZONE '${SP}') - (($1::int - 1) * interval '1 day')) AT TIME ZONE '${SP}' AS since,
    (date_trunc('day', now() AT TIME ZONE '${SP}') - ((2 * $1::int - 1) * interval '1 day')) AT TIME ZONE '${SP}' AS prev`, [days]))[0];
  const P = [t.since, st]; const C = '($2::text IS NULL OR s.site = $2)';
  const sess = `FROM an_sessions s WHERE s.started_at >= $1 AND ${C}`;

  const [first, cur, prev, pv, pvPrev, buys, buysPrev, orphan, daily, funnel, sources, nr, devices, browsers, geo, views, entries, exits, coupons, stu, ages] = await Promise.all([
    q('SELECT min(started_at) AS first FROM an_sessions', []),
    q(`SELECT count(*)::int AS visits, count(DISTINCT visitor_id)::int AS visitors, count(DISTINCT visitor_id) FILTER (WHERE is_new)::int AS novos ${sess}`, P),
    q(`SELECT count(*)::int AS visits, count(DISTINCT visitor_id)::int AS visitors FROM an_sessions s WHERE s.started_at >= $3 AND s.started_at < $1 AND ${C}`, [t.since, st, t.prev]),
    q(`SELECT count(*)::int AS n FROM an_pageviews p JOIN an_sessions s ON s.id = p.session_id WHERE p.created_at >= $1 AND ${C}`, P),
    q(`SELECT count(*)::int AS n FROM an_pageviews p JOIN an_sessions s ON s.id = p.session_id WHERE p.created_at >= $3 AND p.created_at < $1 AND ${C}`, [t.since, st, t.prev]),
    q(`SELECT count(*)::int AS n FROM orders o LEFT JOIN an_sessions s ON s.id = o.session_id WHERE o.status = 'approved' AND o.approved_at >= $1 AND ($2::text IS NULL OR s.site = $2)`, P),
    q(`SELECT count(*)::int AS n FROM orders o LEFT JOIN an_sessions s ON s.id = o.session_id WHERE o.status = 'approved' AND o.approved_at >= $3 AND o.approved_at < $1 AND ($2::text IS NULL OR s.site = $2)`, [t.since, st, t.prev]),
    q(`SELECT count(*)::int AS n FROM orders o WHERE o.status = 'approved' AND o.approved_at >= $1 AND NOT EXISTS (SELECT 1 FROM an_sessions s WHERE s.id = o.session_id)`, [t.since]),
    q(`SELECT to_char(d, 'YYYY-MM-DD') AS day, count(s.id)::int AS visits, count(DISTINCT s.visitor_id)::int AS visitors
       FROM generate_series(($1::timestamptz AT TIME ZONE '${SP}')::date::timestamp, (now() AT TIME ZONE '${SP}')::date::timestamp, interval '1 day') d
       LEFT JOIN an_sessions s ON (s.started_at AT TIME ZONE '${SP}')::date = d::date AND s.started_at >= $1 AND ${C} GROUP BY d ORDER BY d`, P),
    q(`WITH ss AS (SELECT s.id ${sess}),
        f AS (SELECT ss.id,
          EXISTS (SELECT 1 FROM an_pageviews p WHERE p.session_id = ss.id AND p.site = 'plataforma' AND p.path LIKE '/cursos/%') AS curso,
          EXISTS (SELECT 1 FROM an_pageviews p WHERE p.session_id = ss.id AND p.site = 'plataforma' AND p.path LIKE '/checkout/%') AS checkout,
          EXISTS (SELECT 1 FROM an_pageviews p WHERE p.session_id = ss.id AND p.site = 'landing') AS landing,
          EXISTS (SELECT 1 FROM orders o WHERE o.session_id = ss.id) AS pedido,
          EXISTS (SELECT 1 FROM orders o WHERE o.session_id = ss.id AND o.status = 'approved') AS aprovada FROM ss)
       SELECT count(*)::int AS visitas, count(*) FILTER (WHERE landing)::int AS landing,
        count(*) FILTER (WHERE curso OR checkout OR pedido OR aprovada)::int AS curso, count(*) FILTER (WHERE checkout OR pedido OR aprovada)::int AS checkout,
        count(*) FILTER (WHERE pedido OR aprovada)::int AS pedido, count(*) FILTER (WHERE aprovada)::int AS aprovada FROM f`, P),
    q(`SELECT s.source, count(*)::int AS n ${sess} GROUP BY 1 ORDER BY 2 DESC`, P),
    q(`SELECT count(*) FILTER (WHERE nv)::int AS novos, count(*) FILTER (WHERE NOT nv AND ses <= 3)::int AS recorrentes, count(*) FILTER (WHERE NOT nv AND ses > 3)::int AS fieis
       FROM (SELECT s.visitor_id, bool_or(s.is_new) AS nv, max(v.sessions) AS ses FROM an_sessions s JOIN an_visitors v USING (visitor_id) WHERE s.started_at >= $1 AND ${C} GROUP BY 1) x`, P),
    q(`SELECT s.device, count(*)::int AS n ${sess} GROUP BY 1 ORDER BY 2 DESC`, P),
    q(`SELECT s.browser, count(*)::int AS n ${sess} GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, P),
    q(`SELECT s.country, s.region, count(*)::int AS n ${sess} GROUP BY 1, 2`, P),
    q(`SELECT p.site, p.host, p.path, count(*)::int AS n FROM an_pageviews p JOIN an_sessions s ON s.id = p.session_id WHERE p.created_at >= $1 AND ${C} GROUP BY p.site, p.host, p.path ORDER BY n DESC LIMIT 10`, P),
    q(`SELECT s.site, s.entry_host AS host, s.entry_path AS path, count(*)::int AS n ${sess} GROUP BY 1, 2, 3`, P),
    q(`SELECT site, host, path, count(*)::int AS n FROM (SELECT DISTINCT ON (p.session_id) p.site, p.host, p.path FROM an_pageviews p JOIN an_sessions s ON s.id = p.session_id WHERE s.started_at >= $1 AND ${C} ORDER BY p.session_id, p.created_at DESC, p.id DESC) x GROUP BY 1, 2, 3`, P),
    q(`SELECT s.coupon, a.name AS affiliate, count(*)::int AS visits,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM an_pageviews p WHERE p.session_id = s.id AND p.path LIKE '/checkout/%'))::int AS checkout,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM orders o WHERE o.session_id = s.id AND o.status = 'approved'))::int AS buys
       FROM an_sessions s LEFT JOIN coupons c ON upper(c.code) = s.coupon LEFT JOIN affiliates a ON a.id = c.affiliate_id
       WHERE s.coupon IS NOT NULL AND s.started_at >= $1 AND ${C} GROUP BY s.coupon, a.name ORDER BY visits DESC, s.coupon LIMIT 15`, P),
    q(`SELECT (SELECT count(DISTINCT e.user_id) FROM enrollments e JOIN users u ON u.id = e.user_id WHERE u.role = 'student' AND e.status = 'active' AND e.starts_at <= now() AND (e.expires_at IS NULL OR e.expires_at > now()) AND ((u.last_login_at IS NOT NULL AND u.last_login_at < now() - interval '14 days') OR (u.last_login_at IS NULL AND e.starts_at < now() - interval '14 days')))::int AS parados,
        (SELECT count(*) FROM users WHERE role = 'student' AND last_login_at >= $1)::int AS entraram,
        (SELECT count(*) FROM users WHERE role = 'student' AND last_login_at >= now() - interval '7 days')::int AS semana,
        (SELECT count(DISTINCT user_id) FROM enrollments WHERE status = 'active' AND starts_at <= now() AND (expires_at IS NULL OR expires_at > now()))::int AS com_acesso`, [t.since]),
    q(`SELECT count(*) FILTER (WHERE a BETWEEN 18 AND 24)::int AS f1, count(*) FILTER (WHERE a BETWEEN 25 AND 34)::int AS f2, count(*) FILTER (WHERE a BETWEEN 35 AND 44)::int AS f3,
        count(*) FILTER (WHERE a BETWEEN 45 AND 54)::int AS f4, count(*) FILTER (WHERE a >= 55)::int AS f5, count(*) FILTER (WHERE a < 18)::int AS f0, count(*)::int AS informaram,
        (SELECT count(*) FROM users WHERE role = 'student')::int AS total
       FROM (SELECT date_part('year', age(birth_date)) AS a FROM users WHERE role = 'student' AND birth_date IS NOT NULL) x`, []),
  ]);

  const c = cur[0]; const pr = prev[0]; const visitors = c.visitors;
  const complete = first[0].first && new Date(first[0].first) <= new Date(t.prev); // só compara se já havia coleta no período anterior inteiro
  const delta = (a, b) => (complete && b > 0 ? Math.round(((a - b) / b) * 100) : null);
  const kpi = {
    visitors, visits: c.visits, pageviews: pv[0].n, novos: c.novos, recorrentes: Math.max(visitors - c.novos, 0), compras: buys[0].n,
    dVisitors: delta(visitors, pr.visitors), dVisits: delta(c.visits, pr.visits),
    perVisit: c.visits ? pv[0].n / c.visits : 0, conv: c.visits ? (funnel[0].aprovada / c.visits) * 100 : 0, semOrigem: site === 'todos' ? orphan[0].n : 0,
  };

  const F = funnel[0];
  const steps = [['Visitas no período', F.visitas], ['Viram a página de um curso', F.curso], ['Abriram o checkout', F.checkout], ['Pedido criado', F.pedido], ['Compra aprovada', F.aprovada]]
    .filter(([, v], i) => i === 0 || v > 0 || i >= 2);

  const dev = devices.map((d) => [DEVICE[d.device] || d.device || 'Não identificado', d.n]);
  const src = sources.map((s) => [SOURCE[s.source] || s.source, s.n]);

  // Regiões: estados do Brasil, outros estados juntos, exterior e sem localização.
  const byUf = new Map(); let abroad = 0; let unknown = 0; let brOther = 0; const countries = new Map();
  for (const g of geo) {
    if (!g.country) unknown += g.n;
    else if (g.country === 'BR') { if (g.region && UF[g.region]) byUf.set(g.region, (byUf.get(g.region) || 0) + g.n); else brOther += g.n; }
    else { abroad += g.n; countries.set(g.country, (countries.get(g.country) || 0) + g.n); }
  }
  const ufs = [...byUf.entries()].sort((a, b) => b[1] - a[1]);
  const regions = ufs.slice(0, 6).map(([k, v]) => [UF[k], v]);
  const rest = ufs.slice(6).reduce((s, [, v]) => s + v, 0) + brOther;
  if (rest) regions.push(['Outros estados', rest]);
  if (abroad) regions.push(['Fora do Brasil', abroad]);
  if (unknown) regions.push(['Sem localização', unknown]);
  const abroadTop = [...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => countryName(k));

  const key = (r) => `${r.site}|${r.host}|${r.path}`; const em = new Map(entries.map((r) => [key(r), r.n])); const xm = new Map(exits.map((r) => [key(r), r.n]));
  const pages = views.map((r) => ({ label: r.site === 'landing' ? `${r.host}${r.path === '/' ? '' : r.path}` : r.path, landing: r.site === 'landing', n: r.n, entries: em.get(key(r)) || 0, exits: xm.get(key(r)) || 0 }));

  const S = stu[0]; const A = ages[0];
  return {
    days, site, since: t.since, landingVisits: F.landing, kpi, daily: daily.map((d) => ({ day: d.day, visits: d.visits, visitors: d.visitors })), steps, src, dev,
    browsers: browsers.map((b) => [b.browser || 'Outro', b.n]), total: c.visits,
    nr: [['Novos', c.novos], ['Recorrentes (2 a 3 visitas)', nr[0].recorrentes], ['Fiéis (4 ou mais visitas)', nr[0].fieis]],
    regions, abroadTop, pages, coupons: coupons.map((r) => ({ coupon: r.coupon, affiliate: r.affiliate, visits: r.visits, checkout: r.checkout, buys: r.buys })),
    students: { entraram: S.entraram, semana: S.semana, parados: S.parados, comAcesso: S.com_acesso },
    ages: { rows: [['Menos de 18', n(A.f0)], ['18 a 24', n(A.f1)], ['25 a 34', n(A.f2)], ['35 a 44', n(A.f3)], ['45 a 54', n(A.f4)], ['55 ou mais', n(A.f5)]].filter(([l, v]) => v > 0 || l !== 'Menos de 18'), informaram: n(A.informaram), total: n(A.total) },
  };
}

module.exports = { report, parseDays, parseSite, DAYS, SITES, SOURCE };
