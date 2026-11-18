'use strict';
// Lembretes do administrador (2.4.0): escolher o grupo, marcar quem recebe, editar a mensagem, confirmar; e a página pública de descadastro.
const { html, raw } = require('../html');
const { shellApp, shellPublic } = require('../layout');
const { csrfInput } = require('./ui');
const { titleRow } = require('./student');
const { tabs } = require('./admin');
const N = require('../nudges');

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');

function head(ctx, { kind, course }) {
  return kind === 'afiliado'
    ? { path: '/admin/afiliados', base: '/admin/afiliados/lembretes', back: html`<a class="back" href="/admin/afiliados">← Afiliados</a>`, title: 'Reativar afiliados', sub: 'Lembrete por e-mail para quem nunca vendeu ou está sem vender há tempo. Só envia quando você confirma.' }
    : { path: '/admin/cursos', base: `/admin/cursos/${course.id}/lembretes`, back: html`<a class="back" href="/admin/cursos/${course.id}/matriculas">← Matrículas</a>`, title: 'Chamar quem não começou', sub: 'Lembrete por e-mail e campainha para quem ainda não começou o curso ou está parado. Só envia quando você confirma.' };
}

function stateCell(p) {
  return p.status === 'optout' ? html`<span class="pill pill--draft">Pediu para não receber</span>` : p.status === 'recent' ? html`<span class="pill pill--warn">Recebeu há menos de ${N.MIN_DAYS} dias</span>` : html`<span class="pill pill--ok">Vai receber</span>`;
}

function listPage(ctx, { kind, course, group, people, selected, subject, message, error = '' }) {
  const h = head(ctx, { kind, course });
  const c = N.counts(people, selected);
  const dl = kind === 'afiliado';
  const content = html`${h.back}${titleRow(h.title, h.sub)}${dl ? '' : tabs(course, 'matriculas')}
    ${error ? html`<div class="alert alert--error" role="alert">${error}</div>` : ''}
    <section class="card"><h2 class="t-card">Quem vai receber</h2>
      <div class="achips" role="navigation" aria-label="Grupo">${N.groupsOf(kind).map(([k, label]) => html`<a class="achip${k === group ? ' on' : ''}" href="${h.base}?grupo=${k}"${k === group ? raw(' aria-current="page"') : ''}>${label}</a>`)}</div>
      <p class="muted small">${dl ? 'Só afiliados ativos.' : 'Só alunos com acesso ativo e vigente.'} <b>${c.total} ${c.total === 1 ? 'pessoa' : 'pessoas'}</b> neste grupo:
        <span class="pill pill--ok">${c.send} ${c.send === 1 ? 'pode receber' : 'podem receber'}</span>
        ${c.recent ? html`<span class="pill pill--warn">${c.recent} com lembrete há menos de ${N.MIN_DAYS} dias</span>` : ''}
        ${c.optout ? html`<span class="pill pill--draft">${c.optout} pediram para não receber</span>` : ''}</p>
      ${c.total ? '' : html`<p class="muted">Ninguém neste grupo agora.</p>`}</section>
    ${c.total ? html`<form method="post" action="${h.base}/revisar" novalidate data-nudge>${csrfInput(ctx.csrf)}<input type="hidden" name="grupo" value="${group}">
      <section class="card"><h2 class="t-card">Escolha as pessoas</h2>
        <p class="small"><button type="button" class="btn btn--ghost btn--sm" data-check-all="1">Marcar todos</button> <button type="button" class="btn btn--ghost btn--sm" data-check-all="0">Desmarcar todos</button></p>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>${dl ? 'Afiliado' : 'Aluno'}</th><th>${dl ? 'Cupom' : 'Matrícula'}</th><th>${dl ? 'Última venda' : 'Última aula'}</th><th>Último lembrete</th><th>Situação</th></tr></thead><tbody>
          ${people.map((p) => html`<tr><td><input type="checkbox" name="sel" value="${p.id}" aria-label="Incluir ${p.name}"${p.status !== 'send' ? raw(' disabled') : (selected === null || selected.has(p.id)) ? raw(' checked') : ''} data-nudge-sel></td>
            <td data-l="${dl ? 'Afiliado' : 'Aluno'}"><b>${p.name}</b><br><span class="muted small">${p.email}</span></td>
            <td data-l="${dl ? 'Cupom' : 'Matrícula'}">${dl ? (p.code || '—') : fmtDate(p.since)}</td>
            <td data-l="${dl ? 'Última venda' : 'Última aula'}">${dl ? (p.lastSale ? fmtDate(p.lastSale) : 'nunca vendeu') : (p.lastAt ? fmtDate(p.lastAt) : 'nenhuma')}</td>
            <td data-l="Último lembrete" class="muted">${p.lastReminder ? fmtDate(p.lastReminder) : 'nunca'}</td><td data-l="Situação">${stateCell(p)}</td></tr>`)}</tbody></table></div></section>
      <section class="card"><h2 class="t-card">Mensagem</h2>
        <div class="field"><label for="n-subject">Assunto</label><input id="n-subject" name="subject" maxlength="140" value="${subject}" required></div>
        <div class="field"><label for="n-message">Mensagem (você pode editar)</label><textarea id="n-message" name="message" rows="9" maxlength="3000" required>${message}</textarea>
          <div class="field__msg">${dl ? html`<code>{nome}</code> vira o primeiro nome e <code>{cupom}</code> o cupom de cada afiliado.` : html`<code>{nome}</code> vira o primeiro nome de cada aluno e <code>{curso}</code> o nome do curso.`}</div></div>
        <div class="alert alert--info">Vai por <b>${dl ? 'e-mail' : 'e-mail e campainha'}</b>. Cada pessoa recebe no máximo 1 lembrete a cada ${N.MIN_DAYS} dias, e todo e-mail leva o link “não quero mais receber lembretes”.</div>
        <div class="row"><button class="btn btn--outline" type="submit" formaction="${h.base}/teste">Enviar e-mail de teste para mim</button><button class="btn btn--primary" type="submit"${c.send ? '' : raw(' disabled')}>Revisar e enviar</button></div></section></form>` : ''}`;
  return shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path: h.path, title: h.title, content });
}

