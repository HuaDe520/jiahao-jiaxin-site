/* 浙江嘉豪嘉欣协会官网 · Service Worker
 *
 * 作用：
 *   1. 让手机浏览器认为本站是一个「可安装的应用」（配合 manifest.webmanifest），
 *      从而支持「添加到主屏幕 / 安装应用」，点开后全屏打开、没有地址栏。
 *   2. 断网时也能打开已经看过的页面。
 *
 * 策略：网络优先（network-first），失败才用缓存 —— 这样线上更新永远立即可见，
 *      不会出现「改了网站但手机还看到旧版」的问题。
 *
 *      关键细节：fetch 时带 cache:'no-cache'，强制向服务器核对（命中 304 就复用），
 *      否则浏览器自己的 HTTP 缓存（GitHub Pages 是 10 分钟）会把旧文件递回来，
 *      于是「刚改完刷新还是老样子」。
 */

const CACHE = 'jhjx-site-v4';

// 安装时预缓存站点外壳（首屏必需文件）
const SHELL = [
  './',
  './index.html',
  './404.html',
  './manifest.webmanifest',
  './assets/css/style.css',
  './assets/js/main.js',
  './assets/img/logo-main.png',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
  './assets/img/apple-touch-icon.png',
  // 嘉窗·安慰盲盒：断网时也能抽
  './comfort.html',
  './assets/css/comfort.css',
  './assets/js/comfort.js',
  './assets/js/comfort-quotes.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只处理本站的 GET 请求
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        // 成功就把最新版本写回缓存（只缓存正常响应）
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(() =>
        /* ignoreSearch：页面引用带 ?v= 版本号时，仍能命中预缓存的原始文件 */
        caches.match(req, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached;
          // 页面导航失败时兜底到首页（离线也能打开）
          if (req.mode === 'navigate') return caches.match('./index.html', { ignoreSearch: true });
          return Response.error();
        })
      )
  );
});
