'use strict';
// EvoLumen Analytics: página de verificação da coleta (administrador).
const { html } = require('../html');
const { shellApp } = require('../layout');
const { titleRow } = require('./student');

const SP = 'America/Sao_Paulo';
const when = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: SP, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const where = (s) => [s.city, s.region, s.country].filter(Boolean).join(' · ') || '—';

function verificacao(ctx, { data, cfg }) {
  const t = data.today;
  const content = html`${titleRow('Verificação da coleta', 'EvoLumen Analytics · confirma se as visitas estão chegando')}
  <p class="${cfg.analytics.enabled ? 'muted' : 'field__msg field__msg--err'}">${cfg.analytics.enabled ? 'Medição ligada.' : 'Medição desligada: defina ANALYTICS_ENABLED=1 no ambiente para começar a medir.'} Sites aceitos: este site e ${cfg.analytics.origins.join(', ') || 'nenhuma landing'}. Suas próprias visitas como administrador não são contadas.</p>
  <div class="stats stats--5">
    <div class="stat"><b>${t.visitors}</b><span class="muted">Visitantes hoje</span></div>
    <div class="stat"><b>${t.sessions}</b><span class="muted">Visitas hoje</span></div>
    <div class="stat"><b>${t.pageviews}</b><span class="muted">Páginas vistas hoje</span></div>
    <div class="stat"><b>${t.sessions7}</b><span class="muted">Visitas nos últimos 7 dias</span></div>
    <div class="stat"><b>${t.pageviews7}</b><span class="muted">Páginas vistas em 7 dias</span></div>
  </div>
  <h2 class="t-card">Últimas visitas</h2>
  ${data.last.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Quando</th><th>Onde</th><th>Origem</th><th>Entrou em</th><th>Páginas</th><th>Aparelho</th><th>Local</th><th>Visitante</th></tr></thead><tbody>${data.last.map((s) => html`<tr>
    <td data-l="Quando">${when(s.started_at)}</td><td data-l="Onde">${s.site === 'landing' ? 'Landing' : 'Plataforma'}${s.coupon ? html`<br><span class="muted small">${s.coupon}</span>` : ''}</td>
    <td data-l="Origem">${s.source}</td><td data-l="Entrou em">${s.entry_path}</td><td data-l="Páginas">${s.pages}</td>
    <td data-l="Aparelho">${s.device}<br><span class="muted small">${s.browser}</span></td><td data-l="Local">${where(s)}</td><td data-l="Visitante">${s.is_new ? 'Novo' : 'Recorrente'}</td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">Ainda não chegou nenhuma visita. Abra o site em outra janela (sem estar logado como administrador) e atualize esta página.</p>`}`;
  return shellApp({ cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path: '/admin', title: 'Verificação da coleta', content });
}

module.exports = { verificacao };
