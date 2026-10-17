'use strict';
// Sessões no banco, token CSRF e utilitários de segurança.
const crypto = require('crypto');
const db = require('./db');

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const rand = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignora cookie inválido */ }
  }
  return out;
}

function cookieOpts(cfg, maxAgeMs) {
  return { httpOnly: true, sameSite: 'lax', secure: cfg.secureCookies, path: '/', maxAge: maxAgeMs };
}

// Carrega cookies, o identificador anônimo (para o formulário de login) e a sessão, se houver.
function sessionMiddleware(cfg) {
  return async (req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    let anon = req.cookies.evl_a;
    if (!anon || !/^[A-Za-z0-9_-]{20,64}$/.test(anon)) {
      anon = rand(24);
      // Só páginas HTML criam o identificador: pedidos paralelos do navegador (ícone, etc.) não podem trocá-lo.
      if (req.method === 'GET' && /text\/html/.test(req.get('accept') || '')) res.cookie('evl_a', anon, cookieOpts(cfg, 365 * 864e5));
      else if (req.method !== 'GET') res.cookie('evl_a', anon, cookieOpts(cfg, 365 * 864e5));
    }
    req.anonId = anon;
    req.user = null;
    req.sessionId = null;
    const sid = req.cookies.evl_sid;
    if (sid && /^[A-Za-z0-9_-]{30,64}$/.test(sid)) {
      const idHash = sha256(sid);
      const r = await db.q(
        `SELECT s.id_hash, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id_hash = $1 AND s.expires_at > now()
           AND s.last_seen_at > now() - ($2 || ' days')::interval AND u.status = 'active'`,
        [idHash, String(cfg.sessionIdleDays)]);
      if (r.rowCount) {
        const row = r.rows[0];
        req.user = row; req.sessionId = sid;
        if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60 * 1000) {
          db.q('UPDATE sessions SET last_seen_at = now() WHERE id_hash = $1', [idHash]).catch(() => {});
        }
      } else {
        res.clearCookie('evl_sid', { path: '/' });
      }
    }
    next();
  };
}

async function createSession(cfg, req, res, userId) {
  const sid = rand(32);
  await db.q(
    `INSERT INTO sessions (id_hash, user_id, expires_at, ip, user_agent)
     VALUES ($1,$2, now() + ($3 || ' days')::interval, $4, $5)`,
    [sha256(sid), userId, String(cfg.sessionDays), req.ip || null, (req.get('user-agent') || '').slice(0, 300)]);
  res.cookie('evl_sid', sid, cookieOpts(cfg, cfg.sessionDays * 864e5));
  return sid;
}

async function destroySession(req, res) {
  if (req.sessionId) await db.q('DELETE FROM sessions WHERE id_hash = $1', [sha256(req.sessionId)]);
  res.clearCookie('evl_sid', { path: '/' });
}

async function destroyOtherSessions(userId, keepSid) {
  await db.q('DELETE FROM sessions WHERE user_id = $1 AND id_hash <> $2', [userId, keepSid ? sha256(keepSid) : '']);
}

function csrfFor(cfg, req) {
  return crypto.createHmac('sha256', cfg.sessionSecret).update('csrf:' + (req.sessionId || req.anonId)).digest('hex');
}

// Envios de arquivo (multipart) só são aceitos nestas rotas; lá o token é conferido depois que o corpo é lido.
const MULTIPART_OK = /^\/admin\/(cursos\/\d+\/capa|aulas\/\d+\/arquivos)$/;

function tokenOk(req, got) {
  got = String(got || '');
  return got.length === req.csrf.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(req.csrf));
}
const csrfError = () => { const e = new Error('Sua sessão expirou ou o formulário é inválido. Volte e tente de novo.'); e.status = 403; e.expose = true; return e; };

function csrfMiddleware(cfg) {
  const origin = new URL(cfg.baseUrl).origin;
  return (req, res, next) => {
    req.csrf = csrfFor(cfg, req);
    res.locals.csrf = req.csrf;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const o = req.get('origin');
    let originOk = true;
    if (o && o !== 'null') { try { const u = new URL(o); originOk = u.origin === origin || u.host === req.get('host'); } catch { originOk = false; } }
    if (!originOk) return next(csrfError());
    if (/^multipart\/form-data/i.test(req.get('content-type') || '')) {
      if (!MULTIPART_OK.test(req.path)) return next(csrfError());
      req.csrfDeferred = true;
      return next();
    }
    if (!tokenOk(req, req.body && req.body._csrf)) return next(csrfError());
    next();
  };
}
// Para rotas de upload: roda depois do multer.
function requireCsrf(req, res, next) {
  if (req.csrfDeferred && !tokenOk(req, req.body && req.body._csrf)) return next(csrfError());
  next();
}

function newToken() { const raw = rand(32); return { raw, hash: sha256(raw) }; }
function newCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
function hashCode(userId, code) { return sha256(`code:${userId}:${code}`); }
function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { sha256, rand, sessionMiddleware, createSession, destroySession, destroyOtherSessions, csrfMiddleware, requireCsrf, csrfFor, newToken, newCode, hashCode, safeEqual };
