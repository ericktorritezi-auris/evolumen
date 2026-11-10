'use strict';
// EvoLumen Analytics: página de verificação da coleta (administrador).
const { html, raw } = require('../html');
const { shellApp } = require('../layout');
const { titleRow } = require('./student');

const SP = 'America/Sao_Paulo';
const when = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: SP, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const where = (s) => [s.city, s.region, s.country].filter(Boolean).join(' · ') || '—';

const fmt = (x) => Math.round(Number(x) || 0).toLocaleString('pt-BR');
const dec = (x) => Number(x).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const dayBr = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}`; };

const bars = (rows, total, empty = 'Sem dados no período.') => (rows.length && total > 0
  ? html`${rows.map(([n, v]) => html`<div class="an-row"><span class="an-n">${n}</span><span class="an-v">${fmt(v)} · ${pct(v, total)}%</span><div class="an-track"><i style="width:${pct(v, total)}%"></i></div></div>`)}`
  : html`<p class="muted">${empty}</p>`);

function chart(daily) {
  const W = 1000; const H = 200; const nDays = daily.length || 1; const bw = W / nDays; const mx = Math.max(1, ...daily.map((d) => d.visits)) * 1.1;
  const total = daily.reduce((s, d) => s + d.visits, 0); const best = daily.reduce((m, d) => (!m || d.visits > m.visits ? d : m), null);
  const step = nDays > 45 ? 15 : nDays > 14 ? 5 : 1;
  const bars2 = daily.map((d, i) => { const h = (d.visits / mx) * H; const h2 = (d.visitors / mx) * H; const x = i * bw + bw * 0.15; const w = bw * 0.7;
    return html`<g><rect class="an-bar" x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${dayBr(d.day)}: ${d.visits} visitas, ${d.visitors} visitantes</title></rect><rect class="an-bar2" x="${(x + w * 0.25).toFixed(1)}" y="${(H - h2).toFixed(1)}" width="${(w * 0.5).toFixed(1)}" height="${h2.toFixed(1)}" rx="2"><title>${dayBr(d.day)}: ${d.visitors} visitantes</title></rect>${i % step === 0 ? html`<text x="${x.toFixed(1)}" y="${H + 18}">${dayBr(d.day)}</text>` : ''}</g>`; });
  return html`<div class="an-chartwrap"><svg class="an-svg" viewBox="0 0 ${W} ${H + 26}" width="100%" role="img" aria-labelledby="an-ct an-cd"><title id="an-ct">Visitas e visitantes por dia</title><desc id="an-cd">${total} visitas em ${nDays} dias. Dia mais movimentado: ${best ? `${dayBr(best.day)}, com ${best.visits} visitas` : 'nenhum'}. Hoje ainda está em andamento.</desc>${[0, 0.5, 1].map((t) => html`<line class="an-grid" x1="0" x2="${W}" y1="${H - H * t}" y2="${H - H * t}"/><text x="2" y="${Math.max(H - H * t - 3, 11)}">${fmt(mx * t)}</text>`)}${bars2}</svg></div>`;
}

const chipHref = (d, s) => `/admin/analytics?dias=${d}&onde=${s}`;
const chip = (href, label, on) => html`<a class="an-chip${on ? ' on' : ''}" href="${href}"${on ? raw(' aria-current="page"') : ''}>${label}</a>`;
const delta = (d) => (d === null ? '' : html`<i class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${d}% vs. período anterior</i>`);

function tela(ctx, { r, cfg }) {
  const k = r.kpi; const s = r.students; const a = r.ages;
  const kp = (label, val, sub) => html`<div class="an-k"><small>${label}</small><b>${val}</b>${sub ? html`<span>${sub}</span>` : ''}</div>`;
  const content = html`<a class="back" href="/admin">← Voltar para o dashboard</a>
  ${titleRow(raw('EvoLumen <span class="accent">Analytics</span>'), 'Medição própria: plataforma e landings. Sem Google, dados só no seu banco.')}
  ${cfg.analytics.enabled ? '' : html`<div class="alert alert--error" role="alert">A medição está desligada neste ambiente (ANALYTICS_ENABLED). Os números abaixo são do que já foi coletado.</div>`}
  <div class="an-bar-top" role="group" aria-label="Filtros">
    ${[7, 30, 90].map((d) => chip(chipHref(d, r.site), `${d} dias`, r.days === d))}
    <span class="an-sp"></span>
    ${[['todos', 'Todos os sites'], ['plataforma', 'Plataforma'], ['landings', 'Landings']].map(([v, l]) => chip(chipHref(r.days, v), l, r.site === v))}
  </div>
  <div class="an-kpis">
    ${kp('Visitantes', fmt(k.visitors), delta(k.dVisitors))}${kp('Visitas', fmt(k.visits), delta(k.dVisits))}${kp('Páginas vistas', fmt(k.pageviews), k.visits ? `${dec(k.perVisit)} por visita` : '')}
    ${kp('Novos', fmt(k.novos), `${pct(k.novos, k.visitors)}% dos visitantes`)}${kp('Recorrentes', fmt(k.recorrentes), `${pct(k.recorrentes, k.visitors)}%`)}${kp('Compras', fmt(k.compras), k.visits ? `conversão ${dec(k.conv)}%${k.semOrigem ? ` · ${k.semOrigem} sem origem identificada` : ''}` : '')}
  </div>
  <section class="card"><h2 class="t-card">Visitas por dia <span class="muted small">${fmt(k.visits)} visitas no período</span></h2>${chart(r.daily)}
    <p class="muted small">O último dia ainda está em andamento, por isso pode parecer menor.</p><div class="an-legend"><span><i class="an-dot an-dot--v"></i>Visitas</span><span><i class="an-dot an-dot--u"></i>Visitantes</span></div></section>
  <div class="an-grid2">
    <section class="card"><h2 class="t-card">Funil até a compra <span class="muted small">quem avançou em cada etapa</span></h2>
      ${r.steps[0][1] ? r.steps.map(([l, v], i) => { const prev = i ? r.steps[i - 1][1] : 0; return html`<div class="an-row an-fun"><span class="an-n">${l}</span><span class="an-v">${fmt(v)}</span><div class="an-track"><i style="width:${pct(v, r.steps[0][1])}%"></i></div>${i && prev > 0 ? html`<div class="an-drop">−${100 - pct(v, prev)}% em relação à etapa anterior</div>` : ''}</div>`; }) : html`<p class="muted">Sem visitas no período.</p>`}
      <p class="muted small">Mostra onde as pessoas param: quem chegou ao checkout já passou pela página do curso, e assim por diante. Pedido e compra vêm dos pedidos reais ligados à visita.${r.landingVisits ? ` ${fmt(r.landingVisits)} dessas visitas passaram por uma landing.` : ''}</p></section>
    <section class="card"><h2 class="t-card">De onde vêm <span class="muted small">origem da visita</span></h2>${bars(r.src, r.total)}
      <p class="muted small">O WhatsApp costuma aparecer em “Direto”, porque o aplicativo não informa a origem do clique. Para separar, use <b>?origem=whatsapp</b> nos links divulgados.</p></section>
  </div>
  <div class="an-grid2">
    <section class="card"><h2 class="t-card">Novos e recorrentes</h2>${bars(r.nr, k.visitors)}<p class="muted small">Recorrente: o visitante já tinha uma visita anterior. Fiel: quatro ou mais visitas no total.</p></section>
    <section class="card"><h2 class="t-card">Aparelhos <span class="muted small">e navegadores</span></h2>${bars(r.dev, r.total)}
      ${r.browsers.length ? html`<p class="muted small">Navegadores: ${r.browsers.map(([n, v], i) => html`${i ? raw(' · ') : ''}${n} ${pct(v, r.total)}%`)}</p>` : ''}</section>
  </div>
  <div class="an-grid2">
    <section class="card"><h2 class="t-card">Regiões <span class="muted small">Brasil e exterior</span></h2>${bars(r.regions, r.total)}
      <p class="muted small">${r.abroadTop.length ? `Fora do Brasil: ${r.abroadTop.join(', ')}. ` : ''}A localização é aproximada e deduzida no momento da visita, sem guardar o IP.</p></section>
    <section class="card"><h2 class="t-card">Páginas mais visitadas</h2>
      ${r.pages.length ? html`<div class="tbl-wrap"><table class="tbl"><caption class="sr-only">Páginas mais visitadas</caption><thead><tr><th scope="col">Página</th><th class="num">Visitas</th><th class="num">Entradas</th><th class="num">Saídas</th></tr></thead><tbody>
        ${r.pages.map((p) => html`<tr><td data-l="Página">${p.label}${p.landing ? html` <span class="pill">landing</span>` : ''}</td><td class="num" data-l="Visitas">${fmt(p.n)}</td><td class="num" data-l="Entradas">${fmt(p.entries)}</td><td class="num" data-l="Saídas">${fmt(p.exits)}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Sem visitas no período.</p>`}</section>
  </div>
  <section class="card"><h2 class="t-card">Landings e afiliados <span class="muted small">visitas e vendas por cupom</span></h2>
    ${r.coupons.length ? html`<div class="tbl-wrap"><table class="tbl"><caption class="sr-only">Visitas e compras por cupom</caption><thead><tr><th scope="col">Cupom</th><th>Afiliado</th><th class="num">Visitas</th><th class="num">Checkout</th><th class="num">Compras</th><th class="num">Conversão</th></tr></thead><tbody>
      ${r.coupons.map((c) => html`<tr><td data-l="Cupom"><b>${c.coupon}</b></td><td data-l="Afiliado">${c.affiliate || html`<span class="muted">sem afiliado</span>`}</td><td class="num" data-l="Visitas">${fmt(c.visits)}</td><td class="num" data-l="Checkout">${fmt(c.checkout)}</td><td class="num" data-l="Compras">${fmt(c.buys)}</td><td class="num" data-l="Conversão">${dec(c.visits ? (c.buys / c.visits) * 100 : 0)}%</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted">Nenhuma visita com cupom no período. Os links com <b>?cupom=CODIGO</b> aparecem aqui.</p>`}</section>
  <div class="an-grid2">
    <section class="card"><h2 class="t-card">Alunos na plataforma <span class="muted small">acessos</span></h2>
      <div class="an-kv"><span>Entraram no período</span><b>${fmt(s.entraram)}</b></div><div class="an-kv"><span>Entraram nos últimos 7 dias</span><b>${fmt(s.semana)}</b></div><div class="an-kv"><span>Com acesso e sem entrar há mais de 14 dias</span><b>${fmt(s.parados)}</b></div>
      <p class="muted small">${fmt(s.comAcesso)} alunos com acesso ativo. “Entrar” é o último login: quem fica conectado no aparelho pode não aparecer. Detalhe aula a aula: <a href="/admin/matriculas">Matrículas</a> → Ver progresso.</p></section>
    <section class="card"><h2 class="t-card">Faixa etária dos alunos <span class="muted small">quem informou a data de nascimento</span></h2>${bars(a.rows, a.informaram, 'Nenhum aluno informou a data de nascimento ainda.')}
      <p class="muted small">${fmt(a.informaram)} de ${fmt(a.total)} alunos informaram a data de nascimento. Visitantes não têm faixa etária: a medição própria não sabe a idade de quem só navega.</p></section>
  </div>
  <p class="muted small"><a href="/admin/analytics/verificacao">Verificar a coleta (últimas visitas)</a> · <a href="/aviso-de-privacidade-e-cookies">Aviso de Privacidade e Cookies</a></p>`;
  return shellApp({ cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path: '/admin', title: 'EvoLumen Analytics', content });
}

function verificacao(ctx, { data, cfg }) {
  const t = data.today;
  const content = html`${titleRow('Verificação da coleta', 'EvoLumen Analytics · confirma se as visitas estão chegando')}
  <p class="${cfg.analytics.enabled ? 'muted' : 'field__msg field__msg--err'}">${cfg.analytics.enabled ? 'Medição ligada.' : 'Medição desligada: defina ANALYTICS_ENABLED=1 no ambiente para começar a medir.'} Sites aceitos: este site e ${cfg.analytics.origins.join(', ') || 'nenhuma landing'}. Suas próprias visitas como administrador não são contadas.</p>
  <div class="stats stats--5">
    <div class="stat"><b>${t.visitors}</b><span class="muted">Visitantes hoje</span></div>
    <div class="stat"><b>${t.sessions}</b><span class="muted">Visitas hoje</span></div>
    <div class="stat"><b>${t.pageviews}</b><span class="muted">Páginas vistas hoje</span></div>
    <div class="stat"><b>${t.sessions7}</b><span class="muted">Visitas nos últimos 7 dias</span></div>
    <div class="stat"><b>${t.pageviews7}</b><span class="muted">Páginas vistas em 7 dias</span></div>
  </div>
  <h2 class="t-card">Últimas visitas</h2>
  ${data.last.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Quando</th><th>Onde</th><th>Origem</th><th>Entrou em</th><th>Páginas</th><th>Aparelho</th><th>Local</th><th>Visitante</th></tr></thead><tbody>${data.last.map((s) => html`<tr>
    <td data-l="Quando">${when(s.started_at)}</td><td data-l="Onde">${s.site === 'landing' ? 'Landing' : 'Plataforma'}${s.coupon ? html`<br><span class="muted small">${s.coupon}</span>` : ''}</td>
    <td data-l="Origem">${s.source}</td><td data-l="Entrou em">${s.entry_path}</td><td data-l="Páginas">${s.pages}</td>
    <td data-l="Aparelho">${s.device}<br><span class="muted small">${s.browser}</span></td><td data-l="Local">${where(s)}</td><td data-l="Visitante">${s.is_new ? 'Novo' : 'Recorrente'}</td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">Ainda não chegou nenhuma visita. Abra o site em outra janela (sem estar logado como administrador) e atualize esta página.</p>`}`;
  return shellApp({ cfg, user: ctx.user, csrf: ctx.csrf, flash: ctx.flash, path: '/admin', title: 'Verificação da coleta', content });
}

module.exports = { verificacao, tela };
