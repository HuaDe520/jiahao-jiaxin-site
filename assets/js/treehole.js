/* =========================================================
   嘉窗 · 树洞纸条（正式版）
   ---------------------------------------------------------
   匿名写下一张纸条，别人只能按一下「抱抱你」「赞」这类反应，
   不能打字回复 —— 这是这个功能不变成吵架场的关键。
   每张纸条只展示七天，到点后端会把它删掉。
   纸条存在服务器上，所以大家看到的是同一个树洞。
   ========================================================= */
(function () {
  'use strict';

  var API = window.JHJX_API;
  if (!API) return;

  var DAY = 24 * 60 * 60 * 1000;
  var $ = function (id) { return document.getElementById(id); };

  /* 反应种类：和后端 worker.js 里的 TREEHOLE_KINDS 一一对应 */
  var KIND_LABELS = [
    { key: 'hug', label: '抱抱你' },
    { key: 'like', label: '赞' },
    { key: 'cheer', label: '加油' },
    { key: 'with', label: '我懂你' },
    { key: 'fine', label: '没事哒' },
    { key: 'ok', label: '会好的' },
    { key: 'great', label: '你很棒' }
  ];

  var state = { notes: [], kinds: [], keepDays: 7, maxLen: 500, busy: false };

  var listEl = $('thList');
  var formEl = $('thForm');
  var inputEl = $('thInput');
  var countEl = $('thCount');
  var submitEl = $('thSubmit');
  var emptyEl = $('thEmpty');
  var msgEl = $('thMsg');
  var footEl = $('thFoot');

  function show(box) {
    $('thGuest').hidden = box !== 'guest';
    $('thMain').hidden = box !== 'main';
  }

  function showMsg(text, kind) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.className = 'th-msg' + (text ? ' is-show is-' + (kind || 'ok') : '');
  }

  function fmtTime(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < DAY) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 2 * DAY) return '昨天';
    return Math.floor(diff / DAY) + ' 天前';
  }

  function fmtLeft(ts) {
    var remain = state.keepDays * DAY - (Date.now() - ts);
    if (remain <= 0) return '今天飘走';
    return '还剩 ' + Math.ceil(remain / DAY) + ' 天';
  }

  /* ---------------- 渲染 ---------------- */
  function reactButton(note, kind) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'th-react';
    btn.setAttribute('data-kind', kind.key);
    var mine = (note.my || []).indexOf(kind.key) >= 0;
    if (mine) btn.classList.add('is-mine');
    btn.setAttribute('aria-pressed', mine ? 'true' : 'false');
    btn.setAttribute('aria-label', kind.label);

    var label = document.createElement('span');
    label.textContent = kind.label;
    btn.appendChild(label);

    var num = document.createElement('span');
    num.className = 'th-react__count';
    var count = (note.reactions && note.reactions[kind.key]) || 0;
    num.textContent = count > 0 ? String(count) : '';
    btn.appendChild(num);

    btn.addEventListener('click', function () {
      btn.disabled = true;
      API.reactNote(note.id, kind.key).then(function (res) {
        btn.disabled = false;
        if (res.status === 200 && res.data && res.data.ok) {
          note.reactions = res.data.note.reactions;
          note.my = res.data.note.my;
          var nowMine = (note.my || []).indexOf(kind.key) >= 0;
          btn.classList.toggle('is-mine', nowMine);
          btn.setAttribute('aria-pressed', nowMine ? 'true' : 'false');
          var c = note.reactions[kind.key] || 0;
          num.textContent = c > 0 ? String(c) : '';
          btn.classList.remove('is-pop');
          void btn.offsetWidth;
          btn.classList.add('is-pop');
        } else if (res.status === 404) {
          showMsg('这张纸条已经飘走了，刷新看看', 'error');
        } else {
          showMsg((res.data && res.data.error) || '没能按上，网络不太好吗', 'error');
        }
      });
    });

    return btn;
  }

  function renderNote(note) {
    var li = document.createElement('li');
    li.className = 'th-note';
    li.setAttribute('data-id', String(note.id));

    var body = document.createElement('p');
    body.className = 'th-note__body';
    body.textContent = note.body;
    li.appendChild(body);

    var meta = document.createElement('div');
    meta.className = 'th-note__meta';
    var time = document.createElement('span');
    time.className = 'th-note__time';
    time.setAttribute('data-time', String(note.createdAt));
    time.textContent = fmtTime(note.createdAt);
    meta.appendChild(time);

    var right = document.createElement('span');
    right.className = 'th-note__left';
    right.setAttribute('data-time', String(note.createdAt));
    right.textContent = fmtLeft(note.createdAt);
    if (note.mine) {
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'th-note__del';
      del.textContent = '收回';
      del.addEventListener('click', function () {
        del.disabled = true;
        API.deleteNote(note.id).then(function (res) {
          if (res.status === 200) { load(); }
          else { del.disabled = false; showMsg((res.data && res.data.error) || '没能收回，稍后再试', 'error'); }
        });
      });
      right.appendChild(document.createTextNode(' · '));
      right.appendChild(del);
    }
    meta.appendChild(right);
    li.appendChild(meta);

    var reacts = document.createElement('div');
    reacts.className = 'th-reacts';
    KIND_LABELS.forEach(function (k) { reacts.appendChild(reactButton(note, k)); });
    li.appendChild(reacts);

    return li;
  }

  function render() {
    listEl.innerHTML = '';
    state.notes.forEach(function (n) { listEl.appendChild(renderNote(n)); });
    emptyEl.hidden = state.notes.length > 0;
  }

  /* 只把「几分钟前 / 还剩几天」这些文字重新算一遍，不动按钮状态 */
  function refreshLabels() {
    var t = listEl.querySelectorAll('.th-note__time');
    for (var i = 0; i < t.length; i++) t[i].textContent = fmtTime(Number(t[i].getAttribute('data-time')));
    var l = listEl.querySelectorAll('.th-note__left');
    for (var j = 0; j < l.length; j++) {
      var ts = Number(l[j].getAttribute('data-time'));
      var del = l[j].querySelector('.th-note__del');
      /* 只替换文字节点，保住「收回」按钮 */
      if (del) l[j].firstChild.nodeValue = fmtLeft(ts) + ' · ';
      else l[j].textContent = fmtLeft(ts);
    }
  }

  /* ---------------- 数据 ---------------- */
  function load() {
    return API.treehole().then(function (res) {
      if (res.status === 200 && res.data && res.data.ok) {
        state.notes = res.data.notes || [];
        state.kinds = res.data.kinds || state.kinds;
        if (res.data.keepDays) state.keepDays = res.data.keepDays;
        if (res.data.maxLen) state.maxLen = res.data.maxLen;
        show('main');
        render();
        if (footEl) footEl.textContent = '纸条会在这里待 ' + state.keepDays + ' 天，然后自己飘走。';
        return true;
      }
      if (res.status === 401 || res.status === 403) { show('guest'); return false; }
      showMsg((res.data && res.data.error) || '树洞暂时打不开，待会儿再试', 'error');
      return false;
    });
  }

  /* ---------------- 写纸条 ---------------- */
  function updateCount() {
    var max = state.maxLen || 500;
    if (Array.from(inputEl.value).length > max) inputEl.value = Array.from(inputEl.value).slice(0, max).join('');
    countEl.textContent = Array.from(inputEl.value).length + ' / ' + max;
    submitEl.disabled = inputEl.value.trim().length === 0;
  }

  if (!listEl || !formEl || !inputEl) return;

  inputEl.addEventListener('input', updateCount);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      formEl.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  formEl.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = inputEl.value.trim();
    if (!text || state.busy) return;
    state.busy = true;
    submitEl.disabled = true;
    showMsg('');
    API.postNote(text).then(function (res) {
      state.busy = false;
      if (res.status === 200 && res.data && res.data.ok) {
        inputEl.value = '';
        updateCount();
        state.notes.unshift(res.data.note);
        render();
        showMsg('纸条投进树洞了，七天后它会自己飘走', 'ok');
        inputEl.focus();
      } else {
        submitEl.disabled = false;
        showMsg((res.data && res.data.error) || '没能投进去，待会儿再试', 'error');
      }
    });
  });

  /* ---------------- 启动 ---------------- */
  if (!API.token() || !API.user()) {
    show('guest');
    /* 登录资料被 api.js 补回来之后重新加载 */
    window.addEventListener('jhjx:session', function () { location.reload(); });
    return;
  }
  load();

  /* 时间在走：每分钟刷新一次「几分钟前 / 还剩几天」 */
  setInterval(function () { if (!document.hidden) refreshLabels(); }, 60000);
  /* 每 20 秒看看有没有新纸条（页面在后台就不请求） */
  setInterval(function () { if (!document.hidden) load(); }, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
})();
