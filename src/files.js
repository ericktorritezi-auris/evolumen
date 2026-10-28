'use strict';
// Arquivos: no Postgres (até 20 MB) ou no volume do Railway (até 350 MB).
// O tipo real é conferido pela assinatura do arquivo (não só pela extensão).
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const db = require('./db');
const log = require('./logger');

const MB = 1024 * 1024;
const MAX_DB = 20 * MB;
const MAX_VOLUME = 350 * MB;
const MAX_DOC = MAX_DB; // compatibilidade
const MAX_COVER = 3 * MB;

const PK = [Buffer.from([0x50, 0x4b, 0x03, 0x04])];
const OLE = [Buffer.from([0xd0, 0xcf, 0x11, 0xe0])];
const DOC_TYPES = {
  '.pdf': { mime: 'application/pdf', sig: [Buffer.from('%PDF')] },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sig: PK },
  '.doc': { mime: 'application/msword', sig: OLE },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sig: PK },
  '.xls': { mime: 'application/vnd.ms-excel', sig: OLE },
};
const IMG_TYPES = {
  '.png': { mime: 'image/png', sig: [Buffer.from([0x89, 0x50, 0x4e, 0x47])] },
  '.jpg': { mime: 'image/jpeg', sig: [Buffer.from([0xff, 0xd8, 0xff])] },
  '.jpeg': { mime: 'image/jpeg', sig: [Buffer.from([0xff, 0xd8, 0xff])] },
  '.webp': { mime: 'image/webp', sig: [Buffer.from('RIFF')], extra: (b) => b.length >= 12 && b.slice(8, 12).toString() === 'WEBP' },
};
// Produtos digitais: e-books, ferramentas, áudios e pacotes.
const PRODUCT_TYPES = {
  ...DOC_TYPES,
  '.pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sig: PK },
  '.epub': { mime: 'application/epub+zip', sig: PK },
  '.zip': { mime: 'application/zip', sig: PK },
  '.mp3': { mime: 'audio/mpeg', sig: [], extra: (b) => b.slice(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  '.m4a': { mime: 'audio/mp4', sig: [], extra: (b) => b.length >= 8 && b.slice(4, 8).toString() === 'ftyp' },
  '.mp4': { mime: 'video/mp4', sig: [], extra: (b) => b.length >= 8 && b.slice(4, 8).toString() === 'ftyp' },
  '.wav': { mime: 'audio/wav', sig: [Buffer.from('RIFF')], extra: (b) => b.length >= 12 && b.slice(8, 12).toString() === 'WAVE' },
  '.png': IMG_TYPES['.png'], '.jpg': IMG_TYPES['.jpg'], '.jpeg': IMG_TYPES['.jpeg'],
};
const ALLOWED = { cover: 'PNG, JPG ou WEBP', doc: 'PDF, DOC, DOCX, XLS ou XLSX', product: 'PDF, EPUB, ZIP, MP3, M4A, WAV, MP4, DOCX, XLSX, PPTX, PNG ou JPG' };

class UploadError extends Error { constructor(msg, status = 422) { super(msg); this.status = status; this.expose = true; } }

// ---- volume ----
let VOL = '';
function configure(cfg) {
  VOL = '';
  if (!cfg.filesDir) return;
  try {
    fs.mkdirSync(path.join(cfg.filesDir, 'files'), { recursive: true });
    fs.mkdirSync(path.join(cfg.filesDir, 'tmp'), { recursive: true });
    fs.accessSync(cfg.filesDir, fs.constants.W_OK);
    VOL = cfg.filesDir;
  } catch (e) { log.warn('volume_indisponivel', { dir: cfg.filesDir, error: e.message }); }
}
const volumeOn = () => !!VOL;
const volFile = (name) => path.join(VOL, 'files', path.basename(String(name)));
const tmpDir = () => (VOL ? path.join(VOL, 'tmp') : os.tmpdir());
const limitFor = (kind) => (kind === 'cover' ? MAX_COVER : VOL ? MAX_VOLUME : MAX_DB);

function cleanName(name) {
  // O navegador pode mandar o nome em latin1; recupera acentos e remove caminho e caracteres de controle.
  let n = String(name || '');
  try { const u = Buffer.from(n, 'latin1').toString('utf8'); if (!u.includes('�')) n = u; } catch { /* mantém */ }
  n = path.basename(n.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim();
  return n.slice(0, 150) || 'arquivo';
}

const discard = (file) => { if (file && file.path) fs.unlink(file.path, () => {}); };
function head(file) {
  const fd = fs.openSync(file.path, 'r');
  try { const b = Buffer.alloc(16); const n = fs.readSync(fd, b, 0, 16, 0); return b.slice(0, n); } finally { fs.closeSync(fd); }
}

// Confere extensão, assinatura e tamanho do arquivo recebido (já gravado em disco temporário).
function validate(file, kind) {
  if (!file || !file.path || !file.size) { discard(file); throw new UploadError('Escolha um arquivo para enviar.'); }
  const table = kind === 'cover' ? IMG_TYPES : kind === 'product' ? PRODUCT_TYPES : DOC_TYPES;
  const max = limitFor(kind);
  const filename = cleanName(file.originalname);
  const ext = path.extname(filename).toLowerCase();
  const def = table[ext];
  const fail = (m, s) => { discard(file); throw new UploadError(m, s); };
  if (!def) fail(`Tipo de arquivo não permitido. Envie ${ALLOWED[kind]}.`);
  if (file.size > max) fail(`O arquivo passa de ${max / MB} MB.`, 413);
  const h = head(file);
  const okSig = (!def.sig.length || def.sig.some((s) => h.slice(0, s.length).equals(s))) && (!def.extra || def.extra(h));
  if (!okSig) fail(`O conteúdo não confere com o tipo ${ext.slice(1).toUpperCase()}. Envie ${ALLOWED[kind]}.`);
  return { filename, mime: def.mime, size: file.size, tmp: file.path };
}

// Onde guardar: o administrador escolhe ('db' ou 'volume'); sem escolha, vale o que cabe.
function chooseStorage(choice, size, kind) {
  if (kind === 'cover') return 'db';
  const c = choice === 'volume' || choice === 'db' ? choice : (size <= MAX_DB ? 'db' : 'volume');
  if (c === 'volume' && !VOL) throw new UploadError('O volume do Railway não está ligado neste ambiente. Escolha o banco de dados (até 20 MB).');
  if (c === 'db' && size > MAX_DB) throw new UploadError('Este arquivo passa de 20 MB e não cabe no banco de dados. Escolha o volume do Railway.', 413);
  return c;
}

async function sha256Of(p) {
  return new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(p).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject); });
}
async function move(from, to) {
  try { fs.renameSync(from, to); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(from, to); fs.unlinkSync(from); }
}

