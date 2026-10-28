'use strict';
// Telas: Ajuda (aluno e administrador), LGPD e aceites, Configurações.
const { html, raw } = require('../html');
const { shellApp, lumen } = require('../layout');
const { csrfInput } = require('./ui');
const H = require('../help');

const fmtDateTime = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const fmtDate = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const titleRow = (title, sub) => html`<div class="title-row"><h1 class="t-display">${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>`;
const shell = (ctx, title, content, path) => shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path, title, content });
const sel = (id, name, value, opts) => html`<select id="${id}" name="${name}">${opts.map(([v, l]) => html`<option value="${v}"${String(value) === String(v) ? raw(' selected') : ''}>${l}</option>`)}</select>`;

// ---- Ajuda ----
function ajuda(ctx, { settings }) {
  const admin = ctx.user.role === 'admin';
  const topics = admin ? H.ADMIN : H.STUDENT;
  const contact = [settings.support_email ? html`E-mail: <b>${settings.support_email}</b>` : '', settings.support_whatsapp ? html`WhatsApp: <b>${settings.support_whatsapp}</b>` : ''].filter(Boolean);
  const content = html`${titleRow('Ajuda', 'Passo a passo de cada tela e as dúvidas mais comuns.')}
  <section class="card help-hero">${lumen('guia', 90)}<p>Oi! Em qualquer tela, o botão <b>?</b> no topo mostra o que fazer ali. Aqui está tudo reunido.</p></section>
  <section class="card"><h2 class="t-card">Passo a passo</h2>${topics.map((t) => html`<details class="faq-i"><summary>${t.title}</summary><ol>${t.steps.map((x) => html`<li>${x}</li>`)}</ol></details>`)}</section>
  ${admin ? '' : html`<section class="card"><h2 class="t-card">Perguntas frequentes</h2>${H.FAQ.map(([q, a]) => html`<details class="faq-i"><summary>${q}</summary><p>${a}</p></details>`)}</section>`}
  <section class="card"><h2 class="t-card">Ainda precisa de ajuda?</h2>${contact.length ? html`<p>${contact.map((c, i) => html`${i ? raw(' · ') : ''}${c}`)}</p>` : html`<p class="muted">O contato de suporte ainda não foi informado.</p>`}</section>`;
  return shell(ctx, 'Ajuda', content, '/ajuda');
}

// ---- LGPD ----
const REQ = { export: 'Cópia dos dados', delete: 'Exclusão dos dados', email_change_admin: 'Troca de e-mail' };
const REQ_ST = { open: 'Em aberto', done: 'Atendido', denied: 'Negado' };

function lgpd(ctx, { aba, pedidos, aceites, f, page, pages, total, docTypes }) {
  const tabs = html`<nav class="tabs" aria-label="Seções">
    <a class="tab${aba === 'pedidos' ? ' is-on' : ''}" href="/admin/lgpd">Pedidos do titular</a><a class="tab${aba === 'aceites' ? ' is-on' : ''}" href="/admin/lgpd?aba=aceites">Aceites dos textos</a></nav>`;
  let body;
  if (aba === 'aceites') {
    const qs = (p) => { const u = new URLSearchParams({ aba: 'aceites' }); if (f.q) u.set('q', f.q); if (f.doc) u.set('doc', f.doc); if (p > 1) u.set('p', p); return '/admin/lgpd?' + u; };
    const csv = (() => { const u = new URLSearchParams(); if (f.q) u.set('q', f.q); if (f.doc) u.set('doc', f.doc); return '/admin/lgpd/aceites.csv' + (u.toString() ? '?' + u : ''); })();
    body = html`<form method="get" action="/admin/lgpd" class="form form--grid filters"><input type="hidden" name="aba" value="aceites">
      <div class="field"><label for="q">Buscar aluno</label><input id="q" name="q" value="${f.q}" maxlength="80" placeholder="Nome ou e-mail"></div>
      <div class="field"><label for="doc">Documento</label>${sel('doc', 'doc', f.doc, [['', 'Todos'], ...docTypes])}</div>
      <div class="row"><button class="btn btn--outline" type="submit">Filtrar</button><a class="btn btn--ghost" href="${csv}">Exportar CSV</a></div></form>
    <section class="card"><p class="muted small">${total} ${total === 1 ? 'aceite' : 'aceites'}. Estes registros não podem ser editados nem apagados e são guardados por 5 anos.</p>
    ${aceites.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data e hora</th><th>Aluno</th><th>Documento</th><th>Versão</th><th>IP</th><th>Dispositivo</th><th>Origem</th></tr></thead><tbody>
      ${aceites.map((a) => html`<tr><td data-l="Data e hora">${fmtDateTime(a.accepted_at)}</td><td data-l="Aluno"><b>${a.name}</b><br><span class="muted small">${a.email}</span></td><td data-l="Documento">${a.doc_type === 'terms' ? 'Termos de uso' : a.doc_type === 'privacy' ? 'Política de privacidade' : a.doc_type}</td>
        <td data-l="Versão">${a.version}</td><td data-l="IP">${a.ip || '—'}</td><td data-l="Dispositivo">${a.device || '—'}</td><td data-l="Origem">${a.origin}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Nenhum aceite encontrado.</p>`}</section>
    ${pages > 1 ? html`<nav class="pager" aria-label="Páginas">${page > 1 ? html`<a class="btn btn--ghost btn--sm" href="${qs(page - 1)}">← Anterior</a>` : ''}<span class="muted small">Página ${page} de ${pages}</span>${page < pages ? html`<a class="btn btn--ghost btn--sm" href="${qs(page + 1)}">Próxima →</a>` : ''}</nav>` : ''}`;
  } else {
    body = html`<section class="card"><p class="muted small">Prazo para responder: 15 dias. Atender uma exclusão anonimiza a conta (nome, e-mail, CPF, telefone, endereço, mensagens e registro de e-mails enviados) e cancela os acessos. Ficam guardados por obrigação legal: os pedidos, com os dados informados na compra, os aceites dos textos e os certificados emitidos. Isto deve constar na Política de privacidade.</p>
    ${pedidos.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pedido em</th><th>Aluno</th><th>Tipo</th><th>Prazo</th><th>Situação</th><th></th></tr></thead><tbody>
      ${pedidos.map((r) => html`<tr><td data-l="Pedido em">${fmtDateTime(r.created_at)}</td><td data-l="Aluno"><b>${r.name}</b><br><span class="muted small">${r.email}</span></td>
        <td data-l="Tipo">${REQ[r.type] || r.type}${r.type === 'email_change_admin' && r.note ? html`<br><span class="muted small">novo: ${r.note}</span>` : ''}</td>
        <td data-l="Prazo">${fmtDate(r.due_at)}${r.status === 'open' && new Date(r.due_at) < new Date() ? html` <span class="pill pill--draft">Vencido</span>` : ''}</td>
        <td data-l="Situação"><span class="pill${r.status === 'done' ? ' pill--ok' : r.status === 'denied' ? ' pill--draft' : ''}">${REQ_ST[r.status]}</span></td>
        <td class="tbl__act">${r.status === 'open' ? html`<a class="btn btn--outline btn--sm" href="/admin/lgpd/pedidos/${r.id}/dados.json">Baixar dados</a>
          <details class="inline-pop"><summary class="btn btn--primary btn--sm">Responder</summary><form method="post" action="/admin/lgpd/pedidos/${r.id}/resolver" class="form">${csrfInput(ctx.csrf)}
            <div class="field"><label for="n${r.id}">Mensagem ao aluno (opcional)</label><input id="n${r.id}" name="note" maxlength="500"></div>
            <div class="row"><button class="btn btn--primary btn--sm" type="submit" name="action" value="done" data-confirm="${r.type === 'delete' ? 'Anonimizar a conta deste aluno? Isto não pode ser desfeito.' : 'Marcar como atendido?'}">Atender</button><button class="btn btn--outline btn--sm" type="submit" name="action" value="denied">Negar</button></div></form></details>` : (r.response ? html`<span class="muted small">${r.response}</span>` : '')}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Nenhum pedido até agora.</p>`}</section>`;
  }
  return shell(ctx, 'LGPD e aceites', html`${titleRow('LGPD e aceites', 'Pedidos dos titulares e o registro de quem aceitou cada texto.')}${tabs}${body}`, '/admin/lgpd');
}

