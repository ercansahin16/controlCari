// sw.js — LED Saha service worker
// ONEMLI: index.html/app.js/firebase-core.js icin NETWORK-FIRST kullaniyoruz.
// Yani bu dosyalar her acilista once internetten cekilmeye calisilir; ancak
// internet yoksa (offline) en son basariyla cekilen surum onbellekten gosterilir.
// Boylece "eski app.js takili kaldi" gibi sorunlar yasanmaz -- internet varken
// her zaman en guncel kod calisir, sadece cevrimdisiyken onbellek devreye girer.

// ---- Push bildirimleri (Firebase Cloud Messaging) ----
// Uygulama kapaliyken/telefon kilitliyken de bildirim gosterebilmek icin
// service worker'in kendisi Firebase Messaging'i baglamak zorunda.
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCloL8IN0NpHQBxFjaRH_62vOEWjLQjr4o",
  authDomain: "duapro-a7d7e.firebaseapp.com",
  projectId: "duapro-a7d7e",
  storageBucket: "duapro-a7d7e.appspot.com",
  messagingSenderId: "450775848659",
  appId: "1:450775848659:web:ca192a401da3f887e1e626"
});

var messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  var title = (payload.notification && payload.notification.title) || "LED Saha";
  var body = (payload.notification && payload.notification.body) || "";
  self.registration.showNotification(title, {
    body: body,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png"
  });
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if ("focus" in clientList[i]) return clientList[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./index.html");
    })
  );
});

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
