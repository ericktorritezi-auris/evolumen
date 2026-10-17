'use strict';
// Regras de cursos: validação do cadastro, formatação e consultas usadas pelas telas.
const db = require('./db');

const LEVELS = { iniciante: 'Iniciante', intermediario: 'Intermediário', avancado: 'Avançado' };

// ---- formatação ----
const brl = (cents) => (cents == null ? '' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const brlInput = (cents) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));
function parseMoney(v) {
  let s = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return { empty: true };
  if (/,/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return { error: true };
  const cents = Math.round(Number(s) * 100);
  if (cents > 10000000) return { error: true };
  return { cents };
}
const slugify = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function youtubeId(v) {
  const s = String(v || '').trim();
  if (!s) return { empty: true };
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return { id: s };
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?]+)/); if (m) id = m[2]; }
    }
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return { id };
  } catch { /* cai no erro abaixo */ }
  return { error: true };
}

const lines = (v, max, len) => String(v || '').split(/\r?\n/).map((x) => x.trim().slice(0, len)).filter(Boolean).slice(0, max);
const dateOnly = (v) => {
  const x = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return null;
  const d = new Date(x + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x ? x : null;
};

// Valida o formulário do curso. Devolve { errors, values } com os valores prontos para o banco.
function parseCourse(b) {
  const errors = {};
  const clip = (v, n) => String(v || '').trim().slice(0, n);
  const title = clip(b.title, 120).replace(/\s+/g, ' ');
  if (title.length < 3) errors.title = 'Informe o nome do curso (mínimo 3 letras).';
  let slug = clip(b.slug, 80).toLowerCase() || slugify(title);
  if (!SLUG_RE.test(slug) || slug.length < 3) errors.slug = 'Use só letras minúsculas, números e hífen. Ex.: protocolo-essencia.';
  const level = Object.keys(LEVELS).includes(b.level) ? b.level : 'iniciante';

  const price = parseMoney(b.price);
  if (price.error || price.empty) errors.price = 'Informe o valor. Ex.: 197,00. Use 0 para curso gratuito.';
  const promo = parseMoney(b.promo_price);
  if (promo.error) errors.promo_price = 'Valor inválido. Ex.: 147,00.';
  if (!promo.error && !promo.empty && !price.error && !price.empty && promo.cents >= price.cents) errors.promo_price = 'O preço promocional precisa ser menor que o valor normal.';
  const promoUntil = clip(b.promo_until, 10) ? dateOnly(b.promo_until) : null;
  if (clip(b.promo_until, 10) && !promoUntil) errors.promo_until = 'Data inválida.';

  const accessType = b.access_type === 'months' ? 'months' : 'lifetime';
  let months = null;
  if (accessType === 'months') {
    months = Number(b.access_months);
    if (!Number.isInteger(months) || months < 1 || months > 120) errors.access_months = 'Informe de 1 a 120 meses.';
  }
  const renewal = parseMoney(b.renewal_price);
  if (renewal.error) errors.renewal_price = 'Valor inválido. Ex.: 97,00.';

  const noticeRaw = clip(b.expiry_notice_days, 40) || '30,7,1';
  const days = noticeRaw.split(/[,\s;]+/).filter(Boolean).map(Number);
  if (!days.length || days.length > 5 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 365)) errors.expiry_notice_days = 'Use dias separados por vírgula, de 1 a 365. Ex.: 30, 7, 1.';

  const intro = youtubeId(b.intro_video);
  if (intro.error) errors.intro_video = 'Link do YouTube inválido.';
  const hours = clip(b.workload_hours, 5);
  let workload = null;
  if (hours) { workload = Number(hours); if (!Number.isInteger(workload) || workload < 1 || workload > 2000) errors.workload_hours = 'Informe horas inteiras (1 a 2000).'; }
  const inst = Number(b.max_installments || 12);
  if (!Number.isInteger(inst) || inst < 1 || inst > 12) errors.max_installments = 'De 1 a 12 parcelas.';
  const order = Number(b.sort_order || 100);
  if (!Number.isInteger(order) || order < 1 || order > 9999) errors.sort_order = 'Número de 1 a 9999.';

  const faq = [];
  for (let i = 1; i <= 5; i++) {
    const q = clip(b[`faq_q${i}`], 200); const a = clip(b[`faq_a${i}`], 1200);
    if (q && a) faq.push({ q, a });
    else if (q || a) errors[`faq${i}`] = 'Preencha a pergunta e a resposta, ou deixe as duas vazias.';
  }
  const publish = b.publish === '1';
  const pubDate = clip(b.published_at, 10) ? dateOnly(b.published_at) : null;
  if (clip(b.published_at, 10) && !pubDate) errors.published_at = 'Data inválida.';

  return {
    errors,
    values: {
      slug, title, summary: clip(b.summary, 240), description: clip(b.description, 6000),
      target_audience: clip(b.target_audience, 600), prerequisites: clip(b.prerequisites, 600), level, category: clip(b.category, 60),
      workload_hours: workload, learn_items: lines(b.learn_items, 12, 200), able_items: lines(b.able_items, 12, 200), faq,
      intro_youtube_id: intro.id || null,
      price_cents: price.cents ?? 0, promo_price_cents: promo.cents ?? null, promo_until: promoUntil,
      max_installments: inst, access_type: accessType, access_months: months,
      expiry_notice_days: days.join(','), renewal_price_cents: accessType === 'months' ? (renewal.cents ?? null) : null,
      sort_order: order, featured: b.featured === '1', publish, pubDate,
    },
  };
}

