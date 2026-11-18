'use strict';
// Atividade complementar (2.3.0): painel do aluno na aula, avaliação e listas do professor, aba "Atividades" do curso.
const { html, raw } = require('../html');
const { shellApp } = require('../layout');
const { csrfInput } = require('./ui');
const { titleRow } = require('./student');
const { tabs, area } = require('./admin');

const MAX_LINKS = 5;
const fmtDT = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const grade = (g) => (g == null ? '' : Number(g).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const shell = (ctx, title, content, path = '/admin/atividades') => shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path, title, content });
const text = (s) => String(s || '').split(/\n/).map((l, i) => (i ? html`<br>${l}` : html`${l}`));

const PILL = {
  none: ['Aguardando envio', 'pill--draft'], pending: ['Aguardando aprovação', 'pill--warn'], adjust: ['Ajustes necessários', 'pill--warn'],
  approved: ['Aprovada', 'pill--ok'], rejected: ['Não aprovada', 'pill--bad'], waived: ['Dispensada', 'pill--ok'], reopened: ['Reaberta', 'pill--warn'],
};
const pill = (state, g) => { const p = PILL[state] || PILL.none; return html`<span class="pill ${p[1]}">${p[0]}${(state === 'approved' || state === 'rejected') && g != null ? ` · ${grade(g)}` : ''}</span>`; };

const linkList = (links, { open = false } = {}) => html`<ul class="lklist">${(links || []).map((l) => html`<li><div><b>${l.label}</b><span>${l.url}</span></div>${open ? html`<a class="btn btn--outline btn--sm" href="${l.url}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>` : ''}</li>`)}</ul>`;

