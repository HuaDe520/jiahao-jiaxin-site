/* =========================================================
   用户主页：看别人的昵称 / 头像 / 性别 / 签名
   —— 刻意不显示角色，谁都看不出对方是不是管理员
   ========================================================= */
(function () {
  'use strict';

  var API = window.JHJX_API;
  if (!API) return;

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var userId = Number(params.get('id') || 0);

  function show(box) {
    ['pfGuest', 'pfLoading', 'pfError', 'pfMain'].forEach(function (id) {
      $(id).hidden = (id !== box);
    });
  }

  function fmtDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }

  function msg(text, kind) {
    var el = $('pfMsg');
    el.textContent = text;
    el.className = 'pf-msg is-show is-' + (kind || 'info');
  }

  function button(label, cls, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fr-btn' + (cls ? ' ' + cls : '');
    b.textContent = label;
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function renderActions(relation, user) {
    var box = $('pfActions');
    box.innerHTML = '';

    if (relation === 'self') {
      box.appendChild(button('修改我的资料', '', function () { location.href = 'account.html#acProfile'; }));
      box.appendChild(button('去好友页', 'fr-btn--ghost', function () { location.href = 'friends.html'; }));
      return;
    }
    if (relation === 'friends') {
      box.appendChild(button('发消息', '', function () { location.href = 'friends.html#chat=' + user.id; }));
      box.appendChild(button('看好友列表', 'fr-btn--ghost', function () { location.href = 'friends.html'; }));
      return;
    }
    if (relation === 'pending_out') {
      box.appendChild(button('已发出请求，等对方同意', 'fr-btn--ghost', null)).disabled = true;
      return;
    }
    if (relation === 'pending_in') {
      box.appendChild(button('同意加为好友', '', function () {
        API.friends().then(function (res) {
          var inc = ((res.data && res.data.incoming) || []).filter(function (f) { return f.id === user.id; })[0];
          if (!inc) { msg('没找到这条请求，刷新一下好友页试试', 'error'); return; }
          API.friendRespond(inc.relId, 'accept').then(function (r2) {
            if (r2.status === 200) { msg('已经是好友了，去好友页聊吧', 'ok'); renderActions('friends', user); }
            else { msg((r2.data && r2.data.error) || '没能同意，稍后再试', 'error'); }
          });
        });
      }));
      return;
    }
    box.appendChild(button('加好友', '', function () {
      API.friendRequest(user.id).then(function (r) {
        if (r.status === 200) {
          msg(r.data && r.data.accepted ? '你们已经是好友了' : '请求发出去了，等对方同意', 'ok');
          renderActions(r.data && r.data.accepted ? 'friends' : 'pending_out', user);
        } else {
          msg((r.data && r.data.error) || '没能发出请求', 'error');
        }
      });
    }));
  }

  function render(data) {
    var user = data.user;
    $('pfName').textContent = user.name;
    var img = $('pfAvatar');
    img.src = API.asset(user.avatar) || 'assets/img/logo-main.png';
    img.onerror = function () { this.src = 'assets/img/logo-main.png'; };
    $('pfAvatarBtn').addEventListener('click', function () {
      this.classList.toggle('is-big');
    });

    var tags = $('pfTags');
    tags.innerHTML = '';
    var g = document.createElement('span');
    g.className = 'pf-tag';
    g.textContent = user.genderText;
    tags.appendChild(g);
    if (data.relation === 'self') {
      var me = document.createElement('span');
      me.className = 'pf-tag pf-tag--self';
      me.textContent = '这是你自己';
      tags.appendChild(me);
    }

    $('pfSince').textContent = user.createdAt ? ('加入于 ' + fmtDate(user.createdAt)) : '';
    $('pfSign').textContent = user.signature || '这个人很神秘，什么都没写。';
    $('pfSign').className = 'pf-sign' + (user.signature ? '' : ' pf-sign--empty');
    $('pfFoot').textContent = data.relation === 'self'
      ? '主页只展示昵称、头像、性别和签名，别人看不到你的密码和举报记录。'
      : '主页只展示昵称、头像、性别和签名。';
    renderActions(data.relation, user);
    show('pfMain');
  }

  /* ---------- 启动 ---------- */
  if (!userId) {
    $('pfErrorText').textContent = '链接里没有用户编号，回好友页点别人的头像试试。';
    show('pfError');
    return;
  }
  if (!API.token() || !API.user()) {
    show('pfGuest');
    /* 登录资料被 api.js 补回来之后重新加载，别停在「请先登录」 */
    window.addEventListener('jhjx:session', function () { location.reload(); });
    return;
  }
  $('pfTitle').textContent = '成员主页';
  show('pfLoading');
  API.userProfile(userId).then(function (res) {
    if (res.status === 200 && res.data && res.data.ok) {
      render(res.data);
      return;
    }
    if (res.status === 401) { show('pfGuest'); return; }
    $('pfErrorText').textContent = (res.data && res.data.error) || '打不开这个主页，稍后再试。';
    show('pfError');
  });
})();
