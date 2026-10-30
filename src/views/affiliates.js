'use strict';
// Telas do programa de afiliados (administrador): cockpit, cadastro, detalhe com vendas e repasses.
const { html, raw } = require('../html');
const { shellApp, lumen } = require('../layout');
const { field, csrfInput } = require('./ui');
const { titleRow } = require('./student');
const C = require('../courses');
const A = require('../affiliates');

const SP = 'America/Sao_Paulo';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: SP }) : '');
const brl = (c) => C.brl(c);
const shell = (ctx, title, content) => shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path: '/admin/afiliados', title, content });
const pct = (v) => A.pctLabel(v);
const money = (cents) => (cents < 0 ? html`<span class="bad">${brl(cents)}</span>` : brl(cents));
const statusPill = (a) => (a.status === 'active' ? html`<span class="pill pill--ok">Ativo</span>` : html`<span class="pill pill--draft">Inativo</span>`);
const phoneFmt = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d; };

function phase(cm) {
  const ph = A.phaseOf(cm);
  if (ph === 'review') return html`<span class="pill">Em análise</span><br><span class="muted small">reembolso pedido: aguarda a decisão</span>`;
  if (ph === 'cancelled') return html`<span class="pill pill--draft">Cancelada</span>${cm.cancel_reason ? html`<br><span class="muted small">${cm.cancel_reason}</span>` : (cm.order_status !== 'approved' ? html`<br><span class="muted small">pedido ${cm.order_status === 'charged_back' ? 'estornado' : 'reembolsado'}</span>` : '')}`;
  if (ph === 'grace') { const d = A.daysLeft(cm); return html`<span class="pill">Em carência</span><br><span class="muted small">falta ${d} ${d === 1 ? 'dia' : 'dias'} para liberar</span>`; }
  return html`<span class="pill pill--ok">Liberada</span>`;
}

function stats(a) {
  return html`<div class="stats stats--5">
    <div class="stat"><span class="muted">Em carência</span><b class="t-card">${brl(a.grace)}</b></div>
    <div class="stat"><span class="muted">Liberada</span><b class="t-card">${brl(a.released)}</b></div>
    <div class="stat"><span class="muted">Já repassado</span><b class="t-card">${brl(a.paid)}</b></div>
    <div class="stat"><span class="muted">Devolvida (cancelada)</span><b class="t-card">${brl(a.cancelled)}</b></div>
    <div class="stat"><span class="muted">Saldo a repassar</span><b class="t-card">${money(a.balance)}</b></div></div>`;
}

// ---------- cockpit ----------
function cockpit(ctx, { rows, totals }) {
  const content = html`${titleRow('Afiliados', 'Quem divulga cupons, o que já vendeu e o que falta repassar. A comissão fica em carência até acabar o prazo de reembolso.')}
  <div class="row row--top"><a class="btn btn--primary" href="/admin/afiliados/novo">Novo afiliado</a>${totals.sales ? html`<a class="btn btn--outline" href="/admin/afiliados/vendas.csv">Baixar todas as vendas (CSV)</a>` : ''}</div>
  ${rows.length ? html`
  ${stats(totals)}
  ${totals.negative ? html`<div class="alert alert--error" role="alert">${totals.negative} ${totals.negative === 1 ? 'afiliado está' : 'afiliados estão'} com saldo negativo: houve estorno depois do repasse. Veja em vermelho abaixo.</div>` : ''}
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Afiliado</th><th>Vendas</th><th>Em carência</th><th>Liberada</th><th>Repassado</th><th>Saldo a repassar</th><th></th></tr></thead><tbody>
    ${rows.map((a) => html`<tr><td data-l="Afiliado"><span class="cell"><b>${a.name}</b> ${statusPill(a)}<br><span class="muted small">${a.email}</span></span></td>
      <td data-l="Vendas"><span class="cell">${a.sales}<br><span class="muted small">${a.coupons} ${a.coupons === 1 ? 'cupom' : 'cupons'}</span></span></td>
      <td data-l="Em carência"><span class="cell">${brl(a.grace)}</span></td><td data-l="Liberada"><span class="cell">${brl(a.released)}</span></td><td data-l="Repassado"><span class="cell">${brl(a.paid)}</span></td>
      <td data-l="Saldo a repassar"><span class="cell"><b>${money(a.balance)}</b></span></td>
      <td class="tbl__act"><a class="btn btn--outline btn--sm" href="/admin/afiliados/${a.id}">Abrir</a></td></tr>`)}</tbody></table></div>`
    : html`<section class="card empty">${lumen('pensa', 96)}<div><h2 class="t-card">Nenhum afiliado ainda</h2><p class="muted">Cadastre o primeiro afiliado e depois escolha-o em um cupom, na tela de Cupons. As vendas com esse cupom geram a comissão sozinhas.</p></div></section>`}`;
  return shell(ctx, 'Afiliados', content);
}

