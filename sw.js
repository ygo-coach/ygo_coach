const CACHE_NAME = "ygo-coach-v6-cloud";

const APP_FILES = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.json",
    "./config.js"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(APP_FILES);
        })
    );

    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            );
        })
    );

    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const clone = response.clone();

                caches.open(CACHE_NAME)
                    .then((cache) => {
                        cache.put(
                            event.request,
                            clone
                        );
                    });

                return response;
            })
            .catch(() => {
                return caches.match(
                    event.request
                );
            })
    );
});
