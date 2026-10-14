/**
 * sw.js — AAHL service worker (makes the site installable as an app).
 *
 * Network first, always: every page/script/style request goes to the
 * network, so a new upload is live on the next load — nothing gets stuck
 * on an old version. The cache is only a fallback for when the phone is
 * offline. Only this site's own files are cached; Supabase / Apps Script /
 * NHL requests are left alone (data.js already caches data itself).
 *
 * Bump CACHE_VERSION if you ever need to wipe everyone's offline copy.
 */
const CACHE_VERSION = 'aahl-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const copy = fresh.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
      }
      return fresh;
    } catch (e) {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const home = await caches.match('/index.html') || await caches.match('/');
        if (home) return home;
      }
      throw e;
    }
  })());
});
