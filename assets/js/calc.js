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
  function loadNerdamer() {
    if (window.nerdamer) { nerdamerState = 'ready'; return; }
    if (nerdamerState === 'loading' || nerdamerState === 'failed') return;
    nerdamerState = 'loading';
    var s = document.createElement('script');
    s.src = 'assets/js/lib/nerdamer.all.min.js';
    s.onload = function () { nerdamerState = 'ready'; };
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
    memory: 0,
    shift: false,
    history: []
  };

  /* ---------- 按键定义 ---------- */
  var KEYS = [
    { label: 'SHIFT', cls: 'k-fn', act: 'shift' },
    { label: '(', ins: '(' },
    { label: ')', ins: ')' },
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
    var s = el.selectionStart;
    var e = el.selectionEnd;
    if (s === null || s === undefined || s === e) {
      el.value = el.value + text;
    } else {
      el.value = el.value.slice(0, s) + text + el.value.slice(e);
    }
    try { el.setSelectionRange(el.value.length, el.value.length); } catch (err) { /* 忽略 */ }
    state.expr = el.value;
    preview();
  }

  function backspace() {
    var el = exprInput;
    el.value = el.value.slice(0, -1);
    state.expr = el.value;
    preview();
  }

  function clearAll() {
    exprInput.value = '';
    state.expr = '';
    resultEl.textContent = '0';
    resultEl.classList.remove('is-error');
    state.shift = false;
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
    } catch (err) {
      /* 输入过程中不报错，等按 = */
    }
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
      state.ans = n;
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
  bindAux('auxAns', function () { insert(String(state.ans)); });
  bindAux('auxMC', function () { state.memory = 0; updateMem(); });
  bindAux('auxMR', function () { insert(String(state.memory)); });
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
    if (/^[0-9+\-*/().^!%]$/.test(k)) { e.preventDefault(); insert(k); return; }
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

  function guard(name) {
    if (E.hasNerdamer()) { nerdamerState = 'ready'; return true; }
    loadNerdamer();
    if (nerdamerState === 'failed') {
      resultBox($(name), '提示', '符号计算库加载失败，请检查网络后重试。', '', true);
    } else {
      resultBox($(name), '提示', '正在加载计算库，请稍等一两秒再点一次「计算」。', '', true);
    }
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
      if (!guard('diffResult')) return;
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
        resultBox($('diffResult'), '求导结果', label + ' = ' + E.prettify(d), extra);
      } catch (err) {
        resultBox($('diffResult'), '求导', '无法求导：' + err.message, '', true);
      }
    });
  }

  /* ---------- 不定积分 ---------- */
  var integGo = $('integGo');
  if (integGo) {
    integGo.addEventListener('click', function () {
      if (!guard('integResult')) return;
      var f = $('integF').value.trim();
      if (!f) { resultBox($('integResult'), '不定积分', '请先填写被积函数 f(x)', '', true); return; }
      try {
        var r = E.integral(f, 'x', false);
        resultBox($('integResult'), '不定积分结果', '∫ ' + E.prettify(f) + ' dx = ' + E.prettify(r) + ' + C');
      } catch (err) {
        resultBox($('integResult'), '不定积分', '无法求出原函数：' + err.message, '', true);
      }
    });
  }

  /* ---------- 定积分 ---------- */
  var defintGo = $('defintGo');
  if (defintGo) {
    defintGo.addEventListener('click', function () {
      if (!guard('defintResult')) return;
      var f = $('defintF').value.trim();
      var a = $('defintA').value.trim() || '0';
      var b = $('defintB').value.trim() || '1';
      if (!f) { resultBox($('defintResult'), '定积分', '请先填写被积函数 f(x)', '', true); return; }
      try {
        var r = E.definiteIntegral(f, a, b, 'x', false);
        var label = '∫(' + a + ' → ' + b + ') ' + E.prettify(f) + ' dx';
        var parts = [];
        if (r.exact !== null && r.exact !== undefined) parts.push(E.prettify(r.exact));
        if (r.numeric !== null && !Number.isNaN(r.numeric)) parts.push('≈ ' + E.formatNumber(r.numeric));
        if (!parts.length) { resultBox($('defintResult'), '定积分', '无法计算该积分', '', true); return; }
        resultBox($('defintResult'), '定积分结果', label + ' = ' + parts[0], parts.length > 1 ? '数值结果：' + parts[1] : '');
      } catch (err) {
        resultBox($('defintResult'), '定积分', '计算失败：' + err.message, '', true);
      }
    });
  }

  /* ---------- 极限 ---------- */
  var limitGo = $('limitGo');
  if (limitGo) {
    limitGo.addEventListener('click', function () {
      if (!guard('limitResult')) return;
      var f = $('limitF').value.trim();
      var to = $('limitTo').value.trim() || '0';
      if (!f) { resultBox($('limitResult'), '极限', '请先填写函数 f(x)', '', true); return; }
      try {
        var r = E.limit(f, 'x', to, false);
        var label = 'lim(x→' + to + ') ' + E.prettify(f);
        if (r.exact !== null && r.exact !== undefined) {
          resultBox($('limitResult'), '极限结果', label + ' = ' + E.prettify(r.exact));
        } else if (r.numeric !== null && !Number.isNaN(r.numeric)) {
          resultBox($('limitResult'), '极限结果（数值）', label + ' ≈ ' + E.formatNumber(r.numeric));
        } else {
          resultBox($('limitResult'), '极限', '该极限不存在，或左右极限不相等。', '', true);
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
      if (!guard('solveResult')) return;
      var eq = $('solveEq').value.trim();
      if (!eq) { resultBox($('solveResult'), '解方程', '请先填写方程，例如 x^2-4=0', '', true); return; }
      try {
        var r = E.solve(eq, 'x');
        if (!r.solutions.length) {
          resultBox($('solveResult'), '方程的解', r.note || '未找到实数解', '', true);
          return;
        }
        var shown = r.solutions.map(function (s) { return 'x = ' + E.prettify(s); }).join('　　');
        var extra = r.solutions.length > 1 ? '共 ' + r.solutions.length + ' 个实数解' : '';
        if (r.note) extra = (extra ? extra + '；' : '') + r.note;
        resultBox($('solveResult'), '方程的解', shown, extra);
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