// ---------- cadastro ----------
function affiliateFields(v, errors = {}) {
  return html`${field({ id: 'name', label: 'Nome completo', value: v.name || '', error: errors.name, autocomplete: 'off', maxlength: 120, required: true })}
    ${field({ id: 'email', label: 'E-mail', type: 'email', value: v.email || '', error: errors.email, autocomplete: 'off', required: true, note: 'Será o login do afiliado quando o painel dele for liberado.' })}
    ${field({ id: 'phone', label: 'Telefone com DDD', value: v.phone ? phoneFmt(v.phone) : '', error: errors.phone, inputmode: 'tel', autocomplete: 'off', required: true })}
    <div class="span2">${field({ id: 'note', label: 'Anotação interna (opcional)', value: v.note || '', maxlength: 300, note: 'Só você vê. Ex.: dados para o repasse (Pix).' })}</div>`;
}

function form(ctx, { values = {}, errors = {} }) {
  const content = html`<a class="back" href="/admin/afiliados">← Afiliados</a>${titleRow('Novo afiliado', 'Nome, e-mail e telefone. Depois, escolha o afiliado em um cupom para ele receber comissão pelas vendas.')}
  ${Object.keys(errors).length ? html`<div class="alert alert--error" role="alert">Confira os campos destacados.</div>` : ''}
  <form method="post" action="/admin/afiliados" class="form" novalidate>${csrfInput(ctx.csrf)}
    <section class="card"><div class="form form--grid">${affiliateFields(values, errors)}</div></section>
    <p class="muted small">Os dados do afiliado são tratados conforme a Política de privacidade. O afiliado nunca vê e-mail, telefone ou CPF dos compradores.</p>
    <div class="row"><button class="btn btn--primary btn--lg" type="submit">Cadastrar afiliado</button></div></form>`;
  return shell(ctx, 'Novo afiliado', content);
}

