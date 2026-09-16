// ============================================================
// SERVICE WORKER — met en cache l'app pour un lancement hors-ligne une fois installée.
// Stratégie "cache d'abord, réseau en secours".
// ============================================================

// Ce numéro est généré automatiquement à chaque publication (voir publish-web.ps1, horodatage)
// plutôt que changé à la main : un appareil ayant déjà installé la PWA ne récupère PAS
// automatiquement les nouveaux fichiers tant que ce nom ne change pas.
const CACHE_NAME = 'scrpg-20260916125534';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './js/version.js',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './img/combat-bg.png',
  './img/guerrier.png',
  './img/guerrier-dos.png',
  './img/guerrier-cote.png',
  './img/guerrier-attaque.png',
  './img/barbare.png',
  './img/barbare-dos.png',
  './img/barbare-cote.png',
  './img/barbare-attaque.png',
  './img/mage.png',
  './img/mage-dos.png',
  './img/mage-cote.png',
  './img/mage-attaque.png',
  './img/voleur.png',
  './img/voleur-dos.png',
  './img/voleur-cote.png',
  './img/voleur-attaque.png',
  './img/pyromane.png',
  './img/pyromane-dos.png',
  './img/pyromane-cote.png',
  './img/pyromane-attaque.png',
  './img/chasseur.png',
  './img/chasseur-dos.png',
  './img/chasseur-cote.png',
  './img/chasseur-attaque.png',
  './img/druide.png',
  './img/druide-dos.png',
  './img/druide-cote.png',
  './img/druide-attaque.png',
  './img/pretre.png',
  './img/pretre-dos.png',
  './img/pretre-cote.png',
  './img/pretre-attaque.png',
  './img/sorcier.png',
  './img/sorcier-dos.png',
  './img/sorcier-cote.png',
  './img/sorcier-attaque.png',
  './img/chaman.png',
  './img/chaman-dos.png',
  './img/chaman-cote.png',
  './img/chaman-attaque.png',
  './img/gardien.png',
  './img/gardien-dos.png',
  './img/gardien-cote.png',
  './img/gardien-attaque.png',
  './img/paladin.png',
  './img/paladin-dos.png',
  './img/paladin-cote.png',
  './img/paladin-attaque.png',
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
