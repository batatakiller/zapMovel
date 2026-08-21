// Service Worker do ZapMóvel PWA — Cache, Offline e Web Push

const CACHE_NAME = "zapmovel-cache-v2";
const STATIC_ASSETS = ["/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch listener essencial para critérios de PWA instalável no Chrome / Android
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Não intercepta chamadas de banco, supabase, auth ou apis dinâmicas
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/db/")) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      return caches.match("/");
    })
  );
});

// Web Push Notifications
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: "ZapMóvel", body: event.data?.text() ?? "" };
  }
  const { title = "ZapMóvel", body = "", jid = "", instance = "", tag } = data;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: tag || jid || "zapmovel",
      renotify: true,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { jid, instance },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const jid = event.notification.data?.jid;
  const instance = event.notification.data?.instance;
  const url =
    jid && instance
      ? `/chat/${encodeURIComponent(instance)}/${encodeURIComponent(jid)}`
      : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
