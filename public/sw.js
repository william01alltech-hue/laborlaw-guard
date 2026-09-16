/**
 * 勞工守護神 PWA Service Worker
 * 快取策略：靜態 UI 資源極速快取，業務與廣告走強制網路
 */

const CACHE_NAME = 'labor-guard-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/index.css',
  '/app.js',
  '/engine/calculator.js',
  '/constants/labor_constants.json',
  '/manifest.json',
  '/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] 快取核心前端資產');
      return cache.addAll(ASSETS_TO_CACHE).catch(err => console.warn('部分快取失敗', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] 清理舊快取:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // 嚴格規則：僅 GET 請求與 HTTP/HTTPS 協議才進行快取查詢與寫入
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  // 對於主要導航和靜態檔案使用 Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // 背景非同步更新快取
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const resToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resToCache));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
