'use strict';
// Recibo de repasse de comissionamento (1.5.0): PDF em papel timbrado EvoLumen, gerado sob demanda a partir do repasse gravado.
const path = require('path');
const PDFDocument = require('pdfkit');
const db = require('./db');

const UN = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CT = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

// 0 a 999 por extenso.
function ate999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100); const r = n % 100; const parts = [];
  if (c) parts.push(CT[c]);
  if (r) parts.push(r < 20 ? UN[r] : DZ[Math.floor(r / 10)] + (r % 10 ? ` e ${UN[r % 10]}` : ''));
  return parts.join(' e ');
}

// Inteiro (0 a 999.999.999.999) por extenso.
function inteiro(n) {
  if (n === 0) return 'zero';
  const g = [Math.floor(n / 1e9) % 1000, Math.floor(n / 1e6) % 1000, Math.floor(n / 1e3) % 1000, n % 1000];
  const out = [];
  if (g[0]) out.push(g[0] === 1 ? 'um bilhão' : `${ate999(g[0])} bilhões`);
  if (g[1]) out.push(g[1] === 1 ? 'um milhão' : `${ate999(g[1])} milhões`);
  if (g[2]) out.push(g[2] === 1 ? 'mil' : `${ate999(g[2])} mil`);
  if (g[3]) out.push(ate999(g[3]));
  // "e" entre os grupos só quando o último grupo é menor que 100 ou centena exata.
  let s = out[0];
  for (let i = 1; i < out.length; i++) {
    const last = i === out.length - 1; const v = [g[0], g[1], g[2], g[3]].filter(Boolean)[i];
    s += (last && (v < 100 || v % 100 === 0)) ? ` e ${out[i]}` : `, ${out[i]}`;
  }
  return s;
}

