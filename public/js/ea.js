/* EvoLumen Analytics: medição própria de acessos. Sem terceiros: envia um aviso por página ao servidor do EvoLumen.
   Guarda dois identificadores anônimos no navegador (ea_v: visitante, 13 meses; ea_s: visita, 30 minutos).
   Respeita "Não rastrear", o controle global de privacidade e a recusa da pessoa (ea_off). */
(function () {
  'use strict';
  try {
    var d = document, n = navigator, w = window;
    var me = d.currentScript;
    var base = me && me.src ? new URL(me.src).origin : w.location.origin;
    var off = n.doNotTrack === '1' || w.doNotTrack === '1' || n.globalPrivacyControl === true;
    var cookie = function (k) { var m = d.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; };
    try { if (w.localStorage.getItem('ea_off') === '1') off = true; } catch (e) { /* sem armazenamento */ }
    if (cookie('ea_off') === '1') off = true;
    if (off) { // recusou: apaga o que já existia
      var host0 = w.location.hostname, p0 = host0.split('.');
      ['ea_v', 'ea_s'].forEach(function (k) {
        d.cookie = k + '=; path=/; max-age=0';
        for (var i = p0.length - 2; i >= 0; i--) d.cookie = k + '=; path=/; max-age=0; domain=.' + p0.slice(i).join('.');
      });
      return;
    }
    // Pré-carregamento invisível não conta como visita.
    if (d.visibilityState === 'prerender') return;

    var secure = w.location.protocol === 'https:' ? '; Secure' : '';
    // O cookie vale para o domínio-mãe (landing e plataforma compartilham o visitante). O navegador recusa domínios públicos como com.br.
    var host = w.location.hostname, parts = host.split('.');
    var set = function (k, v, maxAge) {
      var attrs = k + '=' + encodeURIComponent(v) + '; path=/; max-age=' + maxAge + '; SameSite=Lax' + secure;
      if (parts.length >= 2 && !/^\d+(\.\d+){3}$/.test(host)) {
        for (var i = parts.length - 2; i >= 0; i--) {
          var dom = parts.slice(i).join('.');
          d.cookie = attrs + '; domain=.' + dom;
          if (cookie(k) === String(v)) return;
        }
      }
      d.cookie = attrs;
    };
    var rnd = function () {
      var a = new Uint8Array(18), s = '';
      (w.crypto || w.msCrypto).getRandomValues(a);
      for (var i = 0; i < a.length; i++) s += 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[a[i] % 62];
      return s;
    };
    var ok = function (v) { return /^[A-Za-z0-9]{16,40}$/.test(v); };
    var v = cookie('ea_v'); if (!ok(v)) v = rnd();
    set('ea_v', v, 395 * 86400);                       // 13 meses
    var s = cookie('ea_s'); if (!ok(s)) s = rnd();
    set('ea_s', s, 30 * 60);                           // renova a cada página: a visita acaba após 30 min parado
    var q = new URLSearchParams(w.location.search);
    var body = JSON.stringify({
      v: v, s: s, p: w.location.pathname, h: host,
      r: d.referrer || '',
      q: { c: q.get('cupom') || q.get('coupon') || '', o: q.get('origem') || q.get('utm_source') || '' }
    });
    var url = base + '/ea/c';
    if (n.sendBeacon) { if (n.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return; }
    w.fetch(url, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'cors', credentials: 'omit' }).catch(function () {});
  } catch (e) { /* medir nunca pode quebrar a página */ }
})();
