'use strict';
const { html, raw } = require('../html');
const { shellApp, lumen } = require('../layout');
const { icon } = require('../header');
const { forumSection, reviewCard } = require('./community');
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
  const locked = !!(ctx.ov && ctx.ov.modules[l.module_id] && ctx.ov.modules[l.module_id].locked && !ctx.admin);
  return html`<li class="lrow${done ? ' is-done' : ''}${cur ? ' is-current' : ''}${locked ? ' is-locked' : ''}"><a href="/curso/${course.slug}/aula/${l.id}"${cur ? raw(' aria-current="true"') : ''}>
    <span class="lrow__st" aria-hidden="true">${locked ? icon('lock', 16) : done ? icon('check', 16) : (cur ? '▶' : '○')}</span><span class="lrow__t">${l.title}</span>
    ${l.duration_min ? html`<span class="muted small">${dur(l.duration_min)}</span>` : ''}<span class="sr">${locked ? 'bloqueada até passar no quiz do módulo anterior' : done ? 'concluída' : ''}</span></a></li>`;
}

function quizRow(course, m, ov) {
  const st = ov && ov.modules[m.id]; const q = st && st.quiz;
  if (!q) return '';
  const href = `/curso/${course.slug}/avaliacao/${q.id}`;
  const label = q.passed ? html`Aprovado · nota ${q.best != null ? q.best.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : ''}` : st.locked ? 'Bloqueado' : st.quizAvailable ? (q.used ? `${q.left} ${q.left === 1 ? 'tentativa restante' : 'tentativas restantes'}` : 'Liberado') : 'Conclua as aulas do módulo para liberar';
  const cls = q.passed ? 'is-done' : (st.quizAvailable ? 'is-current' : 'is-locked');
  return html`<li class="lrow lrow--quiz ${cls}">${st.quizAvailable || q.passed ? html`<a href="${href}">` : html`<span class="lrow__a">`}
    <span class="lrow__st" aria-hidden="true">${q.passed ? icon('check', 16) : st.quizAvailable ? '▶' : icon('lock', 16)}</span><span class="lrow__t">Quiz do módulo</span><span class="muted small">${label}</span>${st.quizAvailable || q.passed ? raw('</a>') : raw('</span>')}</li>`;
}

// Linha "Prova final" no fim da lista de módulos: bloqueada, liberada ou aprovada.
function finalRow(course, ctx) {
  const f = ctx.ov && ctx.ov.final;
  if (!f || ctx.admin) return '';
  const href = `/curso/${course.slug}/avaliacao/${f.id}`;
  const label = f.passed ? `Aprovado · nota ${f.best != null ? Number(f.best).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : ''}` : f.unlocked ? (f.used ? 'Liberada · continue' : 'Liberada') : 'Libera ao assistir 50% da última aula';
  const open = f.passed || f.unlocked;
  return html`<div class="syl__final"><ul class="lrows"><li class="lrow lrow--final ${f.passed ? 'is-done' : open ? 'is-current' : 'is-locked'}" data-final-row data-href="${href}">${open ? html`<a href="${href}">` : html`<span class="lrow__a">`}
    <span class="lrow__st" aria-hidden="true">${f.passed ? icon('check', 16) : open ? '▶' : icon('lock', 16)}</span><span class="lrow__t">Prova final</span><span class="muted small" data-final-label>${label}</span>${open ? raw('</a>') : raw('</span>')}</li></ul></div>`;
}

function curriculumList(course, cur, ctx) {
  return html`<div class="syl syl--app">${cur.map((m, i) => {
    const doneN = m.lessons.filter((l) => ctx.progress.done.has(String(l.id))).length;
    const open = ctx.current ? m.lessons.some((l) => l.id === ctx.current.id) : i === 0;
    return html`<details ${open ? raw('open') : ''}><summary><span>Módulo ${i + 1} · ${m.title}</span><span class="muted small">${doneN}/${m.lessons.length}</span></summary>
      <ul class="lrows">${m.lessons.map((l) => lessonRow(course, l, ctx))}${quizRow(course, m, ctx.ov)}</ul></details>`;
  })}${finalRow(course, ctx)}</div>`;
}

