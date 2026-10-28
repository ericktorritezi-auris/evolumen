'use strict';
// Componentes de formulário reutilizados pelas telas.
const { html, raw } = require('../html');

function field({ id, name, label, type = 'text', value = '', error = '', autocomplete = '', note = '', readonly = false, required = false, inputmode = '', maxlength = '', placeholder = '', password = false }) {
  const input = html`<input id="${id}" name="${name || id}" type="${type}" value="${type === 'password' ? '' : value}"
    ${autocomplete ? raw(`autocomplete="${autocomplete}"`) : ''} ${inputmode ? raw(`inputmode="${inputmode}"`) : ''}
    ${maxlength ? raw(`maxlength="${maxlength}"`) : ''} ${placeholder ? raw(`placeholder="${String(placeholder).replace(/"/g, '&quot;')}"`) : ''}
    ${readonly ? raw('readonly') : ''} ${required ? raw('required') : ''} ${error ? raw(`aria-invalid="true" aria-describedby="${id}-msg"`) : (note ? raw(`aria-describedby="${id}-msg"`) : '')}>`;
  const wrapped = password
    ? html`<div class="field__pw">${input}<button type="button" class="field__toggle" data-toggle-pw="${id}" aria-label="Mostrar senha" aria-pressed="false">Mostrar</button></div>`
    : input;
  return html`<div class="field${readonly ? ' field--ro' : ''}${error ? ' field--err' : ''}">
    <label for="${id}">${label}</label>${wrapped}
    ${error ? html`<div class="field__msg field__msg--err" id="${id}-msg">${error}</div>` : (note ? html`<div class="field__msg" id="${id}-msg">${note}</div>` : '')}
  </div>`;
}

const csrfInput = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;

// Nome abreviado para uso público: primeiro nome e inicial do último ("Ana L."). Seguro com acentos decompostos e emoji.
function shortName(n) {
  const p = String(n || '').normalize('NFC').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return 'Aluno';
  return p.length > 1 ? `${p[0]} ${Array.from(p[p.length - 1])[0].toLocaleUpperCase('pt-BR')}.` : p[0];
}
module.exports = { field, csrfInput, shortName };
