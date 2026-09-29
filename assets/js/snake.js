/* =========================================================
   嘉游 · 贪吃蛇
   ---------------------------------------------------------
   同一套逻辑同时伺候手机和电脑：
     电脑 —— 方向键 / WASD 转向，空格暂停，回车重开
     手机 —— 在棋盘上滑动，或点下面的方向键
   转向不是「按一下立刻拐」，而是排进一个小队列，
   每一步走完才取一个，所以手快连按两下也不会把自己撞死。
   ========================================================= */
(function () {
  'use strict';

  var COLS = 20;
  var ROWS = 20;
  var SPEEDS = { easy: 200, normal: 150, hard: 105 };   /* 每走一格的毫秒数 */
  var MIN_STEP = 80;
  var BEST_KEY = 'jhjx-snake-best-v1';
  var DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  var wrap = document.getElementById('snWrap');
  var canvas = document.getElementById('snBoard');
  var overlay = document.getElementById('snOverlay');
  var overlayTitle = document.getElementById('snOverlayTitle');
  var overlayText = document.getElementById('snOverlayText');
  var overlayBtn = document.getElementById('snOverlayBtn');
  var scoreEl = document.getElementById('snScore');
  var bestEl = document.getElementById('snBest');
  var statusEl = document.getElementById('snStatus');
  var speedsEl = document.getElementById('snSpeeds');
  var padEl = document.getElementById('snPad');
  var pauseBtn = document.getElementById('snPause');
  if (!wrap || !canvas || !overlay || !overlayBtn) return;

  var ctx = canvas.getContext('2d');
  var state = 'idle';          /* idle | running | paused | over */
  var snake = [];
  var prevSnake = [];
  var dir = DIRS.right;
  var queue = [];
  var food = { x: 14, y: 10 };
  var score = 0;
  var baseMs = SPEEDS.normal;
  var stepMs = SPEEDS.normal;
  var acc = 0;
  var lastTs = 0;
  var rafId = 0;
  var cell = 18;               /* 一格多少 CSS 像素，fit() 里算 */
  var best = 0;

  /* ---------- 最高分 ---------- */
  function loadBest() {
    try {
      var v = parseInt(localStorage.getItem(BEST_KEY), 10);
      return isFinite(v) && v > 0 ? v : 0;
    } catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* 忽略 */ }
  }
  best = loadBest();
  bestEl.textContent = String(best);

  /* ---------- 尺寸 ---------- */
  function fit() {
    var cssW = wrap.clientWidth || 360;
    var dpr = window.devicePixelRatio || 1;
    cell = cssW / COLS;
    var px = Math.round(cssW * dpr);
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    canvas.style.height = cssW + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  /* ---------- 一局的开头 ---------- */
  function reset() {
    snake = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
    prevSnake = snake.slice();
    dir = DIRS.right;
    queue = [];
    score = 0;
    scoreEl.textContent = '0';
    stepMs = baseMs;
    acc = 0;
    lastTs = 0;
    placeFood();
    state = 'idle';
    setStatus('准备好了就按「开始游戏」');
    draw();
  }

  function placeFood() {
    var free = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var hit = false;
        for (var i = 0; i < snake.length; i++) {
          if (snake[i].x === x && snake[i].y === y) { hit = true; break; }
        }
        if (!hit) free.push({ x: x, y: y });
      }
    }
    if (!free.length) { food = { x: -1, y: -1 }; return; }   /* 满屏了，算通关 */
    food = free[Math.floor(Math.random() * free.length)];
  }

  /* ---------- 画面 ---------- */
  function roundRect(x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function draw() {
    var w = COLS * cell;
    var h = ROWS * cell;
    ctx.clearRect(0, 0, w, h);

    /* 底纹：淡淡的棋盘格，看起来像宣纸上的格子 */
    var i;
    for (i = 0; i < COLS; i++) {
      for (var j = 0; j < ROWS; j++) {
        if ((i + j) % 2) continue;
        ctx.fillStyle = 'rgba(18, 101, 90, .035)';
        ctx.fillRect(i * cell, j * cell, cell, cell);
      }
    }

    /* 果实 */
    if (food.x >= 0) {
      var cx = (food.x + 0.5) * cell;
      var cy = (food.y + 0.5) * cell;
      var pr = cell * 0.32;
      ctx.save();
      ctx.shadowColor = 'rgba(201, 162, 75, .85)';
      ctx.shadowBlur = cell * 0.7;
      ctx.fillStyle = '#c9a24b';
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255, 255, 255, .75)';
      ctx.beginPath();
      ctx.arc(cx - pr * 0.3, cy - pr * 0.34, pr * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 蛇：每一步之间做一点插值，看起来是滑过去的而不是跳过去的 */
    var t = state === 'running' ? Math.min(1, acc / stepMs) : 1;
    var n = snake.length;
    for (i = n - 1; i >= 0; i--) {
      var seg = snake[i];
      var from = prevSnake[i] || prevSnake[prevSnake.length - 1] || seg;
      var gx = lerp(from.x, seg.x, t);
      var gy = lerp(from.y, seg.y, t);
      var pad = Math.max(1.2, cell * 0.09);
      var size = cell - pad * 2;
      ctx.fillStyle = i === 0 ? '#0f534b' : (i % 2 ? 'rgba(23, 128, 111, .92)' : 'rgba(37, 156, 136, .92)');
      roundRect(gx * cell + pad, gy * cell + pad, size, size, cell * 0.34);
      ctx.fill();
    }

    /* 蛇头上一对小眼睛，朝哪儿一眼看得清 */
    if (snake.length) {
      var head = snake[0];
      var hx = head.x * cell + cell / 2;
      var hy = head.y * cell + cell / 2;
      var ex = dir.x * cell * 0.16;
      var ey = dir.y * cell * 0.16;
      var ox = dir.x === 0 ? cell * 0.17 : 0;
      var oy = dir.y === 0 ? cell * 0.17 : 0;
      ctx.fillStyle = 'rgba(255, 255, 255, .95)';
      ctx.beginPath();
      ctx.arc(hx + ex + ox, hy + ey + oy, Math.max(1.2, cell * 0.1), 0, Math.PI * 2);
      ctx.arc(hx + ex - ox, hy + ey - oy, Math.max(1.2, cell * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---------- 提示与遮罩 ---------- */
  function setStatus(text) { if (statusEl) statusEl.textContent = text; }

  function showOverlay(title, text, btn) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayBtn.textContent = btn;
    overlay.hidden = false;
  }
  function hideOverlay() { overlay.hidden = true; }

  /* ---------- 走一步 ---------- */
  function takeDir() {
    while (queue.length) {
      var d = queue.shift();
      if (d.x === dir.x && d.y === dir.y) continue;        /* 同一个方向，不用拐 */
      if (d.x === -dir.x && d.y === -dir.y) continue;      /* 不能原地掉头 */
      return d;
    }
    return dir;
  }

  function step() {
    dir = takeDir();
    prevSnake = snake.slice();
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) { gameOver('撞到墙了'); return; }

    var growing = head.x === food.x && head.y === food.y;
    var tail = growing ? snake.length : snake.length - 1;   /* 不吃东西时尾巴会挪开，那一格不算撞 */
    for (var i = 0; i < tail; i++) {
      if (snake[i].x === head.x && snake[i].y === head.y) { gameOver('咬到自己了'); return; }
    }

    snake.unshift(head);
    if (growing) {
      score++;
      scoreEl.textContent = String(score);
      if (score > best) { best = score; bestEl.textContent = String(best); saveBest(best); }
      stepMs = Math.max(MIN_STEP, baseMs - Math.floor(score / 2) * 6);
      placeFood();
      if (food.x < 0) { gameOver('整块棋盘都被你占满了'); return; }
    } else {
      snake.pop();
    }
  }

  function gameOver(why) {
    state = 'over';
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    draw();
    var title = score >= best && score > 0 ? '新纪录 ' + score + ' 分' : '本局 ' + score + ' 分';
    showOverlay(title, why + '。最高分 ' + best + ' 分。', '再来一局');
    setStatus(why + '，本局 ' + score + ' 分');
  }

  function loop(ts) {
    if (state !== 'running') return;
    if (!lastTs) lastTs = ts;
    var dt = ts - lastTs;
    lastTs = ts;
    if (dt > 400) dt = 400;         /* 切出去再回来，别一次补上一大段 */
    acc += dt;
    while (acc >= stepMs && state === 'running') {
      acc -= stepMs;
      step();
    }
    draw();
    if (state === 'running') rafId = requestAnimationFrame(loop);
  }

  /* ---------- 对外的几个动作 ---------- */
  function start() {
    if (state === 'running') return;
    if (state === 'over' || state === 'idle') {
      if (state === 'over') reset();
    }
    state = 'running';
    hideOverlay();
    lastTs = 0;
    acc = 0;
    setStatus('开始啦，专心吃果实');
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function pause(quiet) {
    if (state !== 'running') return;
    state = 'paused';
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    draw();
    showOverlay('暂停中', '本局已经吃到 ' + score + ' 个果实。', '继续');
    if (!quiet) setStatus('已暂停');
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    hideOverlay();
    lastTs = 0;
    setStatus('继续');
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function togglePause() {
    if (state === 'running') pause();
    else if (state === 'paused') resume();
    else if (state === 'idle') start();
  }

  function restart() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    reset();
    start();
  }

  function pushDir(d) {
    if (state === 'over') return;
    if (state === 'paused') return;
    var last = queue.length ? queue[queue.length - 1] : dir;
    if (d.x === last.x && d.y === last.y) return;
    if (d.x === -last.x && d.y === -last.y) return;
    if (queue.length >= 3) queue.shift();
    queue.push(d);
    if (state === 'idle') start();
  }

  /* ---------- 键盘 ---------- */
  var KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', a: 'left', s: 'down', d: 'right',
    W: 'up', A: 'left', S: 'down', D: 'right',
    Up: 'up', Down: 'down', Left: 'left', Right: 'right'
  };
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var name = KEYS[e.key];
    if (name) {
      e.preventDefault();
      if (state === 'over') { restart(); return; }
      pushDir(DIRS[name]);
      return;
    }
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Space') {
      e.preventDefault();
      if (state === 'idle' || state === 'over') start();
      else togglePause();
      return;
    }
    if (e.key === 'Enter' || e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      restart();
    }
  });

  /* ---------- 棋盘上的滑动 ---------- */
  var startX = 0, startY = 0, startT = 0, dragging = false;
  var SWIPE = 18;      /* 手指挪过这么多像素才算一次滑动 */

  function swipeHandler(dx, dy) {
    if (Math.abs(dx) < SWIPE && Math.abs(dy) < SWIPE) {
      /* 当成一次轻点：还没开始就开始，结束了就再来一局 */
      if (state === 'idle') start();
      else if (state === 'over') restart();
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) pushDir(dx > 0 ? DIRS.right : DIRS.left);
    else pushDir(dy > 0 ? DIRS.down : DIRS.up);
  }

  function beginDrag(x, y) { startX = x; startY = y; startT = Date.now(); dragging = true; }
  function endDrag(x, y) {
    if (!dragging) return;
    dragging = false;
    if (Date.now() - startT > 1200) return;      /* 按太久当成长按，不动 */
    swipeHandler(x - startX, y - startY);
  }

  wrap.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { dragging = false; return; }
    beginDrag(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  wrap.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  wrap.addEventListener('touchend', function (e) {
    var t = e.changedTouches && e.changedTouches[0];
    if (t) endDrag(t.clientX, t.clientY);
  });
  wrap.addEventListener('touchcancel', function () { dragging = false; });

  wrap.addEventListener('mousedown', function (e) { beginDrag(e.clientX, e.clientY); });
  wrap.addEventListener('mouseup', function (e) { endDrag(e.clientX, e.clientY); });
  wrap.addEventListener('mouseleave', function () { dragging = false; });

  /* ---------- 按钮 ---------- */
  overlayBtn.addEventListener('click', function () {
    if (state === 'paused') resume();
    else if (state === 'over') restart();
    else start();
  });
  if (pauseBtn) {
    pauseBtn.addEventListener('click', function () {
      if (state === 'idle' || state === 'over') start();
      else togglePause();
    });
  }
  if (padEl) {
    padEl.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.sn-key[data-dir]') : null;
      if (!btn) return;
      e.preventDefault();
      var d = DIRS[btn.getAttribute('data-dir')];
      if (d) pushDir(d);
    });
  }
  if (speedsEl) {
    speedsEl.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.sn-speed') : null;
      if (!btn) return;
      var name = btn.getAttribute('data-speed');
      if (!SPEEDS[name]) return;
      baseMs = SPEEDS[name];
      stepMs = Math.max(MIN_STEP, baseMs - Math.floor(score / 2) * 6);
      var all = speedsEl.querySelectorAll('.sn-speed');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('is-active', all[i] === btn);
      setStatus('速度：' + btn.textContent);
    });
  }

  /* ---------- 别的地方 ---------- */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause(true);
  });
  window.addEventListener('blur', function () {
    if (state === 'running') pause(true);
  });
  window.addEventListener('resize', fit);
  window.addEventListener('load', fit);

  /* 给自动化自检留的一只眼睛：只读局面，另外能把果实摆到指定格子，
     方便确定性地验证「吃到果实会加分」。不参与玩法。 */
  window.jhjxSnake = {
    state: function () { return state; },
    score: function () { return score; },
    best: function () { return best; },
    dir: function () { return { x: dir.x, y: dir.y }; },
    head: function () { return { x: snake[0].x, y: snake[0].y }; },
    length: function () { return snake.length; },
    food: function () { return { x: food.x, y: food.y }; },
    placeFood: function (x, y) { food = { x: x, y: y }; draw(); }
  };

  reset();
  fit();
})();
