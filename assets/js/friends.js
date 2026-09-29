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

  /* 点别人的头像 / 昵称 → 打开他的主页 */
  function goProfile(id) {
    if (!id) return;
    location.href = 'user.html?id=' + id;
  }

  /* 让一块区域可点，点进去是主页（头像和昵称都用它） */
  function clickable(el, id, label) {
    if (!id) return el;
    el.classList.add('is-clickable');
    el.setAttribute('role', 'link');
    el.setAttribute('tabindex', '0');
    if (label) el.title = label;
    el.addEventListener('click', function (e) { e.stopPropagation(); goProfile(id); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goProfile(id); }
    });
    return el;
  }

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
      clickable(img, f.id, '看 ' + f.name + ' 的主页');
      row.appendChild(img);

      var body = document.createElement('div');
      body.className = 'fr-row__body';
      var name = document.createElement('div');
      name.className = 'fr-row__name';
      name.textContent = f.name;
      clickable(name, f.id, '看 ' + f.name + ' 的主页');
      var last = document.createElement('div');
      last.className = 'fr-row__last';
      last.textContent = t && t.last ? (t.last.length > 24 ? t.last.slice(0, 24) + '…' : t.last) : '点这里开始聊天';
      body.appendChild(name);
      body.appendChild(last);
      clickable(body, f.id, '看 ' + f.name + ' 的主页');
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
      clickable(img, r.id, '看 ' + r.name + ' 的主页');
      row.appendChild(img);
      var body = document.createElement('div');
      body.className = 'fr-row__body';
      var n = document.createElement('div');
      n.className = 'fr-row__name';
      n.textContent = r.name;
      clickable(n, r.id, '看 ' + r.name + ' 的主页');
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
      clickable(img, r.id, '看 ' + r.name + ' 的主页');
      row.appendChild(img);
      var body = document.createElement('div');
      body.className = 'fr-row__body';
      var n = document.createElement('div');
      n.className = 'fr-row__name';
      n.textContent = r.name;
      clickable(n, r.id, '看 ' + r.name + ' 的主页');
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
      clickable(img, u.id, '看 ' + u.name + ' 的主页');
      row.appendChild(img);
      var body = document.createElement('div');
      body.className = 'fr-row__body';
      var n = document.createElement('div');
      n.className = 'fr-row__name';
      n.textContent = u.name;
      clickable(n, u.id, '看 ' + u.name + ' 的主页');
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
  var RECALL_WINDOW = 2 * 60 * 1000;   /* 和后端一致：2 分钟内可撤回 */

  function dayLabel(ts) {
    var d = new Date(ts);
    var today = new Date();
    var same = function (a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
    var y = new Date(today.getTime() - 86400000);
    if (same(d, today)) return '今天';
    if (same(d, y)) return '昨天';
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }

  function daySeparator(ts) {
    var d = document.createElement('div');
    d.className = 'fr-day';
    d.textContent = dayLabel(ts);
    return d;
  }

  /* 撤回：长按自己刚发的消息（2 分钟内）→ 弹一个小气泡，点「撤回」才真撤 */
  function hideRecallMenu() {
    var el = $('frRecallMenu');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function doRecall(m, rowEl) {
    API.recallMessage(m.id).then(function (res) {
      if (res.status === 200) {
        markRecalled(rowEl, true);
      } else {
        alert((res.data && res.data.error) || '撤回失败');
      }
    });
  }

  function showRecallMenu(rowEl, m) {
    hideRecallMenu();
    var menu = document.createElement('div');
    menu.className = 'fr-recall-menu';
    menu.id = 'frRecallMenu';

    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'fr-recall-menu__ok';
    ok.textContent = '撤回';
    ok.addEventListener('click', function (e) {
      e.stopPropagation();
      hideRecallMenu();
      doRecall(m, rowEl);
    });

    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'fr-recall-menu__no';
    no.textContent = '取消';
    no.addEventListener('click', function (e) {
      e.stopPropagation();
      hideRecallMenu();
    });

    menu.appendChild(ok);
    menu.appendChild(no);
    rowEl.appendChild(menu);

    /* 点别处就把菜单收起来 */
    setTimeout(function () {
      document.addEventListener('click', hideRecallMenu, { once: true });
      document.addEventListener('touchstart', hideRecallMenu, { once: true });
    }, 0);
  }

  /* 把一条消息行变成「已撤回」的样子 */
  function markRecalled(rowEl, mine) {
    rowEl.classList.add('is-recalled');
    rowEl.classList.remove('is-mine', 'is-theirs');
    rowEl.innerHTML = '';
    var d = document.createElement('div');
    d.className = 'fr-recalled';
    d.textContent = mine ? '你撤回了一条消息' : '对方撤回了一条消息';
    rowEl.appendChild(d);
  }

  function messageRow(m, mine) {
    var row = document.createElement('div');
    row.className = 'fr-msgrow ' + (mine ? 'is-mine' : 'is-theirs');
    row.setAttribute('data-id', String(m.id));
    row.setAttribute('data-time', String(m.createdAt));

    if (m.recalledAt) {
      markRecalled(row, mine);
      return row;
    }

    if (!mine) {
      var img = document.createElement('img');
      img.className = 'fr-msgrow__avatar';
      img.src = avatarUrl(state.current ? state.current.avatar : '');
      img.alt = '';
      img.addEventListener('click', function () { goProfile(state.current && state.current.id); });
      row.appendChild(img);
    }

    var b = document.createElement('div');
    b.className = 'fr-bubble ' + (mine ? 'fr-bubble--me' : 'fr-bubble--them');
    var text = document.createElement('span');
    text.className = 'fr-bubble__text';
    text.textContent = m.body;
    b.appendChild(text);
    var t = document.createElement('span');
    t.className = 'fr-bubble__time';
    t.textContent = fmtTime(m.createdAt);
    b.appendChild(t);

    if (mine) {
      var canRecall = Date.now() - m.createdAt <= RECALL_WINDOW;
      if (canRecall) {
        b.classList.add('is-recallable');
        b.title = '长按撤回';
        attachLongPress(b, function () { showRecallMenu(row, m); });
      }
    }

    row.appendChild(b);
    return row;
  }

  /* 长按（手机）或按住不动（电脑）都能触发 */
  function attachLongPress(el, handler) {
    var timer = null;
    var fired = false;

    function start() {
      fired = false;
      timer = setTimeout(function () {
        fired = true;
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* 忽略 */ } }
        handler();
      }, 550);
    }
    function cancel() {
      if (timer) { clearTimeout(timer); timer = null; }
    }

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchend', cancel);
    el.addEventListener('touchmove', cancel);
    el.addEventListener('touchcancel', cancel);
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', cancel);
    el.addEventListener('mouseleave', cancel);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('click', function (e) { if (fired) { e.preventDefault(); e.stopPropagation(); } });
  }

  function appendMessages(list) {
    var box = $('frChatList');
    var mine = API.user() ? API.user().id : 0;
    var empty = $('frChatEmpty');
    if (empty) empty.style.display = 'none';

    list.forEach(function (m) {
      var prev = box.lastElementChild;
      var prevTime = prev && prev.getAttribute('data-time') ? Number(prev.getAttribute('data-time')) : 0;
      var prevIsDay = prev && prev.classList.contains('fr-day');
      if (prevIsDay) prevTime = Number(prev.getAttribute('data-day') || 0);
      if (!prevTime || dayLabel(prevTime) !== dayLabel(m.createdAt)) {
        var sep = daySeparator(m.createdAt);
        sep.setAttribute('data-day', String(m.createdAt));
        box.appendChild(sep);
      }
      box.appendChild(messageRow(m, m.from === mine));
      state.lastAt = Math.max(state.lastAt, m.createdAt);
    });
    box.scrollTop = box.scrollHeight;
  }

  function loadChat(since) {
    if (!state.current) return Promise.resolve();
    return API.thread(state.current.id, since || 0).then(function (res) {
      if (res.status !== 200) return;
      var list = res.data.messages || [];
      if (!since) { $('frChatList').innerHTML = ''; state.lastAt = 0; }
      if (list.length) appendMessages(list);
      else if (!since) {
        var empty = document.createElement('div');
        empty.className = 'fr-chat-empty';
        empty.id = 'frChatEmpty';
        empty.textContent = '还没有消息，打个招呼吧';
        $('frChatList').appendChild(empty);
      }
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
    var meta = $('frChatMeta');
    if (meta) {
      var bits = [];
      if (friend.genderText) bits.push(friend.genderText);
      if (friend.signature) bits.push(friend.signature);
      meta.textContent = bits.join(' · ');
      meta.hidden = !bits.length;
    }
    $('frChatList').innerHTML = '';
    loadChat(0).then(function () { refresh(); });
    var input = $('frChatInput');
    if (input && window.matchMedia('(min-width: 721px)').matches) input.focus();

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
  clickable($('frAvatar'), user.id, '看我的主页');
  $('frName').textContent = user.name;
  $('frMeta').textContent = (user.role === 'admin' ? '管理员' : '普通成员') + ' · 点别人头像可以看主页';

  $('frTabFriends').addEventListener('click', function () { showPane('friends'); });
  $('frTabRequests').addEventListener('click', function () { showPane('requests'); });
  $('frTabSearch').addEventListener('click', function () { showPane('search'); });
  $('frChatBack').addEventListener('click', closeChat);
  $('frChatRemove').addEventListener('click', removeFriend);
  $('frChatRefresh').addEventListener('click', function () { loadChat(state.lastAt); });
  $('frChatSend').addEventListener('click', send);
  $('frChatInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  $('frChatAvatar').addEventListener('click', function () { goProfile(state.current && state.current.id); });
  $('frChatName').addEventListener('click', function () { goProfile(state.current && state.current.id); });
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

  refresh().then(function () {
    /* 从主页点「发消息」进来时带着 #chat=用户id，直接打开会话 */
    var m = /chat=(\d+)/.exec(location.hash || '');
    if (!m) return;
    var id = Number(m[1]);
    var f = state.friends.filter(function (x) { return x.id === id; })[0];
    if (f) openChat(f);
  });
  setInterval(function () { if (!state.current) refresh(); }, 20000);
})();
