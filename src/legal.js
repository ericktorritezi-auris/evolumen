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
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&#(\d{1,6});/g, (_, n) => { const c = Number(n); return c > 31 && c < 0x10ffff ? String.fromCodePoint(c) : ''; })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}


// Limpeza do HTML vindo do editor visual: só passa o que está na lista. Scripts, estilos, eventos e atributos somem.
const ALLOWED = new Set(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'u', 'br', 'a', 'blockquote']);
const BLOCK = new Set(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'blockquote']);
const RENAME = { b: 'strong', i: 'em', h1: 'h2', h5: 'h4', h6: 'h4', div: 'p' };
const DROP = 'script|style|iframe|object|embed|svg|math|textarea|noscript|template|head|title|form|button|select|link|meta';

function safeHref(v) {
  const h = String(v || '').replace(/&amp;/gi, '&').replace(/[\u0000- \u007f-\u009f]+/g, '').slice(0, 500);
  if (!/^(https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+)$/i.test(h)) return null;
  return h.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function sanitizeHtml(src) {
  let s = String(src == null ? '' : src).slice(0, 300000);
  s = s.replace(new RegExp(`<(${DROP})\\b[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), '').replace(new RegExp(`<(${DROP})\\b[\\s\\S]*$`, 'i'), '').replace(/<!--[\s\S]*?(-->|$)/g, '');
  const out = []; const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>|([^<]+)|</g;
  let m;
  while ((m = re.exec(s))) {
    if (m[4] !== undefined) { out.push(m[4].replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')); continue; }
    if (!m[2]) { out.push('&lt;'); continue; }
    let tag = m[2].toLowerCase(); tag = RENAME[tag] || tag;
    if (!ALLOWED.has(tag)) continue;
    if (m[1]) {
      const i = stack.lastIndexOf(tag);
      if (i >= 0) while (stack.length > i) out.push(`</${stack.pop()}>`);
      continue;
    }
    if (tag === 'br') { out.push('<br>'); continue; }
    if (tag === 'a') {
      const hm = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3] || '');
      const href = hm ? safeHref(hm[1] !== undefined ? hm[1] : hm[2] !== undefined ? hm[2] : hm[3]) : null;
      if (!href) continue;
      stack.push('a'); out.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">`); continue;
    }
    // Parágrafo não contém blocos: fecha o parágrafo aberto antes de abrir lista, título ou citação.
    if (BLOCK.has(tag)) { const pi = stack.lastIndexOf('p'); if (pi >= 0) while (stack.length > pi) out.push(`</${stack.pop()}>`); }
    stack.push(tag); out.push(`<${tag}>`);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  const res = out.join('').replace(/<(p|h2|h3|h4|li|strong|em|u|blockquote)>(\s|<br>|&nbsp;)*<\/\1>/g, '').trim();
  return /^(\s|<br>|&nbsp;)*$/.test(res) ? '' : res;
}

module.exports = { textToHtml, htmlToText, sanitizeHtml };
