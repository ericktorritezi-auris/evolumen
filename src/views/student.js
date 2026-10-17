'use strict';
const { html, raw } = require('../html');
const { shellApp, lumen } = require('../layout');
const { icon } = require('../header');
const { csrfInput } = require('./ui');
const { coverBox, dur, plural } = require('./public');
const files = require('../files');

const fmtDate = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const bar = (pct) => html`<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
const titleRow = (title, sub) => html`<div class="title-row"><h1 class="t-display">${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>`;
const navPath = (user) => (user.role === 'admin' ? '/admin/cursos' : '/meus-cursos');

function meusCursos({ cfg, user, csrf, flash, courses, resume }) {
  const content = html`${titleRow(html`Olá, ${user.name.split(' ')[0]}.`, 'Seus cursos e o seu avanço.')}
  ${resume ? html`<section class="card card--hero resume"><div><span class="eyebrow">Continue de onde parou</span><h2 class="t-card">${resume.course.title}</h2>
      <p class="muted">${resume.lesson.module_title} · ${resume.lesson.title}</p></div>
      <a class="btn btn--primary" href="/curso/${resume.course.slug}/aula/${resume.lesson.id}">Continuar aula</a></section>` : ''}
  ${courses.length
    ? html`<h2 class="t-card">Meus cursos</h2><div class="mgrid">${courses.map((c) => html`<article class="card mcard">
        <a class="mcard__cover" href="/curso/${c.slug}" tabindex="-1" aria-hidden="true">${coverBox(c)}</a>
        <h3 class="t-card"><a href="/curso/${c.slug}">${c.title}</a></h3>
        ${bar(c.pct)}
        <p class="muted small">${c.pct}% concluído · ${c.expires_at ? 'acesso até ' + fmtDate(c.expires_at) : 'acesso vitalício'}</p>
        <a class="btn btn--outline btn--sm" href="/curso/${c.slug}">${c.pct > 0 ? 'Continuar' : 'Começar'}</a></article>`)}</div>`
    : html`<section class="card card--hero"><div class="empty">${lumen('pensa', 120)}<div><h2 class="t-card">Você ainda não tem cursos</h2>
        <p class="muted">Quando você se matricular em um curso, ele aparece aqui, com o seu progresso.</p>
        <a class="btn btn--outline btn--sm" href="/#cursos">Ver os cursos</a></div></div></section>`}`;
  return shellApp({ cfg, user, csrf, flash, path: '/meus-cursos', title: 'Meus cursos', content });
}

function lessonRow(course, l, ctx) {
  const done = ctx.progress.done.has(String(l.id));
  const cur = ctx.current && ctx.current.id === l.id;
  return html`<li class="lrow${done ? ' is-done' : ''}${cur ? ' is-current' : ''}"><a href="/curso/${course.slug}/aula/${l.id}"${cur ? raw(' aria-current="true"') : ''}>
    <span class="lrow__st" aria-hidden="true">${done ? icon('check', 16) : (cur ? '▶' : '○')}</span><span class="lrow__t">${l.title}</span>
    ${l.duration_min ? html`<span class="muted small">${dur(l.duration_min)}</span>` : ''}<span class="sr">${done ? 'concluída' : ''}</span></a></li>`;
}

function curriculumList(course, cur, ctx) {
  return html`<div class="syl syl--app">${cur.map((m, i) => {
    const doneN = m.lessons.filter((l) => ctx.progress.done.has(String(l.id))).length;
    const open = ctx.current ? m.lessons.some((l) => l.id === ctx.current.id) : i === 0;
    return html`<details ${open ? raw('open') : ''}><summary><span>Módulo ${i + 1} · ${m.title}</span><span class="muted small">${doneN}/${m.lessons.length}</span></summary>
      <ul class="lrows">${m.lessons.map((l) => lessonRow(course, l, ctx))}</ul></details>`;
  })}</div>`;
}

function cursoHome({ cfg, user, csrf, flash, course, cur, progress, next, access }) {
  const content = html`<a class="back" href="${navPath(user)}">← ${user.role === 'admin' ? 'Cursos' : 'Meus cursos'}</a>
  ${user.role === 'admin' ? html`<div class="alert alert--info">Você está vendo como administrador. Seu progresso aqui é de teste.</div>` : ''}
  ${titleRow(course.title, course.summary)}
  <section class="card"><div class="resume"><div><span class="eyebrow">Seu progresso</span>
    <p class="muted">${progress.count} de ${progress.total} ${progress.total === 1 ? 'aula concluída' : 'aulas concluídas'} · ${progress.pct}%</p>${bar(progress.pct)}
    <p class="muted small">${access.expires_at ? 'Acesso até ' + fmtDate(access.expires_at) : 'Acesso vitalício'}</p></div>
    ${next ? html`<a class="btn btn--primary" href="/curso/${course.slug}/aula/${next.id}">${progress.count ? 'Continuar' : 'Começar o curso'}</a>` : ''}</div></section>
  ${cur.length ? html`<h2 class="t-card">Conteúdo do curso</h2>${curriculumList(course, cur, { progress, current: null })}`
    : html`<section class="card empty">${lumen('pensa', 90)}<p class="muted">O conteúdo deste curso está sendo preparado.</p></section>`}`;
  return shellApp({ cfg, user, csrf, flash, path: navPath(user), title: course.title, content });
}

function aula({ cfg, user, csrf, flash, course, cur, lesson, flat, progress, access }) {
  const idx = flat.findIndex((l) => l.id === lesson.id);
  const prev = flat[idx - 1]; const next = flat[idx + 1];
  const done = progress.done.has(String(lesson.id));
  const link = (l) => `/curso/${course.slug}/aula/${l.id}`;
  const content = html`<a class="back" href="/curso/${course.slug}">← ${course.title}</a>
  <div class="lesson">
    <div class="lesson__main">
      <p class="muted small">${lesson.module_title} · Aula ${idx + 1} de ${flat.length}</p>
      ${lesson.youtube_id
        ? html`<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${lesson.youtube_id}?rel=0" title="${lesson.title}" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
        : html`<div class="player player--empty">${lumen('pensa', 90)}<p class="muted">O vídeo desta aula ainda não foi publicado.</p></div>`}
      <h1 class="t-display t-display--sm">${lesson.title}</h1>
      <div class="lesson__act">
        <form method="post" action="${link(lesson)}/concluir">${csrfInput(csrf)}<input type="hidden" name="done" value="${done ? '0' : '1'}">
          <button class="btn ${done ? 'btn--ghost' : 'btn--primary'}" type="submit">${done ? html`${icon('check', 18)} Concluída (desmarcar)` : 'Marcar como concluída'}</button></form>
        ${prev ? html`<a class="btn btn--ghost" href="${link(prev)}">← Anterior</a>` : ''}
        ${next ? html`<a class="btn btn--outline" href="${link(next)}">Próxima aula →</a>` : ''}
      </div>
      ${lesson.description ? html`<section class="blk"><h2 class="t-card">Sobre a aula</h2>${String(lesson.description).split(/\n{2,}/).map((p) => html`<p>${p}</p>`)}</section>` : ''}
      ${lesson.files.length ? html`<section class="blk"><h2 class="t-card">Apostilas e materiais · ${lesson.files.length}</h2>
        <ul class="dl">${lesson.files.map((f) => html`<li>${icon('file', 20)}<div><b>${f.label}</b><span class="muted small">${f.filename} · ${files.humanSize(f.size_bytes)}</span></div>
          <a class="btn btn--outline btn--sm" href="/arquivos/${f.file_id}">${icon('download', 16)} Baixar</a></li>`)}</ul></section>` : ''}
    </div>
    <aside class="lesson__side"><div class="card"><span class="eyebrow">Seu progresso</span><p class="muted small">${progress.pct}% concluído</p>${bar(progress.pct)}</div>
      <h2 class="t-card">Conteúdo do curso</h2>${curriculumList(course, cur, { progress, current: lesson })}</aside>
  </div>`;
  return shellApp({ cfg, user, csrf, flash, path: navPath(user), title: lesson.title, content });
}

module.exports = { meusCursos, cursoHome, aula, bar, titleRow };
