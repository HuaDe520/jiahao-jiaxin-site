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

    var img = $('acAvatarImg');
    if (user.avatar) {
      img.src = API.asset(user.avatar);
      img.onerror = function () { this.src = 'assets/img/logo-main.png'; };
    } else {
      img.src = 'assets/img/logo-main.png';
    }
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

    /* 个人信息：把当前值填进表单 */
    var gender = $('acGender');
    gender.value = user.gender || 'unknown';
    $('acGenderCustom').value = user.genderCustom || '';
    $('acGenderCustomWrap').hidden = gender.value !== 'custom';
    var sign = $('acSignature');
    sign.value = user.signature || '';
    $('acSignCount').textContent = Array.from(sign.value).length + ' / 50';
    $('acMyPage').href = 'user.html?id=' + user.id;
  }

  /* ---------- 进入 ---------- */
  var form = $('acForm');
  var submit = $('acSubmit');
  var msg = $('acMsg');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('acName').value.trim();
    var pw = $('acPass').value;
    var code = $('acCode').value.trim();
    if (!name) { showMsg(msg, '先填个昵称吧', 'error'); return; }
    if (!pw) { showMsg(msg, '密码还没填，第一次进来就是在这里定密码', 'error'); return; }
    if (pw.length < 6) { showMsg(msg, '密码至少 6 位', 'error'); return; }
    if (!code) { showMsg(msg, '邀请码还没填', 'error'); return; }

    submit.disabled = true;
    hideMsg(msg);
    API.enter(name, code, pw).then(function (r) {
      submit.disabled = false;
      if (r.status === 200 && r.data && r.data.ok) {
        API.saveSession(r.data.token, r.data.user);
        /* 登录成功后回首页，首页会弹一秒「登录成功」 */
        try {
          sessionStorage.setItem('jhjx-login-toast', r.data.user.name);
        } catch (e) { /* 忽略 */ }
        location.href = 'index.html';
        return;
      } else {
        showMsg(msg, (r.data && r.data.error) || '没能进来，再试一次', 'error');
      }
    });
  });

  /* ---------- 个人信息（性别 + 签名） ---------- */
  $('acGender').addEventListener('change', function () {
    $('acGenderCustomWrap').hidden = this.value !== 'custom';
    if (this.value === 'custom') $('acGenderCustom').focus();
  });
  $('acSignature').addEventListener('input', function () {
    $('acSignCount').textContent = Array.from(this.value).length + ' / 50';
  });

  $('acProfileSave').addEventListener('click', function () {
    var pmsg = $('acProfileMsg');
    var gender = $('acGender').value;
    var custom = $('acGenderCustom').value.trim();
    var signature = $('acSignature').value.trim();
    if (gender === 'custom' && !custom) { showMsg(pmsg, '自定义性别还没填', 'error'); return; }
    if (Array.from(custom).length > 8) { showMsg(pmsg, '自定义性别最多 8 个字', 'error'); return; }
    if (Array.from(signature).length > 50) { showMsg(pmsg, '个人签名最多 50 个字', 'error'); return; }

    var btn = this;
    btn.disabled = true;
    hideMsg(pmsg);
    API.saveProfile({ gender: gender, genderCustom: custom, signature: signature }).then(function (r) {
      btn.disabled = false;
      if (r.status === 200 && r.data && r.data.ok) {
        API.saveSession(null, r.data.user);
        render();
        showMsg(pmsg, '资料保存好了，别人点你的头像就能看到', 'ok');
      } else {
        showMsg(pmsg, (r.data && r.data.error) || '没保存成功，再试一次', 'error');
      }
    });
  });

  /* ---------- 改密码（登录状态下）：要填「修改权限码」 ---------- */
  $('acPassSubmit').addEventListener('click', function () {
    var pmsg = $('acPassMsg');
    var perm = $('acPermCode').value.trim();
    var newPw = $('acNewPass').value;
    if (!perm) { showMsg(pmsg, '要先填修改权限码', 'error'); return; }
    if (newPw.length < 6) { showMsg(pmsg, '新密码至少 6 位', 'error'); return; }
    var btn = this;
    btn.disabled = true;
    hideMsg(pmsg);
    API.changePassword(perm, newPw).then(function (r) {
      btn.disabled = false;
      if (r.status === 200 && r.data && r.data.ok) {
        $('acPermCode').value = '';
        $('acNewPass').value = '';
        showMsg(pmsg, '密码已经换好了', 'ok');
      } else {
        showMsg(pmsg, (r.data && r.data.error) || '没改成功，再试一次', 'error');
      }
    });
  });

  /* ---------- 忘了密码：昵称 + 邀请码 + 修改权限码 → 重设并登录 ---------- */
  $('acForgotBtn').addEventListener('click', function () {
    var fmsg = $('acForgotMsg');
    var name = $('acForgotName').value.trim();
    var code = $('acForgotCode').value.trim();
    var perm = $('acForgotPerm').value.trim();
    var pw = $('acForgotPass').value;
    if (!name) { showMsg(fmsg, '先填昵称', 'error'); return; }
    if (!code) { showMsg(fmsg, '邀请码还没填', 'error'); return; }
    if (!perm) { showMsg(fmsg, '修改权限码还没填', 'error'); return; }
    if (pw.length < 6) { showMsg(fmsg, '新密码至少 6 位', 'error'); return; }
    var btn = this;
    btn.disabled = true;
    hideMsg(fmsg);
    API.resetPassword(name, code, perm, pw).then(function (r) {
      btn.disabled = false;
      if (r.status === 200 && r.data && r.data.ok) {
        API.saveSession(r.data.token, r.data.user);
        try { sessionStorage.setItem('jhjx-login-toast', r.data.user.name); } catch (e) { /* 忽略 */ }
        showMsg(fmsg, '密码重设好了，正在回首页…', 'ok');
        setTimeout(function () { location.href = 'index.html'; }, 600);
      } else {
        showMsg(fmsg, (r.data && r.data.error) || '没能重设，检查一下昵称和邀请码', 'error');
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
  $('acToFriends').addEventListener('click', function () { location.href = 'friends.html'; });

  /* ---------- 换头像 ---------- */
  var avatarMsg = $('acAvatarMsg');
  $('acAvatarBtn').addEventListener('click', function () { $('acAvatarFile').click(); });

  $('acAvatarFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    /* 有些手机的相机返回的类型是空的，交给下面的解码去判断 */
    if (file.type && !/^image\//.test(file.type)) { showMsg(avatarMsg, '请选一张图片', 'error'); return; }
    if (file.size > 12 * 1024 * 1024) { showMsg(avatarMsg, '图片太大了，换一张小一点的', 'error'); return; }

    showMsg(avatarMsg, '正在处理…', 'ok');
    var reader = new FileReader();
    reader.onerror = function () { showMsg(avatarMsg, '这张图读不出来，换一张', 'error'); };
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        /* 居中裁成正方形，缩到 256×256，再压成 JPEG，几十 KB */
        var size = 256;
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');
        var s = Math.min(img.width, img.height);
        if (!s) { showMsg(avatarMsg, '这张图打不开，换一张', 'error'); return; }
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        /* 万一还是偏大（有些图噪点多），降一档质量再来一次 */
        if (dataUrl.length > 300 * 1024) dataUrl = canvas.toDataURL('image/jpeg', 0.6);

        API.uploadAvatar(dataUrl).then(function (res) {
          if (res.status === 200 && res.data.ok) {
            API.saveSession(null, res.data.user);
            render();
            showMsg(avatarMsg, '头像换好了', 'ok');
          } else {
            showMsg(avatarMsg, (res.data && res.data.error) || '上传失败，再试一次', 'error');
          }
        });
      };
      img.onerror = function () { showMsg(avatarMsg, '这张图打不开（iPhone 的 HEIC 原图可能不行），换一张或先截个图', 'error'); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

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
    var tokenAtCheck = API.token();
    API.me().then(function (r) {
      /* 这期间如果重新登录过（凭证换了），就别拿旧结果把新登录状态清掉 */
      if (API.token() !== tokenAtCheck) return;
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
