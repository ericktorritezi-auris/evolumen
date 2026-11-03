/* Cockpit EvoLumen: atualiza sozinho a cada 30 s. Só lê dados; nada aqui altera a plataforma. */
(function () {
  'use strict';
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var EVERY = 30000;
  var BASE = location.pathname.replace(/\/+$/, '');
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var brl = function (c) { return (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); };
  var num = function (n) { return Math.round(Number(n || 0)).toLocaleString('pt-BR'); };
  var TZ = 'America/Sao_Paulo';

  var state = { f: 'total', data: null, seen: null, next: Date.now() + EVERY, busy: false, dead: false, shown: {} };

  function rel(iso) {
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 10) return 'agora';
    if (s < 60) return 'há ' + s + ' s';
    if (s < 3600) return 'há ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'há ' + Math.floor(s / 3600) + ' h';
    return 'há ' + Math.floor(s / 86400) + ' d';
  }

  /* contagem animada */
  function tween(el, from, to, fmt) {
    if (REDUCED || from === to) { el.textContent = fmt(to); return; }
    var t0 = performance.now();
    (function step(t) {
      var p = Math.min(1, (t - t0) / 700);
      el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* KPIs */
  var KPIS = [
    { id: 'revenue', l: 'Faturamento líquido', fmt: brl, hero: true },
    { id: 'sales', l: 'Vendas aprovadas', fmt: num },
    { id: 'renew', l: 'Renovações', fmt: num },
    { id: 'students', l: 'Alunos novos', fmt: num },
    { id: 'enrollments', l: 'Matrículas', fmt: num },
    { id: 'refunds', l: 'Reembolsos', fmt: num, neg: true },
    { id: 'ticket', l: 'Ticket médio', fmt: brl }
  ];
  $('kpis').innerHTML = KPIS.map(function (k) {
    return '<div class="kpi' + (k.hero ? ' kpi--hero' : '') + '"><div class="kpi__l">' + k.l + '</div><div class="kpi__v" id="kv-' + k.id + '">0</div><div class="kpi__d' + (k.neg ? ' neg' : '') + '" id="kd-' + k.id + '"></div><div class="kpi__a" id="ka-' + k.id + '"></div></div>';
  }).join('');

  function renderKpis(d) {
    var K = d.kpi, p = K.period, t = K.total, h = K.today, all = d.period.f === 'total';
    [p, t, h].forEach(function (x) { var n = (x.sales || 0) + (x.renew || 0); x.ticket = n ? Math.round(x.revenue / n) : 0; });
    var today = { ticket: brl(h.ticket), revenue: brl(h.revenue), sales: num(h.sales), renew: num(h.renew), students: num(h.students), enrollments: num(h.enrollments), refunds: num(h.refunds) };
    KPIS.forEach(function (k) {
      var v = p[k.id] || 0;
      tween($('kv-' + k.id), state.shown[k.id] || 0, v, k.fmt);
      state.shown[k.id] = v;
      $('kd-' + k.id).textContent = k.id === 'ticket' ? 'hoje ' + today.ticket : k.neg ? (h.refunds ? '+' + today.refunds + ' hoje' : 'nenhum hoje') : '+' + today[k.id] + ' hoje';
      var a = '';
      if (!all) a = 'acumulado: ' + k.fmt(t[k.id] || 0);
      else if (k.id === 'students') a = 'cadastrados no total: ' + num(K.studentsTotal);
      else if (k.id === 'enrollments') a = 'ativas agora: ' + num(K.activeNow);
      else if (k.id === 'refunds') a = brl(p.refunded_cents) + ' devolvidos';
      else if (k.id === 'ticket') a = 'por venda ou renovação';
      $('ka-' + k.id).textContent = a;
    });
  }

  /* listas de movimento */
  function item(cls, icon, who, what, right, at, fresh, tag) {
    return '<li class="ev' + (fresh ? ' fresh' : '') + '"><span class="ev__i ' + cls + '">' + icon + '</span><div class="ev__t"><div class="ev__who">' + esc(who) + (tag ? '<span class="tag">' + tag + '</span>' : '') + '</div><div class="ev__what">' + esc(what) + '</div></div><div class="ev__r">' + (right || '') + '<small data-t="' + esc(at) + '">' + rel(at) + '</small></div></li>';
  }
  var keySale = function (e) { return 's|' + e.at + '|' + e.who + '|' + e.course; };
  var keyNew = function (e) { return 'n|' + e.at + '|' + e.who; };
  var keyOn = function (e) { return 'o|' + e.who; };
  function renderFeeds(d) {
    var seen = state.seen, fresh = [];
    var isNew = function (k) { return seen && !seen.has(k); };
    $('feedSales').innerHTML = d.sales.length ? d.sales.map(function (e) {
      var f = isNew(keySale(e)); if (f) fresh.push({ t: e.renew ? 'renew' : 'sale', e: e });
      return item(e.renew ? 'renew' : 'sale', e.renew ? '↻' : 'R$', e.who, e.course, brl(e.cents), e.at, f, e.renew ? 'renovou' : '');
    }).join('') : '<li class="empty">Ainda não há vendas aprovadas.</li>';
    $('feedNew').innerHTML = d.students.length ? d.students.map(function (e) {
      var f = isNew(keyNew(e)); if (f) fresh.push({ t: 'new', e: e });
      return item('', '+1', e.who, e.enrolled ? 'Cadastro novo, já com matrícula' : 'Cadastro novo na plataforma', '', e.at, f, '');
    }).join('') : '<li class="empty">Nenhum aluno cadastrado ainda.</li>';
    $('onSub').textContent = num(d.online.now) + ' online agora · ' + num(d.online.today) + ' acessaram hoje';
    $('feedAccess').innerHTML = d.online.list.length ? d.online.list.map(function (e) {
      var f = isNew(keyOn(e)); if (f) fresh.push({ t: 'access', e: e });
      return item('', '●', e.who, e.course ? 'Assistindo ' + e.course : 'Navegando na plataforma', '', e.at, f, '');
    }).join('') : '<li class="empty">Ninguém online neste momento.</li>';
    var s = new Set();
    d.sales.forEach(function (e) { s.add(keySale(e)); }); d.students.forEach(function (e) { s.add(keyNew(e)); }); d.online.list.forEach(function (e) { s.add(keyOn(e)); });
    state.seen = s;
    return fresh;
  }

  /* Lumen comenta o que entrou */
  var LUMEN = { sale: 'celebra', renew: 'celebra', new: 'guia', access: 'ola', none: 'ola' };
  function lumen(fresh) {
    var pick = fresh.filter(function (x) { return x.t === 'sale' || x.t === 'renew'; })[0] || fresh.filter(function (x) { return x.t === 'new'; })[0] || fresh[0];
    var msg = 'Tudo certo por aqui. Estou de olho na plataforma.', kind = 'none';
    if (pick) {
      kind = pick.t;
      var e = pick.e;
      msg = pick.t === 'sale' ? 'Venda nova! ' + e.who + ' comprou ' + e.course + '.'
        : pick.t === 'renew' ? e.who + ' renovou o acesso a ' + e.course + '.'
        : pick.t === 'new' ? e.who + ' acabou de se cadastrar.'
        : e.who + ' entrou na plataforma.';
    }
    $('lumenMsg').textContent = msg;
    $('lumenImg').src = '/static/img/lumen-' + LUMEN[kind] + '.svg';
  }

  /* gráfico */
  function renderChart(d) {
    var unit = { hour: 'por hora', day: 'por dia', week: 'por semana' }[d.chart.unit] || '';
    $('chartUnit').textContent = unit + ' · ' + (d.period.f === 'total' ? 'últimas 12 semanas' : d.period.label);
    var pts = d.chart.points, n = pts.length, vals = pts.map(function (p) { return p.cents / 100; });
    var max = Math.max.apply(null, vals.concat([1]));
    var step = Math.pow(10, Math.floor(Math.log10(max)));
    var top = Math.ceil(max / step) * step;
    var W = 680, H = 230, ml = 76, mr = 8, mt = 12, mb = 26, iw = W - ml - mr, ih = H - mt - mb, i;
    var out = '<defs><linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFB257"/><stop offset="1" stop-color="#FFB257" stop-opacity=".25"/></linearGradient></defs>';
    for (i = 0; i <= 4; i++) {
      var y = mt + ih - ih * i / 4, v = top * i / 4;
      out += '<line class="grid" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (ml - 8) + '" y="' + (y + 3) + '" text-anchor="end">' + ('R$ ' + (v >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : Math.round(v))) + '</text>';
    }
    var slot = iw / n, bw = Math.max(3, slot * 0.66), every = Math.ceil(n / 12);
    vals.forEach(function (val, k) {
      var h = ih * val / top, x = ml + slot * k + (slot - bw) / 2, last = k === n - 1;
      out += '<rect x="' + x.toFixed(1) + '" y="' + (mt + ih - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(h, val > 0 ? 1.5 : 0).toFixed(1) + '" rx="3" fill="' + (last ? '#5EE6F0' : 'url(#bg1)') + '"><title>' + esc(pts[k].l + ': ' + brl(pts[k].cents) + ' · ' + pts[k].n + ' venda(s)') + '</title></rect>';
      if (k % every === 0 || last) out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(pts[k].l) + '</text>';
    });
    $('chart').innerHTML = out;
  }

  function renderRank(d) {
    var m = Math.max(1, d.rank.length ? d.rank[0].n : 1);
    $('rank').innerHTML = d.rank.length ? d.rank.map(function (c, i) {
      return '<li><div class="rank__top"><span>' + (i + 1) + 'º · ' + esc(c.title) + '</span><span>' + num(c.n) + ' vendas</span></div><div class="rank__bar"><i style="width:' + (c.n / m * 100).toFixed(0) + '%"></i></div><div class="rank__sub">' + brl(c.cents) + ' no período</div></li>';
    }).join('') : '<li class="empty">Nenhuma venda neste período.</li>';
  }

  function renderFunnel(d) {
    var f = d.funnel, a = Math.max(1, f.started), pct = function (x) { return (x / a * 100); };
    var rows = [['Checkouts iniciados', f.started, 100], ['Pagos', f.paid, pct(f.paid)]];
    $('funnel').innerHTML = rows.map(function (r) { return '<div class="fstep"><i style="width:' + r[2].toFixed(0) + '%"></i><span>' + r[0] + '</span><b>' + num(r[1]) + (r[2] < 100 ? ' · ' + r[2].toFixed(0) + '%' : '') + '</b></div>'; }).join('');
    $('pixPills').innerHTML = '<span class="pill">Aguardando pagamento <b>' + num(f.pending) + '</b></span><span class="pill">Expirados <b>' + num(f.expired) + '</b></span><span class="pill">Recusados <b>' + num(f.refused) + '</b></span><span class="pill ok">Conversão <b>' + (f.started ? pct(f.paid).toFixed(1).replace('.', ',') : '0') + '%</b></span>';
  }

  function renderAff(d) {
    var a = d.aff;
    var tiles = [['Em carência', a.grace, ''], ['Liberada', a.released, ''], ['Paga', a.paid, ''], ['Saldo a repassar', a.balance, a.balance < 0 ? 'neg' : '']];
    $('aff').innerHTML = tiles.map(function (t) { return '<div><small>' + t[0] + '</small><b class="' + t[2] + '">' + brl(t[1]) + '</b></div>'; }).join('');
    $('affRows').innerHTML = a.top.length ? a.top.map(function (r) { return '<tr><td>' + esc(r.who) + '</td><td>' + esc(r.codes) + '</td><td>' + num(r.n) + '</td><td>' + brl(r.cents) + '</td></tr>'; }).join('') : '<tr><td colspan="4" class="rank__sub">Nenhuma venda de afiliado neste período.</td></tr>';
  }

  function renderHealth(d) {
    var h = d.health;
    $('health').innerHTML = '<span class="pill ' + (h.mail ? 'ok' : 'bad') + '">E-mail <b>' + (h.mail ? 'configurado' : 'não configurado') + '</b></span>' +
      '<span class="pill ' + (h.paymentsOn ? 'ok' : 'bad') + '">Pagamentos <b>' + esc(h.payments) + '</b></span>' +
      '<span class="pill ' + (h.legal >= 2 ? 'ok' : 'bad') + '">Textos legais <b>' + h.legal + ' de 2</b></span>' +
      '<span class="pill ' + (h.refundsOpen ? 'bad' : 'ok') + '">Reembolsos abertos <b>' + h.refundsOpen + '</b></span>' +
      '<span class="pill">Versão <b>' + esc(d.version) + '</b></span><span class="pill">Ambiente <b>' + esc(d.env) + '</b></span>';
  }

  function scopeText(d) {
    var p = d.period;
    if (p.f === 'total') return 'Mostrando: tudo desde o início';
    if (p.f === 'custom' && p.de) return 'Mostrando: ' + p.de.split('-').reverse().join('/') + ' a ' + p.ate.split('-').reverse().join('/');
    return 'Mostrando: ' + p.label + ' (acumulado em cada cartão)';
  }

  function render(d, first) {
    state.data = d;
    renderKpis(d);
    var fresh = renderFeeds(d);
    lumen(first ? [] : fresh);
    renderChart(d); renderRank(d); renderFunnel(d); renderAff(d); renderHealth(d);
    $('scope').textContent = scopeText(d);
    $('lastUp').textContent = 'Última atualização: ' + new Date().toLocaleTimeString('pt-BR', { timeZone: TZ });
    $('live').classList.remove('off'); $('liveTxt').textContent = 'AO VIVO';
  }

  /* busca */
  function qs() {
    var q = 'f=' + encodeURIComponent(state.f);
    if (state.f === 'custom') q += '&de=' + encodeURIComponent($('from').value) + '&ate=' + encodeURIComponent($('to').value);
    return q;
  }
  function load(first) {
    if (state.busy || state.dead) return;
    state.busy = true;
    fetch(BASE + '/dados?' + qs(), { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (r.status === 404) { state.dead = true; throw new Error('gone'); }
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(function (d) { render(d, first); })
      .catch(function (e) {
        if (e && e.message === 'gone') {
          $('live').classList.add('off'); $('liveTxt').textContent = 'LINK DESATIVADO';
          $('countTxt').textContent = 'Este link foi trocado. Abra o novo em Configurações do painel administrativo.';
          return;
        }
        $('live').classList.add('off'); $('liveTxt').textContent = 'SEM CONEXÃO';
      })
      .then(function () { state.busy = false; state.next = Date.now() + EVERY; });
  }

  /* filtros */
  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (b) {
    b.addEventListener('click', function () {
      state.f = b.getAttribute('data-f');
      Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      $('range').classList.toggle('on', state.f === 'custom');
      state.shown = {}; load(true);
    });
  });
  var iso = function (d) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); };
  var now = new Date();
  $('to').value = iso(now); $('from').value = iso(new Date(now.getTime() - 29 * 86400000));
  $('to').max = iso(now);
  $('from').addEventListener('change', function () { if (state.f === 'custom') load(true); });
  $('to').addEventListener('change', function () { if (state.f === 'custom') load(true); });

  /* relógio e contagem */
  function tick() {
    var n = new Date();
    $('date').textContent = n.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
    $('time').textContent = n.toLocaleTimeString('pt-BR', { timeZone: TZ });
    Array.prototype.forEach.call(document.querySelectorAll('small[data-t]'), function (el) { el.textContent = rel(el.getAttribute('data-t')); });
    if (state.dead) return;
    var left = Math.max(0, Math.ceil((state.next - Date.now()) / 1000));
    $('countTxt').innerHTML = 'Atualiza em <b>' + left + '</b> s';
    $('countBar').style.transform = 'scaleX(' + (left / (EVERY / 1000)) + ')';
    if (left <= 0) load(false);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && Date.now() >= state.next) load(false); });
  setInterval(tick, 1000);
  tick(); load(true);
})();
