'use strict';
// RODAPÉ ÚNICO. Direito autoral e versão do sistema em um só lugar, usado por todas as páginas.
const { html } = require('./html');

function renderFooter(cfg, { compact = false } = {}) {
  const year = 2026;
  return html`<footer class="site-footer${compact ? ' site-footer--compact' : ''}">
    <div>© ${year} EvoLumen Academy. Todos os direitos reservados.</div>
    <div>Mais um produto Belle Planner · Desenvolvido por Belle Planner · Versão ${cfg.version.display}</div>
  </footer>`;
}
module.exports = { renderFooter };
