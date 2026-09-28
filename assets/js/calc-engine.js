/* =========================================================
   掌上嘉协 · 学习计算器 —— 计算引擎
   - 数值部分：自研递归下降解析器（不用 eval，支持角度/弧度）
   - 符号部分：nerdamer（求导 / 积分 / 极限 / 解方程）
   暴露为 window.CalcEngine
   ========================================================= */
(function (global) {
  'use strict';

  /* ============ 1. 词法分析 ============ */
  function tokenize(src) {
    var s = String(src)
      .replace(/×/g, '*').replace(/·/g, '*').replace(/÷/g, '/')
      .replace(/−/g, '-').replace(/–/g, '-')
      .replace(/π/g, 'pi').replace(/√/g, 'sqrt').replace(/∞/g, 'inf')
      .replace(/\s+/g, '');

    var tokens = [];
    var i = 0;
    while (i < s.length) {
      var c = s.charAt(i);

      /* 数字（含 1.5e-3 科学计数） */
      if (/[0-9.]/.test(c)) {
        var j = i;
        while (j < s.length && /[0-9.]/.test(s.charAt(j))) j++;
        if (/[eE]/.test(s.charAt(j) || '')) {
          var k = j + 1;
          if (/[+\-]/.test(s.charAt(k) || '')) k++;
          if (/[0-9]/.test(s.charAt(k) || '')) {
            while (k < s.length && /[0-9]/.test(s.charAt(k))) k++;
            j = k;
          }
        }
        var numText = s.slice(i, j);
        if ((numText.match(/\./g) || []).length > 1) throw new Error('数字格式错误：' + numText);
        tokens.push({ t: 'num', v: parseFloat(numText) });
        i = j;
        continue;
      }

      /* 标识符 */
      if (/[a-zA-Z_]/.test(c)) {
        var j2 = i;
        while (j2 < s.length && /[a-zA-Z_0-9]/.test(s.charAt(j2))) j2++;
        tokens.push({ t: 'id', v: s.slice(i, j2) });
        i = j2;
        continue;
      }

      if ('+-*/^!%(),'.indexOf(c) >= 0) { tokens.push({ t: 'op', v: c }); i++; continue; }

      throw new Error('无法识别的字符「' + c + '」');
    }
    return tokens;
  }

  /* ============ 2. 语法分析（递归下降） ============ */
  function Parser(tokens) { this.tk = tokens; this.p = 0; }
  Parser.prototype.peek = function () { return this.tk[this.p] || null; };
  Parser.prototype.next = function () { return this.tk[this.p++] || null; };
  Parser.prototype.isOp = function (v) { var t = this.peek(); return t && t.t === 'op' && t.v === v; };
  Parser.prototype.eat = function (v) {
    if (!this.isOp(v)) throw new Error('缺少「' + v + '」');
    this.p++;
  };

  Parser.prototype.parse = function () {
    var node = this.expr();
    if (this.p < this.tk.length) {
      var t = this.peek();
      throw new Error('多余的内容「' + (t.v !== undefined ? t.v : t.t) + '」');
    }
    return node;
  };

  Parser.prototype.expr = function () {
    var node = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      var op = this.next().v;
      node = { t: 'bin', op: op, l: node, r: this.term() };
    }
    return node;
  };

  Parser.prototype.term = function () {
    var node = this.unary();
    for (;;) {
      if (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
        var op = this.next().v;
        node = { t: 'bin', op: op, l: node, r: this.unary() };
        continue;
      }
      /* 隐式乘法：2pi、3(4+5)、2x、(a)(b) */
      var nx = this.peek();
      if (nx && ((nx.t === 'num') || (nx.t === 'id') || (nx.t === 'op' && nx.v === '('))) {
        node = { t: 'bin', op: '*', l: node, r: this.unary(), implicit: true };
        continue;
      }
      break;
    }
    return node;
  };

  /* 乘方：右结合。负号优先级低于乘方，所以 -2^2 = -(2^2) = -4 */
  Parser.prototype.power = function () {
    var base = this.postfix();
    if (this.isOp('^')) {
      this.next();
      return { t: 'bin', op: '^', l: base, r: this.unary() };
    }
    return base;
  };

  Parser.prototype.unary = function () {
    if (this.isOp('-')) { this.next(); return { t: 'neg', v: this.unary() }; }
    if (this.isOp('+')) { this.next(); return this.unary(); }
    return this.power();
  };

  Parser.prototype.postfix = function () {
    var node = this.primary();
    while (this.isOp('!')) { this.next(); node = { t: 'fact', v: node }; }
    return node;
  };

  Parser.prototype.primary = function () {
    var t = this.next();
    if (!t) throw new Error('表达式不完整');

    if (t.t === 'num') return { t: 'num', v: t.v };

    if (t.t === 'op' && t.v === '(') {
      var inner = this.expr();
      this.eat(')');
      return inner;
    }

    if (t.t === 'id') {
      var name = t.v.toLowerCase();
      if (this.isOp('(')) {
        this.next();
        var args = [];
        if (!this.isOp(')')) {
          args.push(this.expr());
          while (this.isOp(',')) { this.next(); args.push(this.expr()); }
        }
        this.eat(')');
        return { t: 'call', name: name, args: args };
      }
      return { t: 'var', name: name };
    }

    throw new Error('表达式有误');
  };

  /* ============ 3. 求值 ============ */
  var PI = Math.PI, E = Math.E;

  function factorial(n) {
    if (n < 0 || Math.floor(n) !== n) throw new Error('阶乘只支持非负整数');
    if (n > 170) return Infinity;
    var r = 1;
    for (var i = 2; i <= n; i++) r *= i;
    return r;
  }

  function nCr(n, r) {
    if (r < 0 || r > n) return 0;
    return Math.round(factorial(n) / (factorial(r) * factorial(n - r)));
  }
  function nPr(n, r) {
    if (r < 0 || r > n) return 0;
    return Math.round(factorial(n) / factorial(n - r));
  }
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a; }

  function toRad(x, deg) { return deg ? x * PI / 180 : x; }
  function fromRad(x, deg) { return deg ? x * 180 / PI : x; }

  var FUNCS = {
    sin: function (a, deg) { return Math.sin(toRad(a[0], deg)); },
    cos: function (a, deg) { return Math.cos(toRad(a[0], deg)); },
    tan: function (a, deg) { return Math.tan(toRad(a[0], deg)); },
    asin: function (a, deg) { return fromRad(Math.asin(a[0]), deg); },
    acos: function (a, deg) { return fromRad(Math.acos(a[0]), deg); },
    atan: function (a, deg) { return fromRad(Math.atan(a[0]), deg); },
    atan2: function (a, deg) { return fromRad(Math.atan2(a[0], a[1]), deg); },
    sinh: function (a) { return Math.sinh(a[0]); },
    cosh: function (a) { return Math.cosh(a[0]); },
    tanh: function (a) { return Math.tanh(a[0]); },
    asinh: function (a) { return Math.asinh(a[0]); },
    acosh: function (a) { return Math.acosh(a[0]); },
    atanh: function (a) { return Math.atanh(a[0]); },
    ln: function (a) { return Math.log(a[0]); },
    log: function (a) { return Math.log(a[0]); },
    lg: function (a) { return Math.log10(a[0]); },
    log10: function (a) { return Math.log10(a[0]); },
    log2: function (a) { return Math.log2(a[0]); },
    sqrt: function (a) { return Math.sqrt(a[0]); },
    cbrt: function (a) { return Math.cbrt(a[0]); },
    root: function (a) { return Math.sign(a[0]) * Math.pow(Math.abs(a[0]), 1 / a[1]); },
    abs: function (a) { return Math.abs(a[0]); },
    exp: function (a) { return Math.exp(a[0]); },
    sign: function (a) { return Math.sign(a[0]); },
    floor: function (a) { return Math.floor(a[0]); },
    ceil: function (a) { return Math.ceil(a[0]); },
    round: function (a) { return Math.round(a[0]); },
    fact: function (a) { return factorial(a[0]); },
    mod: function (a) { return ((a[0] % a[1]) + a[1]) % a[1]; },
    pow: function (a) { return Math.pow(a[0], a[1]); },
    min: function (a) { return Math.min.apply(null, a); },
    max: function (a) { return Math.max.apply(null, a); },
    ncr: function (a) { return nCr(a[0], a[1]); },
    npr: function (a) { return nPr(a[0], a[1]); },
    gcd: function (a) { return gcd(a[0], a[1]); },
    lcm: function (a) { return Math.abs(a[0] * a[1]) / (gcd(a[0], a[1]) || 1); }
  };

  var CONSTS = { pi: PI, e: E, inf: Infinity, infinity: Infinity };

  function evalNode(node, env, deg) {
    switch (node.t) {
      case 'num': return node.v;
      case 'neg': return -evalNode(node.v, env, deg);
      case 'fact': return factorial(evalNode(node.v, env, deg));
      case 'bin': {
        var l = evalNode(node.l, env, deg);
        var r = evalNode(node.r, env, deg);
        switch (node.op) {
          case '+': return l + r;
          case '-': return l - r;
          case '*': return l * r;
          case '/': return l / r;
          case '^': return Math.pow(l, r);
          case '%': return ((l % r) + r) % r;
        }
        throw new Error('未知运算符 ' + node.op);
      }
      case 'var': {
        if (Object.prototype.hasOwnProperty.call(env, node.name)) return env[node.name];
        if (Object.prototype.hasOwnProperty.call(CONSTS, node.name)) return CONSTS[node.name];
        throw new Error('未知符号「' + node.name + '」（可用变量：' +
          (Object.keys(env).join('、') || '无') + '）');
      }
      case 'call': {
        var fn = FUNCS[node.name];
        if (node.name === 'log' && node.args.length === 2) {
          var base = evalNode(node.args[0], env, deg);
          var value = evalNode(node.args[1], env, deg);
          return Math.log(value) / Math.log(base);
        }
        if (!fn) throw new Error('未知函数「' + node.name + '」');
        var args = node.args.map(function (a) { return evalNode(a, env, deg); });
        return fn(args, deg);
      }
    }
    throw new Error('表达式结构有误');
  }

  var cache = {};
  function compile(expr) {
    if (cache[expr]) return cache[expr];
    var ast = new Parser(tokenize(expr)).parse();
    cache[expr] = ast;
    return ast;
  }

  /** 数值求值。env 为变量表，如 { x: 2 } */
  function evaluate(expr, env, deg) {
    if (expr === undefined || expr === null || String(expr).trim() === '') throw new Error('请输入表达式');
    return evalNode(compile(String(expr)), env || {}, !!deg);
  }

  /* ============ 4. 数字格式化 ============ */
  function formatNumber(n) {
    if (typeof n !== 'number') return String(n);
    if (Number.isNaN(n)) return '无定义（NaN）';
    if (!isFinite(n)) return n > 0 ? '∞' : '-∞';
    if (n === 0) return '0';
    var abs = Math.abs(n);
    if (abs >= 1e12 || abs < 1e-9) {
      return n.toExponential(9).replace(/\.?0+e/, 'e').replace('e+', '×10^').replace('e-', '×10^-');
    }
    var s = parseFloat(n.toPrecision(12)).toString();
    if (s.indexOf('e') >= 0) return s;
    return s;
  }

  /* ============ 5. 数值积分（自适应辛普森） ============ */
  function simpson(f, a, b, n) {
    var h = (b - a) / n, s = f(a) + f(b);
    for (var i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
    return s * h / 3;
  }
  function numericIntegral(expr, a, b, deg) {
    var f = function (x) { return evaluate(expr, { x: x }, deg); };
    var prev = simpson(f, a, b, 200);
    for (var k = 0; k < 6; k++) {
      var next = simpson(f, a, b, 200 * Math.pow(2, k + 1));
      if (Math.abs(next - prev) < 1e-10 * (1 + Math.abs(next))) return next;
      prev = next;
    }
    return prev;
  }

  /* ============ 6. 数值极限（兜底） ============ */
  function numericLimit(expr, v, a, deg) {
    var f = function (x) { var env = {}; env[v] = x; try { return evaluate(expr, env, deg); } catch (e) { return NaN; } };
    var isInf = (a === Infinity || a === -Infinity);

    if (isInf) {
      var sign = a > 0 ? 1 : -1;
      var xs = [], vs = [];
      for (var e = 3; e <= 6; e++) {
        var x = sign * Math.pow(10, e);
        var val = f(x);
        if (Number.isNaN(val)) continue;
        if (!isFinite(val)) return val;
        xs.push(x);
        vs.push(val);
      }
      if (!vs.length) return NaN;
      if (vs.length === 1) return vs[0];
      /* 误差约 c/x：用最后两点外推，能显著提高精度（如 (1+1/x)^x → e） */
      var i1 = vs.length - 2, i2 = vs.length - 1;
      var c = (vs[i1] - vs[i2]) / (1 / xs[i1] - 1 / xs[i2]);
      var L = vs[i1] - c / xs[i1];
      if (!isFinite(L) || Math.abs(L - vs[i2]) > 10 * Math.abs(vs[i2] - vs[i1]) + 1e-12) return vs[i2];
      return L;
    }

    var left = NaN, right = NaN;
    for (var k = 2; k <= 7; k++) {
      var h = Math.pow(10, -k);
      var l = f(a - h), r = f(a + h);
      if (!Number.isNaN(l)) left = l;
      if (!Number.isNaN(r)) right = r;
      if (!Number.isNaN(left) && !Number.isNaN(right) && Math.abs(left - right) < 1e-6 * (1 + Math.abs(left))) {
        return (left + right) / 2;
      }
    }
    if (!Number.isNaN(left) && !Number.isNaN(right) && Math.abs(left - right) > 1e-3) return NaN; /* 左右不相等 */
    return !Number.isNaN(left) ? left : right;
  }

  /* ============ 7. 符号计算（nerdamer） ============ */
  function hasNerdamer() { return typeof global.nerdamer === 'function'; }

  /** nerdamer 会输出 Unicode 减号/乘号等，统一成 ASCII，避免后续解析出错 */
  function normalizeMathText(s) {
    return String(s)
      .replace(/[\u2212\u2013\u2014\u2015]/g, '-')   /* − – —  → - */
      .replace(/[\u00d7]/g, '*')                        /* × → * */
      .replace(/[\u00f7]/g, '/')                        /* ÷ → / */
      .replace(/[\u03c0]/g, 'pi')                       /* π → pi */
      .replace(/[\u221e]/g, 'inf');                     /* ∞ → inf */
  }

  /** 角度模式下把三角函数参数换算成弧度（供符号计算使用）
   *  实现要点：一次性收集所有调用位置，从右往左处理，每个调用只处理一次。
   *  （早期版本会反复套用同一个调用，产生 pi^101 的垃圾结果并陷入死循环） */
  function wrapTrigDegrees(src) {
    var out = String(src);
    if (!/\b(sin|cos|tan|asin|acos|atan)\s*\(/.test(out)) return out;

    function balanced(str, openIdx) {
      var depth = 0;
      for (var i = openIdx; i < str.length; i++) {
        if (str.charAt(i) === '(') depth++;
        else if (str.charAt(i) === ')') { depth--; if (depth === 0) return i; }
      }
      return -1;
    }

    var re = /\b(sin|cos|tan|asin|acos|atan)\s*\(/g;
    var calls = [], m;
    while ((m = re.exec(out)) !== null) {
      calls.push({ name: m[1], open: out.indexOf('(', m.index) });
    }

    /* 从最右边的调用开始处理：更左边的下标不受影响，且每个调用只处理一次 */
    for (var i = calls.length - 1; i >= 0; i--) {
      var open = calls[i].open;
      var close = balanced(out, open);
      if (close < 0) continue;
      var inner = out.slice(open + 1, close);
      var name = calls[i].name;
      if (name === 'asin' || name === 'acos' || name === 'atan') {
        out = out.slice(0, close + 1) + '*180/pi' + out.slice(close + 1);
      } else {
        out = out.slice(0, open + 1) + '(' + inner + ')*pi/180' + ')' + out.slice(close + 1);
      }
    }

    /* 保险：出现夸张巨数说明套用失控，放弃换算 */
    if (/[0-9]{20,}/.test(out)) return String(src);
    return out;
  }

  /** 把用户写法转换成 nerdamer 能识别的写法（nerdamer 里 log 就是自然对数） */
  function toNerdamer(src) {
    return String(src)
      .replace(/\bln\s*\(/gi, 'log(')
      .replace(/\blg\s*\(/gi, 'log10(')
      .replace(/＝/g, '=');
  }

  /** 符号计算统一入口：先转换函数名，再按需做角度换算 */
  function forNerdamer(expr, deg) {
    var src = toNerdamer(expr);
    if (deg) src = wrapTrigDegrees(src);
    return src;
  }

  function sym(expr) {
    var src = expr;
    if (global.CalcEngine && global.CalcEngine.degrees) src = wrapTrigDegrees(src);
    return global.nerdamer(src);
  }
  function symText(node) {
    try { return normalizeMathText(node.simplify().text('fractions')); }
    catch (e) { return normalizeMathText(node.text('fractions')); }
  }

  /** 求导：order 阶，可选在某点求值 */
  function derivative(expr, v, order, deg) {
    if (!hasNerdamer()) throw new Error('符号计算库未加载');
    v = v || 'x';
    var src = forNerdamer(expr, deg === true);
    var call = order > 1
      ? 'diff(' + src + ',' + v + ',' + order + ')'
      : 'diff(' + src + ',' + v + ')';
    return symText(global.nerdamer(call));
  }

  /** 不定积分 */
  function integral(expr, v, deg) {
    if (!hasNerdamer()) throw new Error('符号计算库未加载');
    v = v || 'x';
    var src = forNerdamer(expr, deg === true);
    return symText(global.nerdamer('integrate(' + src + ',' + v + ')'));
  }

  /** 定积分：返回 { exact, numeric } */
  function definiteIntegral(expr, a, b, v, deg) {
    v = v || 'x';
    var result = { exact: null, numeric: null };
    try {
      var an = evaluate(a, {}, deg), bn = evaluate(b, {}, deg);
      result.numeric = numericIntegral(expr, an, bn, deg);
    } catch (e) { /* 数值算不了就算了 */ }
    if (hasNerdamer()) {
      try {
        var src = forNerdamer(expr, deg);
        var t = symText(global.nerdamer('defint(' + src + ',' + a + ',' + b + ',' + v + ')'));
        if (t.indexOf('defint') < 0) result.exact = t;
      } catch (e) { /* 符号算不了就只用数值 */ }
    }
    return result;
  }

  /** 极限 */
  function limit(expr, v, a, deg) {
    v = v || 'x';
    var target = String(a).trim();
    var inf = /^-?\s*(inf|infinity|∞)$/i.test(target);
    var exact = null;

    if (hasNerdamer()) {
      try {
        var src = forNerdamer(expr, deg);
        /* 注意：这里不能调 simplify()，它会把 limit 的结果破坏掉 */
        var t = normalizeMathText(global.nerdamer('limit(' + src + ',' + v + ',' + a + ')').text('fractions'));
        if (t.indexOf('limit(') < 0 && t.indexOf('diff(') < 0 && t.indexOf('integrate(') < 0) exact = t;
      } catch (e) { /* 继续尝试数值 */ }
    }
    if (exact !== null && !/limit/i.test(exact)) return { exact: exact, numeric: null };

    var av;
    if (/^-?\s*(inf|infinity|∞)$/i.test(target)) av = target.charAt(0) === '-' ? -Infinity : Infinity;
    else av = evaluate(target, {}, deg);
    var nv = numericLimit(expr, v, av, deg);
    return { exact: null, numeric: nv };
  }

  /** 解方程 */
  function solve(equation, v) {
    if (!hasNerdamer()) throw new Error('符号计算库未加载');
    v = v || 'x';
    var eq = String(equation).replace(/＝/g, '=');
    if (eq.indexOf('=') < 0) eq = eq + '=0';
    var raw = normalizeMathText(global.nerdamer.solve(toNerdamer(eq), v).text('fractions'));
    var inner = raw.replace(/^\[/, '').replace(/\]$/, '').trim();
    if (!inner) return { solutions: [], note: '未找到解' };
    var parts = inner.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var real = [], complex = 0;
    parts.forEach(function (p) {
      if (/[ij]/.test(p)) { complex++; return; }
      if (/^-?0(\.0+)?(\*1)?$/.test(p)) { real.push('0'); return; }
      real.push(p);
    });
    /* 去重（三角方程会给出周期解） */
    var seen = {}, uniq = [];
    real.forEach(function (p) { if (!seen[p]) { seen[p] = 1; uniq.push(p); } });
    /* 能算出数值的按从小到大排序，学生看起来更自然 */
    uniq.sort(function (a, b) {
      var na = null, nb = null;
      try { na = evaluate(a, {}, true); } catch (e) { na = null; }
      try { nb = evaluate(b, {}, true); } catch (e) { nb = null; }
      if (na === null || nb === null) return 0;
      return na - nb;
    });
    return {
      solutions: uniq,
      complexCount: complex,
      note: (uniq.length === 0 && complex > 0) ? '在实数范围内无解（有复数解）' : null
    };
  }

  /* ============ 8. 结果美化（转成便于阅读的 HTML） ============ */
  function prettify(text) {
    var s = String(text);
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/\bpi\b/g, 'π').replace(/\binf(inity)?\b/g, '∞');
    s = s.replace(/\blog\(/g, 'ln(');            /* nerdamer 的 log 即自然对数 */
    s = s.replace(/\bsqrt\(/g, '√(');
    s = s.replace(/\*/g, '·');
    /* 幂 → 上标 */
    s = s.replace(/\^\(([^()]+)\)/g, '<sup>$1</sup>');
    s = s.replace(/\^(-?[0-9]+(?:\.[0-9]+)?)/g, '<sup>$1</sup>');
    s = s.replace(/\^(-?[a-zA-Z])\b/g, '<sup>$1</sup>');
    return s;
  }

  global.CalcEngine = {
    degrees: true,
    evaluate: evaluate,
    formatNumber: formatNumber,
    numericIntegral: numericIntegral,
    numericLimit: numericLimit,
    derivative: derivative,
    integral: integral,
    definiteIntegral: definiteIntegral,
    limit: limit,
    solve: solve,
    prettify: prettify,
    wrapTrigDegrees: wrapTrigDegrees,
    hasNerdamer: hasNerdamer,
    version: '1.0'
  };
})(window);
