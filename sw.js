// sw.js — LED Saha service worker
// ONEMLI: index.html/app.js/firebase-core.js icin NETWORK-FIRST kullaniyoruz.
// Yani bu dosyalar her acilista once internetten cekilmeye calisilir; ancak
// internet yoksa (offline) en son basariyla cekilen surum onbellekten gosterilir.
// Boylece "eski app.js takili kaldi" gibi sorunlar yasanmaz -- internet varken
// her zaman en guncel kod calisir, sadece cevrimdisiyken onbellek devreye girer.

const CACHE_NAME = "led-saha-v1";
const PRECACHE_ASSETS = [
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./manifest.json"
];

self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var isAppFile = req.mode === "navigate" ||
    req.destination === "script" ||
    req.destination === "style" ||
    req.destination === "document";

  if (isAppFile) {
    // Network-first: once internetten dene, basarili olursa onbellegi guncelle.
    event.respondWith(
      fetch(req).then(function (res) {
        var resClone = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, resClone); });
        return res;
      }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

  // Diger statik dosyalar (ikonlar vb.) icin: once onbellek, yoksa ag.
  event.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req);
    })
  );
});
