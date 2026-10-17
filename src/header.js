'use strict';
// CABEÇALHO ÚNICO: marca (logo + nome) e botão do menu do celular, usados por todas as telas.
const { html, raw } = require('./html');
const ICONS = require('./icons');

function icon(name, size = 20) {
  return raw(`<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`);
}

function brand({ sub = '', href = '/', size = 34 } = {}) {
  return html`<a class="brand" href="${href}" aria-label="EvoLumen Academy, página inicial">
    <img src="/static/img/logo.svg" width="${size}" height="${size}" alt="">
    <span class="brand__txt"><span class="brand__name">Evo<b>Lumen</b></span>${sub ? html`<span class="brand__sub">${sub}</span>` : ''}</span>
  </a>`;
}

function menuButton() {
  return html`<button type="button" class="icon-btn" id="menu-open" aria-label="Abrir menu" aria-expanded="false" aria-controls="menu-overlay">${icon('menu', 22)}</button>`;
}

function mobileHeader({ area }) {
  return html`<header class="m-header">${brand({ size: 30 })}<div class="m-header__actions">${menuButton()}</div></header>`;
}

module.exports = { brand, icon, menuButton, mobileHeader };
