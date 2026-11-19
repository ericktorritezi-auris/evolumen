'use strict';
// Telas das promoções do site (admin). Mobile first: uma coluna, botões grandes.
const { html, raw } = require('../html');
const { shellApp } = require('../layout');
const { field, csrfInput } = require('./ui');
const { titleRow } = require('./student');
const C = require('../courses');
const P = require('../promotions');

const shell = (ctx, title, content) => shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path: '/admin/cupons', title, content });
const SP = 'America/Sao_Paulo';
const fmt = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: SP, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const badge = (p) => { const s = P.stateOf(p); return html`<span class="pill${s === 'live' ? ' pill--ok' : s === 'scheduled' ? '' : ' pill--draft'}">${P.STATE_LABEL[s]}</span>`; };
const off = (p) => P.offLabel(p).replace(' off', '');

// Bloco "Promoções do site" da tela Cupons e promoções.
function listBlock(rows) {
  return html`<section class="promos" aria-labelledby="promos-t"><h2 class="t-card" id="promos-t">Promoções do site</h2>
  <p class="muted small">Campanhas gerais com início e fim. Durante a promoção, os cupons ficam suspensos nos produtos dela e voltam sozinhos quando ela termina.</p>
  ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Promoção</th><th>Desconto</th><th>Produtos</th><th>Período</th><th>Situação</th><th></th></tr></thead><tbody>
    ${rows.map((p) => html`<tr><td data-l="Promoção"><b>${p.name}</b>${p.theme === 'blackfriday' ? html`<br><span class="pill">Tema Black Friday</span>` : ''}</td><td data-l="Desconto">${off(p)}</td>
      <td data-l="Produtos">${p.all_products ? 'Todos' : (p.courses.length === 1 ? p.courses[0].title : `${p.courses.length} produtos`)}</td>
      <td data-l="Período" class="small">${fmt(p.starts_at)}<br>até ${fmt(p.ends_at)}</td><td data-l="Situação">${badge(p)}${p.orders ? html`<br><span class="muted small">${p.orders} ${p.orders === 1 ? 'venda' : 'vendas'}</span>` : ''}</td>
      <td class="tbl__act"><a class="btn btn--outline btn--sm" href="/admin/promocoes/${p.id}">Abrir</a></td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">Nenhuma promoção criada ainda.</p>`}</section>`;
}

function fields({ courses, v, errors = {} }) {
  const chosen = [].concat(v.courses || []).map(String);
  const sel = v.scope === 'selected' || v.all_products === false;
  const kind = v.kind === 'fixed' ? 'fixed' : 'percent';
  return html`
    <div class="span2">${field({ id: 'name', label: 'Nome da promoção', value: v.name || '', error: errors.name, maxlength: 80, note: 'Ex.: Janeiro Branco, Black Friday 2026.' })}</div>
    <div class="field"><label for="kind">Tipo de desconto</label><select id="kind" name="kind"><option value="percent"${kind === 'percent' ? raw(' selected') : ''}>Porcentagem (%)</option><option value="fixed"${kind === 'fixed' ? raw(' selected') : ''}>Valor fixo (R$)</option></select></div>
    ${field({ id: 'percent', label: 'Porcentagem (1 a 99)', value: v.percent || '', inputmode: 'numeric', error: errors.percent, note: 'Usada no tipo Porcentagem.' })}
    ${field({ id: 'amount', label: 'Valor em reais', value: v.amount != null ? v.amount : (v.amount_cents ? C.brlInput(v.amount_cents) : ''), inputmode: 'decimal', error: errors.amount, note: 'Usado no tipo Valor fixo. Produto em que o desconto zeraria o preço fica fora da promoção.' })}
    ${field({ id: 'starts_at', label: 'Início (horário de Brasília)', type: 'datetime-local', value: v.starts_at || '', error: errors.starts_at })}
    ${field({ id: 'ends_at', label: 'Fim (horário de Brasília)', type: 'datetime-local', value: v.ends_at || '', error: errors.ends_at, note: 'Ao chegar nesse horário o site volta ao normal sozinho.' })}
    <div class="span2">${field({ id: 'tag_text', label: 'Texto da tag no produto (opcional)', value: v.tag_text || '', maxlength: 60, placeholder: 'Ex.: Janeiro Branco · R$ 50 off', note: 'Se ficar vazio, o sistema usa "Nome · desconto".' })}</div>
    <div class="span2">${field({ id: 'banner_text', label: 'Aviso no topo do site (opcional)', value: v.banner_text || '', maxlength: 160, note: 'Se ficar vazio: "Estamos com preço promocional! …".' })}</div>
    <fieldset class="span2 fieldset"><legend>Produtos da promoção</legend>
      <label class="check"><input type="radio" name="scope" value="all"${sel ? '' : raw(' checked')}><span>Todos os produtos (cursos e downloads)</span></label>
      <label class="check"><input type="radio" name="scope" value="selected"${sel ? raw(' checked') : ''}><span>Só os produtos escolhidos abaixo</span></label></fieldset>
    <fieldset class="span2 fieldset${errors.courses ? ' field--err' : ''}"><legend>Produtos escolhidos</legend>
      ${courses.map((c) => html`<label class="check"><input type="checkbox" name="courses" value="${c.id}"${chosen.includes(String(c.id)) ? raw(' checked') : ''}><span>${c.title} <small class="muted">${C.brl(c.price_cents)}${c.status === 'published' ? '' : ' · rascunho'}</small></span></label>`)}
      ${errors.courses ? html`<div class="field__msg field__msg--err" role="alert">${errors.courses}</div>` : html`<div class="field__msg">Só vale se você marcou "Só os produtos escolhidos". Renovações ficam fora e seguem o preço de renovação.</div>`}</fieldset>
`;
}

function form(ctx, { courses, values, errors = {}, p = null }) {
  const action = p ? `/admin/promocoes/${p.id}` : '/admin/promocoes';
  const content = html`<a class="back" href="/admin/cupons">← Cupons e promoções</a>${titleRow(p ? p.name : 'Nova promoção', p ? 'Ajustar uma promoção não muda pedidos já feitos: cada pedido guarda o preço do dia.' : 'Campanha geral do site, com início e fim.')}
  ${p ? html`<p>${badge(p)} <span class="muted small">${p.orders} ${p.orders === 1 ? 'venda' : 'vendas'} nesta promoção</span></p>` : ''}
  ${Object.keys(errors).length ? html`<div class="alert alert--error" role="alert">Confira os campos destacados.</div>` : ''}
  <form method="post" action="${action}" class="form" novalidate>${csrfInput(ctx.csrf)}
    <section class="card"><div class="form form--grid">${fields({ courses, v: values, errors })}</div></section>
    <div class="row"><button class="btn btn--primary btn--lg" type="submit">${p ? 'Salvar alterações' : 'Criar promoção'}</button></div></form>
  ${p && p.status === 'active' ? html`<form method="post" action="/admin/promocoes/${p.id}/inativar" class="row">${csrfInput(ctx.csrf)}<button class="btn btn--outline" type="submit">Inativar promoção</button><span class="muted small">Encerra agora. O histórico e as vendas ficam guardados.</span></form>` : ''}`;
  return shell(ctx, p ? p.name : 'Nova promoção', content);
}

module.exports = { listBlock, form, fmt };