// Valor em centavos por extenso: "cento e cinquenta reais e vinte centavos".
function extenso(cents) {
  const c = Math.round(Number(cents)); const reais = Math.floor(c / 100); const cs = c % 100;
  const parts = [];
  if (reais > 0) {
    const de = reais % 1e6 === 0 ? ' de' : '';
    parts.push(`${inteiro(reais)}${de} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (cs > 0) parts.push(`${inteiro(cs)} ${cs === 1 ? 'centavo' : 'centavos'}`);
  return parts.length ? parts.join(' e ') : 'zero real';
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// "2026-10-24" -> "24 de outubro de 2026" (sem fuso: a data do repasse é um dia, não um instante).
function dataLonga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${Number(m[3])} de ${MONTHS[Number(m[2]) - 1]} de ${m[1]}` : '';
}
const cpfFmt = (d) => { const s = String(d || '').replace(/\D/g, ''); return s.length === 11 ? `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}` : ''; };
const pad = (n, w) => String(n).padStart(w, '0');
const dateOnly = (d) => (d instanceof Date ? d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : String(d).slice(0, 10));

// Repasse + afiliado + quem assina (o administrador com CPF cadastrado). Repasse anulado não gera recibo.
async function forPayout(payoutId, affiliateId = null) {
  const p = (await db.q(`SELECT p.*, a.name AS affiliate_name, a.dest_kind, a.pix_key, a.bank_name, a.bank_agency, a.bank_account
    FROM affiliate_payouts p JOIN affiliates a ON a.id = p.affiliate_id WHERE p.id = $1 ${affiliateId ? 'AND p.affiliate_id = $2' : ''}`, affiliateId ? [payoutId, affiliateId] : [payoutId])).rows[0];
  if (!p || p.voided_at) return null;
  const A = require('./affiliates');
  const dest = p.dest_text == null ? A.destText(p) : p.dest_text;
  const s = (await db.q("SELECT name, cpf FROM users WHERE role = 'admin' AND status = 'active' ORDER BY (cpf IS NULL), id LIMIT 1")).rows[0] || {};
  return { id: p.id, amount_cents: p.amount_cents, paid_on: dateOnly(p.paid_on), affiliate_name: p.affiliate_name, dest, signer: s.name || 'Erick Torritezi', signer_cpf: cpfFmt(s.cpf) };
}

const FONT = (w) => path.join(__dirname, '..', 'assets', 'fonts', `Quicksand_${w}.ttf`);
const SEAL = path.join(__dirname, '..', 'assets', 'selo-evolumen-480.png');
const SIGN = path.join(__dirname, '..', 'assets', 'assinatura-erick.png');
const MASCOT = path.join(__dirname, '..', 'assets', 'mascote-lumen.png');

const numero = (r) => `${pad(r.id, 4)}/${r.paid_on.slice(0, 4)}`;
const fileName = (r) => `recibo-repasse-${r.paid_on.slice(0, 4)}-${pad(r.id, 4)}.pdf`;

async function pdf(r) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Recibo de repasse nº ${numero(r)}`, Author: 'EvoLumen Academy', Subject: 'Recibo de repasse de comissionamento de afiliado' } });
  doc.registerFont('q5', FONT('500Medium')); doc.registerFont('q6', FONT('600SemiBold')); doc.registerFont('q7', FONT('700Bold')); 
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const W = doc.page.width; const H = doc.page.height; const M = 64;
  const NAVY = '#0B0F26'; const AMBER = '#D98B1F'; const SOFT = '#5A6188'; const BG = '#FBF8F1'; const LINE = '#E2D9C3';
  doc.rect(0, 0, W, H).fill(BG);
  // marca d'água discreta
  doc.save(); doc.opacity(0.03); doc.image(SEAL, W / 2 - 170, H / 2 - 170, { width: 340 }); doc.restore();
  // faixa superior
  doc.rect(0, 0, W, 8).fill(NAVY); doc.rect(0, 8, W, 2).fill(AMBER);
  // cabeçalho timbrado
  doc.image(MASCOT, M, 38, { width: 54 });
  doc.fillColor(NAVY).font('q5').fontSize(26).text('Evo', M + 66, 46, { continued: true }).fillColor(AMBER).font('q7').text('Lumen');
  doc.fillColor(SOFT).font('q5').fontSize(9.5).text('EVOLUMEN ACADEMY', M + 67, 78, { characterSpacing: 2 });
  doc.fillColor(SOFT).font('q5').fontSize(9.5).text(`Recibo nº ${numero(r)}`, M, 50, { width: W - 2 * M, align: 'right' });
  doc.moveTo(M, 112).lineTo(W - M, 112).lineWidth(0.8).strokeColor(LINE).stroke();
  // título
  doc.fillColor(NAVY).font('q7').fontSize(19).text('RECIBO DE REPASSE', M, 150, { width: W - 2 * M, align: 'center', characterSpacing: 1.5 });
  doc.fillColor(AMBER).font('q6').fontSize(12).text('DE COMISSIONAMENTO DE AFILIADO', M, 176, { width: W - 2 * M, align: 'center', characterSpacing: 2 });
  // valor em destaque
  const brl = (r.amount_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
  doc.roundedRect(W / 2 - 110, 212, 220, 46, 10).lineWidth(1).strokeColor(AMBER).stroke();
  doc.fillColor(NAVY).font('q7').fontSize(22).text(brl, M, 224, { width: W - 2 * M, align: 'center' });
  // texto
  const dest = r.dest ? `, ${r.dest}` : '';
  const texto = `Informamos que, em ${dataLonga(r.paid_on)}, foi repassado, em caráter de comissionamento de afiliado, o valor de ${brl} (${extenso(r.amount_cents)})${dest}, do(a) afiliado(a) ${r.affiliate_name}, referente às comissões do Programa de Afiliados da EvoLumen Academy.`;
  doc.fillColor(NAVY).font('q5').fontSize(13).text(texto, M + 8, 296, { width: W - 2 * M - 16, align: 'justify', lineGap: 7 });
  const yAfter = doc.y;
  doc.fillColor(NAVY).font('q5').fontSize(12).text(`Paraná, ${dataLonga(r.paid_on)}.`, M, yAfter + 40, { width: W - 2 * M, align: 'right' });
  // assinatura
  const sy = Math.max(doc.y + 90, 560);
  // A assinatura manuscrita só vale para o titular dela; outro nome sai só com a linha de assinatura.
  if (String(r.signer).trim().toLowerCase() === 'erick torritezi') doc.image(SIGN, W / 2 - 80, sy - 56, { width: 160 });
  doc.moveTo(W / 2 - 130, sy).lineTo(W / 2 + 130, sy).lineWidth(0.8).strokeColor(NAVY).stroke();
  doc.fillColor(NAVY).font('q7').fontSize(12.5).text(r.signer, 0, sy + 8, { width: W, align: 'center' });
  if (r.signer_cpf) doc.fillColor(SOFT).font('q5').fontSize(10.5).text(`CPF ${r.signer_cpf}`, 0, sy + 26, { width: W, align: 'center' });
  doc.fillColor(SOFT).font('q5').fontSize(10.5).text('EvoLumen Academy', 0, sy + (r.signer_cpf ? 41 : 26), { width: W, align: 'center' });
  // rodapé
  doc.moveTo(M, H - 70).lineTo(W - M, H - 70).lineWidth(0.6).strokeColor(LINE).stroke();
  doc.fillColor(SOFT).font('q5').fontSize(8.5).text('Documento gerado pela plataforma EvoLumen Academy a partir do repasse registrado no sistema.', M, H - 58, { width: W - 2 * M, align: 'center' });
  doc.end();
  return done;
}

module.exports = { extenso, dataLonga, cpfFmt, forPayout, pdf, fileName, numero };
