'use strict';
// Lead Parceiros (administrador): quadro por etapa (computador), lista recolhível (celular) e médias de tempo.
const { html, raw } = require('../html');
const { shellApp } = require('../layout');
const { field, csrfInput } = require('./ui');
const { titleRow } = require('./student');
const L = require('../leads');

const shell = (ctx, content) => shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path: '/admin/lead-parceiros', title: 'Lead Parceiros', content });
const tagPill = (t) => html`<span class="lp-tag lp-tag--${t}">${L.TAGS[t]}</span>`;
const stageName = (id) => L.STAGES.find((s) => s.id === id).name;

function monthSelect(id, selected, months) {
  return html`<select id="${id}" name="month" required>${months.map((m) => html`<option value="${m.value}"${m.value === selected ? raw(' selected') : ''}>${m.label}</option>`)}</select>`;
}

function card(ctx, l, pl, months) {
  const dest = L.STAGES.filter((s) => s.id !== l.stage);
  return html`<article class="lp-card" draggable="true" data-lead="${l.id}">
    <div class="lp-card__top"><span class="lp-card__name">${l.name}</span>${tagPill(l.tag)}</div>
    <div class="lp-meta"><span>Entrou em ${L.monthLabel(l.month)}</span><span>${pl.final ? `Desde ${new Date(l.stage_since).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : `Nesta etapa há ${L.hours(pl.since_stage)}`}</span></div>
    <form class="lp-move" method="post" action="/admin/lead-parceiros/${l.id}/mover">${csrfInput(ctx.csrf)}
      <select name="stage" aria-label="Mover ${l.name} para"><option value="">Mover para…</option>${dest.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select>
      <button class="btn btn--ghost btn--sm" type="submit">Mover</button></form>
    <details class="lp-edit"><summary>Editar</summary>
      <form method="post" action="/admin/lead-parceiros/${l.id}/editar" class="lp-editform">${csrfInput(ctx.csrf)}
        ${field({ id: `n${l.id}`, name: 'name', label: 'Nome', value: l.name, maxlength: 80, required: true })}
        <div class="field"><label for="t${l.id}">Perfil</label><select id="t${l.id}" name="tag"><option value="afiliado"${l.tag === 'afiliado' ? raw(' selected') : ''}>Afiliado</option><option value="divulgador"${l.tag === 'divulgador' ? raw(' selected') : ''}>Divulgador</option></select></div>
        <div class="field"><label for="m${l.id}">Mês de entrada</label>${monthSelect(`m${l.id}`, l.month, months.some((m) => m.value === l.month) ? months : [{ value: l.month, label: L.monthLabel(l.month) }, ...months])}</div>
        <button class="btn btn--outline btn--sm" type="submit">Salvar</button></form></details>
  </article>`;
}

function page(ctx, { leads, kpi, between, perLead }) {
  const months = L.monthOptions(); const cur = L.monthKey(new Date());
  const maxAvg = Math.max(0, ...between.map((b) => b.avg || 0));
  const kp = (n, lab, sub) => html`<div class="lp-kpi"><b>${n}</b><span>${lab}</span>${sub ? html`<small>${sub}</small>` : ''}</div>`;
  const content = html`${titleRow('Lead Parceiros', 'Funil de quem você está convidando para divulgar ou ser afiliado. É só para o seu acompanhamento: mover um card não cria acesso, cupom nem afiliado.')}
  <details class="card lp-new"${leads.length ? '' : raw(' open')}><summary class="btn btn--primary">+ Novo lead</summary>
    <form method="post" action="/admin/lead-parceiros" class="lp-newform">${csrfInput(ctx.csrf)}
      ${field({ id: 'lp-name', name: 'name', label: 'Nome', maxlength: 80, required: true, autocomplete: 'off' })}
      <div class="field"><label for="lp-tag">Perfil</label><select id="lp-tag" name="tag"><option value="afiliado">Afiliado</option><option value="divulgador">Divulgador</option></select></div>
      <div class="field"><label for="lp-month">Mês de entrada</label>${monthSelect('lp-month', cur, months)}</div>
      <p class="muted small">O lead entra na etapa “Início”. O horário de cada movimento é guardado automaticamente para as médias de tempo.</p>
      <button class="btn btn--primary" type="submit">Cadastrar</button></form></details>

  <section class="lp-kpis" aria-label="Resumo">
    ${kp(kpi.total, 'Leads cadastrados', `${kpi.afiliados} afiliados · ${kpi.divulgadores} divulgadores`)}
    ${kp(kpi.and, 'Em andamento', `${kpi.and_a} afiliados · ${kpi.and_d} divulgadores`)}
    ${kp(kpi.conf, 'Parceiros confirmados', `${kpi.conf_a} afiliados · ${kpi.conf_d} divulgadores`)}
    ${kp(kpi.sem, 'Sem retorno / desistiu')}
    ${kp(`${kpi.taxa}%`, 'Taxa de confirmação', 'confirmados ÷ cadastrados')}
  </section>

  <section class="lp-board" id="lp-board" aria-label="Funil de leads">
    ${L.STAGES.map((s) => { const items = leads.filter((l) => l.stage === s.id); return html`<div class="lp-col${s.ok ? ' lp-col--ok' : ''}${s.out ? ' lp-col--out' : ''}" data-stage="${s.id}">
      <button type="button" class="lp-col__h" aria-expanded="true"><span><span class="lp-chev" aria-hidden="true">▾</span><b>${s.name}</b></span><span class="lp-n">${items.length}</span></button>
      <div class="lp-col__b">${items.length ? items.map((l) => card(ctx, l, perLead.get(l.id), months)) : html`<div class="lp-empty">Nenhum lead aqui</div>`}</div></div>`; })}
  </section>
  <form id="lp-drop" method="post" hidden>${csrfInput(ctx.csrf)}<input type="hidden" name="stage" value=""></form>

  <div class="lp-grid2">
    <section class="card"><h2 class="t-card">Tempo médio entre etapas</h2>
      ${between.map((b) => html`<div class="lp-bar"><span class="lp-bar__l">${stageName(b.from)} → ${stageName(b.to)}</span>
        <div class="lp-bar__t"><i style="width:${b.avg && maxAvg ? Math.max(4, Math.round((b.avg / maxAvg) * 100)) : 0}%"></i></div>
        <b>${L.hours(b.avg)}<small>${b.n ? `${b.n} ${b.n === 1 ? 'lead' : 'leads'}` : 'sem dados'}</small></b></div>`)}
      <p class="muted small">Média, em horas, do tempo que os leads levaram para ir de uma etapa à seguinte. Conta só quem já passou por ela; o número embaixo é quantos leads entraram na conta.</p></section>
    <section class="card"><h2 class="t-card">Tempo por lead</h2>
      ${leads.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lead</th><th>Etapa atual</th><th>Na etapa atual</th><th>Média por etapa</th><th>Total no funil</th></tr></thead><tbody>
        ${[...leads].sort((a, b) => perLead.get(b.id).total - perLead.get(a.id).total || a.id - b.id).map((l) => { const p = perLead.get(l.id); return html`<tr>
          <td data-l="Lead"><span class="cell"><b>${l.name}</b> ${tagPill(l.tag)}</span></td><td data-l="Etapa atual"><span class="cell">${stageName(l.stage)}</span></td>
          <td data-l="Na etapa atual"><span class="cell">${p.final ? 'concluído' : L.hours(p.since_stage)}</span></td><td data-l="Média por etapa"><span class="cell">${L.hours(p.avg_move)}</span></td><td data-l="Total no funil"><span class="cell">${L.hours(p.total)}</span></td></tr>`; })}
      </tbody></table></div>` : html`<p class="muted">Cadastre o primeiro lead para ver os tempos.</p>`}
      <p class="muted small">“Média por etapa” é o total de horas até a última movimentação dividido pelo número de movimentos. “Na etapa atual” cresce até o card ser movido; em “Parceiro confirmado” e “Sem retorno” o tempo para de contar.</p></section>
  </div>
  <script src="/static/js/leads.js" defer></script>`;
  return shell(ctx, content);
}

module.exports = { page };
