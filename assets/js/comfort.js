/* =========================================================
   嘉窗 · 安慰盲盒
   ---------------------------------------------------------
   抽签规则：把整个话语库洗成一副牌，按顺序一张一张往下发，
   发完一整轮（1000 张）才重新洗牌，所以任意连续 120 次抽取
   都不会撞到同一句（实际上连着 1000 次都不重样）。
   进度存在本机，刷新、退出再回来都接着往下发，不会从头开始。
   ========================================================= */
(function () {
  'use strict';

  var QUOTES = window.COMFORT_QUOTES || [];
  var KEY = 'jhjx-comfort-box-v1';
  var RECENT_MAX = 5;
  var SHAKE_MS = 360;
  var SWAP_MS = 130;

  var box = document.getElementById('cmBox');
  var quoteWrap = document.getElementById('cmQuote');
  var textEl = document.getElementById('cmText');
  var drawBtn = document.getElementById('cmDraw');
  var copyBtn = document.getElementById('cmCopy');
  var recentEl = document.getElementById('cmRecent');

  if (!QUOTES.length || !drawBtn || !textEl) return;

  /* ---------- 洗牌 / 发牌 ---------- */
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function newDeck(total, avoidLast) {
    var order = [];
    for (var i = 0; i < total; i++) order.push(i);
    shuffle(order);
    /* 新一轮的第一张不要和上一轮的收尾撞上 */
    if (typeof avoidLast === 'number' && avoidLast >= 0 && order.length > 1 && order[0] === avoidLast) {
      var k = 1 + Math.floor(Math.random() * (order.length - 1));
      var tmp = order[0]; order[0] = order[k]; order[k] = tmp;
    }
    return { v: 1, total: total, order: order, pos: 0, last: -1, recent: [] };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        var okShape = s && s.v === 1 && s.total === QUOTES.length &&
          Array.isArray(s.order) && s.order.length === QUOTES.length &&
          typeof s.pos === 'number' && s.pos >= 0 && s.pos <= s.order.length &&
          typeof s.last === 'number';
        if (okShape && s.order.every(function (n) { return typeof n === 'number' && n >= 0 && n < QUOTES.length; })) {
          if (!Array.isArray(s.recent)) s.recent = [];
          return s;
        }
      }
    } catch (e) { /* 隐私模式等：忽略，用内存里的新牌 */ }
    return newDeck(QUOTES.length, -1);
  }

  function saveState() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 忽略 */ }
  }

  var state = loadState();
  var current = '';
  var busy = false;
  var pendingDraw = false;

  function nextSentence() {
    if (state.pos >= state.order.length) {
      state = newDeck(state.total, state.last);
      state.recent = recent.slice();
    }
    var idx = state.order[state.pos];
    state.pos += 1;
    state.last = idx;
    if (state.pos > state.order.length) state.pos = state.order.length;
    return QUOTES[idx];
  }

  /* ---------- 渲染 ---------- */
  var recent = Array.isArray(state.recent) ? state.recent.slice(0, RECENT_MAX) : [];

  function renderRecent() {
    recentEl.innerHTML = '';
    if (!recent.length) {
      var li0 = document.createElement('li');
      li0.className = 'cm-empty';
      li0.textContent = '还没有抽过，随手抽一张吧。';
      recentEl.appendChild(li0);
      return;
    }
    recent.forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s;
      recentEl.appendChild(li);
    });
  }

  function showSentence(sentence, animate) {
    textEl.textContent = sentence;
    textEl.classList.toggle('is-long', sentence.length > 16);
    if (animate) {
      quoteWrap.classList.remove('is-new');
      void quoteWrap.offsetWidth;   /* 强制重排，动画才能重放 */
      quoteWrap.classList.add('is-new');
    }
  }

  function remember(sentence) {
    recent.unshift(sentence);
    if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
    state.recent = recent.slice();
    renderRecent();
  }

  /* ---------- 抽一句 ---------- */
  function drawOnce() {
    /* 手快连点也不会白点：忙的时候挂一笔，动画一结束立刻补上 */
    if (busy) { pendingDraw = true; return; }
    busy = true;
    drawBtn.setAttribute('disabled', 'disabled');
    box.classList.add('is-drawing');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* 忽略 */ } }

    window.setTimeout(function () {
      current = nextSentence();
      showSentence(current, true);
      remember(current);
      saveState();
    }, SWAP_MS);

    window.setTimeout(function () {
      box.classList.remove('is-drawing');
      drawBtn.removeAttribute('disabled');
      busy = false;
      if (pendingDraw) { pendingDraw = false; drawOnce(); }
    }, SHAKE_MS);
  }

  /* ---------- 复制 ---------- */
  function copyCurrent() {
    if (!current) return;
    var done = function () {
      var span = copyBtn.querySelector('span');
      if (!span) return;
      span.textContent = '已复制 ✓';
      window.setTimeout(function () { span.textContent = '复制这句'; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(current).then(done).catch(function () { fallbackCopy(current, done); });
    } else {
      fallbackCopy(current, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* 忽略 */ }
    document.body.removeChild(ta);
  }

  /* ---------- 事件 ---------- */
  drawBtn.addEventListener('click', drawOnce);
  copyBtn.addEventListener('click', copyCurrent);
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' && e.key !== 'Spacebar' && e.key !== 'Enter') return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA') return;   /* 让按钮自己响应 */
    e.preventDefault();
    drawOnce();
  });

  /* ---------- 初始状态 ---------- */
  renderRecent();
  if (recent.length) {
    current = recent[0];
    showSentence(current, false);
  }
})();
