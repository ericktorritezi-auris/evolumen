/* Aviso de cookies e medição (EvoLumen Analytics). Sem terceiros.
   Guarda a escolha em ea_ok (pode medir) ou ea_off (não medir), no domínio-mãe: vale para a plataforma e para as landings. */
(function () {
  'use strict';
  try {
    var d = document, n = navigator, w = window;
    var cookie = function (k) { var m = d.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; };
    var secure = w.location.protocol === 'https:' ? '; Secure' : '';
    var host = w.location.hostname, parts = host.split('.'), plain = /^\d+(\.\d+){3}$/.test(host);
    var doms = function () { var a = []; if (parts.length >= 2 && !plain) for (var i = parts.length - 2; i >= 0; i--) a.push('.' + parts.slice(i).join('.')); return a; };
    var set = function (k, v, maxAge) {
      var attrs = k + '=' + encodeURIComponent(v) + '; path=/; max-age=' + maxAge + '; SameSite=Lax' + secure, ds = doms();
      for (var i = 0; i < ds.length; i++) { d.cookie = attrs + '; domain=' + ds[i]; if (cookie(k) === String(v)) return; }
      d.cookie = attrs;
    };
    var del = function (k) { d.cookie = k + '=; path=/; max-age=0'; doms().forEach(function (x) { d.cookie = k + '=; path=/; max-age=0; domain=' + x; }); };
    var YEAR = 395 * 86400;
    var signal = n.doNotTrack === '1' || w.doNotTrack === '1' || n.globalPrivacyControl === true;
    var base = (function () { var s = d.querySelector('script[src*="/static/js/ea.js"]'); try { return s ? new URL(s.src).origin : w.location.origin; } catch (e) { return w.location.origin; } })();
    var state = function () { return signal ? 'sinal' : cookie('ea_off') === '1' ? 'off' : 'on'; };
    var banner = d.querySelector('[data-ea-banner]');
    var paint = function () {
      var s = state();
      d.querySelectorAll('[data-ea-status]').forEach(function (el) {
        el.textContent = s === 'sinal' ? 'Seu navegador pediu para não ser medido (Não rastrear). Respeitamos esse pedido.' : s === 'off' ? 'Você pediu para não ser medido. Nenhum dado de visita seu é coletado.' : 'A medição de visitas está ativa para você.';
      });
      d.querySelectorAll('[data-ea-act="off"]').forEach(function (b) { b.hidden = s !== 'on'; });
      d.querySelectorAll('[data-ea-act="on"]').forEach(function (b) { b.hidden = s !== 'off'; });
    };
    var act = function (a) {
      if (a === 'off') {
        var v = cookie('ea_v'), s = cookie('ea_s');
        // Pede ao servidor para apagar o que já foi registrado deste navegador.
        if (v && w.fetch) w.fetch(base + '/ea/c', { method: 'POST', body: JSON.stringify({ x: 1, v: v, s: s }), headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'cors', credentials: 'omit' }).catch(function () {});
        set('ea_off', '1', YEAR); del('ea_v'); del('ea_s'); del('ea_ok');
      } else { del('ea_off'); set('ea_ok', '1', YEAR); }
      if (banner) { banner.hidden = true; d.body.classList.remove('ea-pad'); }
      var st = d.querySelector('[data-ea-status]'); paint(); if (st && st.focus) { st.setAttribute('tabindex', '-1'); st.focus(); }
    };
    d.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-ea-act]'); if (!b) return;
      e.preventDefault(); act(b.getAttribute('data-ea-act'));
    });
    if (banner && !signal && !cookie('ea_ok') && cookie('ea_off') !== '1') {
      banner.hidden = false; d.body.classList.add('ea-pad');
    }
    paint();
  } catch (e) { /* o aviso nunca pode quebrar a página */ }
})();
