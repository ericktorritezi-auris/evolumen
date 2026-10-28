'use strict';
// Cockpit financeiro (0.5.2). Só leitura. Regras:
//  - A venda conta no mês (dia) da APROVAÇÃO do pagamento; a devolução conta na data em que foi devolvida.
//  - Receita líquida = receita bruta das vendas do período − valor devolvido no período.
//  - Churn = (reembolsos + chargebacks + não renovações) ÷ (novas compras + renovações + não renovações).
//    "Não renovação" = matrícula comprada cujo prazo venceu dentro do período e não foi renovada. Prazos que ainda não chegaram não contam.
//  - Efetividade = 100% − churn.
//  - Conclusão = data de emissão do certificado.
const db = require('./db');

const TZ = 'America/Sao_Paulo';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRESETS = { mes: 'Este mês', '30d': 'Últimos 30 dias', '90d': 'Últimos 90 dias', ano: 'Este ano', custom: 'Período livre' };

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const validDate = (s) => DATE.test(String(s || '')) && Number(String(s).slice(0, 4)) >= 2000 && Number(String(s).slice(0, 4)) <= 2100 && !Number.isNaN(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;

// Converte os filtros da tela em datas (início e fim inclusivos, em horário de Brasília).
function period(q, now = new Date()) {
  const today = ymd(now);
  let key = Object.hasOwn(PRESETS, q.periodo) ? q.periodo : 'mes';
  let from; let to = today;
  if (key === 'mes') from = today.slice(0, 8) + '01';
  else if (key === '30d') from = addDays(today, -29);
  else if (key === '90d') from = addDays(today, -89);
  else if (key === 'ano') from = today.slice(0, 4) + '-01-01';
  else {
    if (validDate(q.de) && validDate(q.ate)) { from = q.de; to = q.ate; } else { key = 'mes'; from = today.slice(0, 8) + '01'; }
    if (from > to) { const t = from; from = to; to = t; }
    if (Date.parse(to) - Date.parse(from) > 800 * 86400000) from = addDays(to, -799);
  }
  return { key, from, to, label: PRESETS[key] };
}

async function summary({ from, to }, courseId, now = new Date()) {
  const cid = courseId || null;
  const base = [from, to, cid];
  // início e fim (exclusivo) em horário de Brasília
  const S = "($1::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'";
  const E = "(($2::date) + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'";
  const money = 'COALESCE(o.paid_cents, o.price_cents)';
  const crs = 'AND ($3::bigint IS NULL OR o.course_id = $3::bigint)';

  const sales = (await db.q(`SELECT count(*)::int AS n, COALESCE(sum(${money}),0)::bigint AS gross,
      count(*) FILTER (WHERE o.kind = 'purchase')::int AS news, count(*) FILTER (WHERE o.kind = 'renewal')::int AS renewals,
      count(*) FILTER (WHERE o.price_source = 'coupon')::int AS with_coupon
    FROM orders o WHERE o.approved_at >= ${S} AND o.approved_at < ${E} ${crs}`, base)).rows[0];

  const refunds = (await db.q(`SELECT count(*)::int AS n, COALESCE(sum(${money}),0)::bigint AS value,
      count(*) FILTER (WHERE o.status = 'refunded')::int AS refunded, count(*) FILTER (WHERE o.status = 'charged_back')::int AS charged_back
    FROM orders o WHERE o.status IN ('refunded','charged_back') AND o.refunded_at >= ${S} AND o.refunded_at < ${E} ${crs}`, base)).rows[0];

  // Matrículas compradas que venceram no período e continuam com a mesma data (não foram renovadas). Só até agora.
  const non = (await db.q(`SELECT count(*)::int AS n FROM enrollments e
    WHERE e.origin = 'purchase' AND e.status = 'active' AND e.expires_at IS NOT NULL AND e.expires_at >= ${S} AND e.expires_at < LEAST(${E}, $4::timestamptz)
      AND ($3::bigint IS NULL OR e.course_id = $3::bigint)`, [...base, now.toISOString()])).rows[0].n;

  const certs = (await db.q(`SELECT count(*)::int AS n FROM certificates ce
    WHERE ce.issued_at >= ${S} AND ce.issued_at < ${E} AND ($3::bigint IS NULL OR ce.course_id = $3::bigint)`, base)).rows[0].n;

  const byCourse = (await db.q(`SELECT c.id, c.title,
      count(*) FILTER (WHERE o.approved_at >= ${S} AND o.approved_at < ${E})::int AS sales,
      COALESCE(sum(${money}) FILTER (WHERE o.approved_at >= ${S} AND o.approved_at < ${E}),0)::bigint AS gross,
      count(*) FILTER (WHERE o.status IN ('refunded','charged_back') AND o.refunded_at >= ${S} AND o.refunded_at < ${E})::int AS refunds,
      COALESCE(sum(${money}) FILTER (WHERE o.status IN ('refunded','charged_back') AND o.refunded_at >= ${S} AND o.refunded_at < ${E}),0)::bigint AS refunded_value
    FROM orders o JOIN courses c ON c.id = o.course_id
    WHERE ((o.approved_at >= ${S} AND o.approved_at < ${E}) OR (o.refunded_at >= ${S} AND o.refunded_at < ${E})) ${crs}
    GROUP BY c.id, c.title ORDER BY gross DESC, c.title`, base)).rows;

  const byMethod = (await db.q(`SELECT o.method, count(*)::int AS n, COALESCE(sum(${money}),0)::bigint AS gross
    FROM orders o WHERE o.approved_at >= ${S} AND o.approved_at < ${E} ${crs} GROUP BY o.method ORDER BY o.method`, base)).rows;

  // Série para o gráfico: por dia (períodos de até 45 dias) ou por mês.
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const unit = days <= 45 ? 'day' : 'month';
  const bucket = (col) => `date_trunc('${unit}', ${col} AT TIME ZONE 'America/Sao_Paulo')::date`;
  const g = (await db.q(`SELECT to_char(${bucket('o.approved_at')}, 'YYYY-MM-DD') AS d, COALESCE(sum(${money}),0)::bigint AS v
    FROM orders o WHERE o.approved_at >= ${S} AND o.approved_at < ${E} ${crs} GROUP BY 1`, base)).rows;
  const r = (await db.q(`SELECT to_char(${bucket('o.refunded_at')}, 'YYYY-MM-DD') AS d, COALESCE(sum(${money}),0)::bigint AS v
    FROM orders o WHERE o.status IN ('refunded','charged_back') AND o.refunded_at >= ${S} AND o.refunded_at < ${E} ${crs} GROUP BY 1`, base)).rows;
  const gm = Object.fromEntries(g.map((x) => [x.d, Number(x.v)])); const rm = Object.fromEntries(r.map((x) => [x.d, Number(x.v)]));
  const series = [];
  if (unit === 'day') { for (let d = from; d <= to; d = addDays(d, 1)) series.push({ key: d, gross: gm[d] || 0, refunds: rm[d] || 0 }); }
  else {
    let y = Number(from.slice(0, 4)); let m = Number(from.slice(5, 7));
    const endKey = to.slice(0, 7);
    for (;;) { const k = `${y}-${String(m).padStart(2, '0')}`; if (k > endKey) break; series.push({ key: k + '-01', gross: gm[k + '-01'] || 0, refunds: rm[k + '-01'] || 0 }); m += 1; if (m > 12) { m = 1; y += 1; } }
  }

  const gross = Number(sales.gross); const refundValue = Number(refunds.value);
  const lost = refunds.n + non;
  const base2 = sales.news + sales.renewals + non;
  const churn = base2 > 0 ? Math.min(100, (lost / base2) * 100) : null;
  return {
    sales: { n: sales.n, gross, news: sales.news, renewals: sales.renewals, withCoupon: sales.with_coupon, avgTicket: sales.n ? Math.round(gross / sales.n) : 0 },
    refunds: { n: refunds.n, value: refundValue, refunded: refunds.refunded, chargedBack: refunds.charged_back },
    net: gross - refundValue, nonRenewals: non, lost, base: base2,
    churn, effectiveness: churn == null ? null : 100 - churn,
    certificates: certs, byCourse: byCourse.map((x) => ({ ...x, gross: Number(x.gross), refunded_value: Number(x.refunded_value), net: Number(x.gross) - Number(x.refunded_value) })),
    byMethod: byMethod.map((x) => ({ ...x, gross: Number(x.gross) })), series, unit,
  };
}

module.exports = { period, summary, PRESETS, validDate, addDays, ymd };
