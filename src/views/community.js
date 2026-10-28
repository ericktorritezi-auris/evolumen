'use strict';
// Telas da comunidade: fórum por aula, avaliação do curso e o painel do administrador.
const { html, raw } = require('../html');
const { shellApp } = require('../layout');
const { csrfInput, shortName } = require('./ui');
const fmtDateTime = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

const titleRow = (title, sub) => html`<div class="title-row"><h1 class="t-display">${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>`;
const firstLast = shortName;
const shell = (ctx, title, content, path) => shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path, title, content });

function postView(p, { csrf, user, base, admin, isReply }) {
  const mine = p.user_id === user.id;
  return html`<article class="fpost${p.by_admin ? ' fpost--prof' : ''}${p.status === 'hidden' ? ' is-hidden' : ''}${isReply ? ' fpost--reply' : ''}" id="post-${p.id}">
    <header class="fpost__head"><b>${p.by_admin ? p.author : firstLast(p.author)}</b>${p.by_admin ? html` <span class="pill pill--star">Professor</span>` : ''}${p.status === 'hidden' ? html` <span class="pill pill--draft">Oculta</span>` : ''}
      <span class="muted small">${fmtDateTime(p.created_at)}</span></header>
    <div class="fpost__body">${p.body}</div>
    <div class="fpost__act">
      ${admin ? html`<form method="post" action="/admin/forum/${p.id}/${p.status === 'hidden' ? 'mostrar' : 'ocultar'}" class="inline">${csrfInput(csrf)}<input type="hidden" name="back" value="${base}#post-${p.id}"><button class="btn btn--ghost btn--sm" type="submit">${p.status === 'hidden' ? 'Mostrar' : 'Ocultar'}</button></form>` : ''}
      ${mine && !p.by_admin && !admin && !(p.replies && p.replies.length) ? html`<form method="post" action="${base}/forum/${p.id}/excluir" class="inline" data-confirm="Apagar esta mensagem?">${csrfInput(csrf)}<button class="btn btn--ghost btn--sm" type="submit">Apagar</button></form>` : ''}
    </div></article>`;
}

function forumSection({ csrf, user, course, lesson, posts, enabled, error }) {
  const admin = user.role === 'admin';
  const base = `/curso/${course.slug}/aula/${lesson.id}`;
  if (!enabled) return html`<section class="blk forum" id="forum"><h2 class="t-card">Dúvidas da aula</h2><p class="muted">O fórum está desativado no momento.</p></section>`;
  const total = posts.reduce((n, p) => n + 1 + p.replies.length, 0);
  return html`<section class="blk forum" id="forum"><h2 class="t-card">Dúvidas da aula${total ? html` · ${total}` : ''}</h2>
    <p class="muted small">Pergunte aqui. Só alunos com acesso ao curso leem e escrevem, e o professor responde.</p>
    ${error ? html`<div class="field__msg field__msg--err">${error}</div>` : ''}
    <form method="post" action="${base}/forum" class="form forum__new">${csrfInput(csrf)}
      <div class="field"><label for="fbody">${admin ? 'Escrever no fórum' : 'Sua pergunta'}</label><textarea id="fbody" name="body" rows="3" maxlength="2000" required></textarea></div>
      <div class="row"><button class="btn btn--primary btn--sm" type="submit">${admin ? 'Publicar' : 'Enviar pergunta'}</button></div></form>
    ${posts.length ? posts.map((p) => html`<div class="fthread">${postView(p, { csrf, user, base, admin })}
      ${p.replies.map((x) => postView(x, { csrf, user, base, admin, isReply: true }))}
      <details class="freply"><summary class="small">Responder</summary><form method="post" action="${base}/forum" class="form">${csrfInput(csrf)}<input type="hidden" name="parent" value="${p.id}">
        <div class="field"><label class="sr" for="r${p.id}">Sua resposta</label><textarea id="r${p.id}" name="body" rows="2" maxlength="2000" required></textarea></div>
        <div class="row"><button class="btn btn--outline btn--sm" type="submit">Responder</button></div></form></details></div>`)
      : html`<p class="muted">Ainda não há perguntas nesta aula.</p>`}</section>`;
}

function stars(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }

function reviewCard({ csrf, course, review, kind = 'course' }) {
  const v = review || {};
  const prod = kind === 'download';
  const noun = prod ? 'produto' : 'curso';
  return html`<section class="card review" id="avaliacao"><h2 class="t-card">${review ? `Sua avaliação do ${noun}` : prod ? 'O que você achou do produto?' : 'Como foi o curso?'}</h2>
    <p class="muted small">${review ? 'Obrigado! Você pode mudar sua avaliação quando quiser.' : prod ? 'Você já baixou o produto. Sua opinião ajuda quem está decidindo e ajuda o professor a melhorar.' : 'Você concluiu o curso. Sua opinião ajuda o professor a melhorar.'}</p>
    <form method="post" action="/curso/${course.slug}/avaliar" class="form">${csrfInput(csrf)}
      <fieldset class="fieldset"><legend>Nota de 1 a 5 estrelas</legend><div class="starpick">
        ${[1, 2, 3, 4, 5].map((n) => html`<label class="starpick__o"><input type="radio" name="stars" value="${n}"${Number(v.stars) === n ? raw(' checked') : ''} required><span>${n} ${n === 1 ? 'estrela' : 'estrelas'}</span></label>`)}</div></fieldset>
      <div class="field"><label for="nps">De 0 a 10, quanto você indicaria ${prod ? 'este produto' : 'este curso'} a um amigo?</label><select id="nps" name="nps" required><option value="">Escolha</option>
        ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => html`<option value="${n}"${v.nps != null && Number(v.nps) === n ? raw(' selected') : ''}>${n}</option>`)}</select></div>
      <div class="field"><label for="comment">Quer contar mais? (opcional)</label><textarea id="comment" name="comment" rows="3" maxlength="1000">${v.comment || ''}</textarea></div>
      <div class="field"><label class="chk"><input type="checkbox" name="consent" value="1"${v.consent_publish ? raw(' checked') : ''}> Autorizo publicar este depoimento na página ${prod ? 'do produto' : 'do curso'}, com meu primeiro nome e a inicial do sobrenome.</label>
        <div class="field__msg">Opcional. Só vale se você escrever um texto, e o professor decide se publica. Você pode retirar o aceite aqui quando quiser.${v.published ? ' Seu depoimento está publicado agora.' : ''}</div></div>
      <div class="row"><button class="btn btn--primary" type="submit">${review ? 'Atualizar avaliação' : 'Enviar avaliação'}</button></div></form></section>`;
}

