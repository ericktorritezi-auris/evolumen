'use strict';
// 1.7.0: telas de acompanhamento de alunos (lista dentro de Matrículas e página de detalhe).
const { html, raw } = require('../html');
const { shellApp } = require('../layout');
const { csrfInput } = require('./ui');
const { titleRow } = require('./student');
const T = require('../tracking');

const SP = 'America/Sao_Paulo';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: SP }) : '');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: SP, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' às') : '');
const hm = (sec) => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const PILL = {
  cert: ['pill--ok', () => 'Certificado emitido'],
  ok: ['pill--ok', () => 'Concluído'],
  exam: ['pill--warn', () => 'Aulas concluídas · prova pendente'],
  go: ['', () => 'Em andamento'],
  stop: ['pill--bad', (r) => `Parado há ${plural(r.last_days, 'dia', 'dias')}`],
  new: ['pill--draft', () => 'Ainda não começou'],
  cancelled: ['pill--draft', () => 'Cancelada'],
  expired: ['pill--draft', () => 'Expirada'],
  scheduled: ['pill--draft', (r) => `Começa em ${fmtDate(r.starts_at)}`],
};
const pill = (r) => { const [cls, label] = PILL[r.state]; return html`<span class="pill ${cls}">${label(r)}</span>`; };

const CHIPS = [['todos', 'Todos'], ['andamento', 'Em andamento'], ['parados', 'Parados'], ['novos', 'Não começaram'], ['concluidos', 'Concluídos']];

function bar(p, cls = '', label = 'Progresso') { return html`<div class="bar tk-bar ${cls}" role="progressbar" aria-label="${label}" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span></div>`; }

