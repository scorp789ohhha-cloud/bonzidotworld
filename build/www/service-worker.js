var CACHE_NAME = 'bzw-cache-v1';
var STATIC_ASSETS = [
    '/',
    '/dist/css/style.css',
    '/dist/css/global.css',
    '/dist/css/extras.css',
    '/dist/js/core.min.js',
    '/dist/js/plugins.min.js',
    '/dist/js/finger.min.js',
    '/dist/js/angular.min.js',
    '/dist/js/bzw.min.js',
    '/dist/js/framework.min.js',
    '/dist/js/app.min.js',
    '/dist/js/extras.min.js',
    '/bzw-readme.html',
    '/bzw-changelog.html'
];

self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys.filter(function(k) { return k !== CACHE_NAME; })
                    .map(function(k) { return caches.delete(k); })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', function(event) {
    var url = event.request.url;

    // Never intercept socket.io, API calls, or non-GET requests
    if (event.request.method !== 'GET' ||
        url.indexOf('/socket.io') !== -1 ||
        url.indexOf('/api/') !== -1) {
        return;
    }

    // Network-first for HTML, cache-first for static assets
    if (url.indexOf('/dist/') !== -1 || url.indexOf('/font/') !== -1 || url.indexOf('/img/') !== -1) {
        event.respondWith(
            caches.match(event.request).then(function(cached) {
                if (cached) return cached;
                return fetch(event.request).then(function(response) {
                    if (response && response.status === 200) {
                        var clone = response.clone();
                        caches.open(CACHE_NAME).then(function(cache) {
                            cache.put(event.request, clone);
                        });
                    }
                    return response;
                });
            })
        );
    }
});
