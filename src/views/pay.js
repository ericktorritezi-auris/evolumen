'use strict';
// Telas de compra: checkout, acompanhamento do pedido e "Pagamentos e acessos" do aluno.
const { html, raw } = require('../html');
const { shellPublic, shellApp, lumen } = require('../layout');
const { icon } = require('../header');
const { field, csrfInput } = require('./ui');
const { titleRow } = require('./student');
const C = require('../courses');

const brl = C.brl;
const fmtDate = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const fmtDateTime = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

const STATUS = { pending: 'Aguardando pagamento', approved: 'Aprovado', refused: 'Recusado', expired: 'Vencido', cancelled: 'Cancelado', refunded: 'Reembolsado', charged_back: 'Estornado' };
const STATUS_CLASS = { approved: 'pill--ok', refunded: 'pill--draft', charged_back: 'pill--draft', pending: 'pill--star' };
const METHOD = { pix: 'Pix', card: 'Cartão' };

function priceLines(course, price) {
  return html`<ul class="sumlist">
    <li><span>Valor</span><span>${brl(price.list)}</span></li>
    ${price.off > 0 ? html`<li class="sumlist__off"><span>${price.source === 'coupon' ? `Cupom ${price.coupon.code}` : price.source === 'renewal' ? 'Preço de renovação' : 'Preço promocional'}</span><span>− ${brl(price.off)}</span></li>` : ''}
    <li class="sumlist__total"><span>Total</span><b>${brl(price.final)}</b></li></ul>`;
}