// Preço em vigor (promoção só vale se ainda não venceu).
function effectivePrice(c, now = new Date()) {
  const promoOn = c.promo_price_cents != null && (!c.promo_until || new Date(String(c.promo_until).slice(0, 10) + 'T23:59:59-03:00') >= now);
  return { cents: promoOn ? c.promo_price_cents : c.price_cents, original: promoOn ? c.price_cents : null };
}
const accessLabel = (c) => (c.access_type === 'lifetime' ? 'Vitalício' : c.access_months % 12 === 0 ? `${c.access_months / 12} ${c.access_months === 12 ? 'ano' : 'anos'}` : `${c.access_months} meses`);

// ---- consultas ----
const VISIBLE = "c.status = 'published' AND c.published_at IS NOT NULL AND c.published_at <= now()";

async function listPublic() {
  const r = await db.q(`
    SELECT c.*, (SELECT count(*)::int FROM lessons l WHERE l.course_id = c.id AND l.youtube_id IS NOT NULL) AS videos,
           (SELECT count(*)::int FROM lesson_files lf JOIN lessons l ON l.id = lf.lesson_id WHERE l.course_id = c.id) AS materials
    FROM courses c WHERE ${VISIBLE}
    ORDER BY c.featured DESC, c.sort_order, c.published_at DESC, c.id`);
  return r.rows;
}

async function bySlug(slug, { includeDrafts = false } = {}) {
  const r = await db.q(`SELECT c.* FROM courses c WHERE c.slug = $1 ${includeDrafts ? '' : 'AND ' + VISIBLE}`, [slug]);
  return r.rows[0] || null;
}
async function byId(id) {
  if (!/^\d{1,12}$/.test(String(id))) return null;
  return (await db.q('SELECT * FROM courses WHERE id = $1', [id])).rows[0] || null;
}

// Módulos com aulas (e arquivos). Sem ids de vídeo quando `withVideo` é falso (páginas públicas).
async function curriculum(courseId, { withVideo = false, withFiles = false } = {}) {
  const mods = (await db.q('SELECT id, title, position FROM modules WHERE course_id = $1 ORDER BY position, id', [courseId])).rows;
  const les = (await db.q(`SELECT id, module_id, title, description, ${withVideo ? 'youtube_id' : '(youtube_id IS NOT NULL) AS has_video'}, duration_min, position
                           FROM lessons WHERE course_id = $1 ORDER BY position, id`, [courseId])).rows;
  let files = [];
  if (withFiles) files = (await db.q(`SELECT lf.id AS link_id, lf.lesson_id, lf.label, f.id AS file_id, f.filename, f.size_bytes
                                      FROM lesson_files lf JOIN files f ON f.id = lf.file_id JOIN lessons l ON l.id = lf.lesson_id
                                      WHERE l.course_id = $1 ORDER BY lf.position, lf.id`, [courseId])).rows;
  for (const l of les) l.files = files.filter((f) => f.lesson_id === l.id);
  return mods.map((m) => ({ ...m, lessons: les.filter((l) => l.module_id === m.id) }));
}

const flatLessons = (cur) => cur.flatMap((m) => m.lessons.map((l) => ({ ...l, module_title: m.title, module_position: m.position })));

// Acesso do usuário ao conteúdo: administrador sempre; aluno só com matrícula vigente.
async function accessFor(user, courseId) {
  if (user.role === 'admin') return { ok: true, admin: true, expires_at: null };
  const r = await db.q('SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND starts_at <= now() AND (expires_at IS NULL OR expires_at > now())', [user.id, courseId]);
  return r.rowCount ? { ok: true, admin: false, expires_at: r.rows[0].expires_at } : { ok: false };
}
async function enrollmentState(userId, courseId) {
  const r = await db.q('SELECT *, (expires_at IS NOT NULL AND expires_at <= now()) AS expired FROM enrollments WHERE user_id = $1 AND course_id = $2', [userId, courseId]);
  return r.rows[0] || null;
}

async function progressFor(userId, courseId) {
  const total = (await db.q('SELECT count(*)::int n FROM lessons WHERE course_id = $1', [courseId])).rows[0].n;
  const done = (await db.q('SELECT lesson_id FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = $1 AND l.course_id = $2', [userId, courseId])).rows.map((x) => x.lesson_id);
  return { total, done: new Set(done.map(String)), count: done.length, pct: total ? Math.floor((done.length / total) * 100) : 0 };
}

async function myCourses(userId) {
  const r = await db.q(`
    SELECT c.id, c.slug, c.title, c.summary, c.cover_file_id, e.expires_at,
           (SELECT count(*)::int FROM lessons l WHERE l.course_id = c.id) AS total,
           (SELECT count(*)::int FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = e.user_id AND l.course_id = c.id) AS done
    FROM enrollments e JOIN courses c ON c.id = e.course_id
    WHERE e.user_id = $1 AND e.starts_at <= now() AND (e.expires_at IS NULL OR e.expires_at > now())
    ORDER BY e.created_at DESC`, [userId]);
  return r.rows.map((x) => ({ ...x, pct: x.total ? Math.floor((x.done / x.total) * 100) : 0 }));
}

module.exports = { dateOnly, LEVELS, brl, brlInput, parseMoney, slugify, SLUG_RE, youtubeId, parseCourse, effectivePrice, accessLabel, listPublic, bySlug, byId, curriculum, flatLessons, accessFor, enrollmentState, progressFor, myCourses, VISIBLE };
