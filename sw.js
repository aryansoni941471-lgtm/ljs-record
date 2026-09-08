// LJS Jewellers - PWA Service Worker with Auto-Update Mechanism
const CACHE_NAME = 'ljs-portal-cache-v1';
const STATIC_ASSETS = [
    '/',
    '/portal.html',
    '/manifest.json',
    '/icon.svg',
    '/icon-192.png',
    '/icon-512.png'
];

// Install Event - Pre-cache essential static assets
self.addEventListener('install', (event) => {
    self.skipWaiting(); // Force active immediately on new deployments
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('[SW] Pre-caching warning:', err);
            });
        })
    );
});

// Activate Event - Clean up old version caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((name) => {
                    if (name !== CACHE_NAME) {
                        console.log('[SW] Clearing old cache:', name);
                        return caches.delete(name);
                    }
                })
            );
        }).then(() => self.clients.claim()) // Take control of open tabs immediately
    );
});

// Fetch Event - Dynamic routing
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. API Calls -> Always Network First (Live Supabase Data)
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request).catch(() => {
                return new Response(JSON.stringify({ error: 'Offline - No Internet Connection' }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }

    // 2. Static HTML/JS/CSS -> Network First with Cache Fallback (Ensures instant auto-updates)
    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) return cachedResponse;
                    if (event.request.mode === 'navigate') {
                        return caches.match('/portal.html');
                    }
                });
            })
    );
});

// Listen for update message from client
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});
