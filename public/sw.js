'use strict';
// Service worker: guarda só o visual básico e a página offline. Nunca guarda páginas com dados da conta.
const V = 'evl-__VERSION__';
const SHELL = ['/offline', '/static/css/app.css', '/static/img/logo.svg', '/static/img/lumen-pensa.svg', '/static/icons/icon-192.png', '/static/fonts/quicksand-latin-wght-normal.woff2', '/static/fonts/nunito-latin-wght-normal.woff2'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline')));
    return;
  }
  if (url.pathname.startsWith('/static/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
