'use strict';
// Certificados: emissão automática, revogação, verificação pública e PDF com selo e QR Code.
const crypto = require('crypto');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const db = require('./db');
const notify = require('./notify');
const A = require('./assess');

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_RE = /^EVL-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;
const DEFAULT_TEXT = 'Certificamos que {nome} concluiu o curso {curso}{carga}, em {data}, atendendo aos requisitos de avaliação e de conclusão da plataforma EvoLumen Academy.';
const DEFAULT_SIGNER = 'Erick Torritezi';
const DEFAULT_ROLE = 'Psicanalista e Psicoterapeuta Integrativo';

const newCode = () => { const p = () => Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join(''); return `EVL-${p()}-${p()}-${p()}`; };
const fmtDate = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const fmtLong = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' });
const linkFor = (cfg, code) => `${cfg.baseUrl}/certificado/${code}`;

// Troca {nome}, {curso}, {carga} e {data}. {carga} vira ", com carga horária de N horas" (some se não houver carga).
function fill(text, { name, course, hours, date }) {
  const vars = { nome: name, curso: course, carga: hours ? `, com carga horária de ${hours} ${hours === 1 ? 'hora' : 'horas'}` : '', data: fmtLong(date) };
  return String(text || DEFAULT_TEXT).replace(/\{(nome|curso|carga|data)\}/g, (_, k) => vars[k]).replace(/\{[a-z_]+\}/gi, '').replace(/\s+/g, ' ').trim();
}

// Cria o certificado quando o aluno cumpriu tudo: prova aprovada (se o curso tem prova) e 95% concluído.
// Seguro para chamar várias vezes. Certificado revogado não é recriado.
async function maybeIssue(userId, course) {
  const user = (await db.q("SELECT id, name, role, status FROM users WHERE id = $1", [userId])).rows[0];
  if (!user || user.role !== 'student') return null;
  const acc = await db.q("SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2 AND status = 'active' AND starts_at <= now() AND (expires_at IS NULL OR expires_at > now())", [userId, course.id]);
  if (!acc.rowCount) return null;
  const ov = await A.overview(userId, course);
  if (!ov.cert.eligible) return null;
  const exists = (await db.q('SELECT * FROM certificates WHERE user_id = $1 AND course_id = $2', [userId, course.id])).rows[0];
  if (exists) return null;
  const fresh = (await db.q('SELECT * FROM courses WHERE id = $1', [course.id])).rows[0];
  const issued = new Date();
  const body = fill(fresh.cert_text, { name: user.name, course: fresh.title, hours: fresh.cert_hours, date: issued });
  for (let i = 0; i < 5; i++) {
    try {
      const r = await db.q(`INSERT INTO certificates (code, user_id, course_id, student_name, course_title, hours, body_text, signer, signer_role, final_score, issued_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (user_id, course_id) DO NOTHING RETURNING *`,
      [newCode(), userId, course.id, user.name, fresh.title, fresh.cert_hours, body, fresh.cert_signer || DEFAULT_SIGNER, fresh.cert_signer_role || DEFAULT_ROLE, ov.final ? ov.final.best : null, issued]);
      const row = r.rows[0] || null;
      if (row) {
        await notify.add(userId, { kind: 'cert', title: 'Seu certificado está pronto!', body: fresh.title, link: '/certificados', key: 'cert:' + row.id });
        await notify.toAdmins({ kind: 'done', title: user.name + ' concluiu o curso', body: fresh.title, link: '/admin/alunos', key: 'done:' + row.id, subject: userId });
      }
      return row;
    } catch (e) { if (e.code !== '23505') throw e; }
  }
  return null;
}

async function revokeFor(userId, courseId, reason) {
  const r = await db.q("UPDATE certificates SET status = 'revoked', revoked_at = now(), revoke_reason = $3 WHERE user_id = $1 AND course_id = $2 AND status = 'valid' RETURNING id", [userId, courseId, String(reason || '').slice(0, 300)]);
  return r.rowCount;
}

const normalize = (code) => String(code || '').trim().toUpperCase().replace(/\s+/g, '');
const byCode = async (code) => (CODE_RE.test(normalize(code)) ? (await db.q('SELECT * FROM certificates WHERE code = $1', [normalize(code)])).rows[0] || null : null);

