// ═══════════════════════════════════════════════════════════════
//   MoneyAI — Service Worker v1.0
//   Estrategia: Cache-first para assets, Network-first para API
// ═══════════════════════════════════════════════════════════════

var CACHE_NAME = 'moneyai-v1.0';
var OFFLINE_URL = 'index.html';

var ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

var FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com'
];

// ── INSTALL ─────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  console.log('[SW MoneyAI] Instalando v1.0...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW MoneyAI] Cacheando assets principales...');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ────────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  console.log('[SW MoneyAI] Activando...');
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) {
              console.log('[SW MoneyAI] Eliminando caché viejo:', key);
              return caches.delete(key);
            })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── FETCH ───────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // 1) Google Apps Script → Network-first, sin cachear
  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(
          JSON.stringify({ ok: false, msg: 'Sin conexión — los cambios se sincronizarán cuando vuelvas a tener red.' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // 2) Anthropic API → Network-first, sin cachear
  if (url.hostname === 'api.anthropic.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // 3) Fuentes de Google → Cache-first
  var isFontRequest = FONT_ORIGINS.some(function(origin) {
    return url.href.startsWith(origin);
  });
  if (isFontRequest) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          if (cached) return cached;
          return fetch(event.request).then(function(response) {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          });
        });
      })
    );
    return;
  }

  // 4) Todo lo demás → Cache-first con stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) {
        fetch(event.request).then(function(response) {
          if (response && response.status === 200 && response.type !== 'opaque') {
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, response.clone());
            });
          }
        }).catch(function() {});
        return cached;
      }

      return fetch(event.request).then(function(response) {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        var responseToCache = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, responseToCache);
        });
        return response;
      }).catch(function() {
        if (event.request.destination === 'document') {
          return caches.match(OFFLINE_URL);
        }
      });
    })
  );
});

// ── MENSAJES ────────────────────────────────────────────────────
self.addEventListener('message', function(event) {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

// ── BACKGROUND SYNC ─────────────────────────────────────────────
self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-moneyai') {
    console.log('[SW MoneyAI] Background sync: sincronizando datos...');
    event.waitUntil(
      self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ action: 'syncNow' });
        });
      })
    );
  }
});