// ---------- detalhe ----------
function detail(ctx, { a, sales, payouts, coupons, errors = {}, values = null, payErrors = {}, payValues = {}, today }) {
  const v = values || a;
  const active = a.status === 'active';
  const content = html`<a class="back" href="/admin/afiliados">← Afiliados</a>${titleRow(a.name, `${a.email} · ${phoneFmt(a.phone)}`)}
  <p>${statusPill(a)}</p>
  ${Object.keys(errors).length || Object.keys(payErrors).length ? html`<div class="alert alert--error" role="alert">Confira os campos destacados.</div>` : ''}
  ${stats(a)}
  ${a.balance < 0 ? html`<div class="alert alert--error" role="alert">O saldo está negativo em ${brl(Math.abs(a.balance))}: houve reembolso ou estorno de uma venda cuja comissão já tinha sido repassada. Desconte nos próximos repasses ou combine a devolução com o afiliado.</div>` : ''}

  <section class="card"><h2 class="t-card">Cupons deste afiliado</h2>
    ${coupons.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Cupom</th><th>Desconto</th><th>Comissão</th><th>Vendas</th><th>Situação</th><th></th></tr></thead><tbody>
      ${coupons.map((k) => html`<tr><td data-l="Cupom"><span class="cell"><b class="code">${k.code}</b></span></td><td data-l="Desconto"><span class="cell">${k.kind === 'percent' ? k.percent + '%' : brl(k.amount_cents)}</span></td><td data-l="Comissão"><span class="cell">${pct(k.commission_pct)}</span></td><td data-l="Vendas"><span class="cell">${k.sales}</span></td>
        <td data-l="Situação"><span class="cell">${k.status === 'active' ? html`<span class="pill pill--ok">Ativo</span>` : html`<span class="pill pill--draft">Inativo</span>`}</span></td><td class="tbl__act"><a class="btn btn--ghost btn--sm" href="/admin/cupons/${k.id}">Abrir</a></td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">Nenhum cupom ainda. Em <a href="/admin/cupons/novo">Novo cupom</a>, escolha este afiliado e o percentual da comissão.</p>`}</section>

  <section class="card"><h2 class="t-card">Vendas e comissões</h2>
    ${sales.length ? html`<div class="row"><a class="btn btn--outline btn--sm" href="/admin/afiliados/${a.id}/vendas.csv">Baixar CSV</a></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Aprovação</th><th>Comprador</th><th>Produto</th><th>Base</th><th>Comissão</th><th>Situação</th></tr></thead><tbody>
      ${sales.map((s) => html`<tr><td data-l="Aprovação"><span class="cell">${fmtDate(s.approved_at)}<br><span class="muted small code">${s.public_id}</span></span></td>
        <td data-l="Comprador"><span class="cell">${s.buyer_name}<br><span class="muted small">cupom ${s.coupon_code}</span></span></td><td data-l="Produto"><span class="cell">${s.course_title}</span></td>
        <td data-l="Base"><span class="cell">${brl(s.base_cents)}</span></td><td data-l="Comissão"><span class="cell"><b>${brl(s.amount_cents)}</b><br><span class="muted small">${pct(s.pct)}</span></span></td><td data-l="Situação"><span class="cell">${phase(s)}</span></td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">Nenhuma venda com cupom deste afiliado ainda.</p>`}</section>

  <section class="card"><h2 class="t-card">Repasses</h2>
    <p class="muted small">Registre aqui cada pagamento feito ao afiliado (Pix, por exemplo). O sistema só registra: o dinheiro é enviado por você. O saldo a repassar considera apenas as comissões já liberadas.</p>
    <form method="post" action="/admin/afiliados/${a.id}/repasses" class="form form--grid" novalidate>${csrfInput(ctx.csrf)}
      ${field({ id: 'pay_amount', name: 'amount', label: 'Valor repassado (R$)', value: payValues.amount || '', inputmode: 'decimal', error: payErrors.amount, required: true, placeholder: a.balance > 0 ? C.brlInput(a.balance) : '' })}
      ${field({ id: 'pay_date', name: 'paid_on', label: 'Data do repasse', type: 'date', value: payValues.paid_on || today, error: payErrors.paid_on, required: true })}
      <div class="span2">${field({ id: 'pay_note', name: 'note', label: 'Observação (opcional)', value: payValues.note || '', maxlength: 300, note: 'Ex.: Pix de outubro.' })}</div>
      <div class="span2 row"><button class="btn btn--primary" type="submit">Registrar repasse</button></div></form>
    ${payouts.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Valor</th><th>Observação</th><th>Lançado por</th><th></th></tr></thead><tbody>
      ${payouts.map((p) => html`<tr><td data-l="Data"><span class="cell">${fmtDate(p.paid_on + 'T12:00:00')}</span></td><td data-l="Valor"><span class="cell">${p.voided_at ? html`<s>${brl(p.amount_cents)}</s>` : brl(p.amount_cents)}</span></td>
        <td data-l="Observação"><span class="cell">${p.note || '—'}${p.voided_at ? html`<br><span class="pill pill--draft">Anulado</span> <span class="muted small">${p.void_reason}</span>` : ''}</span></td>
        <td data-l="Lançado por" class="small"><span class="cell">${p.by_name || '—'}<br><span class="muted">${fmtDate(p.created_at)}</span></span></td>
        <td class="tbl__act">${p.voided_at ? '' : html`<details class="inline-pop"><summary class="btn btn--ghost btn--sm">Anular</summary><form method="post" action="/admin/afiliados/${a.id}/repasses/${p.id}/anular" class="form">${csrfInput(ctx.csrf)}
          <div class="field"><label for="v${p.id}">Motivo</label><input id="v${p.id}" name="reason" maxlength="200" placeholder="Ex.: valor lançado errado" required></div><button class="btn btn--primary btn--sm" type="submit">Confirmar anulação</button></form></details>`}</td></tr>`)}</tbody></table></div>`
    : ''}</section>

  <section class="card"><h2 class="t-card">Dados do afiliado</h2>
    <form method="post" action="/admin/afiliados/${a.id}" class="form" novalidate>${csrfInput(ctx.csrf)}
      <div class="form form--grid">${affiliateFields(v, errors)}</div>
      <div class="row"><button class="btn btn--primary" type="submit">Salvar</button></div></form></section>

  <section class="card${active ? ' danger' : ''}"><h2 class="t-card">${active ? 'Inativar afiliado' : 'Afiliado inativo'}</h2>
    ${active ? html`<p class="muted">O afiliado inativo não gera comissão em vendas novas. As comissões e os repasses antigos continuam guardados e o saldo continua visível. Os cupons dele seguem valendo para os compradores.</p>
      <div class="row"><form method="post" action="/admin/afiliados/${a.id}/inativar" class="inline" data-confirm="Inativar este afiliado? Vendas novas com os cupons dele deixam de gerar comissão.">${csrfInput(ctx.csrf)}<button class="btn btn--ghost btn--sm" type="submit">Inativar afiliado</button></form></div>`
    : html`<p class="muted">Vendas novas com os cupons dele não geram comissão. Reative para voltar a gerar.</p>
      <div class="row"><form method="post" action="/admin/afiliados/${a.id}/reativar" class="inline">${csrfInput(ctx.csrf)}<button class="btn btn--outline btn--sm" type="submit">Reativar afiliado</button></form></div>`}</section>`;
  return shell(ctx, a.name, content);
}

module.exports = { cockpit, form, detail };
