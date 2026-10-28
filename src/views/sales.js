'use strict';
// Painel do administrador (Fase 4): vendas e renovações, detalhe do pedido, simulador de pagamento e textos legais.
const { html, raw } = require('../html');
const { shellApp, lumen } = require('../layout');
const { csrfInput } = require('./ui');
const { titleRow } = require('./student');
const { area } = require('./admin');
const { brl } = require('../courses');
const { STATUS, STATUS_CLASS, METHOD, fmtDate, fmtDateTime } = require('./pay');
const F = require('../finance');

const shell = (ctx, title, content, path) => shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path, title, content });
const sel = (id, name, value, opts) => html`<select id="${id}" name="${name}">${opts.map(([v, l]) => html`<option value="${v}"${String(value) === String(v) ? raw(' selected') : ''}>${l}</option>`)}</select>`;
const pill = (s) => html`<span class="pill ${STATUS_CLASS[s] || ''}">${STATUS[s] || s}</span>`;
const pager = (page, pages, qs) => (pages > 1 ? html`<nav class="pager" aria-label="Páginas">${page > 1 ? html`<a class="btn btn--ghost btn--sm" href="${qs(page - 1)}">← Anterior</a>` : ''}<span class="muted small">Página ${page} de ${pages}</span>${page < pages ? html`<a class="btn btn--ghost btn--sm" href="${qs(page + 1)}">Próxima →</a>` : ''}</nav>` : '');

// ---- lista de vendas ----
function vendas(ctx, { rows, courses, f, page, pages, total, kpi, requests }) {
  const qs = (p) => { const u = new URLSearchParams(); for (const k of ['q', 'status', 'curso', 'forma']) if (f[k]) u.set(k, f[k]); if (p > 1) u.set('p', p); const s = u.toString(); return `/admin/vendas${s ? '?' + s : ''}`; };
  const content = html`${titleRow('Vendas e renovações', 'Cada compra, renovação e reembolso, com o histórico de pagamento.')}
  ${!ctx.cfg.isProd && ctx.cfg.paymentProvider === 'simulated' ? html`<p><a class="btn btn--outline btn--sm" href="/admin/simulador">Abrir o simulador de pagamento</a></p>` : ''}
  <div class="stats">
    <div class="stat"><span class="muted">Vendas aprovadas</span><b class="t-card">${kpi.approved}</b></div>
    <div class="stat"><span class="muted">Valor recebido</span><b class="t-card">${brl(kpi.paid)}</b></div>
    <div class="stat"><span class="muted">Aguardando pagamento</span><b class="t-card">${kpi.pending}</b></div>
    <div class="stat"><span class="muted">Devolvidas</span><b class="t-card">${kpi.refunded}</b></div></div>
  ${requests.length ? html`<section class="card"><h2 class="t-card">Pedidos de reembolso</h2><p class="muted small">Ao aprovar, o dinheiro é devolvido pelo Mercado Pago e o acesso e o certificado são cancelados na hora.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Aluno</th><th>Curso</th><th>Pedido em</th><th>Motivo</th><th></th></tr></thead><tbody>
    ${requests.map((r) => html`<tr><td data-l="Aluno"><b>${r.student_name}</b><br><span class="muted small">${r.email}</span></td><td data-l="Curso">${r.course_title}<br><span class="muted small">${brl(r.paid_cents || r.price_cents)}</span></td><td data-l="Pedido em">${fmtDateTime(r.created_at)}</td><td data-l="Motivo">${r.reason || '—'}</td>
      <td class="tbl__act"><form method="post" action="/admin/vendas/${r.order_id}/reembolsar" class="inline" data-confirm="Devolver o valor e cancelar o acesso deste aluno?">${csrfInput(ctx.csrf)}<input type="hidden" name="request" value="${r.id}"><button class="btn btn--primary btn--sm" type="submit">Aprovar</button></form>
        <details class="inline-pop"><summary class="btn btn--outline btn--sm">Recusar</summary><form method="post" action="/admin/reembolsos/${r.id}/recusar" class="form">${csrfInput(ctx.csrf)}<div class="field"><label for="n${r.id}">Mensagem ao aluno</label><input id="n${r.id}" name="note" maxlength="300" placeholder="Opcional"></div><button class="btn btn--primary btn--sm" type="submit">Recusar</button></form></details></td></tr>`)}</tbody></table></div></section>` : ''}
  <form method="get" action="/admin/vendas" class="form form--grid filters">
    <div class="field"><label for="q">Buscar</label><input id="q" name="q" value="${f.q || ''}" placeholder="Nome, e-mail ou código do pedido" maxlength="80"></div>
    <div class="field"><label for="status">Situação</label>${sel('status', 'status', f.status || '', [['', 'Todas'], ...Object.entries(STATUS)])}</div>
    <div class="field"><label for="curso">Curso</label>${sel('curso', 'curso', f.curso || '', [['', 'Todos'], ...courses.map((c) => [c.id, c.title])])}</div>
    <div class="field"><label for="forma">Forma</label>${sel('forma', 'forma', f.forma || '', [['', 'Todas'], ['pix', 'Pix'], ['card', 'Cartão']])}</div>
    <div class="row"><button class="btn btn--outline" type="submit">Filtrar</button></div></form>
  <section class="card">${rows.length ? html`<p class="muted small">${total} ${total === 1 ? 'pedido' : 'pedidos'}</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Aluno</th><th>Curso</th><th>Forma</th><th>Valor</th><th>Situação</th><th></th></tr></thead><tbody>
    ${rows.map((o) => html`<tr><td data-l="Data">${fmtDateTime(o.created_at)}</td><td data-l="Aluno"><b>${o.buyer.name}</b><br><span class="muted small">${o.buyer.email}</span></td>
      <td data-l="Curso">${o.course_title}${o.kind === 'renewal' ? html` <span class="pill">Renovação</span>` : ''}</td><td data-l="Forma">${METHOD[o.method]}${o.installments > 1 ? html`<br><span class="muted small">${o.installments}x</span>` : ''}</td>
      <td data-l="Valor">${brl(o.paid_cents || o.price_cents)}${o.coupon_code ? html`<br><span class="muted small">cupom ${o.coupon_code}</span>` : ''}</td><td data-l="Situação">${pill(o.status)}</td>
      <td class="tbl__act"><a class="btn btn--ghost btn--sm" href="/admin/vendas/${o.id}">Detalhes</a></td></tr>`)}</tbody></table></div>${pager(page, pages, qs)}`
    : html`<div class="empty">${lumen('pensa', 90)}<p class="muted">Nenhum pedido neste filtro.</p></div>`}</section>`;
  return shell(ctx, 'Vendas e renovações', content, '/admin/vendas');
}

