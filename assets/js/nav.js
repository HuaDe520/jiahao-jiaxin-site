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
