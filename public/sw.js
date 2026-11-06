// Service Worker: macht die App offline nutzbar.
// - Seiten, Skripte, Styles: erst Netz (immer aktuell), bei fehlender Verbindung der gespeicherte Stand.
// - Daten (Gesetze, Lernsets, Profil): ebenso; gespeichert wird, was einmal geladen wurde ("Offline" im Profil lädt gezielt vor).
// - Bibliotheken von CDNs (jsdelivr, cdnjs): einmal geladen, dann aus dem Speicher.
// Alles Persönliche liegt nur im Datenspeicher und wird beim Abmelden gelöscht (common.js).
const VERSION = 'v1';  // nur ändern, um alle Zwischenspeicher zu leeren
const SHELL = `quiz-shell-${VERSION}`;
const DATA = `quiz-data-${VERSION}`;
const LIBS = `quiz-libs-${VERSION}`;
const PRECACHE = ['/offline', '/dashboard', '/study', '/learn', '/gesetze', '/profile', '/js/common.js', '/js/changelog.js', '/js/speech.js', '/js/cloze.js',
  '/manifest.webmanifest', '/icons/icon-192.png?v=2', '/icons/apple-touch-icon.png?v=2'];
const STYLE = '/style.css?v=15';
// Daten-Endpunkte, die offline gelesen werden dürfen
const DATA_RE = /^\/api\/(auth\/me|subjects|gesetze(\/[\w\-./]*)?|study|study\/(\d+|stats))$/;
const LIB_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all([...PRECACHE, STYLE].map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (/^quiz-/.test(k) && ![SHELL, DATA, LIBS].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const offlineJson = () => new Response(JSON.stringify({ error: 'Keine Verbindung', offline: true }), { status: 503, headers: { 'Content-Type': 'application/json', 'X-Offline': '1' } });

async function networkFirst(req, cacheName, { timeout = 6000, navigation = false } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout)),
    ]);
    if (res.ok && res.status === 200) {
      // Daten: erst speichern, dann antworten (die Offline-Seite prüft direkt danach, was gespeichert ist)
      if (cacheName === DATA) await cache.put(req, res.clone()).catch(() => {}); else cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: navigation || /\.html?$|^[^.]*$/.test(new URL(req.url).pathname) });
    if (hit) return hit;
    if (navigation) return (await caches.open(SHELL)).match('/offline').then((r) => r || Response.error());
    return cacheName === DATA ? offlineJson() : Response.error();
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname === '/sw.js') return;
    if (url.pathname.startsWith('/api/')) {
      if (DATA_RE.test(url.pathname)) e.respondWith(networkFirst(req, DATA, { timeout: 8000 }));
      return;
    }
    e.respondWith(networkFirst(req, SHELL, { navigation: req.mode === 'navigate' }));
  } else if (LIB_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req, LIBS));
  }
});
