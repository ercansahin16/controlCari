// Yapılacaklar — /todo/ için ayrı service worker.
// Amaç: kök dizindeki LED Saha service worker'ının bu sayfanın isteklerini
// (özellikle Firebase bağlantısını) araya girip bozmasını engellemek.
// Bilerek "fetch" dinleyicisi YOK: tüm istekler doğrudan internete gider.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
