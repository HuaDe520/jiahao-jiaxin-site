/* =========================================================
   学习计算器 · 界面逻辑（手机优先 · 卡西欧风格）
   依赖：calc-engine.js（数值 + 符号计算）、nerdamer（符号）
   ========================================================= */
(function () {
  'use strict';

  var E = window.CalcEngine;
  var $ = function (id) { return document.getElementById(id); };

  /* ================= 1. 模式标签切换 ================= */
  var tabs = document.querySelectorAll('.calc-tabs button');
  var panels = document.querySelectorAll('.calc-panel');

  /* 符号计算库（436KB）只在真正用到时下载，保证计算器秒开 */
  var nerdamerState = 'idle';   /* idle | loading | ready | failed */
  var pendingCompute = null;    /* 库还在下载时按下的「计算」，装好后自动补算 */
  function loadNerdamer() {
    if (window.nerdamer) { nerdamerState = 'ready'; return; }
    if (nerdamerState === 'loading' || nerdamerState === 'failed') return;
    nerdamerState = 'loading';
    var s = document.createElement('script');
    s.src = 'assets/js/lib/nerdamer.all.min.js';
    s.onload = function () {
      nerdamerState = 'ready';
      var fn = pendingCompute;
      pendingCompute = null;
      if (fn) fn();
    };
    s.onerror = function () { nerdamerState = 'failed'; };
    document.head.appendChild(s);
  }

  function activateTab(name, scroll) {
    Array.prototype.forEach.call(tabs, function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === name);
    });
    Array.prototype.forEach.call(panels, function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-panel') === name);
    });
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name !== 'basic') loadNerdamer();   /* 进入高级功能时才加载符号库 */
  }

  Array.prototype.forEach.call(tabs, function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.getAttribute('data-tab');
      if (location.hash !== '#' + name) location.hash = name;   /* 支持深链接与前进后退 */
      else activateTab(name, true);
    });
  });

  window.addEventListener('hashchange', function () {
    activateTab((location.hash || '#basic').replace('#', ''), true);
  });

  /* ================= 2. 基础计算器 ================= */
  var exprInput = $('calcExpr');
  var resultEl = $('calcResult');
  var modeBtn = $('calcMode');
  var memEl = $('memIndicator');
  var historyList = $('calcHistoryList');
  var keysWrap = $('calcKeys');

  var state = {
    expr: '',
    ans: 0,
    justComputed: false,
    memory: 0,
    shift: false,
    history: []
  };

  /* ---------- 按键定义 ---------- */
  var KEYS = [
    { label: 'SHIFT', cls: 'k-fn', act: 'shift' },
    { label: '(', ins: '(' },
    /* 逗号是 nCr / nPr / mod 这类双参数函数的必需输入，
       手机端不弹系统键盘，所以必须给一个按键（沿用卡西欧 SHIFT+) 的位置） */
    { label: ')', ins: ')', shift: { label: ',', ins: ',', cls: 'k-fn' } },
    { label: 'DEL', cls: 'k-del', act: 'del' },
    { label: 'AC', cls: 'k-ac', act: 'ac' },

    { label: 'x²', ins: '^2', cls: 'k-fn', shift: { label: 'x³', ins: '^3', cls: 'k-fn' } },
    { label: 'x^', ins: '^', cls: 'k-fn', shift: { label: 'ʸ√x', ins: '^(1/', cls: 'k-fn' } },
    { label: '√', ins: 'sqrt(', cls: 'k-fn', shift: { label: '∛', ins: 'cbrt(', cls: 'k-fn' } },
    { label: 'π', ins: 'pi', cls: 'k-fn', shift: { label: '|x|', ins: 'abs(', cls: 'k-fn' } },
    { label: 'e', ins: 'e', cls: 'k-fn', shift: { label: 'mod', ins: 'mod(', cls: 'k-fn' } },

    { label: 'sin', ins: 'sin(', cls: 'k-fn', shift: { label: 'sin⁻¹', ins: 'asin(', cls: 'k-fn' } },
    { label: 'cos', ins: 'cos(', cls: 'k-fn', shift: { label: 'cos⁻¹', ins: 'acos(', cls: 'k-fn' } },
    { label: 'tan', ins: 'tan(', cls: 'k-fn', shift: { label: 'tan⁻¹', ins: 'atan(', cls: 'k-fn' } },
    { label: 'ln', ins: 'ln(', cls: 'k-fn', shift: { label: 'eˣ', ins: 'exp(', cls: 'k-fn' } },
    { label: 'log', ins: 'log10(', cls: 'k-fn', shift: { label: '10ˣ', ins: '10^(', cls: 'k-fn' } },

    { label: '7', ins: '7' },
    { label: '8', ins: '8' },
    { label: '9', ins: '9' },
    { label: '÷', ins: '/', cls: 'k-op' },
    { label: '%', ins: '%', cls: 'k-op' },

    { label: '4', ins: '4' },
    { label: '5', ins: '5' },
    { label: '6', ins: '6' },
    { label: '×', ins: '*', cls: 'k-op' },
    { label: 'n!', ins: '!', cls: 'k-fn', shift: { label: 'nCr', ins: 'ncr(', cls: 'k-fn' } },

    { label: '1', ins: '1' },
    { label: '2', ins: '2' },
    { label: '3', ins: '3' },
    { label: '−', ins: '-', cls: 'k-op' },
    { label: '1/x', ins: '1/(', cls: 'k-fn', shift: { label: 'nPr', ins: 'npr(', cls: 'k-fn' } },

    { label: '0', ins: '0' },
    { label: '.', ins: '.' },
    { label: 'EXP', ins: '*10^', cls: 'k-fn' },
    { label: '+', ins: '+', cls: 'k-op' },
    { label: '=', cls: 'k-eq', act: 'eq' }
  ];

  function renderKeys() {
    keysWrap.innerHTML = '';
    KEYS.forEach(function (k) {
      var btn = document.createElement('button');
      btn.type = 'button';
      var cur = (state.shift && k.shift) ? k.shift : k;
      btn.className = cur.cls || '';
      btn.innerHTML = cur.label + (k.shift ? '<small>' + (state.shift ? k.label : k.shift.label) + '</small>' : '');
      if (k.act === 'shift' && state.shift) btn.classList.add('k-shift-on');
      btn.addEventListener('click', function () { press(k); });
      keysWrap.appendChild(btn);
    });
  }

  function press(k) {
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* 忽略 */ } }
    if (k.act === 'shift') {
      state.shift = !state.shift;
      renderKeys();
      return;
    }
    if (k.act === 'del') { backspace(); return; }
    if (k.act === 'ac') { clearAll(); return; }
    if (k.act === 'eq') { compute(); return; }

    var cur = (state.shift && k.shift) ? k.shift : k;
    insert(cur.ins);
    if (state.shift) { state.shift = false; renderKeys(); }
  }

  /* ---------- 输入框操作 ---------- */
  function insert(text) {
    var el = exprInput;

    /* 刚按过 = 时：输入数字就重新开始，输入运算符则接着上一次结果算（与实体计算器一致） */
    if (state.justComputed) {
      var first = text.charAt(0);
      if (/[0-9.]/.test(first) || /[a-z(]/i.test(first)) { el.value = ''; }
      else if (/[+\-*/^%]/.test(first)) { el.value = String(state.ans); }
      state.justComputed = false;
    }

    var s = el.selectionStart;
    var e = el.selectionEnd;
    if (s === null || s === undefined) {
      el.value = el.value + text;
    } else {
      el.value = el.value.slice(0, s) + text + el.value.slice(e);
      var pos = s + text.length;
      try { el.setSelectionRange(pos, pos); } catch (err) { /* 忽略 */ }
    }
    state.expr = el.value;
    preview();
  }

  function backspace() {
    var el = exprInput;
    el.value = el.value.slice(0, -1);
    state.expr = el.value;
    state.justComputed = false;
    preview();
  }

  function clearAll() {
    exprInput.value = '';
    state.expr = '';
    resultEl.textContent = '0';
    resultEl.classList.remove('is-error');
    state.shift = false;
    state.justComputed = false;
    fitResultText();
    renderKeys();
  }

  /* ---------- 实时预览 ---------- */
  function preview() {
    var v = exprInput.value.trim();
    if (!v) { resultEl.textContent = '0'; resultEl.classList.remove('is-error'); return; }
    try {
      var n = E.evaluate(v, {}, E.degrees);
      resultEl.textContent = E.formatNumber(n);
      resultEl.classList.remove('is-error');
      fitResultText();
    } catch (err) {
      /* 输入过程中不报错，等按 = */
    }
  }

  /* 结果过长时自动缩小字号（大数用 E 计数法，可达 18 个字符） */
  function fitResultText() {
    if (!resultEl) return;
    var len = (resultEl.textContent || '').length;
    resultEl.classList.toggle('is-long', len > 11);
    resultEl.classList.toggle('is-xlong', len > 17);
  }

  /* ---------- 计算 = ---------- */
  function compute() {
    var v = exprInput.value.trim();
    if (!v) return;
    try {
      var n = E.evaluate(v, {}, E.degrees);
      var out = E.formatNumber(n);
      resultEl.textContent = out;
      resultEl.classList.remove('is-error');
      fitResultText();
      state.ans = n;
      state.justComputed = true;
      addHistory(v, out);
    } catch (err) {
      resultEl.textContent = err.message;
      resultEl.classList.add('is-error');
    }
  }

  /* ---------- 历史记录 ---------- */
  function addHistory(expr, value) {
    state.history.unshift({ expr: expr, value: value });
    if (state.history.length > 30) state.history.pop();
    saveHistory();
    renderHistory();
  }
  function renderHistory() {
    if (!historyList) return;
    historyList.innerHTML = '';
    state.history.slice(0, 12).forEach(function (h) {
      var div = document.createElement('div');
      div.className = 'calc-history__item';
      div.innerHTML = '<span></span>';
      div.firstChild.textContent = h.expr + ' =';
      div.appendChild(document.createTextNode(h.value));
      div.title = '点击填入';
      div.addEventListener('click', function () {
        exprInput.value = h.value;
        state.expr = h.value;
        /* 填入的是一条完整算式，接下来按数字是继续输入、按运算符是接着算，
           不能还留在「刚算完」状态，否则第一个按键会把整条记录顶掉 */
        state.justComputed = false;
        preview();
      });
      historyList.appendChild(div);
    });
  }
  function saveHistory() {
    try { localStorage.setItem('jhjx-calc-history', JSON.stringify(state.history.slice(0, 30))); } catch (e) { /* 忽略 */ }
  }
  function loadHistory() {
    try {
      var raw = localStorage.getItem('jhjx-calc-history');
      if (raw) state.history = JSON.parse(raw) || [];
    } catch (e) { state.history = []; }
  }

  /* ---------- 副键：ANS / 记忆 ---------- */
  function bindAux(id, fn) {
    var el = $(id);
    if (el) el.addEventListener('click', fn);
  }
  /* 回填到输入框的数字：必须和屏幕上看到的一致。
     直接 String(n) 会把浮点噪声也填进去（0.49999999999999994），
     用户看到的是 0.5，填进去的也应该是 0.5。 */
  function numberForInput(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return null;   /* 无定义，不回填 */
    if (!isFinite(n)) return n > 0 ? '∞' : '-∞';
    return E.formatNumber(n);
  }
  bindAux('auxAns', function () {
    var s = numberForInput(state.ans);
    if (s !== null) insert(s);
  });
  bindAux('auxMC', function () { state.memory = 0; updateMem(); });
  bindAux('auxMR', function () {
    var s = numberForInput(state.memory);
    if (s !== null) insert(s);
  });
  bindAux('auxMPlus', function () { state.memory += currentValue(); updateMem(); });
  bindAux('auxMMinus', function () { state.memory -= currentValue(); updateMem(); });
  function currentValue() {
    try { return E.evaluate(exprInput.value.trim() || '0', {}, E.degrees); } catch (e) { return 0; }
  }
  function updateMem() {
    if (memEl) memEl.textContent = state.memory ? 'M' : '';
  }

  /* ---------- 角度模式 ---------- */
  function updateModeBtn() {
    if (!modeBtn) return;
    modeBtn.textContent = E.degrees ? 'DEG' : 'RAD';
    modeBtn.classList.toggle('is-rad', !E.degrees);
    /* 显示屏上的提示必须同步，否则会以为没切换成功 */
    var hint = $('angleHint');
    if (hint) hint.textContent = E.degrees ? 'DEG · 角度制' : 'RAD · 弧度制';
  }
  if (modeBtn) {
    modeBtn.addEventListener('click', function () {
      E.degrees = !E.degrees;
      updateModeBtn();
      preview();
    });
  }

  /* ---------- 桌面键盘 ---------- */
  document.addEventListener('keydown', function (e) {
    var basic = document.querySelector('.calc-panel[data-panel="basic"]');
    if (!basic || !basic.classList.contains('is-active')) return;
    var k = e.key;
    if (k === 'Enter' || k === '=') { e.preventDefault(); compute(); return; }
    if (k === 'Backspace') { e.preventDefault(); backspace(); return; }
    if (k === 'Escape') { e.preventDefault(); clearAll(); return; }
    if (k === 'Delete') { e.preventDefault(); clearAll(); return; }
    if (k === 'p') { e.preventDefault(); insert('pi'); return; }
    if (k === 'e' && !exprInput.value) { e.preventDefault(); insert('e'); return; }
    if (/^[0-9+\-*/().^!%,]$/.test(k)) { e.preventDefault(); insert(k); return; }
  });

  /* ---------- 初始化基础面板 ---------- */
  var startTab = (location.hash || '#basic').replace('#', '');
  activateTab(startTab, false);
  if (startTab !== 'basic') loadNerdamer();
  loadHistory();
  renderKeys();
  renderHistory();
  updateModeBtn();
  updateMem();
  if (exprInput) {
    exprInput.addEventListener('input', function () { state.expr = exprInput.value; preview(); });
  }
  /* 长按键盘不弹出系统菜单，手感更像原生 App */
  keysWrap.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  var clearHist = $('calcClearHistory');
  if (clearHist) {
    clearHist.addEventListener('click', function () {
      state.history = [];
      saveHistory();
      renderHistory();
    });
  }

  /* ================= 3. 高级功能（符号计算） ================= */
  function resultBox(el, label, mainHtml, extra, isError) {
    if (!el) return;
    el.hidden = false;
    el.innerHTML = '';
    var lab = document.createElement('div');
    lab.className = 'fx-result__label';
    lab.textContent = label;
    el.appendChild(lab);

    var main = document.createElement('div');
    if (isError) {
      main.className = 'fx-result__error';
      main.textContent = mainHtml;
    } else {
      main.className = 'fx-result__main';
      main.innerHTML = mainHtml;
    }
    el.appendChild(main);

    if (extra) {
      var ex = document.createElement('div');
      ex.className = 'fx-result__extra';
      ex.innerHTML = extra;
      el.appendChild(ex);
    }

    if (!isError) {
      var actions = document.createElement('div');
      actions.className = 'fx-result__actions';
      var copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = '复制结果';
      copy.addEventListener('click', function () {
        var text = main.textContent;
        var done = function () { copy.textContent = '已复制 ✓'; setTimeout(function () { copy.textContent = '复制结果'; }, 1600); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
        } else { fallbackCopy(text, done); }
      });
      actions.appendChild(copy);
      el.appendChild(actions);
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

  /* ---------- 极限的"取值过程"渲染 ---------- */
  function fmtSampleX(x) {
    if (!isFinite(x)) return x > 0 ? '∞' : '-∞';
    var abs = Math.abs(x);
    if (abs !== 0 && (abs >= 1e5 || abs < 1e-4)) return E.formatNumber(x);
    return String(parseFloat(x.toPrecision(6)));
  }

  /* nerdamer 偶尔把常数写成巨分数（33316161/37593262 ≈ √π/2），
     显示成小数更好懂；1/2、1/3 这类正常分数保留原样 */
  function shortenFractions(text) {
    return String(text).replace(/(\d+)\/(\d+)/g, function (m, a, b) {
      if (a.length < 6 && b.length < 6) return m;
      var v = Number(a) / Number(b);
      if (!isFinite(v)) return m;
      return E.formatNumber(v);
    });
  }
  function fmt(text) { return E.prettify(shortenFractions(text)); }

  /* 一个解能不能算出数值（排序、挑靠近 0 的解都要用） */
  function solutionValue(s) {
    try {
      var v = E.evaluate(String(s), {}, false);
      return (typeof v === 'number' && !Number.isNaN(v)) ? v : NaN;
    } catch (e) { return NaN; }
  }
  /* 解太多时（sin(x)=0 会给出几十个周期解）只挑最靠近 0 的几个 */
  function pickSolutions(list, max) {
    if (list.length <= max) return list.slice();
    return list.map(function (s) {
      var v = solutionValue(s);
      return { s: s, k: Number.isNaN(v) ? Infinity : Math.abs(v) };
    }).sort(function (a, b) { return a.k - b.k; })
      .slice(0, max)
      .map(function (o) { return o.s; });
  }
  /* 解本身是巨大分数时改显示小数 */
  function displaySolution(s) {
    var str = String(s);
    var m = /^\(?(-?\d+)\/(\d+)\)?$/.exec(str.trim());
    if (!m) return str;
    if (Math.abs(parseInt(m[1], 10)) < 10000 && parseInt(m[2], 10) < 10000) return str;
    var v = solutionValue(str);
    return Number.isNaN(v) ? str : E.formatNumber(v);
  }

  /* 根据左右采样判断发散方向，给出结论文字
     注意：这段说明和「取值过程」是同一层级的注解，字号也要一致，
     所以它走 extra 区，用 .fx-note 而不是 .fx-result__main 里的 .86em */
  function divergenceNote(sides, fallbackSign) {
    var L = null, R = null;
    if (sides && sides.left && sides.left.length) L = sides.left[sides.left.length - 1].y;
    if (sides && sides.right && sides.right.length) R = sides.right[sides.right.length - 1].y;
    if (typeof L === 'number' && typeof R === 'number' && !Number.isNaN(L) && !Number.isNaN(R) &&
        Math.abs(L) > 1 && Math.abs(R) > 1 && (L > 0) !== (R > 0)) {
      return '<span class="fx-note">左侧趋向 ' + (L > 0 ? '+∞' : '−∞') +
             '、右侧趋向 ' + (R > 0 ? '+∞' : '−∞') + '，两侧方向不同，因此极限不存在。</span>';
    }
    if (!fallbackSign) return '';
    return '<span class="fx-note">数学上写作 ' + (fallbackSign > 0 ? '+∞' : '−∞') +
           '，但它不是有限值，所以通常说该极限不存在。</span>';
  }

  function processHtml(sides, to) {
    if (!sides) return '';
    var blocks = [];
    function line(arr, title) {
      if (!arr || !arr.length) return;
      var pts = arr.slice(-3).map(function (p) {
        var y = (typeof p.y === 'number' && !Number.isNaN(p.y)) ? E.formatNumber(p.y) : '无定义';
        return 'f(' + fmtSampleX(p.x) + ') = ' + y;
      });
      blocks.push('<span class="fx-proc__line">' + title + '：' + pts.join('，') + '</span>');
    }
    if (sides.toInfinity) {
      line(sides.right, 'x 不断增大 / 减小');
    } else {
      line(sides.left, 'x 从左侧趋近');
      line(sides.right, 'x 从右侧趋近');
    }
    if (!blocks.length) return '';
    return '<span class="fx-proc__title">取值过程</span>' + blocks.join('');
  }

  /* 符号库没装好时先提示，并记下这次要算的东西：装好后自动补算，
     用户点一次「计算」就有结果，不用再点第二次 */
  function guard(btnId, name) {
    if (E.hasNerdamer()) { nerdamerState = 'ready'; return true; }
    loadNerdamer();
    if (nerdamerState === 'failed') {
      resultBox($(name), '提示', '符号计算库加载失败，请检查网络后重试。', '', true);
      return false;
    }
    resultBox($(name), '提示', '正在加载计算库，马上给出结果…', '', true);
    pendingCompute = function () {
      var b = $(btnId);
      if (b) b.click();
    };
    return false;
  }

  /* ---------- 求导 ---------- */
  var diffOrder = 1;
  var orderChips = $('diffOrder');
  if (orderChips) {
    Array.prototype.forEach.call(orderChips.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        diffOrder = parseInt(b.getAttribute('data-v'), 10);
        Array.prototype.forEach.call(orderChips.querySelectorAll('button'), function (x) {
          x.classList.toggle('is-active', x === b);
        });
      });
    });
  }
  var diffGo = $('diffGo');
  if (diffGo) {
    diffGo.addEventListener('click', function () {
      if (!guard('diffGo', 'diffResult')) return;
      var f = $('diffF').value.trim();
      var at = $('diffAt').value.trim();
      if (!f) { resultBox($('diffResult'), '求导', '请先填写函数 f(x)', '', true); return; }
      try {
        var d = E.derivative(f, 'x', diffOrder, false);
        var label = diffOrder === 1 ? "f'(x)" : (diffOrder === 2 ? "f''(x)" : "f''' (x)");
        var extra = '';
        if (at) {
          var val = E.derivative(f, 'x', diffOrder, false);
          var num = E.evaluate(val, { x: E.evaluate(at, {}, false) }, false);
          extra = '当 x = ' + at + ' 时，' + label + ' = ' + E.formatNumber(num);
        }
        resultBox($('diffResult'), '求导结果', label + ' = ' + fmt(d), extra);
      } catch (err) {
        resultBox($('diffResult'), '求导', '无法求导：' + err.message, '', true);
      }
    });
  }

  /* ---------- 不定积分 ---------- */
  var integGo = $('integGo');
  if (integGo) {
    integGo.addEventListener('click', function () {
      if (!guard('integGo', 'integResult')) return;
      var f = $('integF').value.trim();
      if (!f) { resultBox($('integResult'), '不定积分', '请先填写被积函数 f(x)', '', true); return; }
      try {
        var r = E.integral(f, 'x', false);
        resultBox($('integResult'), '不定积分结果', '∫ ' + fmt(f) + ' dx = ' + fmt(r) + ' + C');
      } catch (err) {
        resultBox($('integResult'), '不定积分', '无法求出原函数：' + err.message, '', true);
      }
    });
  }

  /* ---------- 定积分 ---------- */
  var defintGo = $('defintGo');
  if (defintGo) {
    defintGo.addEventListener('click', function () {
      if (!guard('defintGo', 'defintResult')) return;
      var f = $('defintF').value.trim();
      var a = $('defintA').value.trim() || '0';
      var b = $('defintB').value.trim() || '1';
      if (!f) { resultBox($('defintResult'), '定积分', '请先填写被积函数 f(x)', '', true); return; }
      try {
        var r = E.definiteIntegral(f, a, b, 'x', false);
        var label = '∫(' + fmt(a) + ' → ' + fmt(b) + ') ' + fmt(f) + ' dx';
        if (r.diverges) {
          resultBox($('defintResult'), '定积分发散',
            label + ' 发散：区间内有函数值趋于无穷的点，或区间本身是无穷区间。', '', true);
          return;
        }
        var hasExact = (r.exact !== null && r.exact !== undefined);
        var hasNum = (r.numeric !== null && !Number.isNaN(r.numeric) && isFinite(r.numeric));
        if (!hasExact && !hasNum) {
          resultBox($('defintResult'), '定积分',
            label + ' 算不出来：区间内可能有无穷间断点，或函数在区间上无界。', '', true);
          return;
        }
        var numText = hasNum ? E.formatNumber(r.numeric) : null;
        var main = hasExact ? (label + ' = ' + fmt(r.exact)) : (label + ' ≈ ' + numText);
        var note = [];
        if (hasExact && hasNum) note.push('数值结果：≈ ' + numText);
        if (r.improper) note.push('区间含奇点或无穷，已按广义积分计算。');
        resultBox($('defintResult'), '定积分结果', main, note.join('<br>'));
      } catch (err) {
        resultBox($('defintResult'), '定积分', '计算失败：' + err.message, '', true);
      }
    });
  }

  /* ---------- 极限 ---------- */
  var limitGo = $('limitGo');
  if (limitGo) {
    limitGo.addEventListener('click', function () {
      if (!guard('limitGo', 'limitResult')) return;
      var f = $('limitF').value.trim();
      var to = $('limitTo').value.trim() || '0';
      if (!f) { resultBox($('limitResult'), '极限', '请先填写函数 f(x)', '', true); return; }
      try {
        var r = E.limit(f, 'x', to, false);
        var toText = /^-?\s*(inf|infinity)$/i.test(to) ? (to.charAt(0) === '-' ? '-∞' : '∞') : to;
        var label = 'lim(x→' + toText + ') ' + fmt(f);
        var proc = processHtml(r.sides, to);

        if (r.exact !== null && r.exact !== undefined) {
          resultBox($('limitResult'), '极限结果', label + ' = ' + fmt(r.exact), proc);
        } else if (r.infinite) {
          var dir = r.infiniteSign > 0 ? '+∞' : '−∞';
          resultBox($('limitResult'), '极限不存在（发散）',
            label + ' 不存在：当 x → ' + toText + ' 时函数值趋向 ' + dir + '。',
            divergenceNote(r.sides, r.infiniteSign) + proc);
        } else if (r.unstable) {
          resultBox($('limitResult'), '极限无法确定',
            label + ' 无法用数值方法确定：函数在 ' + toText + ' 附近剧烈振荡。', proc);
        } else if (r.none) {
          if (r.blowsUp) {
            resultBox($('limitResult'), '极限不存在（发散）',
              label + ' 不存在：函数在 ' + toText + ' 附近无界，取不到有限值。',
              divergenceNote(r.sides, 0) + proc);
          } else {
            resultBox($('limitResult'), '极限不存在',
              label + ' 不存在：左右极限不相等（或函数在该点附近无定义）。', proc);
          }
        } else {
          resultBox($('limitResult'), '极限结果（数值）', label + ' ≈ ' + E.formatNumber(r.numeric), proc);
        }
      } catch (err) {
        resultBox($('limitResult'), '极限', '计算失败：' + err.message, '', true);
      }
    });
  }

  /* ---------- 解方程 ---------- */
  var solveGo = $('solveGo');
  if (solveGo) {
    solveGo.addEventListener('click', function () {
      if (!guard('solveGo', 'solveResult')) return;
      var eq = $('solveEq').value.trim();
      if (!eq) { resultBox($('solveResult'), '解方程', '请先填写方程，例如 x^2-4=0', '', true); return; }
      try {
        var r = E.solve(eq, 'x');
        if (!r.solutions.length) {
          resultBox($('solveResult'), '方程的解', r.note || '未找到实数解', '', true);
          return;
        }
        /* 三角/指数方程会给出几十个周期解，只挑最靠近 0 的几个，并且
           把 49180508/70952475 这类巨分数显示成小数 */
        var MAX = 8;
        var list = pickSolutions(r.solutions, MAX);
        var shown = list.map(function (s) { return 'x = ' + fmt(displaySolution(s)); }).join('　　');
        var extra = [];
        if (r.solutions.length > MAX) {
          extra.push('共 ' + r.solutions.length + ' 个实数解，这里列出最靠近 0 的 ' + MAX + ' 个');
        } else if (r.solutions.length > 1) {
          extra.push('共 ' + r.solutions.length + ' 个实数解');
        }
        if (r.note) extra.push(r.note);
        resultBox($('solveResult'), '方程的解', shown, extra.join('；'));
      } catch (err) {
        resultBox($('solveResult'), '解方程', '无法求解：' + err.message, '', true);
      }
    });
  }

  /* ---------- 高级面板里输入框按回车即计算 ---------- */
  [['diffF', 'diffGo'], ['diffAt', 'diffGo'], ['integF', 'integGo'],
   ['defintF', 'defintGo'], ['defintA', 'defintGo'], ['defintB', 'defintGo'],
   ['limitF', 'limitGo'], ['limitTo', 'limitGo'], ['solveEq', 'solveGo']].forEach(function (pair) {
    var el = $(pair[0]);
    if (!el) return;
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var btn = $(pair[1]);
        if (btn) btn.click();
      }
    });
  });
})();
