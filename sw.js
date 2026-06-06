/* ==========================================================================
   TulparMaps Service Worker - Offline Caching Strategy
   ========================================================================== */
const CACHE_VERSION = 'tulparmaps-v7';

// Install: activate this worker immediately. Runtime caching below avoids
// hard-coded asset names that differ between source and Vite builds.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

// Activate: purge old cache versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_VERSION)
            .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: strategy per resource type.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Strategy 1: network-first for app shell data and bundles so deployments
  // do not pair new HTML with stale CSS/JS from a previous service worker.
  if (url.pathname.endsWith('/maps.json')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Strategy 2: cache-first for thumbnails and logos.
  if (url.pathname.includes('/maps/webp/') ||
      (url.pathname.endsWith('.png') && url.pathname.includes('logo'))) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Strategy 3: network-first for high-res map images.
  if (url.pathname.includes('/maps/') && !url.pathname.includes('/webp/')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Default: network with cache fallback.
  event.respondWith(networkFirst(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => cached);

  return cached || fetchPromise;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}
