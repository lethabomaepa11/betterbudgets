// Bump this version when changing offline.html so installed apps refresh it.
const CACHE_NAME = "bts-pwa-offline-v3";
const OFFLINE_URL = "/offline.html";

// Static assets to cache on install (app shell)
const STATIC_ASSETS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/favicon/favicon.svg",
  "/favicon/favicon-96x96.png",
  "/favicon/apple-touch-icon.png",
  "/sqlite3.wasm",
  "/logo.png",
  "/logo-mark.png",
];

// Runtime cache for API responses and other dynamic content
const RUNTIME_CACHE = "bts-pwa-runtime-v1";
const MAX_RUNTIME_ENTRIES = 100;
const MAX_RUNTIME_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// API routes that can be cached for offline reads
const CACHEABLE_API_ROUTES = [
  "/api/auth/session",
  "/api/sync/pull",
];

// API routes that should be queued for background sync when offline
const SYNCABLE_API_ROUTES = [
  "/api/sync/push",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(
        STATIC_ASSETS.map((url) => new Request(url, { cache: "reload" }))
      );
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((key) => key.startsWith("bts-pwa-") && key !== CACHE_NAME && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })
  );
});

// Clean up old runtime cache entries
async function cleanupRuntimeCache() {
  const cache = await caches.open(RUNTIME_CACHE);
  const keys = await cache.keys();
  if (keys.length > MAX_RUNTIME_ENTRIES) {
    const now = Date.now();
    const entries = await Promise.all(
      keys.map(async (request) => {
        const response = await cache.match(request);
        const dateHeader = response?.headers.get("sw-cache-date");
        return { request, date: dateHeader ? Number(dateHeader) : 0 };
      })
    );
    entries.sort((a, b) => a.date - b.date);
    const toDelete = entries.slice(0, keys.length - MAX_RUNTIME_ENTRIES);
    await Promise.all(toDelete.map((e) => cache.delete(e.request)));
  }
  const allKeys = await cache.keys();
  await Promise.all(
    allKeys
      .filter((request) => {
        const response = await cache.match(request);
        const dateHeader = response?.headers.get("sw-cache-date");
        return dateHeader && Date.now() - Number(dateHeader) > MAX_RUNTIME_AGE;
      })
      .map((request) => cache.delete(request))
  );
}
nself.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== "GET") {
    // For mutating requests, queue for background sync if offline
    if (SYNCABLE_API_ROUTES.some((route) => url.pathname.startsWith(route))) {
      event.respondWith(queueForSync(request));
    }
    return;
  }
n  // Skip non-HTTP(S) requestsn  if (!url.protocol.startsWith("http")) return;
n  // Handle navigation requests (HTML pages)n  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(OFFLINE_URL)) ?? Response.error();
      })
    );
    return;
  }
n  // Handle API requestsn  if (url.pathname.startsWith("/api/")) {
    const isCacheable = CACHEABLE_API_ROUTES.some((route) => url.pathname.startsWith(route));
n    if (isCacheable) {
      // Cache-first for read APIsn      event.respondWith(cacheFirstStrategy(request));
      return;
    }
n    // Network-first for other APIsn    event.respondWith(networkFirstStrategy(request));
    return;
  }
n  // Handle static assets (JS, CSS, images, fonts, WASM)n  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }
n  // Default: network-first for everything elsen  event.respondWith(networkFirstStrategy(request));
});
n// Cache-first strategy: try cache, then networknasync function cacheFirstStrategy(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
n  if (cached) {
    // Return cached response and update in backgroundn    fetchAndCache(request, cache).catch(() => {});
    return cached;
  }
n  // Not in cache, fetch and cachen  return fetchAndCache(request, cache);
}
n// Network-first strategy: try network, fall back to cachenasync function networkFirstStrategy(request) {
  const cache = await caches.open(RUNTIME_CACHE);
n  try {
    const response = await fetch(request);
    if (response.ok) {
      await putInCache(cache, request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    // For API requests, return a meaningful errorn    if (request.url.includes("/api/")) {
      return new Response(
        JSON.stringify({ error: "Offline", message: "This feature requires an internet connection." }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("Offline", { status: 503 });
  }
}
nasync function fetchAndCache(request, cache) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      await putInCache(cache, request, response.clone());
    }
    return response;
  } catch (error) {
    throw error;
  }
}
nasync function putInCache(cache, request, response) {
  // Clone response to add cache timestamp headern  const headers = new Headers(response.headers);
  headers.set("sw-cache-date", Date.now().toString());
n  const cachedResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
n  await cache.put(request, cachedResponse);
  await cleanupRuntimeCache();
}
nfunction isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/_next/data/") ||
    pathname.match(/\.(js|css|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|wasm)$/i)
  );
}
n// Queue mutating requests for background syncnasync function queueForSync(request) {
  try {
    // Try network firstn    const response = await fetch(request);
    return response;
  } catch (error) {
    // If offline, queue the request for latern    const cache = await caches.open("bts-pwa-sync-queue");
    const body = await request.clone().text();
    const syncRequest = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
      timestamp: Date.now(),
    };
    await cache.put(request.url + ":" + Date.now(), new Response(JSON.stringify(syncRequest)));
    return new Response(
      JSON.stringify({ queued: true, message: "Request queued for sync when online." }),
      { status: 202, headers: { "Content-Type": "application/json" } }
    );
  }
}
n// Background sync handlernself.addEventListener("sync", (event) => {
  if (event.tag === "sync-outbox") {
    event.waitUntil(processSyncQueue());
  }
});
nasync function processSyncQueue() {
  const cache = await caches.open("bts-pwa-sync-queue");
  const keys = await cache.keys();
n  for (const request of keys) {
    try {
      const syncRequest = await cache.match(request).then((r) => r.json());
      const response = await fetch(syncRequest.url, {
        method: syncRequest.method,
        headers: syncRequest.headers,
        body: syncRequest.body,
        credentials: "include",
      });
      if (response.ok) {
        await cache.delete(request);
      }
    } catch (error) {
      console.error("[SW] Sync failed for:", request.url, error);
      // Keep in queue for next sync attemptn    }
  }
n  // Notify clients that sync completedn  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: "sync-complete" });
  });
}
n// Listen for messages from the main threadnself.addEventListener("message", (event) => {
  if (event.data?.type === "trigger-sync") {
    event.waitUntil(processSyncQueue());
  }
});
