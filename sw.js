// Wise Decision service worker — lets the app open with no internet.
// Files are fetched from the network first (so you always get your latest deploy while
// online) and only fall back to the saved copy when the network is down or very slow.

const CACHE = 'wd-shell-v3';
const PRECACHE = [
    './app.html',
    './style.css',
    './script.js',
    './perf-patch.js',
    './bugfix-patch.js',
    './offline-patch.js',
    './features-patch.js',
    './superadmin-patch.js',
    './activation-patch.js',
    './superadmin-tools-patch.js',
    './pos-mode-patch.js',
    './storeplans-patch.js',
    './staff-sidebar-patch.js',
    './manager-preorder-patch.js',
    './extras-patch.js',
    './payments-patch.js',
    './auth-patch.js',
    './email-auth-patch.js',
    './phone-vendor-patch.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => Promise.all(PRECACHE.map(url => cache.add(url).catch(() => {}))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

async function networkFirst(request) {
    const cache = await caches.open(CACHE);
    try {
        const response = await Promise.race([
            fetch(request),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
        ]);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
    } catch (err) {
        const hit = await cache.match(request, { ignoreSearch: true });
        if (hit) return hit;
        if (request.mode === 'navigate' && new URL(request.url).pathname.endsWith('app.html')) {
            const shell = await cache.match('./app.html', { ignoreSearch: true });
            if (shell) return shell;
        }
        throw err;
    }
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const sameOrigin = url.origin === self.location.origin;
    const isFirebaseSdk = url.hostname === 'www.gstatic.com';
    if (!sameOrigin && !isFirebaseSdk) return;   // never touch database traffic

    if (isFirebaseSdk) {
        // Versioned library files never change — serve from cache, fetch once if missing
        event.respondWith(
            caches.match(request).then(hit => hit || fetch(request).then(response => {
                const copy = response.clone();
                caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
                return response;
            }))
        );
        return;
    }

    event.respondWith(networkFirst(request));
});
