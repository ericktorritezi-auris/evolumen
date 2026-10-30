'use strict';
// Cupons de desconto: regras, link, QR Code e imagem (arte) do cupom.
// Esta fase só cadastra e divulga os cupons. O desconto é aplicado no pagamento (Fase 4), e o cupom
// substitui o preço promocional: nunca se soma a ele. Cupom não zera o preço (existe a cortesia para isso).
const crypto = require('crypto');
const path = require('path');
const QRCode = require('qrcode');
const db = require('./db');
const C = require('./courses');
const AFF = require('./affiliates');

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,19}$/;
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const fmt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

function generateCode() {
  let s = ''; for (let i = 0; i < 6; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return 'EVO-' + s;
}

const asList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(String).filter((x) => /^\d{1,12}$/.test(x));

// Valida o formulário. `locked` = o valor do desconto não pode mudar (cupom já enviado ou usado).
async function parse(b, { locked = null, lockedAff = null } = {}) {
  const errors = {};
  const v = {};
  const rawCode = String(b.code || '').trim().toUpperCase();
  v.code = rawCode || null;
  if (v.code && !CODE_RE.test(v.code)) errors.code = 'Use de 3 a 20 letras maiúsculas, números ou hífen, sem espaços.';

  if (locked) { v.kind = locked.kind; v.percent = locked.percent; v.amount_cents = locked.amount_cents; }
  else {
    v.kind = b.kind === 'fixed' ? 'fixed' : 'percent';
    if (v.kind === 'percent') {
      const p = Number(String(b.percent || '').trim());
      if (!Number.isInteger(p) || p < 1 || p > 99) errors.percent = 'Informe um percentual inteiro de 1 a 99. Para 100% use a cortesia.';
      v.percent = p; v.amount_cents = null;
    } else {
      const m = C.parseMoney(b.amount);
      if (m.error || m.empty || !(m.cents > 0)) errors.amount = 'Informe um valor em reais maior que zero, como 50,00.';
      v.amount_cents = m.cents; v.percent = null;
    }
  }
  v.starts_on = String(b.starts_on || '').trim() || null;
  v.ends_on = String(b.ends_on || '').trim() || null;
  if (v.starts_on && !C.dateOnly(v.starts_on)) errors.starts_on = 'Data inválida.';
  if (v.ends_on && !C.dateOnly(v.ends_on)) errors.ends_on = 'Data inválida.';
  if (!errors.starts_on && !errors.ends_on && v.starts_on && v.ends_on && v.ends_on < v.starts_on) errors.ends_on = 'O fim não pode ser antes do início.';
  const mu = String(b.max_uses || '').trim();
  if (mu) {
    const n = Number(mu);
    if (!Number.isInteger(n) || n < 1 || n > 1000000) errors.max_uses = 'Informe um número inteiro de usos, a partir de 1.';
    v.max_uses = n;
  } else v.max_uses = null;
  if (!v.starts_on && !v.ends_on && !v.max_uses && !errors.max_uses) errors.limit = 'Defina um período, uma quantidade de usos, ou os dois.';
  v.note = String(b.note || '').trim().slice(0, 300);
  // Afiliado e comissão: andam juntos. Depois da primeira venda não mudam mais (a comissão já foi gravada com este percentual).
  if (lockedAff) { v.affiliate_id = lockedAff.affiliate_id; v.commission_pct = lockedAff.commission_pct; }
  else {
    const aid = String(b.affiliate_id || '').trim();
    const pctRaw = String(b.commission_pct || '').trim();
    v.affiliate_id = null; v.commission_pct = null;
    if (aid) {
      const af = /^\d{1,12}$/.test(aid) ? await AFF.byId(aid) : null;
      if (!af) errors.affiliate_id = 'Afiliado não encontrado.';
      else if (af.status !== 'active' && String(b.affiliate_keep || '') !== aid) errors.affiliate_id = 'Este afiliado está inativo. Reative-o ou escolha outro.';
      else v.affiliate_id = af.id;
      const pct = AFF.parsePct(pctRaw);
      if (pct == null) errors.commission_pct = 'Informe o percentual da comissão, de 0,01 a 100. Ex.: 10 ou 12,5.';
      else v.commission_pct = pct;
    } else if (pctRaw) errors.affiliate_id = 'Escolha o afiliado deste cupom ou deixe o percentual vazio.';
  }
  v.courses = [...new Set(asList(b.courses))];
  if (!v.courses.length) errors.courses = 'Escolha pelo menos um curso.';
  else {
    const rows = (await db.q('SELECT id, title, price_cents FROM courses WHERE id = ANY($1::bigint[])', [v.courses])).rows;
    if (rows.length !== v.courses.length) errors.courses = 'Um dos cursos escolhidos não existe mais.';
    else if (v.kind === 'fixed' && v.amount_cents) {
      const low = rows.filter((c) => c.price_cents <= v.amount_cents);
      if (low.length) errors.amount = `O desconto precisa ser menor que o valor do curso (${low.map((c) => c.title).join(', ')}).`;
    }
  }
  return { errors, values: v };
}

// Situação do cupom agora: active | inactive | scheduled | expired | exhausted
function stateOf(c, uses = 0, now = today()) {
  if (c.status === 'inactive') return 'inactive';
  if (c.starts_on && now < String(c.starts_on).slice(0, 10)) return 'scheduled';
  if (c.ends_on && now > String(c.ends_on).slice(0, 10)) return 'expired';
  if (c.max_uses && uses >= c.max_uses) return 'exhausted';
  return 'active';
}
const STATE_LABEL = { active: 'Ativo', inactive: 'Inativo', scheduled: 'Agendado', expired: 'Vencido', exhausted: 'Esgotado' };

const discountLabel = (c) => (c.kind === 'percent' ? `${c.percent}%` : C.brl(c.amount_cents));
function validityLabel(c) {
  const parts = [];
  if (c.starts_on && c.ends_on) parts.push(`Válido de ${fmt(c.starts_on)} a ${fmt(c.ends_on)}`);
  else if (c.ends_on) parts.push(`Válido até ${fmt(c.ends_on)}`);
  else if (c.starts_on) parts.push(`Válido a partir de ${fmt(c.starts_on)}`);
  if (c.max_uses) parts.push(`${c.max_uses} ${c.max_uses === 1 ? 'uso' : 'usos'}`);
  return parts.join(' · ');
}

// Preço com cupom: vale sobre o valor normal do curso (substitui a promoção). Devolve null se não houver desconto válido.
function priceWith(c, course) {
  const base = course.price_cents;
  const cents = c.kind === 'percent' ? Math.round((base * (100 - c.percent)) / 100) : base - c.amount_cents;
  if (!(cents > 0) || cents >= base) return null;
  return { cents, original: base, off: base - cents };
}

const withUses = `SELECT c.*, (SELECT count(*)::int FROM coupon_redemptions r WHERE r.coupon_id = c.id) AS uses,
  (SELECT count(*)::int FROM coupon_sends s WHERE s.coupon_id = c.id) AS sends,
  (SELECT count(*)::int FROM commissions m WHERE m.coupon_id = c.id) AS commissions,
  (SELECT f.name FROM affiliates f WHERE f.id = c.affiliate_id) AS affiliate_name,
  (SELECT COALESCE(json_agg(json_build_object('id', x.id, 'title', x.title, 'slug', x.slug, 'price_cents', x.price_cents) ORDER BY x.title), '[]'::json)
     FROM coupon_courses cc JOIN courses x ON x.id = cc.course_id WHERE cc.coupon_id = c.id) AS courses
  FROM coupons c`;
const list = async () => (await db.q(`${withUses} ORDER BY c.created_at DESC, c.id DESC`)).rows;
const byId = async (id) => (/^\d{1,12}$/.test(String(id)) ? (await db.q(`${withUses} WHERE c.id = $1`, [id])).rows[0] || null : null);
const byCode = async (code) => (CODE_RE.test(String(code || '').toUpperCase()) ? (await db.q(`${withUses} WHERE upper(c.code) = $1`, [String(code).toUpperCase()])).rows[0] || null : null);

// O que as páginas públicas mostram quando chega ?cupom=CODIGO. Nunca revela dados internos do cupom.
async function publicView(code, course = null) {
  const c = await byCode(code);
  if (!c || stateOf(c, c.uses) !== 'active') return { invalid: true };
  if (course && !c.courses.some((x) => String(x.id) === String(course.id))) return { invalid: true };
  if (!course) {
    const vis = c.courses.length ? (await db.q("SELECT 1 FROM courses WHERE id = ANY($1::bigint[]) AND status = 'published' AND published_at IS NOT NULL AND published_at <= now() LIMIT 1", [c.courses.map((x) => x.id)])).rowCount : 0;
    if (!vis) return { invalid: true };
  }
  const pw = course ? priceWith(c, course) : null;
  const eff = course ? C.effectivePrice(course) : null;
  const promoCheaper = !!(pw && eff && eff.original != null && eff.cents <= pw.cents);
  return { code: c.code, label: discountLabel(c), price: course ? priceWith(c, course) : null, promoCheaper };
}

// Endereço que o QR Code e o e-mail abrem.
const linkFor = (cfg, c) => `${cfg.baseUrl}/cupom/${encodeURIComponent(c.code)}`;

// ---- imagem do cupom ----
const xml = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
function wrap(text, max, maxLines) {
  const words = String(text).split(/\s+/); const out = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] = out[maxLines - 1].replace(/\s*\S{0,3}$/, '') + '…'; }
  return out;
}