function examCard(course, ov) {
  const f = ov.final; const c = ov.cert;
  if (!f && !c) return '';
  const fmt = (v) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
  return html`<section class="card"><span class="eyebrow">Prova final e certificado</span>
    <ul class="checks">
      <li class="${c.pctOk ? 'is-ok' : ''}">${c.pctOk ? '✔' : '○'} Concluir 95% do curso <span class="muted small">(você está em ${c.pct}%${c.pctOk ? '' : `, faltam ${c.missing} ${c.missing === 1 ? 'aula' : 'aulas'}`})</span></li>
      ${f ? html`<li class="${f.passed ? 'is-ok' : ''}">${f.passed ? '✔' : '○'} Passar na prova final <span class="muted small">(nota mínima ${fmt(f.pass)}${f.passed ? ', sua nota ' + fmt(f.best) : ''})</span></li>` : ''}
    </ul>
    ${f && !f.passed ? (f.unlocked ? html`<a class="btn btn--primary" href="/curso/${course.slug}/avaliacao/${f.id}">${f.used ? 'Continuar a prova final' : 'Fazer a prova final'}</a><p class="muted small">Tentativas usadas: ${f.used} de ${f.limit}.</p>`
      : html`<p class="muted small">${icon('lock', 14)} ${f.why}</p>`) : ''}
    ${c.eligible ? html`<a class="btn btn--primary" href="/certificados">${icon('cert', 18)} Ver meu certificado</a>`
      : (f && f.passed && !c.pctOk ? html`<p class="muted small">Você já passou na prova. O certificado sai assim que você concluir 95% do curso.</p>` : '')}
  </section>`;
}

function cursoHome({ cfg, user, csrf, flash, course, cur, progress, next, access, ov, review }) {
  const content = html`<a class="back" href="${navPath(user)}">← ${user.role === 'admin' ? 'Cursos' : 'Meus cursos'}</a>
  ${user.role === 'admin' ? html`<div class="alert alert--info">Você está vendo como administrador. Seu progresso aqui é de teste.</div>` : ''}
  ${titleRow(course.title, course.summary)}
  <section class="card"><div class="resume"><div><span class="eyebrow">Seu progresso</span>
    <p class="muted">${progress.count} de ${progress.total} ${progress.total === 1 ? 'aula concluída' : 'aulas concluídas'} · ${progress.pct}%</p>${bar(progress.pct)}
    <p class="muted small">${access.expires_at ? 'Acesso até ' + fmtDate(access.expires_at) : 'Acesso vitalício'}</p></div>
    ${next ? html`<a class="btn btn--primary" href="/curso/${course.slug}/aula/${next.id}">${progress.count ? 'Continuar' : 'Começar o curso'}</a>` : ''}</div></section>
  ${ov && user.role !== 'admin' ? examCard(course, ov) : ''}
  ${review ? reviewCard({ csrf, course, review: review.id ? review : null }) : ''}
  ${cur.length ? html`<h2 class="t-card">Conteúdo do curso</h2>${curriculumList(course, cur, { progress, current: null, ov, admin: user.role === 'admin' })}`
    : html`<section class="card empty">${lumen('pensa', 90)}<p class="muted">O conteúdo deste curso está sendo preparado.</p></section>`}`;
  return shellApp({ cfg, user, csrf, flash, path: navPath(user), title: course.title, content });
}

// Contador do tempo assistido da última aula: mostra quanto falta para liberar a prova final.
function meter(course, lesson, ov, user) {
  const f = ov && ov.final;
  if (!f || user.role === 'admin' || !lesson.youtube_id || !f.lastLesson || f.lastLesson.id !== lesson.id || f.passed) return '';
  const pct = f.unlocked && f.watchPct < 50 ? 50 : f.watchPct;
  const href = `/curso/${course.slug}/avaliacao/${f.id}`;
  return html`<section class="wmeter${f.unlocked ? ' is-open' : ''}" data-wmeter data-href="${href}">
    <div class="wmeter__top"><span>Tempo assistido desta aula</span><b data-wpct>${pct}%</b></div>
    <div class="bar wmeter__bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span data-wfill style="width:${pct}%"></span><i class="wmeter__mark" aria-hidden="true"></i></div>
    <p class="small" data-wmsg>${f.unlocked ? html`<b>Prova final liberada!</b> <a href="${href}">Fazer a prova final</a>` : 'A prova final libera quando você assistir mais da metade (50%) desta aula. Assista sua aula!'}</p></section>`;
}