function checkoutPage({ cfg, user, csrf, flash, course, price, values = {}, errors = {}, renewal, couponCode = '', couponMsg = '', couponErr = '', docs }) {
  const v = (k) => (values[k] == null ? '' : values[k]);
  const logged = !!user;
  const e = (k) => errors[k] || '';
  const method = values.method === 'card' ? 'card' : 'pix';
  const content = html`<article class="sec"><div class="sec__in checkout">
    <a class="back" href="/cursos/${course.slug}">← ${course.title}</a>
    <h1 class="t-display">${renewal ? 'Renovar acesso' : 'Finalizar matrícula'}</h1>
    <div class="checkout__grid">
      <div class="checkout__main">
        ${!logged ? html`<p class="muted">Já tem conta? <a href="/entrar?next=${encodeURIComponent('/checkout/' + course.slug)}">Entre para continuar</a>. Se ainda não tem, é só preencher abaixo: criamos sua conta depois que o pagamento for aprovado.</p>` : ''}
        ${!renewal ? html`<form method="get" action="/checkout/${course.slug}" class="coupon-form"><div class="field"><label for="cupom-q">Tem um cupom de desconto?</label>
          <div class="row"><input id="cupom-q" name="cupom" value="${couponCode}" maxlength="30" placeholder="EVO-XXXXXX" autocomplete="off"><button class="btn btn--outline" type="submit">Aplicar</button></div>
          ${couponErr ? html`<div class="field__msg field__msg--err">${couponErr}</div>` : couponMsg ? html`<div class="field__msg">${couponMsg}</div>` : ''}</div></form>` : ''}
        <form method="post" action="/checkout/${course.slug}" class="form form--grid" novalidate>${csrfInput(csrf)}<input type="hidden" name="cupom" value="${couponCode}">
          <h2 class="t-card span2">Seus dados</h2>
          <div class="span2">${field({ id: 'name', label: 'Nome completo', value: v('name'), error: e('name'), autocomplete: 'name', required: true, maxlength: 120 })}</div>
          ${field({ id: 'email', label: 'E-mail', type: 'email', value: logged ? user.email : v('email'), error: e('email'), autocomplete: 'email', required: true, readonly: logged, note: logged ? '' : 'É com ele que você entra. Enviamos o acesso para este e-mail.' })}
          ${field({ id: 'phone', label: 'Telefone / WhatsApp', value: v('phone'), error: e('phone'), autocomplete: 'tel', inputmode: 'tel', required: true })}
          ${field({ id: 'cpf', label: 'CPF', value: v('cpf'), error: e('cpf'), inputmode: 'numeric', required: true, readonly: logged && !!user.cpf, note: 'Exigido para emitir o pagamento.' })}
          ${field({ id: 'cep', label: 'CEP', value: v('cep'), error: e('cep'), autocomplete: 'postal-code', inputmode: 'numeric', required: true })}
          <div class="span2">${field({ id: 'street', label: 'Rua', value: v('street'), error: e('street'), autocomplete: 'address-line1', required: true })}</div>
          ${field({ id: 'street_number', label: 'Número', value: v('street_number'), error: e('street_number'), required: true, maxlength: 20 })}
          ${field({ id: 'complement', label: 'Complemento', value: v('complement'), error: e('complement'), maxlength: 80 })}
          ${field({ id: 'district', label: 'Bairro', value: v('district'), error: e('district'), required: true })}
          ${field({ id: 'city', label: 'Cidade', value: v('city'), error: e('city'), required: true })}
          ${field({ id: 'state', label: 'UF', value: v('state'), error: e('state'), required: true, maxlength: 2, placeholder: 'SP' })}
          <h2 class="t-card span2">Forma de pagamento</h2>
          <fieldset class="span2 paychoice"><legend class="sr">Forma de pagamento</legend>
            <label class="paychoice__opt"><input type="radio" name="method" value="pix"${method === 'pix' ? raw(' checked') : ''}><span><b>Pix</b><small>Aprovação em instantes. O código vale ${cfg.pixMinutes} minutos.</small></span></label>
            <label class="paychoice__opt"><input type="radio" name="method" value="card"${method === 'card' ? raw(' checked') : ''}><span><b>Cartão de crédito</b><small>Em até ${course.max_installments}x. Você paga no ambiente seguro do Mercado Pago. Os juros do parcelamento, se houver, aparecem lá antes de confirmar.</small></span></label>
            ${e('method') ? html`<div class="field__msg field__msg--err">${e('method')}</div>` : ''}
          </fieldset>
          <div class="span2 field${e('accept') ? ' field--err' : ''}"><label class="check"><input type="checkbox" name="accept" value="1"${values.accept ? raw(' checked') : ''}><span>Li e aceito os <a href="/termos" target="_blank" rel="noopener">Termos de uso</a> (${docs.terms.version}) e a <a href="/privacidade" target="_blank" rel="noopener">Política de privacidade</a> (${docs.privacy.version}).</span></label>
            ${e('accept') ? html`<div class="field__msg field__msg--err">${e('accept')}</div>` : ''}</div>
          <div class="span2"><button class="btn btn--primary btn--lg btn--block" type="submit">Ir para o pagamento · ${brl(price.final)}</button>
            <p class="muted small">Você pode pedir reembolso em até ${cfg.refundDays} dias após a compra, direto na plataforma.</p></div>
        </form>
      </div>
      <aside class="checkout__side"><div class="card"><span class="eyebrow">Resumo</span><h2 class="t-card">${course.title}</h2>
        <p class="muted small">Acesso: ${C.accessLabel(course)}${course.workload_hours ? ` · ${course.workload_hours} h` : ''}</p>${priceLines(course, price)}</div></aside>
    </div></div></article>`;
  return shellPublic({ cfg, user, title: renewal ? 'Renovar acesso' : 'Finalizar matrícula', content, flash, robots: 'noindex, nofollow' });
}

const maskEmail = (e) => String(e || '').replace(/^(.{2})[^@]*(@.*)$/, '$1•••$2');

