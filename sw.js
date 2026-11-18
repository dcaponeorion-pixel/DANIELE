// Service worker - HR Orion
// Strategia: prima la rete (così gli aggiornamenti arrivano subito), se offline usa la copia salvata.
const CACHE = 'hr-orion-v2';
const CFG = 'hr-orion-cfg';     // indirizzo dello script Google, scritto dalle app
const SHELL = [
  './', './index.html', './admin.html',
  './manifest.webmanifest', './manifest-admin.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // un file mancante non deve bloccare l'installazione
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE && k !== CFG).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                              // i POST verso Google Script non si toccano
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;               // Google Script e font restano in rete

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      throw err;
    }
  })());
});

/* ---------- Notifiche: arriva un avviso (anche ad app chiusa) ---------- */
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let title = 'HR Orion', body = 'Hai un nuovo avviso: apri l\'app per vederlo.', app = '';
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const c = await caches.open(CFG);
      const r = await c.match('./__cfg');
      const cfg = r ? await r.json() : null;
      if (sub && cfg && cfg.url) {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 8000);
        const res = await fetch(cfg.url + '?action=avvisolast&ep=' + encodeURIComponent(sub.endpoint) + '&_=' + Date.now(), { signal: ctl.signal });
        clearTimeout(t);
        const d = await res.json();
        if (d && d.ok) { title = d.title || title; body = d.text || ''; app = d.app || ''; }
      }
    } catch (err) { /* senza rete: avviso generico */ }
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    list.forEach((c) => c.postMessage({ type: 'hr-push' }));
    const url = app === 'admin' ? './admin.html' : (app === 'emp' ? './index.html' : '');
    await self.registration.showNotification(title, {
      body: body, icon: './icon-192.png', badge: './icon-192.png',
      tag: 'hr-' + Date.now(), data: { url: url }, vibrate: [200, 100, 200]
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const want = (event.notification.data && event.notification.data.url) || './index.html';
  event.waitUntil((async () => {
    const target = new URL(want, self.registration.scope).href;
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const page = want.replace('./', '');
    for (const c of list) {
      if (c.url.indexOf(page) >= 0 && 'focus' in c) { c.postMessage({ type: 'hr-push' }); return c.focus(); }
    }
    if (list.length && 'focus' in list[0] && !(event.notification.data && event.notification.data.url)) return list[0].focus();
    return self.clients.openWindow(target);
  })());
});
