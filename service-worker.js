/* ===========================================================================
   Sistem Pengurusan Alamanda — service-worker.js
   Membolehkan sistem dipasang sebagai PWA (Android/iOS/Windows/macOS) dan
   menyimpan "app shell" (HTML/CSS/JS/icons) dalam cache supaya aplikasi
   tetap boleh dibuka walaupun sambungan internet perlahan/terputus seketika.

   NOTA: Data sebenar (ahli, sesi, pinjaman dsb.) SENTIASA diambil terus
   daripada Google Apps Script (SCRIPT_URL) secara live — service worker ini
   TIDAK cache permintaan ke Apps Script, supaya data yang dipaparkan sentiasa
   terkini.
   =========================================================================== */

const CACHE_NAME = 'alamanda-cache-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Jangan sekali-kali cache panggilan ke Google Apps Script (data mesti live).
  if (url.hostname.indexOf('script.google.com') !== -1 ||
      url.hostname.indexOf('script.googleusercontent.com') !== -1) {
    return; // biarkan browser terus buat permintaan rangkaian seperti biasa
  }

  // Hanya tangani permintaan GET untuk aset app-shell (cache-first, fallback rangkaian)
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