// ---- detalhe do pedido ----
function venda(ctx, { o, course, refunds, canRefund }) {
  const dl = (rows) => html`<div class="kvs">${rows.filter(Boolean).map(([k, v]) => html`<div class="kv"><span>${k}</span><span>${v}</span></div>`)}</div>`;
  const content = html`<a class="back" href="/admin/vendas">← Vendas</a>${titleRow(`Pedido ${o.public_id}`, `${course ? course.title : ''}`)}
  <section class="card"><div class="row">${pill(o.status)}${o.kind === 'renewal' ? html`<span class="pill">Renovação</span>` : ''}</div>
    ${dl([
    ['Comprador', html`${o.buyer.name}<br><span class="muted small">${o.buyer.email}</span>`],
    ['Criado em', fmtDateTime(o.created_at)],
    ['Forma', `${METHOD[o.method]}${o.installments > 1 ? ` em ${o.installments}x` : ''}`],
    ['Preço de tabela', brl(o.list_cents)],
    ['Preço cobrado', `${brl(o.price_cents)}${o.price_source === 'promo' ? ' (promoção)' : o.price_source === 'coupon' ? ' (cupom)' : o.price_source === 'renewal' ? ' (renovação)' : ''}`],
    o.paid_cents ? ['Valor pago pelo aluno', brl(o.paid_cents)] : null,
    o.approved_at ? ['Aprovado em', fmtDateTime(o.approved_at)] : null,
    o.refund_until ? ['Reembolso até', fmtDate(o.refund_until)] : null,
    o.refunded_at ? ['Devolvido em', fmtDateTime(o.refunded_at)] : null,
    ['Gateway', `${o.provider}${o.provider_payment_id ? ' · ' + o.provider_payment_id : ''}`],
    o.status_detail ? ['Detalhe', o.status_detail] : null,
  ])}</section>
  ${refunds.length ? html`<section class="card"><h2 class="t-card">Pedidos de reembolso</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Situação</th><th>Motivo</th><th>Resposta</th></tr></thead><tbody>
    ${refunds.map((r) => html`<tr><td data-l="Data">${fmtDateTime(r.created_at)}</td><td data-l="Situação">${{ requested: 'Aguardando', approved: 'Aprovado', rejected: 'Recusado', failed: 'Falhou no gateway' }[r.status]}</td><td data-l="Motivo">${r.reason || '—'}</td><td data-l="Resposta">${r.admin_note || '—'}</td></tr>`)}</tbody></table></div></section>` : ''}
  ${canRefund ? html`<section class="card"><h2 class="t-card">Devolver o valor</h2><p class="muted small">O Mercado Pago devolve ao aluno, o acesso ao curso é cancelado e o certificado é revogado.</p>
    <form method="post" action="/admin/vendas/${o.id}/reembolsar" class="inline" data-confirm="Devolver o valor e cancelar o acesso deste aluno?">${csrfInput(ctx.csrf)}<button class="btn btn--primary" type="submit">Reembolsar agora</button></form></section>` : ''}`;
  return shell(ctx, `Pedido ${o.public_id}`, content, '/admin/vendas');
}

