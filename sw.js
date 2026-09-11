const CACHE_NAME = "ygo-coach-v6-4";

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
    const requestUrl =
        new URL(event.request.url);

    if (
        requestUrl.origin !==
        self.location.origin
    ) {
        event.respondWith(
            fetch(event.request)
        );

        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const clone =
                    response.clone();

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
