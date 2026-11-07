/* =========================================================
   「0还是1?」—— 编程语言题库：选语言、写代码、当场运行、按测试点评判
   ---------------------------------------------------------
   · 语言是一门一门接进来的：LANGUAGES 里 ready 为 true 的才是能点的，
     页面上的「现在开放 xx」也照这个列表生成，不写死
   · Python 不上传：解释器（Skulpt）和判题都在浏览器里跑；
     C 要编译，代码发到协会的判题服务器上编译运行，判完就删
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
  var RUN_TIMEOUT = 8000;      /* 自由运行的执行预算 */
  var CASE_TIMEOUT = 6000;     /* 判题时每个测试点的预算 */
  var JUDGE_TOTAL_BUDGET = 28000;  /* 判一整题的总预算，超了就停下 */

  var $ = function (id) { return document.getElementById(id); };
  var el = {};

  /* 目前支持的语言：Python 和 C 已开放，C++/Java 先把位置留着。
     note 只是没开放那几门的占位文字，开放的那几门按实际题库数生成。 */
  var LANGUAGES = [
    { key: 'python', name: 'Python', mono: 'Py', ready: true },
    { key: 'c', name: 'C', mono: 'C', ready: true },
    { key: 'cpp', name: 'C++', mono: 'C++', ready: false, note: '还没开放' },
    { key: 'java', name: 'Java', mono: 'Java', ready: false, note: '还没开放' }
  ];
  /* 已开放的语言名，用中文顿号连起来：「Python、C」 */
  function readyNames() {
    var out = [];
    for (var i = 0; i < LANGUAGES.length; i++) if (LANGUAGES[i].ready) out.push(LANGUAGES[i].name);
    return out.join('、');
  }
  /* 每门语言多少道题：读过一次就记住，语言选择界面直接用，
     不用为了显示个数字把两个题库都先下载下来 */
  function countOf(lang) {
    try {
      var v = localStorage.getItem('jhjx-oj-count-' + lang);
      return v && Number(v) > 0 ? Number(v) : 0;
    } catch (e) { return 0; }
  }
  function rememberCount(lang, n) {
    try { localStorage.setItem('jhjx-oj-count-' + lang, String(n)); } catch (e) { /* 忽略 */ }
  }
  function langByKey(k) {
    for (var i = 0; i < LANGUAGES.length; i++) if (LANGUAGES[i].key === k) return LANGUAGES[i];
    return LANGUAGES[0];
  }
  /* 每门语言的题库文件 */
  function bankUrlOf(lang) { return 'assets/data/oj-bank-' + lang + '.json'; }
  /* 每门语言怎么跑：Python 在浏览器里（Skulpt），C 发到服务器编译 */
  function runnerKindOf(lang) { return lang === 'c' ? 'server' : 'browser'; }

  /* 四档难度：按「要不要动脑」分，不是按代码长短/耗时
     · 入门：套一个语法点就能写
     · 基础：把两三个知识点串起来，照着写就行
     · 进阶：得自己设计做法（多步逻辑、多条规则、边界）
     · 挑战：得想到一个不显然的办法，光会语法不知道从哪下手 */
  var LEVELS = {
    1: { name: '入门', stars: '★☆☆☆', tip: '套一个语法点就能写' },
    2: { name: '基础', stars: '★★☆☆', tip: '把两三个知识点串起来，照着写就行' },
    3: { name: '进阶', stars: '★★★☆', tip: '要自己设计做法：多步逻辑、几条规则、边界得理清' },
    4: { name: '挑战', stars: '★★★★', tip: '要想到一个不显然的办法（算法或技巧），光会语法不知道从哪下手' }
  };
  function levelMeta(n) {
    return LEVELS[Number(n)] || { name: '难度未知', stars: '☆☆☆☆', tip: '' };
  }

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
  /* 本机存储按「账号 + 语言」分开：Python 的错题本和 C 的错题本互不干扰 */
  var PREFIX = 'jhjx-oj-' + uid + '-';
  function setLangPrefix(lang) {
    PREFIX = 'jhjx-oj-' + uid + '-' + (lang || 'x') + '-';
  }
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
  /* 以下三份状态在「换语言」时按新语言的存储键重新读 */
  var solved = readJSON('solved', {});
  var wrong = readJSON('wrong', {});
  function reloadProgress() {
    solved = readJSON('solved', {});
    wrong = readJSON('wrong', {});
  }

  /* ---------------- 状态 ---------------- */
  var state = {
    pane: 'run',
    lang: '',            /* 选中的语言；空着就先显示语言选择页 */
    bank: null,
    byId: {},
    cats: [],
    cat: 'all',
    q: '',
    status: 'all',
    level: '0',          /* 难度筛选：'0' 全部 / '1'~'4' */
    sort: 'easy',        /* 列表顺序：由浅入深（默认）/ 按编号 */
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
  /* 这门语言是在浏览器里跑（Python）还是发到服务器编译（C） */
  function isServerLang() { return runnerKindOf(state.lang) === 'server'; }

  function ensureRunner() {
    if (isServerLang()) {
      /* C 由服务器编译：不用加载什么，顺手把它叫醒 */
      setState('运行环境：C 代码会发到协会的判题服务器上编译运行');
      wakeC();
      return Promise.resolve(true);
    }
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

  /* 发到判题服务器。这个函数闲下来会被平台回收，刚被叫醒的那一两秒里网关
     会直接回一个「连不上」，所以要自动重试：一共四次，铺开大约 7 秒，
     足够熬过冷启动。 */
  function postC(payload) {
    var wait = [0, 900, 2200, 4000];
    var tries = 0;
    function attempt() {
      return window.JHJX_API.ojRunC(payload).then(function (res) {
        if (res && res.status === 0 && tries < wait.length - 1) {
          tries++;
          return new Promise(function (go) { setTimeout(go, wait[tries]); }).then(attempt);
        }
        return res;
      });
    }
    return attempt();
  }

  /* 进 C 之前先把它叫醒（不等结果，纯预热） */
  function wakeC() {
    if (!window.JHJX_API || !window.JHJX_API.wake) return;
    try { window.JHJX_API.wake(); } catch (e) { /* 忽略 */ }
    setTimeout(function () { try { window.JHJX_API.wake(); } catch (e) { /* 忽略 */ } }, 1500);
  }

  /* 统一的「跑一次」：Python 走浏览器里的解释器，C 走服务器 */
  function runOnce(code, stdin, timeoutMs) {
    if (!isServerLang()) return R.run(code, stdin, timeoutMs);
    return postC({
      code: String(code == null ? '' : code),
      stdin: String(stdin == null ? '' : stdin)
    }).then(function (res) {
      var d = res.data || {};
      if (res.status !== 200) {
        return { ok: false, stdout: '', stderr: String(d.error || '判题服务没响应，过一会儿再试'), ms: 0, setupFailed: true };
      }
      return {
        ok: !!d.ok,
        stdout: String(d.stdout || ''),
        stderr: String(d.stderr || ''),
        ms: Number(d.ms) || 0,
        timeout: d.phase === 'timeout'
      };
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
      return runOnce(code, el.stdin.value, RUN_TIMEOUT).then(function (res) {
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
  /* C：服务器编译一次、按测试点跑完，结果一次拿回来 */
  function judgeOnServer(problem, code, onlyFirst) {
    var all = problem.tests || [];
    var tests = onlyFirst ? all.slice(0, 1) : all;
    return postC({
      code: String(code == null ? '' : code),
      tests: tests.map(function (t) { return t.in; })
    }).then(function (res) {
      var d = res.data || {};
      if (res.status !== 200) {
        return { error: String(d.error || '判题服务没响应，过一会儿再试') };
      }
      if (d.phase === 'compile' || d.phase === 'compile-timeout' || d.phase === 'toolchain') {
        return { compileError: String(d.stderr || '编译失败'), phase: d.phase };
      }
      var list = (d.cases || []).map(function (c, i) {
        var t = tests[i] || {};
        var cmp = c.ok ? compareOut(c.stdout, t.out) : null;
        return {
          index: i,
          isSample: i === 0,
          input: String(t.in || ''),
          expected: String(t.out || ''),
          stdout: String(c.stdout || ''),
          stderr: String(c.stderr || ''),
          ms: Number(c.ms) || 0,
          timeout: c.phase === 'timeout',
          ok: !!(c.ok && cmp && cmp.ok),
          reason: c.ok ? ((cmp && cmp.reason) || '') : (c.phase === 'timeout' ? '运行超时' : '运行出错')
        };
      });
      var passed = 0;
      for (var i = 0; i < list.length; i++) if (list[i].ok) passed++;
      return {
        caseResults: list,
        passed: passed,
        total: tests.length,
        allPass: passed === tests.length && tests.length > 0,
        stopped: false,
        ms: Number(d.ms) || 0
      };
    });
  }

  function runCases(problem, code, onlyFirst) {
    if (isServerLang()) return judgeOnServer(problem, code, onlyFirst);
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
      return runOnce(code, tests[i].in, CASE_TIMEOUT).then(function (res) {
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
        /* C 是服务器编译的：编译不过就先说清是哪一行什么错，别当成「答案不对」 */
        if (judge && (judge.compileError || judge.error)) {
          el.probVerdict.textContent = judge.compileError ? '编译不过' : '判题服务没响应';
          el.probVerdict.className = 'oj-result__title oj-verdict is-bad';
          el.probMeta2.textContent = '';
          el.probOutBody.innerHTML = '';
          var pMsg = document.createElement('p');
          pMsg.className = 'oj-line';
          pMsg.textContent = judge.compileError ? '编译器这样说（改完再交一次）：' : '这一趟没跑成：';
          el.probOutBody.appendChild(pMsg);
          var pre = document.createElement('pre');
          pre.className = 'oj-out is-bad';
          pre.style.margin = '6px 0 0';
          pre.textContent = judge.compileError || judge.error;
          el.probOutBody.appendChild(pre);
          /* 只是没连上（判题服务器冷启动）的话，告诉用户再点一次就行 */
          if (!judge.compileError && /连不上|没响应|网络/.test(String(judge.error))) {
            var tip = document.createElement('p');
            tip.className = 'oj-line';
            tip.textContent = '判题服务器可能刚被叫醒（它闲下来会睡过去）。等两三秒再点一次「提交判题」就好。';
            el.probOutBody.appendChild(tip);
          }
          saveCode(p.id, code);
          return;
        }
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
          /* 过了就顺手给个「下一题」，顺着难度往下走 */
          if (el.probNext) el.probNext.hidden = false;
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
      return runOnce(code, stdin, RUN_TIMEOUT).then(function (res) {
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

  /* 各语言的分类顺序（C 没有「列表/字典」这些，换成了数组/指针/结构体）
     「算法入门」是重构题库时新加的一档：二分答案/双指针/贪心/DP/栈队列这些 */
  var CAT_ORDER_BY_LANG = {
    python: ['输入输出', '运算与类型', '条件分支', '循环', '列表', '字符串', '字典与集合', '函数与递归', '排序与综合', '模拟与实战', '算法入门'],
    c: ['输入输出', '运算与类型', '条件分支', '循环', '数组与矩阵', '字符串', '函数与递归', '指针与结构体', '排序与查找', '模拟与综合', '算法入门']
  };
  function catOrder() { return CAT_ORDER_BY_LANG[state.lang] || CAT_ORDER_BY_LANG.python; }

  function loadBank() {
    if (state.bank) return Promise.resolve(state.bank);
    if (el.bankInfo) el.bankInfo.textContent = '正在读题库…';
    return fetch(bankUrlOf(state.lang), { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var list = (data && data.problems) || [];
        if (!list.length) throw new Error('题库是空的');
        state.bank = { problems: list };
        rememberCount(state.lang, list.length);
        /* 记住题数之后把语言选择页重画一遍，下次回去就能看到「已开放 · 400 道题」 */
        if (el.langGrid && el.langPick && !el.langPick.hidden) renderLangPick();
        state.byId = {};
        var counts = {};
        list.forEach(function (p) {
          state.byId[String(p.id)] = p;
          counts[p.cat] = (counts[p.cat] || 0) + 1;
        });
        state.cats = catOrder().filter(function (c) { return counts[c]; }).map(function (c) {
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
  function makeLevelTag(level, withStars) {
    var m = levelMeta(level);
    var span = document.createElement('span');
    span.className = 'oj-tag oj-tag--l' + (LEVELS[Number(level)] ? Number(level) : 0);
    span.textContent = withStars ? (m.stars + ' ' + m.name) : m.name;
    span.title = '难度：' + m.name + (m.tip ? '（' + m.tip + '）' : '');
    return span;
  }
  function levelText(level) { return levelMeta(level).name; }

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

  /* 难度筛选：入门 / 基础 / 进阶 / 挑战 各有多少道，点一下就只看那一档 */
  function renderLevels() {
    if (!el.levels) return;
    var list = (state.bank && state.bank.problems) || [];
    var counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    list.forEach(function (p) { if (counts[Number(p.level)] != null) counts[Number(p.level)]++; });
    el.levels.innerHTML = '';
    function chip(label, value, count, tagCls, tip) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'oj-chip' + (tagCls ? ' ' + tagCls : '') + (state.level === value ? ' is-active' : '');
      b.textContent = label;
      if (tip) b.title = tip;
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
    [1, 2, 3, 4].forEach(function (lv) {
      var m = levelMeta(lv);
      chip(m.name, String(lv), counts[lv], 'oj-chip--l' + lv, m.stars + ' · ' + m.tip);
    });
  }

  function filteredProblems() {
    var list = (state.bank && state.bank.problems) || [];
    var q = state.q.trim().toLowerCase();
    var out = list.filter(function (p) {
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
    /* 默认「由浅入深」：先按难度、再按编号，初学者从最前面的做起 */
    if (state.sort === 'easy') {
      out.sort(function (a, b) {
        var la = Number(a.level) || 9;
        var lb = Number(b.level) || 9;
        if (la !== lb) return la - lb;
        return a.id - b.id;
      });
    } else {
      out.sort(function (a, b) { return a.id - b.id; });
    }
    return out;
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
    if (isServerLang()) {
      /* C 的起手骨架：读入 + 输出，直接能编译 */
      return '#include <stdio.h>\n\nint main(void) {\n    /* ' + p.title + ' */\n\n    return 0;\n}\n';
    }
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
    el.probMeta.appendChild(makeLevelTag(p.level, true));   /* 题目页带星级 */
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
    if (el.probNext) el.probNext.hidden = true;   /* 通过之后才出现 */
    showSolutionAvailable(p);
    try { el.problem.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* 忽略 */ }
  }

  /* 按当前筛选顺序找下一题：做完一道顺着往下走。
     要是当前筛选只剩这一道（比如按编号搜出来的一道），就退回整库的顺序，
     别让「下一题」点了跟没点一样 */
  function openNextProblem() {
    var list = filteredProblems();
    if (list.length < 2) {
      list = ((state.bank && state.bank.problems) || []).slice();
      if (state.sort === 'easy') {
        list.sort(function (a, b) {
          var la = Number(a.level) || 9;
          var lb = Number(b.level) || 9;
          return la !== lb ? la - lb : a.id - b.id;
        });
      } else {
        list.sort(function (a, b) { return a.id - b.id; });
      }
    }
    if (!list.length) return;
    var at = -1;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(state.problem && state.problem.id)) at = i;
    var next = list[(at + 1) % list.length];
    openProblem(next.id);
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
     语言选择页
     ========================================================= */
  function renderLangPick() {
    if (!el.langGrid) return;
    var last = '';
    try { last = localStorage.getItem(PREFIX + 'lang') || ''; } catch (e) { last = ''; }
    /* 上面那句「现在开放 …」跟着实际开放情况走，别写死 */
    if (el.langsLead) {
      el.langsLead.textContent = '题库按语言分开练。现在开放 ' + readyNames() + '，其余几门正在接入，开放后这里就能直接点。';
    }
    if (el.langsFoot) {
      /* 这句也得跟着语言走：Python 在浏览器里跑，C 要发去服务器编译 */
      var local = [];
      var remote = [];
      LANGUAGES.forEach(function (l) {
        if (!l.ready) return;
        if (runnerKindOf(l.key) === 'server') remote.push(l.name);
        else local.push(l.name);
      });
      var bits = [];
      if (local.length) bits.push(local.join('、') + ' 不用装环境：解释器就在网页里跑，代码不上传');
      if (remote.length) bits.push(remote.join('、') + ' 要编译：代码发到协会的判题服务器上跑，判完就删');
      el.langsFoot.textContent = bits.join('；') + '。';
    }
    el.langGrid.innerHTML = '';
    LANGUAGES.forEach(function (lang) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'oj-lang' + (lang.ready ? ' is-ready' : ' is-locked') + (last === lang.key ? ' is-last' : '');
      b.setAttribute('data-lang', lang.key);

      var badge = document.createElement('span');
      badge.className = 'oj-lang__badge';
      badge.textContent = lang.mono;
      b.appendChild(badge);

      var body = document.createElement('span');
      body.className = 'oj-lang__body';
      var name = document.createElement('strong');
      name.className = 'oj-lang__name';
      name.textContent = lang.name;
      body.appendChild(name);
      var note = document.createElement('span');
      note.className = 'oj-lang__note';
      note.textContent = lang.ready
        ? ('已开放' + (countOf(lang.key) ? ' · ' + countOf(lang.key) + ' 道题' : ' · 点进去看题'))
        : (lang.note || '还没开放');
      body.appendChild(note);
      b.appendChild(body);

      var arrow = document.createElement('span');
      arrow.className = 'oj-lang__arrow';
      arrow.textContent = lang.ready ? '→' : '·';
      b.appendChild(arrow);

      b.addEventListener('click', function () {
        if (!lang.ready) {
          if (el.langMsg) {
            el.langMsg.hidden = false;
            el.langMsg.textContent = '「' + lang.name + '」还没开放。现在能练的是 ' + readyNames() + '，开放之后这里就能直接点。';
          }
          return;
        }
        chooseLang(lang.key);
      });
      el.langGrid.appendChild(b);
    });
  }

  /* 选好语言 → 进主界面 */
  function chooseLang(key) {
    var lang = langByKey(key);
    if (!lang.ready) return;
    var before = state.lang;
    state.lang = lang.key;
    setLangPrefix(lang.key);
    try { localStorage.setItem('jhjx-oj-lastlang', lang.key); } catch (e) { /* 忽略 */ }
    if (el.langPick) el.langPick.hidden = true;
    if (el.shell) el.shell.hidden = false;
    if (el.langNow) el.langNow.textContent = lang.name;
    if (el.langTag) el.langTag.textContent = lang.name;
    /* C 走服务器：一进来就先把它叫醒，免得用户第一次提交撞上冷启动 */
    if (runnerKindOf(lang.key) === 'server') wakeC();

    if (before !== lang.key) {
      /* 换语言：题库、进度、错题本都得换成这门语言的 */
      state.bank = null;
      state.byId = {};
      state.cats = [];
      state.problem = null;
      reloadProgress();
      if (el.bankInfo) el.bankInfo.hidden = false;
      if (el.filters) for (var i = 0; i < el.filters.length; i++) el.filters[i].hidden = false;
      if (el.list) el.list.hidden = false;
      if (el.problem) el.problem.hidden = true;
      if (el.bankBar) el.bankBar.hidden = false;
      if (el.search) el.search.value = '';
      state.q = '';
      state.cat = 'all';
      state.level = '0';
      if (el.cats) el.cats.innerHTML = '';
      if (el.levels) el.levels.innerHTML = '';
      if (el.list) el.list.innerHTML = '';
      renderWrongCounts();
      renderWrongList();
    }
    /* 这一门怎么跑，页面上的说明要说清 */
    if (el.note) {
      el.note.textContent = isServerLang()
        ? 'C 要编译：代码会发到协会的判题服务器上编译运行，判完就删、不留存；结果只回给你。'
        : '不用装任何环境：解释器就在这个网页里跑，代码只在你自己的浏览器里，不上传。';
    }
    /* 编辑器里的示例代码按语言换一套 */
    var playSaved = null;
    try { playSaved = localStorage.getItem(PREFIX + 'play'); } catch (e) { playSaved = null; }
    if (el.code) {
      el.code.value = playSaved || (isServerLang()
        ? '#include <stdio.h>\n\nint main(void) {\n    int a;\n    scanf("%d", &a);\n    printf("%d\\n", a * 2);\n    return 0;\n}\n'
        : '# 随便写点什么试试：\n# a = int(input())\n# print(a * 2)\n\n');
      if (playEditor) playEditor.sync();
    }
    goPane('run');
    ensureRunner();   /* 选了语言就把环境热起来（C 只是改一下提示） */
  }

  /* 回语言选择页（进度都还在，只是换个语言） */
  function backToLangs() {
    if (el.shell) el.shell.hidden = true;
    if (el.langPick) el.langPick.hidden = false;
    if (el.langMsg) el.langMsg.hidden = true;
    renderLangPick();
  }

  /* =========================================================
     起
     ========================================================= */
  function boot() {
    if (!isDesktop()) {
      $('ojBlock').hidden = false;
      $('ojLangPick').hidden = true;
      $('ojShell').hidden = true;
      return;
    }
    $('ojBlock').hidden = true;

    el = {
      shell: $('ojShell'),
      langPick: $('ojLangPick'),
      langGrid: $('ojLangGrid'),
      langMsg: $('ojLangMsg'),
      langsLead: $('ojLangsLead'),
      langsFoot: $('ojLangsFoot'),
      langNow: $('ojLangNow'),
      langTag: $('ojLangTag'),
      note: $('ojNote'),
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
      sort: $('ojSort'),
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
      probNext: $('ojProbNext'),
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
    $('ojTabLang').addEventListener('click', backToLangs);

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
    if (el.sort) el.sort.addEventListener('change', function () { state.sort = el.sort.value; renderBankList(); });

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
    if (el.probNext) el.probNext.addEventListener('click', openNextProblem);

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

    renderWrongCounts();
    renderWrongList();

    /* 先停在语言选择页：选好语言才进主界面（题库、进度、错题本都按语言分开） */
    setState('运行环境：选好语言之后再说');
    renderLangPick();
    $('ojLangPick').hidden = false;
    $('ojShell').hidden = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
