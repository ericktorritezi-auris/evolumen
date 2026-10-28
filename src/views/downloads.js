'use strict';
// Telas do limite de downloads: pedido do aluno e fila do administrador.
const { html } = require('../html');
const { shellApp } = require('../layout');
const { csrfInput } = require('./ui');
const fmtDateTime = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const shell = (ctx, title, content, path) => shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path, title, content });
const titleRow = (title, sub) => html`<div class="title-row"><h1 class="t-display">${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>`;

function pedido(ctx, { course, file, st, error, reason }) {
  const content = html`<a class="back" href="/curso/${course.slug}">← ${course.title}</a>
  ${titleRow('Pedir novo download', 'Você já baixou este arquivo todas as vezes disponíveis.')}
  <section class="card"><p><b>${file.label || file.filename}</b><br><span class="muted small">${file.filename} · ${st.used} de ${st.allowed} downloads usados</span></p>
    ${error ? html`<div class="alert alert--error" role="alert">${error}</div>` : ''}
    ${st.pending ? html`<div class="alert alert--info">Seu pedido está em análise. Você receberá um aviso na campainha com a resposta.</div>`
    : html`<p class="muted">Conte por que precisa baixar de novo (por exemplo, troca de aparelho ou arquivo perdido). O administrador analisa e avisa você pela campainha.</p>
    <form method="post" action="/arquivos/${file.file_id}/solicitar" class="form">${csrfInput(ctx.csrf)}
      <div class="field"><label for="reason">Motivo do pedido</label><textarea id="reason" name="reason" rows="4" minlength="10" maxlength="500" required>${reason || ''}</textarea></div>
      <div class="row"><button class="btn btn--primary" type="submit">Enviar pedido</button> <a class="btn btn--ghost" href="/curso/${course.slug}">Voltar</a></div></form>`}</section>`;
  return shell(ctx, 'Pedir novo download', content, '/meus-cursos');
}

function admin(ctx, { pending, history }) {
  const content = html`${titleRow('Pedidos de download', 'Alunos que usaram todos os downloads de um arquivo e pedem mais um.')}
  <section class="card"><h2 class="t-card">Em análise (${pending.length})</h2>
  ${pending.length ? pending.map((r) => html`<article class="fpost"><header class="fpost__head"><b>${r.student}</b> <span class="muted small">${r.email} · ${fmtDateTime(r.created_at)}</span></header>
    <p class="small"><b>${r.course}</b> — ${r.filename}<br><span class="muted">Já baixou ${r.used} ${r.used === 1 ? 'vez' : 'vezes'}${r.extra ? ` (${r.extra} liberada${r.extra === 1 ? '' : 's'} antes)` : ''}.</span></p>
    <div class="fpost__body">${r.reason}</div>
    <form method="post" action="/admin/downloads/${r.id}/decidir" class="form form--grid">${csrfInput(ctx.csrf)}
      <div class="field span2"><label for="resp${r.id}">Resposta ao aluno (opcional)</label><input id="resp${r.id}" name="response" maxlength="300"></div>
      <div class="row"><button class="btn btn--primary btn--sm" type="submit" name="decision" value="approve">Liberar mais 1 download</button>
        <button class="btn btn--ghost btn--sm" type="submit" name="decision" value="deny">Negar</button></div></form></article>`)
  : html`<p class="muted">Nenhum pedido em análise.</p>`}</section>
  <section class="card"><h2 class="t-card">Decididos recentemente</h2>${history.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Quando</th><th>Aluno</th><th>Produto / arquivo</th><th>Decisão</th></tr></thead><tbody>
    ${history.map((r) => html`<tr><td data-l="Quando">${fmtDateTime(r.decided_at || r.created_at)}</td><td data-l="Aluno">${r.student}</td><td data-l="Produto">${r.course}<br><span class="muted small">${r.filename}</span></td>
      <td data-l="Decisão"><span class="pill${r.status === 'approved' ? ' pill--ok' : ' pill--draft'}">${r.status === 'approved' ? 'Liberado' : 'Negado'}</span>${r.response ? html`<br><span class="muted small">${r.response}</span>` : ''}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Ainda não há decisões.</p>`}</section>`;
  return shell(ctx, 'Pedidos de download', content, '/admin/downloads');
}
module.exports = { pedido, admin };
