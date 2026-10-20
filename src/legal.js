'use strict';
// Textos legais escritos no painel em texto simples: "# Título", parágrafos separados por linha em branco e listas com "- ".
// O HTML é gerado com escape total (nada digitado vira marcação), então não há como injetar script.
const { esc } = require('./html');

function textToHtml(src) {
  const blocks = String(src || '').replace(/\r\n?/g, '\n').trim().split(/\n{2,}/).filter(Boolean);
  const out = [];
  for (const b of blocks) {
    const lines = b.split('\n').map((l) => l.trimEnd());
    if (lines.every((l) => /^[-*] /.test(l))) { out.push(`<ul>${lines.map((l) => `<li>${esc(l.slice(2).trim())}</li>`).join('')}</ul>`); continue; }
    const m = /^(#{1,3}) (.+)$/.exec(lines[0]);
    if (m) {
      out.push(`<h${m[1].length + 1}>${esc(m[2].trim())}</h${m[1].length + 1}>`);
      const rest = lines.slice(1).join('\n').trim();
      if (rest) out.push(`<p>${esc(rest).replace(/\n/g, '<br>')}</p>`);
      continue;
    }
    out.push(`<p>${esc(lines.join('\n').trim()).replace(/\n/g, '<br>')}</p>`);
  }
  return out.join('\n');
}

// Para editar um texto que ainda não tem o texto-fonte (o rascunho inicial): volta o HTML para texto simples.
function htmlToText(h) {
  return String(h || '')
    .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gis, (_, n, t) => `\n\n${'#'.repeat(Math.min(3, Math.max(1, n - 1)))} ${t}\n\n`)
    .replace(/<li[^>]*>(.*?)<\/li>/gis, '\n- $1')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { textToHtml, htmlToText };
