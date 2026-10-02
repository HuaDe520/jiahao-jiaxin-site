/* =========================================================
   顶部导航下拉（手机上点右上角那个键展开菜单）
   每个页面都会加载这个文件；main.js 不再重复绑定，避免点一下开、再点一下关。
   ========================================================= */
(function () {
  'use strict';

  var toggle = document.getElementById('navToggle');
  var nav = document.getElementById('siteNav');
  if (!toggle || !nav) return;
  if (toggle.getAttribute('data-nav-ready') === '1') return;   /* 只绑一次 */
  toggle.setAttribute('data-nav-ready', '1');

  function setOpen(open) {
    toggle.setAttribute('aria-expanded', String(!!open));
    nav.classList.toggle('is-open', !!open);
  }

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  /* 点了菜单里的链接就收起来 */
  nav.addEventListener('click', function (e) {
    if (e.target && e.target.tagName === 'A') setOpen(false);
  });

  /* 点空白处 / 按 Esc 也收起来 */
  document.addEventListener('click', function (e) {
    if (!nav.classList.contains('is-open')) return;
    if (nav.contains(e.target) || e.target === toggle) return;
    setOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setOpen(false);
  });
})();

/* =========================================================
   登录后，导航里的「我的账号」换成「头像 + 昵称」
   —— 放在这里而不是 main.js，这样每个页面都生效
   ========================================================= */
(function () {
  'use strict';
  var link = document.querySelector('.site-nav a[href="account.html"]');
  if (!link) return;
  try {
    var raw = localStorage.getItem('jhjx-account-user');
    if (!raw) return;
    var u = JSON.parse(raw);
    if (!u || !u.name) return;

    link.textContent = '';
    link.title = '我的账号：' + u.name;
    if (u.avatar) {
      var img = document.createElement('img');
      img.className = 'site-nav__avatar';
      img.alt = '';
      img.width = 22;
      img.height = 22;
      img.decoding = 'async';
      img.src = u.avatar;
      img.onerror = function () { this.style.display = 'none'; };
      link.appendChild(img);
    }
    link.appendChild(document.createTextNode(u.name));
  } catch (e) { /* 忽略 */ }
})();

/* =========================================================
   角落里的常驻入口（嘉庭工作台 / 返回首页）：往下翻的时候先让开
   —— 它俩是固定定位的，一直显示就会压住正文里的字
   ========================================================= */
(function () {
  'use strict';
  var floats = document.querySelectorAll('.quick-workbench, .quick-home');
  if (!floats.length) return;

  var EDGE_TOP = 80;      /* 离页面顶部这么近，露出来 */
  var EDGE_BOTTOM = 140;  /* 离页面底部这么近，露出来 */
  var STEP = 10;          /* 手指动了这么多像素才算「在翻页」 */

  var last = window.scrollY || window.pageYOffset || 0;
  var hushed = false;

  /* 入场动画是 animation-fill-mode: both，动画结束后它的 opacity:1 会盖住
     .is-hushed 的 opacity —— 入场播完就把 animation 摘掉，让样式说了算 */
  for (var k = 0; k < floats.length; k++) {
    (function (el) {
      el.addEventListener('animationend', function () { el.style.animation = 'none'; });
    })(floats[k]);
  }

  function update() {
    var y = window.scrollY || window.pageYOffset || 0;
    var max = Math.max(0, (document.documentElement.scrollHeight || 0) - window.innerHeight);
    var next;
    if (y <= EDGE_TOP || y >= max - EDGE_BOTTOM) next = false;   /* 开头和结尾都露出来 */
    else if (y > last + STEP) next = true;                        /* 往下翻 → 让位给正文 */
    else if (y < last - STEP) next = false;                       /* 往上翻 → 该找入口了 */
    else return;
    last = y;
    if (next === hushed) return;
    hushed = next;
    for (var i = 0; i < floats.length; i++) {
      if (hushed) floats[i].style.animation = 'none';   /* 兜底：动画没播完也一样让开 */
      floats[i].classList.toggle('is-hushed', hushed);
    }
  }

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', function () { last = window.scrollY || window.pageYOffset || 0; }, { passive: true });
  update();
})();

/* ---------- 注册 Service Worker ----------
   以前这段在 main.js 里，只有首页会加载 main.js，从分享链接直接进
   friends / account / snake 这些页面的同学就永远装不上离线缓存。
   nav.js 每页都引，放这儿最稳。 */
(function () {
  if (!('serviceWorker' in navigator)) return;
  var host = location.hostname;
  var secure = location.protocol === 'https:' || host === '127.0.0.1' || host === 'localhost';
  if (!secure) return;
  window.addEventListener('load', function () {
    /* updateViaCache: 'none'：每次都去服务器核对 sw.js，别拿缓存里的旧版本 */
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(function (reg) { if (reg && reg.update) reg.update(); })
      .catch(function () { /* 注册失败不影响使用 */ });
  });
})();