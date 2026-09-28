/* =========================================================
   嘉窗 · 树洞纸条（演示版）
   ---------------------------------------------------------
   产品形态：匿名写下一张纸条，别人只能按一下「抱抱你」这类
   反应，不能打字回复；每张纸条只展示七天，到期自己消失。

   这是纯前端演示：纸条存在本机浏览器里（localStorage），
   所以视觉、交互、七天到期、按反应都是一比一的真实逻辑，
   只是还没接后端 —— 接上之后就是大家共用的同一个树洞。
   ========================================================= */
(function () {
  'use strict';

  var KEY = 'jhjx-treehole-demo-v1';
  var DAY = 24 * 60 * 60 * 1000;
  var KEEP_DAYS = 7;          /* 纸条保留天数 */
  var MAX_LEN = 300;

  /* 只能用这几个反应，不给自由输入 —— 这是这个功能安全的关键 */
  var KINDS = [
    { key: 'hug', label: '抱抱你' },
    { key: 'cheer', label: '加油' },
    { key: 'with', label: '我懂你' },
    { key: 'fine', label: '没事哒' },
    { key: 'ok', label: '会好的' },
    { key: 'great', label: '你很棒' }
  ];

  /* 演示用的初始纸条（时间都是相对「现在」算的，看起来永远新鲜）
     m = 多少分钟前；最后一条是 8 天前的，用来验证七天到期不再显示 */
  var SEED = [
    { m: 25, body: '今天有点想哭，但最后还是忍住了。', r: { hug: 6, with: 3 } },
    { m: 95, body: '这周事情堆在一起，感觉自己一直在赶，喘不上气。', r: { hug: 4, fine: 5, cheer: 2 } },
    { m: 60 * 7, body: '努力了很久的一件事，好像没人在意。', r: { hug: 9, great: 4 } },
    { m: 60 * 26, body: '和好朋友慢慢疏远了，不知道该不该主动一点。', r: { with: 7, hug: 3 } },
    { m: 60 * 52, body: '想家了，明明才刚开学没多久。', r: { hug: 11, with: 2 } },
    { m: 60 * 24 * 3, body: '睡不好，白天又困又烦，什么都做不进去。', r: { fine: 6, ok: 4 } },
    { m: 60 * 24 * 4, body: '最近总觉得自己比不上别人，明知道比也没意义。', r: { great: 8, hug: 5, with: 3 } },
    { m: 60 * 24 * 5, body: '今天路过一家很香的店，突然就开心了一点。', r: { cheer: 9, fine: 2 } },
    { m: 60 * 24 * 6, body: '有点累，但说不上来具体累在哪里。', r: { hug: 7, with: 6 } },
    { m: 60 * 24 * 8, body: '（这张是八天前的，按规则已经飘走了，不应该出现在列表里）', r: { hug: 1 } }
  ];

  var listEl = document.getElementById('thList');
  var formEl = document.getElementById('thForm');
  var inputEl = document.getElementById('thInput');
  var countEl = document.getElementById('thCount');
  var submitEl = document.getElementById('thSubmit');
  var emptyEl = document.getElementById('thEmpty');
  if (!listEl || !formEl || !inputEl) return;

  /* ---------------- 数据 ---------------- */
  function nowTs() { return Date.now(); }

  function cloneReactions(src) {
    var out = {};
    KINDS.forEach(function (k) { out[k.key] = (src && src[k.key]) || 0; });
    return out;
  }

  function makeSeed() {
    var t = nowTs();
    return SEED.map(function (s, i) {
      return {
        id: 'seed-' + i,
        body: s.body,
        createdAt: t - s.m * 60000,
        mine: false,
        reactions: cloneReactions(s.r),
        my: {}
      };
    });
  }

  function load() {
    var data = null;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) { data = null; }
    if (!data || !Array.isArray(data.notes)) data = { v: 1, notes: makeSeed() };
    return data;
  }

  var state = load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 忽略 */ }
  }

  function purge() {
    var cutoff = nowTs() - KEEP_DAYS * DAY;
    var before = state.notes.length;
    state.notes = state.notes.filter(function (n) {
      return n && typeof n.createdAt === 'number' && n.createdAt > cutoff;
    });
    if (state.notes.length !== before) save();
  }

  function visibleNotes() {
    var cutoff = nowTs() - KEEP_DAYS * DAY;
    return state.notes
      .filter(function (n) { return n.createdAt > cutoff; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  /* ---------------- 文案 ---------------- */
  function fmtTime(ts) {
    var diff = nowTs() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < DAY) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 2 * DAY) return '昨天';
    return Math.floor(diff / DAY) + ' 天前';
  }

  function fmtLeft(ts) {
    var remain = KEEP_DAYS * DAY - (nowTs() - ts);
    if (remain <= 0) return '今天飘走';
    return '还剩 ' + Math.ceil(remain / DAY) + ' 天';
  }

  /* ---------------- 渲染 ---------------- */
  function reactButton(note, kind) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'th-react';
    btn.setAttribute('data-kind', kind.key);
    if (note.my && note.my[kind.key]) btn.classList.add('is-mine');
    btn.setAttribute('aria-pressed', note.my && note.my[kind.key] ? 'true' : 'false');

    var label = document.createElement('span');
    label.textContent = kind.label;
    btn.appendChild(label);

    var count = note.reactions[kind.key] || 0;
    var num = document.createElement('span');
    num.className = 'th-react__count';
    num.textContent = count > 0 ? String(count) : '';
    btn.appendChild(num);

    btn.addEventListener('click', function () {
      if (!note.my) note.my = {};
      var on = !!note.my[kind.key];
      if (on) {
        note.my[kind.key] = false;
        note.reactions[kind.key] = Math.max(0, (note.reactions[kind.key] || 0) - 1);
      } else {
        note.my[kind.key] = true;
        note.reactions[kind.key] = (note.reactions[kind.key] || 0) + 1;
      }
      save();

      btn.classList.toggle('is-mine', !on);
      btn.setAttribute('aria-pressed', on ? 'false' : 'true');
      num.textContent = note.reactions[kind.key] > 0 ? String(note.reactions[kind.key]) : '';
      btn.classList.remove('is-pop');
      void btn.offsetWidth;
      btn.classList.add('is-pop');
    });

    return btn;
  }

  function renderNote(note) {
    var li = document.createElement('li');
    li.className = 'th-note';
    li.setAttribute('data-id', note.id);
    if (note.fresh) li.classList.add('is-new');

    var body = document.createElement('p');
    body.className = 'th-note__body';
    body.textContent = note.body;
    li.appendChild(body);

    var meta = document.createElement('div');
    meta.className = 'th-note__meta';

    var time = document.createElement('span');
    time.textContent = fmtTime(note.createdAt);
    meta.appendChild(time);

    var right = document.createElement('span');
    right.className = 'th-note__left';
    right.textContent = fmtLeft(note.createdAt);
    if (note.mine) {
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'th-note__del';
      del.textContent = '收回';
      del.style.marginLeft = '10px';
      del.addEventListener('click', function () {
        state.notes = state.notes.filter(function (n) { return n.id !== note.id; });
        save();
        render();
      });
      right.appendChild(del);
      right.insertBefore(document.createTextNode(' · '), del);
    }
    meta.appendChild(right);
    li.appendChild(meta);

    var reacts = document.createElement('div');
    reacts.className = 'th-reacts';
    KINDS.forEach(function (k) { reacts.appendChild(reactButton(note, k)); });
    li.appendChild(reacts);

    return li;
  }

  function render() {
    purge();
    var notes = visibleNotes();
    listEl.innerHTML = '';
    notes.forEach(function (n) { listEl.appendChild(renderNote(n)); });
    emptyEl.hidden = notes.length > 0;
  }

  /* ---------------- 写纸条 ---------------- */
  function updateCount() {
    /* maxlength 只挡手打字，粘贴或输入法一次上屏可能超长，这里再兜一次 */
    if (inputEl.value.length > MAX_LEN) inputEl.value = inputEl.value.slice(0, MAX_LEN);
    var len = inputEl.value.length;
    countEl.textContent = len + ' / ' + MAX_LEN;
    submitEl.disabled = inputEl.value.trim().length === 0;
  }

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
    if (!text) return;
    var note = {
      id: 'mine-' + nowTs() + '-' + Math.floor(Math.random() * 1000),
      body: text.slice(0, MAX_LEN),
      createdAt: nowTs(),
      mine: true,
      fresh: true,
      reactions: cloneReactions(null),
      my: {}
    };
    state.notes.push(note);
    save();
    render();
    inputEl.value = '';
    updateCount();
    inputEl.focus();
  });

  /* ---------------- 时间在走，纸条会自己到期 ---------------- */
  window.setInterval(render, 60000);

  /* ---------------- 初始 ---------------- */
  render();
  updateCount();
})();