function orderPage({ cfg, user, csrf, order, course, newUser, simulated }) {
  const s = order.status;
  const retry = `/checkout/${course.slug}`;
  let body;
  if (s === 'approved') {
    body = html`<div class="verify verify--ok">${lumen('celebra', 130)}<span class="eyebrow">Pagamento aprovado</span><h1 class="t-display">Tudo certo!</h1>
      <p class="lead">${course.product_type === 'download' ? 'O produto' : 'O curso'} <b>${course.title}</b> já está liberado.</p>
      ${newUser ? html`<p class="muted">Enviamos o seu login e uma senha provisória para <b>${maskEmail(order.buyer.email)}</b>. Se não encontrar, olhe a caixa de spam.</p>` : html`<p class="muted">Ele já está na sua área de membros.</p>`}
      <div class="row row--center"><a class="btn btn--primary btn--lg" href="${newUser ? '/entrar' : `/curso/${course.slug}`}">${newUser ? 'Entrar na área de membros' : (course.product_type === 'download' ? 'Baixar meus arquivos' : 'Abrir o curso')}</a></div></div>`;
  } else if (s === 'pending' && order.method === 'pix') {
    const mins = order.pix_expires_at ? Math.max(0, Math.ceil((new Date(order.pix_expires_at) - Date.now()) / 60000)) : 0;
    body = html`<div class="verify" data-order-poll="/pedido/${order.public_id}/status"><span class="eyebrow">Pague com Pix</span><h1 class="t-display">${brl(order.price_cents)}</h1>
      <p class="muted">Abra o app do seu banco, escolha Pix e leia o QR Code ou use o “copia e cola”. A confirmação aparece aqui sozinha.</p>
      ${order.pix_qr_base64 ? html`<img class="pixqr" src="data:image/png;base64,${order.pix_qr_base64}" width="240" height="240" alt="QR Code do Pix">` : ''}
      <div class="pixcode"><textarea readonly rows="3" id="pixcode" aria-label="Pix copia e cola">${order.pix_code}</textarea><button type="button" class="btn btn--outline" data-copy="pixcode">Copiar código</button></div>
      <p class="small muted" data-pix-left="${order.pix_expires_at ? new Date(order.pix_expires_at).toISOString() : ''}">Vale por mais ${mins} ${mins === 1 ? 'minuto' : 'minutos'}.</p>
      ${simulated ? html`<div class="alert alert--info">Modo de teste: o pagamento é simulado pelo administrador em Vendas e renovações, no simulador.</div>` : ''}</div>`;
  } else if (s === 'pending') {
    body = html`<div class="verify" data-order-poll="/pedido/${order.public_id}/status"><span class="eyebrow">Pagamento com cartão</span><h1 class="t-display">${brl(order.price_cents)}</h1>
      ${order.checkout_url ? html`<p class="muted">Você vai pagar no ambiente seguro do Mercado Pago. Seus dados de cartão não passam por aqui.</p>
        <div class="row row--center"><a class="btn btn--primary btn--lg" id="paygo" href="${order.checkout_url}" rel="noopener">Pagar com cartão</a></div>
        <p class="small muted">Se a página do Mercado Pago não abrir sozinha, use o botão. Depois de pagar, volte aqui: a confirmação aparece sozinha.</p>`
      : html`<div class="alert alert--info">Modo de teste: o pagamento com cartão é simulado pelo administrador em Vendas e renovações, no simulador.</div>`}</div>`;
  } else if (s === 'refunded' || s === 'charged_back') {
    body = html`<div class="verify verify--bad">${icon('close', 40)}<span class="eyebrow">${STATUS[s]}</span><h1 class="t-display">Este pagamento foi devolvido</h1><p class="muted">O acesso ao produto foi encerrado.</p></div>`;
  } else {
    body = html`<div class="verify verify--bad">${icon('close', 40)}<span class="eyebrow">${STATUS[s]}</span><h1 class="t-display">${s === 'refused' ? 'O pagamento não foi aprovado' : s === 'expired' ? 'O Pix venceu' : 'O pagamento não foi concluído'}</h1>
      <p class="muted">Nada foi cobrado. Você pode tentar de novo quando quiser.</p><div class="row row--center"><a class="btn btn--primary btn--lg" href="${retry}">Tentar de novo</a></div></div>`;
  }
  const content = html`<article class="sec"><div class="sec__in sec__in--narrow center"><a class="back" href="/cursos/${course.slug}">← ${course.title}</a>${body}</div></article>`;
  return shellPublic({ cfg, user, title: 'Seu pedido', content, robots: 'noindex, nofollow' });
}

