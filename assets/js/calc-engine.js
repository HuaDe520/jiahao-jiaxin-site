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

      /* 无穷：屏幕与历史记录里显示的就是 ∞，回填后要能再算一次 */
      if (c === '∞') { tokens.push({ t: 'num', v: Infinity }); i++; continue; }

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
  /* 把 e 计数法写成卡西欧风格的 E 计数法：1.234567890123E+15 */
  function toEStyle(s) {
    var parts = String(s).split(/[eE]/);
    var mant = parts[0].replace(/0+$/, '').replace(/\.$/, '');
    var exp = parseInt(parts[1], 10);
    if (isNaN(exp)) return mant;
    return mant + 'E' + (exp >= 0 ? '+' : '') + exp;
  }

  function formatNumber(n) {
    if (typeof n !== 'number') return String(n);
    if (Number.isNaN(n)) return '无定义（NaN）';
    if (!isFinite(n)) return n > 0 ? '∞' : '-∞';
    if (n === 0) return '0';

    var abs = Math.abs(n);

    /* 特别大或特别小的数：带 E 的科学计数法（13 位有效数字） */
    if (abs >= 1e10 || abs < 1e-9) return toEStyle(n.toExponential(12));

    /* 普通数字：最多 15 位有效数字，自动去掉浮点噪声与末尾多余的 0 */
    var out = parseFloat(n.toPrecision(15)).toString();
    if (out.indexOf('e') >= 0) return toEStyle(out);
    return out;
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

      /* 先判断是不是发散到无穷：收敛的极限相邻差会越来越小，
         而 ln(x)→∞、x^2→∞ 这类相邻差不会缩小（甚至变大）。 */
      if (vs.length >= 3) {
        var d1 = Math.abs(vs[vs.length - 2] - vs[vs.length - 3]);
        var d2 = Math.abs(vs[vs.length - 1] - vs[vs.length - 2]);
        var lastV = vs[vs.length - 1];
        if (Math.abs(lastV) > 1 && d2 > 0.5 * d1) return lastV > 0 ? Infinity : -Infinity;
      }

      /* 误差约 c/x：用最后两点外推，能显著提高精度（如 (1+1/x)^x → e） */
      var i1 = vs.length - 2, i2 = vs.length - 1;
      var c = (vs[i1] - vs[i2]) / (1 / xs[i1] - 1 / xs[i2]);
      var L = vs[i1] - c / xs[i1];
      if (!isFinite(L) || Math.abs(L - vs[i2]) > 10 * Math.abs(vs[i2] - vs[i1]) + 1e-12) return vs[i2];
      return L;
    }

    /* 有限点：左右各取一串越来越小的步长。
       要点是不能一看到左右相等就返回（abs(x) 在 0 处每一步都相等，
       但值本身在变小），要看相邻差是否在缩小，并用最后两步外推到 h→0。 */
    var hs = [], Ls = [], Rs = [];
    for (var k = 2; k <= 8; k++) {
      var h = Math.pow(10, -k);
      hs.push(h);
      Ls.push(f(a - h));
      Rs.push(f(a + h));
    }
    var L = sideExtrapolate(Ls, hs);
    var R = sideExtrapolate(Rs, hs);
    if (Number.isNaN(L) || Number.isNaN(R)) return NaN;   /* 有一侧算不出来，双侧极限就不存在 */
    if (Math.abs(L - R) > 1e-6 * (1 + Math.abs(L))) return NaN;   /* 左右不相等 */
    return (L + R) / 2;
  }

  /* 单侧序列外推：相邻差在缩小才算收敛，按 c·h 的模型外推到 h→0 */
  function sideExtrapolate(vals, hs) {
    var idx = [];
    for (var i = 0; i < vals.length; i++) {
      if (typeof vals[i] === 'number' && !Number.isNaN(vals[i])) idx.push(i);
    }
    if (!idx.length) return NaN;
    if (idx.length === 1) return vals[idx[0]];
    var i0 = idx.length >= 3 ? idx[idx.length - 3] : null;
    var i1 = idx[idx.length - 2], i2 = idx[idx.length - 1];
    var v1 = vals[i1], v2 = vals[i2];
    var d1 = Math.abs(v2 - v1);
    if (i0 !== null) {
      var d0 = Math.abs(vals[i1] - vals[i0]);
      /* 差没有缩小 → 振荡或发散，不能当极限 */
      if (d1 > 0.6 * d0 && d1 > 1e-12 * (1 + Math.abs(v2))) return NaN;
    }
    var r = hs[i2] / hs[i1];
    if (!(r > 0 && r < 1)) return v2;
    return (v2 - r * v1) / (1 - r);
  }

  /* ============ 7. 符号计算（nerdamer） ============ */
  function hasNerdamer() { return typeof global.nerdamer === 'function'; }

  /** nerdamer 会输出 Unicode 减号/乘号等，统一成 ASCII，避免后续解析出错 */
  function normalizeMathText(s) {
    return unmaskE(String(s)
      .replace(/[\u2212\u2013\u2014\u2015]/g, '-')   /* − – —  → - */
      .replace(/[\u00d7]/g, '*')                        /* × → * */
      .replace(/[\u00f7]/g, '/')                        /* ÷ → / */
      .replace(/[\u03c0]/g, 'pi')                       /* π → pi */
      .replace(/[\u221e]/g, 'inf'));                    /* ∞ → inf */
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
    return maskE(String(src)
      .replace(/\bln\s*\(/gi, 'log(')
      .replace(/\blg\s*\(/gi, 'log10(')
      .replace(/＝/g, '='));
  }

  /* nerdamer 会把常数 e 直接展开成有理数近似（e → 325368125/119696244），
     于是 d/dx e^(2x) 变成一堆巨数的乘积，学生完全看不懂。
     办法：送进 nerdamer 前把 e 换成一个普通符号，拿回结果后再换回来，
     这样 e 在符号运算里始终保持 e 的样子。 */
  var E_SYMBOL = 'eulerconst';
  function maskE(src) {
    /* 只认独立的 e：不碰 1e-3 里的 e，也不碰 exp( 的 e */
    return String(src).replace(/(^|[^0-9A-Za-z_])e(?![0-9A-Za-z_])/g, '$1' + E_SYMBOL);
  }
  function unmaskE(s) {
    return String(s).replace(new RegExp('\\b' + E_SYMBOL + '\\b', 'g'), 'e');
  }
  /* e 在符号库里是普通字母，会被当成变量，于是导数/解里多出 log(e) 因子：
     d/dx e^x → e^x*log(e)。把 log(e) 消成 1 再化简一次。 */
  function cleanEArtifacts(t) {
    if (String(t).indexOf(E_SYMBOL) < 0) return String(t);
    return String(t)
      .replace(new RegExp('log\\(' + E_SYMBOL + '\\)\\^\\(-1\\)', 'g'), '1')
      .replace(new RegExp('log\\(' + E_SYMBOL + '\\)', 'g'), '1');
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
    var t;
    try { t = node.simplify().text('fractions'); }
    catch (e) { t = node.text('fractions'); }
    /* e 在符号库里是占位符，会被当成普通字母，于是导数多出 log(e) 因子
       （d/dx e^x → e^x*log(e)）。把 log(e) 消掉后再化简一次。 */
    if (t.indexOf(E_SYMBOL) >= 0 && t.indexOf('log(') >= 0) {
      try {
        var cleaned = cleanEArtifacts(t);
        if (cleaned !== t) t = global.nerdamer(cleaned).simplify().text('fractions');
      } catch (e) { /* 清理失败就用原样 */ }
    }
    return normalizeMathText(t);
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

  /* ============ 6c. 广义积分（无穷区间 / 奇点） ============ */
  /* 思路：把积分区间不断推向奇点或无穷，看结果序列是否收敛。
     收敛就是广义积分的值（∫₀¹ 1/√x = 2、∫₀¹ ln x = -1），
     一路变大就是发散（∫₀¹ 1/x² 、∫₀^{π/2} tan x）。 */
  function judgeSequence(seq) {
    var finite = seq.filter(function (v) {
      return typeof v === 'number' && !Number.isNaN(v) && isFinite(v);
    });
    if (!finite.length) {
      var anyInf = seq.some(function (v) {
        return typeof v === 'number' && !Number.isNaN(v) && !isFinite(v);
      });
      return { value: null, diverges: anyInf, improper: true };
    }
    var n = finite.length;
    var last = finite[n - 1];
    if (n === 1) return { value: last, diverges: false, improper: true };

    var prev = finite[n - 2];
    var rel = Math.abs(last - prev) / (1 + Math.abs(last));
    if (rel < 1e-4) return { value: last, diverges: false, improper: true };

    /* 相邻增量不缩小、数值一路见长 → 发散 */
    var inc = Math.abs(last) - Math.abs(prev);
    var prevInc = n > 2 ? Math.abs(prev) - Math.abs(finite[n - 3]) : inc;
    if (inc > 0 && prevInc > 0 && inc > 0.5 * prevInc && Math.abs(last) > 1) {
      return { value: null, diverges: true, improper: true };
    }
    if (Math.abs(last) > 1e9) return { value: null, diverges: true, improper: true };

    /* 还在缓慢变化但已经接近：给出最后一次的值 */
    if (rel < 1e-2) return { value: last, diverges: false, improper: true };
    return { value: null, diverges: false, improper: true };
  }

  /* tanh-sinh（双指数）数值积分：样点飞快地向端点聚集，
     所以对端点奇异的积分（∫₀¹ 1/√x = 2、∫₀¹ ln x = -1）也能算准；
     真发散的（∫₀¹ 1/x² 、∫₀^{π/2} tan x）会随层数不断变大，用序列判出来。
     比区间直接套辛普森稳得多：后者在 [0, 1e9] 这种宽区间上会算出离谱的值。 */
  function tanhSinh(fn, a, b, level) {
    var c = (a + b) / 2, d = (b - a) / 2;
    var h = Math.pow(2, -level);
    var K = Math.min(4000, Math.ceil(7 / h));
    var sum = 0;
    for (var k = -K; k <= K; k++) {
      var t = k * h;
      var u = (Math.PI / 2) * Math.sinh(t);
      if (Math.abs(u) > 350) continue;
      var ch = Math.cosh(u);
      var w = (Math.PI / 2) * Math.cosh(t) / (ch * ch);
      var y = fn(c + d * Math.tanh(u));
      if (typeof y !== 'number' || !isFinite(y)) continue;   /* 正好踩在奇点上就跳过 */
      sum += w * y;
    }
    return sum * d * h;
  }

  function adaptiveIntegral(fn, a, b) {
    var seq = [];
    for (var lv = 1; lv <= 8; lv++) seq.push(tanhSinh(fn, a, b, lv));
    return judgeSequence(seq);
  }

  /* 区间上的奇点在哪：端点奇异（∫₀¹ 1/√x、∫₀^{π/2} tan）还是内部有极点（∫₋₁¹ 1/x）。
     端点奇异可以算（收敛就给出值，发散就判发散），内部极点直接判发散。 */
  function classifySingularity(f, an, bn) {
    var span = bn - an;
    if (!(Math.abs(span) > 0)) return 'none';
    var bad = function (x) {
      var y = f(x);
      return !isFinite(y) || Math.abs(y) > 1e6;
    };
    if (bad(an) || bad(bn)) return 'endpoint';
    for (var k = 1; k < 16; k++) {
      if (bad(an + span * k / 16)) return 'interior';
    }
    if (bad(an + span * 1e-9) || bad(bn - span * 1e-9)) return 'endpoint';
    return 'none';
  }

  /* 端点奇异：把坏掉的那一端一点点让开，看结果是否收敛 */
  function endpointSingularIntegral(f, an, bn) {
    var span = bn - an;
    var bad = function (x) {
      var y = f(x);
      return !isFinite(y) || Math.abs(y) > 1e6;
    };
    var leftBad = bad(an), rightBad = bad(bn);
    if (!leftBad && !rightBad) return adaptiveIntegral(f, an, bn);
    var seq = [];
    for (var i = 3; i <= 10; i++) {
      var eps = Math.abs(span) * Math.pow(10, -i);
      seq.push(tanhSinh(f, leftBad ? an + eps : an, rightBad ? bn - eps : bn, 8));
    }
    return judgeSequence(seq);
  }

  function improperIntegral(expr, an, bn, deg) {
    var f = function (x) {
      try {
        var y = evaluate(expr, { x: x }, deg);
        return typeof y === 'number' ? y : NaN;
      } catch (e) { return NaN; }
    };
    var unknown = { value: null, diverges: false, improper: true };
    if (Number.isNaN(an) || Number.isNaN(bn)) return unknown;

    /* 两端都是无穷：从 0 处拆开分别算 */
    if (!isFinite(an) && !isFinite(bn)) {
      var left = improperIntegral(expr, an, 0, deg);
      var right = improperIntegral(expr, 0, bn, deg);
      if (left.diverges || right.diverges) return { value: null, diverges: true, improper: true };
      if (left.value === null || right.value === null) return unknown;
      return { value: left.value + right.value, diverges: false, improper: true };
    }

    /* 单侧无穷：换元 x = a + t/(1-t)（或 x = b - t/(1-t)）压到 [0,1] */
    if (!isFinite(an) || !isFinite(bn)) {
      var base = isFinite(an) ? an : bn;
      var dir = isFinite(an) ? 1 : -1;
      var g = function (t) {
        var d = 1 - t;
        if (d <= 0) return NaN;
        return f(base + dir * t / d) / (d * d);
      };
      var r = adaptiveIntegral(g, 0, 1);
      r.improper = true;
      return r;
    }

    /* 有限区间 */
    var cls = classifySingularity(f, an, bn);
    if (cls === 'interior') return { value: null, diverges: true, improper: true };
    if (cls === 'endpoint') {
      var e = endpointSingularIntegral(f, an, bn);
      e.improper = true;
      return e;
    }
    var plain = numericIntegral(expr, an, bn, deg);
    if (isFinite(plain)) return { value: plain, diverges: false, improper: false };
    var res = adaptiveIntegral(f, an, bn);
    res.improper = true;
    return res;
  }

  /** 定积分：返回 { exact, numeric, diverges, improper } */
  function definiteIntegral(expr, a, b, v, deg) {
    v = v || 'x';
    var result = { exact: null, numeric: null, diverges: false, improper: false };
    var an = NaN, bn = NaN;
    try { an = evaluate(a, {}, deg); bn = evaluate(b, {}, deg); } catch (e) { /* 上下限本身写错了 */ }

    var np = improperIntegral(expr, an, bn, deg);
    result.numeric = np.value;
    result.diverges = np.diverges;
    result.improper = np.improper;

    if (hasNerdamer()) {
      try {
        var src = forNerdamer(expr, deg);
        var t = symText(global.nerdamer('defint(' + src + ',' + a + ',' + b + ',' + v + ')'));
        /* 丢掉没算完的、含无穷的、以及结果是复数的伪精确值 */
        var junk = t.indexOf('defint') >= 0 || /inf/i.test(t) ||
                   /(^|[^A-Za-z])i([^A-Za-z]|$)/.test(t) || /integrate\(/i.test(t);
        if (!junk) result.exact = t;
      } catch (e) { /* 符号算不了就只用数值 */ }
    }

    /* 数值判定为发散时，不保留任何看似精确的垃圾结果 */
    if (result.diverges) { result.exact = null; result.numeric = null; }
    /* 数值发散不出来但精确值是个离谱的大分数，也不要它 */
    if (result.exact && /^\(?-?\d{9,}\/-?\d{6,}/.test(result.exact) && result.numeric === null) {
      result.exact = null;
    }
    return result;
  }

  /* ============ 6b. 极限的辅助判断 ============ */
  /* 非光滑函数（绝对值、取整、符号函数）交给 nerdamer 的 limit 会跑不完：
     limit(abs(x)/x,x,0) 直接死循环，整个页面就冻住了。这类一律走数值方法。 */
  var NONSMOOTH = /\b(abs|floor|ceil|round|sign)\s*\(/i;

  function ysOf(arr) {
    return (arr || []).map(function (p) { return p.y; })
      .filter(function (y) { return typeof y === 'number' && !Number.isNaN(y); });
  }
  function spreadOf(arr) {
    var ys = ysOf(arr);
    if (ys.length < 3) return 0;
    return Math.max.apply(null, ys) - Math.min.apply(null, ys);
  }
  /* 函数值在附近爆掉 → 是发散，而不是「左右极限不相等」。
     不能只看绝对值大小（1/x 在 0 附近步长 1e-4 时也才 1e4），
     要看「越靠近目标点，值是不是越往外跑」。 */
  function sampleBlowsUp(sides) {
    function pick(arr, fromEnd) {
      var ys = ysOf(arr);
      if (!ys.length) return 0;
      return Math.abs(fromEnd ? ys[ys.length - 1] : ys[0]);
    }
    var sidesList = [sides.left, sides.right];
    for (var i = 0; i < sidesList.length; i++) {
      var near = pick(sidesList[i], true), far = pick(sidesList[i], false);
      if (near > 1e6) return true;
      if (near > 100 && near > 10 * far) return true;
    }
    return false;
  }

  /** 极限：返回 { exact, numeric, sides, diverges, infinite, infiniteSign, none, blowsUp, unstable } */
  function limit(expr, v, a, deg) {
    v = v || 'x';
    var target = String(a).trim();
    var av;
    if (/^-?\s*(inf|infinity|∞)$/i.test(target)) av = target.charAt(0) === '-' ? -Infinity : Infinity;
    else av = evaluate(target, {}, deg);

    /* 取值过程：从左右（或从大数）逼近，供界面展示"怎么得到的" */
    var pick = function (x) {
      var env = {};
      env[v] = x;
      try { return evaluate(expr, env, deg); } catch (e) { return NaN; }
    };
    var sides = { left: [], right: [], toInfinity: !isFinite(av) };
    if (isFinite(av)) {
      var scale = Math.max(1, Math.abs(av));
      [0.1, 0.01, 0.001, 0.0001].forEach(function (h) {
        var d = h * scale;
        sides.left.push({ x: av - d, y: pick(av - d) });
        sides.right.push({ x: av + d, y: pick(av + d) });
      });
    } else {
      var sgn = av > 0 ? 1 : -1;
      [100, 1000, 10000, 100000].forEach(function (m) {
        sides.right.push({ x: sgn * m, y: pick(sgn * m) });
      });
    }

    var exact = null;
    if (hasNerdamer() && !NONSMOOTH.test(expr)) {
      try {
        var src = forNerdamer(expr, deg);
        /* 注意：这里不能调 simplify()，它会把 limit 的结果破坏掉 */
        var t = normalizeMathText(global.nerdamer('limit(' + src + ',' + v + ',' + a + ')').text('fractions'));
        if (t.indexOf('limit(') < 0 && t.indexOf('diff(') < 0 && t.indexOf('integrate(') < 0) exact = t;
      } catch (e) { /* 继续尝试数值 */ }
    }
    /* nerdamer 会交出 inf^(-1)、inf^2 这种没算完的中间形式，
       以及 [-1,1] 这种「两侧不相等」的列表，都不能当答案 */
    if (exact !== null && (/inf/i.test(exact) || /^\s*\[/.test(exact) ||
        /limit\(|diff\(|integrate\(/i.test(exact))) exact = null;

    var out = {
      exact: exact, numeric: null, sides: sides, diverges: false,
      infinite: false, infiniteSign: 0, none: false,
      blowsUp: sampleBlowsUp(sides), unstable: false
    };
    if (exact !== null) return out;

    var nv = numericLimit(expr, v, av, deg);

    if (typeof nv === 'number' && !Number.isNaN(nv) && !isFinite(nv)) {
      out.infinite = true;
      out.diverges = true;
      out.infiniteSign = nv > 0 ? 1 : -1;
      return out;
    }
    if (typeof nv !== 'number' || Number.isNaN(nv)) {
      out.none = true;
      out.diverges = true;
      return out;
    }

    /* 振荡函数（sin(1/x) 在 0 附近）数值法会给出一个纯属巧合的假值：
       样点在最后几步依然大幅跳动就说明这个数不可信。 */
    var spread = Math.max(spreadOf(sides.left), spreadOf(sides.right));
    if (spread > 1e-6 && spread > 0.1 * (1 + Math.abs(nv))) {
      out.unstable = true;
      out.none = true;
      out.diverges = false;
      return out;
    }

    out.numeric = nv;
    return out;
  }

  /** 解方程 */
  function solve(equation, v) {
    if (!hasNerdamer()) throw new Error('符号计算库未加载');
    v = v || 'x';
    var eq = String(equation).replace(/＝/g, '=');
    if (eq.indexOf('=') < 0) eq = eq + '=0';
    var masked;
    try {
      masked = global.nerdamer.solve(toNerdamer(eq), v).text('fractions');
    } catch (err) {
      /* nerdamer 对矛盾方程抛的是英文（1 does not equal 0），翻成人话 */
      var msg = String((err && err.message) || '');
      if (/equal/i.test(msg)) throw new Error('方程无解（等式矛盾）');
      throw new Error('该方程暂时解不出来，试试一次、二次或三次方程');
    }
    var inner = String(masked).replace(/^\[/, '').replace(/\]$/, '').trim();
    if (!inner) return { solutions: [], note: '未找到解' };
    /* 逐个解清理 e 的痕迹（解 e^x=2 会得到 log(2)/log(e) 这种形式） */
    var parts = inner.split(',').map(function (s) {
      var p = s.trim();
      var cleaned = cleanEArtifacts(p);
      if (cleaned !== p) {
        try { p = global.nerdamer(cleaned).simplify().text('fractions'); } catch (e) { p = cleaned; }
      }
      return normalizeMathText(p);
    }).filter(Boolean);
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
    s = s.replace(/\bpi\b/g, 'π').replace(/\binf(inity)?\b/gi, '∞');
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
