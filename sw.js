// CaesarBase PWA Service Worker
const CACHE_NAME = 'caesarbase-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/welcome.html',
  '/admin.html',
  '/sponsor.html',
  '/manifest.json',
  '/cr/index.html',
  '/cr/tools.html',
  '/cr/topics.html',
  '/cr/all-articles.html',
  '/cr/articles.html',
  '/cr/paint.html',
  '/cr/pomodoro.html',
  '/cr/wall.html',
  '/cr/share.html'
];

// 安装时缓存核心资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 激活时清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 请求时：缓存优先，网络回退
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(res => {
        const copy = res.clone();
        if (res.ok) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
        }
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
