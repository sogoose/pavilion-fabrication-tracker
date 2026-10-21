/* Only handles /lama-slicer/app/ and /lama-slicer/download.
   The existing Fabrication Tracker remains outside this service-worker scope. */
const CACHE = 'lama-slicer-assets-v4';
const root = new URL('./', self.location.href);
const app = new URL('app/', root).pathname;
const download = new URL('download', root).pathname;
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async()=>{ for(const k of await caches.keys()) if(k.startsWith('lama-slicer-assets-')&&k!==CACHE) await caches.delete(k); await self.clients.claim(); })()));
self.addEventListener('fetch', event => {
  const u = new URL(event.request.url);
  if (u.origin !== self.location.origin) return;
  if (u.pathname === download) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return await cache.match(event.request.url)
        || new Response('Export file is no longer in this browser session.', {status:404});
    })());
    return;
  }
  if (!u.pathname.startsWith(app)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const target = u.pathname === app ? new URL('app/index.html', root).href : u.origin + u.pathname;
    const result = await cache.match(target);
    return result || Response.redirect(root.href, 302);
  })());
});
