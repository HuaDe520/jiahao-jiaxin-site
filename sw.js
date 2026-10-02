/* 浙江嘉豪嘉欣协会官网 · Service Worker
 *
 * 作用（按重要性排序）：
 *   1. 让手机浏览器认为本站是一个「可安装的应用」（配合 manifest.webmanifest），
 *      从主屏幕打开时全屏、没有地址栏。
 *   2. 静态资源走缓存优先：第二次打开几乎是瞬间出来，不用再等国内到 GitHub 的这一趟网络。
 *   3. 断网 / 网络超时时也打得开：先给缓存里的页面，再不行给一个「网络不太好」的兜底页。
 *
 * 策略说明（为什么这么选）：
 *   · 页面（HTML）：先用网络，但最多等 3.5 秒；等不到就用缓存里的页面，
 *     这样「网络抽风」时不会一直转圈转到天荒地老。
 *   · 样式 / 脚本 / 图片：缓存优先（这些文件名带 ?v= 版本号，内容变了地址就变，
 *     不存在拿到旧文件的问题），同时在后台把新版本取回来，下次打开就是新的。
 *   · 后端接口（另一个域名）不拦，直接放行。
 */

const CACHE = 'jhjx-site-v202610020716';

/* 首屏必需的东西，装完 SW 就悄悄缓存好；注意别放 512 图标这类大文件 */
const SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './assets/css/style.css',
  './assets/js/main.js',
  './assets/img/logo-main.png'
];

const NAV_TIMEOUT = 3500;   /* 页面最多等网络 3.5 秒 */

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

/* 静态资源：缓存优先 + 后台更新
   —— 精确按地址匹配（页面里的地址带 ?v= 版本号，内容一变地址就变，不会拿到旧文件）；
      真的匹配不到（比如离线时遇到新版本号）才放宽到忽略查询串兜底。 */
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) {
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          cache.put(req, res.clone()).catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return hit;
  }
  try {
    const res = await fetch(req);
    if (res && res.status === 200 && res.type === 'basic') {
      cache.put(req, res.clone()).catch(() => undefined);
    }
    return res;
  } catch (e) {
    const loose = await cache.match(req, { ignoreSearch: true });
    return loose || Response.error();
  }
}

/* 页面导航
   - 这一页在缓存里：最多等网络 NAV_TIMEOUT，超了先把缓存里的给出去（打开更快）
   - 这一页不在缓存里：老老实实等网络。提前切「兜底页」没有好处 ——
     网络只是慢一点（国内到 GitHub 经常 3~9 秒），用户会以为网站坏了
   - 网络真的失败：首页兜到 index.html，别的页面给「网络好像不太行」的兜底页 */
async function navigationFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });

  const network = fetch(req).then((res) => {
    if (res && res.status === 200 && res.type === 'basic') {
      cache.put(req, res.clone()).catch(() => undefined);
    }
    return res;
  });

  if (!cached) {
    const fresh = await network.catch(() => null);
    if (fresh) return fresh;
    let path = '/';
    try { path = new URL(req.url).pathname; } catch (e) { path = '/'; }
    if (/^\/(index\.html)?$/.test(path)) {
      const home = await cache.match('./index.html', { ignoreSearch: true });
      if (home) return home;
    }
    return (await cache.match('./offline.html', { ignoreSearch: true })) || Response.error();
  }

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT));
  const res = await Promise.race([network.catch(() => null), timeout]);
  return res || cached;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;   /* 接口在别的域名，不拦 */

  if (req.mode === 'navigate') {
    event.respondWith(navigationFirst(req));
    return;
  }

  if (/\.(?:css|js|png|jpe?g|webp|svg|ico|woff2?|json|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  /* 其它同源请求：照旧先网络，失败再缓存 */
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => undefined);
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((c) => c || Response.error()))
  );
});
