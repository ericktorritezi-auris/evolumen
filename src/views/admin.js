'use strict';
const { html, raw } = require('../html');
const { shellApp, lumen } = require('../layout');
const { icon } = require('../header');
const { field, csrfInput } = require('./ui');
const { titleRow } = require('./student');
const C = require('../courses');
const files = require('../files');

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
const isoDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : '');
const shell = (ctx, title, content, path = '/admin/cursos') => shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path, title, content });

function tabs(course, active) {
  const t = [['dados', 'Dados do curso', `/admin/cursos/${course.id}`], ['conteudo', 'Módulos e aulas', `/admin/cursos/${course.id}/conteudo`], ['matriculas', 'Matrículas', `/admin/cursos/${course.id}/matriculas`]];
  return html`<nav class="tabs" aria-label="Seções do curso">${t.map(([k, label, href]) => html`<a href="${href}" class="${k === active ? 'is-active' : ''}"${k === active ? raw(' aria-current="page"') : ''}>${label}</a>`)}
    <a href="/cursos/${course.slug}" class="tabs__ext">Ver página ↗</a><a href="/curso/${course.slug}" class="tabs__ext">Ver como aluno ↗</a></nav>`;
}

function cursosList(ctx, { courses }) {
  const content = html`${titleRow('Cursos', 'Tudo o que você cadastra aqui aparece na vitrine da página inicial, quando publicado.')}
  <div class="row row--top"><a class="btn btn--primary" href="/admin/cursos/novo">Novo curso</a></div>
  ${courses.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Curso</th><th>Status</th><th>Alunos</th><th>Valor</th><th></th></tr></thead><tbody>
    ${courses.map((c) => html`<tr><td data-l="Curso"><b>${c.title}</b><br><span class="muted small">/cursos/${c.slug} · ${c.modules} ${c.modules === 1 ? 'módulo' : 'módulos'}, ${c.lessons} ${c.lessons === 1 ? 'aula' : 'aulas'}</span></td>
      <td data-l="Status">${c.visible ? html`<span class="pill pill--ok">Publicado</span>` : (c.status === 'published' ? html`<span class="pill">Agendado ${fmtDate(c.published_at)}</span>` : html`<span class="pill pill--draft">Rascunho</span>`)}</td>
      <td data-l="Alunos">${c.students}</td><td data-l="Valor">${C.brl(c.price_cents)}</td>
      <td class="tbl__act"><a class="btn btn--outline btn--sm" href="/admin/cursos/${c.id}">Editar</a></td></tr>`)}</tbody></table></div>`
    : html`<section class="card empty">${lumen('pensa', 96)}<div><h2 class="t-card">Nenhum curso ainda</h2><p class="muted">Crie o primeiro curso para ele aparecer aqui.</p></div></section>`}`;
  return shell(ctx, 'Cursos', content);
}

const sel = (name, value, opts) => html`<select id="${name}" name="${name}">${opts.map(([v, l]) => html`<option value="${v}"${String(value) === String(v) ? raw(' selected') : ''}>${l}</option>`)}</select>`;
const area = (id, label, value, { rows = 4, note = '', error = '', placeholder = '', name = id } = {}) => html`<div class="field${error ? ' field--err' : ''}"><label for="${id}">${label}</label>
  <textarea id="${id}" name="${name}" rows="${rows}" placeholder="${placeholder}">${value || ''}</textarea>${error ? html`<div class="field__msg field__msg--err">${error}</div>` : (note ? html`<div class="field__msg">${note}</div>` : '')}</div>`;

function cursoForm(ctx, { course, values, errors = {} }) {
  const isNew = !course;
  const v = values || course || { level: 'iniciante', access_type: 'lifetime', max_installments: 12, sort_order: 100, expiry_notice_days: '30,7,1', learn_items: [], able_items: [], faq: [] };
  const toLines = (x) => (Array.isArray(x) ? x.join('\n') : (x || ''));
  const money = (cents, raw_) => (raw_ !== undefined ? raw_ : C.brlInput(cents));
  const raw_ = ctx.raw || {};
  const faq = v.faq || [];
  const published = v.publish !== undefined ? v.publish : v.status === 'published';
  const pubDate = raw_.published_at !== undefined ? raw_.published_at : (v.published_at ? isoDate(v.published_at) : '');
  const content = html`<a class="back" href="/admin/cursos">← Cursos</a>
  ${titleRow(isNew ? 'Novo curso' : v.title, isNew ? 'Preencha o essencial agora. O resto você ajusta depois.' : '')}
  ${isNew ? '' : tabs(course, 'dados')}
  ${Object.keys(errors).length ? html`<div class="alert alert--error" role="alert">Confira os campos destacados.</div>` : ''}
  <form method="post" action="${isNew ? '/admin/cursos' : '/admin/cursos/' + course.id}" class="form" novalidate>
    ${csrfInput(ctx.csrf)}
    <section class="card"><h2 class="t-card">Dados do curso</h2><div class="form form--grid">
      <div class="span2">${field({ id: 'title', label: 'Nome do curso', value: v.title || '', error: errors.title, required: true })}</div>
      ${field({ id: 'slug', label: 'Endereço (slug)', value: v.slug || '', error: errors.slug, note: 'Vira /cursos/<slug>. Se deixar vazio, é criado pelo nome. Evite mudar depois de publicar.' })}
      ${field({ id: 'category', label: 'Categoria', value: v.category || '', note: 'Ex.: Autoconhecimento, Hipnose.' })}
      <div class="span2">${field({ id: 'summary', label: 'Resumo (aparece na vitrine)', value: v.summary || '', note: 'Até 240 letras.' })}</div>
      <div class="span2">${area('description', 'Descrição completa', v.description, { rows: 6, note: 'Para quem é, qual a transformação e como funciona. Linha em branco separa parágrafos.' })}</div>
      <div class="span2">${area('target_audience', 'Público-alvo', v.target_audience, { rows: 2 })}</div>
      <div class="span2">${area('prerequisites', 'Pré-requisitos', v.prerequisites, { rows: 2, note: 'Se não houver, escreva "Nenhum pré-requisito".' })}</div>
      <div class="field"><label for="level">Nível</label>${sel('level', v.level, Object.entries(C.LEVELS))}</div>
      ${field({ id: 'workload_hours', label: 'Carga horária (horas)', value: v.workload_hours || '', inputmode: 'numeric', error: errors.workload_hours })}
      ${field({ id: 'intro_video', label: 'Vídeo de apresentação (link do YouTube)', value: raw_.intro_video !== undefined ? raw_.intro_video : (v.intro_youtube_id ? 'https://youtu.be/' + v.intro_youtube_id : ''), error: errors.intro_video, note: 'Opcional. Se vazio, a página usa a imagem de capa.' })}
    </div></section>
    <section class="card"><h2 class="t-card">Conteúdo da página do curso</h2><div class="form">
      ${area('learn_items', 'O que o aluno vai aprender (um item por linha)', toLines(v.learn_items), { rows: 5 })}
      ${area('able_items', 'Ao concluir, o aluno estará apto a... (um item por linha)', toLines(v.able_items), { rows: 4 })}
      <h3 class="t-sub">Perguntas frequentes (até 5)</h3>
      ${[1, 2, 3, 4, 5].map((i) => html`<div class="form form--grid">${field({ id: `faq_q${i}`, label: `Pergunta ${i}`, value: raw_[`faq_q${i}`] !== undefined ? raw_[`faq_q${i}`] : (faq[i - 1] ? faq[i - 1].q : ''), error: errors[`faq${i}`] })}
        ${field({ id: `faq_a${i}`, label: `Resposta ${i}`, value: raw_[`faq_a${i}`] !== undefined ? raw_[`faq_a${i}`] : (faq[i - 1] ? faq[i - 1].a : '') })}</div>`)}
    </div></section>
    <section class="card"><h2 class="t-card">Preço, pagamento e acesso</h2><div class="form form--grid">
      ${field({ id: 'price', label: 'Valor (R$)', value: money(v.price_cents, raw_.price), error: errors.price, inputmode: 'decimal', required: true })}
      ${field({ id: 'max_installments', label: 'Parcelamento máximo no cartão', value: v.max_installments, inputmode: 'numeric', error: errors.max_installments })}
      ${field({ id: 'promo_price', label: 'Preço promocional (R$), opcional', value: money(v.promo_price_cents, raw_.promo_price), error: errors.promo_price, inputmode: 'decimal' })}
      ${field({ id: 'promo_until', label: 'Promoção válida até', type: 'date', value: raw_.promo_until !== undefined ? raw_.promo_until : (v.promo_until ? String(v.promo_until).slice(0, 10) : ''), error: errors.promo_until })}
      <div class="field"><label for="access_type">Modalidade de acesso</label>${sel('access_type', v.access_type, [['lifetime', 'Vitalício'], ['months', 'Por prazo']])}</div>
      ${field({ id: 'access_months', label: 'Prazo de acesso (meses)', value: v.access_months || '', inputmode: 'numeric', error: errors.access_months, note: 'Só para acesso por prazo. 12 = 1 ano.' })}
      ${field({ id: 'expiry_notice_days', label: 'Avisar o aluno antes de vencer (dias)', value: v.expiry_notice_days, error: errors.expiry_notice_days, note: 'Padrão aprovado: 30, 7, 1.' })}
      ${field({ id: 'renewal_price', label: 'Valor da renovação (R$)', value: money(v.renewal_price_cents, raw_.renewal_price), error: errors.renewal_price, inputmode: 'decimal', note: 'Só para acesso por prazo.' })}
    </div><p class="muted small">Pagamento único, sem mensalidade. No acesso por prazo, o aluno renova comprando de novo. A compra online abre na Fase 4.</p></section>
    <section class="card"><h2 class="t-card">Publicação</h2><div class="form form--grid">
      ${field({ id: 'sort_order', label: 'Ordem na vitrine', value: v.sort_order, inputmode: 'numeric', error: errors.sort_order, note: '1 aparece primeiro.' })}
      ${field({ id: 'published_at', label: 'Data de publicação', type: 'date', value: pubDate, error: errors.published_at, note: 'Vazio = hoje. Data futura agenda o lançamento.' })}
      <label class="check"><input type="checkbox" name="featured" value="1"${v.featured ? raw(' checked') : ''}><span>Destacar na vitrine</span></label>
      <label class="check"><input type="checkbox" name="publish" value="1"${published ? raw(' checked') : ''}><span>Publicado na vitrine<br><small class="muted">Rascunhos não aparecem para o público.</small></span></label>
    </div></section>
    <div class="row"><button class="btn btn--primary btn--lg" type="submit">${isNew ? 'Criar curso' : 'Salvar curso'}</button></div>
  </form>
  ${isNew ? '' : html`
  <section class="card"><h2 class="t-card">Imagem de capa</h2>
    <div class="coverbox">${course.cover_file_id ? html`<img src="/capas/${course.cover_file_id}" alt="Capa atual do curso" class="cover">` : html`<p class="muted">Sem capa. A vitrine mostra a Lumen no lugar.</p>`}</div>
    <form method="post" action="/admin/cursos/${course.id}/capa" enctype="multipart/form-data" class="form">${csrfInput(ctx.csrf)}
      <div class="field"><label for="capa">Enviar nova capa (PNG, JPG ou WEBP, até 3 MB)</label><input id="capa" type="file" name="arquivo" accept=".png,.jpg,.jpeg,.webp" required></div>
      <div class="row"><button class="btn btn--outline" type="submit">Enviar capa</button></div></form>
    ${course.cover_file_id ? html`<form method="post" action="/admin/cursos/${course.id}/capa/remover" class="inline">${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">Remover capa</button></form>` : ''}
  </section>
  <section class="card danger"><h2 class="t-card">Excluir curso</h2>
    <p class="muted">Só é possível excluir um curso sem alunos matriculados e sem cupons ligados a ele. Nesses casos, tire o curso da vitrine deixando-o como rascunho.</p>
    <form method="post" action="/admin/cursos/${course.id}/excluir" data-confirm="Excluir este curso, com módulos, aulas e arquivos? Não dá para desfazer.">${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">Excluir curso</button></form></section>`}`;
  return shell(ctx, isNew ? 'Novo curso' : 'Editar curso', content);
}

function conteudo(ctx, { course, cur, errors = {} }) {
  const move = (base, id) => html`<span class="mv"><form method="post" action="${base}/${id}/mover" class="inline">${csrfInput(ctx.csrf)}<input type="hidden" name="dir" value="up"><button class="icon-btn icon-btn--sm" aria-label="Subir" title="Subir">↑</button></form><form method="post" action="${base}/${id}/mover" class="inline">${csrfInput(ctx.csrf)}<input type="hidden" name="dir" value="down"><button class="icon-btn icon-btn--sm" aria-label="Descer" title="Descer">↓</button></form></span>`;
  const lessonForm = (l) => html`<details class="lcard"><summary><span class="lcard__t">${l.title}${l.active ? '' : html` <span class="pill pill--draft">Inativa</span>`}</span><span class="muted small">${l.has_video || l.youtube_id ? 'vídeo' : 'sem vídeo'} · ${l.files.length} ${l.files.length === 1 ? 'arquivo' : 'arquivos'}</span></summary>
    <div class="lcard__body">
      <form method="post" action="/admin/aulas/${l.id}" class="form form--grid">${csrfInput(ctx.csrf)}
        <div class="span2">${field({ id: `lt${l.id}`, name: 'title', label: 'Título da aula', value: l.title, required: true })}</div>
        ${field({ id: `ly${l.id}`, name: 'video', label: 'Vídeo (link do YouTube não listado)', value: l.youtube_id ? 'https://youtu.be/' + l.youtube_id : '', placeholder: 'https://youtu.be/...' })}
        ${field({ id: `ld${l.id}`, name: 'duration_min', label: 'Duração (minutos)', value: l.duration_min || '', inputmode: 'numeric' })}
        <div class="span2">${area(`ldesc${l.id}`, 'Sobre a aula', l.description, { rows: 3, name: 'description' })}</div>
        <div class="span2 row"><button class="btn btn--primary btn--sm" type="submit">Salvar aula</button></div></form>
      <h4 class="t-sub">Apostilas e arquivos</h4>
      ${l.files.length ? html`<ul class="dl">${l.files.map((f) => html`<li>${icon('file', 20)}<div><b>${f.label}</b><span class="muted small">${f.filename} · ${files.humanSize(f.size_bytes)}</span></div>
        <a class="btn btn--ghost btn--sm" href="/arquivos/${f.file_id}">Baixar</a>
        <form method="post" action="/admin/arquivos/${f.file_id}/excluir" class="inline" data-confirm="Remover este arquivo da aula?">${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">Remover</button></form></li>`)}</ul>` : html`<p class="muted small">Nenhum arquivo nesta aula.</p>`}
      <form method="post" action="/admin/aulas/${l.id}/arquivos" enctype="multipart/form-data" class="form form--grid">${csrfInput(ctx.csrf)}
        ${field({ id: `fl${l.id}`, name: 'label', label: 'Nome para o aluno', placeholder: 'Ex.: Apostila do módulo 1' })}
        <div class="field"><label for="fa${l.id}">Arquivo (PDF, DOC, DOCX, XLS ou XLSX, até 20 MB)</label><input id="fa${l.id}" type="file" name="arquivo" accept=".pdf,.doc,.docx,.xls,.xlsx" required></div>
        <div class="span2 row"><button class="btn btn--outline btn--sm" type="submit">Enviar arquivo</button></div></form>
      <div class="row">
        <form method="post" action="/admin/aulas/${l.id}/${l.active ? 'inativar' : 'reativar'}" class="inline"${l.active ? raw(' data-confirm="Inativar esta aula? Os alunos deixam de vê-la, mas o histórico fica guardado."') : ''}>${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">${l.active ? 'Inativar aula' : 'Reativar aula'}</button></form>
        ${l.progress_count === 0 ? html`<form method="post" action="/admin/aulas/${l.id}/excluir" class="inline" data-confirm="Excluir esta aula e os arquivos dela?">${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">Excluir aula</button></form>`
          : html`<span class="muted small">Alunos já concluíram esta aula: ela só pode ser inativada.</span>`}
      </div>
    </div></details>`;
  const content = html`<a class="back" href="/admin/cursos">← Cursos</a>${titleRow(course.title, 'Módulos e aulas')}${tabs(course, 'conteudo')}
  ${errors.general ? html`<div class="alert alert--error" role="alert">${errors.general}</div>` : ''}
  ${cur.map((m, i) => html`<section class="card mod"><div class="mod__head"><h2 class="t-card">Módulo ${i + 1}${m.active ? '' : html` <span class="pill pill--draft">Inativo</span>`}</h2>${move('/admin/modulos', m.id)}</div>
    <form method="post" action="/admin/modulos/${m.id}" class="form inline-form">${csrfInput(ctx.csrf)}${field({ id: `mt${m.id}`, name: 'title', label: 'Nome do módulo', value: m.title, required: true })}<button class="btn btn--outline btn--sm" type="submit">Renomear</button></form>
    <div class="lessons">${m.lessons.map((l) => html`<div class="lrow-admin">${move('/admin/aulas', l.id)}${lessonForm(l)}</div>`)}</div>
    <form method="post" action="/admin/modulos/${m.id}/aulas" class="form inline-form">${csrfInput(ctx.csrf)}${field({ id: `na${m.id}`, name: 'title', label: 'Nova aula neste módulo', placeholder: 'Título da aula', required: true })}<button class="btn btn--primary btn--sm" type="submit">Adicionar aula</button></form>
    <div class="row">
      <form method="post" action="/admin/modulos/${m.id}/${m.active ? 'inativar' : 'reativar'}" class="inline"${m.active ? raw(' data-confirm="Inativar este módulo? Os alunos deixam de vê-lo, mas o histórico fica guardado."') : ''}>${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">${m.active ? 'Inativar módulo' : 'Reativar módulo'}</button></form>
      ${m.lessons.every((l) => l.progress_count === 0) ? html`<form method="post" action="/admin/modulos/${m.id}/excluir" class="inline" data-confirm="Excluir este módulo com todas as aulas e arquivos?">${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">Excluir módulo</button></form>`
        : html`<span class="muted small">Alunos já fizeram aulas deste módulo: ele só pode ser inativado.</span>`}
    </div></section>`)}
  <section class="card"><h2 class="t-card">Novo módulo</h2><form method="post" action="/admin/cursos/${course.id}/modulos" class="form inline-form">${csrfInput(ctx.csrf)}${field({ id: 'nm', name: 'title', label: 'Nome do módulo', placeholder: 'Ex.: Primeiros passos', required: true, note: 'Não escreva "Módulo 1": o número é automático.' })}<button class="btn btn--primary" type="submit">Adicionar módulo</button></form></section>`;
  return shell(ctx, 'Módulos e aulas', content);
}

const ORIGIN = { manual: 'Manual', gift: 'Cortesia', purchase: 'Compra' };
// Botões de uma matrícula: cancelar/reativar sempre; excluir só se o aluno não fez nenhuma aula.
function enrollActions(ctx, r, to) {
  return html`${r.status === 'cancelled'
    ? html`<form method="post" action="/admin/matriculas/${r.id}/reativar" class="inline">${csrfInput(ctx.csrf)}<input type="hidden" name="to" value="${to}"><button class="btn btn--ghost btn--sm" type="submit">Reativar</button></form>`
    : html`<form method="post" action="/admin/matriculas/${r.id}/cancelar" class="inline" data-confirm="Cancelar o acesso deste aluno ao curso? O histórico fica guardado.">${csrfInput(ctx.csrf)}<input type="hidden" name="to" value="${to}"><button class="btn btn--ghost btn--sm" type="submit">Cancelar acesso</button></form>`}
    ${r.any_progress === 0 ? html`<form method="post" action="/admin/matriculas/${r.id}/excluir" class="inline" data-confirm="Excluir esta matrícula? Só é possível porque o aluno ainda não fez nenhuma aula.">${csrfInput(ctx.csrf)}<input type="hidden" name="to" value="${to}"><button class="btn btn--ghost btn--sm" type="submit">Excluir</button></form>` : ''}`;
}

function matriculas(ctx, { course, rows, created = null, errors = {}, email = '' }) {
  const content = html`<a class="back" href="/admin/cursos">← Cursos</a>${titleRow(course.title, 'Matrículas')}${tabs(course, 'matriculas')}
  ${created ? html`<section class="card card--ok"><h2 class="t-card">${created.newUser ? 'Aluno criado e matriculado' : (created.already ? 'Esta pessoa já tinha acesso' : 'Matrícula criada')}</h2>
    <p>${created.newUser ? html`Conta criada para <b>${created.email}</b>. A senha provisória também foi enviada por e-mail:` : html`<b>${created.email}</b> ${created.already ? 'já tinha acesso vigente a este curso. O prazo nunca diminui, e nenhum e-mail foi enviado.' : 'já tinha conta e agora tem acesso ao curso.'}`}</p>
    ${created.password ? html`<p class="secret">${created.password}</p><p class="muted small">Anote agora: por segurança, ela não aparece de novo. No primeiro acesso o aluno escolhe a própria senha.</p>` : ''}</section>` : ''}
  <section class="card"><h2 class="t-card">Liberar acesso</h2>
    <p class="muted">Use para testes, cortesias e alunos que pagaram fora da plataforma. Se o e-mail ainda não tem conta, o aluno é criado e recebe a senha provisória por e-mail. A compra online abre na Fase 4.</p>
    <form method="post" action="/admin/cursos/${course.id}/matriculas" class="form form--grid" novalidate>${csrfInput(ctx.csrf)}
      ${field({ id: 'email', label: 'E-mail do aluno', type: 'email', value: email, error: errors.email, required: true })}
      ${field({ id: 'name', label: 'Nome (só se a conta for nova)', error: errors.name, autocomplete: 'off' })}
      ${field({ id: 'until', label: 'Acesso até (opcional)', type: 'date', error: errors.until, note: `Vazio = regra do curso (${C.accessLabel(course).toLowerCase()}).` })}
      <div class="span2 row"><button class="btn btn--primary" type="submit">Liberar acesso</button></div></form></section>
  <h2 class="t-card">Matrículas · ${rows.length}</h2>
  ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Aluno</th><th>Origem</th><th>Acesso até</th><th>Progresso</th><th>Situação</th><th></th></tr></thead><tbody>${rows.map((r) => html`<tr>
    <td data-l="Aluno"><b>${r.name}</b><br><span class="muted small">${r.email}</span></td>
    <td data-l="Origem">${ORIGIN[r.origin] || r.origin}</td>
    <td data-l="Acesso até">${r.expires_at ? fmtDate(r.expires_at) + (r.expired ? ' (vencido)' : '') : 'Vitalício'}</td>
    <td data-l="Progresso">${r.done}/${r.total}</td>
    <td data-l="Situação">${r.status === 'cancelled' ? html`<span class="pill pill--draft">Cancelada</span>` : (r.expired ? html`<span class="pill">Vencida</span>` : html`<span class="pill pill--ok">Ativa</span>`)}</td>
    <td class="tbl__act">${enrollActions(ctx, r, 'curso')}</td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">Ninguém matriculado ainda.</p>`}`;
  return shell(ctx, 'Matrículas', content);
}

module.exports = { cursosList, cursoForm, conteudo, matriculas, enrollActions, ORIGIN };
