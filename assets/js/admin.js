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

  /* ---------------- 成员 ---------------- */
  function renderUsers(list) {
    usersEl.innerHTML = '';
    if (!list.length) {
      usersEl.appendChild(empty('还没有成员。'));
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
      who.textContent = u.name + (me.id === u.id ? '（我）' : '');
      top.appendChild(who);
      if (u.role === 'admin') top.appendChild(chip('管理员', 'ac-chip--gold'));
      if (u.status === 'banned') top.appendChild(chip('已停用', 'ac-chip--warn'));
      if (u.reports > 0) top.appendChild(chip('被举报 ' + u.reports + ' 次', 'ac-chip--warn'));
      var time = document.createElement('span');
      time.className = 'ac-item__time';
      time.textContent = '加入于 ' + fmtTime(u.createdAt);
      top.appendChild(time);
      item.appendChild(top);

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
      API.adminUsers(),
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
      if (us.status === 200) renderUsers(us.data.users || []);
      var d = new Date();
      $('adUpdated').textContent = '最后更新 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    });
  }

  /* ---------------- 交互 ---------------- */
  tabReports.addEventListener('click', function () {
    tabReports.classList.add('is-active');
    tabUsers.classList.remove('is-active');
    reportsCard.hidden = false;
    usersCard.hidden = true;
  });

  tabUsers.addEventListener('click', function () {
    tabUsers.classList.add('is-active');
    tabReports.classList.remove('is-active');
    usersCard.hidden = false;
    reportsCard.hidden = true;
  });

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
