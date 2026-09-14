// Service worker for the STAFF, MANAGER, and DIRECTOR panels only.
// All three share this exact file — do not use this one for the guest
// panel, which has its own separate sw-guest.js.
//
// Why separate from guest: these three panels' push subscriptions and
// notification handling are kept fully isolated from guest push, even if
// all the panels end up served from the same origin. If director-panel,
// manager-panel, and staff-panel each live at their own path under the
// same origin (e.g. app.uyehhotel.com/director/, /manager/, /staff/),
// register this file from each with a scope covering that panel's own
// path — e.g. navigator.serviceWorker.register('/sw-staff.js', { scope: '/director/' })
// — so the three stay independent of each other's page lifecycle too,
// while still sharing one file to maintain.

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
    icon: "/staff-icon-192.png",   // adjust to wherever the staff/manager/director icon actually lives
    badge: "/staff-icon-192.png",
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