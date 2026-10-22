// Wise Decision service worker — lets the app open with no internet.
// Files are fetched from the network first (so you always get your latest deploy while
// online) and only fall back to the saved copy when the network is down or very slow.

const CACHE = 'wd-shell-v89';
const PRECACHE = [
    './app.html',
    './verify.html',
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
    './manager-role-patch.js',
    './extras-patch.js',
    './payments-patch.js',
    './auth-patch.js',
    './email-auth-patch.js',
    './phone-vendor-patch.js',
    './phone-sale-patch.js',
    './materials-patch.js',
    './materials-polish-patch.js',
    './phone-extras-patch.js',
    './fashion-patch.js',
    './fashion-layaway-patch.js',
    './fashion-reserve-patch.js',
    './fashion-categories-patch.js',
    './fashion-barcode-patch.js',
    './store-logo-patch.js',
    './receipt-qr-patch.js',
    './superadmin-qr-toggle-patch.js',
    './login-analytics-patch.js',
    './auto-lock-patch.js',
    './impersonate-store-patch.js',
    './demo-dashboard-patch.js',
    './vertical-first-patch.js',
    'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js',
    'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js',
    'https://unpkg.com/qrcode-generator@1.4.4/qrcode.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'
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
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
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
    const isJsBarcodeCdn = url.hostname === 'cdn.jsdelivr.net' || 
                            url.hostname === 'unpkg.com' || 
                            url.hostname === 'cdnjs.cloudflare.com';   // barcode & QR libraries
    if (!sameOrigin && !isFirebaseSdk && !isJsBarcodeCdn) return;   // never touch database traffic

    if (isFirebaseSdk || isJsBarcodeCdn) {
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
