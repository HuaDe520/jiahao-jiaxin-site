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
  var state = {
    friends: [], incoming: [], outgoing: [], threads: [], groups: [],
    current: null,               /* 当前会话：好友对象 或 群对象 */
    chatKind: 'friend',          /* friend = 一对一，group = 群聊 */
    lastAt: 0, timer: null, polls: 0,
    panel: null                   /* 当前打开的群成员面板 */
  };

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
  /* 收起来的时候顺手把内容和按钮清掉：留着旧按钮在 DOM 里，
     之后新提示出来时可能点到上一个「自检 / 打开设置」 */
  function hideMsg(el) {
    el.className = 'fr-msg';
    el.textContent = '';
  }

  function empty(text) {
    var d = document.createElement('div');
    d.className = 'fr-empty';
    d.textContent = text;
    return d;
  }

  /* ---------------- 媒体消息（图片 / 语音 / 文件）的小工具 ---------------- */

  /* 正在播的那条语音：同一时间只让一条响 */
  var audioNow = { el: null, row: null, btn: null };

  function fmtDur(sec) {
    var s = Math.max(0, Math.round(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* 0.4 KB / 12.3 KB / 1.2 MB */
  function fmtSize(n) {
    var size = Number(n) || 0;
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    return (size / 1048576).toFixed(1) + ' MB';
  }

  /* 会话列表里的最后一条预览：媒体消息给一个中文标记。
     接口有时只回正文（文件名 / 语音文件名），所以再按扩展名兜一层判断 */
  function mediaMark(text) {
    var t = String(text == null ? '' : text);
    if (/\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(t)) return '[图片]';
    if (/\.(webm|m4a|ogg|opus|mp3|wav|aac|amr)$/i.test(t)) return '[语音]';
    return '';
  }

  function previewOf(last, kind) {
    if (kind === 'image') return '[图片]';
    if (kind === 'voice') return '[语音]';
    if (kind === 'file') return '[文件]';
    var t = last ? String(last) : '';
    var mark = mediaMark(t);
    if (mark) return mark + ' ' + t;
    return t.length > 24 ? t.slice(0, 24) + '…' : t;
  }

  function mediaName(m) {
    if (m.media && m.media.name) return m.media.name;
    return m.body || '文件';
  }

  /* 大图浮层：整个页面只用一个，点哪儿都能关，Esc 也行 */
  function openLightbox(url) {
    var box = $('frLightbox');
    var img = $('frLightboxImg');
    if (!box || !img || !url) return;
    img.src = url;
    box.hidden = false;
  }

  function closeLightbox() {
    var box = $('frLightbox');
    var img = $('frLightboxImg');
    if (box) box.hidden = true;
    if (img) img.removeAttribute('src');
  }

  function lightboxShowing() {
    var box = $('frLightbox');
    return !!box && !box.hidden;
  }

  /* 图片：先把占位画出来，媒体取回来再塞进 <img> */
  function imageBubble(b, m) {
    var wrap = document.createElement('span');
    wrap.className = 'fr-media';
    var img = document.createElement('img');
    img.className = 'fr-media__img';
    img.alt = '图片消息';
    wrap.appendChild(img);
    b.appendChild(wrap);
    b.classList.add('fr-bubble--media');

    var key = m.media ? m.media.key : '';
    API.mediaObjectUrl(key).then(function (url) {
      if (!url) { wrap.classList.add('is-failed'); return; }
      img.src = url;
      img.addEventListener('click', function (e) {
        e.stopPropagation();
        openLightbox(url);
      });
      img.addEventListener('load', function () { wrap.classList.add('is-ready'); });
      if (img.complete) wrap.classList.add('is-ready');
    });
    return b;
  }

  /* 语音：点气泡任意位置播放 / 暂停，只留一条在响 */
  function voiceBubble(b, m) {
    var secs = 0;
    var known = false;
    b.classList.add('fr-bubble--media');
    var v = document.createElement('span');
    v.className = 'fr-voice';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fr-voice__btn';
    btn.textContent = '▶';
    btn.title = '播放语音';

    var meta = document.createElement('span');
    meta.className = 'fr-voice__meta';
    var dur = document.createElement('span');
    dur.className = 'fr-voice__dur';
    dur.textContent = '语音';
    var bar = document.createElement('span');
    bar.className = 'fr-voice__bar';
    var fill = document.createElement('span');
    fill.className = 'fr-voice__fill';
    bar.appendChild(fill);
    meta.appendChild(dur);
    meta.appendChild(bar);
    v.appendChild(btn);
    v.appendChild(meta);
    b.appendChild(v);

    /* 音频不能直接写接口地址：接口要带登录凭证，所以先取成 blob 再塞进来 */
    var audio = (m.media && m.media.key) ? new Audio() : null;
    audio = audio || null;

    function stopMe() {
      if (audio) audio.pause();
      if (audio && audio.currentTime) { try { audio.currentTime = 0; } catch (e) { /* 忽略 */ } }
      v.classList.remove('is-playing');
      btn.textContent = '▶';
      btn.title = '播放语音';
      fill.style.width = '0%';
      if (audioNow.el === audio) { audioNow.el = null; audioNow.row = null; audioNow.btn = null; }
    }

    function toggle() {
      if (!audio) return;
      if (!audio.paused) { stopMe(); return; }
      stopOthers();
      audioObjectUrl(m, audio).then(function () {
        if (audio.paused) {
          var p = audio.play();
          if (p && p.catch) p.catch(function () { /* 浏览器不给自动播就先算了 */ });
        }
        audioNow.el = audio; audioNow.row = b; audioNow.btn = btn;
        v.classList.add('is-playing');
        btn.textContent = '⏸';
        btn.title = '暂停语音';
      });
    }

    if (audio) {
      audio.addEventListener('loadedmetadata', function () {
        if (isFinite(audio.duration) && audio.duration > 0) {
          known = true;
          secs = audio.duration;
          dur.textContent = Math.round(audio.duration) + ' 秒';
        }
      });
      audio.addEventListener('timeupdate', function () {
        if (!known || !secs) return;
        fill.style.width = Math.min(100, Math.round(audio.currentTime / secs * 100)) + '%';
      });
      audio.addEventListener('ended', stopMe);
      audio.addEventListener('error', function () { dur.textContent = '语音'; });
    }

    v.addEventListener('click', function (e) {
      e.stopPropagation();
      toggle();
    });
    btn.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  /* 音频要用带 token 的请求取回来，才能当本地地址播 */
  function audioObjectUrl(m, audio) {
    var key = m.media ? m.media.key : '';
    if (!key) return Promise.resolve('');
    if (audio.getAttribute('src')) return Promise.resolve(audio.src);
    return API.mediaObjectUrl(key).then(function (url) {
      if (url) audio.setAttribute('src', url);
      return url;
    });
  }

  /* 开始播之前，把正在响的那条先停掉 */
  function stopOthers() {
    if (!audioNow.el) return;
    try { audioNow.el.pause(); } catch (e) { /* 忽略 */ }
    if (audioNow.row) {
      audioNow.row.classList.remove('is-playing');
      var bar = audioNow.row.querySelector('.fr-voice__fill');
      if (bar) bar.style.width = '0%';
    }
    if (audioNow.btn) {
      audioNow.btn.textContent = '▶';
      audioNow.btn.title = '播放语音';
    }
    audioNow.el = null; audioNow.row = null; audioNow.btn = null;
  }

  /* 文件：图标 + 名字 + 大小 + 下载；名字一律走 textContent，绝不拼 HTML */
  function fileBubble(b, m) {
    var name = mediaName(m);
    var size = m.media ? m.media.size : 0;
    b.classList.add('fr-bubble--media');
    var f = document.createElement('span');
    f.className = 'fr-file';
    f.title = name;

    var icon = document.createElement('span');
    icon.className = 'fr-file__icon';
    icon.textContent = '📄';

    var info = document.createElement('span');
    info.className = 'fr-file__info';
    var nm = document.createElement('span');
    nm.className = 'fr-file__name';
    nm.textContent = name;
    var sz = document.createElement('span');
    sz.className = 'fr-file__size';
    sz.textContent = fmtSize(size);
    info.appendChild(nm);
    info.appendChild(sz);

    var dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'fr-file__dl';
    dl.textContent = '下载';
    dl.title = '下载 ' + name;
    dl.addEventListener('click', function (e) {
      e.stopPropagation();
      downloadFile(m.media ? m.media.key : '', name);
    });

    f.appendChild(icon);
    f.appendChild(info);
    f.appendChild(dl);
    b.appendChild(f);
  }

  /* 下载走接口的二进制（带登录凭证），点不动就给个提示 */
  function downloadFile(key, name) {
    if (!key) { chatMsg('这个文件暂时拿不到', 'error'); return; }
    API.mediaBlob(key).then(function (blob) {
      if (!blob) { chatMsg('文件下载失败，网络或登录状态可能有问题', 'error'); return; }
      var url = '';
      try { url = URL.createObjectURL(blob); } catch (e) { url = ''; }
      if (!url) { chatMsg('这台设备的浏览器不支持直接下载', 'error'); return; }
      var a = document.createElement('a');
      a.href = url;
      a.download = name || '文件';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      if (a.parentNode) a.parentNode.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ } }, 20000);
    });
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
      last.textContent = t && t.last ? previewOf(t.last, t.lastKind) : '点这里开始聊天';
      /* 预览这行点了就直接进聊天（以前错绑到「看主页」上了） */
      last.addEventListener('click', function () { openChat(f); });
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
      chat.addEventListener('click', function (e) {
        /* 别冒泡到整行，不然会开两次 */
        e.stopPropagation();
        openChat(f);
      });
      side.appendChild(chat);
      row.appendChild(side);

      /* 整行也能开聊天（跟群聊列表一致）。头像和昵称仍然是「看主页」，
         点它们不在这里处理，别抢 */
      row.classList.add('is-row-open');
      row.addEventListener('click', function (e) {
        var el = e.target;
        if (el && el.closest && el.closest('.is-clickable, button, a')) return;
        openChat(f);
      });

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
  var THEME_KEY = 'jhjx-chat-theme';
  var THEMES = ['jade', 'ink', 'night', 'candy', 'paper', 'supreme'];
  var THEME_NAMES = { jade: '青绿', ink: '简约', night: '夜间', candy: '暖阳', paper: '纸感', supreme: '至尊' };
  /* 老版本存过 genshin 这个名字，读到就自动换成 supreme */
  var THEME_ALIAS = { genshin: 'supreme' };
  var GROUP_WINDOW = 2 * 60 * 1000;    /* 同一人 2 分钟内的连续消息算一组 */

  function currentTheme() {
    try {
      var t = localStorage.getItem(THEME_KEY);
      if (THEME_ALIAS[t]) t = THEME_ALIAS[t];
      return THEMES.indexOf(t) >= 0 ? t : 'jade';
    } catch (e) { return 'jade'; }
  }

  function applyTheme(name) {
    var t = THEMES.indexOf(name) >= 0 ? name : 'jade';
    var pane = $('frPaneChat');
    if (pane) pane.setAttribute('data-chat-theme', t);
    var dots = document.querySelectorAll('#frChatStyles .fr-style-dot');
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('is-active', dots[i].getAttribute('data-theme') === t);
    }
    /* 把当前风格的名字显示在小圆点前面 */
    var label = $('frChatStyleName');
    if (label) label.textContent = THEME_NAMES[t] || '';
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* 忽略 */ }
  }

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

  function doRecall(m, rowEl) {
    API.recallMessage(m.id).then(function (res) {
      if (res.status === 200) {
        markRecalled(rowEl, true);
      } else {
        chatMsg((res.data && res.data.error) || '撤回失败', 'error');
      }
    });
  }

  /* 撤回前先确认一下：点「撤回」→ 变成「确认 / 取消」，防止手滑点错 */
  function askRecall(rowEl, m, btn) {
    var wrap = document.createElement('span');
    wrap.className = 'fr-recall-confirm';
    wrap.id = 'frRecallConfirm';

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'fr-recall-confirm__yes';
    yes.textContent = '确认';
    yes.title = '确认撤回这条消息';
    yes.addEventListener('click', function (e) {
      e.stopPropagation();
      yes.disabled = true;
      no.disabled = true;
      doRecall(m, rowEl);
    });

    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'fr-recall-confirm__no';
    no.textContent = '取消';
    no.addEventListener('click', function (e) {
      e.stopPropagation();
      closeRecallConfirm();
    });

    wrap.appendChild(yes);
    wrap.appendChild(no);
    btn.parentNode.insertBefore(wrap, btn);
    btn.hidden = true;
    wrap.__btn = btn;
  }

  /* 关掉正在确认的那条（页面里同时只留一个） */
  function closeRecallConfirm() {
    var el = $('frRecallConfirm');
    if (!el) return;
    if (el.__btn) el.__btn.hidden = false;
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  /* 把一条消息行变成「已撤回」的样子 */
  function markRecalled(rowEl, mine, m) {
    rowEl.classList.add('is-recalled');
    rowEl.classList.remove('is-mine', 'is-theirs', 'is-grouped');
    rowEl.innerHTML = '';
    var d = document.createElement('div');
    d.className = 'fr-recalled';
    /* 群里说清楚是谁撤的；一对一就还是「对方」（和微信 / QQ 一致） */
    if (mine) d.textContent = '你撤回了一条消息';
    else if (state.chatKind === 'group' && m && m.senderName) d.textContent = m.senderName + ' 撤回了一条消息';
    else d.textContent = '对方撤回了一条消息';
    rowEl.appendChild(d);
  }

  function canRecallNow(m, mine) {
    return !!mine && !m.recalledAt && (Date.now() - m.createdAt) <= RECALL_WINDOW;
  }

  /* 群里别人发的：头像 + 名字 + 气泡，竖着排一列 */
  function makeTheirs(m, grouped) {
    var wrap = document.createElement('div');
    wrap.className = 'fr-msgrow__wrap';
    if (!grouped && m.senderName) {
      var nm = document.createElement('div');
      nm.className = 'fr-msgrow__name';
      nm.textContent = m.senderName;
      clickable(nm, m.from, '看 ' + m.senderName + ' 的主页');
      wrap.appendChild(nm);
    }
    return wrap;
  }

  /* 一条消息 = [撤回按钮?] + [气泡]，对方的消息左边还带小头像 */
  function messageRow(m, mine, grouped) {
    var isGroup = state.chatKind === 'group';
    var row = document.createElement('div');
    row.className = 'fr-msgrow ' + (mine ? 'is-mine' : 'is-theirs') + (grouped ? ' is-grouped' : '');
    row.setAttribute('data-id', String(m.id));
    row.setAttribute('data-time', String(m.createdAt));
    row.setAttribute('data-mine', mine ? '1' : '0');
    row.setAttribute('data-kind', m.kind || 'text');
    if (m.readAt) row.setAttribute('data-read', '1');

    if (m.recalledAt) {
      markRecalled(row, mine, m);
      return row;
    }

    if (!mine) {
      var img = document.createElement('img');
      img.className = 'fr-msgrow__avatar';
      /* 群里每个人的头像都不一样，接口给了 senderAvatar；一对一还是用对方的 */
      var av = (isGroup && m.senderAvatar != null) ? m.senderAvatar
               : (state.current && state.current.avatar ? state.current.avatar : '');
      img.src = avatarUrl(av);
      img.alt = '';
      var pid = isGroup ? m.from : (state.current && state.current.id);
      img.addEventListener('click', function () { goProfile(pid); });
      row.appendChild(img);
    }

    var b = document.createElement('div');
    b.className = 'fr-bubble ' + (mine ? 'fr-bubble--me' : 'fr-bubble--them');
    var host = b;
    if (!mine && isGroup) {
      var wrap = makeTheirs(m, grouped);
      wrap.appendChild(b);
      row.appendChild(wrap);
      host = null;
    }

    if (m.kind === 'image') {
      imageBubble(b, m);
    } else if (m.kind === 'voice') {
      voiceBubble(b, m);
    } else if (m.kind === 'file') {
      fileBubble(b, m);
    } else {
      var text = document.createElement('span');
      text.className = 'fr-bubble__text';
      text.textContent = m.body;
      b.appendChild(text);
    }

    var t = document.createElement('span');
    t.className = 'fr-bubble__time';
    t.textContent = fmtTime(m.createdAt);
    b.appendChild(t);

    /* 自己发的、2 分钟内的消息：直接在旁边给一个「撤回」按钮，不用长按；
       点它之后会变成「确认 / 取消」，防止误触 */
    if (canRecallNow(m, mine)) {
      b.classList.add('is-recallable');
      var rb = document.createElement('button');
      rb.type = 'button';
      rb.className = 'fr-recall-btn';
      rb.textContent = '撤回';
      rb.title = '撤回这条消息';
      rb.addEventListener('click', function (e) {
        e.stopPropagation();
        if (rb.hidden) return;
        var open = $('frRecallConfirm');
        if (open) closeRecallConfirm();
        askRecall(row, m, rb);
      });
      row.appendChild(rb);
    }

    if (host) row.appendChild(b);
    return row;
  }

  /* 到点了就把「撤回」按钮收掉（不用刷新页面） */
  function sweepRecall() {
    var rows = document.querySelectorAll('#frChatList .fr-msgrow.is-mine');
    var now = Date.now();
    for (var i = 0; i < rows.length; i++) {
      var btn = rows[i].querySelector('.fr-recall-btn');
      if (!btn) continue;
      if (now - Number(rows[i].getAttribute('data-time') || 0) > RECALL_WINDOW) {
        var confirmBox = rows[i].querySelector('#frRecallConfirm');
        if (confirmBox) closeRecallConfirm();
        if (btn.parentNode) btn.parentNode.removeChild(btn);
        var b = rows[i].querySelector('.fr-bubble');
        if (b) b.classList.remove('is-recallable');
      }
    }
  }

  /* 只在最后一条自己发的消息上标「已读」，跟常见聊天软件一致 */
  function markReadState() {
    var box = $('frChatList');
    var marks = box.querySelectorAll('.fr-bubble__read');
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].parentNode) marks[i].parentNode.removeChild(marks[i]);
    }
    var mineRows = box.querySelectorAll('.fr-msgrow.is-mine');
    for (var j = mineRows.length - 1; j >= 0; j--) {
      var bubble = mineRows[j].querySelector('.fr-bubble');
      if (!bubble) continue;
      if (mineRows[j].getAttribute('data-read') === '1') {
        var s = document.createElement('span');
        s.className = 'fr-bubble__read';
        s.textContent = '已读';
        bubble.appendChild(s);
      }
      break;   /* 只看最后一条 */
    }
  }

  function nearBottom(box) {
    return box.scrollHeight - box.scrollTop - box.clientHeight < 90;
  }

  function appendMessages(list) {
    var box = $('frChatList');
    var mine = API.user() ? API.user().id : 0;
    var empty = $('frChatEmpty');
    if (empty) empty.style.display = 'none';

    list.forEach(function (m) {
      var prev = box.lastElementChild;
      var prevTime = 0;
      var prevMine = null;
      if (prev && !prev.classList.contains('fr-day')) {
        prevTime = Number(prev.getAttribute('data-time') || 0);
        prevMine = prev.getAttribute('data-mine') === '1';
      } else if (prev) {
        prevTime = Number(prev.getAttribute('data-day') || 0);
      }
      if (!prevTime || dayLabel(prevTime) !== dayLabel(m.createdAt)) {
        var sep = daySeparator(m.createdAt);
        sep.setAttribute('data-day', String(m.createdAt));
        box.appendChild(sep);
        prevMine = null;
        prevTime = 0;
      }
      var isMine = m.from === mine;
      var grouped = prevMine === isMine && prevTime && (m.createdAt - prevTime) < GROUP_WINDOW;
      box.appendChild(messageRow(m, isMine, grouped));
      state.lastAt = Math.max(state.lastAt, m.createdAt);
    });
    markReadState();
  }

  function showNewMsgHint(show) {
    var el = $('frChatToBottom');
    if (!el) return;
    el.hidden = !show;
  }

  function loadChat(since) {
    if (!state.current) return Promise.resolve();
    var box = $('frChatList');
    var fid = state.current.id;                       /* 记下这次请求是发给谁的 */
    var kind = state.chatKind === 'group' ? 'group' : 'friend';
    var req = kind === 'group' ? API.groupMessages(fid, since || 0) : API.thread(fid, since || 0);
    return req.then(function (res) {
      watchAuth(res);
      /* 请求飞在路上时用户可能已经切到别的会话了，那就别把旧数据画进去 */
      if (!state.current || state.current.id !== fid || state.chatKind !== kind) return;
      if (res.status !== 200) return;
      var list = res.data.messages || [];
      if (kind === 'group') {
        /* 群里顺手把最新的成员 / 人数带回来（别人中途进群也能看到） */
        if (res.data.group) {
          state.current = Object.assign({}, state.current, res.data.group);
          updateChatMeta(state.current);
          if (state.panel === 'members') renderMemberPanel();
        }
      } else if (res.data.friend) {
        /* 接口会把对方最新的性别 / 签名一起带回来，这里补上顶部那行小字
           （好友列表里的数据没有这两个字段，所以必须用它） */
        state.current = Object.assign({}, state.current, res.data.friend);
        updateChatMeta(state.current);
      }
      var wasNearBottom = nearBottom(box);
      var keepTop = box.scrollTop;
      if (!since) { box.innerHTML = ''; state.lastAt = 0; }
      if (list.length) {
        appendMessages(list);
        if (wasNearBottom) {
          box.scrollTop = box.scrollHeight;
          showNewMsgHint(false);
        } else if (since) {
          showNewMsgHint(true);
        } else {
          box.scrollTop = Math.min(keepTop, box.scrollHeight);
        }
      } else if (!since) {
        var empty = document.createElement('div');
        empty.className = 'fr-chat-empty';
        empty.id = 'frChatEmpty';
        empty.textContent = kind === 'group' ? '群里还没人说话，说一句吧' : '还没有消息，打个招呼吧';
        box.appendChild(empty);
      }
      sweepRecall();
      updateComposer();
    });
  }

  /* 聊天顶部：一对一显示对方的「性别 · 签名」，群聊显示人数 */
  function updateChatMeta(friend) {
    var meta = $('frChatMeta');
    if (!meta || !friend) return;
    if (state.chatKind === 'group') {
      var n = Number(friend.memberCount || (friend.members ? friend.members.length : 0)) || 0;
      meta.textContent = n ? n + ' 人 · 点「成员」看名单' : '群聊';
      meta.hidden = false;
      return;
    }
    var bits = [];
    if (friend.genderText) bits.push(friend.genderText);
    if (friend.signature) bits.push(friend.signature);
    meta.textContent = bits.join(' · ');
    meta.hidden = !bits.length;
  }

  /* 群成员面板：谁在群里、谁是群主，群主 / 管理员还能顺手拉人 */
  function closeMemberPanel() {
    var panel = $('frMemberPanel');
    if (panel) { panel.hidden = true; panel.innerHTML = ''; }
    state.panel = null;
    var btn = $('frChatMembers');
    if (btn) btn.classList.remove('is-active');
  }

  function renderMemberPanel() {
    var panel = $('frMemberPanel');
    if (!panel || state.chatKind !== 'group' || !state.current) return;
    panel.innerHTML = '';

    var g = state.current;
    var head = document.createElement('div');
    head.className = 'fr-members__head';
    head.textContent = g.name + ' · ' + (g.members ? g.members.length : 0) + ' 人';
    panel.appendChild(head);

    var list = document.createElement('div');
    list.className = 'fr-members__list';
    (g.members || []).forEach(function (mem) {
      var row = document.createElement('div');
      row.className = 'fr-member';
      var img = document.createElement('img');
      img.className = 'fr-member__avatar';
      img.src = avatarUrl(mem.avatar);
      img.alt = '';
      img.addEventListener('click', function () { goProfile(mem.id); });
      row.appendChild(img);
      var nm = document.createElement('span');
      nm.className = 'fr-member__name';
      nm.textContent = mem.name;
      clickable(nm, mem.id, '看 ' + mem.name + ' 的主页');
      row.appendChild(nm);
      if (mem.role === 'owner' || (g.owner && mem.id === g.owner)) {
        var tag = document.createElement('span');
        tag.className = 'fr-member__role';
        tag.textContent = '群主';
        row.appendChild(tag);
      }
      list.appendChild(row);
    });
    panel.appendChild(list);

    var me = API.user();
    var canManage = !!g.canManage || (me && g.owner === me.id);
    if (canManage) {
      var add = document.createElement('button');
      add.type = 'button';
      add.className = 'fr-btn fr-btn--ghost fr-members__add';
      add.textContent = '拉好友进群';
      add.addEventListener('click', function () { pickFriends('invite', g); });
      panel.appendChild(add);
    }

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'fr-btn fr-btn--ghost fr-members__close';
    close.textContent = '收起';
    close.addEventListener('click', closeMemberPanel);
    panel.appendChild(close);
  }

  function toggleMemberPanel() {
    var panel = $('frMemberPanel');
    if (!panel || state.chatKind !== 'group') return;
    if (state.panel === 'members') { closeMemberPanel(); return; }
    state.panel = 'members';
    renderMemberPanel();
    panel.hidden = false;
    var btn = $('frChatMembers');
    if (btn) btn.classList.add('is-active');
  }

  /* 正在聊天时给页面加个标记：把「我的」卡片和标签收起来，整屏让给聊天。
     不认 :has() 的老浏览器就靠这个类（规则在 friends.css 里） */
  function setChatting(on) {
    var body = document.body;
    if (!body) return;
    if (on) body.classList.add('is-chatting');
    else body.classList.remove('is-chatting');
  }

  function openGroupChat(group) {
    state.chatKind = 'group';
    state.current = group;
    state.lastAt = 0;
    state.polls = 0;
    closeMemberPanel();
    setChatting(true);
    hidePane('frPaneFriends');
    hidePane('frPaneRequests');
    hidePane('frPaneSearch');
    hidePane('frPaneGroups');
    $('frPaneChat').hidden = false;
    $('frChatAvatar').hidden = true;
    $('frChatName').textContent = group.name;
    updateChatMeta(group);
    $('frChatMembers').hidden = false;
    applyTheme(currentTheme());
    $('frChatList').innerHTML = '';
    showNewMsgHint(false);
    loadChat(0).then(function () { refresh(); });
    updateComposer();
    setupChatView();
    startPolling();
  }

  /* 开始轮询：一对一和群聊共用同一条轮询（每 4 秒一次） */
  function startPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function () {
      /* 页面在后台（切到别的 App）就别一直请求了，回来看时再拉 */
      if (document.hidden) return;
      state.polls = (state.polls || 0) + 1;
      /* 每 4 次（约 16 秒）整体重拉一遍：这样对方撤回、已读状态也能跟着更新 */
      if (state.polls % 4 === 0) loadChat(0);
      else loadChat(state.lastAt);
    }, 4000);
  }

  function openChat(friend) {
    state.chatKind = 'friend';
    state.current = friend;
    state.lastAt = 0;
    state.polls = 0;
    closeMemberPanel();
    setChatting(true);
    hidePane('frPaneFriends');
    hidePane('frPaneRequests');
    hidePane('frPaneSearch');
    hidePane('frPaneGroups');
    $('frPaneChat').hidden = false;
    $('frChatAvatar').hidden = false;
    $('frChatAvatar').src = avatarUrl(friend.avatar);
    $('frChatName').textContent = friend.name;
    $('frChatMembers').hidden = true;
    updateChatMeta(friend);
    applyTheme(currentTheme());
    $('frChatList').innerHTML = '';
    showNewMsgHint(false);
    loadChat(0).then(function () { refresh(); });
    var input = $('frChatInput');
    if (input && window.matchMedia('(min-width: 721px)').matches) input.focus();
    updateComposer();
    setupChatView();
    startPolling();
  }

  function closeChat() {
    var to = state.chatKind === 'group' ? 'groups' : 'friends';
    state.current = null;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    closeMemberPanel();
    setChatting(false);
    showPane(to);
    showNewMsgHint(false);
    refresh();
    sizeChatBox();
  }

  /* 输入框跟着内容长高（最多 4 行） */
  function updateComposer() {
    var input = $('frChatInput');
    if (!input) return;
    input.style.height = 'auto';
    var max = 4 * 24 + 24;
    input.style.height = Math.min(input.scrollHeight, max) + 'px';
    sizeChatBox();
  }

  /* 手机上聊天要占满屏幕：量一下这个卡片上面还剩多少、下面还剩多少，
     写成 CSS 变量 --fr-chat-h，让聊天区正好铺满「页头到屏幕底」这一段。
     桌面端（>720px）不动，还是现在那个居中的窄卡片。 */
  function sizeChatBox() {
    var chat = document.querySelector('#frPaneChat .fr-chat');
    var pane = $('frPaneChat');
    if (!chat) return;
    if (!pane || pane.hidden || window.innerWidth > 720) {
      chat.style.removeProperty('--fr-chat-h');
      return;
    }
    var box = chat.parentNode;
    var cs = box && window.getComputedStyle ? window.getComputedStyle(box) : null;
    var padBottom = cs ? parseFloat(cs.paddingBottom) || 0 : 0;
    var gap = 8;                                  /* 底下留一点点气口 */
    /* 卡片在文档里的位置 = 视口里的位置 + 已经滚过的距离（滚动会改变前者） */
    var rect = chat.getBoundingClientRect();
    var docTop = rect.top + (window.pageYOffset || document.documentElement.scrollTop || 0);
    var h = Math.round(window.innerHeight - docTop - padBottom - gap);
    var min = 380;
    if (h < min) h = min;
    chat.style.setProperty('--fr-chat-h', h + 'px');
  }

  /* 打开会话时：先滚到聊天区，再按「页头到屏幕底」这一段重算高度。
     顺序很重要：滚动会改变卡片顶端的测量值，量之前得先滚到位 */
  function setupChatView() {
    scrollToChat();
    sizeChatBox();
  }

  /* 打开会话时把聊天区顶到屏幕上沿（页头下面），别让它掉在屏幕外面 */
  function scrollToChat() {
    if (window.innerWidth > 720) return;
    var head = document.querySelector('.site-header');
    var h = head ? head.getBoundingClientRect().height : 0;
    if (!h || h < 20) h = 60;
    try {
      window.scrollTo(0, Math.max(0, Math.round(h)));
    } catch (e) { /* 忽略 */ }
  }

  /* 发送：一对一和群聊共用，发完把消息画进当前会话 */
  function sendPayload(payload) {
    if (!state.current) return Promise.resolve(null);
    var id = state.current.id;
    var kind = state.chatKind === 'group' ? 'group' : 'friend';
    var req = kind === 'group' ? API.sendGroupMessage(id, payload) : API.sendMessage(id, payload);
    return req.then(function (res) {
      /* 发完切走了会话的话，就别把这条画到别人头上（消息其实已经发出去了） */
      if (!state.current || state.current.id !== id || state.chatKind !== kind) return res;
      if (res.status === 200 && res.data && res.data.message) {
        appendMessages([res.data.message]);
        var box = $('frChatList');
        box.scrollTop = box.scrollHeight;
        showNewMsgHint(false);
        sweepRecall();
      } else if (res.status !== 200) {
        chatMsg((res.data && res.data.error) || '发送失败', 'error');
      }
      return res;
    });
  }

  function send() {
    var input = $('frChatInput');
    var text = input.value.replace(/\s+$/, '');
    if (!text.trim() || !state.current) return;
    /* 连按两次回车（或者点两下发送）时，第一下还没回来就别再发第二条 */
    if (state.sending) return;
    state.sending = true;
    var btn = $('frChatSend');
    if (btn) btn.disabled = true;
    var done = function () {
      state.sending = false;
      if (btn) btn.disabled = false;
    };
    sendPayload({ body: text, kind: 'text' }).then(function () {
      if (input.value === text) { input.value = ''; updateComposer(); }
      done();
    }, done);
  }

  /* ---- 媒体：图片 / 语音 / 文件 ---- */
  function setComposerBusy(flag) {
    var ids = ['frChatImage', 'frChatVoice', 'frChatFile', 'frChatSend'];
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (el) el.disabled = !!flag;
    }
  }

  function sendMedia(kind, media, name) {
    var done = function () { setComposerBusy(false); };
    if (!state.current) { done(); return; }
    setComposerBusy(true);
    sendPayload({ body: name || '', kind: kind, media: media }).then(done, done);
  }

  /* ---- 图片：先压一压再传（太大传不上去，也费流量） ---- */
  var IMG_MAX = 3 * 1024 * 1024;
  var IMG_TRIES = [
    { long: 1600, q: 0.82 },
    { long: 1280, q: 0.75 },
    { long: 1024, q: 0.70 }
  ];

  function readDataUrl(file) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { resolve(''); };
      fr.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      try {
        canvas.toBlob(function (b) { resolve(b || null); }, type, quality);
      } catch (e) { resolve(null); }
    });
  }

  function shrinkImage(img, long, quality) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h) return Promise.resolve(null);
    var scale = Math.min(1, long / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    /* 压成 JPEG 之后没有透明通道了，先铺一层白底，免得透明处变黑 */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvasToBlob(canvas, 'image/jpeg', quality);
  }

  function prepareImage(file) {
    /* GIF 直接原样传：压成 JPEG 就不动了 */
    if (file.type === 'image/gif' && file.size <= 2 * 1024 * 1024) {
      return Promise.resolve({ blob: file, name: file.name || 'image.gif' });
    }
    return readDataUrl(file).then(function (url) {
      if (!url) return { blob: file, name: file.name || 'image.jpg' };
      return loadImage(url).then(function (img) {
        if (!img) return { blob: file, name: file.name || 'image.jpg' };
        var i = 0;
        function attempt() {
          if (i >= IMG_TRIES.length) return Promise.resolve({ blob: file, name: file.name || 'image.jpg' });
          var t = IMG_TRIES[i++];
          return shrinkImage(img, t.long, t.q).then(function (blob) {
            if (!blob) return { blob: file, name: file.name || 'image.jpg' };
            if (blob.size <= IMG_MAX) return { blob: blob, name: 'image.jpg' };
            return attempt();
          });
        }
        return attempt();
      });
    });
  }

  /* 上传成功之后就发一条对应的消息 */
  function handleImageFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { chatMsg('这个文件看起来不是图片', 'error'); return; }
    setComposerBusy(true);
    prepareImage(file).then(function (out) {
      return API.uploadMedia('image', out.blob, out.name);
    }).then(function (res) {
      setComposerBusy(false);
      if (res.status === 200 && res.data && res.data.media) {
        var media = res.data.media;
        sendMedia('image', media, media.name || '');
      } else {
        chatMsg((res.data && res.data.error) || '图片发不出去，换一张试试', 'error');
      }
    }, function () { setComposerBusy(false); });
  }

  function handleChatFile(file) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      chatMsg('文件请控制在 4MB 以内，大文件先压一压再发', 'error');
      return;
    }
    setComposerBusy(true);
    API.uploadMedia('file', file, file.name || '文件').then(function (res) {
      setComposerBusy(false);
      if (res.status === 200 && res.data && res.data.media) {
        var media = res.data.media;
        sendMedia('file', media, media.name || file.name || '文件');
      } else {
        chatMsg((res.data && res.data.error) || '文件发不出去，稍后再试', 'error');
      }
    }, function () { setComposerBusy(false); });
  }

  /* ---- 语音：录一段发出去（最长 60 秒） ---- */
  var micSupported = !!(
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia &&
    typeof window.MediaRecorder !== 'undefined'
  );

  /* 手机 App 1.11 起自带原生录音：App 里优先用它，绕开 WebView 的 getUserMedia。
     踩过的坑：有些机型系统权限明明给了，WebView 里 getUserMedia 还是
     NotReadableError，网页这边怎么重试都没用——所以干脆让 App 自己录。 */
  function nativeRecAvailable() {
    try {
      return !!(window.JHJX_APP
        && typeof window.JHJX_APP.nativeRecStart === 'function'
        && typeof window.JHJX_APP.nativeRecStop === 'function'
        && (typeof window.JHJX_APP.nativeRecSupported !== 'function'
            || window.JHJX_APP.nativeRecSupported() === true));
    } catch (e) { return false; }
  }

  /* mode: '' 没在录 / 'app' 原生录音 / 'web' 网页录音
     gen 是「这一轮录音」的编号：过期的回调（上一轮录音的 onstop 迟到）会被它挡掉，
     免得空录一段又发出去，用户看到「这段语音没录上」 */
  var rec = { recorder: null, stream: null, chunks: [], name: '', startedAt: 0, timer: null, wantCancel: false, mime: '', mode: '', gen: 0 };

  function pickRecMime() {
    var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    if (!window.MediaRecorder || !window.MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < list.length; i++) {
      if (window.MediaRecorder.isTypeSupported(list[i])) return list[i];
    }
    return '';
  }

  function recTicks() {
    var sec = (Date.now() - rec.startedAt) / 1000;
    var el = $('frRecTime');
    if (el) el.textContent = fmtDur(sec);
    /* recorder 自己挂了（有些机型会直接 inactive），录音条要收掉、话筒要还回去，
       否则下一次点「语音」会被「已经有一个 recorder」挡住，表现就是点了没反应 */
    if (rec.mode === 'web' && rec.recorder && rec.recorder.state === 'inactive') {
      finishWebRec(false, rec.gen);
      return;
    }
    if (sec >= 60) stopRecording(false);
  }

  function releaseMic() {
    if (!rec.stream) return;
    try {
      var tracks = rec.stream.getTracks();
      for (var i = 0; i < tracks.length; i++) tracks[i].stop();
    } catch (e) { /* 忽略 */ }
    rec.stream = null;
  }

  function hideRecBar() {
    var bar = $('frRecBar');
    if (bar) bar.hidden = true;
  }

  function clearRecTimer() {
    if (rec.timer) { clearInterval(rec.timer); rec.timer = null; }
  }

  function showRecBar() {
    var bar = $('frRecBar');
    if (bar) bar.hidden = false;
    var t = $('frRecTime');
    if (t) t.textContent = '0:00';
    clearRecTimer();
    rec.timer = setInterval(recTicks, 250);
  }

  /* 把状态整个清干净：任何一条失败路径都要走到这里，
     不然留下的半个 recorder / 话筒会让后面每次点「语音」都毫无反应 */
  function resetRecState() {
    clearRecTimer();
    rec.gen += 1;
    rec.mode = '';
    rec.recorder = null;
    rec.chunks = [];
    rec.mime = '';
    rec.name = '';
    rec.startedAt = 0;
    rec.wantCancel = false;
    releaseMic();
    hideRecBar();
  }

  /* 网页录音的收尾（onstop / 超时 / recorder 自己死了 都汇到这里）。
     gen 对不上就说明这是上一轮录音的迟到回调，直接丢掉。 */
  var webFinishing = false;
  function finishWebRec(giveUp, gen) {
    if (gen !== undefined && gen !== rec.gen) return;
    if (webFinishing) return;
    webFinishing = true;
    var type = rec.mime || 'audio/webm';
    var chunks = rec.chunks;
    var name = rec.name || 'voice.webm';
    var blob = null;
    try { blob = new Blob(chunks, { type: type }); } catch (e) { blob = null; }
    resetRecState();
    webFinishing = false;
    if (!giveUp) {
      try { sendRecording(blob, name); } catch (e) { chatMsg('语音发不出去，稍后再试', 'error'); }
    }
  }

  /* wantCancel = true 表示用户点了「取消」，录到的东西直接丢掉 */
  function stopRecording(wantCancel) {
    rec.wantCancel = !!wantCancel;
    clearRecTimer();
    if (rec.mode === 'app') {
      stopNativeRec(!!wantCancel);
      return;
    }
    var gen = rec.gen;
    var canc = !!wantCancel;
    if (rec.recorder && rec.recorder.state !== 'inactive') {
      /* 先把已有的数据要出来再停：某些机型上 stop() 之后最后一段数据来不及进 chunks，
         结果 blob 是空的，用户看到的就是「发不了语音」 */
      try { if (rec.recorder.requestData) rec.recorder.requestData(); } catch (e) { /* 忽略 */ }
      try { rec.recorder.stop(); } catch (e) { /* 忽略 */ }
      /* onstop 里会 finishWebRec；万一这个机型压根不回调，1.5 秒后兜底 */
      setTimeout(function () {
        if (gen === rec.gen && rec.mode === 'web' && rec.recorder && rec.recorder.state === 'inactive') {
          finishWebRec(canc, gen);
        }
      }, 1500);
      return;
    }
    /* 没在录（或者 recorder 已经 inactive 却没人收尾）：直接清干净 */
    finishWebRec(canc, gen);
  }

  /* ---------------- App 原生录音 ---------------- */
  function b64ToBlob(b64, mime) {
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'audio/mp4' });
  }

  function stopNativeRec(wantCancel) {
    var raw = '';
    try {
      if (wantCancel && typeof window.JHJX_APP.nativeRecCancel === 'function') {
        window.JHJX_APP.nativeRecCancel();
        resetRecState();
        return;
      }
      raw = String(window.JHJX_APP.nativeRecStop() || '');
    } catch (e) {
      raw = '';
    }
    var out = null;
    try { out = JSON.parse(raw); } catch (e) { out = null; }
    var name = (out && out.name) || 'voice.m4a';
    var mime = (out && out.mime) || 'audio/mp4';
    resetRecState();
    if (!out || !out.ok) {
      var why = (out && out.error) || 'App 录音没成功';
      chatMsg(why + '：再点一次「语音」试试；也可以先发文字。', 'error');
      return;
    }
    var blob = null;
    try { blob = b64ToBlob(out.b64, mime); } catch (e) { blob = null; }
    sendRecording(blob, name);
  }

  /* ---------------- 麦克风自检（录不了音时给个准话） ---------------- */
  function micSelfCheck() {
    var lines = [];
    lines.push('App 版本 ' + (window.JHJX_APP && window.JHJX_APP.version ? String(window.JHJX_APP.version()) : '（不在 App 里）'));
    lines.push('系统权限 ' + (appMicState() || '读不到'));
    var probe = '';
    try {
      if (window.JHJX_APP && typeof window.JHJX_APP.micProbe === 'function') probe = String(window.JHJX_APP.micProbe() || '');
    } catch (e) { probe = ''; }
    var pj = null;
    try { pj = JSON.parse(probe); } catch (e) { pj = null; }
    if (pj) lines.push('App 直接开话筒 ' + (pj.capture ? '可以' : '不行（' + (pj.error || '未知原因') + '）'));
    if (!micSupported) {
      chatMsg(lines.join('；') + '；网页这边不支持录音。把你的手机型号和这句话发给管理员就行。', 'error');
      return;
    }
    chatMsg(lines.join('；') + '；正在试网页录音…', 'ok');
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      releaseStream(stream);
      chatMsg(lines.join('；') + '；网页录音也可以。再点一次「语音」就能录了。', 'ok');
    }, function (err) {
      noteMicDiag(err);
      lines.push('网页开话筒失败：' + ((err && err.name) || '未知'));
      chatMsg(lines.join('；') + '。把你手机型号和这句话发给管理员就行。', 'error');
    });
  }

  function releaseStream(stream) {
    try {
      var tracks = stream.getTracks();
      for (var i = 0; i < tracks.length; i++) tracks[i].stop();
    } catch (e) { /* 忽略 */ }
  }

  function sendRecording(blob, name) {
    if (!blob || !blob.size) {
      chatMsg('这段语音没录上：多半是点得太快了。点「语音」之后说一两秒，再点「发送」。', 'error', '再试一次', function () {
        hideMsg($('frChatMsg'));
        startRecording();
      });
      return;
    }
    /* 太短的录音在一些机型上会是空壳（有字节但没声音），提示一下别以为是坏了 */
    if (blob.size < 800) {
      chatMsg('录得太短了（不到一秒），点「语音」后多讲两句再发。', 'error', '再试一次', function () {
        hideMsg($('frChatMsg'));
        startRecording();
      });
      return;
    }
    API.uploadMedia('voice', blob, name || 'voice.webm').then(function (res) {
      if (res.status === 200 && res.data && res.data.media) {
        var media = res.data.media;
        sendMedia('voice', media, media.name || '');
      } else {
        chatMsg((res.data && res.data.error) || '语音发不出去，稍后再试', 'error');
      }
    }, function () { chatMsg('网络不太好，语音没传上去，再试一次', 'error'); });
  }

  /* 聊天区里的一行提示（比 alert 友好，手机上尤其明显），9 秒后自己收起来。
     第三个参数可选：给一个「点一下就能去处理」的按钮，比如「打开设置」。 */
  var chatMsgTimer = 0;
  function chatMsg(text, kind, actionLabel, action) {
    var el = $('frChatMsg');
    if (!el) { alert(text); return; }
    /* 上一次的按钮先摘掉，别让「自检 / 打开设置」叠在一起点错 */
    var stale = el.querySelectorAll('.fr-msg__act');
    for (var i = 0; i < stale.length; i++) el.removeChild(stale[i]);
    el.textContent = text;
    el.className = 'fr-msg is-show is-' + (kind || 'ok');
    if (actionLabel && action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fr-msg__act';
      btn.textContent = actionLabel;
      btn.addEventListener('click', function () { try { action(); } catch (e) { /* 忽略 */ } });
      el.appendChild(btn);
    }
    if (chatMsgTimer) clearTimeout(chatMsgTimer);
    chatMsgTimer = setTimeout(function () { hideMsg(el); }, 12000);
  }

  /* 手机 App 1.7 才带麦克风权限桥：更早的版本在 App 里必然录不了音 */
  function appTooOldForMic() {
    if (!window.JHJX_APP || typeof window.JHJX_APP.version !== 'function') return false;
    try {
      var v = String(window.JHJX_APP.version() || '');
      return !!v && parseFloat(v) < 1.7;
    } catch (e) { return false; }
  }

  /* App 版本比 v 老吗（读不到版本时当作不老，别乱劝人更新） */
  function appOlderThan(v) {
    if (!window.JHJX_APP || typeof window.JHJX_APP.version !== 'function') return false;
    try {
      var cur = String(window.JHJX_APP.version() || '');
      return !!cur && cur !== v && parseFloat(cur) < parseFloat(v);
    } catch (e) { return false; }
  }

  /* App 里有原生录音时就不用再劝更新了 */
  function nativeUpgradeHint() {
    if (nativeRecAvailable()) return '';
    if (!window.JHJX_APP || !appOlderThan('1.11')) return '';
    return '装 1.11 版之后，App 里改用手机自带的录音，这种毛病就不会再出现了（在「下载」页点「检查更新」）。';
  }

  /* App 自己知不知道麦克风权限的状态（1.9 起提供）：granted / denied / prompt */
  function appMicState() {
    try {
      if (window.JHJX_APP && typeof window.JHJX_APP.micState === 'function') {
        return String(window.JHJX_APP.micState() || '');
      }
    } catch (e) { /* 忽略 */ }
    return '';
  }

  /* 留在页面上方便排查：用户截图/报错时能看到到底哪种失败 */
  function noteMicDiag(err) {
    try {
      window.jhjxMicDiag = {
        name: (err && err.name) || 'unknown',
        message: (err && err.message) || '',
        supported: micSupported,
        inApp: !!window.JHJX_APP,
        appVersion: (window.JHJX_APP && window.JHJX_APP.version) ? String(window.JHJX_APP.version()) : '',
        appMicState: appMicState(),
        secure: location.protocol === 'https:',
        at: new Date().toISOString(),
      };
    } catch (e) { /* 忽略 */ }
  }

  /* 录音失败要说清「是哪种失败、下一步怎么办」。
     踩过的坑：手机上 NotReadableError 大多数不是「别的应用占着」，
     而是权限没给全 / 系统隐私开关关着，所以别再甩锅给别的应用。 */
  function micFailHint(err) {
    var name = (err && err.name) || '';
    var ua = (navigator && navigator.userAgent) || '';
    var inApp = !!window.JHJX_APP;
    var tag = name ? '（' + name + '）' : '';
    if (appTooOldForMic()) {
      return '手机 App 要更新到 1.8 才能录音：在 App 里点「检查更新」，或到官网下载页装新版；也可以先发文字。';
    }
    if (!micSupported) {
      if (/MicroMessenger/i.test(ua)) {
        return '微信里打开的页面不能录音：点右上角「⋯」→「在浏览器打开」，再点「语音」；也可以先发文字。';
      }
      if (location.protocol !== 'https:' && location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') {
        return '录音要在 https 的页面里才能用，现在这个地址不行；也可以先发文字。';
      }
      return '这个浏览器不支持录音：换 Chrome / Safari / Edge 打开，或者直接发文字。';
    }
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      if (inApp) {
        return '麦克风权限还没给：到手机「设置 → 应用 → 掌上嘉协 → 权限」里打开「麦克风」，回来再点一次「语音」。'
          + nativeUpgradeHint() + tag;
      }
      return '麦克风权限被拒了：点浏览器地址栏左边的锁图标 → 把「麦克风」改成「允许」，再点一次「语音」。' + tag;
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return '这台设备上没找到麦克风；也可以先发文字。' + tag;
    }
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
      var up = nativeUpgradeHint();
      if (inApp) {
        var extra = appMicState() === 'denied' ? '（现在设置里是「已拒绝」）' : '';
        return '麦克风打不开，多半是权限或隐私开关没放开' + extra
          + '：到「设置 → 应用 → 掌上嘉协 → 权限」打开麦克风（有「隐私保护 / 麦克风」开关的机型也一并打开），再点一次「语音」。'
          + (up ? up : '') + tag;
      }
      return '浏览器打不开麦克风：先看系统隐私设置里有没有允许浏览器用麦克风'
        + '（Windows：设置 → 隐私 → 麦克风；手机：应用权限），再看有没有别的通话 / 录音 / 会议软件正占着。' + tag;
    }
    if (name === 'NotSupportedError') {
      return '这个浏览器不认这种录音格式：换 Chrome / Safari 试试，或者先发文字。' + tag;
    }
    return '录音没起来' + (err && err.message ? '（' + err.message + '）' : '') + '；也可以先发文字。';
  }

  /* 菜单里点「语音」：先看能不能录，再开始录。
     顺序很重要——先把话筒拿到手，再问系统权限。
     以前是反过来（先问权限、再轮询 20 秒），权限状态读不准时就变成
     「点了没反应，录音条也不出来」。 */
  function startRecording() {
    if (rec.mode) {
      /* 已经在录了：当没事发生，别把录音条弄乱 */
      return;
    }
    /* 上一轮的提示（含「自检 / 打开设置」按钮）先收掉，免得点错 */
    hideMsg($('frChatMsg'));
    /* 上一轮留下的残骸先清干净，否则会被挡住 */
    if (rec.recorder || rec.stream) resetRecState();
    if (nativeRecAvailable()) {
      startNativeRec(0);
      return;
    }
    if (!micSupported) {
      chatMsg(micFailHint(null), 'error', '自检', micSelfCheck);
      return;
    }
    startRecordingTry(0);
  }

  /* App 原生录音：录到哪个文件、怎么编码都由 App 管，网页只管开关 */
  function startNativeRec(attempt) {
    var out = '';
    try { out = String(window.JHJX_APP.nativeRecStart() || ''); } catch (e) { out = ''; }
    if (out === 'ok') {
      hideMsg($('frChatMsg'));
      rec.mode = 'app';
      rec.startedAt = Date.now();
      showRecBar();
      return;
    }
    /* 权限没给：去要一次，拿到再录（最多等 8 秒，绝不干等 20 秒） */
    if (attempt === 0 && appMicState() !== 'granted' && typeof window.JHJX_APP.askMic === 'function') {
      chatMsg('正在申请麦克风权限，请在系统弹窗里点「允许」…', 'ok');
      try { window.JHJX_APP.askMic(); } catch (e) { /* 忽略 */ }
      var waited = 0;
      var timer = setInterval(function () {
        waited += 500;
        if (appMicState() === 'granted') {
          clearInterval(timer);
          startNativeRec(1);
          return;
        }
        if (waited >= 8000) {
          clearInterval(timer);
          micDeniedChat();
        }
      }, 500);
      return;
    }
    micDeniedChat(out);
  }

  function micDeniedChat(what) {
    var openable = window.JHJX_APP && typeof window.JHJX_APP.openMicSettings === 'function';
    var text = what && what !== 'ok' && what !== '还没有麦克风权限'
      ? '语音没录起来（' + what + '）：再点一次「语音」试试，或者先发文字。'
      : micFailHint({ name: 'NotAllowedError' });
    chatMsg(text, 'error', openable ? '打开设置' : '自检', function () {
      if (openable) {
        try { window.JHJX_APP.openMicSettings(); } catch (e) { /* 忽略 */ }
      } else {
        micSelfCheck();
      }
    });
  }

  /* 第一次打不开麦克风时先悄悄重试一次：
     NotReadableError 有相当一部分是「上一秒刚被别的应用放出来」这种瞬时状态，
     直接弹提示会吓人，也常常第二次就好了。 */
  function startRecordingTry(attempt) {
    if (!micSupported) {
      chatMsg(micFailHint(null), 'error', '自检', micSelfCheck);
      return;
    }
    if (rec.mode) return;
    /* 约束条件也分两档试：少数机型不认默认的音频处理开关，
       换成最朴素的 {audio:true} 反而能开 */
    var constraints = attempt >= 2 ? { audio: true } : { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
    navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      if (rec.mode) { releaseStream(stream); return; }
      rec.stream = stream;
      rec.chunks = [];
      rec.wantCancel = false;
      rec.mime = pickRecMime();
      rec.name = 'voice' + (rec.mime.indexOf('mp4') >= 0 ? '.m4a' : (rec.mime.indexOf('ogg') >= 0 ? '.ogg' : '.webm'));
      try {
        rec.recorder = rec.mime
          ? new MediaRecorder(stream, { mimeType: rec.mime, audioBitsPerSecond: 32000 })
          : new MediaRecorder(stream);
      } catch (e) {
        rec.recorder = null;
        releaseMic();
        chatMsg(micFailHint(e), 'error');
        return;
      }
      rec.mode = 'web';
      var myGen = rec.gen;
      rec.recorder.ondataavailable = function (e) {
        if (myGen !== rec.gen) return;
        if (e.data && e.data.size) rec.chunks.push(e.data);
      };
      rec.recorder.onstop = function () { finishWebRec(!!rec.wantCancel, myGen); };
      /* 录音过程中出错（话筒被抢走之类）：不能不出声，否则用户以为「点了没反应」 */
      rec.recorder.onerror = function (e) {
        if (myGen !== rec.gen) return;
        var why = (e && e.error && e.error.name) || '录音中断';
        try { rec.recorder.stop(); } catch (e2) { /* 忽略 */ }
        micSelfCheckHint(why);
      };
      rec.startedAt = Date.now();
      try { rec.recorder.start(); } catch (e) {
        rec.recorder = null;
        rec.mode = '';
        releaseMic();
        chatMsg('开始录音失败：' + micFailHint(e), 'error');
        return;
      }
      showRecBar();
    }, function (err) {
      noteMicDiag(err);
      var transient = err && (err.name === 'NotReadableError' || err.name === 'TrackStartError' || err.name === 'AbortError');
      var denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError' || err.name === 'PermissionDeniedError');
      /* 权限被拒：先去 App 那边要一次系统权限（App 里常见「设置里开了、WebView 那次授权早被拒」） */
      if (denied && attempt === 0 && window.JHJX_APP && typeof window.JHJX_APP.askMic === 'function'
          && typeof window.JHJX_APP.micState === 'function' && appMicState() !== 'granted') {
        chatMsg('正在申请麦克风权限，请在系统弹窗里点「允许」…', 'ok');
        try { window.JHJX_APP.askMic(); } catch (e) { /* 忽略 */ }
        var waited = 0;
        var timer = setInterval(function () {
          waited += 500;
          if (appMicState() === 'granted') {
            clearInterval(timer);
            startRecordingTry(1);
            return;
          }
          if (waited >= 8000) {
            clearInterval(timer);
            micDeniedChat('');
          }
        }, 500);
        return;
      }
      if (transient && attempt < 2) {
        /* 瞬时占用 / 约束不认，换个档再试，别急着报错 */
        setTimeout(function () { startRecordingTry(attempt + 1); }, attempt === 0 ? 700 : 300);
        return;
      }
      var openable = window.JHJX_APP && typeof window.JHJX_APP.openMicSettings === 'function';
      if (openable && (denied || err.name === 'NotReadableError' || err.name === 'TrackStartError')) {
        chatMsg(micFailHint(err), 'error', '打开设置', function () {
          try { window.JHJX_APP.openMicSettings(); } catch (e) { /* 忽略 */ }
        });
        return;
      }
      /* 剩下那些说不清的失败，给个「自检」把真正的原因抓出来 */
      chatMsg(micFailHint(err), 'error', '自检', micSelfCheck);
    });
  }

  function micSelfCheckHint(why) {
    chatMsg('录音中断了（' + why + '）：再点一次「语音」试试。', 'error', '自检', micSelfCheck);
  }

  /* ---- 群聊列表 ---- */
  function renderGroups() {
    var box = $('frGroups');
    if (!box) return;
    box.innerHTML = '';

    var rows = state.groups.slice().sort(function (a, b) {
      return ((b.lastAt || 0) - (a.lastAt || 0)) || ((b.unread || 0) - (a.unread || 0));
    });

    if (!rows.length) {
      box.appendChild(empty('还没有群聊。点上面的「创建群聊」，拉几个好友一起聊。'));
      return;
    }

    rows.forEach(function (g) {
      var row = document.createElement('div');
      row.className = 'fr-group';

      var mark = document.createElement('span');
      mark.className = 'fr-group__mark';
      mark.textContent = '群';
      row.appendChild(mark);

      var body = document.createElement('div');
      body.className = 'fr-group__body';
      var nm = document.createElement('div');
      nm.className = 'fr-group__name';
      nm.textContent = g.name;
      var last = document.createElement('div');
      last.className = 'fr-group__last';
      last.textContent = g.last ? previewOf(g.last, g.lastKind) : '还没有人说话';
      body.appendChild(nm);
      body.appendChild(last);
      row.appendChild(body);

      var side = document.createElement('div');
      side.className = 'fr-group__side';
      var cnt = document.createElement('span');
      cnt.className = 'fr-group__count';
      cnt.textContent = (g.memberCount || 0) + ' 人';
      side.appendChild(cnt);
      if (g.lastAt) {
        var tm = document.createElement('span');
        tm.className = 'fr-group__time';
        tm.textContent = fmtTime(g.lastAt);
        side.appendChild(tm);
      }
      if (g.unread > 0) {
        var badge = document.createElement('span');
        badge.className = 'fr-row__badge';
        badge.textContent = g.unread > 99 ? '99+' : g.unread;
        side.appendChild(badge);
      }
      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'fr-btn';
      open.textContent = '进群';
      open.addEventListener('click', function (e) {
        /* 别让点击冒泡到整行：不然会「进群」两次 */
        e.stopPropagation();
        enterGroup(g.id);
      });
      side.appendChild(open);
      row.appendChild(side);

      /* 手机上大家习惯点整行（QQ / 微信就是这样）：
         整行也能进群，键盘也能用（回车 / 空格） */
      row.classList.add('is-clickable');
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.title = '进入「' + g.name + '」';
      row.addEventListener('click', function () { enterGroup(g.id); });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          enterGroup(g.id);
        }
      });

      box.appendChild(row);
    });
  }

  /* 列表里的群可能只有摘要，进群前把成员名单取全 */
  function enterGroup(id) {
    API.group(id).then(function (res) {
      var g = res.status === 200 ? res.data.group : null;
      if (!g) {
        showMsg($('frGroupMsg'), (res.data && res.data.error) || '这个群暂时打不开', 'error');
        return;
      }
      openGroupChat(g);
    });
  }

  function refreshGroups() {
    return API.groups().then(function (res) {
      if (res.status === 200) state.groups = res.data.groups || [];
      renderGroups();
      updateGroupBadge();
      if (res.status === 200) return res.data.unread || 0;
      return 0;
    }, function () { return 0; });
  }

  function updateGroupBadge() {
    var badge = $('frGroupBadge');
    if (!badge) return;
    var n = 0;
    state.groups.forEach(function (g) { n += g.unread || 0; });
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? '99+' : n;
  }

  /* ---- 新建群聊 / 拉人进群：页面里自己画一个选择框，不用浏览器原生 prompt ---- */
  var pickCtx = null;

  function closePicker() {
    var wrap = $('frPickWrap');
    if (wrap) wrap.hidden = true;
    var box = $('frPicker');
    if (box) box.innerHTML = '';
    pickCtx = null;
  }

  function pickFriends(mode, group) {
    if (mode === 'create' && !state.friends.length) {
      showMsg($('frGroupMsg'), '还没有好友。先去「找人」加几个好友，再来建群。', 'error');
      return;
    }
    var wrap = $('frPickWrap');
    var box = $('frPicker');
    if (!wrap || !box) return;

    /* 已经在群里的人不用再选 */
    var inGroup = {};
    if (mode === 'invite' && group && group.members) {
      group.members.forEach(function (m) { inGroup[m.id] = true; });
    }
    var cands = state.friends.filter(function (f) { return !inGroup[f.id]; });
    if (mode === 'invite' && !cands.length) {
      showMsg($('frGroupMsg'), '你的好友都已经在群里了', 'ok');
      return;
    }

    pickCtx = { mode: mode, group: group, checked: {} };
    box.innerHTML = '';

    var title = document.createElement('div');
    title.className = 'fr-picker__title';
    title.textContent = mode === 'create' ? '创建群聊' : '拉好友进「' + group.name + '」';
    box.appendChild(title);

    if (mode === 'create') {
      var nameWrap = document.createElement('div');
      nameWrap.className = 'fr-picker__field';
      var label = document.createElement('label');
      label.className = 'fr-picker__label';
      label.setAttribute('for', 'frPickName');
      label.textContent = '群名称（1-20 个字）';
      var nameInput = document.createElement('input');
      nameInput.className = 'fr-input';
      nameInput.id = 'frPickName';
      nameInput.type = 'text';
      nameInput.maxLength = 20;
      nameInput.placeholder = '比如：三班学习小组';
      nameInput.autocomplete = 'off';
      nameWrap.appendChild(label);
      nameWrap.appendChild(nameInput);
      box.appendChild(nameWrap);
    }

    var hint = document.createElement('div');
    hint.className = 'fr-picker__hint';
    hint.textContent = '勾选要拉进来的好友';
    box.appendChild(hint);

    var list = document.createElement('div');
    list.className = 'fr-picker__list';
    cands.forEach(function (f) {
      var label2 = document.createElement('label');
      label2.className = 'fr-pick';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'fr-pick__box';
      cb.setAttribute('data-id', String(f.id));
      cb.addEventListener('change', function () {
        if (!pickCtx) return;
        if (cb.checked) pickCtx.checked[f.id] = true;
        else delete pickCtx.checked[f.id];
      });
      label2.appendChild(cb);
      var img = document.createElement('img');
      img.className = 'fr-pick__avatar';
      img.src = avatarUrl(f.avatar);
      img.alt = '';
      label2.appendChild(img);
      var nm = document.createElement('span');
      nm.className = 'fr-pick__name';
      nm.textContent = f.name;
      label2.appendChild(nm);
      list.appendChild(label2);
    });
    box.appendChild(list);

    var msg = document.createElement('div');
    msg.className = 'fr-msg';
    msg.id = 'frPickMsg';
    box.appendChild(msg);

    var foot = document.createElement('div');
    foot.className = 'fr-picker__foot';
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'fr-btn fr-btn--ghost';
    cancel.textContent = '取消';
    cancel.addEventListener('click', closePicker);
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'fr-btn';
    ok.textContent = mode === 'create' ? '创建' : '拉进来';
    ok.addEventListener('click', function () {
      if (!pickCtx) return;
      var ids = Object.keys(pickCtx.checked).map(function (k) { return Number(k); });
      if (!ids.length) { showMsg(msg, '至少选一位好友', 'error'); return; }
      ok.disabled = true;
      cancel.disabled = true;
      if (pickCtx.mode === 'create') {
        var nEl = $('frPickName');
        var name = nEl ? String(nEl.value || '').trim() : '';
        if (name.length < 1 || name.length > 20) {
          showMsg(msg, '群名称写 1-20 个字', 'error');
          ok.disabled = false;
          cancel.disabled = false;
          return;
        }
        API.createGroup(name, ids).then(function (res) {
          if (res.status === 200 && res.data && res.data.group) {
            closePicker();
            refreshGroups().then(function () { enterGroup(res.data.group.id); });
          } else {
            ok.disabled = false;
            cancel.disabled = false;
            showMsg(msg, (res.data && res.data.error) || '建群失败，稍后再试', 'error');
          }
        });
      } else {
        var gid = pickCtx.group.id;
        API.groupInvite(gid, ids).then(function (res) {
          if (res.status === 200) {
            closePicker();
            showMsg($('frGroupMsg'), '已经拉进群了', 'ok');
            refreshGroups();
            API.group(gid).then(function (r2) {
              if (r2.status === 200 && r2.data.group) {
                state.current = Object.assign({}, state.current || {}, r2.data.group);
                if (state.panel === 'members') renderMemberPanel();
                updateChatMeta(state.current);
              }
            });
          } else {
            ok.disabled = false;
            cancel.disabled = false;
            showMsg(msg, (res.data && res.data.error) || '拉人失败，稍后再试', 'error');
          }
        });
      }
    });
    foot.appendChild(cancel);
    foot.appendChild(ok);
    box.appendChild(foot);

    wrap.hidden = false;
    if (mode === 'create') {
      var n2 = $('frPickName');
      if (n2) n2.focus();
    }
  }

  /* 群主改名 */
  function renameGroup() {
    if (!state.current || state.chatKind !== 'group') return;
    var g = state.current;
    var name = window.prompt('新的群名称（1-20 个字）', g.name || '');
    if (name === null) return;
    name = String(name).trim();
    if (name.length < 1 || name.length > 20) { showMsg(frGroupMsg, '群名称写 1-20 个字', 'error'); return; }
    API.groupRename(g.id, name).then(function (res) {
      if (res.status === 200 && res.data && res.data.group) {
        state.current = Object.assign({}, state.current, res.data.group);
        $('frChatName').textContent = state.current.name;
        updateChatMeta(state.current);
        if (state.panel === 'members') renderMemberPanel();
        refreshGroups();
        showMsg($('frGroupMsg'), '群名称改好了', 'ok');
      } else {
        showMsg(frGroupMsg, (res.data && res.data.error) || '改名失败', 'error');
      }
    });
  }

  /* 解除好友挪到「对方主页」上了（点好友头像进去才能看到），
     这里不再放按钮：放在聊天顶部会挤占对方昵称的显示位置。
     主页上那一份在 assets/js/profile.js 里。 */

  /* ---------------- 数据刷新 ---------------- */
  /* 把某些面板先收起来（群聊 / 聊天之间来回切的时候用） */
  function hidePane(id) {
    var el = $(id);
    if (el) el.hidden = true;
  }

  /* 登录过期（401）时的统一处理：说清楚 + 退回「请先登录」，别让界面停在旧数据上 */
  var authOut = false;
  function handleAuthExpired() {
    if (authOut) return;
    authOut = true;
    clearInterval(watchdog);
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    state.current = null;
    setChatting(false);
    try { API.clearSession(); } catch (e) { /* 忽略 */ }
    hidePane('frMain');
    var guest = $('frGuest');
    if (guest) guest.hidden = false;
    var sendBtn = $('frChatSend');
    if (sendBtn) sendBtn.disabled = true;
    chatMsg('登录已过期，重新登录一下就能继续聊天了', 'error');
  }

  /* 接口都返回 {status, data}；401 说明凭证过期了，统一走上面那段 */
  function watchAuth(res) {
    if (res && res.status === 401) handleAuthExpired();
    return res;
  }

  function refresh() {
    return Promise.all([API.friends(), API.threads(), API.groups()]).then(function (res) {
      for (var i = 0; i < res.length; i++) {
        if (res[i] && res[i].status === 401) { handleAuthExpired(); return; }
      }
      if (res[0].status === 200) {
        state.friends = res[0].data.friends || [];
        state.incoming = res[0].data.incoming || [];
        state.outgoing = res[0].data.outgoing || [];
      }
      if (res[1].status === 200) state.threads = res[1].data.threads || [];
      if (res[2] && res[2].status === 200) state.groups = res[2].data.groups || [];
      renderFriends();
      renderRequests();
      renderGroups();

      var badge = $('frReqBadge');
      if (badge) {
        badge.hidden = state.incoming.length === 0;
        badge.textContent = state.incoming.length;
      }
      updateGroupBadge();

      /* 未读 = 一对一的未读 + 群聊的未读，合起来显示在顶部 */
      var unread = res[1].status === 200 ? (res[1].data.unread || 0) : 0;
      if (res[2] && res[2].status === 200) unread += (res[2].data.unread || 0);
      var pill = $('frUnread');
      if (pill) pill.textContent = unread > 0 ? '未读 ' + unread + ' 条' : '';
    });
  }

  /* ---------------- 标签切换 ---------------- */
  function showPane(name) {
    var panes = { friends: 'frPaneFriends', groups: 'frPaneGroups', requests: 'frPaneRequests', search: 'frPaneSearch' };
    Object.keys(panes).forEach(function (k) {
      var el = $(panes[k]);
      if (el) el.hidden = k !== name;
    });
    $('frPaneChat').hidden = true;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    state.current = null;
    setChatting(false);
    closeMemberPanel();
    var tabs = { friends: 'frTabFriends', groups: 'frTabGroups', requests: 'frTabRequests', search: 'frTabSearch' };
    Object.keys(tabs).forEach(function (k) {
      var el = $(tabs[k]);
      if (el) el.classList.toggle('is-active', k === name);
    });
    if (name === 'friends' || name === 'requests' || name === 'groups') refresh();
  }

  /* ---------------- 启动 ---------------- */
  /* 登录过期之后就别再定时刷新了（不然会弹好几次提示） */
  var watchdog = null;
  var user = API.user();
  if (!user || !API.token()) {
    $('frGuest').hidden = false;
    $('frToAccount').addEventListener('click', function () { location.href = 'account.html'; });
    /* api.js 有时能把丢失的登录资料补回来（缓存被清掉但凭证还在），
       补回来之后重新加载一次，别让用户停在「请先登录」上 */
    window.addEventListener('jhjx:session', function () { location.reload(); });
    return;
  }
  $('frMain').hidden = false;
  $('frAvatar').src = avatarUrl(user.avatar);
  $('frAvatar').onerror = function () { this.src = 'assets/img/logo-main.png'; };
  clickable($('frAvatar'), user.id, '看我的主页');
  $('frName').textContent = user.name;
  $('frMeta').textContent = (user.role === 'admin' ? '管理员' : '普通成员') + ' · 点别人头像可以看主页';

  $('frTabFriends').addEventListener('click', function () { showPane('friends'); });
  $('frTabGroups').addEventListener('click', function () { showPane('groups'); });
  $('frTabRequests').addEventListener('click', function () { showPane('requests'); });
  $('frTabSearch').addEventListener('click', function () { showPane('search'); });
  $('frChatBack').addEventListener('click', closeChat);
  $('frChatRefresh').addEventListener('click', function () { loadChat(state.lastAt); });
  $('frChatSend').addEventListener('click', send);
  $('frChatInput').addEventListener('input', updateComposer);
  $('frChatInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('frChatToBottom').addEventListener('click', function () {
    var box = $('frChatList');
    box.scrollTop = box.scrollHeight;
    showNewMsgHint(false);
  });
  $('frChatList').addEventListener('scroll', function () {
    if (nearBottom(this)) showNewMsgHint(false);
  });
  /* 气泡风格：点小圆点切换，记在本机 */
  (function () {
    var dots = document.querySelectorAll('#frChatStyles .fr-style-dot');
    for (var i = 0; i < dots.length; i++) {
      dots[i].addEventListener('click', function () { applyTheme(this.getAttribute('data-theme')); });
    }
    applyTheme(currentTheme());
  })();
  $('frChatAvatar').addEventListener('click', function () {
    if (state.chatKind === 'group') return;
    goProfile(state.current && state.current.id);
  });
  $('frChatName').addEventListener('click', function () {
    if (state.chatKind === 'group') return;   /* 群名不是某个人的昵称，别跳主页 */
    goProfile(state.current && state.current.id);
  });
  $('frChatMembers').addEventListener('click', toggleMemberPanel);

  /* 群聊：创建 / 进群 / 改名 / 退群 */
  $('frGroupCreate').addEventListener('click', function () {
    hideMsg($('frGroupMsg'));
    pickFriends('create', null);
  });
  $('frPickWrap').addEventListener('click', function (e) {
    if (e.target === $('frPickWrap')) closePicker();
  });

  /* 图片 / 文件：点按钮开系统选择框，选完就上传 */
  $('frChatImage').addEventListener('click', function () { $('frImageInput').click(); });
  $('frChatFile').addEventListener('click', function () { $('frFileInput').click(); });
  $('frImageInput').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    handleImageFile(f);
  });
  $('frFileInput').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    handleChatFile(f);
  });

  /* 语音 */
  $('frChatVoice').addEventListener('click', startRecording);
  $('frRecCancel').addEventListener('click', function () { stopRecording(true); });
  $('frRecSend').addEventListener('click', function () { stopRecording(false); });

  /* 看大图：点浮层任意处或按 Esc 关掉 */
  $('frLightbox').addEventListener('click', closeLightbox);
  $('frLightboxClose').addEventListener('click', function (e) {
    e.stopPropagation();
    closeLightbox();
  });
  $('frLightboxImg').addEventListener('click', function (e) { e.stopPropagation(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && lightboxShowing()) closeLightbox();
  });

  /* 搜索：先发的请求可能后回来，用序号保证只认最后一次的结果 */
  var searchSeq = 0;
  $('frSearchBtn').addEventListener('click', function () {
    var q = $('frQuery').value.trim();
    if (!q) return;
    hideMsg($('frSearchMsg'));
    var seq = ++searchSeq;
    API.searchUsers(q).then(function (res) {
      watchAuth(res);
      if (seq !== searchSeq) return;        /* 已经又搜过一轮了，这份结果作废 */
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
  watchdog = setInterval(function () {
    if (authOut) return;
    if (!state.current && !document.hidden) refresh();
  }, 20000);
  /* 从后台切回来时立刻补一次，别等下一轮 */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || authOut) return;
    if (state.current) { loadChat(0); sizeChatBox(); } else refresh();
  });
  window.addEventListener('resize', sizeChatBox);
  window.addEventListener('orientationchange', function () { setTimeout(sizeChatBox, 260); });
})();