function qrPath(text, x0, y0, size) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size; const cell = size / n; let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (qr.modules.data[y * n + x]) d += `M${(x0 + x * cell).toFixed(2)} ${(y0 + y * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
  }
  return d;
}

function artSvg(cfg, c) {
  const W = 1080; const H = 1350;
  const big = c.kind === 'percent' ? `${c.percent}%` : C.brl(c.amount_cents).replace(/\s/g, ' ');
  const bigSize = big.length > 8 ? 130 : big.length > 5 ? 160 : 210;
  const courses = c.courses || [];
  const where = courses.length === 1 ? wrap(`Válido para: ${courses[0].title}`, 42, 2) : [`Válido em ${courses.length} cursos`];
  const validity = validityLabel(c);
  const qrSize = 340; const qx = (W - qrSize) / 2; const qy = 812;
  const host = String(cfg.baseUrl).replace(/^https?:\/\//, '');
  const T = (y, size, weight, fill, text, extra = '') => `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Quicksand" font-weight="${weight}" font-size="${size}" fill="${fill}" ${extra}>${text}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#121838"/><stop offset="1" stop-color="#0B0F26"/></linearGradient>
<radialGradient id="r" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFB257" stop-opacity="0.26"/><stop offset="1" stop-color="#FFB257" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>
<circle cx="${W / 2}" cy="330" r="400" fill="url(#r)"/>
<rect x="36" y="36" width="${W - 72}" height="${H - 72}" rx="44" fill="none" stroke="#A7AED6" stroke-opacity="0.28" stroke-width="2"/>
${T(125, 60, 500, '#EDEFFB', 'Evo<tspan font-weight="700" fill="#FFB257">Lumen</tspan>')}
${T(166, 22, 600, '#8E9BFF', 'ACADEMY', 'letter-spacing="10"')}
${T(246, 32, 700, '#A7AED6', 'CUPOM DE DESCONTO', 'letter-spacing="6"')}
${T(246 + 30 + bigSize * 0.78, bigSize, 700, '#FFB257', xml(big))}
${T(246 + 30 + bigSize * 0.78 + 62, 40, 700, '#EDEFFB', 'DE DESCONTO', 'letter-spacing="8"')}
${where.map((t, i) => T(246 + 30 + bigSize * 0.78 + 118 + i * 38, 29, 500, '#CBD0EE', xml(t))).join('')}
<rect x="200" y="656" width="680" height="104" rx="52" fill="#1A2147" stroke="#FFB257" stroke-width="3" stroke-dasharray="14 10"/>
${T(728, c.code.length > 12 ? 52 : 68, 700, '#FFFFFF', xml(c.code), 'letter-spacing="5"')}
<rect x="${qx - 24}" y="${qy - 24}" width="${qrSize + 48}" height="${qrSize + 48}" rx="28" fill="#FFFFFF"/>
<path d="${qrPath(linkFor(cfg, c), qx, qy, qrSize)}" fill="#0B0F26"/>
${T(qy + qrSize + 70, 27, 600, '#CBD0EE', 'Aponte a câmera para usar o cupom')}
${T(H - 94, 25, 500, '#A7AED6', xml(validity))}
${T(H - 58, 22, 500, '#A7AED6', xml(host))}
</svg>`;
}

let Resvg;
function artPng(cfg, c) {
  if (!Resvg) ({ Resvg } = require('@resvg/resvg-js'));
  const dir = path.join(__dirname, '..', 'assets', 'fonts');
  const r = new Resvg(artSvg(cfg, c), {
    font: { fontFiles: ['Quicksand_500Medium.ttf', 'Quicksand_600SemiBold.ttf', 'Quicksand_700Bold.ttf'].map((f) => path.join(dir, f)), loadSystemFonts: false, defaultFontFamily: 'Quicksand' },
  });
  return r.render().asPng();
}

module.exports = { CODE_RE, generateCode, parse, stateOf, STATE_LABEL, discountLabel, validityLabel, priceWith, list, byId, byCode, linkFor, publicView, artSvg, artPng, today, fmt };