// ---------- PDF ----------
const FONT = (w) => path.join(__dirname, '..', 'assets', 'fonts', `Quicksand_${w}.ttf`);
const SEAL = path.join(__dirname, '..', 'assets', 'selo-evolumen-480.png');
const SIGN = path.join(__dirname, '..', 'assets', 'assinatura-erick.png');
const MASCOT = path.join(__dirname, '..', 'assets', 'mascote-lumen.png');

async function pdf(cfg, cert) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Certificado ${cert.code}`, Author: 'EvoLumen Academy', Subject: cert.course_title } });
  doc.registerFont('q5', FONT('500Medium')); doc.registerFont('q6', FONT('600SemiBold')); doc.registerFont('q7', FONT('700Bold'));
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const W = doc.page.width; const H = doc.page.height;
  const NAVY = '#0B0F26'; const AMBER = '#D98B1F'; const SOFT = '#5A6188'; const BG = '#FBF8F1';
  const NAVY2 = '#1B2150'; const GOLD = '#C9922E'; const CX = W / 2;
  doc.rect(0, 0, W, H).fill(BG);
  // marca d'água: círculos concentrados (o "alvo" da marca) e raios de luz saindo do selo
  doc.save(); doc.opacity(0.07).lineWidth(0.8).strokeColor(NAVY2);
  for (let r = 40; r <= 420; r += 26) doc.circle(CX, 118, r).stroke();
  doc.opacity(0.05);
  for (let a = 0; a < 360; a += 6) { const rad = (a * Math.PI) / 180; doc.moveTo(CX + Math.cos(rad) * 60, 118 + Math.sin(rad) * 60).lineTo(CX + Math.cos(rad) * 520, 118 + Math.sin(rad) * 520).stroke(); }
  doc.restore();
  // faixas laterais em azul-noite com filete dourado
  doc.save(); doc.rect(0, 0, 26, H).fill(NAVY2); doc.rect(W - 26, 0, 26, H).fill(NAVY2); doc.restore();
  doc.lineWidth(1.2).strokeColor(GOLD).moveTo(32, 0).lineTo(32, H).stroke().moveTo(W - 32, 0).lineTo(W - 32, H).stroke();
  // moldura dupla com cantos
  doc.lineWidth(2).strokeColor(NAVY2).rect(46, 28, W - 92, H - 56).stroke();
  doc.lineWidth(0.7).strokeColor(GOLD).rect(53, 35, W - 106, H - 70).stroke();
  for (const [x, y, dx, dy] of [[53, 35, 1, 1], [W - 53, 35, -1, 1], [53, H - 35, 1, -1], [W - 53, H - 35, -1, -1]]) {
    doc.save(); doc.lineWidth(1.4).strokeColor(GOLD).moveTo(x + dx * 6, y + dy * 24).lineTo(x + dx * 6, y + dy * 6).lineTo(x + dx * 24, y + dy * 6).stroke();
    doc.fillColor(GOLD).circle(x + dx * 6, y + dy * 6, 2.2).fill(); doc.restore();
  }
  // selo com halo
  doc.save(); doc.lineWidth(1).strokeColor(GOLD).circle(CX, 94, 56).stroke(); doc.lineWidth(0.5).circle(CX, 94, 61).stroke(); doc.restore();
  doc.image(SEAL, CX - 46, 48, { width: 92 });
  doc.fillColor(GOLD).font('q6').fontSize(11).text('EVOLUMEN ACADEMY', 0, 160, { width: W, align: 'center', characterSpacing: 4 });
  doc.fillColor(NAVY).font('q7').fontSize(31).text('CERTIFICADO DE CONCLUSÃO', 0, 178, { width: W, align: 'center', characterSpacing: 2.5 });
  // fio ornamental sob o título
  doc.save(); doc.lineWidth(0.8).strokeColor(GOLD).moveTo(CX - 120, 218).lineTo(CX - 14, 218).stroke().moveTo(CX + 14, 218).lineTo(CX + 120, 218).stroke();
  doc.fillColor(GOLD).moveTo(CX, 212).lineTo(CX + 5, 218).lineTo(CX, 224).lineTo(CX - 5, 218).fill(); doc.restore();
  // Corpo: ajusta o tamanho das fontes até caber acima da assinatura. Nome destacado na primeira ocorrência isolada.
  const esc = cert.student_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(^|[^\\p{L}])${esc}(?![\\p{L}])`, 'u').exec(cert.body_text);
  const limit = H - 140;
  let nameSize = 34; let bodySize = 15;
  const pre = m ? cert.body_text.slice(0, m.index + m[1].length).trim() : '';
  const post = m ? cert.body_text.slice(m.index + m[0].length).trim() : '';
  const fit = () => {
    if (!m) { doc.font('q5').fontSize(bodySize); return doc.heightOfString(cert.body_text, { width: W - 200, lineGap: 4 }) + 236; }
    doc.font('q5').fontSize(bodySize);
    const h1 = pre ? doc.heightOfString(pre, { width: W - 180 }) + 8 : 0;
    const h3 = post ? doc.heightOfString(post, { width: W - 200, lineGap: 4 }) : 0;
    doc.font('q7').fontSize(nameSize);
    return 236 + h1 + doc.heightOfString(cert.student_name, { width: W - 120 }) + 20 + h3;
  };
  while (fit() > limit && (bodySize > 10 || nameSize > 20)) { bodySize = Math.max(10, bodySize - 1); nameSize = Math.max(20, nameSize - 2); }
  let y = 236;
  if (m) {
    if (pre) { doc.fillColor(SOFT).font('q5').fontSize(bodySize).text(pre, 90, y, { width: W - 180, align: 'center' }); y = doc.y + 8; }
    doc.fillColor(NAVY).font('q7').fontSize(nameSize).text(cert.student_name, 60, y, { width: W - 120, align: 'center' });
    doc.lineWidth(1).strokeColor(AMBER).moveTo(W / 2 - 150, doc.y + 4).lineTo(W / 2 + 150, doc.y + 4).stroke();
    y = doc.y + 16;
    if (post) doc.fillColor(SOFT).font('q5').fontSize(bodySize).text(post, 100, y, { width: W - 200, align: 'center', lineGap: 4 });
  } else {
    doc.fillColor(NAVY).font('q5').fontSize(bodySize + 2).text(cert.body_text, 100, y, { width: W - 200, align: 'center', lineGap: 5 });
  }
  // assinatura
  const sy = H - 118;
  // assinatura manuscrita só para o signatário padrão (a imagem é do Erick)
  if (cert.signer === DEFAULT_SIGNER) doc.image(SIGN, CX - 80, sy - 52, { width: 160 });
  doc.image(MASCOT, CX + 175, sy - 78, { width: 84 });
  doc.lineWidth(1).strokeColor(NAVY).moveTo(W / 2 - 120, sy).lineTo(W / 2 + 120, sy).stroke();
  doc.fillColor(NAVY).font('q7').fontSize(13).text(cert.signer, 0, sy + 6, { width: W, align: 'center' });
  doc.fillColor(SOFT).font('q5').fontSize(10).text(cert.signer_role, 0, sy + 23, { width: W, align: 'center' });
  // emissão e verificação
  doc.fillColor(SOFT).font('q5').fontSize(10).text(`Emitido em ${fmtDate(cert.issued_at)}`, 82, H - 104, { width: 230 });
  doc.fillColor(NAVY).font('q6').fontSize(11).text(`Código ${cert.code}`, 82, H - 88, { width: 280 });
  doc.fillColor(SOFT).font('q5').fontSize(8.5).text(`Verifique em ${linkFor(cfg, cert.code)}`, 82, H - 72, { width: 300 });
  const qr = await QRCode.toBuffer(linkFor(cfg, cert.code), { margin: 1, width: 260, errorCorrectionLevel: 'M' });
  doc.image(qr, W - 82 - 74, H - 56 - 74, { width: 74 });
  doc.end();
  return done;
}

module.exports = { CODE_RE, DEFAULT_TEXT, DEFAULT_SIGNER, DEFAULT_ROLE, newCode, fill, maybeIssue, revokeFor, byCode, normalize, linkFor, fmtDate, pdf };
