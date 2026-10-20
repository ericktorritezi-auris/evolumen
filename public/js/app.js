'use strict';
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var overlay = $('#menu-overlay'), openBtn = $('#menu-open'), lastFocus = null;
  function openMenu() {
    if (!overlay) return;
    lastFocus = document.activeElement;
    overlay.hidden = false; document.body.classList.add('menu-open');
    if (openBtn) openBtn.setAttribute('aria-expanded', 'true');
    var f = overlay.querySelector('button, a'); if (f) f.focus();
  }
  function closeMenu() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true; document.body.classList.remove('menu-open');
    if (openBtn) { openBtn.setAttribute('aria-expanded', 'false'); openBtn.focus(); } else if (lastFocus) lastFocus.focus();
  }
  if (openBtn) openBtn.addEventListener('click', openMenu);
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-menu-close]')) closeMenu();
    var t = e.target.closest('[data-toggle-pw]');
    if (t) {
      var i = document.getElementById(t.getAttribute('data-toggle-pw')); if (!i) return;
      var show = i.type === 'password'; i.type = show ? 'text' : 'password';
      t.textContent = show ? 'Ocultar' : 'Mostrar'; t.setAttribute('aria-pressed', String(show));
      t.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
    if (e.key === 'Tab' && overlay && !overlay.hidden) {
      var f = overlay.querySelectorAll('a, button'); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  // Janela com a imagem do cupom e botão de copiar link.
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-modal-open]');
    if (o) { var d = document.getElementById(o.getAttribute('data-modal-open')); if (d && d.showModal) d.showModal(); return; }
    var c = e.target.closest('[data-modal-close]');
    if (c) { var m = c.closest('dialog'); if (m) m.close(); return; }
    if (e.target.tagName === 'DIALOG') { e.target.close(); return; }
    var cp = e.target.closest('[data-copy]');
    if (cp) {
      var src = document.getElementById(cp.getAttribute('data-copy')); if (!src) return;
      var done = function (ok) { var old = cp.getAttribute('data-label') || cp.textContent; cp.setAttribute('data-label', old); cp.textContent = ok ? 'Copiado' : 'Selecione e copie'; setTimeout(function () { cp.textContent = old; }, 2000); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(src.textContent).then(function () { done(true); }, function () { done(false); });
      else { var r = document.createRange(); r.selectNodeContents(src); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); done(false); }
    }
  });
  document.addEventListener('submit', function (e) {
    var m = e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (m && !window.confirm(m)) e.preventDefault();
  });

  // Fase 4: página do pedido (consulta o andamento, contagem do Pix e ida ao checkout do cartão).
  (function () {
    var box = document.querySelector('[data-order-poll]');
    if (!box) return;
    var url = box.getAttribute('data-order-poll'), n = 0, stopped = false;
    function tick() {
      if (stopped) return;
      n++;
      fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (j && j.status && j.status !== 'pending') { stopped = true; location.reload(); return; }
        setTimeout(tick, n < 20 ? 4000 : 10000);
      }).catch(function () { setTimeout(tick, 10000); });
    }
    setTimeout(tick, 4000);
    var left = document.querySelector('[data-pix-left]');
    if (left && left.getAttribute('data-pix-left')) {
      var end = new Date(left.getAttribute('data-pix-left')).getTime();
      var paint = function () {
        var s = Math.max(0, Math.round((end - Date.now()) / 1000));
        left.textContent = s > 0 ? 'Vale por mais ' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2) + ' minutos.' : 'O Pix venceu. Atualize a página para gerar outro.';
      };
      paint(); setInterval(paint, 1000);
    }
    var go = document.getElementById('paygo');
    if (go) {
      var key = 'paygo:' + url, seen = false;
      try { seen = sessionStorage.getItem(key) === '1'; sessionStorage.setItem(key, '1'); } catch (e) {}
      if (!seen) setTimeout(function () { location.href = go.href; }, 900);
    }
  })();

  // Fase 3: tempo assistido da aula (o player do YouTube informa o tempo tocado; o servidor soma com limite pelo tempo real).
  (function () {
    var box = document.querySelector('[data-watch]'), fr = document.getElementById('yt-player');
    if (!box || !fr || box.getAttribute('data-admin')) return;
    var url = box.getAttribute('data-watch'), csrf = box.getAttribute('data-csrf');
    var acc = 0, last = null, state = -1, duration = 0;
    function post(msg) { try { fr.contentWindow.postMessage(JSON.stringify(msg), '*'); } catch (e) {} }
    function listen() { post({ event: 'listening', id: 1, channel: 'widget' }); post({ event: 'command', func: 'addEventListener', args: ['onStateChange'] }); }
    fr.addEventListener('load', function () { listen(); setTimeout(listen, 1000); setTimeout(listen, 3000); });
    window.addEventListener('message', function (e) {
      if (e.source !== fr.contentWindow) return;
      var d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (x) { return; }
      if (!d) return;
      if (d.event === 'infoDelivery' && d.info) {
        var i = d.info;
        if (typeof i.duration === 'number' && i.duration > 0) duration = i.duration;
        if (typeof i.playerState === 'number') state = i.playerState;
        if (typeof i.currentTime === 'number') {
          if (state === 1 && last !== null) { var diff = i.currentTime - last; if (diff > 0 && diff <= 3) acc += diff; }
          last = i.currentTime;
        }
      } else if (d.event === 'onStateChange' && typeof d.info === 'number') state = d.info;
    });
    function send(beacon) {
      var s = Math.floor(acc); if (s < 1) return;
      acc -= s;
      var body = new URLSearchParams({ _csrf: csrf, delta: String(s), duration: String(Math.floor(duration)) }).toString();
      if (beacon && navigator.sendBeacon) { navigator.sendBeacon(url, new Blob([body], { type: 'application/x-www-form-urlencoded' })); return; }
      fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
        .then(function (r) { return r.json(); }).then(function (j) { if (j && j.ok && typeof j.pct === 'number') showPct(j.pct); }).catch(function () { acc += s; });
    }
    // Contador na tela: barra, percentual e, ao passar de 50%, avisa que a prova final foi liberada.
    var meter = document.querySelector('[data-wmeter]');
    function showPct(p) {
      p = Math.max(0, Math.min(100, p));
      if (!meter) return;
      var shown = parseInt(meter.querySelector('[data-wpct]').textContent, 10) || 0;
      if (p < shown) p = shown;
      meter.querySelector('[data-wpct]').textContent = p + '%';
      meter.querySelector('[data-wfill]').style.width = p + '%';
      meter.querySelector('.bar').setAttribute('aria-valuenow', String(p));
      if (p >= 50 && !meter.classList.contains('is-open')) {
        meter.classList.add('is-open');
        var href = meter.getAttribute('data-href');
        var msg = meter.querySelector('[data-wmsg]'); msg.textContent = '';
        var b = document.createElement('b'); b.textContent = 'Prova final liberada! '; msg.appendChild(b);
        var a = document.createElement('a'); a.href = href; a.textContent = 'Fazer a prova final'; msg.appendChild(a);
        var row = document.querySelector('[data-final-row]');
        if (row) {
          row.className = 'lrow lrow--final is-current';
          row.textContent = '';
          var l = document.createElement('a'); l.href = href;
          l.innerHTML = '<span class="lrow__st" aria-hidden="true">▶</span><span class="lrow__t">Prova final</span><span class="muted small">Liberada</span>';
          row.appendChild(l);
        }
      }
    }
    setInterval(function () { send(false); }, 10000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') send(true); });
    window.addEventListener('pagehide', function () { send(true); });
  })();
  // Editor de questão: mostra só os campos do tipo escolhido.
  (function () {
    function sync(sel) {
      var f = sel.closest('form'); if (!f) return;
      [].forEach.call(f.querySelectorAll('[data-kind-box]'), function (b) { b.hidden = b.getAttribute('data-kind-box') !== sel.value; });
    }
    [].forEach.call(document.querySelectorAll('select[name=kind]'), function (s) { sync(s); s.addEventListener('change', function () { sync(s); }); });
  })();
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
})();