function confirmPage(ctx, { kind, course, group, people, selected, subject, message, token }) {
  const h = head(ctx, { kind, course });
  const c = N.counts(people, selected);
  const dl = kind === 'afiliado';
  const label = N.groupsOf(kind).find(([k]) => k === group)[1];
  const content = html`${h.back}${titleRow('Confirmar envio', '')}
    <section class="card" style="max-width:680px"><h2 class="t-card">Enviar para ${c.chosen} ${dl ? (c.chosen === 1 ? 'afiliado' : 'afiliados') : (c.chosen === 1 ? 'aluno' : 'alunos')}?</h2>
      <p>Você vai enviar <b>“${subject}”</b> ${dl ? '' : html`para o curso <b>${course.title}</b>, `}grupo <b>${label}</b>, por ${dl ? 'e-mail' : 'e-mail e campainha'}.</p>
      <ul class="muted small">${c.unchecked ? html`<li>${c.unchecked} desmarcado${c.unchecked === 1 ? '' : 's'} por você</li>` : ''}${c.recent ? html`<li>${c.recent} pulado${c.recent === 1 ? '' : 's'}: já receberam lembrete nos últimos ${N.MIN_DAYS} dias</li>` : ''}${c.optout ? html`<li>${c.optout} pulado${c.optout === 1 ? '' : 's'}: pediram para não receber</li>` : ''}</ul>
      <div class="alert alert--error" role="note">Depois de enviado, não dá para desfazer.</div>
      <form method="post" action="${h.base}/enviar" class="row">${csrfInput(ctx.csrf)}<input type="hidden" name="grupo" value="${group}"><input type="hidden" name="token" value="${token}">
        <input type="hidden" name="subject" value="${subject}"><input type="hidden" name="message" value="${message}">
        ${people.filter((p) => p.status === 'send' && selected.has(p.id)).map((p) => html`<input type="hidden" name="sel" value="${p.id}">`)}
        <button class="btn btn--primary" type="submit">Sim, enviar agora</button>
        <button class="btn btn--outline" type="submit" formaction="${h.base}/voltar">Voltar e revisar</button></form></section>`;
  return shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path: h.path, title: 'Confirmar envio', content });
}

// Página pública: o link do e-mail abre a confirmação; só o botão (POST) descadastra, para um programa de leitura de links não descadastrar sozinho.
function optoutPage({ cfg, user, csrf, email, token, state }) {
  const body = state === 'done'
    ? html`<h1 class="t-display t-display--sm">Lembretes por e-mail</h1><p class="muted">${email}</p><p>Você não vai mais receber lembretes de curso nem de afiliados da EvoLumen Academy.</p>
        <p class="muted small">E-mails importantes (compra, acesso, certificado, redefinição de senha) continuam chegando. Mudou de ideia?</p>
        <form method="post" action="/lembretes/retomar">${csrfInput(csrf)}<input type="hidden" name="e" value="${email}"><input type="hidden" name="t" value="${token}"><button class="btn btn--outline" type="submit">Voltar a receber lembretes</button></form>`
    : state === 'back'
      ? html`<h1 class="t-display t-display--sm">Lembretes por e-mail</h1><p class="muted">${email}</p><p>Pronto: você voltou a receber lembretes.</p>`
      : state === 'invalid'
        ? html`<h1 class="t-display t-display--sm">Link inválido</h1><p class="muted">Este link não é válido. Use o link do e-mail mais recente ou escreva para nós.</p>`
        : html`<h1 class="t-display t-display--sm">Lembretes por e-mail</h1><p class="muted">${email}</p><p>Quer deixar de receber lembretes de curso e de afiliados da EvoLumen Academy?</p>
          <form method="post" action="/lembretes/cancelar">${csrfInput(csrf)}<input type="hidden" name="e" value="${email}"><input type="hidden" name="t" value="${token}"><button class="btn btn--primary" type="submit">Não quero mais receber lembretes</button></form>`;
  return shellPublic({ cfg, user, title: 'Lembretes por e-mail', content: html`<section class="card" style="max-width:560px;margin:24px auto">${body}</section>`, robots: 'noindex, nofollow' });
}

module.exports = { listPage, confirmPage, optoutPage };
