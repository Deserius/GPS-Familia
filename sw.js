/* GPS-FAMILIA service worker — app shell + lock-screen notifications */
const CACHE = "gps-familia-v27";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/ui-community.js",
  "/ui-feed.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/brand-godfather.png",
  "/brand-wordmark.png",
  "/splash_last_supper_mobsters.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api") || url.pathname === "/ws" || url.pathname.startsWith("/uploads/")) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/index.html")))
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    try { data = { body: event.data.text() }; } catch (e2) { data = {}; }
  }
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const focused = clientsList.some((c) => c.focused);
    clientsList.forEach((c) => {
      try { c.postMessage({ type: "push", data }); } catch (e) {}
    });
    if (focused && data.kind !== "sos") return;
    const title = data.title || "GPS FAMILIA";
    await self.registration.showNotification(title, {
      body: data.body || "New family message",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "familia",
      renotify: true,
      vibrate: data.kind === "sos" ? [200, 80, 200, 80, 400] : [140, 70, 140],
      data: { url: data.url || "/" },
      requireInteraction: data.kind === "sos",
      silent: false
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      try {
        c.postMessage({ type: "open", url });
        if ("focus" in c) return c.focus();
      } catch (e) {}
    }
    return self.clients.openWindow(url);
  })());
});
