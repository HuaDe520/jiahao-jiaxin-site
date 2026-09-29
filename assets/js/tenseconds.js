/* =========================================================
   嘉闲 · 可以耽误10秒钟吗？
   ---------------------------------------------------------
   点一下就开始十秒倒计时，十秒之后自己停下。
   计时按真实时间戳算（Date.now），所以切出去再回来也是准的。
   ========================================================= */
(function () {
  'use strict';

  var TOTAL = 10;                 /* 秒 */
  var RING = 540.35;              /* 圆周长：2πr，r = 86 */
  var DONE_TEXT = '十秒过去了。';

  var card = document.getElementById('tsCard');
  var countEl = document.getElementById('tsCount');
  var unitEl = document.getElementById('tsUnit');
  var noteEl = document.getElementById('tsNote');
  var barEl = document.getElementById('tsBar');
  var startBtn = document.getElementById('tsStart');
  var startText = document.getElementById('tsStartText');
  var stopBtn = document.getElementById('tsStop');
  if (!card || !countEl || !startBtn) return;

  var rafId = 0;
  var endAt = 0;
  var running = false;
  var lastShown = TOTAL;

  function paint(remainingMs) {
    var secs = Math.max(0, Math.ceil(remainingMs / 1000));
    if (secs !== lastShown) {
      lastShown = secs;
      countEl.textContent = String(secs);
      /* 每跳一秒，数字轻轻弹一下 */
      card.classList.remove('is-ticking');
      void card.offsetWidth;
      card.classList.add('is-ticking');
    }
    var left = Math.max(0, Math.min(1, remainingMs / (TOTAL * 1000)));
    barEl.style.strokeDashoffset = String(RING * (1 - left));
  }

  function tick() {
    var remaining = endAt - Date.now();
    if (remaining <= 0) { finish(); return; }
    paint(remaining);
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    running = true;
    endAt = Date.now() + TOTAL * 1000;
    lastShown = -1;
    card.classList.remove('is-done');
    card.classList.add('is-running');
    startBtn.disabled = true;
    startText.textContent = '正在给你十秒';
    stopBtn.hidden = false;
    unitEl.textContent = '秒';
    noteEl.textContent = '十秒之后自己会停，不用管它。';
    paint(TOTAL * 1000);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function reset(text) {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    card.classList.remove('is-running', 'is-done', 'is-ticking');
    startBtn.disabled = false;
    startText.textContent = '可以，耽误一下';
    stopBtn.hidden = true;
    noteEl.textContent = text || '点一下，十秒之后自己会停。';
    unitEl.textContent = '秒';
    countEl.textContent = String(TOTAL);
    lastShown = TOTAL;
    barEl.style.strokeDashoffset = '0';
  }

  function finish() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    card.classList.remove('is-running', 'is-ticking');
    card.classList.add('is-done');
    countEl.textContent = '10';
    unitEl.textContent = '秒到了';
    noteEl.textContent = DONE_TEXT;
    barEl.style.strokeDashoffset = '0';
    startText.textContent = '再来一次';
    startBtn.disabled = false;
    stopBtn.hidden = true;
  }

  startBtn.addEventListener('click', function () {
    if (running) return;
    start();
  });

  stopBtn.addEventListener('click', function () {
    if (!running) return;
    reset('停下了。想再来一次就再点一下。');
  });

  /* 切到别的标签页时不停表：真实时间照样往前走，回来就是对的时间 */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && running) paint(Math.max(0, endAt - Date.now()));
  });

  reset();
})();
