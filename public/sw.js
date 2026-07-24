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