// Grava o arquivo no lugar escolhido. Devolve o id.
async function store(client, { kind, filename, mime, size, tmp, userId, storage }) {
  const sha = await sha256Of(tmp);
  if (storage === 'volume') {
    if (!VOL) { fs.unlink(tmp, () => {}); throw new UploadError('O volume do Railway não está ligado neste ambiente.'); }
    const name = crypto.randomBytes(18).toString('hex');
    await move(tmp, volFile(name));
    try {
      const r = await client.query(
        "INSERT INTO files (kind, filename, mime, size_bytes, sha256, storage, path, created_by) VALUES ($1,$2,$3,$4,$5,'volume',$6,$7) RETURNING id",
        [kind, filename, mime, size, sha, name, userId || null]);
      return r.rows[0].id;
    } catch (e) { fs.unlink(volFile(name), () => {}); throw e; }
  }
  const buffer = fs.readFileSync(tmp); fs.unlink(tmp, () => {});
  const r = await client.query(
    "INSERT INTO files (kind, filename, mime, size_bytes, sha256, storage, data, created_by) VALUES ($1,$2,$3,$4,$5,'db',$6,$7) RETURNING id",
    [kind, filename, mime, buffer.length, sha, buffer, userId || null]);
  return r.rows[0].id;
}

// Recebe um único campo "arquivo", direto em disco (nunca na memória). Erros do multer viram mensagens em português.
function receive(req, res, next, kind = 'doc') {
  const max = limitFor(kind);
  const up = multer({ storage: multer.diskStorage({ destination: (r, f, cb) => cb(null, tmpDir()), filename: (r, f, cb) => cb(null, 'up-' + crypto.randomBytes(12).toString('hex')) }),
    limits: { fileSize: max, files: 1, fields: 20, parts: 24 } }).single('arquivo');
  up(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new UploadError(`O arquivo passa de ${max / MB} MB.`, 413));
    return next(new UploadError('Não foi possível receber o arquivo. Tente de novo.', 400));
  });
}

