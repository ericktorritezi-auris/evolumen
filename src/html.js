'use strict';
// Modelo de HTML seguro: tudo que entra por ${} é escapado, a não ser que venha de raw().
const RAW = Symbol('raw');
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => MAP[c]);
const raw = (s) => ({ [RAW]: true, s: String(s ?? '') });
function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(render).join('');
  if (typeof v === 'object' && v[RAW]) return v.s;
  return esc(v);
}
function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += render(vals[i]); });
  return raw(out);
}
const toString = (v) => render(v);
module.exports = { html, raw, esc, toString };
