/* Service worker de JARVIS: interfaz disponible sin conexión y notificaciones push.
   Nunca guarda en caché la API ni datos personales: solo los archivos de la interfaz. */
const CACHE = 'jarvis-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API, eventos, OAuth, motor de voz y modelos: siempre de la red.
  if (/^\/(api|oauth|ort)\//.test(url.pathname)) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      void caches.open(CACHE).then((c) => c.put('/', copy));
      return res;
    }).catch(() => caches.match('/')));
    return;
  }
  // Archivos con huella (/assets/…): inmutables → primero caché.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); void caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});

self.addEventListener('push', (e) => {
  let d = { title: 'JARVIS', body: '', url: '/' };
  try { d = { ...d, ...e.data.json() }; } catch { /* texto plano */ }
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, tag: d.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: d.url } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.navigate(target).catch(() => undefined); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
