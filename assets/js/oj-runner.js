/* =========================================================
   「0还是1?」的 Python 运行器
   ---------------------------------------------------------
   用 Skulpt（纯 JS 的 Python 解释器，站点自己托管在 assets/js/lib/）：
   · 不用下载几十 MB 的 WASM，第一次点「运行」才去取那 ~900KB，之后吃缓存
   · 在手机 App 的 WebView 里也能跑（没有 WASM 的兼容问题）
   · 防止死循环靠 Skulpt 自己的 execLimit（执行步数/时间预算），
     超了会抛出来，我们把这次运行判成「超时」，页面不会卡死

   和 CPython 的差别要注意（判题那边用「数字容差」兜住了）：
   · 浮点数转字符串时最后一位可能不同 → 题目要求格式化输出，比较时数字允许极小误差
   · round() 的舍入策略偶有不同 → 题库里不拿 round() 的结果当答案
   ========================================================= */
(function (global) {
  'use strict';

  /* 解释器文件按「本脚本自己的地址」推：这样不管页面在根目录还是子目录
     （测试页放在 .preview/ 里就是这样）都能找到 */
  var selfSrc = '';
  try { selfSrc = (document.currentScript && document.currentScript.src) || ''; } catch (e) { selfSrc = ''; }
  var LIB = selfSrc ? selfSrc.replace(/oj-runner\.js(\?[^]*)?$/, '') + 'lib/' : 'assets/js/lib/';
  var LIB_VER = '1';            /* 换解释器版本时改这个，浏览器才会重新取 */
  var loaded = null;
  var LIB_TIMEOUT = 45000;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('运行环境加载超时（' + src + '）'));
      }, LIB_TIMEOUT);
      s.onload = function () { if (done) return; done = true; clearTimeout(timer); resolve(); };
      s.onerror = function () { if (done) return; done = true; clearTimeout(timer); reject(new Error('运行环境加载失败：' + src)); };
      document.head.appendChild(s);
    });
  }

  function ensure() {
    if (loaded) return loaded;
    loaded = loadScript(LIB + 'skulpt.min.js?v=' + LIB_VER)
      .then(function () { return loadScript(LIB + 'skulpt-stdlib.js?v=' + LIB_VER); })
      .then(function () {
        var Sk = global.Sk;
        if (!Sk) throw new Error('Python 运行环境没起来');
        return Sk;
      })
      .catch(function (err) {
        loaded = null;             /* 失败了允许再试一次 */
        throw err;
      });
    return loaded;
  }

  function isTimeoutError(err) {
    var txt = String((err && err.toString && err.toString()) || (err && err.message) || err || '');
    return /TimeLimit|time limit|execLimit|exceeded the allowed/i.test(txt);
  }

  /* Skulpt 抛出来的东西五花八门：尽量拼成一段像 CPython traceback 的文字，
     让初学者一眼看到「哪一行、什么错」 */
  function formatError(err) {
    var one = '';
    try { one = String(err || ''); } catch (e) { one = ''; }
    one = String(one || '').split('\n')[0].trim();
    if (!one) {
      try { one = (err && err.tp$name) ? err.tp$name : ''; } catch (e) { one = ''; }
    }
    if (!one) {
      try { one = String((err && err.message) || '运行出错'); } catch (e) { one = '运行出错'; }
    }
    /* 栈帧：只留用户代码那几帧（Skulpt 自己内部的帧删掉，看着才不吓人） */
    var frames = [];
    try {
      var tb = err && err.traceback;
      if (tb && tb.length) {
        for (var i = 0; i < tb.length; i++) {
          var f = tb[i] || {};
          var nm = (f.f_name && f.f_name.v) || '';
          var ln = f.lineno;
          if (ln && typeof ln === 'object' && 'v' in ln) ln = ln.v;
          if (!nm || /^(skulpt|Sk|builtin|stdin|<stdin>)/i.test(String(nm))) continue;
          frames.push('  第 ' + (ln == null ? '?' : ln) + ' 行');
        }
      }
    } catch (e) { frames = []; }
    var out = [];
    if (frames.length) {
      out.push('出错了（从下面往上读）：');
      out = out.concat(frames.slice(-6));
    }
    out.push(one);
    return out.join('\n');
  }

  /**
   * 跑一段代码。
   * @param {string} code  用户代码
   * @param {string} stdin 喂给 input() 的整段输入
   * @param {number} timeoutMs 执行预算（毫秒）
   * @returns {Promise<{ok:boolean,stdout:string,stderr:string,ms:number,timeout?:boolean}>}
   */
  function run(code, stdin, timeoutMs) {
    return ensure().then(function (Sk) {
      var out = [];
      var outLen = 0;
      var MAX_OUT = 200 * 1024;
      var text = String(stdin == null ? '' : stdin);
      var lines = text.split('\n');
      /* 以换行结尾时 split 会多出一个空串，那个不是「空行输入」 */
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      var at = 0;
      var files = (Sk.builtinFiles && Sk.builtinFiles.files) || {};
      Sk.configure({
        output: function (t) { if (outLen < MAX_OUT) { out.push(t); outLen += String(t).length; } },
        read: function (f) {
          if (files[f] !== undefined) return files[f];
          throw new Error('这个运行环境里没有标准库文件：' + f);
        },
        inputfun: function () { return at < lines.length ? lines[at++] : ''; },
        inputfunTakesPrompt: true,
        execLimit: Math.max(500, Number(timeoutMs) || 4000),
        __future__: Sk.python3,
        python3: true,
        debugging: false,
        breakpoints: false
      });
      var started = Date.now();
      var src = String(code == null ? '' : code);
      return Sk.misceval.asyncToPromise(function () {
        return Sk.importMainWithBody('<你的代码>', false, src, true);
      }).then(function () {
        return { ok: true, stdout: out.join(''), stderr: '', ms: Date.now() - started };
      }, function (err) {
        var ms = Date.now() - started;
        var timeout = isTimeoutError(err);
        return {
          ok: false,
          stdout: out.join(''),
          ms: ms,
          timeout: timeout,
          stderr: timeout
            ? '运行超时了（超过 ' + (Math.max(500, Number(timeoutMs) || 4000) / 1000).toFixed(1) + ' 秒还没结束，可能是死循环）'
            : formatError(err)
        };
      });
    }, function (err) {
      return { ok: false, stdout: '', ms: 0, stderr: String((err && err.message) || err || '运行环境没起来'), setupFailed: true };
    });
  }

  global.JHJX_OJ_RUNNER = {
    ensure: function () { return ensure().then(function () { return true; }); },
    run: run,
    isReady: function () { return !!(global.Sk && global.Sk.builtinFiles); },
    version: LIB_VER
  };
})(window);