// ---- administrador: fórum e avaliações ----
const FILTERS = { open: 'Sem resposta', all: 'Todas', hidden: 'Ocultas' };
function adminForum(ctx, { rows, filter, courses, curso, reviews, comments, openN }) {
  const sel = (id, name, value, opts) => html`<select id="${id}" name="${name}">${opts.map(([v, l]) => html`<option value="${v}"${String(value) === String(v) ? raw(' selected') : ''}>${l}</option>`)}</select>`;
  const content = html`${titleRow('Fórum e avaliações', 'Dúvidas dos alunos por aula e a opinião de quem concluiu os cursos.')}
  <div class="stats"><div class="stat"><span class="muted">Dúvidas sem resposta</span><b class="t-card${openN ? ' down' : ''}">${openN}</b></div></div>
  <form method="get" action="/admin/forum" class="form form--grid filters">
    <div class="field"><label for="f">Mostrar</label>${sel('f', 'f', filter, Object.entries(FILTERS))}</div>
    <div class="field"><label for="curso">Curso</label>${sel('curso', 'curso', curso || '', [['', 'Todos'], ...courses.map((c) => [c.id, c.title])])}</div>
    <div class="row"><button class="btn btn--outline" type="submit">Filtrar</button></div></form>
  <section class="card"><h2 class="t-card">Dúvidas</h2>${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Aluno</th><th>Aula</th><th>Pergunta</th><th>Situação</th><th></th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td data-l="Data">${fmtDateTime(r.created_at)}</td><td data-l="Aluno">${r.author}</td><td data-l="Aula">${r.lesson_title}<br><span class="muted small">${r.course_title}</span></td>
      <td data-l="Pergunta">${r.body.length > 140 ? r.body.slice(0, 140) + '…' : r.body}</td>
      <td data-l="Situação">${r.status === 'hidden' ? html`<span class="pill pill--draft">Oculta</span>` : r.answers ? html`<span class="pill pill--ok">Respondida</span>` : html`<span class="pill">Sem resposta</span>`}</td>
      <td class="tbl__act"><a class="btn btn--primary btn--sm" href="/curso/${r.slug}/aula/${r.lesson_id}#post-${r.id}">Abrir e responder</a></td></tr>`)}</tbody></table></div>` : html`<p class="muted">Nada por aqui.</p>`}</section>
  <section class="card" id="avaliacoes"><h2 class="t-card">Avaliações dos cursos</h2>
    ${reviews.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Curso</th><th>Avaliações</th><th>Média</th><th>NPS</th></tr></thead><tbody>
      ${reviews.map((r) => html`<tr><td data-l="Curso">${r.title}</td><td data-l="Avaliações">${r.n}</td><td data-l="Média">${String(r.stars).replace('.', ',')} ★</td><td data-l="NPS">${r.nps}</td></tr>`)}</tbody></table></div>
      <p class="muted small">NPS = % de notas 9 e 10 menos % de notas de 0 a 6. Vai de −100 a 100.</p>` : html`<p class="muted">Ainda não há avaliações.</p>`}
    ${comments.length ? html`<h3 class="t-card" id="depoimentos">Comentários e depoimentos</h3><p class="muted small">Só podem ser publicados os comentários em que o aluno deu o aceite. Na página pública aparecem com o primeiro nome e a inicial do sobrenome.</p>${comments.map((c) => html`<article class="fpost"><header class="fpost__head"><b>${firstLast(c.author)}</b> <span class="muted small">${stars(c.stars)} · nota ${c.nps} · ${c.course_title}</span>${c.published ? html` <span class="pill pill--ok">Publicado</span>` : c.consent_publish ? html` <span class="pill">Aceite dado</span>` : html` <span class="pill pill--draft">Sem aceite</span>`}</header><div class="fpost__body">${c.comment}</div>
      ${c.published ? html`<form method="post" action="/admin/forum/avaliacao/${c.id}/despublicar" class="inline">${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">Retirar da página pública</button></form>`
      : c.consent_publish ? html`<form method="post" action="/admin/forum/avaliacao/${c.id}/publicar" class="inline">${csrfInput(ctx.csrf)}<input type="hidden" name="ver" value="${c.ver}"><button class="btn btn--primary btn--sm" type="submit">Publicar depoimento</button></form>` : ''}</article>`)}` : ''}</section>`;
  return shell(ctx, 'Fórum e avaliações', content, '/admin/forum');
}

module.exports = { forumSection, reviewCard, adminForum, stars };