// Parte "acompanhamento" da aba Matrículas: indicadores, busca, filtros e a tabela de alunos.
function lista(ctx, { course, track, actions }) {
  const { kpis, shown, days, f, q } = track;
  const base = `/admin/cursos/${course.id}/matriculas`;
  const href = (nf) => `${base}?${new URLSearchParams({ ...(nf !== 'todos' ? { f: nf } : {}), ...(days !== T.DEFAULT_DAYS ? { dias: days } : {}), ...(q ? { q } : {}) })}`.replace(/\?$/, '');
  const total = track.rows ? track.rows.length : shown.length;
  return html`
  <div class="stats stats--5 tk-kpis">
    <div class="stat"><b>${kpis.enrolled}</b><span class="muted">Matriculados</span></div>
    <div class="stat"><b>${kpis.going}</b><span class="muted">Em andamento</span></div>
    <div class="stat ${kpis.stopped ? 'stat--warn' : ''}"><b>${kpis.stopped}</b><span class="muted">Parados há mais de ${days} dias</span></div>
    <div class="stat"><b>${kpis.finished}</b><span class="muted">Concluíram as aulas</span></div>
    <div class="stat"><b>${kpis.avg}%</b><span class="muted">Progresso médio</span></div>
  </div>
  <form method="get" action="${base}" class="tk-tools" role="search">
    <input type="hidden" name="f" value="${f}">
    <label class="tk-search"><span class="sr-only">Buscar aluno</span><input type="search" name="q" value="${q}" placeholder="Buscar por nome ou e-mail" maxlength="100" autocomplete="off"></label>
    <label class="tk-days">Parado há mais de
      <select name="dias">${T.DAYS.map((d) => html`<option value="${d}" ${d === days ? raw('selected') : ''}>${d} dias</option>`)}</select></label>
    <button class="btn btn--ghost btn--sm" type="submit">Aplicar</button>
  </form>
  <nav class="tk-chips" aria-label="Filtrar alunos">${CHIPS.map(([k, label]) => html`<a href="${href(k)}" class="tk-chip ${k === f ? 'is-active' : ''}"${k === f ? raw(' aria-current="page"') : ''}>${label}</a>`)}</nav>
  <h2 class="t-card" aria-live="polite">Alunos · ${shown.length}${shown.length !== total ? ` de ${total}` : ''}</h2>
  ${shown.length ? html`<div class="tbl-wrap"><table class="tbl tk-tbl"><thead><tr><th>Aluno</th><th>Progresso</th><th>Última aula concluída</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${shown.map((r) => html`<tr>
    <td data-l="Aluno"><div class="tk-cell"><b>${r.name}</b><span class="muted small">${r.email}</span></div></td>
    <td data-l="Progresso"><div class="tk-cell">${bar(r.pct, '', `Progresso de ${r.name}`)}<span class="small">${r.done} de ${r.total} aulas · ${r.pct}%</span></div></td>
    <td data-l="Última aula"><div class="tk-cell">${r.last_title ? html`<span>${r.last_title}</span><span class="muted small">${T.agoDays(r.last_days)}</span>` : html`<span class="muted small">Matriculado ${T.agoDays(r.since_days)}</span>`}</div></td>
    <td data-l="Situação"><div class="tk-cell"><span>${pill(r)}</span>${r.expires_at && !r.expired && r.status === 'active' ? html`<span class="muted small">Acesso até ${fmtDate(r.expires_at)}</span>` : ''}${r.expired ? html`<span class="muted small">Venceu em ${fmtDate(r.expires_at)}</span>` : ''}</div></td>
    <td class="tbl__act"><a class="btn btn--primary btn--sm" href="/admin/matriculas/${r.id}/progresso${days !== T.DEFAULT_DAYS ? `?dias=${days}` : ''}">Ver progresso</a> ${actions(ctx, r, 'curso')}</td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">${total ? 'Nenhum aluno com esse filtro.' : 'Ninguém matriculado ainda.'}</p>`}`;
}

const LSTATE = { done: 'Concluída', part: 'Em andamento', none: 'Não iniciada' };
const LICON = { done: '✓', part: '◐', none: '○' };

function progresso(ctx, { course, enr, user, d, expired, days = T.DEFAULT_DAYS }) {
  const st = T.situation({
    status: enr.status, expired, scheduled: !!(enr.starts_at && new Date(enr.starts_at) > new Date()), cert: !!d.cert, total: d.total, done: d.done,
    exam_pending: !!(d.final && !d.final.passed) || d.finalPending, live_progress: d.modules.some((m) => m.lessons.some((l) => l.doneAt)) ? 1 : 0, last_days: d.last ? Math.floor((Date.now() - new Date(d.last.at)) / 86400000) : null,
  }, days);
  const row = { state: st, starts_at: enr.starts_at, last_days: d.last ? Math.floor((Date.now() - new Date(d.last.at)) / 86400000) : 0 };
  const back = `/admin/cursos/${course.id}/matriculas`;
  const content = html`<a class="back" href="${back}">← Matrículas</a>${titleRow(user.name, `${course.title} · ${user.email}`)}
  <p>${pill(row)}${enr.status === 'cancelled' ? html` <span class="muted small">Matrícula cancelada: o histórico fica guardado.</span>` : ''}${expired && enr.status !== 'cancelled' ? html` <span class="muted small">Acesso venceu em ${fmtDate(enr.expires_at)}.</span>` : ''}</p>
  <div class="stats stats--4 tk-kpis">
    <div class="stat"><b>${d.pct}%</b><span class="muted">${d.done} de ${d.total} aulas</span></div>
    <div class="stat"><b>${d.totalSec ? `${hm(d.watchedSec)} de ${hm(d.totalSec)}` : '—'}</b><span class="muted">Tempo assistido</span></div>
    <div class="stat"><b class="tk-s">${d.last ? d.last.title : '—'}</b><span class="muted">${d.last ? `Última aula concluída · ${fmtDateTime(d.last.at)}` : 'Nenhuma aula concluída'}</span></div>
    <div class="stat"><b>${d.cert ? 'Emitido' : (d.certRevoked ? 'Revogado' : 'Não emitido')}</b><span class="muted">${d.cert ? `Nota final ${String(d.cert.final_score ?? '—').replace('.', ',')} · ${fmtDate(d.cert.issued_at)}` : (d.eligible ? 'Pronto para emitir' : 'Certificado')}</span></div>
  </div>
  ${d.modules.map((m, i) => html`<section class="card tk-mod">
    <h2 class="t-card">Módulo ${i + 1} · ${m.title} <span class="muted small">${m.done}/${m.total} aulas</span></h2>
    <ul class="tk-lessons">${m.lessons.map((l) => html`<li class="tk-l tk-l--${l.state}">
      <span class="tk-l__ico" aria-hidden="true">${LICON[l.state]}</span>
      <span class="tk-l__t">${l.title}${l.bonus ? html` <span class="pill pill--bonus">Bônus · não conta</span>` : ''}</span>
      <span class="tk-l__s muted small">${l.state === 'done' ? `${LSTATE.done} em ${fmtDateTime(l.doneAt)}` : (l.state === 'part' ? `${LSTATE.part} · ${l.wpct}% assistido` : LSTATE.none)}</span></li>`)}
      ${m.lessons.length ? '' : html`<li class="muted small">Sem aulas neste módulo.</li>`}</ul>
    ${m.quiz ? html`<p class="tk-eval"><b>Quiz do módulo:</b> ${m.quiz.passed ? html`<span class="pill pill--ok">Aprovado</span> melhor nota ${String(m.quiz.best).replace('.', ',')}` : (m.quiz.open_id && m.quiz.best === null ? html`<span class="pill pill--warn">Em andamento</span>` : m.quiz.used ? html`<span class="pill pill--warn">Não aprovado</span> melhor nota ${m.quiz.best === null ? '—' : String(m.quiz.best).replace('.', ',')}` : (m.locked ? html`<span class="pill pill--draft">Bloqueado</span>` : html`<span class="pill pill--draft">Não feito</span>`))} <span class="muted small">· ${plural(m.quiz.used, 'tentativa', 'tentativas')} de ${m.quiz.limit} · mínimo ${String(m.quiz.pass).replace('.', ',')}</span></p>` : ''}
  </section>`)}
  <section class="card tk-mod"><h2 class="t-card">Prova final e certificado</h2>
    ${d.final ? html`<p class="tk-eval"><b>Prova final:</b> ${d.final.passed ? html`<span class="pill pill--ok">Aprovado</span> melhor nota ${String(d.final.best).replace('.', ',')}` : (d.final.unlocked ? html`<span class="pill pill--warn">Liberada</span>${d.final.used ? html` melhor nota ${d.final.best === null ? '—' : String(d.final.best).replace('.', ',')}` : ''}` : html`<span class="pill pill--draft">Bloqueada</span>`)} <span class="muted small">· ${plural(d.final.used, 'tentativa', 'tentativas')} de ${d.final.limit} · mínimo ${String(d.final.pass).replace('.', ',')}</span></p>
      ${!d.final.unlocked && d.final.why ? html`<p class="muted small">${d.final.why}</p>` : ''}`
      : html`<p class="muted">${d.finalPending ? 'A prova final está ativa, mas ainda sem questões prontas.' : 'Este curso não tem prova final.'}</p>`}
    <p class="tk-eval"><b>Certificado:</b> ${d.cert ? html`<span class="pill pill--ok">Emitido</span> em ${fmtDate(d.cert.issued_at)}` : (d.certRevoked ? html`<span class="pill pill--bad">Revogado</span>` : html`<span class="pill pill--draft">Não emitido</span>`)}</p>
  </section>
  <p class="muted small">Tela só de consulta: nada aqui altera o acesso do aluno. Para cancelar ou reativar, use a lista de matrículas.</p>`;
  return shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path: '/admin/cursos', title: `Progresso de ${user.name}`, content });
}

// Produto de download não tem aulas: lista simples de compradores, sem indicadores de progresso.
function compradores(ctx, { rows, actions }) {
  return html`<h2 class="t-card">Matrículas · ${rows.length}</h2>
  ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Comprador</th><th>Acesso até</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${rows.map((r) => html`<tr>
    <td data-l="Comprador"><div class="tk-cell"><b>${r.name}</b><span class="muted small">${r.email}</span></div></td>
    <td data-l="Acesso até">${r.expires_at ? fmtDate(r.expires_at) : 'Vitalício'}</td>
    <td data-l="Situação">${r.status === 'cancelled' ? html`<span class="pill pill--draft">Cancelada</span>` : (r.expired ? html`<span class="pill pill--draft">Expirada</span>` : html`<span class="pill pill--ok">Ativa</span>`)}</td>
    <td class="tbl__act">${actions(ctx, r, 'curso')}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Ninguém matriculado ainda.</p>`}`;
}

module.exports = { lista, progresso, compradores };
