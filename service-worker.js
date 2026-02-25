/* Tennis Scoreboard Service Worker (v22.24.28) */
const CACHE_NAME = "tennis-scoreboard-v22.24.28";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./service-worker.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(()=>{})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

// Network-first for HTML/JS to avoid stale-mismatch bugs; cache-first for others.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  const isSameOrigin = url.origin === self.location.origin;
  const pathname = url.pathname;

  const isHTML = req.mode === "navigate" || pathname.endsWith("/") || pathname.endsWith("/index.html") || pathname.endsWith("index.html");
  const isJS   = pathname.endsWith(".js");

  if(!isSameOrigin) return; // ignore

  if(isHTML || isJS){
    event.respondWith((async ()=>{
      try{
        const fresh = await fetch(req, {cache: "no-store"});
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(()=>{});
        return fresh;
      }catch(_e){
        const cached = await caches.match(req);
        return cached || caches.match("./index.html");
      }
    })());
    return;
  }

  event.respondWith((async ()=>{
    const cached = await caches.match(req);
    if(cached) return cached;
    try{
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone()).catch(()=>{});
      return fresh;
    }catch(_e){
      return cached || Response.error();
    }
  })());
});