// ---- simulador (somente teste e staging) ----
function simulador(ctx, { rows }) {
  const acts = [['approved', 'Aprovar'], ['pending', 'Pendente'], ['refused', 'Recusar'], ['expired', 'Vencer'], ['refunded', 'Reembolsar'], ['charged_back', 'Estornar']];
  const content = html`${titleRow('Simulador de pagamento', 'Só existe em teste e staging. Escolha o que o banco responderia e o sistema reage como no pagamento real.')}
  <section class="card">${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pedido</th><th>Aluno</th><th>Curso</th><th>Valor</th><th>Situação</th><th>Simular</th></tr></thead><tbody>
    ${rows.map((o) => html`<tr><td data-l="Pedido"><span class="code">${o.public_id}</span></td><td data-l="Aluno">${o.buyer.name}<br><span class="muted small">${o.buyer.email}</span></td><td data-l="Curso">${o.course_title}</td><td data-l="Valor">${brl(o.price_cents)}</td><td data-l="Situação">${pill(o.status)}</td>
      <td class="tbl__act">${acts.map(([v, l]) => html`<form method="post" action="/admin/simulador/${o.public_id}" class="inline">${csrfInput(ctx.csrf)}<input type="hidden" name="result" value="${v}"><button class="btn btn--outline btn--sm" type="submit">${l}</button></form>`)}</td></tr>`)}</tbody></table></div>`
    : html`<div class="empty">${lumen('pensa', 90)}<p class="muted">Nenhum pedido simulado ainda. Abra o checkout de um curso pago para criar um.</p></div>`}</section>`;
  return shell(ctx, 'Simulador de pagamento', content, '/admin/simulador');
}

// ---- textos legais ----
function textos(ctx, { docs }) {
  const label = { terms: 'Termos de uso', privacy: 'Política de privacidade' };
  const content = html`${titleRow('Textos legais', 'Termos de uso e política de privacidade. Um texto publicado não muda mais: para alterar, crie uma nova versão.')}
  ${['terms', 'privacy'].map((t) => html`<section class="card"><h2 class="t-card">${label[t]}</h2>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Versão</th><th>Situação</th><th>Publicado em</th><th>Aceites</th><th></th></tr></thead><tbody>
    ${docs.filter((d) => d.doc_type === t).map((d) => html`<tr><td data-l="Versão">${d.version}</td><td data-l="Situação">${d.status === 'published' ? html`<span class="pill pill--ok">Publicado</span>` : html`<span class="pill pill--draft">Rascunho</span>`}</td><td data-l="Publicado em">${d.published_at ? fmtDate(d.published_at) : '—'}</td><td data-l="Aceites">${d.accepts}</td>
      <td class="tbl__act">${d.status === 'draft' ? html`<a class="btn btn--outline btn--sm" href="/admin/textos/${d.id}">Editar</a>` : html`<a class="btn btn--ghost btn--sm" href="/admin/textos/${d.id}">Ver</a>`}</td></tr>`)}</tbody></table></div>
    <form method="post" action="/admin/textos/nova" class="inline" data-confirm="Criar uma nova versão em rascunho, copiando o texto atual?">${csrfInput(ctx.csrf)}<input type="hidden" name="doc_type" value="${t}"><button class="btn btn--ghost btn--sm" type="submit">Nova versão</button></form></section>`)}`;
  return shell(ctx, 'Textos legais', content, '/admin/textos');
}

function texto(ctx, { d, error = '' }) {
  const draft = d.status === 'draft';
  const btn = (cmd, label, title, extra = '') => html`<button type="button" class="editor__btn${extra}" data-cmd="${cmd}" title="${title}" aria-label="${title}">${label}</button>`;
  const content = html`<a class="back" href="/admin/textos">← Textos legais</a>${titleRow(`${d.title} · ${d.version}`, draft ? 'Rascunho. Só vale depois de publicar.' : 'Publicado. Não pode mais ser alterado.')}
  ${draft ? html`<section class="card"><form method="post" action="/admin/textos/${d.id}" class="form" data-editor-form>${csrfInput(ctx.csrf)}
    <div class="field"><label id="ed-l">Texto</label>
      <div class="editor" data-editor>
        <div class="editor__bar" role="toolbar" aria-label="Formatação do texto">
          ${btn('formatBlock:h2', 'Título', 'Título')}${btn('formatBlock:h3', 'Subtítulo', 'Subtítulo')}${btn('formatBlock:p', 'Parágrafo', 'Parágrafo normal')}
          <span class="editor__sep"></span>
          ${btn('bold', 'N', 'Negrito', ' editor__btn--b')}${btn('italic', 'I', 'Itálico', ' editor__btn--i')}${btn('underline', 'S', 'Sublinhado', ' editor__btn--u')}
          <span class="editor__sep"></span>
          ${btn('insertUnorderedList', '• Lista', 'Lista com marcadores')}${btn('insertOrderedList', '1. Lista', 'Lista numerada')}${btn('formatBlock:blockquote', 'Citação', 'Citação')}
          <span class="editor__sep"></span>
          ${btn('link', 'Link', 'Inserir link')}${btn('unlink', 'Tirar link', 'Remover link')}${btn('removeFormat', 'Limpar', 'Limpar formatação')}
          <span class="editor__sep"></span>
          ${btn('undo', 'Desfazer', 'Desfazer')}${btn('redo', 'Refazer', 'Refazer')}
        </div>
        <div class="editor__area legal-body" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="ed-l" spellcheck="true">${raw(d.body_html)}</div>
        <input type="hidden" name="body_html" value="">
      </div>
      <p class="field__msg">Escreva ou cole o texto aqui. Use os botões para título, negrito e listas. Não precisa de código. A formatação colada do Word é limpa automaticamente.</p>
      ${error ? html`<div class="field__msg field__msg--err">${error}</div>` : ''}</div>
    <noscript><p class="muted">Ative o JavaScript do navegador para usar o editor.</p></noscript>
    <div class="row"><button class="btn btn--outline" type="submit">Salvar rascunho</button></div></form>
    <form method="post" action="/admin/textos/${d.id}/publicar" class="inline" data-confirm="Publicar? Depois de publicado, o texto não pode mais ser editado e passa a valer para novos aceites. Salve o rascunho antes.">${csrfInput(ctx.csrf)}<button class="btn btn--primary" type="submit">Publicar esta versão</button></form></section>`
    : html`<section class="card legal legal--full">${raw(d.body_html)}</section>`}`;
  return shell(ctx, d.title, content, '/admin/textos');
}

// ---- cockpit financeiro ----
const pct = (v) => (v == null ? '—' : `${v.toFixed(1).replace('.', ',')}%`);
const dBR = (s) => s.split('-').reverse().join('/');
const label = (k, unit) => (unit === 'month' ? `${k.slice(5, 7)}/${k.slice(2, 4)}` : `${k.slice(8, 10)}/${k.slice(5, 7)}`);

function chart(series, unit) {
  const W = 640; const H = 220; const padL = 8; const padB = 22; const padT = 10;
  const max = Math.max(1, ...series.map((x) => Math.max(x.gross, x.refunds)));
  const slot = (W - padL * 2) / series.length; const bw = Math.max(2, Math.min(18, slot / 2.6));
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const bars = series.map((x, i) => {
    const cx = padL + slot * i + slot / 2;
    const a = x.gross > 0 ? `<rect class="ch-g" x="${(cx - bw - 0.5).toFixed(1)}" y="${y(x.gross).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - padB - y(x.gross)).toFixed(1)}" rx="2"/>` : '';
    const b = x.refunds > 0 ? `<rect class="ch-r" x="${(cx + 0.5).toFixed(1)}" y="${y(x.refunds).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - padB - y(x.refunds)).toFixed(1)}" rx="2"/>` : '';
    return a + b;
  }).join('');
  const step = Math.max(1, Math.ceil(series.length / 8));
  const ticks = series.map((x, i) => (i % step === 0 || i === series.length - 1 ? `<text class="ch-t" x="${(padL + slot * i + slot / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${label(x.key, unit)}</text>` : '')).join('');
  const total = series.reduce((s, x) => s + x.gross, 0); const totalR = series.reduce((s, x) => s + x.refunds, 0);
  return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de receita bruta e devoluções por ${unit === 'month' ? 'mês' : 'dia'}. Total bruto ${brl(total)}. Total devolvido ${brl(totalR)}. Os valores estão na tabela abaixo do gráfico.">
    <line class="ch-ax" x1="${padL}" y1="${H - padB}" x2="${W - padL}" y2="${H - padB}"/>${raw(bars)}${raw(ticks)}<text class="ch-t" x="${padL}" y="${padT + 6}">${brl(max)}</text></svg>`;
}

function financeiro(ctx, { per, curso, courses, data: d }) {
  const custom = per.key === 'custom';
  const content = html`${titleRow('Cockpit financeiro', 'Receita, devoluções e retenção. A venda conta no dia da aprovação do pagamento.')}
  <form method="get" action="/admin/financeiro" class="form form--grid filters">
    <div class="field"><label for="periodo">Período</label>${sel('periodo', 'periodo', per.key, Object.entries(F.PRESETS))}</div>
    <div class="field"><label for="de">De</label><input id="de" type="date" name="de" value="${per.from}"></div>
    <div class="field"><label for="ate">Até</label><input id="ate" type="date" name="ate" value="${per.to}"></div>
    <div class="field"><label for="curso">Curso</label>${sel('curso', 'curso', curso || '', [['', 'Todos'], ...courses.map((c) => [c.id, c.title])])}</div>
    <div class="row"><button class="btn btn--outline" type="submit">Atualizar</button></div></form>
  <p class="muted small">${per.label}: ${dBR(per.from)} a ${dBR(per.to)}. ${custom ? '' : 'As datas "De" e "Até" só valem em "Período livre".'}</p>
  <div class="stats stats--6">
    <div class="stat"><span class="muted">Receita bruta</span><b class="t-card">${brl(d.sales.gross)}</b><span class="muted small">${d.sales.n} ${d.sales.n === 1 ? 'venda' : 'vendas'}</span></div>
    <div class="stat"><span class="muted">Devolvido</span><b class="t-card">${brl(d.refunds.value)}</b><span class="muted small">${d.refunds.refunded} reembolso${d.refunds.refunded === 1 ? '' : 's'} · ${d.refunds.chargedBack} chargeback${d.refunds.chargedBack === 1 ? '' : 's'}</span></div>
    <div class="stat"><span class="muted">Receita líquida</span><b class="t-card">${brl(d.net)}</b><span class="muted small">bruta − devolvido</span></div>
    <div class="stat"><span class="muted">Ticket médio</span><b class="t-card">${brl(d.sales.avgTicket)}</b><span class="muted small">${d.sales.withCoupon} com cupom</span></div>
    <div class="stat"><span class="muted">Novas e renovações</span><b class="t-card">${d.sales.news} · ${d.sales.renewals}</b><span class="muted small">novas · renovações</span></div>
    <div class="stat"><span class="muted">Conclusões</span><b class="t-card">${d.certificates}</b><span class="muted small">certificados emitidos</span></div>
    <div class="stat"><span class="muted">Churn</span><b class="t-card ${d.churn != null && d.churn > 20 ? 'down' : ''}">${pct(d.churn)}</b><span class="muted small">${d.lost} de ${d.base} (${d.refunds.n} devolv. + ${d.nonRenewals} não renov.)</span></div>
    <div class="stat"><span class="muted">Efetividade</span><b class="t-card ${d.effectiveness != null && d.effectiveness >= 80 ? 'up' : ''}">${pct(d.effectiveness)}</b><span class="muted small">100% − churn</span></div></div>
  <section class="card"><h2 class="t-card">Receita por ${d.unit === 'month' ? 'mês' : 'dia'}</h2>
    <p class="chart-key small"><span class="key key--g"></span> Receita bruta <span class="key key--r"></span> Devolvido</p>
    <div class="chart-wrap">${chart(d.series, d.unit)}</div>
    <details class="chart-data"><summary class="small">Ver os valores do gráfico</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${d.unit === 'month' ? 'Mês' : 'Dia'}</th><th>Receita bruta</th><th>Devolvido</th></tr></thead><tbody>
    ${d.series.filter((x) => x.gross || x.refunds).map((x) => html`<tr><td data-l="${d.unit === 'month' ? 'Mês' : 'Dia'}">${label(x.key, d.unit)}</td><td data-l="Receita bruta">${brl(x.gross)}</td><td data-l="Devolvido">${brl(x.refunds)}</td></tr>`)}</tbody></table></div></details></section>
  <section class="card"><h2 class="t-card">Por curso</h2>
    ${d.byCourse.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Curso</th><th>Vendas</th><th>Bruta</th><th>Devoluções</th><th>Devolvido</th><th>Líquida</th></tr></thead><tbody>
    ${d.byCourse.map((c) => html`<tr><td data-l="Curso">${c.title}</td><td data-l="Vendas">${c.sales}</td><td data-l="Bruta">${brl(c.gross)}</td><td data-l="Devoluções">${c.refunds}</td><td data-l="Devolvido">${brl(c.refunded_value)}</td><td data-l="Líquida">${brl(c.net)}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Nenhuma venda nem devolução neste período.</p>`}</section>
  <section class="card"><h2 class="t-card">Por forma de pagamento</h2>
    ${d.byMethod.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Forma</th><th>Vendas</th><th>Bruta</th></tr></thead><tbody>
    ${d.byMethod.map((m) => html`<tr><td data-l="Forma">${METHOD[m.method] || m.method}</td><td data-l="Vendas">${m.n}</td><td data-l="Bruta">${brl(m.gross)}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Sem vendas neste período.</p>`}</section>
  <details class="card"><summary class="t-card">Como os números são calculados</summary>
    <ul class="muted small"><li>A venda conta na data de aprovação do pagamento. A devolução conta na data em que foi devolvida.</li>
    <li>Receita líquida = receita bruta das vendas do período − valor devolvido no período.</li>
    <li>Churn = (reembolsos + chargebacks + não renovações) ÷ (novas compras + renovações + não renovações).</li>
    <li>Não renovação: matrícula comprada cujo prazo venceu no período e não foi renovada. Prazos que ainda não chegaram não entram.</li>
    <li>Se as devoluções do período vierem de vendas antigas e superarem a base, o churn é limitado a 100%.</li>
    <li>Efetividade = 100% − churn. Conclusão = data de emissão do certificado. Cortesias e matrículas manuais não entram na receita.</li>
    <li>Os valores são o preço do curso. Os juros do parcelamento são pagos pelo aluno e não entram na receita.</li></ul></details>`;
  return shell(ctx, 'Cockpit financeiro', content, '/admin/financeiro');
}

module.exports = { financeiro, vendas, venda, simulador, textos, texto };
