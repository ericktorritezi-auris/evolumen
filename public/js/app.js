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
  // Sugestão de onde guardar o arquivo (quem decide é o administrador)
  document.addEventListener('change', function (e) {
    var inp = e.target.closest ? e.target.closest('[data-suggest-storage]') : null;
    if (!inp || !inp.files || !inp.files[0]) return;
    var form = inp.form, sel = form && form.querySelector('[data-storage]'), msg = form && form.querySelector('[data-storage-msg]');
    if (!sel) return;
    var mb = inp.files[0].size / 1048576, vol = sel.querySelector('option[value="volume"]'), size = mb.toFixed(1).replace('.', ',') + ' MB';
    var volOn = !!(vol && !vol.disabled), lim = volOn ? 350 : 20;
    if (mb > lim) { inp.value = ''; if (msg) msg.textContent = 'Este arquivo tem ' + size + ' e passa do limite de ' + lim + ' MB' + (volOn ? '.' : ' (o volume não está ligado neste ambiente).'); return; }
    if (mb > 20) { if (sel.value === 'db') sel.value = 'volume'; if (msg) msg.textContent = 'Este arquivo tem ' + size + ': não cabe no banco, então vai para o volume.'; }
    else if (msg) msg.textContent = 'Este arquivo tem ' + size + ': cabe no banco. Se preferir, escolha o volume.';
  });
  // Campainha de avisos (texto sempre inserido como texto, nunca como HTML)
  var bellEl = $('#bell-panel'), bellFrom = null, bellCsrf = '';
  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'agora'; if (s < 3600) return 'há ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'há ' + Math.floor(s / 3600) + ' h'; var d = Math.floor(s / 86400); return 'há ' + d + (d === 1 ? ' dia' : ' dias');
  }
  function bellBadge(n) {
    document.querySelectorAll('[data-bell-n]').forEach(function (b) { b.textContent = n > 99 ? '99+' : String(n); b.hidden = n < 1; });
    document.querySelectorAll('[data-bell]').forEach(function (b) { b.classList.toggle('has-new', n > 0); b.setAttribute('aria-label', n > 0 ? 'Avisos: ' + n + ' novos' : 'Avisos'); });
  }
  function bellLoad() {
    if (!document.querySelector('[data-bell]')) return Promise.resolve();
    return fetch('/notificacoes.json', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return; bellBadge(d.unread);
      if (!bellEl) return;
      var ul = bellEl.querySelector('[data-bell-list]'), sub = bellEl.querySelector('[data-bell-sub]'), all = bellEl.querySelector('[data-bell-all]');
      ul.textContent = '';
      d.items.forEach(function (it) {
        var li = document.createElement('li'), a = document.createElement('a');
        a.href = '/notificacoes/' + encodeURIComponent(it.id) + '/abrir'; a.className = 'bell__item' + (it.read ? ' is-read' : ' is-new');
        var dot = document.createElement('span'); dot.className = 'bell__dot'; dot.setAttribute('aria-hidden', 'true');
        var box = document.createElement('span'), t = document.createElement('strong'), b = document.createElement('span'), w = document.createElement('small');
        t.textContent = it.title; b.textContent = it.body; b.className = 'bell__body'; w.textContent = ago(it.at) + (it.read ? '' : ' · novo');
        box.appendChild(t); if (it.body) box.appendChild(b); box.appendChild(w); a.appendChild(dot); a.appendChild(box); li.appendChild(a); ul.appendChild(li);
      });
      sub.textContent = d.items.length ? (d.unread ? d.unread + (d.unread === 1 ? ' aviso novo' : ' avisos novos') : 'Tudo em dia.') : 'Você não tem avisos.';
      all.hidden = d.unread < 1;
    }).catch(function () {});
  }
  function bellOpen(from) { if (!bellEl) return; bellFrom = from; bellCsrf = from.getAttribute('data-csrf') || ''; bellEl.hidden = false; document.body.classList.add('menu-open'); bellLoad(); var b = bellEl.querySelector('.help__x'); if (b) b.focus(); }
  function bellClose() { if (!bellEl || bellEl.hidden) return; bellEl.hidden = true; document.body.classList.remove('menu-open'); if (bellFrom) bellFrom.focus(); }
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-bell]'); if (o) bellOpen(o);
    if (e.target.closest('[data-bell-close]')) bellClose();
    if (e.target.closest('[data-bell-all]')) {
      fetch('/notificacoes/ler-todas', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' }, body: '_csrf=' + encodeURIComponent(bellCsrf) }).then(bellLoad).catch(function () {});
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') bellClose();
    if (e.key === 'Tab' && bellEl && !bellEl.hidden) {
      var bf = bellEl.querySelectorAll('a, button:not([hidden])'); if (!bf.length) return;
      var b1 = bf[0], b2 = bf[bf.length - 1];
      if (e.shiftKey && document.activeElement === b1) { e.preventDefault(); b2.focus(); }
      else if (!e.shiftKey && document.activeElement === b2) { e.preventDefault(); b1.focus(); }
      else if (!bellEl.contains(document.activeElement)) { e.preventDefault(); b1.focus(); }
    }
  });
  if (document.querySelector('[data-bell]')) {
    bellLoad();
    setInterval(function () { if (!document.hidden) bellLoad(); }, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) bellLoad(); });
  }
  // Ajuda da Lumen
  var helpEl = $('#help-panel'), helpFrom = null;
  function helpOpen(from) { if (!helpEl) return; helpFrom = from; helpEl.hidden = false; document.body.classList.add('menu-open'); var b = helpEl.querySelector('.help__x'); if (b) b.focus(); }
  function helpClose() { if (!helpEl || helpEl.hidden) return; helpEl.hidden = true; document.body.classList.remove('menu-open'); if (helpFrom) helpFrom.focus(); }
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-help-open]'); if (o) helpOpen(o);
    if (e.target.closest('[data-help-close]')) helpClose();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeMenu(); helpClose(); }
    if (e.key === 'Tab' && helpEl && !helpEl.hidden) {
      var hf = helpEl.querySelectorAll('a, button'); if (!hf.length) return;
      var h1 = hf[0], h2 = hf[hf.length - 1];
      if (e.shiftKey && document.activeElement === h1) { e.preventDefault(); h2.focus(); }
      else if (!e.shiftKey && document.activeElement === h2) { e.preventDefault(); h1.focus(); }
      else if (!helpEl.contains(document.activeElement)) { e.preventDefault(); h1.focus(); }
    }
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
    var m = (e.submitter && e.submitter.getAttribute('data-confirm')) || (e.target.getAttribute && e.target.getAttribute('data-confirm'));
    if (m && !window.confirm(m)) { e.preventDefault(); return; }
    // Duplo clique: o botão que enviou o formulário fica desligado até a página responder.
    if (e.submitter && !e.defaultPrevented && e.target.matches && e.target.matches('.forum form, .review form')) setTimeout(function () { e.submitter.disabled = true; }, 0);
  });

  // Editor visual dos textos legais (sem código): barra de botões, colagem limpa e envio do HTML ao salvar.
  (function () {
    var box = document.querySelector('[data-editor]');
    if (!box) return;
    var area = box.querySelector('.editor__area'), hidden = box.querySelector('input[type=hidden]'), form = box.closest('form');
    var OK = { P: 'p', H2: 'h2', H3: 'h3', H4: 'h4', UL: 'ul', OL: 'ol', LI: 'li', STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', U: 'u', BR: 'br', A: 'a', BLOCKQUOTE: 'blockquote', H1: 'h2', H5: 'h4', H6: 'h4', DIV: 'p' };
    var esc = function (t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    function clean(node) {
      var out = '';
      node.childNodes.forEach(function (n) {
        if (n.nodeType === 3) { out += esc(n.nodeValue.replace(/ /g, ' ')); return; }
        if (n.nodeType !== 1) return;
        var tag = OK[n.tagName];
        if (/^(SCRIPT|STYLE|META|LINK|TITLE|HEAD|IFRAME|OBJECT|SVG)$/.test(n.tagName)) return;
        var inner = clean(n);
        if (!tag) { out += inner; return; }
        if (tag === 'br') { out += '<br>'; return; }
        if (tag === 'a') { var h = n.getAttribute('href') || ''; out += /^(https?:\/\/|mailto:)/i.test(h) ? '<a href="' + h.replace(/"/g, '&quot;') + '">' + inner + '</a>' : inner; return; }
        if (/^(p|h2|h3|h4|li)$/.test(tag) && !inner.replace(/<br>|\s/g, '')) return;
        out += '<' + tag + '>' + inner + '</' + tag + '>';
      });
      return out;
    }
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
    function run(cmd) {
      area.focus();
      var parts = cmd.split(':');
      if (parts[0] === 'formatBlock') {
        var cur = document.queryCommandValue('formatBlock').toLowerCase().replace(/[<>]/g, '');
        document.execCommand('formatBlock', false, parts[1] === 'p' || cur === parts[1] ? 'p' : parts[1]);
      } else if (cmd === 'link') {
        var url = window.prompt('Endereço do link (começa com https://)', 'https://');
        if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) document.execCommand('createLink', false, url.trim());
      } else document.execCommand(cmd, false, null);
    }
    box.querySelector('.editor__bar').addEventListener('mousedown', function (e) { if (e.target.closest('[data-cmd]')) e.preventDefault(); });
    box.querySelector('.editor__bar').addEventListener('click', function (e) { var b = e.target.closest('[data-cmd]'); if (b) run(b.getAttribute('data-cmd')); });
    area.addEventListener('paste', function (e) {
      var cd = e.clipboardData; if (!cd) return;
      e.preventDefault();
      var h = cd.getData('text/html');
      if (h) { var doc = new DOMParser().parseFromString(h, 'text/html'); document.execCommand('insertHTML', false, clean(doc.body)); }
      else document.execCommand('insertText', false, cd.getData('text/plain'));
    });
    if (!area.innerHTML.trim()) area.innerHTML = '<p><br></p>';
    if (form) form.addEventListener('submit', function () { hidden.value = area.innerHTML; var f = box.querySelector('input[name=desc_js]'); if (f) f.value = '1'; });
  })();

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
  // Cockpit: editar uma data troca o período para "Período livre".
  (function () {
    var sel = document.getElementById('periodo'); if (!sel) return;
    ['de', 'ate'].forEach(function (id) { var el = document.getElementById(id); if (el) el.addEventListener('change', function () { sel.value = 'custom'; }); });
  })();
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
})();
