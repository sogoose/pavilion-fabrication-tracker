/* LAMA Slicer website: serves the export files of this browser session (/lama-slicer/download?path=...).
   The app itself (/lama-slicer/app/) is plain files on the website since 1.6; old cached copies are removed. */
const CACHE = 'lama-slicer-downloads-v16';
const root = new URL('./', self.location.href);
const download = new URL('download', root).pathname;
self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('lama-slicer-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || u.pathname !== download) return;
  e.respondWith((async () => (await (await caches.open(CACHE)).match(e.request.url))
    || new Response('This export file is no longer in this browser session. Export again.', { status: 404 }))());
});
