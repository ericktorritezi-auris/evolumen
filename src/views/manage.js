'use strict';
// Telas do painel (parte 2): alunos, cortesias, registro de atividades e cupons.
const { html, raw } = require('../html');
const { shellApp, lumen } = require('../layout');
const { field, csrfInput } = require('./ui');
const { titleRow } = require('./student');
const { enrollActions } = require('./admin');
const C = require('../courses');
const K = require('../coupons');

const SP = 'America/Sao_Paulo';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: SP }) : '');
const fmtTime = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: SP, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const shell = (ctx, path, title, content) => shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path, title, content });
const sel = (id, name, value, opts) => html`<select id="${id}" name="${name}">${opts.map(([v, l]) => html`<option value="${v}"${String(value) === String(v) ? raw(' selected') : ''}>${l}</option>`)}</select>`;

// ---------- alunos ----------
function alunos(ctx, { rows, q, st }) {
  const content = html`${titleRow('Alunos', 'Inativar impede o login e guarda tudo. Só dá para excluir um aluno sem nenhum vínculo, como uma conta criada por engano.')}
  <form method="get" action="/admin/alunos" class="form form--grid filters">
    ${field({ id: 'q', label: 'Buscar por nome ou e-mail', value: q })}
    <div class="field"><label for="situacao">Situação</label>${sel('situacao', 'situacao', st, [['', 'Todas'], ['ativos', 'Ativas'], ['inativos', 'Inativas']])}</div>
    <div class="span2 row"><button class="btn btn--outline btn--sm" type="submit">Filtrar</button></div></form>
  ${rows.length >= 200 ? html`<p class="muted small">Mostrando os 200 mais recentes. Use a busca para achar os outros.</p>` : ''}
  ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Aluno</th><th>Situação</th><th>Cursos</th><th>Último acesso</th><th></th></tr></thead><tbody>
    ${rows.map((u) => {
    const linked = u.enrollments + u.progress + u.acceptances + u.requests + u.redemptions > 0;
    return html`<tr><td data-l="Aluno"><b>${u.name}</b><br><span class="muted small">${u.email}</span></td>
      <td data-l="Situação">${u.status === 'active' ? html`<span class="pill pill--ok">Ativa</span>` : html`<span class="pill pill--draft">Inativa</span>`}</td>
      <td data-l="Cursos">${u.enrollments}</td>
      <td data-l="Último acesso">${u.last_login_at ? fmtDate(u.last_login_at) : 'Nunca entrou'}</td>
      <td class="tbl__act">
        ${u.status === 'active'
    ? html`<form method="post" action="/admin/alunos/${u.id}/inativar" class="inline" data-confirm="Inativar esta conta? O aluno não conseguirá entrar, e tudo fica guardado.">${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">Inativar</button></form>`
    : html`<form method="post" action="/admin/alunos/${u.id}/reativar" class="inline">${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">Reativar</button></form>`}
        ${linked ? '' : html`<form method="post" action="/admin/alunos/${u.id}/excluir" class="inline" data-confirm="Excluir esta conta? Ela não tem nenhum vínculo. Não dá para desfazer.">${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">Excluir</button></form>`}
      </td></tr>`;
  })}</tbody></table></div>`
    : html`<section class="card empty">${lumen('pensa', 96)}<div><h2 class="t-card">Nenhum aluno encontrado</h2><p class="muted">Os alunos aparecem aqui quando se cadastram ou quando você libera um curso.</p></div></section>`}`;
  return shell(ctx, '/admin/alunos', 'Alunos', content);
}

// ---------- cortesias ----------
function cortesias(ctx, { courses, rows, errors = {}, values = {}, created = null }) {
  const content = html`${titleRow('Cortesias', 'Dê um curso de presente. A pessoa recebe um e-mail avisando que o curso é gratuito, com os dados de acesso.')}
  ${created ? html`<section class="card card--ok"><h2 class="t-card">${created.already ? 'Esta pessoa já tinha acesso' : 'Cortesia concedida'}</h2>
    ${created.already ? html`<p><b>${created.email}</b> já tinha acesso vigente a <b>${created.course}</b>. O prazo nunca diminui, e nenhum e-mail foi enviado.</p>` : html`<p><b>${created.email}</b> recebeu o curso <b>${created.course}</b> como cortesia e foi avisada por e-mail.${created.newUser ? ' A conta foi criada agora e a senha provisória seguiu no e-mail.' : ''}</p>`}
    ${created.password ? html`<p class="secret">${created.password}</p><p class="muted small">Anote agora: por segurança, ela não aparece de novo.</p>` : ''}</section>` : ''}
  <section class="card"><h2 class="t-card">Conceder cortesia</h2>
    <form method="post" action="/admin/cortesias" class="form form--grid" novalidate>${csrfInput(ctx.csrf)}
      <div class="field${errors.course ? ' field--err' : ''}"><label for="course">Curso</label>
        <select id="course" name="course" required><option value="">Escolha o curso</option>${courses.map((c) => html`<option value="${c.id}"${String(values.course) === String(c.id) ? raw(' selected') : ''}>${c.title}${c.status === 'published' ? '' : ' (rascunho)'}</option>`)}</select>
        ${errors.course ? html`<div class="field__msg field__msg--err">${errors.course}</div>` : ''}</div>
      ${field({ id: 'email', label: 'E-mail da pessoa', type: 'email', value: values.email || '', error: errors.email, required: true })}
      ${field({ id: 'name', label: 'Nome (só se a conta for nova)', value: values.name || '', error: errors.name, autocomplete: 'off' })}
      ${field({ id: 'until', label: 'Acesso até (opcional)', type: 'date', value: values.until || '', error: errors.until, note: 'Vazio = regra do curso (vitalício ou por prazo).' })}
      <div class="span2 row"><button class="btn btn--primary" type="submit">Conceder cortesia</button></div></form></section>
  <h2 class="t-card">Cortesias concedidas · ${rows.length}</h2>
  ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pessoa</th><th>Curso</th><th>Concedida em</th><th>Situação</th><th></th></tr></thead><tbody>${rows.map((r) => html`<tr>
    <td data-l="Pessoa"><b>${r.name}</b><br><span class="muted small">${r.email}</span></td><td data-l="Curso">${r.course}</td><td data-l="Concedida em">${fmtDate(r.created_at)}</td>
    <td data-l="Situação">${r.status === 'cancelled' ? html`<span class="pill pill--draft">Cancelada</span>` : (r.expired ? html`<span class="pill">Vencida</span>` : html`<span class="pill pill--ok">Ativa</span>`)}</td>
    <td class="tbl__act">${enrollActions(ctx, r, 'cortesias')}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Nenhuma cortesia concedida ainda.</p>`}`;
  return shell(ctx, '/admin/cortesias', 'Cortesias', content);
}

// ---------- registro de atividades ----------
const LABELS = {
  login_success: 'Entrou no sistema', login_failed: 'Tentativa de entrada falhou', login_locked: 'Conta bloqueada por tentativas', logout: 'Saiu do sistema',
  password_changed: 'Trocou a senha', password_reset_requested: 'Pediu nova senha', password_reset_done: 'Criou nova senha', first_access_completed: 'Concluiu o primeiro acesso',
  profile_updated: 'Atualizou o perfil', email_change_requested: 'Pediu troca de e-mail', email_change_confirmed: 'Confirmou troca de e-mail', email_change_code_wrong: 'Errou código de troca de e-mail',
  email_change_admin_requested: 'Pediu troca de e-mail ao administrador', data_export: 'Exportou os próprios dados', data_deletion_requested: 'Pediu exclusão dos dados',
  acceptance_recorded: 'Aceitou os termos', launch_reset: 'Reset de lançamento (só contagens)', launch_reset_denied: 'Tentativa de reset negada', course_created: 'Criou curso', course_updated: 'Editou curso', course_published: 'Publicou curso', course_unpublished: 'Tirou curso da vitrine',
  course_deleted: 'Excluiu curso', course_cover_updated: 'Trocou a capa do curso', course_cover_removed: 'Removeu a capa do curso',
  module_created: 'Criou módulo', module_renamed: 'Renomeou módulo', module_moved: 'Reordenou módulo', module_inactivated: 'Inativou módulo', module_reactivated: 'Reativou módulo', module_deleted: 'Excluiu módulo',
  lesson_created: 'Criou aula', lesson_updated: 'Editou aula', lesson_moved: 'Reordenou aula', lesson_inactivated: 'Inativou aula', lesson_reactivated: 'Reativou aula', lesson_deleted: 'Excluiu aula',
  file_uploaded: 'Enviou arquivo', file_deleted: 'Removeu arquivo', file_downloaded: 'Baixou arquivo',
  student_created: 'Criou conta de aluno', student_inactivated: 'Inativou aluno', student_reactivated: 'Reativou aluno', student_deleted: 'Excluiu aluno',
  assessment_created: 'Criou quiz ou prova', assessment_updated: 'Alterou quiz ou prova', assessment_deleted: 'Excluiu quiz ou prova', assessment_started: 'Aluno iniciou avaliação', assessment_submitted: 'Aluno enviou avaliação',
  question_created: 'Criou questão', question_updated: 'Alterou questão', question_inactivated: 'Inativou questão', question_reactivated: 'Reativou questão', question_deleted: 'Excluiu questão',
  attempt_granted: 'Liberou tentativa extra', exam_unlocked: 'Liberou a prova final', certificate_issued: 'Certificado emitido', certificate_downloaded: 'Certificado baixado', certificate_revoked: 'Revogou certificado', certificate_restored: 'Restabeleceu certificado', certificate_settings_saved: 'Alterou dados do certificado',
  enrollment_granted: 'Liberou acesso a curso', enrollment_cancelled: 'Cancelou matrícula', enrollment_reactivated: 'Reativou matrícula', enrollment_removed: 'Excluiu matrícula',
  gift_granted: 'Concedeu cortesia', coupon_created: 'Criou cupom', coupon_updated: 'Editou cupom', coupon_inactivated: 'Inativou cupom', coupon_sent: 'Enviou cupom por e-mail',
};
const metaText = (m) => Object.entries(m || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ').slice(0, 140);

function log(ctx, { rows, total, page, pages, f, actions, size }) {
  const qs = (p) => {
    const u = new URLSearchParams(); for (const k of ['de', 'ate', 'q', 'acao']) if (f[k]) u.set(k, f[k]); if (p > 1) u.set('p', p);
    const s = u.toString(); return '/admin/log' + (s ? '?' + s : '');
  };
  const from = total ? (page - 1) * size + 1 : 0; const to = Math.min(page * size, total);
  const content = html`${titleRow('Registro de atividades', 'Tudo o que é feito no sistema. Os registros ficam guardados por 30 dias e depois saem sozinhos.')}
  <form method="get" action="/admin/log" class="form form--grid filters">
    ${field({ id: 'de', label: 'De', type: 'date', value: f.de })}${field({ id: 'ate', label: 'Até', type: 'date', value: f.ate })}
    ${field({ id: 'q', label: 'Buscar por e-mail ou detalhe', value: f.q })}
    <div class="field"><label for="acao">Ação</label>${sel('acao', 'acao', f.acao, [['', 'Todas'], ...actions.map((a) => [a, LABELS[a] || a])])}</div>
    <div class="span2 row"><button class="btn btn--outline btn--sm" type="submit">Filtrar</button><a class="btn btn--ghost btn--sm" href="/admin/log">Limpar</a></div></form>
  <p class="muted small">${total ? `Mostrando ${from} a ${to} de ${total} ${total === 1 ? 'registro' : 'registros'}.` : 'Nenhum registro neste filtro.'}</p>
  ${rows.length ? html`<div class="tbl-wrap"><table class="tbl tbl--log"><thead><tr><th>Quando</th><th>Quem</th><th>O que</th><th>Detalhes</th><th>IP</th></tr></thead><tbody>
    ${rows.map((x) => html`<tr><td data-l="Quando">${fmtTime(x.at)}</td><td data-l="Quem">${x.actor_email || 'Sistema ou visitante'}</td>
      <td data-l="O que"><b>${LABELS[x.action] || x.action}</b>${x.entity ? html`<br><span class="muted small">${x.entity}${x.entity_id ? ' #' + x.entity_id : ''}</span>` : ''}</td>
      <td data-l="Detalhes" class="small muted">${metaText(x.meta)}</td><td data-l="IP" class="small muted">${x.ip || ''}</td></tr>`)}</tbody></table></div>` : ''}
  ${pages > 1 ? html`<nav class="pager" aria-label="Páginas">
    ${page > 1 ? html`<a class="btn btn--ghost btn--sm" href="${qs(page - 1)}">← Anterior</a>` : ''}<span class="muted small">Página ${page} de ${pages}</span>
    ${page < pages ? html`<a class="btn btn--ghost btn--sm" href="${qs(page + 1)}">Próxima →</a>` : ''}</nav>` : ''}`;
  return shell(ctx, '/admin/log', 'Registro de atividades', content);
}

// ---------- cupons ----------
const stateBadge = (c) => { const s = K.stateOf(c, c.uses); return html`<span class="pill${s === 'active' ? ' pill--ok' : s === 'scheduled' ? '' : ' pill--draft'}">${K.STATE_LABEL[s]}</span>`; };

function cuponsList(ctx, { rows }) {
  const content = html`${titleRow('Cupons', 'Descontos para divulgar. O cupom vale no pagamento e substitui o preço promocional. Cupons nunca são excluídos: só inativados.')}
  <div class="row row--top"><a class="btn btn--primary" href="/admin/cupons/novo">Novo cupom</a></div>
  ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Cupom</th><th>Desconto</th><th>Cursos</th><th>Validade e usos</th><th>Situação</th><th></th></tr></thead><tbody>
    ${rows.map((c) => html`<tr><td data-l="Cupom"><b class="code">${c.code}</b>${c.note ? html`<br><span class="muted small">${c.note}</span>` : ''}</td>
      <td data-l="Desconto">${K.discountLabel(c)}</td>
      <td data-l="Cursos">${c.courses.length === 1 ? c.courses[0].title : `${c.courses.length} cursos`}</td>
      <td data-l="Validade e usos" class="small">${K.validityLabel(c).replace(/ · \d+ usos?$/, '') || 'Sem período'}<br><span class="muted">${c.uses}${c.max_uses ? ` de ${c.max_uses}` : ''} ${c.uses === 1 ? 'uso' : 'usos'} · ${c.sends} ${c.sends === 1 ? 'envio' : 'envios'}</span></td>
      <td data-l="Situação">${stateBadge(c)}</td>
      <td class="tbl__act"><a class="btn btn--outline btn--sm" href="/admin/cupons/${c.id}">Abrir</a></td></tr>`)}</tbody></table></div>`
    : html`<section class="card empty">${lumen('pensa', 96)}<div><h2 class="t-card">Nenhum cupom ainda</h2><p class="muted">Crie o primeiro cupom: ele gera sozinho o código, o QR Code e a imagem para divulgar.</p></div></section>`}`;
  return shell(ctx, '/admin/cupons', 'Cupons', content);
}

