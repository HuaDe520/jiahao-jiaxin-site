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

  /* ---------------- 聊天里的图片 / 语音 / 文件 ----------------
     媒体不走 JSON 接口：上传要发原始二进制，下载要带 Authorization 头拿回二进制。
     这两个函数自己用 fetch，但返回值仍然和 call() 一样是 { status, data }。 */

  /* 已经取回来的媒体：key → 本地 blob 地址，免得同一张图反复下载 */
  var mediaUrls = {};
  var mediaKeys = [];
  var MEDIA_CACHE_MAX = 60;

  /* 群头像单独一份缓存（键是接口地址，地址里带版本号，换了头像自然就重新取） */
  var groupAvatars = {};
  var groupAvatarKeys = [];
  var GROUP_AVATAR_MAX = 24;

  function mediaAbort(ms) {
    try { return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined; }
    catch (e) { return undefined; }
  }

  function dropMediaUrl(key) {
    var url = mediaUrls[key];
    if (!url) return;
    delete mediaUrls[key];
    try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
  }

  /* 只把二进制取回来，调用方自己决定是播还是下载 */
  async function mediaBlob(key) {
    if (!key) return null;
    try {
      var res = await fetch(base() + '/api/media?key=' + encodeURIComponent(key), {
        headers: token() ? { Authorization: 'Bearer ' + token() } : {},
        signal: mediaAbort(60000),
      });
      if (!res.ok) return null;
      return await res.blob();
    } catch (e) { return null; }
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
      /* 带上设备凭证：同一台设备再进来时凭证不变，别的设备登录会把这里挤下线。
         邀请码输入框显示的是大写，用户敲小写也照样算对，所以这里统一转大写。 */
      return call('POST', '/api/enter', {
        name: name,
        code: String(code == null ? '' : code).trim().toUpperCase(),
        password: password,
        token: deviceToken() || token()
      });
    },
    changePassword: function (permCode, newPassword, oldPassword) {
      return call('POST', '/api/password', {
        permCode: String(permCode == null ? '' : permCode).trim().toUpperCase(),
        newPassword: newPassword,
        oldPassword: oldPassword || ''
      });
    },
    /* 忘了密码：昵称 + 邀请码 + 修改权限码 → 重设并直接登录 */
    resetPassword: function (name, code, permCode, newPassword) {
      return call('POST', '/api/password/reset', {
        name: name,
        code: String(code == null ? '' : code).trim().toUpperCase(),
        permCode: String(permCode == null ? '' : permCode).trim().toUpperCase(),
        newPassword: newPassword
      });
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
    adminUsers: function (q) {
      return call('GET', '/api/admin/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
    },
    /* 管理员看某个成员的完整情况（资料 + 活动） */
    adminUser: function (id) { return call('GET', '/api/admin/users/' + encodeURIComponent(id)); },
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
    /* 1:1 发消息：可以直接给一段文字（老写法），也可以给
       { body, kind:'text'|'image'|'voice'|'file', media:{key,name,size,mime} } */
    sendMessage: function (to, payload) {
      var p = payload;
      if (typeof p === 'string' || p == null) p = { body: p, kind: 'text' };
      return call('POST', '/api/messages', {
        to: to,
        body: p.body == null ? '' : p.body,
        kind: p.kind || 'text',
        media: p.media || null
      });
    },

    /* ---- 群聊 ---- */
    groups: function () { return call('GET', '/api/groups'); },
    createGroup: function (name, memberIds) {
      return call('POST', '/api/groups', { name: name, memberIds: memberIds || [] });
    },
    group: function (id) { return call('GET', '/api/groups/' + encodeURIComponent(id)); },
    groupInvite: function (id, memberIds) {
      return call('POST', '/api/groups/' + encodeURIComponent(id) + '/members', { memberIds: memberIds || [] });
    },
    groupLeave: function (id) { return call('POST', '/api/groups/' + encodeURIComponent(id) + '/leave'); },
    groupRename: function (id, name) {
      return call('POST', '/api/groups/' + encodeURIComponent(id) + '/rename', { name: name });
    },
    groupMessages: function (id, since) {
      return call('GET', '/api/groups/' + encodeURIComponent(id) + '/messages' + (since ? '?since=' + since : ''));
    },
    sendGroupMessage: function (id, payload) {
      var p = payload;
      if (typeof p === 'string' || p == null) p = { body: p, kind: 'text' };
      return call('POST', '/api/groups/' + encodeURIComponent(id) + '/messages', {
        body: p.body == null ? '' : p.body,
        kind: p.kind || 'text',
        media: p.media || null
      });
    },
    /* 按群号搜群：格式不对、搜不到都由服务端给中文提示，前端照原样显示 */
    groupSearch: function (number) {
      return call('GET', '/api/groups/search?number=' + encodeURIComponent(number == null ? '' : number));
    },
    groupJoin: function (id) { return call('POST', '/api/groups/' + encodeURIComponent(id) + '/join'); },
    /* 群设置：只把真要改的字段发出去，没传的字段服务端不动 */
    groupSettings: function (id, patch) {
      var p = patch || {};
      var body = {};
      if (p.name != null) body.name = p.name;
      if (p.notice != null) body.notice = p.notice;
      if (p.avatar != null) body.avatar = p.avatar;
      if (p.joinMode != null) body.joinMode = p.joinMode;
      if (p.mutedAll != null) body.mutedAll = !!p.mutedAll;
      return call('POST', '/api/groups/' + encodeURIComponent(id) + '/settings', body);
    },
    groupTransfer: function (id, targetId) {
      return call('POST', '/api/groups/' + encodeURIComponent(id) + '/transfer', { targetId: targetId });
    },
    /* action: 'add' 设为管理员 / 'remove' 取消管理员（只有群主能调） */
    groupAdmins: function (id, userId, action) {
      return call('POST', '/api/groups/' + encodeURIComponent(id) + '/admins', {
        userId: userId,
        action: action || 'add'
      });
    },
    /* 群昵称只能改自己的：接口不收别人的 userId，前端也不该有那个入口 */
    groupNickname: function (id, nickname) {
      return call('POST', '/api/groups/' + encodeURIComponent(id) + '/nickname', { nickname: nickname });
    },
    groupFiles: function (id) { return call('GET', '/api/groups/' + encodeURIComponent(id) + '/files'); },
    groupRequests: function (id) { return call('GET', '/api/groups/' + encodeURIComponent(id) + '/requests'); },
    groupResolveRequest: function (id, requestId, action) {
      return call('POST', '/api/groups/' + encodeURIComponent(id) + '/requests', {
        id: requestId,
        action: action || 'accept'
      });
    },
    /* 群消息撤回：自己的 2 分钟内；群主 / 管理员撤群成员的没有时间限制 */
    groupRecall: function (id, messageId) {
      return call('POST', '/api/groups/' + encodeURIComponent(id) + '/messages/' + encodeURIComponent(messageId) + '/recall');
    },

    /* ---- 上传 / 下载聊天里的图片、语音、文件（走二进制，不走 JSON） ---- */
    uploadMedia: function (kind, blob, name) {
      if (!serviceReady()) {
        return Promise.resolve({ status: 0, data: { ok: false, error: '账号服务还没开通，先别急' } });
      }
      var q = '/api/upload?kind=' + encodeURIComponent(kind || 'file')
            + '&name=' + encodeURIComponent(name || '');
      var headers = { 'Content-Type': 'application/octet-stream' };
      var tok = token();
      if (tok) headers.Authorization = 'Bearer ' + tok;
      return fetch(base() + q, { method: 'POST', headers: headers, body: blob, signal: mediaAbort(60000) })
        .then(function (res) {
          return res.json().catch(function () { return null; }).then(function (data) {
            return { status: res.status, data: data || {} };
          });
        })
        .catch(function () {
          return { status: 0, data: { ok: false, error: '连不上服务器，检查一下网络' } };
        });
    },

    /* 把媒体取回来变成一个本地 blob 地址（带 token，所以 <img src> 直接用接口地址是不行的） */
    mediaObjectUrl: function (key) {
      if (!key) return Promise.resolve('');
      if (mediaUrls[key]) return Promise.resolve(mediaUrls[key]);
      return mediaBlob(key).then(function (blob) {
        if (!blob) return '';
        if (mediaUrls[key]) return mediaUrls[key];
        var url = '';
        try { url = URL.createObjectURL(blob); } catch (e) { url = ''; }
        if (!url) return '';
        mediaUrls[key] = url;
        mediaKeys.push(key);
        /* 页面上待着的时候不主动释放，只把最老的挤出去，免得越攒越多 */
        while (mediaKeys.length > MEDIA_CACHE_MAX) dropMediaUrl(mediaKeys.shift());
        return url;
      });
    },
    mediaBlob: mediaBlob,

    /* 群头像：接口也是「只有群里的人能看」，所以 <img src> 直接写 /api/group/avatar/1
       拿到的是 401。这里用带凭证的请求取回来换成本地 blob 地址。
       万一哪天接口改成公开可读，取不到时退回原地址，图照样显示。 */
    groupAvatarObjectUrl: function (url) {
      if (!url) return Promise.resolve('');
      if (groupAvatars[url]) return Promise.resolve(groupAvatars[url]);
      var full = /^https?:\/\//.test(url) ? url : base() + url;
      return fetch(full, {
        headers: token() ? { Authorization: 'Bearer ' + token() } : {},
        signal: mediaAbort(30000),
      }).then(function (res) {
        if (!res.ok) return url;
        return res.blob().then(function (blob) {
          if (!blob || !blob.size) return url;
          var local = '';
          try { local = URL.createObjectURL(blob); } catch (e) { local = ''; }
          if (!local) return url;
          groupAvatars[url] = local;
          groupAvatarKeys.push(url);
          /* 群列表里很多群：只留最近用到的那些，别把 blob 攒爆 */
          while (groupAvatarKeys.length > GROUP_AVATAR_MAX) {
            var old = groupAvatarKeys.shift();
            var dead = groupAvatars[old];
            delete groupAvatars[old];
            try { URL.revokeObjectURL(dead); } catch (e) { /* 忽略 */ }
          }
          return local;
        });
      }).catch(function () { return url; });
    },

    /* ---- 头像 ---- */
    uploadAvatar: function (dataUrl) { return call('POST', '/api/avatar', { dataUrl: dataUrl }); },

    /* ---- 个人信息与主页 ---- */
    saveProfile: function (profile) {
      return call('POST', '/api/profile', {
        gender: profile.gender,
        genderCustom: profile.genderCustom,
        signature: profile.signature
      });
    },
    userProfile: function (id) { return call('GET', '/api/user/' + encodeURIComponent(id)); },

    /* ---- 撤回消息（发出后 2 分钟内） ---- */
    recallMessage: function (id) { return call('POST', '/api/messages/' + encodeURIComponent(id) + '/recall'); },

    /* ---- 树洞纸条（匿名，7 天） ---- */
    treehole: function () { return call('GET', '/api/treehole'); },
    postNote: function (body) { return call('POST', '/api/treehole', { body: body }); },
    reactNote: function (id, kind) { return call('POST', '/api/treehole/' + encodeURIComponent(id) + '/react', { kind: kind }); },
    deleteNote: function (id) { return call('POST', '/api/treehole/' + encodeURIComponent(id) + '/delete'); },

    /* ---- 贪吃蛇分数与好友排行榜（按速度模式分开） ---- */
    snakeScore: function (score, mode) { return call('POST', '/api/snake/score', { score: score, mode: mode || 'normal' }); },
    snakeBoard: function (mode) { return call('GET', '/api/snake/leaderboard?mode=' + encodeURIComponent(mode || 'normal')); },

    /* ---- 千词奇域：把「豪到了」的词数报上去，换好友排行榜 ---- */
    qianciProgress: function (bank, known, todo) {
      return call('POST', '/api/qianci/progress', { bank: bank, known: known, todo: todo || 0 });
    },
    qianciBoard: function (bank) { return call('GET', '/api/qianci/leaderboard?bank=' + encodeURIComponent(bank || 'cet4')); },

    /* ---------------- 番咕咪 ---------------- */
    fanguSearch: function (q, page) {
      return call('GET', '/api/fangu/search?q=' + encodeURIComponent(q || '') + '&page=' + encodeURIComponent(page || 1));
    },
    fanguBrowse: function (page, tag, score, min, max) {
      var q = '/api/fangu/browse?page=' + encodeURIComponent(page || 1) + '&tag=' + encodeURIComponent(tag || '');
      if (score) q += '&score=' + encodeURIComponent(score) + '&min=' + encodeURIComponent(min || 0) + '&max=' + encodeURIComponent(max == null ? 10 : max);
      return call('GET', q);
    },
    /* 第二个片库（AniList）：国内没引进的番在这儿 */
    fanguMore: function (page, genre) {
      return call('GET', '/api/fangu/more?page=' + encodeURIComponent(page || 1) + '&genre=' + encodeURIComponent(genre || ''));
    },
    fanguHome: function () { return call('GET', '/api/fangu/home'); },
    /* 一页番的大众评分（列表翻完顺手要一次，服务器会边算边记）。
       把名字和 B 站评分一起带过去，服务器就不用为了算分把每部番都抓一遍 */
    fanguScores: function (items) {
      var list = (items || []).slice(0, 24).map(function (x) {
        if (x && typeof x === 'object') {
          return { i: String(x.seasonId || ''), t: String(x.title || ''), j: String(x.jpTitle || ''), b: x.scoreBili == null ? null : Number(x.scoreBili) };
        }
        return { i: String(x == null ? '' : x), t: '', j: '', b: null };
      }).filter(function (x) { return x.i; });
      if (!list.length) return Promise.resolve({ status: 200, data: { ok: true, scores: {} } });
      var ids = list.map(function (x) { return x.i; }).join(',');
      return call('GET', '/api/fangu/scores?ids=' + encodeURIComponent(ids) + '&q=' + encodeURIComponent(JSON.stringify(list)));
    },
    fanguSubject: function (seasonId, jpTitle) {
      var q = jpTitle ? '?jp=' + encodeURIComponent(jpTitle) : '';
      return call('GET', '/api/fangu/subject/' + encodeURIComponent(seasonId) + q);
    },
    fanguRate: function (seasonId, score, text) {
      return call('POST', '/api/fangu/rate', { seasonId: String(seasonId), score: score, text: text || '' });
    },
    fanguRecommend: function (seasonId) {
      return call('POST', '/api/fangu/recommend', { seasonId: String(seasonId) });
    },

    /* ---------------- 超豪飞行派对（联机飞行棋） ---------------- */
    flightBoard: function () { return call('GET', '/api/flight/board'); },
    flightCreate: function (maxPlayers) { return call('POST', '/api/flight/create', { maxPlayers: maxPlayers }); },
    flightJoin: function (code) { return call('POST', '/api/flight/join', { code: String(code == null ? '' : code).trim() }); },
    flightStart: function (code) { return call('POST', '/api/flight/start', { code: String(code) }); },
    flightRoll: function (code) { return call('POST', '/api/flight/roll', { code: String(code) }); },
    flightMove: function (code, plane) { return call('POST', '/api/flight/move', { code: String(code), plane: plane }); },
    flightRoom: function (code) { return call('GET', '/api/flight/room?code=' + encodeURIComponent(code)); },
    flightMine: function () { return call('GET', '/api/flight/mine'); },
    flightLeave: function (code) { return call('POST', '/api/flight/leave', { code: String(code) }); },
    flightAgain: function (code) { return call('POST', '/api/flight/again', { code: String(code) }); },

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
     免得页面上看起来「登录突然没了」。
     取回来之后发个事件，好友页 / 主页可以重新渲染一次（不然会停在「请先登录」）。 */
  try {
    if (token() && (!user() || !user().name)) {
      call('GET', '/api/me').then(function (r) {
        if (r.status === 200 && r.data && r.data.user) {
          saveSession(null, r.data.user);
          try { window.dispatchEvent(new Event('jhjx:session')); } catch (e) { /* 忽略 */ }
        }
      });
    }
  } catch (e) { /* 忽略 */ }
})();