async function get(id) {
  const r = await db.q('SELECT id, kind, filename, mime, size_bytes, storage, path, data FROM files WHERE id = $1', [id]);
  return r.rows[0] || null;
}

// Envia o arquivo ao navegador (do banco ou do volume), sempre como download.
function serve(res, f, next) {
  const headers = { 'Content-Type': f.mime, 'Content-Length': f.size_bytes, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" };
  if (f.storage !== 'volume') { res.set(headers); res.attachment(f.filename); return res.send(f.data); }
  const p = VOL ? volFile(f.path) : null;
  if (!p || !fs.existsSync(p)) {
    log.error('arquivo_do_volume_ausente', { file: f.id, volume: !!VOL });
    const e = new Error('Este arquivo está indisponível no momento. Avise o professor.'); e.status = 503; e.expose = true; return next(e);
  }
  res.set(headers); res.attachment(f.filename);
  fs.createReadStream(p).on('error', (e) => { log.error('leitura_volume_falhou', { file: f.id, error: e.message }); res.destroy(e); }).pipe(res);
}

// Apaga do volume o que não tem mais linha no banco (arquivo excluído, envio interrompido) e temporários velhos.
async function sweepVolume() {
  if (!VOL) return { removed: 0 };
  const keep = new Set((await db.q("SELECT path FROM files WHERE storage = 'volume'")).rows.map((x) => x.path));
  let removed = 0; const now = Date.now();
  const trash = path.join(VOL, 'trash'); fs.mkdirSync(trash, { recursive: true });
  // arquivos sem linha no banco vão para a lixeira (7 dias) em vez de sumir: protege contra restauração de backup antigo
  for (const [dir, graceMs, needsRow] of [[path.join(VOL, 'files'), 10 * 60 * 1000, true], [path.join(VOL, 'tmp'), 60 * 60 * 1000, false], [trash, 7 * 24 * 3600 * 1000, false]]) {
    let names = []; try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (needsRow && keep.has(n)) continue;
      try {
        const p = path.join(dir, n);
        if (now - fs.statSync(p).mtimeMs > graceMs) { if (needsRow) { const t = path.join(trash, n + '.' + now); fs.renameSync(p, t); const d = new Date(); fs.utimesSync(t, d, d); } else fs.unlinkSync(p); removed++; }
      } catch { /* já sumiu */ }
    }
  }
  if (removed) log.info('volume_limpo', { removidos: removed });
  return { removed };
}

const humanSize = (n) => (n >= MB ? `${(n / MB).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

module.exports = { configure, volumeOn, validate, chooseStorage, store, receive, get, serve, sweepVolume, discard, humanSize, UploadError, MAX_DOC, MAX_DB, MAX_VOLUME, MAX_COVER, DOC_TYPES, IMG_TYPES, PRODUCT_TYPES, ALLOWED };