const list2 = (v) => [].concat(v || []).map(String);
function couponFields(ctx, { courses, v, errors = {}, lockedValue = false, isNew = true }) {
  const chosen = list2(v.courses);
  return html`
    ${isNew ? field({ id: 'code', label: 'Código (opcional)', value: v.code || '', error: errors.code, note: 'Deixe vazio para gerar um código como EVO-7K3M9Q. Para criar o seu, use letras maiúsculas, números e hífen.' }) : ''}
    <div class="field"><label for="kind">Tipo de desconto</label>${lockedValue
    ? html`<input id="kind" type="text" value="${v.kind === 'fixed' ? 'Valor fixo (R$)' : 'Porcentagem (%)'}" readonly>`
    : sel('kind', 'kind', v.kind, [['percent', 'Porcentagem (%)'], ['fixed', 'Valor fixo (R$)']])}</div>
    ${field({ id: 'percent', label: 'Porcentagem (1 a 99)', value: v.percent || '', inputmode: 'numeric', error: errors.percent, readonly: lockedValue, note: 'Usada no tipo Porcentagem.' })}
    ${field({ id: 'amount', label: 'Valor em reais', value: v.amount != null ? v.amount : (v.amount_cents ? C.brlInput(v.amount_cents) : ''), inputmode: 'decimal', error: errors.amount, readonly: lockedValue, note: 'Usado no tipo Valor fixo. Precisa ser menor que o valor do curso.' })}
    ${lockedValue ? html`<p class="muted small span2">O desconto não muda depois que o cupom foi enviado ou usado. Para outro valor, crie um novo cupom.</p>` : ''}
    ${field({ id: 'starts_on', label: 'Válido a partir de', type: 'date', value: v.starts_on ? String(v.starts_on).slice(0, 10) : '', error: errors.starts_on })}
    ${field({ id: 'ends_on', label: 'Válido até', type: 'date', value: v.ends_on ? String(v.ends_on).slice(0, 10) : '', error: errors.ends_on })}
    ${field({ id: 'max_uses', label: 'Quantidade de usos', value: v.max_uses || '', inputmode: 'numeric', error: errors.max_uses, note: 'Cada pessoa só pode usar o mesmo cupom uma vez.' })}
    ${errors.limit ? html`<div class="field__msg field__msg--err span2" role="alert">${errors.limit}</div>` : html`<p class="muted small span2">Defina um período, uma quantidade, ou os dois (a quantidade vale dentro do período).</p>`}
    <div class="span2">${field({ id: 'note', label: 'Anotação interna (opcional)', value: v.note || '', note: 'Só você vê. Ex.: "Campanha de Natal".' })}</div>
    <fieldset class="span2 fieldset${errors.courses ? ' field--err' : ''}"><legend>Cursos com este cupom</legend>
      ${courses.map((c) => html`<label class="check"><input type="checkbox" name="courses" value="${c.id}"${chosen.includes(String(c.id)) ? raw(' checked') : ''}><span>${c.title} <small class="muted">${C.brl(c.price_cents)}${c.status === 'published' ? '' : ' · rascunho'}</small></span></label>`)}
      ${errors.courses ? html`<div class="field__msg field__msg--err" role="alert">${errors.courses}</div>` : ''}</fieldset>`;
}

