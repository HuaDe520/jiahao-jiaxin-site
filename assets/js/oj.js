/* =========================================================
   「0还是1?」—— 编程语言题库：选语言、写代码、当场运行、按测试点评判
   ---------------------------------------------------------
   · 语言下拉里现在只有 Python 这一门，别的以后再往里加
   · 代码不上传：解释器（目前是 Skulpt）和判题都在浏览器里跑
   · 判题只看输出：每道题有几个测试点，全部对上才算通过
     比较时按「词」比，数字允许极小误差（浮点数在小数最后一位上
     各引擎可能不同，别为这个卡住初学者）
   · 做错的题自动收进「自分谬误样本」（存在这台设备上）
   · 这个页面只在电脑端开放：手机上看到的是说明卡片
   ========================================================= */
(function (global) {
  'use strict';

  var R = global.JHJX_OJ_RUNNER;
  var BANK_URL = 'assets/data/oj-bank.json';
  var RUN_TIMEOUT = 4000;      /* 自由运行的执行预算 */
  var CASE_TIMEOUT = 2500;     /* 判题时每个测试点的预算 */
  var JUDGE_TOTAL_BUDGET = 20000;  /* 判一整题的总预算，超了就停下 */

  var $ = function (id) { return document.getElementById(id); };
  var el = {};

  /* ---------------- 电脑端判断 ---------------- */
  function isDesktop() {
    var ua = '';
    try { ua = navigator.userAgent || ''; } catch (e) { ua = ''; }
    if (/Android|iPhone|iPad|iPod|Mobile|HarmonyOS|Windows Phone|MicroMessenger/i.test(ua)) return false;
    try { if (window.matchMedia('(max-width: 860px)').matches) return false; } catch (e) { /* 忽略 */ }
    return true;
  }

  /* ---------------- 本机存储（按账号分开存） ---------------- */
  var uid = (function () {
    try {
      var u = JSON.parse(localStorage.getItem('jhjx-account-user') || 'null');
      if (u && u.id) return 'u' + u.id;
    } catch (e) { /* 忽略 */ }
    return 'guest';
  })();
  var PREFIX = 'jhjx-oj-' + uid + '-';
  function readJSON(key, dflt) {
    try {
      var raw = localStorage.getItem(PREFIX + key);
      if (!raw) return dflt;
      var v = JSON.parse(raw);
      return v == null ? dflt : v;
    } catch (e) { return dflt; }
  }
  function writeJSON(key, v) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(v)); } catch (e) { /* 存不下就算了 */ }
  }
  var solved = readJSON('solved', {});
  var wrong = readJSON('wrong', {});

  /* ---------------- 状态 ---------------- */
  var state = {
    pane: 'run',
    bank: null,
    byId: {},
    cats: [],
    cat: 'all',
    q: '',
    status: 'all',
    level: '0',
    problem: null,
    judging: false,
    judgingList: false
  };

  /* =========================================================
     编辑器：行号 + Tab 缩进 + 回车自动缩进
     ========================================================= */
  function makeEditor(area, gutter) {
    function paintGutter() {
      if (!gutter) return;
      var n = area.value.split('\n').length;
      var out = '';
      for (var i = 1; i <= Math.max(n, 1); i++) out += i + (i < n ? '\n' : '');
      gutter.textContent = out;
      gutter.scrollTop = area.scrollTop;
    }
    function insert(text) {
      var s = area.selectionStart, e2 = area.selectionEnd;
      area.value = area.value.slice(0, s) + text + area.value.slice(e2);
      area.selectionStart = area.selectionEnd = s + text.length;
      paintGutter();
    }
    area.addEventListener('input', paintGutter);
    area.addEventListener('scroll', function () { if (gutter) gutter.scrollTop = area.scrollTop; });
    area.addEventListener('keydown', function (ev) {
      if (ev.key === 'Tab') {
        ev.preventDefault();
        var s = area.selectionStart, e2 = area.selectionEnd;
        var val = area.value;
        if (s !== e2 && val.slice(s, e2).indexOf('\n') >= 0) {
          /* 选了多行：整块缩进 / 反缩进 */
          var lineStart = val.lastIndexOf('\n', s - 1) + 1;
          var chunk = val.slice(lineStart, e2);
          var changed = ev.shiftKey ? chunk.replace(/^ {1,4}/gm, '') : chunk.replace(/^/gm, '    ');
          area.value = val.slice(0, lineStart) + changed + val.slice(e2);
          area.selectionStart = lineStart;
          area.selectionEnd = lineStart + changed.length;
          paintGutter();
          return;
        }
        if (ev.shiftKey) {
          var before = val.slice(Math.max(0, s - 4), s);
          if (before === '    ') {
            area.value = val.slice(0, s - 4) + val.slice(s);
            area.selectionStart = area.selectionEnd = s - 4;
            paintGutter();
          }
          return;
        }
        insert('    ');
        return;
      }
      if (ev.key === 'Enter') {
        /* 回车沿用上一行缩进；上一行以冒号结尾（if/for/def…）再多缩一级 */
        var v = area.value;
        var pos = area.selectionStart;
        var head = v.slice(0, pos);
        var lineHead = head.slice(head.lastIndexOf('\n') + 1);
        var indent = (lineHead.match(/^[ \t]*/) || [''])[0];
        var extra = /:\s*$/.test(lineHead) ? '    ' : '';
        if (indent || extra) {
          ev.preventDefault();
          var ins = '\n' + indent + extra;
          area.value = v.slice(0, pos) + ins + v.slice(area.selectionEnd);
          area.selectionStart = area.selectionEnd = pos + ins.length;
          paintGutter();
        }
      }
    });
    paintGutter();
    return { sync: paintGutter };
  }

  var playEditor = null;
  var probEditor = null;

  /* =========================================================
     运行器状态
     ========================================================= */
  var runnerReady = false;
  function setState(text, cls) {
    if (!el.state) return;
    el.state.textContent = text;
    el.state.className = 'oj-state' + (cls ? ' is-' + cls : '');
  }
  function ensureRunner() {
    if (runnerReady) return Promise.resolve(true);
    setState('运行环境：正在加载解释器（第一次约 1MB，之后走缓存）…');
    return R.ensure().then(function () {
      runnerReady = true;
      setState('运行环境：已就绪 · Python 3', 'ok');
      return true;
    }, function (err) {
      setState('运行环境加载失败：' + ((err && err.message) || '检查网络后刷新一下'), 'bad');
      return false;
    });
  }

  /* =========================================================
     输出比较：按词比，数字给一点容差
     ========================================================= */
  function normLines(s) {
    return String(s == null ? '' : s)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (l) { return l.replace(/[ \t]+$/, ''); })
      .join('\n')
      .replace(/\n+$/, '');
  }
  function tokens(s) {
    var t = normLines(s).split(/\s+/);
    var out = [];
    for (var i = 0; i < t.length; i++) if (t[i] !== '') out.push(t[i]);
    return out;
  }
  function looksNum(t) { return /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(t); }
  function sameNumber(a, b) {
    var x = Number(a), y = Number(b);
    if (!isFinite(x) || !isFinite(y)) return false;
    var tol = Math.max(1e-6, Math.abs(y) * 1e-6);
    return Math.abs(x - y) <= tol;
  }
  /* 返回 {ok, reason, at} */
  function compareOut(actual, expected) {
    var a = tokens(actual);
    var b = tokens(expected);
    if (a.length !== b.length) {
      return { ok: false, reason: '输出的内容个数不一样（期望 ' + b.length + ' 段，你的程序给了 ' + a.length + ' 段）' };
    }
    for (var i = 0; i < b.length; i++) {
      if (a[i] === b[i]) continue;
      if (looksNum(a[i]) && looksNum(b[i]) && sameNumber(a[i], b[i])) continue;
      return { ok: false, at: i, reason: '第 ' + (i + 1) + ' 段内容不对' };
    }
    return { ok: true };
  }

  /* =========================================================
     写代码面板
     ========================================================= */
  function showRunOut(text, bad, empty) {
    if (!el.runOut) return;
    el.runOut.textContent = text;
    el.runOut.className = 'oj-out' + (bad ? ' is-bad' : '') + (empty ? ' is-empty' : '');
  }
  function runPlayground() {
    var code = el.code.value;
    if (!String(code).trim()) {
      showRunOut('先写两句代码再运行吧。', false, true);
      if (el.runMeta) el.runMeta.textContent = '';
      return;
    }
    el.run.disabled = true;
    showRunOut('正在跑…', false, true);
    if (el.runMeta) el.runMeta.textContent = '';
    ensureRunner().then(function (ok) {
      if (!ok) { el.run.disabled = false; showRunOut('运行环境没加载下来：检查一下网络，再点一次运行。', true); return; }
      return R.run(code, el.stdin.value, RUN_TIMEOUT).then(function (res) {
        el.run.disabled = false;
        if (!res.ok && res.setupFailed) { showRunOut(res.stderr || '运行环境没起来', true); return; }
        var head = '';
        if (res.ok) {
          head = '跑完了';
          showRunOut(res.stdout ? res.stdout : '（程序没有输出任何东西）', false, !res.stdout);
        } else if (res.timeout) {
          head = '超时';
          showRunOut(res.stderr + '\n\n（已经帮你停下来了，把循环条件检查一下）', true);
        } else {
          head = '运行出错';
          showRunOut((res.stdout ? res.stdout + '\n--- 下面是报错 ---\n' : '') + (res.stderr || '出错了'), true);
        }
        if (el.runMeta) el.runMeta.textContent = head + ' · 用时 ' + (res.ms / 1000).toFixed(2) + ' 秒';
      });
    });
  }

  /* =========================================================
     判题
     ========================================================= */
  function runCases(problem, code, onlyFirst) {
    var tests = (problem.tests || []).slice();
    if (onlyFirst) tests = tests.slice(0, 1);
    var results = [];
    var started = Date.now();
    var stopped = false;

    function step(i) {
      if (i >= tests.length) return Promise.resolve(results);
      if (Date.now() - started > JUDGE_TOTAL_BUDGET) {
        stopped = true;
        return Promise.resolve(results);
      }
      return R.run(code, tests[i].in, CASE_TIMEOUT).then(function (res) {
        var cmp = null;
        if (res.ok) cmp = compareOut(res.stdout, tests[i].out);
        results.push({
          index: i,
          isSample: i === 0,
          input: tests[i].in,
          expected: tests[i].out,
          stdout: res.stdout,
          stderr: res.stderr,
          ms: res.ms,
          timeout: !!res.timeout,
          ok: !!(res.ok && cmp && cmp.ok),
          reason: res.ok ? (cmp && cmp.reason) || '' : (res.timeout ? '运行超时' : '运行出错')
        });
        if (!results[results.length - 1].ok && results[results.length - 1].timeout) {
          /* 超时就不必再跑后面的了 */
          stopped = true;
          return results;
        }
        return step(i + 1);
      });
    }
    return step(0).then(function (list) {
      var passed = 0;
      for (var i = 0; i < list.length; i++) if (list[i].ok) passed++;
      return {
        caseResults: list,
        passed: passed,
        total: tests.length,
        allPass: passed === tests.length && !stopped,
        stopped: stopped,
        ms: Date.now() - started
      };
    });
  }

  function verdictText(judge) {
    if (judge.allPass) return { text: '通过', cls: 'is-ok' };
    for (var i = 0; i < judge.caseResults.length; i++) {
      var c = judge.caseResults[i];
      if (!c.ok) {
        if (c.timeout) return { text: '运行超时', cls: 'is-bad' };
        if (c.stderr && !c.stdout) return { text: '运行出错', cls: 'is-bad' };
        return { text: '答案不对', cls: 'is-bad' };
      }
    }
    return { text: '没通过', cls: 'is-bad' };
  }

  function renderJudge(judge) {
    var v = verdictText(judge);
    el.probVerdict.textContent = v.text;
    el.probVerdict.className = 'oj-result__title oj-verdict ' + v.cls;
    el.probMeta2.textContent = '测试点通过 ' + judge.passed + ' / ' + judge.total +
      ' · 用时 ' + (judge.ms / 1000).toFixed(2) + ' 秒' + (judge.stopped ? ' · 后面的测试点先不跑了' : '');

    var box = el.probOutBody;
    box.innerHTML = '';

    function line(html) {
      var p = document.createElement('p');
      p.className = 'oj-line';
      p.innerHTML = html;
      box.appendChild(p);
      return p;
    }

    if (judge.allPass) {
      var ok = document.createElement('p');
      ok.className = 'oj-line';
      ok.innerHTML = '<b>通过！</b>程序对每个测试点都给出了正确的输出。';
      box.appendChild(ok);
    }

    /* 每个测试点一行，列出过没过（不显示隐藏测试点的输入内容） */
    var ul = document.createElement('ul');
    ul.className = 'oj-cases';
    judge.caseResults.forEach(function (c) {
      var li = document.createElement('li');
      li.textContent = '测试点 ' + (c.index + 1) + (c.isSample ? '（示例）' : '') +
        '：' + (c.ok ? '通过' : c.reason || '没通过') + ' · ' + (c.ms / 1000).toFixed(2) + ' 秒';
      if (!c.ok) li.style.color = '#a3372f';
      ul.appendChild(li);
    });
    if (ul.children.length) box.appendChild(ul);

    /* 第一个没过的测试点：把「期望 / 你的程序」并排摆出来 */
    var firstBad = null;
    for (var i = 0; i < judge.caseResults.length; i++) {
      if (!judge.caseResults[i].ok) { firstBad = judge.caseResults[i]; break; }
    }
    if (firstBad) {
      if (firstBad.timeout) {
        line('这个测试点上程序超过 ' + (CASE_TIMEOUT / 1000).toFixed(1) + ' 秒还没跑完，多半是死循环，或者循环条件没写对。');
      } else if (firstBad.stderr && !firstBad.stdout) {
        line('<b>程序报错了：</b>');
        var pre = document.createElement('pre');
        pre.className = 'oj-out is-bad';
        pre.style.margin = '6px 0 0';
        pre.textContent = firstBad.stderr;
        box.appendChild(pre);
      } else {
        line('<b>' + (firstBad.isSample ? '示例就没对上：' : '第 ' + (firstBad.index + 1) + ' 个测试点对不上：') + '</b>' +
          (firstBad.reason || '输出不一样'));
        if (firstBad.isSample) {
          line('这道题的示例输入：');
          var pin = document.createElement('pre');
          pin.className = 'oj-sample';
          pin.textContent = firstBad.input;
          box.appendChild(pin);
        }
        var diff = document.createElement('div');
        diff.className = 'oj-diff';
        function cell(title, text, bad) {
          var d = document.createElement('div');
          var h = document.createElement('h5');
          h.textContent = title;
          d.appendChild(h);
          var p = document.createElement('pre');
          if (bad) p.className = 'is-bad';
          p.textContent = text === '' ? '（空的）' : text;
          d.appendChild(p);
          return d;
        }
        diff.appendChild(cell('期望的输出', firstBad.expected, false));
        diff.appendChild(cell('你的程序输出', firstBad.stdout, true));
        box.appendChild(diff);
      }
    }
  }

  /* ---------------- 提交 ---------------- */
  function submitProblem() {
    var p = state.problem;
    if (!p || state.judging) return;
    var code = el.probCode.value;
    if (!String(code).trim()) {
      el.probVerdict.textContent = '还没写代码';
      el.probVerdict.className = 'oj-result__title oj-verdict is-wait';
      el.probMeta2.textContent = '';
      el.probOutBody.innerHTML = '<p class="oj-line">先在下面写点代码，再提交。</p>';
      return;
    }
    state.judging = true;
    el.probSubmit.disabled = true;
    el.probRunSample.disabled = true;
    el.probVerdict.textContent = '正在判…';
    el.probVerdict.className = 'oj-result__title oj-verdict is-wait';
    el.probMeta2.textContent = '';
    el.probOutBody.innerHTML = '<p class="oj-line">正在把 ' + (p.tests || []).length + ' 个测试点一个个跑过去…</p>';

    ensureRunner().then(function (ok) {
      if (!ok) {
        state.judging = false;
        el.probSubmit.disabled = false;
        el.probRunSample.disabled = false;
        el.probVerdict.textContent = '运行环境没起来';
        el.probVerdict.className = 'oj-result__title oj-verdict is-bad';
        el.probOutBody.innerHTML = '<p class="oj-line">运行环境没加载下来：检查一下网络，刷新页面再试。</p>';
        return;
      }
      return runCases(p, code, false).then(function (judge) {
        state.judging = false;
        el.probSubmit.disabled = false;
        el.probRunSample.disabled = false;
        renderJudge(judge);
        saveCode(p.id, code);
        /* 判完把结果滚进视野：编辑器挺高的，不然还得自己往下找 */
        try { el.probResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* 忽略 */ }
        if (judge.allPass) {
          solved[String(p.id)] = { at: Date.now(), ms: judge.ms };
          writeJSON('solved', solved);
          if (wrong[String(p.id)]) { delete wrong[String(p.id)]; writeJSON('wrong', wrong); renderWrongCounts(); }
          if (wrongListVisible()) renderWrongList();
          renderBankInfo();
          showSolutionAvailable(p);
        } else {
          var key = String(p.id);
          var rec = wrong[key] || { tries: 0 };
          wrong[key] = { at: Date.now(), tries: (rec.tries || 0) + 1, code: code, verdict: verdictText(judge).text };
          writeJSON('wrong', wrong);
          renderWrongCounts();
          if (wrongListVisible()) renderWrongList();
          renderBankInfo();
        }
      });
    });
  }

  /* 运行样例 / 自测 */
  function runProblem(useOwnInput) {
    var p = state.problem;
    if (!p || state.judging) return;
    var code = el.probCode.value;
    if (!String(code).trim()) {
      el.probOutBody.innerHTML = '<p class="oj-line">先写点代码。</p>';
      el.probVerdict.textContent = '还没写代码';
      el.probVerdict.className = 'oj-result__title oj-verdict is-wait';
      return;
    }
    var stdin = useOwnInput ? el.probStdin.value : ((p.tests && p.tests[0]) ? p.tests[0].in : '');
    el.probRunSample.disabled = true;
    el.probRunSelf.disabled = true;
    el.probVerdict.textContent = '正在跑…';
    el.probVerdict.className = 'oj-result__title oj-verdict is-wait';
    el.probMeta2.textContent = '';
    el.probOutBody.innerHTML = '<p class="oj-line">正在跑…</p>';
    ensureRunner().then(function (ok) {
      if (!ok) {
        el.probRunSample.disabled = false;
        el.probRunSelf.disabled = false;
        el.probVerdict.textContent = '运行环境没起来';
        el.probVerdict.className = 'oj-result__title oj-verdict is-bad';
        el.probOutBody.innerHTML = '<p class="oj-line">运行环境没加载下来：检查一下网络。</p>';
        return;
      }
      return R.run(code, stdin, RUN_TIMEOUT).then(function (res) {
        el.probRunSample.disabled = false;
        el.probRunSelf.disabled = false;
        saveCode(p.id, code);
        var box = el.probOutBody;
        box.innerHTML = '';
        var outText = res.ok ? res.stdout : (res.stdout ? res.stdout + '\n' : '') + (res.stderr || '');
        el.probVerdict.textContent = res.ok ? (useOwnInput ? '跑完了' : '看下面') : (res.timeout ? '超时' : '运行出错');
        el.probVerdict.className = 'oj-result__title oj-verdict ' + (res.ok ? 'is-wait' : 'is-bad');
        el.probMeta2.textContent = '用时 ' + (res.ms / 1000).toFixed(2) + ' 秒';

        if (!useOwnInput && p.tests && p.tests[0]) {
          /* 跑示例：顺手把期望/实际摆出来 */
          var cmp = res.ok ? compareOut(res.stdout, p.tests[0].out) : null;
          var p1 = document.createElement('p');
          p1.className = 'oj-line';
          if (res.ok && cmp && cmp.ok) {
            p1.innerHTML = '<b>和示例答案一致。</b>可以再点「提交判题」把所有测试点都跑一遍。';
          } else if (res.ok) {
            p1.innerHTML = '<b>和示例答案不一样：</b>' + (cmp ? cmp.reason : '');
          } else {
            p1.innerHTML = '<b>程序没有正常结束：</b>' + (res.timeout ? '超时了（可能死循环）' : '见下面的报错');
          }
          box.appendChild(p1);
          if (res.ok) {
            var diff = document.createElement('div');
            diff.className = 'oj-diff';
            function cell2(title, text, bad) {
              var d = document.createElement('div');
              var h = document.createElement('h5');
              h.textContent = title;
              d.appendChild(h);
              var p2 = document.createElement('pre');
              if (bad) p2.className = 'is-bad';
              p2.textContent = text === '' ? '（空的）' : text;
              d.appendChild(p2);
              return d;
            }
            diff.appendChild(cell2('示例答案', p.tests[0].out, false));
            diff.appendChild(cell2('你的输出', res.stdout, true));
            box.appendChild(diff);
          } else {
            var pre = document.createElement('pre');
            pre.className = 'oj-out is-bad';
            pre.textContent = outText;
            box.appendChild(pre);
          }
        } else {
          var pre2 = document.createElement('pre');
          pre2.className = 'oj-out' + (res.ok ? '' : ' is-bad');
          pre2.textContent = outText || '（程序没有输出任何东西）';
          box.appendChild(pre2);
        }
      });
    });
  }

  /* =========================================================
     题库
     ========================================================= */
  var CAT_ORDER = ['输入输出', '运算与类型', '条件分支', '循环', '列表', '字符串', '字典与集合', '函数与递归', '排序与综合', '模拟与实战'];

  function loadBank() {
    if (state.bank) return Promise.resolve(state.bank);
    if (el.bankInfo) el.bankInfo.textContent = '正在读题库…';
    return fetch(BANK_URL, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var list = (data && data.problems) || [];
        if (!list.length) throw new Error('题库是空的');
        state.bank = { problems: list };
        state.byId = {};
        var counts = {};
        list.forEach(function (p) {
          state.byId[String(p.id)] = p;
          counts[p.cat] = (counts[p.cat] || 0) + 1;
        });
        state.cats = CAT_ORDER.filter(function (c) { return counts[c]; }).map(function (c) {
          return { cat: c, count: counts[c] };
        });
        return state.bank;
      });
  }

  function statusOf(id) {
    var k = String(id);
    if (solved[k]) return 'solved';
    if (wrong[k]) return 'wrong';
    return 'todo';
  }
  function solvedCount() { return Object.keys(solved).length; }

  /* 难度标签：每道题都有，列表里、题目页里、错题本里都带着 */
  function makeLevelTag(level) {
    var span = document.createElement('span');
    var isHard = Number(level) === 2;
    span.className = 'oj-tag ' + (isHard ? 'oj-tag--l2' : 'oj-tag--l1');
    span.textContent = isHard ? '进阶' : '入门';
    span.title = isHard ? '难度：进阶（需要多绕一步）' : '难度：入门（基础语法就够）';
    return span;
  }
  function levelText(level) { return Number(level) === 2 ? '进阶' : '入门'; }

  function renderCats() {
    el.cats.innerHTML = '';
    function chip(label, value, count) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'oj-chip' + (state.cat === value ? ' is-active' : '');
      b.textContent = label;
      if (count != null) {
        var s = document.createElement('small');
        s.textContent = String(count);
        b.appendChild(s);
      }
      b.addEventListener('click', function () {
        state.cat = value;
        renderCats();
        renderBankList();
      });
      el.cats.appendChild(b);
    }
    chip('全部', 'all', (state.bank && state.bank.problems.length) || 0);
    state.cats.forEach(function (c) { chip(c.cat, c.cat, c.count); });
  }

  /* 难度筛选：入门 / 进阶 各有多少道，点一下就只看那一档 */
  function renderLevels() {
    if (!el.levels) return;
    var list = (state.bank && state.bank.problems) || [];
    var n1 = 0, n2 = 0;
    list.forEach(function (p) { if (Number(p.level) === 2) n2++; else n1++; });
    el.levels.innerHTML = '';
    function chip(label, value, count, tagCls) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'oj-chip' + (tagCls ? ' ' + tagCls : '') + (state.level === value ? ' is-active' : '');
      b.textContent = label;
      if (count != null) {
        var s = document.createElement('small');
        s.textContent = String(count);
        b.appendChild(s);
      }
      b.addEventListener('click', function () {
        state.level = value;
        renderLevels();
        renderBankList();
      });
      el.levels.appendChild(b);
    }
    chip('全部难度', '0', list.length);
    chip('入门', '1', n1, 'oj-chip--l1');
    chip('进阶', '2', n2, 'oj-chip--l2');
  }

  function filteredProblems() {
    var list = (state.bank && state.bank.problems) || [];
    var q = state.q.trim().toLowerCase();
    return list.filter(function (p) {
      if (state.cat !== 'all' && p.cat !== state.cat) return false;
      if (state.level !== '0' && String(p.level) !== state.level) return false;
      var st = statusOf(p.id);
      if (state.status === 'solved' && st !== 'solved') return false;
      if (state.status === 'todo' && st === 'solved') return false;
      if (state.status === 'wrong' && st !== 'wrong') return false;
      if (q) {
        var hay = (String(p.id) + ' ' + String(p.title) + ' ' + String(p.cat)).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function renderBankInfo() {
    if (!el.bankInfo) return;
    if (!state.bank) return;
    var total = state.bank.problems.length;
    el.bankInfo.textContent = '一共 ' + total + ' 道题 · 已通过 ' + solvedCount() + ' 道 · 错题本里 ' + Object.keys(wrong).length + ' 道';
    el.bankCount.textContent = String(total);
  }

  function renderBankList() {
    var list = filteredProblems();
    el.list.innerHTML = '';
    if (!list.length) {
      var p = document.createElement('p');
      p.className = 'oj-empty';
      p.textContent = state.q ? ('没找到和「' + state.q + '」有关的题') : '这个筛选条件下暂时没有题';
      el.list.appendChild(p);
      return;
    }
    list.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'oj-item';
      var id = document.createElement('span');
      id.className = 'oj-item__id';
      id.textContent = '#' + p.id;
      li.appendChild(id);

      var main = document.createElement('div');
      main.className = 'oj-item__main';
      var t = document.createElement('div');
      t.className = 'oj-item__title';
      t.textContent = p.title;
      main.appendChild(t);
      var sub = document.createElement('div');
      sub.className = 'oj-item__sub';
      var cat = document.createElement('span');
      cat.textContent = p.cat;
      sub.appendChild(cat);
      sub.appendChild(makeLevelTag(p.level));
      var st = statusOf(p.id);
      var flag = document.createElement('span');
      flag.className = 'oj-flag ' + (st === 'solved' ? 'oj-flag--ok' : (st === 'wrong' ? 'oj-flag--bad' : 'oj-flag--new'));
      flag.textContent = st === 'solved' ? '已通过' : (st === 'wrong' ? '做错过' : '没做过');
      sub.appendChild(flag);
      main.appendChild(sub);
      li.appendChild(main);

      var actions = document.createElement('div');
      actions.className = 'oj-item__actions';
      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'oj-btn oj-btn--ghost oj-item__open';
      open.textContent = '去做';
      open.addEventListener('click', function () { openProblem(p.id); });
      actions.appendChild(open);
      li.appendChild(actions);

      li.addEventListener('click', function (e) { if (e.target === li || e.target === main || e.target === t) openProblem(p.id); });
      el.list.appendChild(li);
    });
  }

  /* =========================================================
     单题视图
     ========================================================= */
  function defaultStarter(p) {
    return '# ' + p.title + '\n# 从 input() 读数据，用 print() 输出结果\n\n';
  }
  function saveCode(id, code) {
    try { localStorage.setItem(PREFIX + 'code-' + id, code); } catch (e) { /* 忽略 */ }
  }
  function loadCode(id) {
    try { return localStorage.getItem(PREFIX + 'code-' + id); } catch (e) { return null; }
  }

  function openProblem(id) {
    var p = state.byId[String(id)];
    if (!p) return;
    state.problem = p;
    if (el.bankBar) el.bankBar.hidden = true;
    if (el.filters) for (var i = 0; i < el.filters.length; i++) el.filters[i].hidden = true;
    if (el.bankInfo) el.bankInfo.hidden = true;
    el.list.hidden = true;
    el.problem.hidden = false;

    el.probId.textContent = '#' + p.id;
    el.probTitle.textContent = p.title;
    var st = statusOf(p.id);
    el.probMeta.innerHTML = '';
    var mcat = document.createElement('span');
    mcat.textContent = p.cat + ' · ';
    el.probMeta.appendChild(mcat);
    el.probMeta.appendChild(makeLevelTag(p.level));
    var mst = document.createElement('span');
    mst.textContent = ' · ' + (st === 'solved' ? '已通过' : (st === 'wrong' ? '做错过' : '没做过'));
    el.probMeta.appendChild(mst);
    el.probStatement.textContent = p.statement;
    el.probIn.textContent = p.inputFormat || '—';
    el.probOut.textContent = p.outputFormat || '—';
    var sample = (p.tests && p.tests[0]) || { in: '', out: '' };
    el.probSampleIn.textContent = sample.in || '（这道题不用输入）';
    el.probSampleOut.textContent = sample.out || '（没有输出）';
    el.probHint.hidden = !p.hint;
    el.probHint.textContent = p.hint || '';
    el.probStdin.value = sample.in || '';
    el.probStdinWrap.hidden = false;

    el.probCode.value = loadCode(p.id) || defaultStarter(p);
    if (probEditor) probEditor.sync();

    el.probVerdict.textContent = '还没交';
    el.probVerdict.className = 'oj-result__title oj-verdict is-wait';
    el.probMeta2.textContent = '';
    el.probOutBody.innerHTML = '<p class="oj-line">点「运行样例」先看看示例能不能对上，或者直接「提交判题」跑全部测试点。</p>';
    showSolutionAvailable(p);
    try { el.problem.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* 忽略 */ }
  }

  function closeProblem() {
    state.problem = null;
    if (el.problem) el.problem.hidden = true;
    if (el.bankBar) el.bankBar.hidden = false;
    if (el.filters) for (var i = 0; i < el.filters.length; i++) el.filters[i].hidden = false;
    if (el.bankInfo) el.bankInfo.hidden = false;
    if (el.list) el.list.hidden = false;
    renderBankList();
    renderBankInfo();
  }

  function showSolutionAvailable(p) {
    var has = !!(p && p.solution);
    el.probSolutionBox.hidden = !has;
    el.probSolution.hidden = true;
    el.probSolution.textContent = '';
    var done = statusOf(p.id) === 'solved';
    el.probSolutionBtn.disabled = !done;
    el.probSolutionBtn.textContent = done ? '看参考解法' : '通过之后可以看参考解法';
    if (done && has) el.probSolution.textContent = p.solution;
  }

  /* =========================================================
     自分谬误样本
     ========================================================= */
  function renderWrongCounts() {
    if (el.wrongCount) el.wrongCount.textContent = String(Object.keys(wrong).length);
  }
  function wrongListVisible() { return state.pane === 'wrong'; }
  function renderWrongList() {
    if (!el.wrongList) return;
    var ids = Object.keys(wrong).sort(function (a, b) { return (wrong[b].at || 0) - (wrong[a].at || 0); });
    el.wrongList.innerHTML = '';
    el.wrongEmpty.hidden = ids.length > 0;
    if (!ids.length) return;
    ids.forEach(function (id) {
      var p = state.byId[id] || { id: id, title: '（题库里已经没有这道题了）', cat: '', level: 1 };
      var rec = wrong[id] || {};
      var li = document.createElement('li');
      li.className = 'oj-item oj-wrong';
      var head = document.createElement('div');
      head.className = 'oj-wrong__head';

      var idEl = document.createElement('span');
      idEl.className = 'oj-item__id';
      idEl.textContent = '#' + id;
      head.appendChild(idEl);

      var t = document.createElement('span');
      t.className = 'oj-wrong__title';
      t.textContent = p.title;
      head.appendChild(t);
      head.appendChild(makeLevelTag(p.level));

      var meta = document.createElement('span');
      meta.className = 'oj-wrong__meta';
      meta.textContent = (p.cat ? p.cat + ' · ' : '') + '错过 ' + (rec.tries || 1) + ' 次 · ' + whenText(rec.at);
      head.appendChild(meta);

      var actions = document.createElement('span');
      actions.className = 'oj-wrong__actions';
      var again = document.createElement('button');
      again.type = 'button';
      again.className = 'oj-btn oj-btn--ghost oj-item__open';
      again.textContent = '再做一次';
      again.addEventListener('click', function () { goPane('bank'); openProblem(id); });
      actions.appendChild(again);
      var drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'oj-btn oj-btn--ghost oj-item__open';
      drop.textContent = '移出';
      drop.addEventListener('click', function () {
        delete wrong[id];
        writeJSON('wrong', wrong);
        renderWrongCounts();
        renderWrongList();
        renderBankInfo();
        renderBankList();
      });
      actions.appendChild(drop);
      head.appendChild(actions);
      li.appendChild(head);

      var det = document.createElement('details');
      var sum = document.createElement('summary');
      sum.textContent = '看看当时写的代码（' + (rec.verdict || '没通过') + '）';
      det.appendChild(sum);
      var pre = document.createElement('pre');
      pre.textContent = rec.code || '（没存下来）';
      det.appendChild(pre);
      li.appendChild(det);

      el.wrongList.appendChild(li);
    });
  }
  function whenText(ts) {
    if (!ts) return '刚才';
    var d = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* =========================================================
     标签页
     ========================================================= */
  function goPane(name) {
    state.pane = name;
    ['run', 'bank', 'wrong'].forEach(function (k) {
      var pane = $('ojPane' + k.charAt(0).toUpperCase() + k.slice(1));
      if (pane) pane.hidden = k !== name;
      var tab = $('ojTab' + k.charAt(0).toUpperCase() + k.slice(1));
      if (tab) {
        tab.classList.toggle('is-active', k === name);
        tab.setAttribute('aria-selected', k === name ? 'true' : 'false');
      }
    });
    if (name === 'bank') {
      loadBank().then(function () {
        renderCats();
        renderLevels();
        renderBankInfo();
        renderBankList();
      }, function (err) {
        el.bankInfo.textContent = '题库没读出来（' + (err.message || err) + '）：检查网络后刷新一下。';
      });
    }
    if (name === 'wrong') {
      loadBank().then(function () { renderWrongList(); }, function () { renderWrongList(); });
    }
  }

  /* =========================================================
     起
     ========================================================= */
  function boot() {
    if (!isDesktop()) {
      $('ojBlock').hidden = false;
      $('ojShell').hidden = true;
      return;
    }
    $('ojBlock').hidden = true;
    $('ojShell').hidden = false;

    el = {
      shell: $('ojShell'),
      state: $('ojState'),
      run: $('ojRun'),
      runClear: $('ojRunClear'),
      code: $('ojCode'),
      stdin: $('ojStdin'),
      runOut: $('ojRunOut'),
      runMeta: $('ojRunMeta'),
      bankCount: $('ojBankCount'),
      wrongCount: $('ojWrongCount'),
      search: $('ojSearch'),
      status: $('ojStatus'),
      cats: $('ojCats'),
      levels: $('ojLevels'),
      filters: document.querySelectorAll('.oj-filter'),
      bankInfo: $('ojBankInfo'),
      list: $('ojList'),
      bankBar: document.querySelector('.oj-bankbar'),
      problem: $('ojProblem'),
      probId: $('ojProbId'),
      probTitle: $('ojProbTitle'),
      probMeta: $('ojProbMeta'),
      probStatement: $('ojProbStatement'),
      probIn: $('ojProbIn'),
      probOut: $('ojProbOut'),
      probSampleIn: $('ojProbSampleIn'),
      probSampleOut: $('ojProbSampleOut'),
      probHint: $('ojProbHint'),
      probCode: $('ojProbCode'),
      probStdin: $('ojProbStdin'),
      probStdinWrap: document.querySelector('.oj-field[for="ojProbStdin"]'),
      probSubmit: $('ojProbSubmit'),
      probRunSample: $('ojProbRunSample'),
      probRunSelf: $('ojProbRunSelf'),
      probReset: $('ojProbReset'),
      probVerdict: $('ojProbVerdict'),
      probMeta2: $('ojProbMeta2'),
      probResult: $('ojProbResult'),
      probOutBody: $('ojProbOutBody'),
      probSolutionBox: $('ojProbSolutionBox'),
      probSolutionBtn: $('ojProbSolutionBtn'),
      probSolution: $('ojProbSolution'),
      wrongList: $('ojWrongList'),
      wrongEmpty: $('ojWrongEmpty'),
      wrongClear: $('ojWrongClear')
    };

    playEditor = makeEditor(el.code, $('ojGutter'));
    probEditor = makeEditor(el.probCode, $('ojProbGutter'));

    /* 标签页 */
    $('ojTabRun').addEventListener('click', function () { goPane('run'); });
    $('ojTabBank').addEventListener('click', function () { goPane('bank'); });
    $('ojTabWrong').addEventListener('click', function () { goPane('wrong'); });

    /* 写代码 */
    var playSaved = null;
    try { playSaved = localStorage.getItem(PREFIX + 'play'); } catch (e) { playSaved = null; }
    el.code.value = playSaved || '# 随便写点什么试试：\n# a = int(input())\n# print(a * 2)\n\n';
    playEditor.sync();
    function savePlay() { try { localStorage.setItem(PREFIX + 'play', el.code.value); } catch (e) { /* 忽略 */ } }
    el.code.addEventListener('input', savePlay);
    el.run.addEventListener('click', runPlayground);
    el.runClear.addEventListener('click', function () {
      el.code.value = '';
      playEditor.sync();
      savePlay();
      showRunOut('清空了，重新写吧。', false, true);
      if (el.runMeta) el.runMeta.textContent = '';
    });
    el.code.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); runPlayground(); }
    });

    /* 题库筛选 */
    el.search.addEventListener('input', function () { state.q = el.search.value; renderBankList(); });
    el.status.addEventListener('change', function () { state.status = el.status.value; renderBankList(); });

    /* 单题 */
    $('ojProbBack').addEventListener('click', closeProblem);
    el.probSubmit.addEventListener('click', submitProblem);
    el.probRunSample.addEventListener('click', function () { runProblem(false); });
    el.probRunSelf.addEventListener('click', function () { runProblem(true); });
    el.probReset.addEventListener('click', function () {
      var p = state.problem;
      if (!p) return;
      el.probCode.value = defaultStarter(p);
      probEditor.sync();
      try { localStorage.removeItem(PREFIX + 'code-' + p.id); } catch (e) { /* 忽略 */ }
      el.probVerdict.textContent = '还没交';
      el.probVerdict.className = 'oj-result__title oj-verdict is-wait';
      el.probMeta2.textContent = '';
      el.probOutBody.innerHTML = '<p class="oj-line">已经还原成初始代码。</p>';
    });
    el.probCode.addEventListener('input', function () {
      if (state.problem) saveCode(state.problem.id, el.probCode.value);
    });
    el.probCode.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); submitProblem(); }
    });
    el.probSolutionBtn.addEventListener('click', function () {
      var p = state.problem;
      if (!p || !p.solution) return;
      el.probSolution.hidden = false;
      el.probSolution.textContent = p.solution;
    });

    /* 错题本 */
    el.wrongClear.addEventListener('click', function () {
      var n = Object.keys(wrong).length;
      if (!n) return;
      if (!global.confirm('把「自分谬误样本」里的 ' + n + ' 道题全部清掉？')) return;
      wrong = {};
      writeJSON('wrong', wrong);
      renderWrongCounts();
      renderWrongList();
      renderBankInfo();
    });

    /* 起手就把题库读进来（读不到也不挡写代码那块） */
    loadBank().then(function () {
      renderCats();
      renderLevels();
      renderBankInfo();
      renderWrongCounts();
      renderWrongList();
    }, function (err) {
      if (el.bankInfo) el.bankInfo.textContent = '题库没读出来（' + (err.message || err) + '）：检查网络后刷新一下。';
    });
    renderWrongCounts();
    renderWrongList();

    /* 解释器懒加载：第一次点运行/提交时再取；闲的时候也可以先偷偷热起来 */
    setState('运行环境：还没加载（点「运行」时加载）');
    global.setTimeout(function () { if (!runnerReady) ensureRunner(); }, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
