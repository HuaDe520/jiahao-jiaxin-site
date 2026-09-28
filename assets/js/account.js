/* =========================================================
   账号页逻辑：进入（昵称 + 邀请码）、我的账号、举报
   ========================================================= */
(function () {
  'use strict';

  var API = window.JHJX_API;
  if (!API) return;

  var $ = function (id) { return document.getElementById(id); };
  var loginCard = $('acLogin');
  var mineCard = $('acMine');
  var reportCard = $('acReport');
  var titleEl = $('acTitle');

  function showMsg(el, text, kind) {
    el.textContent = text;
    el.className = 'ac-msg is-show is-' + (kind || 'info');
  }

  function hideMsg(el) { el.className = 'ac-msg'; }

  function fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function render() {
    var user = API.user();
    var logged = !!(user && API.token());

    loginCard.hidden = logged;
    mineCard.hidden = !logged;
    reportCard.hidden = !logged;
    if (logged) titleEl.textContent = '我的账号';

    if (!logged) return;

    $('acAvatar').textContent = Array.from(user.name || '协')[0] || '协';
    $('acName2').textContent = user.name;
    $('acMeta').textContent = '加入于 ' + fmtDate(user.createdAt);

    var chips = $('acChips');
    chips.innerHTML = '';
    function chip(text, cls) {
      var s = document.createElement('span');
      s.className = 'ac-chip' + (cls ? ' ' + cls : '');
      s.textContent = text;
      chips.appendChild(s);
      return s;
    }
    if (user.role === 'admin') chip('管理员', 'ac-chip--gold');
    else chip('普通成员');
    if (user.status === 'banned') chip('已停用', 'ac-chip--warn');

    var toAdmin = $('acToAdmin');
    if (user.role === 'admin') {
      toAdmin.hidden = false;
      API.adminSummary().then(function (r) {
        if (r.status === 200 && r.data && r.data.openReports > 0) {
          toAdmin.textContent = '举报处理台 · 待处理 ' + r.data.openReports;
        } else {
          toAdmin.textContent = '举报处理台';
        }
      });
    } else {
      toAdmin.hidden = true;
    }
  }

  /* ---------- 进入 ---------- */
  var form = $('acForm');
  var submit = $('acSubmit');
  var msg = $('acMsg');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('acName').value.trim();
    var code = $('acCode').value.trim();
    if (!name) { showMsg(msg, '先填个昵称吧', 'error'); return; }
    if (!code) { showMsg(msg, '邀请码还没填', 'error'); return; }

    submit.disabled = true;
    hideMsg(msg);
    API.enter(name, code).then(function (r) {
      submit.disabled = false;
      if (r.status === 200 && r.data && r.data.ok) {
        API.saveSession(r.data.token, r.data.user);
        render();
        showMsg($('acReportMsg'), r.data.created ? '欢迎，' + r.data.user.name + '。' : '欢迎回来，' + r.data.user.name + '。', 'ok');
      } else if (r.data && r.data.needReset) {
        showMsg(msg, r.data.error, 'info');
      } else {
        showMsg(msg, (r.data && r.data.error) || '没能进来，再试一次', 'error');
      }
    });
  });

  /* ---------- 退出 ---------- */
  $('acLogout').addEventListener('click', function () {
    API.clearSession();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ---------- 管理台入口 ---------- */
  $('acToAdmin').addEventListener('click', function () { location.href = 'admin.html'; });

  /* ---------- 举报 ---------- */
  var reasonSel = $('acReason');
  API.reasons.forEach(function (r) {
    var o = document.createElement('option');
    o.value = r;
    o.textContent = r;
    reasonSel.appendChild(o);
  });

  $('acReportForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var target = $('acTarget').value.trim();
    var reason = reasonSel.value;
    var detail = $('acDetail').value.trim();
    var rmsg = $('acReportMsg');
    var btn = $('acReportSubmit');
    if (!target) { showMsg(rmsg, '要举报谁呢？把昵称填上', 'error'); return; }

    btn.disabled = true;
    hideMsg(rmsg);
    API.report(target, reason, detail).then(function (r) {
      btn.disabled = false;
      if (r.status === 200 && r.data && r.data.ok) {
        $('acTarget').value = '';
        $('acDetail').value = '';
        showMsg(rmsg, '已经交给管理员了', 'ok');
      } else {
        showMsg(rmsg, (r.data && r.data.error) || '没提交成功，再试一次', 'error');
      }
    });
  });

  /* ---------- 初始：确认一下本地凭证还有效 ---------- */
  render();
  if (API.token()) {
    API.me().then(function (r) {
      if (r.status === 200 && r.data && r.data.user) {
        API.saveSession(null, r.data.user);
        render();
      } else if (r.status === 401 || r.status === 403) {
        API.clearSession();
        render();
        if (r.status === 403) showMsg(msg, (r.data && r.data.error) || '这个昵称已被停用', 'error');
      }
    });
  }
})();
