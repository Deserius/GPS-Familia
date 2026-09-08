/* GPS-FAMILIA service worker — app shell + lock-screen notifications */
const CACHE = "gps-familia-v52";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/ui-community.js",
  "/ui-feed.js",
  "/ui-call.js",
  "/ui-market.js",
  "/ui-people.js",
  "/i18n.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/splash_last_supper_mobsters.png"
];
const IMMUTABLE = /\.(png|jpe?g|webp|gif|svg|ico|woff2)$/i;

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

  const cacheFirst = IMMUTABLE.test(url.pathname) || url.pathname.startsWith("/avatars/") || url.pathname.startsWith("/market-demo/");
  if (cacheFirst) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        });
      }).catch(() => caches.match("/index.html"))
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
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
    const ringing = data.kind === "sos" || data.kind === "call";
    if (focused && !ringing) return;
    const title = data.title || "GPS FAMILIA";
    const actions = data.kind === "call"
      ? [{ action: "answer", title: "Answer" }, { action: "decline", title: "Decline" }]
      : [];
    await self.registration.showNotification(title, {
      body: data.body || "New family message",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || (data.kind === "call" ? "call" : "familia"),
      renotify: true,
      vibrate: data.kind === "sos" ? [200, 80, 200, 80, 400] : data.kind === "call" ? [400, 160, 400, 160, 400, 160, 800] : [140, 70, 140],
      data: { url: data.url || "/", kind: data.kind || "", action: "" },
      requireInteraction: ringing,
      silent: false,
      actions
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

self.addEventListener("message", (event) => {
  const d = (event && event.data) || {};
  if (d.type === "track-on") {
    event.waitUntil(
      self.registration.showNotification("GPS FAMILIA tracking", {
        body: "Location history is recording. Turn Track Off in the app to stop.",
        tag: "gps-familia-track",
        silent: true,
        ongoing: true,
        requireInteraction: false,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url: "/" }
      }).catch(() => {})
    );
  }
  if (d.type === "track-off") {
    event.waitUntil(
      self.registration.getNotifications({ tag: "gps-familia-track" }).then((list) => {
        list.forEach((n) => n.close());
      }).catch(() => {})
    );
  }
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag !== "gps-familia-track") return;
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clientsList.forEach((c) => {
      try { c.postMessage({ type: "track-ping" }); } catch (e) {}
    });
  })());
});
