// Só a casca do app fica guardada. API nunca; mapa (tiles) também não: a política do OSM não permite baixar para uso offline.
const V = 'vidros-2';
const CASCA = ['/', '/style.css', '/app.js', '/icone.svg', '/manifest.json', '/vendor/leaflet.js', '/vendor/leaflet.css'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(CASCA)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // abre na hora com o que tem guardado e atualiza por trás
  e.respondWith(caches.open(V).then(async c => {
    const tem = await c.match(e.request, { ignoreSearch: true });
    const rede = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
    if (tem) { e.waitUntil(rede.catch(() => {})); return tem; }
    return rede;
  }));
});
