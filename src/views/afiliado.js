'use strict';
// Painel do afiliado: só leitura. Mostra os cupons, as vendas (comprador pelo nome abreviado), as comissões e os repasses do próprio afiliado.
const { html } = require('../html');
const { shellApp, lumen } = require('../layout');
const { titleRow } = require('./student');
const C = require('../courses');
const A = require('../affiliates');

const SP = 'America/Sao_Paulo';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: SP }) : '');
const brl = (c) => C.brl(c);

function phase(cm) {
  const ph = A.phaseOf(cm);
  if (ph === 'review') return html`<span class="pill">Em análise</span><br><span class="muted small">reembolso pedido</span>`;
  if (ph === 'cancelled') return html`<span class="pill pill--draft">Cancelada</span><br><span class="muted small">compra reembolsada</span>`;
  if (ph === 'grace') { const d = A.daysLeft(cm); return html`<span class="pill">Em carência</span><br><span class="muted small">falta ${d} ${d === 1 ? 'dia' : 'dias'} para liberar</span>`; }
  return html`<span class="pill pill--ok">Liberada</span>`;
}

function painel(ctx, { a, coupons, sales, payouts }) {
  const content = html`${titleRow('Painel do afiliado', `Olá, ${String(a.name).split(' ')[0]}. Aqui estão os seus cupons, as suas vendas e as suas comissões.`)}
  ${a.status !== 'active' ? html`<div class="alert alert--info" role="status">Seu cadastro de afiliado está inativo: vendas novas com os seus cupons não geram comissão. O seu histórico continua aqui.</div>` : ''}
  <div class="stats stats--5">
    <div class="stat"><span class="muted">Em carência</span><b class="t-card">${brl(a.grace)}</b></div>
    <div class="stat"><span class="muted">Liberada</span><b class="t-card">${brl(a.released)}</b></div>
    <div class="stat"><span class="muted">Já repassado</span><b class="t-card">${brl(a.paid)}</b></div>
    <div class="stat"><span class="muted">Vendas</span><b class="t-card">${a.sales}</b></div>
    <div class="stat"><span class="muted">Saldo a receber</span><b class="t-card">${a.balance < 0 ? html`<span class="bad">${brl(a.balance)}</span>` : brl(a.balance)}</b></div></div>
  ${a.balance < 0 ? html`<div class="alert alert--info" role="status">Houve reembolso ou estorno de uma venda cuja comissão já tinha sido repassada. O valor será compensado em comissões futuras, conforme o Termo do Programa de Afiliados.</div>` : ''}
  <p class="muted small">A comissão fica em carência durante o prazo de reembolso do comprador (7 dias). Depois, ela é liberada e entra no saldo a receber. Se a compra for reembolsada, a comissão é cancelada. Os repasses são feitos fora do sistema e aparecem aqui quando forem registrados.</p>

  <section class="card"><h2 class="t-card">Seus cupons</h2>
    ${coupons.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Cupom</th><th>Desconto</th><th>Sua comissão</th><th>Vendas</th><th>Situação</th><th></th></tr></thead><tbody>
      ${coupons.map((k) => html`<tr><td data-l="Cupom"><span class="cell"><b class="code">${k.code}</b></span></td><td data-l="Desconto"><span class="cell">${k.label}</span></td>
        <td data-l="Sua comissão"><span class="cell">${A.pctLabel(k.commission_pct)}</span></td><td data-l="Vendas"><span class="cell">${k.sales}</span></td>
        <td data-l="Situação"><span class="cell">${k.status === 'active' ? html`<span class="pill pill--ok">Ativo</span>` : html`<span class="pill pill--draft">Inativo</span>`}</span></td>
        <td class="tbl__act"><span class="cell"><div class="linkbox"><code id="aff-link-${k.id}">${k.link}</code><button type="button" class="btn btn--ghost btn--sm" data-copy="aff-link-${k.id}">Copiar link</button></div>
          <a class="btn btn--outline btn--sm" href="/afiliado/cupom/${k.id}/imagem.png?baixar=1">Baixar imagem</a></span></td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">Você ainda não tem cupons. Quando o professor criar um cupom para você, ele aparece aqui.</p>`}</section>

  <section class="card"><h2 class="t-card">Suas vendas e comissões</h2>
    ${sales.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Comprador</th><th>Produto</th><th>Base</th><th>Comissão</th><th>Situação</th></tr></thead><tbody>
      ${sales.map((s) => html`<tr><td data-l="Data"><span class="cell">${fmtDate(s.approved_at)}</span></td>
        <td data-l="Comprador"><span class="cell">${s.buyer}<br><span class="muted small">cupom ${s.coupon_code}</span></span></td><td data-l="Produto"><span class="cell">${s.course_title}</span></td>
        <td data-l="Base"><span class="cell">${brl(s.base_cents)}</span></td><td data-l="Comissão"><span class="cell"><b>${brl(s.amount_cents)}</b><br><span class="muted small">${A.pctLabel(s.pct)}</span></span></td>
        <td data-l="Situação"><span class="cell">${phase(s)}</span></td></tr>`)}</tbody></table></div>`
    : html`<section class="empty">${lumen('pensa', 80)}<p class="muted">Nenhuma venda com os seus cupons ainda. Quando alguém comprar com um deles, a venda aparece aqui.</p></section>`}</section>

  <section class="card"><h2 class="t-card">Repasses recebidos</h2>
    ${payouts.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Valor</th></tr></thead><tbody>
      ${payouts.map((p) => html`<tr><td data-l="Data"><span class="cell">${fmtDate(p.paid_on + 'T12:00:00')}</span></td><td data-l="Valor"><span class="cell"><b>${brl(p.amount_cents)}</b></span></td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">Nenhum repasse registrado ainda.</p>`}</section>`;
  return shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path: '/afiliado', title: 'Painel do afiliado', content });
}

module.exports = { painel };