function linkRows(csrfless, rows, errors = {}) {
  const list = rows && rows.length ? rows : [{ label: '', url: '' }];
  return html`<div data-lks data-max="${MAX_LINKS}">${list.map((l, i) => html`<div class="lk" data-lk>
    <div class="field"><label>Nome do link</label><input type="text" name="label" maxlength="60" value="${l.label || ''}" placeholder="Ex.: Vídeo da prática"></div>
    <div class="field${errors[i] ? ' field--err' : ''}"><label>Endereço (https://)</label><input type="text" name="url" inputmode="url" autocomplete="off" maxlength="2000" value="${l.url || ''}" placeholder="https://..."${errors[i] ? raw(' aria-invalid="true"') : ''}>${errors[i] ? html`<div class="field__msg field__msg--err">${errors[i]}</div>` : ''}</div>
    <button class="btn btn--ghost btn--sm" type="button" data-lk-rm>Remover</button></div>`)}</div>
    <p><button class="btn btn--outline btn--sm" type="button" data-lk-add>+ Adicionar outro link</button> <span class="muted small" data-lk-count></span></p>`;
}

function sendForm(ctx, course, lesson, { values = null, errors = {}, error = '', cta }) {
  return html`<form method="post" action="/curso/${course.slug}/aula/${lesson.id}/atividade" novalidate>${csrfInput(ctx.csrf)}
    ${error ? html`<div class="alert alert--error" role="alert">${error}</div>` : ''}
    ${linkRows(null, values, errors)}
    <p class="muted small">Use Google Drive, Dropbox, OneDrive, YouTube (não listado) ou Vimeo, com o acesso liberado para quem tem o link. Só aceitamos endereços que começam com <b>https://</b>. Você pode enviar de 1 a ${MAX_LINKS} links.</p>
    <button class="btn btn--primary" type="submit">${cta}</button></form>`;
}

// Painel dentro da página da aula (aluno).
function studentPanel(ctx, { course, lesson, st, values = null, errors = {}, error = '' }) {
  const s = st ? st.state : 'none';
  const last = st && st.last;
  const evaluated = (st ? st.rows : []).filter((r) => ['adjust', 'approved', 'rejected'].includes(r.status));
  const lastEval = evaluated[evaluated.length - 1];
  const sentRows = (st ? st.rows : []).filter((r) => Array.isArray(r.links) && r.links.length);
  const lastSent = sentRows[sentRows.length - 1];
  let body;
  if (s === 'pending') body = html`<div class="alert alert--info"><b>Aguardando aprovação.</b> Recebemos a sua entrega em ${fmtDT(last.created_at)}. Você receberá um e-mail e um aviso na campainha quando o professor avaliar.</div>
    <h3 class="t-sub">Links enviados</h3>${linkList(last.links)}`;
  else if (s === 'approved' || s === 'waived') {
    const ok = st.rows.filter((r) => r.status === 'approved' || r.status === 'waived').pop();
    body = s === 'waived'
      ? html`<div class="alert alert--success"><b>Atividade dispensada pelo professor.</b>${ok.summary ? html` ${ok.summary}` : ''}</div><p class="muted small">Esta atividade não tem nota. As próximas aulas estão liberadas.</p>`
      : html`<div class="alert alert--success"><b>Aprovada${ok.grade != null ? ` · nota ${grade(ok.grade)} de 10` : ''}</b></div>
        <h3 class="t-sub">Resumo do professor</h3><p>${text(ok.summary)}</p>${ok.links && ok.links.length ? html`<h3 class="t-sub">Links enviados</h3>${linkList(ok.links)}` : ''}`;
  } else if (s === 'rejected') body = html`<div class="alert alert--error"><b>Não aprovada${last.grade != null ? ` · nota ${grade(last.grade)} de 10` : ''}</b></div>
    <h3 class="t-sub">Resumo do professor</h3><p>${text(last.summary)}</p>
    <p class="muted">As próximas aulas continuam bloqueadas. Fale com o professor para combinar uma nova chance; quando ele reabrir a atividade, você poderá enviar de novo.</p>`;
  else if (s === 'adjust') body = html`${lastEval && !(last && last.status === 'reopened') ? html`<div class="alert alert--info"><b>Ajustes necessários${lastEval.grade != null ? ` · nota ${grade(lastEval.grade)}` : ''}</b><br>${text(lastEval.summary)}</div>` : html`<div class="alert alert--info"><b>Atividade reaberta.</b> Envie os novos links.</div>`}
    <h3 class="t-sub">Reenvie os links corrigidos</h3>${sendForm(ctx, course, lesson, { values: values || (lastSent ? lastSent.links : null), errors, error, cta: 'Reenviar para avaliação' })}`;
  else body = html`<div class="alert alert--info">Esta aula não é concluída por você: depois de enviar, o professor avalia e libera as próximas aulas.</div>${sendForm(ctx, course, lesson, { values, errors, error, cta: 'Enviar para avaliação' })}`;
  const hist = evaluated.length > 1 || (evaluated.length === 1 && s !== 'adjust' && s !== 'rejected' && s !== 'approved')
    ? html`<details class="blk"><summary>Histórico de avaliações</summary><ul class="hist">${evaluated.map((r) => html`<li><b>${fmtDT(r.evaluated_at)}</b> ${pill(r.status, r.grade)}<br><span class="muted small">${text(r.summary)}</span></li>`)}</ul></details>` : '';
  return html`<section class="card act" id="atividade" aria-labelledby="act-h"><h2 class="t-card" id="act-h">Atividade complementar ${pill(s, s === 'approved' ? (st.rows.filter((r) => r.status === 'approved').pop() || {}).grade : last && last.grade)}</h2>${body}${hist}</section>`;
}

function adminNote(course, lesson) {
  return html`<section class="card act"><h2 class="t-card">Atividade complementar</h2><p class="muted">Visão do professor. Os alunos enviam links aqui e você avalia na aba <a href="/admin/cursos/${course.id}/atividades">Atividades</a> do curso.</p></section>`;
}

// Lista de envios (todas as atividades ou de um curso).
function table(rows, { showCourse = true, base = '', shown = 25 } = {}) {
  if (!rows.length) return html`<p class="muted">Nenhum envio por aqui.</p>`;
  const moreLink = rows.more ? html`<p class="muted small">Mostrando os ${rows.length} mais recentes (pendentes primeiro).</p><p><a class="btn btn--outline btn--sm" href="${base}${base.includes('?') ? '&' : '?'}mostrar=${shown + 25}">Carregar mais 25</a></p>` : '';
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Aluno</th>${showCourse ? html`<th>Curso</th>` : ''}<th>Atividade</th><th>Envio</th><th>Enviado em</th><th>Situação</th><th></th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td data-l="Aluno"><b>${r.user_name}</b><br><span class="muted small">${r.user_email}</span></td>${showCourse ? html`<td data-l="Curso">${r.course_title}</td>` : ''}<td data-l="Atividade">${r.lesson_title}</td>
      <td data-l="Envio">${r.status === 'waived' ? '—' : `Envio ${r.attempt_no}`}</td><td data-l="Enviado em">${fmtDT(r.created_at)}</td><td data-l="Situação">${pill(r.status, r.grade)}</td>
      <td class="tbl__act"><a class="btn ${r.status === 'pending' ? 'btn--primary' : 'btn--outline'} btn--sm" href="/admin/atividades/${r.id}">${r.status === 'pending' ? 'Avaliar' : 'Ver'}</a></td></tr>`)}</tbody></table></div>${moreLink}`;
}

function adminList(ctx, { rows, filter, pending, shown = 25 }) {
  const chip = (k, label, n) => html`<a class="achip${filter === k ? ' on' : ''}" href="/admin/atividades${k === 'pendentes' ? '?filtro=pendentes' : ''}"${filter === k ? raw(' aria-current="page"') : ''}>${label}${n != null ? html` <span class="pill pill--warn">${n}</span>` : ''}</a>`;
  return shell(ctx, 'Atividades para avaliar', html`${titleRow('Atividades para avaliar', 'Entregas das atividades complementares, da mais antiga para a mais nova.')}
    <div class="achips" role="navigation" aria-label="Filtro">${chip('pendentes', 'Aguardando avaliação', pending)}${chip('todas', 'Todas', null)}</div>
    <section class="card">${table(rows, { base: `/admin/atividades${filter === 'pendentes' ? '?filtro=pendentes' : ''}`, shown })}</section>`);
}

function evalPage(ctx, { sub, error = '', values = {} }) {
  const pend = sub.status === 'pending';
  const rejectedNow = sub.current === 'rejected';
  const f = values;
  const opt = (v, t, d) => html`<label class="opt"><input type="radio" name="decision" value="${v}"${f.decision === v ? raw(' checked') : ''}><span>${t}<small>${d}</small></span></label>`;
  return shell(ctx, 'Avaliar atividade', html`<a class="back" href="/admin/atividades${pend ? '?filtro=pendentes' : ''}">← Atividades</a>
    ${titleRow('Avaliar atividade', '')}
    <p class="muted"><b>${sub.user_name}</b> · ${sub.user_email} · ${sub.course_title} · ${sub.lesson_title}</p>
    <div class="grid2">
      <div class="stack">
        <section class="card"><h2 class="t-card">Links enviados ${pill(sub.status, sub.grade)}</h2>
          ${sub.links && sub.links.length ? linkList(sub.links, { open: true }) : html`<p class="muted">Sem envio (${sub.status === 'waived' ? 'atividade dispensada' : 'sem links'}).</p>`}
          ${pend ? html`<p class="muted small">Cada link abre em nova aba. Se algum não abrir, marque <b>Ajustes necessários</b> e diga qual está errado.</p>` : ''}</section>
        <section class="card"><h2 class="t-card">Histórico</h2><ul class="hist">${sub.history.map((r) => html`<li><b>${r.status === 'pending' ? `Envio ${r.attempt_no}` : r.status === 'waived' ? 'Dispensa' : r.status === 'reopened' ? 'Reaberta' : `Avaliação do envio ${r.attempt_no}`}</b> · ${fmtDT(r.status === 'pending' ? r.created_at : r.evaluated_at || r.created_at)} ${pill(r.status, r.grade)}
          ${r.summary ? html`<br><span class="muted small">${text(r.summary)}</span>` : ''}${r.id === sub.id ? html` <span class="muted small">(este envio)</span>` : ''}</li>`)}</ul></section>
      </div>
      <section class="card"><h2 class="t-card">${pend ? 'Sua avaliação' : 'Avaliação'}</h2>
        ${pend ? html`<form method="post" action="/admin/atividades/${sub.id}/avaliar" novalidate>${csrfInput(ctx.csrf)}
          ${error ? html`<div class="alert alert--error" role="alert">${error}</div>` : ''}
          <div class="opts" role="radiogroup" aria-label="Resultado">${opt('approved', 'Aprovado', 'Libera as próximas aulas')}${opt('adjust', 'Ajustes necessários', 'O aluno corrige e reenvia')}${opt('rejected', 'Não aprovado', 'Fica bloqueado até você reabrir')}</div>
          <div class="field"><label for="grade">Nota (0 a 10) <span class="muted small">obrigatória para Aprovado e Não aprovado</span></label><input id="grade" name="grade" type="text" inputmode="decimal" autocomplete="off" maxlength="5" value="${f.grade || ''}" placeholder="Ex.: 8,5"></div>
          ${area('summary', 'Resumo para o aluno', f.summary || '', { rows: 7, placeholder: 'Explique o resultado: o que foi bem e, se for o caso, o que precisa ajustar.' })}
          <button class="btn btn--primary" type="submit">Enviar avaliação ao aluno</button></form>`
          : html`<p>${pill(sub.status, sub.grade)} ${sub.evaluated_at ? html`<span class="muted small">em ${fmtDT(sub.evaluated_at)}</span>` : ''}</p>${sub.summary ? html`<p>${text(sub.summary)}</p>` : ''}
            ${rejectedNow && sub.status === 'rejected' ? html`<form method="post" action="/admin/atividades/${sub.id}/reabrir" data-confirm="Reabrir esta atividade para um novo envio do aluno?">${csrfInput(ctx.csrf)}<button class="btn btn--outline" type="submit">Reabrir para novo envio</button></form>` : ''}
            ${sub.current === 'pending' ? html`<p><a class="btn btn--primary btn--sm" href="/admin/atividades?filtro=pendentes">Ver envios aguardando</a></p>` : ''}`}
      </section></div>`);
}

// Aba "Atividades" do curso.
function courseTab(ctx, { course, data, rows, shown = 25, error = '' }) {
  const cell = (c) => html`${pill(c.state, c.grade)}${c.state === 'pending' && c.subId ? html` <a href="/admin/atividades/${c.subId}">Avaliar</a>` : ''}`;
  return shell(ctx, 'Atividades do curso', html`${titleRow(course.title, 'Atividades complementares')}${tabs(course, 'atividades')}
    ${error ? html`<div class="alert alert--error" role="alert">${error}</div>` : ''}
    ${!data.lessons.length ? html`<section class="card"><p class="muted">Este curso não tem atividades complementares. Marque a opção <b>Atividade complementar</b> no cadastro de uma aula (aba Módulos e aulas).</p></section>` : html`
    <section class="card"><h2 class="t-card">Alunos e atividades</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Aluno</th>${data.lessons.map((l) => html`<th>${l.title}</th>`)}</tr></thead><tbody>
        ${data.rows.map((u) => html`<tr><td data-l="Aluno"><b>${u.name}</b><br><span class="muted small">${u.email}</span></td>${u.cells.map((c, i) => html`<td data-l="${data.lessons[i].title}">${cell(c)}
          ${['approved', 'waived', 'pending'].includes(c.state) ? '' : html`<details class="dispense"><summary class="small">Dispensar atividade</summary>
            <form method="post" action="/admin/cursos/${course.id}/atividades/dispensar" data-confirm="Dispensar esta atividade para ${u.name}? As próximas aulas serão liberadas.">${csrfInput(ctx.csrf)}
              <input type="hidden" name="user_id" value="${u.id}"><input type="hidden" name="lesson_id" value="${c.lessonId}">
              <div class="field"><label>Motivo (o aluno vê)</label><input type="text" name="reason" maxlength="500" placeholder="Ex.: aluno apresentou a prática presencialmente"></div>
              <button class="btn btn--outline btn--sm" type="submit">Dispensar</button></form></details>`}</td>`)}</tr>`)}
        ${data.rows.length ? '' : html`<tr><td colspan="${data.lessons.length + 1}" class="muted">Nenhum aluno matriculado.</td></tr>`}</tbody></table></div></section>`}
    <section class="card"><h2 class="t-card">Envios e histórico</h2>${table(rows, { showCourse: false, base: `/admin/cursos/${course.id}/atividades`, shown })}</section>`, `/admin/cursos`);
}

module.exports = { studentPanel, adminNote, adminList, evalPage, courseTab };
