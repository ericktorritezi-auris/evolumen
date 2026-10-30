'use strict';
// Tela de lançamento: checklist de go-live e reset dos dados de teste.
const { html } = require('../html');
const { shellApp } = require('../layout');
const { csrfInput } = require('./ui');
const { brl } = require('../courses');

const shell = (ctx, title, content) => shellApp({ cfg: ctx.cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path: '/admin/lancamento', title, content });
const titleRow = (title, sub) => html`<div class="title-row"><h1 class="t-display">${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>`;

const LABEL = {
  contas: 'Contas de aluno', matriculas: 'Matrículas', pedidos: 'Pedidos', comissoes: 'Comissões de afiliado',
  reembolsos: 'Pedidos de reembolso', certificados: 'Certificados', aceites: 'Aceites dos termos',
  tentativas: 'Tentativas de prova', progresso: 'Aulas concluídas', forum: 'Mensagens do fórum', avaliacoes: 'Avaliações', cupons_usados: 'Cupons usados',
  pedidos_lgpd: 'Pedidos de dados (LGPD)', notificacoes: 'Notificações', emails_enviados: 'Registros de e-mail', envios_de_cupom: 'Envios de cupom',
};

function previewCard(ctx, p, error) {
  if (!p) return '';
  const n = p.students.length;
  const phrase = `APAGAR ${n} ${n === 1 ? 'CONTA' : 'CONTAS'}`;
  return html`<section class="card" id="previa"><h2 class="t-card">Prévia: o que será apagado</h2>
    ${p.blocked.length ? html`<div class="alert alert--error" role="alert">Estes e-mails são de administrador e não podem entrar no reset: ${p.blocked.join(', ')}. Tire-os da lista.</div>` : ''}
    ${p.missing.length ? html`<div class="alert alert--info">Não encontrei conta de aluno para: ${p.missing.join(', ')}.</div>` : ''}
    ${!n || p.blocked.length ? html`<p class="muted">Nada a apagar com esta lista.</p>` : html`
    <p class="muted small">Contas: ${p.students.map((u) => u.email).join(', ')}</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>O quê</th><th>Quantidade</th></tr></thead><tbody>
      ${Object.entries(p.counts).map(([k, v]) => html`<tr><td data-l="O quê">${LABEL[k] || k}</td><td data-l="Quantidade">${v}</td></tr>`)}
    </tbody></table></div>
    ${p.paid.n ? html`<div class="alert alert--info" role="status"><b>Atenção:</b> há ${p.paid.n} ${p.paid.n === 1 ? 'pedido aprovado' : 'pedidos aprovados'} (${brl(p.paid.cents)} pagos) que ainda não foram reembolsados. Apagar o pedido não devolve o dinheiro. Se for compra de teste, reembolse antes pelo painel do Mercado Pago.</div>` : ''}
    ${p.pending ? html`<div class="alert alert--error" role="alert">Há ${p.pending} ${p.pending === 1 ? 'pedido aguardando pagamento' : 'pedidos aguardando pagamento'} nestas contas. Espere vencer ou ser pago antes de apagar: senão o dinheiro pode chegar sem pedido.</div>` : ''}
    <p class="muted small">As comissões de afiliado ligadas a esses pedidos também são apagadas; repasses já lançados ficam, então confira o saldo do afiliado depois. Ficam intactos: produtos, textos legais, configurações, o administrador e o registro de atividades. Atenção: o registro de atividades guarda, pelo prazo legal, e-mail e IP das ações financeiras e de aceite dessas contas (este reset grava só contagens). Apagar também remove a prova dos testes (pedidos e avisos do Mercado Pago): faça o reset depois de validar o fluxo e antes de abrir ao público. Esta ação não pode ser desfeita.</p>
    ${error ? html`<div class="alert alert--error" role="alert">${error}</div>` : ''}
    <form method="post" action="/admin/lancamento/executar" class="form" autocomplete="off">${csrfInput(ctx.csrf)}
      <input type="hidden" name="emails" value="${p.emails.join('\n')}"><input type="hidden" name="sig" value="${p.sig}">
      ${p.money ? html`<div class="field"><label class="chk"><input type="checkbox" name="ciente" value="1" required> Estou ciente de que apago ${p.money} ${p.money === 1 ? 'pedido' : 'pedidos'} do Mercado Pago (pagos, reembolsados ou estornados) e que são de contas de teste, não de clientes.</label></div>` : ''}
      <div class="field"><label for="frase">Para confirmar, digite: <b>${phrase}</b></label><input id="frase" name="frase" required autocomplete="off"></div>
      <div class="field"><label for="senha">Sua senha de administrador</label><input id="senha" name="senha" type="password" required autocomplete="current-password"></div>
      <div class="row"><button class="btn btn--primary" type="submit">Apagar definitivamente</button></div></form>`}
  </section>`;
}

function page(ctx, { checklist, manual, allowed, preview, emails = '', error }) {
  const ok = checklist.filter((i) => i.level === 'ok').length;
  const content = html`${titleRow('Lançamento', 'Checklist para abrir ao público e limpeza dos dados de teste.')}
  <section class="card"><h2 class="t-card">Checklist de go-live <span class="pill pill--${ok === checklist.length ? 'ok' : 'warn'}">${ok} de ${checklist.length}</span></h2>
    <div class="kvs">${checklist.map((i) => html`<div class="kv"><span>${i.href ? html`<a href="${i.href}">${i.label}</a>` : i.label}</span><span class="health__txt health__txt--${i.level}"><span class="health__dot health__dot--${i.level}" aria-hidden="true"></span>${i.text}</span></div>`)}</div>
    <h3 class="t-card">Confirme você mesmo</h3>
    <ul class="muted">${manual.map((m) => html`<li>${m}</li>`)}</ul></section>
  <section class="card"><h2 class="t-card">Limpar dados de teste</h2>
  ${allowed ? html`
    <p class="muted">Informe os e-mails das contas de aluno usadas nos testes (um por linha). Primeiro você vê a prévia; nada é apagado antes da confirmação.</p>
    ${error && !preview ? html`<div class="alert alert--error" role="alert">${error}</div>` : ''}
    <form method="post" action="/admin/lancamento/previa" class="form">${csrfInput(ctx.csrf)}
      <div class="field"><label for="emails">E-mails das contas de teste</label><textarea id="emails" name="emails" rows="5" required>${emails}</textarea></div>
      <div class="row"><button class="btn btn--outline" type="submit">Ver prévia</button></div></form>`
  : html`<div class="alert alert--info" role="status">O reset está <b>desligado</b>, e é o estado certo para o público. Para usar: no Railway, em Variables, crie <code>ALLOW_LAUNCH_RESET</code> com o valor <code>1</code>, espere o deploy, faça a limpeza e depois <b>remova a variável</b>.</div>`}
  </section>
  ${previewCard(ctx, preview, error)}`;
  return shell(ctx, 'Lançamento', content);
}

module.exports = { page, LABEL };
