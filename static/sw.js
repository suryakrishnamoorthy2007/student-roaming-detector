/* ==========================================================================
   CampusTrack Service Worker - Cache-First Strategy for Static Assets
   ========================================================================== */

const CACHE_NAME = 'campustrack-cache-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './campustrack.html',
  './campus%20track.html',
  './manifest.json',
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
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only cache GET requests, skip external API calls or firestore
  if (event.request.method !== 'GET' || event.request.url.includes('firestore') || event.request.url.includes(':8000') || event.request.url.includes('onrender.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch new version in background (Stale-While-Revalidate)
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
