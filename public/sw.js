// Service worker do ZapMóvel — recebe Web Push e abre a conversa ao tocar

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: "ZapMóvel", body: event.data?.text() ?? "" };
  }
  const { title = "ZapMóvel", body = "", jid = "", tag } = data;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: tag || jid || "zapmovel",
      renotify: true,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { jid },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const jid = event.notification.data?.jid;
  const url = jid ? `/chat/${encodeURIComponent(jid)}` : "/";
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
