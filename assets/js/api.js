/* =========================================================
   账号系统 · 前端接口封装
   ---------------------------------------------------------
   登录凭证（token）存在本机浏览器里，请求时放在 Authorization 头。
   邀请码由用户在表单里填写，直接发给服务端校验 —— 前端不保存、
   也不判断邀请码，所以邀请码不会出现在网页代码里。
   ========================================================= */
(function () {
  'use strict';

  /* 部署 Cloudflare Worker 之后，把它的地址填在这里 */
  var PROD_API = 'https://jhjx-account-srebqdthiq.cn-hangzhou.fcapp.run';

  var TOKEN_KEY = 'jhjx-account-token';
  var USER_KEY = 'jhjx-account-user';
  /* 设备凭证：独立保存，退出登录不清掉。
     这样同一台设备可以随时用同一个昵称回来；换设备仍然需要管理员重置。 */
  var DEVICE_KEY = 'jhjx-account-device';

  function isLocal() {
    var h = location.hostname;
    return location.protocol === 'file:' || h === '127.0.0.1' || h === 'localhost' || h === '';
  }

  function base() { return isLocal() ? '' : PROD_API; }

  function serviceReady() { return isLocal() || !!PROD_API; }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function user() {
    try {
      var raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveSession(tok, u) {
    try {
      if (tok) {
        localStorage.setItem(TOKEN_KEY, tok);
        localStorage.setItem(DEVICE_KEY, tok);   /* 设备凭证一起记住 */
      }
      if (u) {
        /* 头像地址存成完整地址：有些页面没加载 api.js，也能直接拿来用 */
        var copy = {};
        for (var k in u) { if (Object.prototype.hasOwnProperty.call(u, k)) copy[k] = u[k]; }
        if (copy.avatar && copy.avatar.charAt(0) === '/') copy.avatar = base() + copy.avatar;
        localStorage.setItem(USER_KEY, JSON.stringify(copy));
      }
    } catch (e) { /* 忽略 */ }
  }

  function deviceToken() {
    try { return localStorage.getItem(DEVICE_KEY) || ''; } catch (e) { return ''; }
  }

  /* 退出登录：只清登录状态，保留设备凭证（否则同一台设备就回不来了） */
  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) { /* 忽略 */ }
  }

  /* 彻底忘掉这台设备（换人用这台设备时用） */
  function forgetDevice() {
    try {
      localStorage.removeItem(DEVICE_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) { /* 忽略 */ }
  }

  async function call(method, path, body) {
    if (!serviceReady()) {
      return { status: 0, data: { ok: false, error: '账号服务还没开通，先别急' } };
    }
    var headers = { 'Content-Type': 'application/json' };
    var tok = token();
    if (tok) headers.Authorization = 'Bearer ' + tok;
    try {
      var res = await fetch(base() + path, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      return { status: res.status, data: data || {} };
    } catch (e) {
      return { status: 0, data: { ok: false, error: '连不上服务器，检查一下网络' } };
    }
  }

  window.JHJX_API = {
    enter: function (name, code, password) {
      /* 带上设备凭证：同一台设备再进来时凭证不变，别的设备登录会把这里挤下线 */
      return call('POST', '/api/enter', {
        name: name,
        code: code,
        password: password,
        token: deviceToken() || token()
      });
    },
    changePassword: function (permCode, newPassword, oldPassword) {
      return call('POST', '/api/password', { permCode: permCode, newPassword: newPassword, oldPassword: oldPassword || '' });
    },
    /* 忘了密码：昵称 + 邀请码 + 修改权限码 → 重设并直接登录 */
    resetPassword: function (name, code, permCode, newPassword) {
      return call('POST', '/api/password/reset', { name: name, code: code, permCode: permCode, newPassword: newPassword });
    },
    me: function () { return call('GET', '/api/me'); },
    report: function (targetName, reason, detail) {
      return call('POST', '/api/report', { targetName: targetName, reason: reason, detail: detail });
    },
    adminSummary: function () { return call('GET', '/api/admin/summary'); },
    adminReports: function (status) { return call('GET', '/api/admin/reports?status=' + encodeURIComponent(status || 'open')); },
    adminReportAction: function (id, action, note) {
      return call('POST', '/api/admin/reports/' + id, { action: action, note: note || '' });
    },
    adminUsers: function () { return call('GET', '/api/admin/users'); },
    adminUserAction: function (id, action) {
      return call('POST', '/api/admin/users/' + id, { action: action });
    },

    /* ---- 好友与聊天 ---- */
    searchUsers: function (q) { return call('GET', '/api/search?q=' + encodeURIComponent(q)); },
    friends: function () { return call('GET', '/api/friends'); },
    friendRequest: function (targetId) { return call('POST', '/api/friends/request', { targetId: targetId }); },
    friendRespond: function (id, action) { return call('POST', '/api/friends/respond', { id: id, action: action }); },
    friendRemove: function (friendId) { return call('POST', '/api/friends/remove', { friendId: friendId }); },
    threads: function () { return call('GET', '/api/threads'); },
    thread: function (friendId, since) {
      return call('GET', '/api/messages/' + friendId + (since ? '?since=' + since : ''));
    },
    sendMessage: function (to, body) { return call('POST', '/api/messages', { to: to, body: body }); },

    /* ---- 头像 ---- */
    uploadAvatar: function (dataUrl) { return call('POST', '/api/avatar', { dataUrl: dataUrl }); },

    /* 把接口返回的相对路径（头像）拼成完整地址 */
    asset: function (path) {
      if (!path) return '';
      if (/^https?:\/\//.test(path)) return path;
      return base() + path;
    },

    token: token,
    deviceToken: deviceToken,
    user: user,
    saveSession: saveSession,
    clearSession: clearSession,
    forgetDevice: forgetDevice,
    serviceReady: serviceReady,
    reasons: ['骚扰或辱骂', '冒充他人', '发广告或刷屏', '泄露他人隐私', '其他'],
  };

  /* 本机缓存被清掉/写坏了、但凭证还在 → 自动把昵称资料取回来，
     免得页面上看起来「登录突然没了」。 */
  try {
    if (token() && (!user() || !user().name)) {
      call('GET', '/api/me').then(function (r) {
        if (r.status === 200 && r.data && r.data.user) saveSession(null, r.data.user);
      });
    }
  } catch (e) { /* 忽略 */ }
})();
