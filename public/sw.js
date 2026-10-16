// Retires the service worker the previous (Express) version of this app
// registered. Browsers that still have it would otherwise keep serving the old
// cached interface. On activation: delete every cache, unregister, and reload
// open tabs onto the live app. The new app registers no service worker.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.map(k => caches.delete(k)))
    await self.registration.unregister()
    const clients = await self.clients.matchAll({ type: 'window' })
    clients.forEach(c => c.navigate(c.url))
  })())
})
