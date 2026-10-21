// Guarda o sistema no aparelho para abrir mesmo sem internet. Os dados do banco nunca vem do cache.
const CACHE = "majen-v28";
const SHELL = ["./", "index.html", "styles.css?v=28", "config.js?v=28", "offline.js?v=28", "app.js?v=28", "manifest.webmanifest", "icon.svg"];
const CDN = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  // Banco, mapas e outros servicos passam direto. So o proprio site e as bibliotecas fixas entram no cache.
  if (!sameOrigin && !CDN.includes(url.hostname)) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (!sameOrigin && cached) return cached;
      try {
        const response = await fetch(request);
        if (response && (response.ok || response.type === "opaque")) cache.put(request, response.clone());
        return response;
      } catch (error) {
        return cached || (await cache.match(request, { ignoreSearch: true })) || Response.error();
      }
    })
  );
});
