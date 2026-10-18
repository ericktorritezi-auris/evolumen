'use strict';
// Arquivos guardados no Postgres: validação por tipo real (assinatura do arquivo), tamanho e nome.
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const db = require('./db');

const MB = 1024 * 1024;
const MAX_DOC = 20 * MB;
const MAX_COVER = 3 * MB;

const DOC_TYPES = {
  '.pdf': { mime: 'application/pdf', sig: [Buffer.from('%PDF')] },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sig: [Buffer.from([0x50, 0x4b, 0x03, 0x04])] },
  '.doc': { mime: 'application/msword', sig: [Buffer.from([0xd0, 0xcf, 0x11, 0xe0])] },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sig: [Buffer.from([0x50, 0x4b, 0x03, 0x04])] },
  '.xls': { mime: 'application/vnd.ms-excel', sig: [Buffer.from([0xd0, 0xcf, 0x11, 0xe0])] },
};
const IMG_TYPES = {
  '.png': { mime: 'image/png', sig: [Buffer.from([0x89, 0x50, 0x4e, 0x47])] },
  '.jpg': { mime: 'image/jpeg', sig: [Buffer.from([0xff, 0xd8, 0xff])] },
  '.jpeg': { mime: 'image/jpeg', sig: [Buffer.from([0xff, 0xd8, 0xff])] },
  '.webp': { mime: 'image/webp', sig: [Buffer.from('RIFF')], extra: (b) => b.length > 12 && b.slice(8, 12).toString() === 'WEBP' },
};

class UploadError extends Error { constructor(msg, status = 422) { super(msg); this.status = status; this.expose = true; } }

function cleanName(name) {
  // O navegador pode mandar o nome em latin1; recupera acentos e remove caminho e caracteres de controle.
  let n = String(name || '');
  try { const u = Buffer.from(n, 'latin1').toString('utf8'); if (!u.includes('�')) n = u; } catch { /* mantém */ }
  n = path.basename(n.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim();
  return n.slice(0, 150) || 'arquivo';
}

// Confere extensão, assinatura e tamanho. Devolve { filename, mime, buffer }.
function validate(file, kind) {
  if (!file || !file.buffer || !file.buffer.length) throw new UploadError('Escolha um arquivo para enviar.');
  const table = kind === 'cover' ? IMG_TYPES : DOC_TYPES;
  const max = kind === 'cover' ? MAX_COVER : MAX_DOC;
  const filename = cleanName(file.originalname);
  const ext = path.extname(filename).toLowerCase();
  const def = table[ext];
  const allowed = kind === 'cover' ? 'PNG, JPG ou WEBP' : 'PDF, DOC, DOCX, XLS ou XLSX';
  if (!def) throw new UploadError(`Tipo de arquivo não permitido. Envie ${allowed}.`);
  if (file.buffer.length > max) throw new UploadError(`O arquivo passa de ${max / MB} MB.`, 413);
  const okSig = def.sig.some((s) => file.buffer.slice(0, s.length).equals(s)) && (!def.extra || def.extra(file.buffer));
  if (!okSig) throw new UploadError(`O conteúdo não confere com o tipo ${ext.slice(1).toUpperCase()}. Envie ${allowed}.`);
  return { filename, mime: def.mime, buffer: file.buffer };
}

async function store(client, { kind, filename, mime, buffer, userId }) {
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const r = await client.query(
    'INSERT INTO files (kind, filename, mime, size_bytes, sha256, data, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [kind, filename, mime, buffer.length, sha, buffer, userId || null]);
  return r.rows[0].id;
}

// Recebe um único campo "arquivo". Erros do multer viram mensagens em português.
const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DOC, files: 1, fields: 20, parts: 24 } }).single('arquivo');
function receive(req, res, next) {
  uploader(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new UploadError('O arquivo passa de 20 MB.', 413));
    return next(new UploadError('Não foi possível receber o arquivo. Tente de novo.', 400));
  });
}

async function get(id) {
  const r = await db.q('SELECT id, kind, filename, mime, size_bytes, data FROM files WHERE id = $1', [id]);
  return r.rows[0] || null;
}

const humanSize = (n) => (n >= MB ? `${(n / MB).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

module.exports = { validate, store, receive, get, humanSize, UploadError, MAX_DOC, MAX_COVER, DOC_TYPES, IMG_TYPES };