// ---- Configurações ----
function configuracoes(ctx, { settings, status, errors = {} }) {
  const row = (label, value, ok) => html`<tr><td data-l="Item">${label}</td><td data-l="Situação"><span class="pill${ok ? ' pill--ok' : ' pill--draft'}">${value}</span></td></tr>`;
  const content = html`${titleRow('Configurações', 'Contato de suporte, fórum e a situação do sistema.')}
  <section class="card"><h2 class="t-card">Plataforma</h2>
    <form method="post" action="/admin/configuracoes" class="form form--grid">${csrfInput(ctx.csrf)}
      <div class="field${errors.support_email ? ' field--err' : ''}"><label for="support_email">E-mail de suporte</label><input id="support_email" name="support_email" type="email" maxlength="200" value="${settings.support_email}">${errors.support_email ? html`<div class="field__msg field__msg--err">${errors.support_email}</div>` : html`<div class="field__msg">Aparece na página de Ajuda dos alunos.</div>`}</div>
      <div class="field${errors.support_whatsapp ? ' field--err' : ''}"><label for="support_whatsapp">WhatsApp de suporte</label><input id="support_whatsapp" name="support_whatsapp" maxlength="25" value="${settings.support_whatsapp}" placeholder="(11) 90000-0000">${errors.support_whatsapp ? html`<div class="field__msg field__msg--err">${errors.support_whatsapp}</div>` : ''}</div>
      <div class="field"><label class="chk"><input type="checkbox" name="forum_enabled" value="1"${settings.forum_enabled === '1' ? raw(' checked') : ''}> Fórum ligado nas aulas</label></div>
      <div class="field"><label class="chk"><input type="checkbox" name="notify_questions" value="1"${settings.notify_questions === '1' ? raw(' checked') : ''}> Avisar por e-mail quando um aluno fizer uma pergunta</label></div>
      <div class="span2 row"><button class="btn btn--primary" type="submit">Salvar configurações</button></div></form></section>
  <section class="card"><h2 class="t-card">Situação do sistema</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th>Situação</th></tr></thead><tbody>
    ${row('Versão', status.version, true)}${row('Ambiente', status.env, true)}${row('Endereço do site', status.baseUrl, true)}
    ${row('E-mail', status.mail ? 'Configurado' : 'Não configurado', status.mail)}${row('Pagamentos', status.payments, status.paymentsOn)}
    ${row('Textos legais publicados', `${status.legal} de 2`, status.legal >= 2)}</tbody></table></div>
    <p class="muted small">Segredos e chaves ficam nas variáveis do Railway e nunca aparecem aqui.</p></section>`;
  return shell(ctx, 'Configurações', content, '/admin/configuracoes');
}

module.exports = { ajuda, lgpd, configuracoes };
