/* =========================================================
   举报处理台：看举报、处理举报、管理成员昵称
   ========================================================= */
(function () {
  'use strict';

  var API = window.JHJX_API;
  if (!API) return;

  var $ = function (id) { return document.getElementById(id); };
  var guard = $('adGuard');
  var main = $('adMain');
  var reportsEl = $('adReports');
  var usersEl = $('adUsers');
  var msgEl = $('adMsg');
  var tabReports = $('adTabReports');
  var tabUsers = $('adTabUsers');
  var reportsCard = $('adReportsCard');
  var usersCard = $('adUsersCard');

  function showMsg(text, kind) {
    msgEl.textContent = text;
    msgEl.className = 'ac-msg is-show is-' + (kind || 'info');
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    var diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + ' 天前';
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }

  function chip(text, cls) {
    var s = document.createElement('span');
    s.className = 'ac-chip' + (cls ? ' ' + cls : '');
    s.textContent = text;
    return s;
  }

  function empty(text) {
    var d = document.createElement('div');
    d.className = 'ac-empty';
    d.textContent = text;
    return d;
  }

  /* ---------------- 举报 ---------------- */
  function renderReports(list) {
    reportsEl.innerHTML = '';
    if (!list.length) {
      reportsEl.appendChild(empty('没有待处理的举报。'));
      return;
    }
    list.forEach(function (r) {
      var item = document.createElement('div');
      item.className = 'ac-item' + (r.status === 'open' ? '' : ' is-done');

      var top = document.createElement('div');
      top.className = 'ac-item__top';
      var who = document.createElement('span');
      who.className = 'ac-item__who';
      who.textContent = r.targetName;
      top.appendChild(who);
      top.appendChild(chip(r.reason, 'ac-chip--warn'));
      if (r.status === 'handled') top.appendChild(chip('已处理', 'ac-chip--mute'));
      if (r.status === 'rejected') top.appendChild(chip('已驳回', 'ac-chip--mute'));
      var time = document.createElement('span');
      time.className = 'ac-item__time';
      time.textContent = fmtTime(r.createdAt);
      top.appendChild(time);
      item.appendChild(top);

      if (r.detail) {
        var detail = document.createElement('div');
        detail.className = 'ac-item__detail';
        detail.textContent = r.detail;
        item.appendChild(detail);
      }

      var by = document.createElement('div');
      by.className = 'ac-item__note';
      by.textContent = '举报人：' + (r.reporterName || '（已注销）');
      item.appendChild(by);

      if (r.status !== 'open') {
        var handled = document.createElement('div');
        handled.className = 'ac-item__note';
        handled.textContent = (r.status === 'handled' ? '由 ' + (r.handledBy || '管理员') + ' 处理' : '由 ' + (r.handledBy || '管理员') + ' 驳回') +
          ' · ' + fmtTime(r.handledAt) + (r.handleNote ? ' · 备注：' + r.handleNote : '');
        item.appendChild(handled);
        reportsEl.appendChild(item);
        return;
      }

      var row = document.createElement('div');
      row.className = 'ac-item__row';
      var note = document.createElement('input');
      note.className = 'ac-input';
      note.type = 'text';
      note.maxLength = 200;
      note.placeholder = '处理备注（可不填）';
      row.appendChild(note);

      function act(action, label, danger) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ac-btn ac-btn--ghost' + (danger ? ' ac-btn--danger' : '');
        btn.textContent = label;
        btn.addEventListener('click', function () {
          btn.disabled = true;
          API.adminReportAction(r.id, action, note.value.trim()).then(function (res) {
            btn.disabled = false;
            if (res.status === 200 && res.data && res.data.ok) {
              showMsg(action === 'handled' ? '已标记为处理完成' : '已驳回这条举报', 'ok');
              load();
            } else {
              showMsg((res.data && res.data.error) || '操作失败', 'error');
            }
          });
        });
        return btn;
      }
      row.appendChild(act('handled', '已处理'));
      row.appendChild(act('rejected', '驳回', true));
      item.appendChild(row);
      reportsEl.appendChild(item);
    });
  }

  /* ---------------- 成员 ----------------
     管理员看到的是协会全部成员：列表给出 total/shown，还能按昵称或 #编号搜 */
  var userQuery = '';

  /* 「登录设备」那一行：最近用过哪个端 + 各端用过几次（电脑网页 / 手机网页 / 手机 App） */
  function platformLine(u) {
    var CN = { web: '电脑网页', mobile: '手机网页', app: '手机 App' };
    var d = u.devices || {};
    var parts = [];
    ['web', 'mobile', 'app'].forEach(function (k) {
      var n = Number(d[k] || 0);
      if (n > 0) parts.push(CN[k] + ' ' + n + ' 次');
    });
    var last = CN[u.platform] || '';
    if (!parts.length) return last || '还不清楚（没记录到）';
    if (!last) return parts.join(' · ');
    /* 把「最近用的那个」放最前面，一眼能看到他是不是在用电脑 */
    var first = parts.filter(function (s) { return s.indexOf(last) === 0; })[0];
    var rest = parts.filter(function (s) { return s !== first; });
    return [first || parts[0]].concat(rest).join(' · ');
  }

  function renderUsers(data) {
    var list = (data && data.users) || [];
    usersEl.innerHTML = '';
    var countEl = $('adUsersCount');
    if (countEl) {
      countEl.textContent = userQuery
        ? ('搜「' + userQuery + '」找到 ' + list.length + ' 位；协会一共 ' + (data.total || 0) + ' 位')
        : ('协会一共 ' + (data.total || list.length) + ' 位成员，这儿全部列出来了（新的在前）');
    }
    var clearBtn = $('adUserClear');
    if (clearBtn) clearBtn.hidden = !userQuery;
    if (!list.length) {
      usersEl.appendChild(empty(userQuery ? '没有这个昵称（或者编号）的成员。' : '还没有成员。'));
      return;
    }
    var me = API.user() || {};
    list.forEach(function (u) {
      var item = document.createElement('div');
      item.className = 'ac-item' + (u.status === 'banned' ? ' is-done' : '');

      var top = document.createElement('div');
      top.className = 'ac-item__top';
      var who = document.createElement('span');
      who.className = 'ac-item__who';
      /* 编号也摆出来：管理员找人、对账都要靠它 */
      who.textContent = '#' + u.id + ' ' + u.name + (me.id === u.id ? '（我）' : '');
      top.appendChild(who);
      if (u.role === 'admin') top.appendChild(chip('管理员', 'ac-chip--gold'));
      if (u.status === 'banned') top.appendChild(chip('已停用', 'ac-chip--warn'));
      if (u.reports > 0) top.appendChild(chip('被举报 ' + u.reports + ' 次', 'ac-chip--warn'));
      var time = document.createElement('span');
      time.className = 'ac-item__time';
      time.textContent = '加入于 ' + fmtTime(u.createdAt);
      top.appendChild(time);
      item.appendChild(top);

      /* 性别和个性签名：不点开也能一眼看全 */
      var info = document.createElement('div');
      info.className = 'ac-item__note';
      var bits = ['性别 ' + (u.genderText || '未知')];
      if (u.signature) bits.push('签名：' + u.signature);
      if (!u.hasPassword) bits.push('还没设密码（得用邀请码重新进来）');
      info.textContent = bits.join(' · ');
      item.appendChild(info);

      /* 他从哪个端来的：电脑网页 / 手机网页 / 手机 App（用过的都列一遍次数） */
      var dev = document.createElement('div');
      dev.className = 'ac-item__note';
      dev.textContent = '登录设备：' + platformLine(u) + '（最近 ' + fmtTime(u.platformAt || u.lastSeenAt) + '）';
      item.appendChild(dev);

      var seen = document.createElement('div');
      seen.className = 'ac-item__note';
      seen.textContent = '最近出现：' + fmtTime(u.lastSeenAt);
      item.appendChild(seen);

      var row = document.createElement('div');
      row.className = 'ac-item__row';

      function act(action, label, confirmText, danger) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ac-btn ac-btn--ghost' + (danger ? ' ac-btn--danger' : '');
        btn.textContent = label;
        btn.addEventListener('click', function () {
          if (confirmText && !window.confirm(confirmText)) return;
          btn.disabled = true;
          API.adminUserAction(u.id, action).then(function (res) {
            btn.disabled = false;
            if (res.status === 200 && res.data && res.data.ok) {
              showMsg('已更新：' + label, 'ok');
              load();
            } else {
              showMsg((res.data && res.data.error) || '操作失败', 'error');
            }
          });
        });
        return btn;
      }

      var isMe = me.id === u.id;
      /* 详情：管理员点开看这个人的全部情况 */
      var detailBtn = document.createElement('button');
      detailBtn.type = 'button';
      detailBtn.className = 'ac-btn ac-btn--ghost';
      detailBtn.textContent = '看详情';
      detailBtn.addEventListener('click', function () { openUser(u); });
      row.appendChild(detailBtn);

      if (!isMe) {
        if (u.status === 'banned') row.appendChild(act('unban', '恢复'));
        else row.appendChild(act('ban', '停用', '确定停用「' + u.name + '」吗？他会立刻掉线。', true));
      }

      row.appendChild(act('reset', '重置登录', '重置后「' + u.name + '」的旧登录会失效，密码也被清空；本人用昵称 + 邀请码 + 新密码就能重新进来（等于重新设密码）。确定吗？'));

      if (u.role === 'admin') {
        if (!isMe) row.appendChild(act('revoke_admin', '取消管理员', '确定取消「' + u.name + '」的管理员吗？', true));
      } else {
        row.appendChild(act('grant_admin', '设为管理员', '确定把「' + u.name + '」设为管理员吗？他就能看到所有举报了。'));
      }

      item.appendChild(row);
      usersEl.appendChild(item);
    });
  }

  /* ---------------- 成员详情 ----------------
     管理员点「看详情」：资料、在这儿的活动，一次摆清楚 */
  var sheet = null;
  var sheetBox = null;

  function closeUser() {
    if (!sheet) return;
    sheet.hidden = true;
    sheetBox.innerHTML = '';
    document.body.style.overflow = '';
  }

  function line(label, value) {
    var row = document.createElement('div');
    row.className = 'ac-line';
    var k = document.createElement('span');
    k.className = 'ac-line__k';
    k.textContent = label;
    var v = document.createElement('span');
    v.className = 'ac-line__v';
    v.textContent = value == null || value === '' ? '—' : String(value);
    row.appendChild(k);
    row.appendChild(v);
    return row;
  }

  function openUser(u) {
    if (!sheet) {
      sheet = $('adSheet');
      sheetBox = $('adSheetBox');
      sheet.addEventListener('click', function (e) { if (e.target === sheet) closeUser(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) closeUser(); });
    }
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    sheetBox.innerHTML = '';
    var loading = document.createElement('p');
    loading.className = 'ac-foot';
    loading.textContent = '正在取「' + u.name + '」的情况…';
    sheetBox.appendChild(loading);

    API.adminUser(u.id).then(function (res) {
      if (res.status !== 200 || !res.data || !res.data.user) {
        sheetBox.innerHTML = '';
        sheetBox.appendChild(loading);
        loading.textContent = (res.data && res.data.error) || '取不到这个成员的情况';
        return;
      }
      var d = res.data.user;
      var a = res.data.activity || {};
      sheetBox.innerHTML = '';

      var head = document.createElement('div');
      head.className = 'ac-sheet__head';
      if (d.avatar) {
        var img = document.createElement('img');
        img.className = 'ac-sheet__avatar';
        img.src = API.asset(d.avatar);
        img.alt = '';
        head.appendChild(img);
      }
      var hbox = document.createElement('div');
      var h = document.createElement('h3');
      h.className = 'ac-sheet__name';
      h.textContent = d.name + '（#' + d.id + '）';
      hbox.appendChild(h);
      var sub = document.createElement('p');
      sub.className = 'ac-sheet__sub';
      sub.textContent = (d.role === 'admin' ? '管理员' : '普通成员') + ' · ' + (d.status === 'banned' ? '已停用' : '正常')
        + ' · ' + d.genderText + (d.hasPassword ? ' · 有密码' : ' · 还没设密码');
      hbox.appendChild(sub);
      head.appendChild(hbox);
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'ac-sheet__close';
      close.setAttribute('aria-label', '关闭');
      close.textContent = '×';
      close.addEventListener('click', closeUser);
      head.appendChild(close);
      sheetBox.appendChild(head);

      var sec1 = document.createElement('div');
      sec1.className = 'ac-sec';
      var t1 = document.createElement('div');
      t1.className = 'ac-sec__title';
      t1.textContent = '资料';
      sec1.appendChild(t1);
      sec1.appendChild(line('昵称', d.name));
      sec1.appendChild(line('性别', d.genderText + (d.gender === 'custom' && d.genderCustom ? '（' + d.genderCustom + '）' : '')));
      sec1.appendChild(line('个性签名', d.signature));
      sec1.appendChild(line('登录设备', platformLine(d) + (d.platformAt ? '（最近 ' + fmtTime(d.platformAt) + '）' : '')));
      sec1.appendChild(line('加入时间', fmtTime(d.createdAt)));
      sec1.appendChild(line('最近出现', fmtTime(d.lastSeenAt)));
      sheetBox.appendChild(sec1);

      var sec2 = document.createElement('div');
      sec2.className = 'ac-sec';
      var t2 = document.createElement('div');
      t2.className = 'ac-sec__title';
      t2.textContent = '在这儿的活动';
      sec2.appendChild(t2);
      sec2.appendChild(line('好友', a.friends + ' 个'));
      sec2.appendChild(line('好友申请', '收到 ' + a.incomingRequests + ' · 发出 ' + a.outgoingRequests));
      sec2.appendChild(line('私聊消息', a.messagesDirect + ' 条'));
      sec2.appendChild(line('群消息', a.messagesGroup + ' 条'));
      sec2.appendChild(line('加的群', (a.groups || []).length
        ? a.groups.map(function (g) { return g.name + '（' + ({ owner: '群主', admin: '管理员' }[g.role] || '成员') + (g.nickname ? '·' + g.nickname : '') + '）'; }).join('、')
        : '还没加群'));
      sec2.appendChild(line('番咕咪评分', a.fanguReviews + ' 条' + (a.fanguReviews ? '（' + (a.fanguScores || []).map(function (x) { return '#' + x.seasonId + ' ' + x.score; }).slice(0, 6).join('、') + '）' : '')));
      sec2.appendChild(line('番咕咪推荐', a.fanguRecs + ' 部'));
      var snakeText = (a.snake || []).filter(function (x) { return x.best > 0 || x.tries > 0; })
        .map(function (x) { return x.label + ' ' + x.best + ' 分/' + x.tries + ' 次'; }).join('、');
      sec2.appendChild(line('贪吃蛇', snakeText || '还没玩'));
      var words4 = (a.qianciKnown || a.qianciTodo) ? ('四级 已会 ' + a.qianciKnown + ' · 待巩固 ' + a.qianciTodo) : '';
      var words6 = (a.qianciKnown6 || a.qianciTodo6) ? ('六级 已会 ' + a.qianciKnown6 + ' · 待巩固 ' + a.qianciTodo6) : '';
      sec2.appendChild(line('千词奇域', [words4, words6].filter(Boolean).join('；') || '还没玩'));
      sec2.appendChild(line('飞行棋', (a.flightRooms || []).length ? (a.flightRooms.length + ' 桌（' + a.flightRooms.map(function (r) { return r.code + '/' + r.status; }).join('、') + '）') : '没开过桌'));
      sec2.appendChild(line('被举报 / 举报别人', a.reportsAgainst + ' 次 / ' + a.reportsFiled + ' 次'));
      sheetBox.appendChild(sec2);
    }, function () {
      sheetBox.innerHTML = '';
      var err = document.createElement('p');
      err.className = 'ac-foot';
      err.textContent = '网络不太好，没取到这个成员的情况';
      sheetBox.appendChild(err);
    });
  }

  /* ---------------- 汇总 ---------------- */
  function renderSummary(s) {
    var box = $('adSummary');
    box.innerHTML = '';
    box.appendChild(chip('待处理举报 ' + s.openReports, s.openReports > 0 ? 'ac-chip--gold' : ''));
    box.appendChild(chip('成员 ' + s.users));
    if (s.banned > 0) box.appendChild(chip('已停用 ' + s.banned, 'ac-chip--warn'));
  }

  /* ---------------- 加载 ---------------- */
  var showAll = false;

  function load() {
    /* 30 秒一次的自动刷新会把列表整段重建（备注框里正在打的字就没了），
       所以正在某个备注框里打字时，这一轮先不乱动列表 */
    var typing = document.activeElement && document.activeElement.classList
      && document.activeElement.classList.contains('ac-input');
    return Promise.all([
      API.adminSummary(),
      typing ? Promise.resolve({ status: 0, data: {} }) : API.adminReports(showAll ? 'all' : 'open'),
      API.adminUsers(userQuery),
    ]).then(function (res) {
      var s = res[0], reps = res[1], us = res[2];
      /* 401（凭证过期/被挤下线）和 403（不是管理员）都要有交代，
         不然页面就是一片空白，只有「最后更新」在跳 */
      if (s.status === 401 || reps.status === 401 || us.status === 401) {
        guard.hidden = false;
        main.hidden = true;
        $('adFoot').hidden = true;
        var g = $('adGuardMsg');
        if (g) g.textContent = '登录已过期，重新登录一下再看管理台。';
        return;
      }
      if (s.status === 403 || reps.status === 403 || us.status === 403) {
        guard.hidden = false;
        main.hidden = true;
        $('adFoot').hidden = true;
        return;
      }
      if (s.status === 200) renderSummary(s.data);
      if (reps.status === 200) renderReports(reps.data.reports || []);
      if (us.status === 200) renderUsers(us.data);
      var d = new Date();
      $('adUpdated').textContent = '最后更新 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    });
  }

  /* ---------------- 交互 ----------------
     两块都在同一页上（成员名单不用先点标签才看得见），
     这两个标签就当「跳到哪一块」用 */
  function jumpTo(card, tab) {
    tabReports.classList.toggle('is-active', tab === tabReports);
    tabUsers.classList.toggle('is-active', tab === tabUsers);
    if (card && card.scrollIntoView) {
      try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { card.scrollIntoView(); }
    }
  }

  tabReports.addEventListener('click', function () { jumpTo(reportsCard, tabReports); });

  tabUsers.addEventListener('click', function () { jumpTo(usersCard, tabUsers); });

  $('adRefresh').addEventListener('click', function () { showMsg('正在刷新…', 'info'); load(); });
  $('adLogout').addEventListener('click', function () {
    API.clearSession();
    location.href = 'account.html';
  });
  $('adToAccount').addEventListener('click', function () { location.href = 'account.html'; });

  /* 点标题切换：看全部 / 只看待处理 */
  var titleEl = document.querySelector('#adReportsCard');
  var toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ac-btn ac-btn--ghost';
  toggle.textContent = '看全部举报';
  toggle.addEventListener('click', function () {
    showAll = !showAll;
    toggle.textContent = showAll ? '只看待处理' : '看全部举报';
    load();
  });
  titleEl.insertBefore(toggle, titleEl.firstChild);

  /* ---------------- 启动 ---------------- */
  /* 成员那一栏的搜索：按昵称或 #编号找人都行 */
  (function bindUserSearch() {
    var input = $('adUserQuery');
    var go = $('adUserGo');
    var clear = $('adUserClear');
    if (!input || !go) return;
    function run() {
      userQuery = String(input.value || '').trim();
      load();
    }
    go.addEventListener('click', run);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    if (clear) clear.addEventListener('click', function () { input.value = ''; userQuery = ''; load(); });
  })();

  var user = API.user();
  if (!user || !API.token() || user.role !== 'admin') {
    guard.hidden = false;
    main.hidden = true;
    $('adFoot').hidden = true;
    return;
  }
  guard.hidden = true;
  main.hidden = false;
  $('adFoot').hidden = false;
  $('adWho').textContent = user.name;

  load();
  window.setInterval(load, 30000);   /* 有新的举报会自动出现 */
})();