function aula({ cfg, user, csrf, flash, course, cur, lesson, flat, progress, access, ov, forum }) {
  const idx = flat.findIndex((l) => l.id === lesson.id);
  const prev = flat[idx - 1]; const next = flat[idx + 1];
  const done = progress.done.has(String(lesson.id));
  const link = (l) => `/curso/${course.slug}/aula/${l.id}`;
  const content = html`<a class="back" href="/curso/${course.slug}">← ${course.title}</a>
  <div class="lesson">
    <div class="lesson__main">
      <p class="muted small">${lesson.module_title} · Aula ${idx + 1} de ${flat.length}</p>
      ${lesson.youtube_id
        ? html`<div class="player" data-watch="/curso/${course.slug}/aula/${lesson.id}/assistido" data-csrf="${csrf}"${user.role === 'admin' ? raw(' data-admin="1"') : ''}><iframe id="yt-player" src="https://www.youtube-nocookie.com/embed/${lesson.youtube_id}?rel=0&enablejsapi=1&origin=${encodeURIComponent(cfg.baseUrl)}" title="${lesson.title}" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
        : html`<div class="player player--empty">${lumen('pensa', 90)}<p class="muted">O vídeo desta aula ainda não foi publicado.</p></div>`}
      ${meter(course, lesson, ov, user)}
      <h1 class="t-display t-display--sm">${lesson.title}</h1>
      <div class="lesson__act">
        <form method="post" action="${link(lesson)}/concluir">${csrfInput(csrf)}<input type="hidden" name="done" value="${done ? '0' : '1'}">
          ${done && ov && ov.cert.issued && user.role !== 'admin'
            ? html`<span class="btn btn--ghost" aria-disabled="true">${icon('check', 18)} Concluída</span>`
            : html`<button class="btn ${done ? 'btn--ghost' : 'btn--primary'}" type="submit">${done ? html`${icon('check', 18)} Concluída (desmarcar)` : 'Marcar como concluída'}</button>`}</form>
        ${prev ? html`<a class="btn btn--ghost" href="${link(prev)}">← Anterior</a>` : ''}
        ${next ? html`<a class="btn btn--outline" href="${link(next)}">Próxima aula →</a>` : ''}
      </div>
      ${lesson.description ? html`<section class="blk"><h2 class="t-card">Sobre a aula</h2>${String(lesson.description).split(/\n{2,}/).map((p) => html`<p>${p}</p>`)}</section>` : ''}
      ${lesson.files.length ? html`<section class="blk"><h2 class="t-card">Apostilas e materiais · ${lesson.files.length}</h2>
        <ul class="dl">${lesson.files.map((f) => html`<li>${icon('file', 20)}<div><b>${f.label}</b><span class="muted small">${f.filename} · ${files.humanSize(f.size_bytes)}</span></div>
          <a class="btn btn--outline btn--sm" href="/arquivos/${f.file_id}">${icon('download', 16)} Baixar</a></li>`)}</ul></section>` : ''}
      ${forum ? forumSection({ csrf, user, course, lesson, posts: forum.posts, enabled: forum.enabled }) : ''}
    </div>
    <aside class="lesson__side"><div class="card"><span class="eyebrow">Seu progresso</span><p class="muted small">${progress.pct}% concluído</p>${bar(progress.pct)}</div>
      <h2 class="t-card">Conteúdo do curso</h2>${curriculumList(course, cur, { progress, current: lesson, ov, admin: user.role === 'admin' })}</aside>
  </div>`;
  return shellApp({ cfg, user, csrf, flash, path: navPath(user), title: lesson.title, content });
}

module.exports = { meusCursos, cursoHome, aula, bar, titleRow };
