'use strict';
// Página do cockpit: só a casca. Os números chegam por /painel/<chave>/dados e a página se atualiza sozinha.
const { esc } = require('../html');

function page(cfg) {
  const v = esc(cfg.version.version);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Cockpit EvoLumen</title>
<meta name="robots" content="noindex, nofollow, noarchive"><meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#070B1F"><meta name="color-scheme" content="dark">
<link rel="icon" href="/static/icons/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/static/fonts/quicksand-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/static/css/cockpit.css?v=${v}">
<script src="/static/js/cockpit.js?v=${v}" defer></script>
</head><body>
<main class="wrap">
  <header class="top">
    <div class="brand">
      <img src="/static/img/logo.svg" width="46" height="46" alt="">
      <div><div class="brand__name">Evo<b>Lumen</b></div><div class="brand__sub">Cockpit · Monitoramento da plataforma</div></div>
    </div>
    <div class="clock"><div class="clock__date" id="date"></div><div class="clock__time" id="time">00:00:00</div></div>
    <div class="live">
      <span class="pulse" id="live"><i></i><span id="liveTxt">AO VIVO</span></span>
      <div class="count"><span class="count__txt" id="countTxt">Atualiza em <b>30</b> s</span><span class="count__bar"><i id="countBar"></i></span></div>
      <span class="count__txt" id="lastUp">Carregando…</span>
    </div>
  </header>

  <section class="filters" aria-label="Período">
    <span class="filters__label">Período</span>
    <button class="chip" type="button" data-f="total" aria-pressed="true">Total acumulado</button>
    <button class="chip" type="button" data-f="month" aria-pressed="false">Este mês</button>
    <button class="chip" type="button" data-f="7d" aria-pressed="false">7 dias</button>
    <button class="chip" type="button" data-f="today" aria-pressed="false">Hoje</button>
    <button class="chip" type="button" data-f="custom" aria-pressed="false">Escolher período</button>
    <div class="range" id="range">
      <label for="from"><span>De</span></label><input type="date" id="from">
      <label for="to"><span>até</span></label><input type="date" id="to">
    </div>
    <span class="scope" id="scope">Mostrando: tudo desde o início</span>
  </section>

  <section class="kpis" aria-label="Números do período" id="kpis"></section>

  <section class="panels" aria-label="Movimento da plataforma">
    <div class="panel panel--main"><div class="panel__h"><h2>Quem comprou</h2><small>vendas e renovações</small></div><ul class="feed" id="feedSales"></ul></div>
    <div class="panel panel--main"><div class="panel__h"><h2>Quem está acessando</h2><small>agora e hoje</small></div><div class="sub" id="onSub"></div><ul class="feed" id="feedAccess"></ul></div>
    <div class="panel panel--main"><div class="panel__h"><h2>Alunos novos</h2><small>cadastros</small></div><ul class="feed" id="feedNew"></ul></div>
  </section>

  <section class="panels">
    <div class="panel panel--wide"><div class="panel__h"><h2>Faturamento no período</h2><small id="chartUnit"></small></div>
      <div class="chartbox"><svg class="chart" id="chart" viewBox="0 0 680 230" role="img" aria-label="Gráfico de faturamento"></svg></div></div>
    <div class="panel"><div class="panel__h"><h2>Cursos mais vendidos</h2><small>no período</small></div><ol class="rank" id="rank"></ol></div>
    <div class="panel"><div class="panel__h"><h2>Funil de vendas</h2><small>do checkout ao pagamento</small></div><div class="funnel" id="funnel"></div><div class="pills" id="pixPills"></div></div>
    <div class="panel"><div class="panel__h"><h2>Afiliados</h2><small>comissões acumuladas</small></div><div class="aff" id="aff"></div>
      <div class="scroll"><table class="tbl"><thead><tr><th>Afiliado</th><th>Cupom</th><th>Vendas</th><th>Comissão</th></tr></thead><tbody id="affRows"></tbody></table></div></div>
    <div class="panel"><div class="panel__h"><h2>Saúde do sistema</h2><small>agora</small></div><div class="pills" id="health"></div>
      <div class="lumen"><img id="lumenImg" src="/static/img/lumen-ola.svg" width="74" alt=""><div class="lumen__bubble"><small>Lumen avisa</small><span id="lumenMsg">Tudo certo por aqui. Estou de olho na plataforma.</span></div></div></div>
  </section>
  <p class="foot">Painel somente leitura · sem e-mail, telefone ou CPF de ninguém</p>
</main>
<noscript><p style="padding:16px;color:#EAEEFF">Ative o JavaScript para ver o cockpit.</p></noscript>
</body></html>`;
}

module.exports = { page };
