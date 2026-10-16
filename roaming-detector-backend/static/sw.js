/* ==========================================================================
   CampusTrack Service Worker
   - Same-origin pages/scripts/styles: NETWORK-FIRST (updates appear on the very next
     load) with cache fallback so the app still opens offline.
   - Other static GETs: stale-while-revalidate.
   - API calls, the face-verify endpoint, Firebase/Firestore and uploads are never cached.
   ========================================================================== */

const CACHE_NAME = 'campustrack-cache-v8-fast';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './css/styles.css',
  './js/config.js',
  './js/firebase-sync.js',
  './js/timetable.js',
  './js/incident.js',
  './js/face-ai.js',
  './js/camera.js',
  './js/admin.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Add each asset on its own so one missing file cannot abort the whole precache.
      Promise.allSettled(STATIC_ASSETS.map((asset) => cache.add(asset)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

function shouldBypass(request) {
  if (request.method !== 'GET') return true;
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith('/api/') || path.startsWith('/verify-face') || path === '/health') return true;
  if (path.startsWith('/static/evidence/')) return true;
  const host = url.hostname;
  const isFontHost = host === 'fonts.googleapis.com';
  return (
    host.includes('firestore') ||
    (host.endsWith('googleapis.com') && !isFontHost) ||
    host.endsWith('firebaseio.com') ||
    (host.endsWith('onrender.com') && url.origin !== self.location.origin)
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (shouldBypass(request)) return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    // Network-first so edits to HTML/JS/CSS are picked up immediately.
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // Cross-origin CDN scripts / fonts / model files: serve from cache, refresh in background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const refresh = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
