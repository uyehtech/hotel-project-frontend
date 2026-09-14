// Service worker for the GUEST panel only. Deliberately separate from
// sw-staff.js (used by staff, manager, and director) — guest push stays
// fully isolated from internal-user push, even on the same origin.
//
// Register this one only from guest-panel.html, e.g.:
//   navigator.serviceWorker.register('/sw-guest.js', { scope: '/guest/' })
// (adjust the scope path to wherever the guest panel actually lives).

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Fires when a push arrives from the server (web-push library on the
// backend). The payload is whatever notifyUser() sent as JSON:
// { title, body, url, data }.
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }

  const title = payload.title || "Notification";
  const options = {
    body: payload.body || "",
    icon: "/guest-icon-192.png",   // adjust to wherever the guest-facing icon actually lives
    badge: "/guest-icon-192.png",
    data: { url: payload.url || "/" },
    tag: payload.data?.tag || undefined, // same tag replaces an existing notification instead of stacking
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking the OS notification focuses an already-open tab on the right
// URL if one exists, otherwise opens a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && "focus" in client) return client.focus();
      }
      if (clientList.length > 0 && "focus" in clientList[0]) {
        clientList[0].navigate(targetUrl);
        return clientList[0].focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});