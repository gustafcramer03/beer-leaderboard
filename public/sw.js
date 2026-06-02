// Minimal service worker — required for installability ("Add to Home Screen").
// Network-first; we deliberately avoid caching API/auth responses.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Pass through to the network. (No offline caching for this live app.)
});
