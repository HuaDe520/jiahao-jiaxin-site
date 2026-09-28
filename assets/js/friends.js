/* =========================================================
   好友与聊天页面逻辑
   · 好友列表 = 会话列表（有聊天记录的排前面，带未读角标）
   · 聊天用轮询：打开某个会话时每 4 秒拉一次新消息
   ========================================================= */
(function () {
  'use strict';

  var API = window.JHJX_API;
  if (!API) return;

  var $ = function (id) { return document.getElementById(id); };
  var state = { friends: [], incoming: [], outgoing: [], threads: [], current: null, lastAt: 0, timer: null };

  function fmtTime(ts) {
    var d = new Date(ts);
    var diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function avatarUrl(path) { return API.asset(path) || 'assets/img/logo-main.png'; }

  function showMsg(el, text, kind) {
    el.textContent = text;
    el.className = 'fr-msg is-show is-' + (kind || 'ok');
  }
  function hideMsg(el) { el.className = 'fr-msg'; }

  function empty(text) {
    var d = document.createElement('div');
    d.className = 'fr-empty';
    d.textContent = text;
    return d;
  }

  /* ---------------- 好友列表（含会话信息） ---------------- */
  function renderFriends() {
    var box = $('frFriends');
    box.innerHTML = '';

    var byId = {};
    state.threads.forEach(function (t) { byId[t.id] = t; });

    var rows = state.friends.slice().sort(function (a, b) {
      var ta = byId[a.id] ? byId[a.id].lastAt : 0;
      var tb = byId[b.id] ? byId[b.id].lastAt : 0;
      return (tb - ta) || (b.unread - a.unread);
    });

    if (!rows.length) {
      box.appendChild(empty('还没有好友。去「找人」搜昵称，加一个吧。'));
      return;
    }

    rows.forEach(function (f) {
      var t = byId[f.id];
      var row = document.createElement('div');
      row.className = 'fr-row';

      var img = document.createElement('img');
      img.className = 'fr-row__avatar';
      img.src = avatarUrl(f.avatar);
      img.alt = '';
      row.appendChild(img);

      var body = document.createElement('div');
      body.className = 'fr-row__body';
      var name = document.createElement('div');
      name.className = 'fr-row__name';
      name.textContent = f.name;
      var last = document.createElement('div');
      last.className = 'fr-row__last';
      last.textContent = t && t.last ? (t.last.length > 24 ? t.last.slice(0, 24) + '…' : t.last) : '点这里开始聊天';
      body.appendChild(name);
      body.appendChild(last);
      row.appendChild(body);

      var side = document.createElement('div');
      side.className = 'fr-row__side';
      if (t && t.unread > 0) {
        var badge = document.createElement('span');
        badge.className = 'fr-row__badge';
        badge.textContent = t.unread > 99 ? '99+' : t.unread;
        side.appendChild(badge);
      }
      var chat = document.createElement('button');
      chat.type = 'button';
      chat.className = 'fr-btn';
      chat.textContent = '聊天';
      chat.addEventListener('click', function () { openChat(f); });
      side.appendChild(chat);
      row.appendChild(side);

      box.appendChild(row);
    });
  }

  /* ---------------- 好友请求 ---------------- */
  function renderRequests() {
    var box = $('frRequests');
    box.innerHTML = '';

    if (!state.incoming.length && !state.outgoing.length) {
      box.appendChild(empty('没有待处理的好友请求。'));
      return;
    }

    state.incoming.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'fr-row';
      var img = document.createElement('img');
      img.className = 'fr-row__avatar';
      img.src = avatarUrl(r.avatar);
      img.alt = '';
      row.appendChild(img);
      var body = document.createElement('div');
      body.className = 'fr-row__body';
      var n = document.createElement('div');
      n.className = 'fr-row__name';
      n.textContent = r.name;
      var s = document.createElement('div');
      s.className = 'fr-row__last';
      s.textContent = '想加你为好友 · ' + fmtTime(r.at);
      body.appendChild(n);
      body.appendChild(s);
      row.appendChild(body);

      var side = document.createElement('div');
      side.className = 'fr-row__side';
      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'fr-btn';
      ok.textContent = '同意';
      ok.addEventListener('click', function () {
        ok.disabled = true;
        API.friendRespond(r.relId, 'accept').then(function (res) {
          if (res.status === 200) { refresh(); } else { ok.disabled = false; alert((res.data && res.data.error) || '失败了'); }
        });
      });
      var no = document.createElement('button');
      no.type = 'button';
      no.className = 'fr-btn fr-btn--danger';
      no.textContent = '拒绝';
      no.addEventListener('click', function () {
        no.disabled = true;
        API.friendRespond(r.relId, 'decline').then(function () { refresh(); });
      });
      side.appendChild(ok);
      side.appendChild(no);
      row.appendChild(side);
      box.appendChild(row);
    });

    state.outgoing.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'fr-row';
      var img = document.createElement('img');
      img.className = 'fr-row__avatar';
      img.src = avatarUrl(r.avatar);
      img.alt = '';
      row.appendChild(img);
      var body = document.createElement('div');
      body.className = 'fr-row__body';
      var n = document.createElement('div');
      n.className = 'fr-row__name';
      n.textContent = r.name;
      var s = document.createElement('div');
      s.className = 'fr-row__last';
      s.textContent = '等待对方同意 · ' + fmtTime(r.at);
      body.appendChild(n);
      body.appendChild(s);
      row.appendChild(body);
      var side = document.createElement('div');
      side.className = 'fr-row__side';
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'fr-btn fr-btn--ghost';
      cancel.textContent = '取消';
      cancel.addEventListener('click', function () {
        cancel.disabled = true;
        API.friendRemove(r.id).then(function () { refresh(); });
      });
      side.appendChild(cancel);
      row.appendChild(side);
      box.appendChild(row);
    });
  }

  /* ---------------- 找人 ---------------- */
  function renderResults(users) {
    var box = $('frResults');
    box.innerHTML = '';
    if (!users.length) { box.appendChild(empty('没找到这个人，昵称要写全一点。')); return; }
    var friendIds = {};
    state.friends.forEach(function (f) { friendIds[f.id] = true; });
    var pendingIds = {};
    state.outgoing.forEach(function (f) { pendingIds[f.id] = true; });

    users.forEach(function (u) {
      var row = document.createElement('div');
      row.className = 'fr-row';
      var img = document.createElement('img');
      img.className = 'fr-row__avatar';
      img.src = avatarUrl(u.avatar);
      img.alt = '';
      row.appendChild(img);
      var body = document.createElement('div');
      body.className = 'fr-row__body';
      var n = document.createElement('div');
      n.className = 'fr-row__name';
      n.textContent = u.name;
      body.appendChild(n);
      row.appendChild(body);

      var side = document.createElement('div');
      side.className = 'fr-row__side';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fr-btn';
      if (friendIds[u.id]) { btn.textContent = '已是好友'; btn.disabled = true; }
      else if (pendingIds[u.id]) { btn.textContent = '已发请求'; btn.disabled = true; }
      else {
        btn.textContent = '加好友';
        btn.addEventListener('click', function () {
          btn.disabled = true;
          API.friendRequest(u.id).then(function (res) {
            if (res.status === 200) { btn.textContent = res.data.accepted ? '已成为好友' : '已发请求'; refresh(); }
            else { btn.disabled = false; showMsg($('frSearchMsg'), (res.data && res.data.error) || '加好友失败', 'error'); }
          });
        });
      }
      side.appendChild(btn);
      row.appendChild(side);
      box.appendChild(row);
    });
  }

  /* ---------------- 聊天 ---------------- */
  function bubble(m, mine) {
    var d = document.createElement('div');
    d.className = 'fr-bubble ' + (mine ? 'fr-bubble--me' : 'fr-bubble--them');
    d.textContent = m.body;
    var t = document.createElement('span');
    t.className = 'fr-bubble__time';
    t.textContent = fmtTime(m.createdAt);
    d.appendChild(t);
    return d;
  }

  function appendMessages(list) {
    var box = $('frChatList');
    var mine = API.user() ? API.user().id : 0;
    list.forEach(function (m) {
      box.appendChild(bubble(m, m.from === mine));
      state.lastAt = Math.max(state.lastAt, m.createdAt);
    });
    box.scrollTop = box.scrollHeight;
  }

  function loadChat(since) {
    if (!state.current) return;
    return API.thread(state.current.id, since || 0).then(function (res) {
      if (res.status !== 200) return;
      var list = res.data.messages || [];
      if (!since) { $('frChatList').innerHTML = ''; state.lastAt = 0; }
      if (list.length) appendMessages(list);
    });
  }

  function openChat(friend) {
    state.current = friend;
    state.lastAt = 0;
    $('frPaneFriends').hidden = true;
    $('frPaneRequests').hidden = true;
    $('frPaneSearch').hidden = true;
    $('frPaneChat').hidden = false;
    $('frChatAvatar').src = avatarUrl(friend.avatar);
    $('frChatName').textContent = friend.name;
    $('frChatList').innerHTML = '';
    loadChat(0).then(function () { refresh(); });

    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function () { loadChat(state.lastAt); }, 4000);
  }

  function closeChat() {
    state.current = null;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    $('frPaneChat').hidden = true;
    $('frPaneFriends').hidden = false;
    refresh();
  }

  function send() {
    var input = $('frChatInput');
    var text = input.value.trim();
    if (!text || !state.current) return;
    var btn = $('frChatSend');
    btn.disabled = true;
    API.sendMessage(state.current.id, text).then(function (res) {
      btn.disabled = false;
      if (res.status === 200) {
        input.value = '';
        appendMessages([res.data.message]);
      } else {
        alert((res.data && res.data.error) || '发送失败');
      }
    });
  }

  /* 解除好友：先问一句，确认了再解，解完回到好友列表 */
  function removeFriend() {
    var f = state.current;
    if (!f) return;
    if (!confirm('解除和「' + f.name + '」的好友关系？解除后就不能再聊天了。')) return;
    var btn = $('frChatRemove');
    btn.disabled = true;
    API.friendRemove(f.id).then(function (res) {
      btn.disabled = false;
      if (res.status === 200) { closeChat(); }
      else { alert((res.data && res.data.error) || '解除失败'); }
    });
  }

  /* ---------------- 数据刷新 ---------------- */
  function refresh() {
    return Promise.all([API.friends(), API.threads()]).then(function (res) {
      if (res[0].status === 200) {
        state.friends = res[0].data.friends || [];
        state.incoming = res[0].data.incoming || [];
        state.outgoing = res[0].data.outgoing || [];
      }
      if (res[1].status === 200) state.threads = res[1].data.threads || [];
      renderFriends();
      renderRequests();

      var badge = $('frReqBadge');
      badge.hidden = state.incoming.length === 0;
      badge.textContent = state.incoming.length;

      var unread = res[1].status === 200 ? res[1].data.unread : 0;
      $('frUnread').textContent = unread > 0 ? '未读 ' + unread + ' 条' : '';
    });
  }

  /* ---------------- 标签切换 ---------------- */
  function showPane(name) {
    var panes = { friends: 'frPaneFriends', requests: 'frPaneRequests', search: 'frPaneSearch' };
    Object.keys(panes).forEach(function (k) {
      $(panes[k]).hidden = k !== name;
    });
    $('frPaneChat').hidden = true;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    state.current = null;
    $('frTabFriends').classList.toggle('is-active', name === 'friends');
    $('frTabRequests').classList.toggle('is-active', name === 'requests');
    $('frTabSearch').classList.toggle('is-active', name === 'search');
    if (name === 'friends' || name === 'requests') refresh();
  }

  /* ---------------- 启动 ---------------- */
  var user = API.user();
  if (!user || !API.token()) {
    $('frGuest').hidden = false;
    $('frToAccount').addEventListener('click', function () { location.href = 'account.html'; });
    return;
  }
  $('frMain').hidden = false;
  $('frAvatar').src = avatarUrl(user.avatar);
  $('frAvatar').onerror = function () { this.src = 'assets/img/logo-main.png'; };
  $('frName').textContent = user.name;
  $('frMeta').textContent = (user.role === 'admin' ? '管理员' : '普通成员') + ' · 加好友后就能聊天';

  $('frTabFriends').addEventListener('click', function () { showPane('friends'); });
  $('frTabRequests').addEventListener('click', function () { showPane('requests'); });
  $('frTabSearch').addEventListener('click', function () { showPane('search'); });
  $('frChatBack').addEventListener('click', closeChat);
  $('frChatRemove').addEventListener('click', removeFriend);
  $('frChatRefresh').addEventListener('click', function () { loadChat(state.lastAt); });
  $('frChatSend').addEventListener('click', send);
  $('frChatInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  $('frSearchBtn').addEventListener('click', function () {
    var q = $('frQuery').value.trim();
    if (!q) return;
    hideMsg($('frSearchMsg'));
    API.searchUsers(q).then(function (res) {
      if (res.status === 200) renderResults(res.data.users || []);
      else showMsg($('frSearchMsg'), (res.data && res.data.error) || '搜索失败', 'error');
    });
  });
  $('frQuery').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('frSearchBtn').click(); });

  refresh();
  setInterval(function () { if (!state.current) refresh(); }, 20000);
})();
