// ============================================================
// SERVICE WORKER — met en cache l'app pour un lancement hors-ligne une fois installée.
// Stratégie "cache d'abord, réseau en secours".
// ============================================================

// Ce numéro est généré automatiquement à chaque publication (voir publish-web.ps1, horodatage)
// plutôt que changé à la main : un appareil ayant déjà installé la PWA ne récupère PAS
// automatiquement les nouveaux fichiers tant que ce nom ne change pas.
const CACHE_NAME = 'scrpg-20260915094328';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './js/version.js',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of ASSETS) {
        await cache.add(url).catch(() => {});
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