function cupomForm(ctx, { courses, values, errors = {}, from = null }) {
  const content = html`<a class="back" href="/admin/cupons">← Cupons</a>${titleRow('Novo cupom', from ? `Baseado no cupom ${from.code}. O código novo é gerado, e as datas ficam em branco.` : 'Ao criar, o sistema gera o código, o QR Code e a imagem do cupom.')}
  ${Object.keys(errors).length ? html`<div class="alert alert--error" role="alert">Confira os campos destacados.</div>` : ''}
  <form method="post" action="/admin/cupons" class="form" novalidate>${csrfInput(ctx.csrf)}
    <section class="card"><div class="form form--grid">${couponFields(ctx, { courses, v: values, errors })}</div></section>
    <div class="row"><button class="btn btn--primary btn--lg" type="submit">Criar cupom</button></div></form>`;
  return shell(ctx, '/admin/cupons', 'Novo cupom', content);
}

function cupomDetail(ctx, { c, sends, courses, link, errors = {}, values = null }) {
  const st = K.stateOf(c, c.uses);
  const editable = c.status === 'active';
  const locked = c.uses > 0 || c.sends > 0;
  const v = values || { ...c, courses: c.courses.map((x) => String(x.id)) };
  const img = `/admin/cupons/${c.id}/imagem.png`;
  const content = html`<a class="back" href="/admin/cupons">← Cupons</a>${titleRow(c.code, `${K.discountLabel(c)} de desconto · ${K.validityLabel(c) || 'sem período'}`)}
  ${Object.keys(errors).length ? html`<div class="alert alert--error" role="alert">Confira os campos destacados.</div>` : ''}
  <section class="card coupon-top">
    <button type="button" class="cthumb" data-modal-open="cupom-modal" aria-label="Ampliar a imagem do cupom"><img src="${img}" alt="Imagem do cupom ${c.code}" width="150" height="188"></button>
    <div class="coupon-top__info">
      <p>${stateBadge(c)} <span class="muted small">${c.uses}${c.max_uses ? ` de ${c.max_uses}` : ''} ${c.uses === 1 ? 'uso' : 'usos'} · ${c.sends} ${c.sends === 1 ? 'envio' : 'envios'}</span></p>
      <p class="muted small">Cursos: ${c.courses.map((x) => x.title).join(', ')}</p>
      <div class="linkbox"><code id="cupom-link">${link}</code><button type="button" class="btn btn--ghost btn--sm" data-copy="cupom-link">Copiar link</button></div>
      <div class="row"><button type="button" class="btn btn--primary btn--sm" data-modal-open="cupom-modal">Ver imagem maior</button>
        <a class="btn btn--outline btn--sm" href="${img}?baixar=1">Baixar imagem</a></div>
      <p class="muted small">O QR Code e o link abrem o curso com o cupom guardado. O desconto vale no pagamento.</p>
    </div>
  </section>
  <dialog id="cupom-modal" class="modal" aria-label="Imagem do cupom ${c.code}"><div class="modal__in">
    <img src="${img}" alt="Imagem do cupom ${c.code}">
    <div class="row"><a class="btn btn--primary" href="${img}?baixar=1">Baixar imagem</a><button type="button" class="btn btn--ghost" data-modal-close>Fechar</button></div></div></dialog>

  ${st === 'active' || st === 'scheduled' ? html`<section class="card"><h2 class="t-card">Enviar por e-mail</h2>
    <p class="muted">Cadastre o e-mail de quem pode se interessar. A pessoa recebe o cupom com a imagem em anexo. Isso não cria conta e não libera nenhum curso.</p>
    <form method="post" action="/admin/cupons/${c.id}/enviar" class="form form--grid" novalidate>${csrfInput(ctx.csrf)}
      ${field({ id: 'send_email', name: 'email', label: 'E-mail', type: 'email', required: true })}${field({ id: 'send_name', name: 'name', label: 'Nome (opcional)', autocomplete: 'off' })}
      <div class="span2 row"><button class="btn btn--primary" type="submit">Enviar cupom</button></div></form>
    ${sends.length ? html`<h3 class="t-sub">Envios</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>E-mail</th><th>Quando</th><th>Resultado</th></tr></thead><tbody>${sends.map((s) => html`<tr>
      <td data-l="E-mail">${s.email}${s.name ? html`<br><span class="muted small">${s.name}</span>` : ''}</td><td data-l="Quando">${fmtTime(s.created_at)}</td>
      <td data-l="Resultado">${s.status === 'sent' ? html`<span class="pill pill--ok">Enviado</span>` : html`<span class="pill pill--draft">${s.status === 'skipped' ? 'Não enviado' : 'Falhou'}</span>`}</td></tr>`)}</tbody></table></div>` : ''}</section>` : ''}

  ${editable ? html`<section class="card"><h2 class="t-card">Editar cupom</h2>
    <form method="post" action="/admin/cupons/${c.id}" class="form" novalidate>${csrfInput(ctx.csrf)}
      <div class="form form--grid">${couponFields(ctx, { courses, v, errors, lockedValue: locked, isNew: false })}</div>
      <div class="row"><button class="btn btn--primary" type="submit">Salvar cupom</button></div></form></section>
  <section class="card danger"><h2 class="t-card">Inativar cupom</h2>
    <p class="muted">Cupom não é excluído, para o histórico ficar guardado. Inativar é definitivo: para usar de novo, crie outro cupom.</p>
    <div class="row"><form method="post" action="/admin/cupons/${c.id}/inativar" class="inline" data-confirm="Inativar este cupom? Não dá para reativar. Para usar de novo, será preciso criar outro.">${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">Inativar cupom</button></form>
    <a class="btn btn--ghost btn--sm" href="/admin/cupons/novo?copiar=${c.id}">Criar novo a partir deste</a></div></section>`
    : html`<section class="card"><h2 class="t-card">Cupom inativo</h2><p class="muted">Este cupom foi inativado e fica só no histórico. Para usar de novo, crie outro.</p>
      <a class="btn btn--outline btn--sm" href="/admin/cupons/novo?copiar=${c.id}">Criar novo a partir deste</a></section>`}`;
  return shell(ctx, '/admin/cupons', `Cupom ${c.code}`, content);
}

module.exports = { alunos, cortesias, log, cuponsList, cupomForm, cupomDetail, LABELS };
