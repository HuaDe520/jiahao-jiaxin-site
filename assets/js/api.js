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
      if (tok) localStorage.setItem(TOKEN_KEY, tok);
      if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    } catch (e) { /* 忽略 */ }
  }

  function clearSession() {
    try {
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
    enter: function (name, code) {
      return call('POST', '/api/enter', { name: name, code: code, token: token() });
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
    token: token,
    user: user,
    saveSession: saveSession,
    clearSession: clearSession,
    serviceReady: serviceReady,
    reasons: ['骚扰或辱骂', '冒充他人', '发广告或刷屏', '泄露他人隐私', '其他'],
  };
})();
