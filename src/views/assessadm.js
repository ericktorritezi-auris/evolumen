'use strict';
// Painel do administrador (Fase 3): avaliações do curso, editor de questões, tentativas e certificados.
const { html, raw } = require('../html');
const { shellApp, lumen } = require('../layout');
const { field, csrfInput } = require('./ui');
const { titleRow } = require('./student');
const { tabs, area } = require('./admin');
const certs = require('../certificates');

const shell = (ctx, title, content, path = '/admin/cursos') => shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path, title, content });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
const score = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }));
const sel = (id, name, value, opts) => html`<select id="${id}" name="${name}">${opts.map(([v, l]) => html`<option value="${v}"${String(value) === String(v) ? raw(' selected') : ''}>${l}</option>`)}</select>`;

// ---- aba "Avaliações e certificado" do curso ----
function courseTab(ctx, { course, cur, asm, errors = {}, values = null }) {
  const quizOf = (m) => asm.find((a) => a.kind === 'quiz' && a.module_id === m.id);
  const final = asm.find((a) => a.kind === 'final');
  const status = (a) => (!a ? html`<span class="muted">Não criado</span>` : html`${a.active ? html`<span class="pill pill--ok">Ativo</span>` : html`<span class="pill pill--draft">Inativo</span>`} <span class="muted small">${a.qcount} ${a.qcount === 1 ? 'questão pronta' : 'questões prontas'}</span>${a.qcount === 0 ? html` <span class="muted small">(sem questões prontas, não exige nada do aluno)</span>` : ''}`);
  const act = (a, kind, moduleId) => a ? html`<a class="btn btn--outline btn--sm" href="/admin/avaliacoes/${a.id}">Editar</a><a class="btn btn--ghost btn--sm" href="/admin/avaliacoes/${a.id}/tentativas">Tentativas</a>`
    : html`<form method="post" action="/admin/cursos/${course.id}/avaliacoes" class="inline">${csrfInput(ctx.csrf)}<input type="hidden" name="kind" value="${kind}">${moduleId ? html`<input type="hidden" name="module_id" value="${moduleId}">` : ''}<button class="btn btn--primary btn--sm" type="submit">Criar</button></form>`;
  const v = values || { cert_hours: course.cert_hours || '', cert_text: course.cert_text || '', cert_signer: course.cert_signer || '', cert_signer_role: course.cert_signer_role || '' };
  const content = html`<a class="back" href="/admin/cursos">← Cursos</a>${titleRow(course.title, 'Avaliações e certificado')}${tabs(course, 'avaliacoes')}
  <section class="card"><h2 class="t-card">Quiz por módulo</h2>
    <p class="muted small">Opcional. Não pesa na nota final. Se o módulo tiver quiz com questões, o aluno só avança para o próximo módulo com a nota mínima (padrão 7,0), em até 3 tentativas. Sem quiz, o módulo passa normal.</p>
    ${cur.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Módulo</th><th>Situação</th><th></th></tr></thead><tbody>${cur.map((m, i) => html`<tr><td data-l="Módulo">Módulo ${i + 1} · ${m.title}</td><td data-l="Situação">${status(quizOf(m))}</td><td class="tbl__act">${act(quizOf(m), 'quiz', m.id)}</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted">Crie os módulos primeiro, em Módulos e aulas.</p>`}</section>
  <section class="card"><h2 class="t-card">Prova final</h2>
    <p class="muted small">Uma por curso. Libera quando o aluno está na última aula do último módulo e assistiu mais da metade dela (medido pelo player do YouTube). Nota mínima padrão 7,0, 3 tentativas, e você pode liberar tentativas extras.</p>
    <div class="row">${status(final)}${act(final, 'final', null)}</div>
    <p class="muted small">Curso sem prova final: o certificado sai apenas com 95% de conclusão.</p></section>
  <section class="card"><h2 class="t-card">Certificado</h2>
    <p class="muted small">Emitido automaticamente quando o aluno passa na prova final (se houver) e conclui 95% do curso. Fica guardada uma cópia do texto na emissão.</p>
    <form method="post" action="/admin/cursos/${course.id}/certificado" class="form form--grid">${csrfInput(ctx.csrf)}
      ${field({ id: 'cert_hours', name: 'cert_hours', label: 'Carga horária (horas)', value: v.cert_hours, inputmode: 'numeric', error: errors.cert_hours, note: 'Deixe vazio para não mostrar a carga horária.' })}
      ${field({ id: 'cert_signer', name: 'cert_signer', label: 'Assinatura (nome)', value: v.cert_signer, placeholder: certs.DEFAULT_SIGNER, error: errors.cert_signer })}
      ${field({ id: 'cert_signer_role', name: 'cert_signer_role', label: 'Assinatura (cargo)', value: v.cert_signer_role, placeholder: certs.DEFAULT_ROLE, error: errors.cert_signer_role })}
      <div class="span2">${area('cert_text', 'Texto do certificado', v.cert_text, { rows: 4, placeholder: certs.DEFAULT_TEXT, error: errors.cert_text, note: 'Use {nome}, {curso}, {data} e {carga}. {carga} vira “, com carga horária de N horas” e some se não houver carga. Vazio usa o texto padrão. Vale para os certificados emitidos daqui em diante.' })}</div>
      <div class="span2 row"><button class="btn btn--primary" type="submit">Salvar certificado</button><a class="btn btn--ghost" href="/admin/cursos/${course.id}/certificado-exemplo.pdf">Ver exemplo em PDF</a></div></form></section>`;
  return shell(ctx, 'Avaliações e certificado', content);
}

// ---- editor da avaliação ----
function questionForm(ctx, a, q, n) {
  const slots = q ? q.options : [];
  const isTf = q ? q.kind === 'truefalse' : false;
  const base = q ? `/admin/questoes/${q.id}` : `/admin/avaliacoes/${a.id}/questoes`;
  const idp = q ? `q${q.id}` : 'qn';
  const optRows = [0, 1, 2, 3, 4, 5].map((i) => {
    const o = slots[i];
    return html`<div class="optrow"><label class="optrow__ok"><input type="radio" name="correct" value="${i}"${o && o.correct ? raw(' checked') : ''}><span class="sr">Correta</span></label>
      ${o ? html`<input type="hidden" name="opt_id_${i}" value="${o.id}">` : ''}<input type="text" name="opt_${i}" value="${o ? o.body : ''}" maxlength="300" placeholder="Alternativa ${i + 1}${i < 2 ? '' : ' (opcional)'}" aria-label="Alternativa ${i + 1}"></div>`;
  });
  const tf = html`<div class="optrow"><label><input type="radio" name="tf" value="v"${q && q.options[0] && q.options[0].correct ? raw(' checked') : ''}> Verdadeiro é a resposta certa</label></div>
    <div class="optrow"><label><input type="radio" name="tf" value="f"${q && q.options[1] && q.options[1].correct ? raw(' checked') : ''}> Falso é a resposta certa</label></div>`;
  return html`<form method="post" action="${base}" class="form">${csrfInput(ctx.csrf)}
    ${q ? html`<input type="hidden" name="kind" value="${q.kind}">` : html`<div class="field"><label for="${idp}k">Tipo</label>${sel(`${idp}k`, 'kind', 'single', [['single', 'Múltipla escolha (uma resposta certa)'], ['truefalse', 'Verdadeiro ou falso']])}</div>`}
    <div class="field"><label for="${idp}b">Enunciado</label><textarea id="${idp}b" name="body" rows="3" maxlength="800" required>${q ? q.body : ''}</textarea></div>
    ${q ? (isTf ? tf : html`<fieldset class="optset"><legend>Alternativas (marque a certa)</legend>${optRows}</fieldset>`)
    : html`<div data-kind-box="single"><fieldset class="optset"><legend>Alternativas, se for múltipla escolha (marque a certa)</legend>${optRows}</fieldset></div>
      <div data-kind-box="truefalse"><p class="muted small">Se for verdadeiro ou falso, marque abaixo qual é a certa.</p>${tf}</div>`}
    <div class="field"><label for="${idp}e">Explicação (aparece só nos quizzes, depois de responder)</label><textarea id="${idp}e" name="explanation" rows="2" maxlength="600">${q ? q.explanation : ''}</textarea></div>
    <div class="row"><button class="btn ${q ? 'btn--outline' : 'btn--primary'} btn--sm" type="submit">${q ? 'Salvar questão' : 'Adicionar questão'}</button></div></form>`;
}

function editor(ctx, { a, course, module: mod, questions, attempts, errors = {} }) {
  const isFinal = a.kind === 'final';
  const title = isFinal ? 'Prova final' : `Quiz · ${mod ? mod.title : ''}`;
  const mv = (id) => html`<span class="mv"><form method="post" action="/admin/questoes/${id}/mover" class="inline">${csrfInput(ctx.csrf)}<input type="hidden" name="dir" value="up"><button class="icon-btn icon-btn--sm" aria-label="Subir" title="Subir">↑</button></form><form method="post" action="/admin/questoes/${id}/mover" class="inline">${csrfInput(ctx.csrf)}<input type="hidden" name="dir" value="down"><button class="icon-btn icon-btn--sm" aria-label="Descer" title="Descer">↓</button></form></span>`;
  const content = html`<a class="back" href="/admin/cursos/${course.id}/avaliacoes">← ${course.title}</a>${titleRow(title, course.title)}
  ${errors.general ? html`<div class="alert alert--error" role="alert">${errors.general}</div>` : ''}
  <section class="card"><h2 class="t-card">Configuração</h2>
    <form method="post" action="/admin/avaliacoes/${a.id}" class="form form--grid">${csrfInput(ctx.csrf)}
      ${field({ id: 'title', name: 'title', label: 'Título (opcional)', value: a.title, maxlength: 80 })}
      ${field({ id: 'pass_score', name: 'pass_score', label: 'Nota mínima (0 a 10)', value: score(a.pass_score).replace(',', '.'), inputmode: 'decimal', error: errors.pass_score })}
      ${field({ id: 'max_attempts', name: 'max_attempts', label: 'Tentativas (1 a 10)', value: a.max_attempts, inputmode: 'numeric', error: errors.max_attempts })}
      <div class="field"><label for="active">Situação</label>${sel('active', 'active', a.active ? '1' : '0', [['1', 'Ativa'], ['0', 'Inativa (não exige nada do aluno)']])}</div>
      <div class="span2 row"><button class="btn btn--primary btn--sm" type="submit">Salvar configuração</button><a class="btn btn--ghost btn--sm" href="/admin/avaliacoes/${a.id}/tentativas">Ver tentativas dos alunos</a></div></form></section>
  <section class="card"><h2 class="t-card">Questões · ${questions.filter((q) => q.active).length} ativas</h2>
    ${questions.length ? questions.map((q, i) => html`<details class="lcard"><summary><span class="lcard__t">${i + 1}. ${q.body.length > 90 ? q.body.slice(0, 90) + '…' : q.body}${q.active ? '' : html` <span class="pill pill--draft">Inativa</span>`}</span><span class="muted small">${q.kind === 'truefalse' ? 'verdadeiro/falso' : q.options.length + ' alternativas'}</span></summary>
      <div class="lcard__body"><div class="row">${mv(q.id)}</div>${questionForm(ctx, a, q, i)}
        <div class="row"><form method="post" action="/admin/questoes/${q.id}/${q.active ? 'inativar' : 'reativar'}" class="inline">${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">${q.active ? 'Inativar questão' : 'Reativar questão'}</button></form>
          ${attempts === 0 ? html`<form method="post" action="/admin/questoes/${q.id}/excluir" class="inline" data-confirm="Excluir esta questão?">${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">Excluir questão</button></form>` : html`<span class="muted small">Já há tentativas: a questão só pode ser inativada.</span>`}</div></div></details>`)
    : html`<p class="muted">Nenhuma questão ainda. Adicione abaixo.</p>`}</section>
  <section class="card"><h2 class="t-card">Nova questão</h2>${questionForm(ctx, a, null, 0)}</section>
  <section class="card"><h2 class="t-card">Excluir ou desativar</h2>
    ${attempts === 0 ? html`<form method="post" action="/admin/avaliacoes/${a.id}/excluir" class="inline" data-confirm="Excluir esta avaliação com todas as questões?">${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">Excluir avaliação</button></form>`
      : html`<p class="muted small">Alunos já fizeram tentativas. Para parar de exigir, deixe a avaliação como inativa.</p>`}</section>`;
  return shell(ctx, title, content);
}

// ---- tentativas ----
function attemptsPage(ctx, { a, course, rows }) {
  const isFinal = a.kind === 'final';
  const content = html`<a class="back" href="/admin/avaliacoes/${a.id}">← ${isFinal ? 'Prova final' : 'Quiz'}</a>${titleRow('Tentativas dos alunos', course.title)}
  <section class="card">${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Aluno</th><th>Tentativas</th><th>Melhor nota</th><th>Situação</th>${isFinal ? html`<th>Prova</th>` : ''}<th></th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td data-l="Aluno"><b>${r.name}</b><br><span class="muted small">${r.email}</span></td>
      <td data-l="Tentativas">${r.used} de ${r.limit}${r.extra ? html` <span class="muted small">(+${r.extra} extra)</span>` : ''}</td>
      <td data-l="Melhor nota">${score(r.best)}</td>
      <td data-l="Situação">${r.passed ? html`<span class="pill pill--ok">Aprovado</span>` : (r.used >= r.limit ? html`<span class="pill pill--draft">Sem tentativas</span>` : html`<span class="pill">Em andamento</span>`)}</td>
      ${isFinal ? html`<td data-l="Prova">${r.unlocked ? 'Liberada' : 'Bloqueada'}</td>` : ''}
      <td class="tbl__act"><form method="post" action="/admin/avaliacoes/${a.id}/extra" class="inline">${csrfInput(ctx.csrf)}<input type="hidden" name="user" value="${r.user_id}"><button class="btn btn--outline btn--sm" type="submit">+1 tentativa extra</button></form>
        ${isFinal && !r.unlocked ? html`<form method="post" action="/admin/avaliacoes/${a.id}/liberar" class="inline" data-confirm="Liberar a prova final para este aluno, sem medir o tempo assistido?">${csrfInput(ctx.csrf)}<input type="hidden" name="user" value="${r.user_id}"><button class="btn btn--ghost btn--sm" type="submit">Liberar prova</button></form>` : ''}</td></tr>`)}</tbody></table></div>`
    : html`<div class="empty">${lumen('pensa', 90)}<p class="muted">Nenhum aluno matriculado neste curso ainda.</p></div>`}</section>`;
  return shell(ctx, 'Tentativas', content);
}

// ---- certificados (todos) ----
function certificados(ctx, { rows, courses, f, page, pages, total }) {
  const qs = (p) => { const u = new URLSearchParams(); for (const k of ['q', 'curso', 'situacao']) if (f[k]) u.set(k, f[k]); if (p > 1) u.set('p', p); const s = u.toString(); return `/admin/certificados${s ? '?' + s : ''}`; };
  const content = html`${titleRow('Certificados', 'Todos os certificados emitidos. Revogue em caso de reembolso, estorno ou fraude.')}
  <form method="get" action="/admin/certificados" class="form form--grid filters">
    <div class="field"><label for="q">Buscar</label><input id="q" name="q" value="${f.q || ''}" placeholder="Nome, e-mail ou código" maxlength="80"></div>
    <div class="field"><label for="curso">Curso</label>${sel('curso', 'curso', f.curso || '', [['', 'Todos'], ...courses.map((c) => [c.id, c.title])])}</div>
    <div class="field"><label for="situacao">Situação</label>${sel('situacao', 'situacao', f.situacao || '', [['', 'Todas'], ['valid', 'Válidos'], ['revoked', 'Cancelados']])}</div>
    <div class="row"><button class="btn btn--outline" type="submit">Filtrar</button></div></form>
  <section class="card">${rows.length ? html`<p class="muted small">${total} ${total === 1 ? 'certificado' : 'certificados'}</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Aluno</th><th>Curso</th><th>Emitido</th><th>Código</th><th>Situação</th><th></th></tr></thead><tbody>
    ${rows.map((c) => html`<tr><td data-l="Aluno"><b>${c.student_name}</b><br><span class="muted small">${c.email}</span></td><td data-l="Curso">${c.course_title}</td><td data-l="Emitido">${fmtDate(c.issued_at)}</td>
      <td data-l="Código"><span class="code">${c.code}</span></td>
      <td data-l="Situação">${c.status === 'valid' ? html`<span class="pill pill--ok">Válido</span>` : html`<span class="pill pill--draft">Cancelado</span>${c.revoke_reason ? html`<br><span class="muted small">${c.revoke_reason}</span>` : ''}`}</td>
      <td class="tbl__act"><a class="btn btn--ghost btn--sm" href="/certificados/${c.code}/pdf">PDF</a><a class="btn btn--ghost btn--sm" href="/certificado/${c.code}">Verificação</a>
        ${c.status === 'valid' ? html`<details class="inline-pop"><summary class="btn btn--outline btn--sm">Revogar</summary><form method="post" action="/admin/certificados/${c.id}/revogar" class="form">${csrfInput(ctx.csrf)}<div class="field"><label for="r${c.id}">Motivo</label><input id="r${c.id}" name="reason" maxlength="200" placeholder="Ex.: reembolso, fraude" required></div><button class="btn btn--primary btn--sm" type="submit">Confirmar revogação</button></form></details>`
    : html`<form method="post" action="/admin/certificados/${c.id}/restabelecer" class="inline" data-confirm="Restabelecer este certificado?">${csrfInput(ctx.csrf)}<button class="btn btn--outline btn--sm" type="submit">Restabelecer</button></form>`}</td></tr>`)}</tbody></table></div>
    ${pages > 1 ? html`<nav class="pager" aria-label="Páginas">${page > 1 ? html`<a class="btn btn--ghost btn--sm" href="${qs(page - 1)}">← Anterior</a>` : ''}<span class="muted small">Página ${page} de ${pages}</span>${page < pages ? html`<a class="btn btn--ghost btn--sm" href="${qs(page + 1)}">Próxima →</a>` : ''}</nav>` : ''}`
    : html`<div class="empty">${lumen('celebra', 100)}<p class="muted">Nenhum certificado neste filtro.</p></div>`}</section>`;
  return shell(ctx, 'Certificados', content, '/admin/certificados');
}

module.exports = { courseTab, editor, attemptsPage, certificados };
