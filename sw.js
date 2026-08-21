/* tally service worker

   Two caches:
     SHELL_CACHE — our own files. Served cache-first so the app paints
                   immediately, then quietly refreshed in the background.
     CDN_CACHE   — preact, htm and the web fonts. These never change for a
                   given URL (they are version-pinned), so cache-first forever.

   Bump VERSION after editing index.html or app.js, or the phone will keep
   serving the old copy.  tally-v6 -> tally-v7
*/

const VERSION = "tally-v7";
const SHELL_CACHE = VERSION + "-shell";
const CDN_CACHE = VERSION + "-cdn";

const SHELL = [
  "/",
  "/index.html",
  "/app.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
];

/* Warmed at install so the very first offline launch works too. esm.sh
   redirects these to a hashed inner file; the runtime handler catches that
   second hop on the first real load. */
const CDN_WARM = [
  "https://esm.sh/preact@10.24.3",
  "https://esm.sh/preact@10.24.3/hooks",
  "https://esm.sh/htm@3.1.1",
];

const isCDN = (url) =>
  url.origin === "https://esm.sh" ||
  url.origin === "https://fonts.googleapis.com" ||
  url.origin === "https://fonts.gstatic.com";

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await shell.addAll(SHELL);
      const cdn = await caches.open(CDN_CACHE);
      // Best effort — a CDN hiccup must not block the install.
      await Promise.allSettled(CDN_WARM.map((u) => cdn.add(u)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== CDN_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);

  // Estimates must always hit the network.
  if (url.pathname.startsWith("/api/")) return;

  // Version-pinned CDN assets: cache-first, no revalidation.
  if (isCDN(url)) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            if (res.ok || res.type === "opaque") {
              const copy = res.clone();
              caches.open(CDN_CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
            }
            return res;
          })
      )
    );
    return;
  }

  if (url.origin !== location.origin) return;

  /* Our own files: stale-while-revalidate. Paint from cache straight away,
     fetch a fresh copy in the background for next launch. */
  e.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(e.request);

      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);

      if (hit) return hit;

      const fresh = await network;
      if (fresh) return fresh;

      return (
        (await cache.match("/index.html")) ||
        new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
      );
    })()
  );
});
