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
  document.addEventListener('submit', function (e) {
    var m = e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (m && !window.confirm(m)) e.preventDefault();
  });
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
})();
