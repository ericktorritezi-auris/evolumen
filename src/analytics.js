'use strict';
// EvoLumen Analytics (2.0.0): medição própria de acessos. Não guarda IP: só país, estado e cidade aproximados.
const db = require('./db');

const ID_RE = /^[A-Za-z0-9]{16,40}$/;
const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|facebot|preview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python-requests|httpclient|axios|go-http|java\/|okhttp|node-fetch|postman|insomnia|scrapy|whatsapp\/|telegrambot|discord|slack|embedly|bingpreview|yandex|baidu|semrush|ahrefs|mj12|dataforseo|petalbot|bytespider|gptbot|claudebot|perplexity|ccbot|applebot|duckduckbot/i;
const isBot = (ua) => !ua || ua.length < 12 || BOT_RE.test(ua);

// ---------- aparelho, navegador e sistema ----------
function parseUA(ua = '') {
  const tablet = /iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const mobile = !tablet && /Mobi|iPhone|iPod|Android/i.test(ua);
  const device = tablet ? 'tablet' : mobile ? 'celular' : 'computador';
  let browser = 'Outro';
  if (/Instagram/i.test(ua)) browser = 'Instagram (interno)';
  else if (/FBAN|FBAV|FB_IAB/i.test(ua)) browser = 'Facebook (interno)';
  else if (/TikTok|musical_ly|BytedanceWebview/i.test(ua)) browser = 'TikTok (interno)';
  else if (/EdgA?\/|Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /Linux|X11/i.test(ua) ? 'Linux' : 'Outro';
  return { device, browser, os };
}

// ---------- origem ----------
const HOSTS = [
  [/(^|\.)instagram\.com$/, 'instagram'], [/(^|\.)(facebook|fb)\.com$|(^|\.)fb\.me$/, 'facebook'], [/(^|\.)google\.[a-z.]+$/, 'google'],
  [/(^|\.)(bing|duckduckgo|yahoo|ecosia|brave)\.com$|(^|\.)search\.brave\.com$/, 'outras-buscas'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'whatsapp'], [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'], [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'x'], [/(^|\.)(t\.me|telegram\.org)$/, 'telegram'], [/(^|\.)pinterest\.[a-z.]+$/, 'pinterest'],
];
const PARAM = { instagram: 'instagram', ig: 'instagram', whatsapp: 'whatsapp', wa: 'whatsapp', facebook: 'facebook', fb: 'facebook', youtube: 'youtube', yt: 'youtube', google: 'google', email: 'email', 'e-mail': 'email', tiktok: 'tiktok', linkedin: 'linkedin', telegram: 'telegram', x: 'x', twitter: 'x', site: 'site' };
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
const sameFamily = (h, own) => own.some((o) => h === o || h.endsWith('.' + o) || o.endsWith('.' + h.split('.').slice(-3).join('.')));

// Origem da visita: parâmetro explícito (origem / utm_source), depois quem indicou, depois o navegador interno do aplicativo.
function classify({ ref = '', param = '', ua = '', ownHosts = [] }) {
  const p = PARAM[String(param || '').toLowerCase().trim()];
  if (p) return { source: p, referrerHost: hostOf(ref) || null };
  const h = hostOf(ref);
  if (h && !ownHosts.includes(h) && !sameFamily(h, ownHosts)) {
    for (const [re, name] of HOSTS) if (re.test(h)) return { source: name, referrerHost: h };
    return { source: 'outros-sites', referrerHost: h };
  }
  if (/Instagram/i.test(ua)) return { source: 'instagram', referrerHost: h || null };
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return { source: 'facebook', referrerHost: h || null };
  if (/TikTok|musical_ly/i.test(ua)) return { source: 'tiktok', referrerHost: h || null };
  return { source: 'direto', referrerHost: h || null };
}

// ---------- localização (base embutida; carrega sob demanda e nunca derruba a coleta) ----------
let geoLib; let geoFailed = false;
function geo(ip) {
  if (!ip || geoFailed) return {};
  try {
    geoLib = geoLib || require('geoip-lite');
    const r = geoLib.lookup(String(ip).replace(/^::ffff:/, ''));
    return r ? { country: r.country || null, region: r.region || null, city: r.city || null } : {};
  } catch { geoFailed = true; return {}; }
}

// ---------- entrada ----------
const cleanPath = (p) => {
  let s = String(p || '').split('?')[0].split('#')[0].slice(0, 200);
  if (!s.startsWith('/')) return null;
  s = s.replace(/\/{2,}/g, '/'); if (s.length > 1) s = s.replace(/\/+$/, '');
  if (/^\/(admin|webhooks|ea)(\/|$)/.test(s)) return null;
  // Endereços que carregam um segredo (token, código, número do pedido) nunca são guardados com o segredo.
  s = s.replace(/^\/redefinir-senha\/[^/]+/, '/redefinir-senha/:token').replace(/^\/painel\/[^/]+/, '/painel/:token')
    .replace(/^\/pedido\/[^/]+/, '/pedido/:id').replace(/^\/certificado\/[^/]+/, '/certificado/:codigo')
    .replace(/^\/cupom\/[^/]+/, '/cupom/:codigo').replace(/^\/certificados\/[^/]+/, '/certificados/:codigo');
  return s;
};
const cleanCoupon = (c) => { const s = String(c || '').toUpperCase().trim(); return /^[A-Z0-9-]{3,24}$/.test(s) ? s : null; };

// Identificadores do visitante e da visita (cookies lidos no pedido), para ligar a compra ao funil.
function idsFrom(req) {
  const c = req.cookies || {};
  return [ID_RE.test(c.ea_v || '') ? c.ea_v : null, ID_RE.test(c.ea_s || '') ? c.ea_s : null];
}

// Grava uma visita de página. Devolve 'ok' ou o motivo de ter ignorado.
async function record(cfg, { v, s, p, r, q, h, ua, ip, site, userId }) {
  if (!ID_RE.test(v || '') || !ID_RE.test(s || '')) return 'id';
  if (isBot(ua)) return 'bot';
  const path = cleanPath(p); if (!path) return 'path';
  const own = [new URL(cfg.baseUrl).hostname, ...cfg.analytics.origins.map(hostOf)].filter(Boolean);
  const host = String(h || '').toLowerCase().slice(0, 120);
  if (!own.includes(host)) return 'host';
  const exists = (await db.q('SELECT visitor_id, pages FROM an_sessions WHERE id = $1', [s])).rows[0];
  if (exists && exists.visitor_id !== v) return 'id';
  if (exists && exists.pages >= 500) return 'limite'; // uma visita real não tem centenas de páginas
  const bump = () => db.q('UPDATE an_sessions SET last_at = now(), pages = pages + 1, exit_path = $2, user_id = COALESCE(user_id, $3) WHERE id = $1', [s, path, userId || null]);
  if (exists) {
    await bump();
  } else {
    const vis = (await db.q(`INSERT INTO an_visitors (visitor_id) VALUES ($1)
      ON CONFLICT (visitor_id) DO UPDATE SET last_seen = now(), sessions = an_visitors.sessions + 1 RETURNING (xmax = 0) AS inserted`, [v])).rows[0];
    const { source, referrerHost } = classify({ ref: r, param: q && q.o, ua, ownHosts: own });
    const g = geo(ip); const d = parseUA(ua);
    const ins = await db.q(`INSERT INTO an_sessions (id, visitor_id, site, source, referrer_host, coupon, entry_host, entry_path, exit_path, device, browser, os, country, region, city, is_new, user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING`,
    [s, v, site, source, referrerHost, cleanCoupon(q && q.c), host, path, d.device, d.browser, d.os, g.country || null, g.region || null, g.city || null, !!vis.inserted, userId || null]);
    if (!ins.rowCount) { // duas abas criaram a mesma visita ao mesmo tempo: conta só uma vez
      await db.q('UPDATE an_visitors SET sessions = GREATEST(sessions - 1, 1) WHERE visitor_id = $1', [v]);
      await bump();
    }
  }
  // O cupom do link vale para a visita inteira, mesmo quando só aparece numa página seguinte.
  if (q && cleanCoupon(q.c)) await db.q('UPDATE an_sessions SET coupon = COALESCE(coupon, $2) WHERE id = $1', [s, cleanCoupon(q.c)]);
  await db.q('INSERT INTO an_pageviews (session_id, visitor_id, site, host, path) VALUES ($1,$2,$3,$4,$5)', [s, v, site, host, path]);
  await db.q('UPDATE an_visitors SET last_seen = now() WHERE visitor_id = $1', [v]);
  return 'ok';
}

// Limpeza (13 meses): antes de apagar, soma os dias antigos em an_daily para o histórico continuar.
async function purge(cfg, months = cfg.analytics.retentionMonths) {
  const cut = `(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - ($1 || ' months')::interval) AT TIME ZONE 'America/Sao_Paulo'`;
  await db.q(`INSERT INTO an_daily (day, site, visits, visitors, pageviews, new_visitors)
    SELECT d.day, d.site, COALESCE(s.visits,0), COALESCE(s.visitors,0), d.pageviews, COALESCE(s.new_visitors,0) FROM (
      SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, site, count(*)::int AS pageviews FROM an_pageviews WHERE created_at < ${cut} GROUP BY 1,2) d
    LEFT JOIN (SELECT (started_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, site, count(*)::int AS visits, count(DISTINCT visitor_id)::int AS visitors, count(*) FILTER (WHERE is_new)::int AS new_visitors
      FROM an_sessions WHERE started_at < ${cut} GROUP BY 1,2) s USING (day, site)
    ON CONFLICT (day, site) DO UPDATE SET visits = EXCLUDED.visits, visitors = EXCLUDED.visitors, pageviews = EXCLUDED.pageviews, new_visitors = EXCLUDED.new_visitors`, [String(months)]);
  const a = await db.q(`DELETE FROM an_pageviews WHERE created_at < ${cut}`, [String(months)]);
  const b = await db.q(`DELETE FROM an_sessions WHERE started_at < ${cut}`, [String(months)]);
  const c = await db.q(`DELETE FROM an_visitors WHERE last_seen < ${cut}`, [String(months)]);
  // O número do visitante também sai dos pedidos antigos (a compra em si fica).
  await db.q(`UPDATE orders SET visitor_id = NULL, session_id = NULL WHERE (visitor_id IS NOT NULL OR session_id IS NOT NULL) AND created_at < ${cut}`, [String(months)]);
  return { pageviews: a.rowCount, sessions: b.rowCount, visitors: c.rowCount };
}

// Resumo para a página de verificação da coleta.
async function check() {
  const one = async (sql) => (await db.q(sql)).rows[0];
  const today = await one(`SELECT (SELECT count(*)::int FROM an_pageviews WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')) AS pageviews,
    (SELECT count(*)::int FROM an_sessions WHERE started_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')) AS sessions,
    (SELECT count(DISTINCT visitor_id)::int FROM an_sessions WHERE started_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')) AS visitors,
    (SELECT count(*)::int FROM an_pageviews WHERE created_at >= now() - interval '7 days') AS pageviews7,
    (SELECT count(*)::int FROM an_sessions WHERE started_at >= now() - interval '7 days') AS sessions7`);
  const last = (await db.q(`SELECT started_at, site, source, entry_path, pages, device, browser, country, region, city, is_new, coupon FROM an_sessions ORDER BY started_at DESC LIMIT 20`)).rows;
  return { today, last };
}

module.exports = { ID_RE, isBot, parseUA, classify, geo, cleanPath, cleanCoupon, idsFrom, record, purge, check, hostOf };