function pagamentos({ cfg, user, csrf, flash, accesses, orders, refundOpen }) {
  const accessRow = (a) => html`<article class="card mcard"><span class="eyebrow">${a.live ? 'Acesso ativo' : a.cancelled ? 'Acesso cancelado' : 'Acesso vencido'}</span>
    <h3 class="t-card">${a.title}</h3>
    <p class="muted small">${a.origin === 'purchase' ? 'Compra' : a.origin === 'gift' ? 'Cortesia' : 'Liberação manual'} · ${a.expires_at ? (a.live ? 'vale até ' : 'venceu em ') + fmtDate(a.expires_at) : 'acesso vitalício'}</p>
    <div class="row">${a.live ? html`<a class="btn btn--primary btn--sm" href="/curso/${a.slug}">${a.product_type === 'download' ? 'Baixar arquivos' : 'Abrir o curso'}</a>` : ''}${a.renew ? html`<a class="btn btn--outline btn--sm" href="/checkout/${a.slug}">${a.live ? 'Renovar agora' : 'Renovar acesso'}</a>` : ''}</div></article>`;
  const orderRow = (o) => {
    const canRefund = o.can_refund && !refundOpen.has(String(o.id));
    return html`<article class="card mcard"><span class="eyebrow"><span class="pill ${STATUS_CLASS[o.status] || ''}">${STATUS[o.status]}</span> ${o.kind === 'renewal' ? html`<span class="pill">Renovação</span>` : ''}</span>
      <h3 class="t-card">${o.title}</h3>
      <p class="muted small">${fmtDateTime(o.created_at)} · ${METHOD[o.method]} · ${brl(o.paid_cents || o.price_cents)}${o.installments > 1 ? ` em ${o.installments}x` : ''}${o.coupon_code ? ` · cupom ${o.coupon_code}` : ''}</p>
      ${o.status === 'approved' && o.refund_until ? html`<p class="muted small">${canRefund ? `Você pode pedir reembolso até ${fmtDateTime(o.refund_until)}.` : refundOpen.has(String(o.id)) ? 'Pedido de reembolso em análise.' : 'O prazo de reembolso de ' + cfg.refundDays + ' dias terminou.'}</p>` : ''}
      ${o.status === 'pending' ? html`<a class="btn btn--outline btn--sm" href="/pedido/${o.public_id}">Ver o pagamento</a>` : ''}
      ${canRefund ? html`<details class="refund"><summary class="btn btn--ghost btn--sm">Pedir reembolso</summary>
        <form method="post" action="/pagamentos/${o.public_id}/reembolso" class="form">${csrfInput(csrf)}
          <div class="field"><label for="r-${o.id}">Conte o motivo (opcional)</label><textarea id="r-${o.id}" name="reason" rows="3" maxlength="500"></textarea></div>
          <p class="muted small">O reembolso encerra o acesso ao produto${o.kind === 'purchase' ? ' e cancela o certificado, se houver' : ''}.</p>
          <button class="btn btn--primary btn--sm" type="submit" data-confirm="Enviar o pedido de reembolso de ${o.title}?">Enviar pedido</button></form></details>` : ''}</article>`;
  };
  const content = html`${titleRow('Pagamentos e acessos', 'Seus produtos, prazos de acesso e histórico de pagamentos.')}
    <h2 class="t-card">Meus acessos</h2>
    ${accesses.length ? html`<div class="mgrid">${accesses.map(accessRow)}</div>` : html`<section class="card empty"><p class="muted">Você ainda não tem produtos.</p><a class="btn btn--outline btn--sm" href="/#cursos">Ver os produtos</a></section>`}
    <h2 class="t-card">Pagamentos</h2>
    ${orders.length ? html`<div class="mgrid">${orders.map(orderRow)}</div>` : html`<section class="card empty"><p class="muted">Nenhum pagamento por aqui ainda.</p></section>`}`;
  return shellApp({ cfg, user, csrf, flash, path: '/pagamentos', title: 'Pagamentos e acessos', content });
}

module.exports = { checkoutPage, orderPage, pagamentos, STATUS, STATUS_CLASS, METHOD, fmtDate, fmtDateTime, priceLines };
