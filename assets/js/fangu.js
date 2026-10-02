/* =========================================================
   嘉番 · 番咕咪
   ---------------------------------------------------------
   一栏「全部番剧」（按标签翻页找番 + 按名字搜番），一栏「豪番推荐」。
   点开一部番 → 简介 / 类型 / 三个评分 → 打分写评价 → 推荐。
   · 番剧信息是后端从 B 站取的（不是我们编的）；
   · 封面走 B 站图床的小图直链（图小、页面不卡），取不到再退回后端转发；
   · 咕咪评分 = 自己人打分的平均分；大众评分 = 几个平台取平均；B 站评分 = 哔哩哔哩；
   · 推荐多的番会进「豪番推荐」那一栏。
   ========================================================= */
(function () {
  function $(id) { return document.getElementById(id); }

  var guestEl = $('fgGuest');
  var mainEl = $('fgMain');
  var tabAll = $('fgTabAll');
  var tabHall = $('fgTabHall');
  var allPane = $('fgAllPane');
  var hallPane = $('fgHallPane');
  var hallEl = $('fgHall');
  var hallHint = $('fgHallHint');
  var hallEmpty = $('fgHallEmpty');
  var listEl = $('fgList');
  var emptyEl = $('fgEmpty');
  var msgEl = $('fgMsg');
  var queryEl = $('fgQuery');
  var goBtn = $('fgGo');
  var pagerEl = $('fgPager');
  var crumbEl = $('fgCrumb');
  var filterWrap = $('fgFilterWrap');
  var tagsEl = $('fgTags');
  var scoreWrap = $('fgScoreWrap');
  var scoreFiltersEl = $('fgScoreFilters');
  var libHint = $('fgLibHint');
  var sheet = $('fgSheet');
  var sheetBox = $('fgSheetBox');

  var state = {
    mode: 'browse',    /* browse（翻着看）/ search（按名字搜）/ hall（豪番推荐） */
    page: 1,
    pages: 1,
    total: 0,
    tag: '',           /* 当前选中的标签 id（空 = 全部） */
    tags: [],          /* 标签表：后端按 B 站番剧索引的「风格」给的 */
    score: '',         /* 评分区间用哪一档：bili / gu / global（空 = 不限） */
    min: 0,            /* 区间下限（含） */
    max: 10,           /* 区间上限（不含；到 10 就是「X 分以上」） */
    scope: 'all',      /* all = 全站番剧；lib = 本站看过的番（咕咪评分只有这些才有） */
    pending: 0,        /* 大众评分还差几部没核对完（服务器说的） */
    keyword: '',
    results: [],
    span: 2,           /* 页码中间那一坨先显示多少页（点省略号会变多） */
    need: 0,
    totalUsers: 0,
    open: null,        /* 当前打开的番 */
    lastFocus: null,
    busy: false,
  };
  var msgTimer = 0;

  function msg(text, isError) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.className = 'fg-msg' + (text ? ' is-show' : '') + (isError ? ' is-error' : '');
    if (msgTimer) clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(function () { msgEl.className = 'fg-msg'; }, 7000);
  }

  /* 没登录也能用：翻页、搜索、看详情都放行，只有打分 / 写评价 / 推荐要登录 */
  function loggedIn() {
    try { return !!(window.JHJX_API && window.JHJX_API.token && window.JHJX_API.token()); } catch (e) { return false; }
  }

  function fmtScore(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return '';
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function fmtTime(ts) {
    var n = Number(ts) || 0;
    if (!n) return '';
    var d = new Date(n);
    var now = new Date();
    function pad(x) { return (x < 10 ? '0' : '') + x; }
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
    var y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + hm;
  }

  /* 封面：优先用 B 站图床那张裁好的小图（不经我们的服务器，出来得快），
     直连被挡（有的网络会被图床拦）再退回后端的转发地址，总之要出图。
     图床还有一种脾气：不报错、也不给图（同一时间要的图太多就被晾着），
     所以再挂一个计时器，几秒还没出来就换我们的转发。 */
  var COVER_WAIT = 5000;
  function setCover(img, item) {
    var direct = String(item.coverSmall || '');
    var fallback = '';
    if (item.cover) {
      fallback = (window.JHJX_API && window.JHJX_API.asset) ? window.JHJX_API.asset(item.cover) : item.cover;
    }
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.loading = 'lazy';
    img.decoding = 'async';
    var settled = false;
    var timer = 0;
    function clear() { if (timer) { clearTimeout(timer); timer = 0; } }
    function useFallback() {
      if (settled || !fallback) return;
      settled = true;
      clear();
      /* 已经决定换源了，就别再懒加载等着 —— 现在就要 */
      img.loading = 'eager';
      img.src = fallback;
    }
    img.addEventListener('load', function () {
      if (img.naturalWidth > 0) { settled = true; clear(); }
    });
    img.addEventListener('error', useFallback);
    if (direct) {
      img.src = direct;
      timer = setTimeout(function () {
        if (!(img.complete && img.naturalWidth > 0)) useFallback();
      }, COVER_WAIT);
    } else if (fallback) {
      img.src = fallback;
    } else {
      img.hidden = true;
    }
  }

  /* 三档评分徽章：没有的就写「暂无」，别空着让人以为坏了。
     大众评分只找得到 B 站一家时，按规矩写「来源太少」 */
  function scoresRow(s) {
    var wrap = document.createElement('div');
    wrap.className = 'fg-scores';
    var rows = [
      ['gu', '咕咪', s.scoreGu, ''],
      ['global', '大众', s.scoreGlobal, s.scoreFew ? '来源太少' : ''],
      ['bili', 'B站', s.scoreBili, ''],
    ];
    rows.forEach(function (r) {
      var span = document.createElement('span');
      var v = fmtScore(r[2]);
      span.className = 'fg-score fg-score--' + (v ? r[0] : 'none');
      span.setAttribute('data-score', r[0]);
      if (v) {
        span.appendChild(document.createTextNode(r[1] + ' '));
        var b = document.createElement('b');
        b.textContent = v;
        span.appendChild(b);
      } else {
        span.textContent = r[1] + ' ' + (r[3] || '暂无');
      }
      wrap.appendChild(span);
    });
    return wrap;
  }

  function card(item) {
    var el = document.createElement('article');
    el.className = 'fg-card';
    el.setAttribute('data-id', String(item.seasonId || ''));
    if (item.hall) {
      var flag = document.createElement('span');
      flag.className = 'fg-card__flag';
      flag.textContent = '豪番推荐';
      el.appendChild(flag);
    }
    var img = document.createElement('img');
    img.className = 'fg-card__cover';
    img.alt = item.title + ' 封面';
    setCover(img, item);
    el.appendChild(img);

    var body = document.createElement('div');
    body.className = 'fg-card__body';
    var h = document.createElement('h4');
    h.className = 'fg-card__title';
    h.textContent = item.title || '（没有名字）';
    body.appendChild(h);
    var sub = item.jpTitle || item.desc || '';
    if (sub) {
      var jp = document.createElement('p');
      jp.className = 'fg-card__jp';
      jp.textContent = sub;
      body.appendChild(jp);
    }
    body.appendChild(scoresRow(item));
    var tags = (item.styles || []).slice(0, 3);
    if (tags.length) {
      var box = document.createElement('div');
      box.className = 'fg-card__tags';
      tags.forEach(function (t) {
        var s = document.createElement('span');
        s.textContent = t;
        box.appendChild(s);
      });
      body.appendChild(box);
    }
    el.appendChild(body);
    el.addEventListener('click', function () { openSubject(item.seasonId, item.jpTitle); });
    return el;
  }

  function renderGrid(box, rows) {
    box.innerHTML = '';
    rows.forEach(function (r) { box.appendChild(card(r)); });
  }

  /* ---------------- 标签 ---------------- */
  function tagName(id) {
    var hit = (state.tags || []).filter(function (t) { return String(t.id) === String(id); })[0];
    return hit ? hit.name : '';
  }

  function renderTags() {
    if (!tagsEl) return;
    tagsEl.innerHTML = '';
    var tags = state.tags || [];
    if (!tags.length) { filterWrap.hidden = true; return; }
    filterWrap.hidden = false;
    function chip(id, name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'fg-tag' + (String(state.tag) === String(id) ? ' is-on' : '');
      b.textContent = name;
      b.addEventListener('click', function () {
        if (String(state.tag) === String(id) && state.mode === 'browse') return;
        state.tag = String(id);
        state.keyword = '';
        queryEl.value = '';
        loadBrowse(1);
      });
      tagsEl.appendChild(b);
    }
    chip('', '全部');
    tags.forEach(function (t) { chip(t.id, t.name); });
  }

  /* ---------------- 评分区间 ---------------- */
  /* 一行一档评分，分的是一段一段的分数：9.5 以上、9.0–9.5、8.5–9.0……
     高的在最左边（先看到的都是好番），往右划才看到低分区间。
     B 站评分最低也就 2 分出头，所以那几段不摆出来占地方。 */
  var SCORE_ROWS = [
    { key: 'bili', label: 'B 站评分', floor: 2 },
    { key: 'global', label: '大众评分', floor: 2 },
    { key: 'gu', label: '咕咪评分', floor: 1 },
  ];

  function scoreBands(floor) {
    var out = [{ min: 9.5, max: 10, text: '9.5 以上' }];
    for (var top = 9.5; top - 0.5 >= floor - 0.001; top -= 0.5) {
      var lo = Math.round((top - 0.5) * 10) / 10;
      out.push({ min: lo, max: top, text: fmtScore(lo) + '–' + fmtScore(top) });
    }
    return out;
  }

  function renderScoreFilters() {
    if (!scoreFiltersEl) return;
    scoreFiltersEl.innerHTML = '';
    SCORE_ROWS.forEach(function (row) {
      var line = document.createElement('div');
      line.className = 'fg-score-line';
      var lab = document.createElement('span');
      lab.className = 'fg-score-line__label';
      lab.textContent = row.label;
      line.appendChild(lab);
      /* 一行摆不下就往右划，别把屏幕堆满 */
      var box = document.createElement('div');
      box.className = 'fg-score-scroll';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', row.label + '分数段');
      scoreBands(row.floor).forEach(function (b) {
        var on = String(state.score) === row.key && Number(state.min) === b.min && Number(state.max) === b.max;
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'fg-tag fg-tag--score' + (on ? ' is-on' : '');
        el.setAttribute('data-score-key', row.key);
        el.setAttribute('data-min', String(b.min));
        el.textContent = b.text;
        el.addEventListener('click', function () {
          if (String(state.score) === row.key && Number(state.min) === b.min && Number(state.max) === b.max) {
            /* 再点一下就是取消这一段 */
            state.score = '';
            state.min = 0;
            state.max = 10;
          } else {
            state.score = row.key;
            state.min = b.min;
            state.max = b.max;
          }
          state.keyword = '';
          queryEl.value = '';
          loadBrowse(1);
        });
        box.appendChild(el);
      });
      line.appendChild(box);
      scoreFiltersEl.appendChild(line);
    });
    if (scoreWrap) scoreWrap.hidden = false;
  }

  function scoreLabel() {
    if (!state.score) return '';
    var row = SCORE_ROWS.filter(function (r) { return r.key === state.score; })[0];
    var name = row ? row.label : state.score;
    if (Number(state.max) >= 10) return name + ' ' + fmtScore(state.min) + ' 以上';
    return name + ' ' + fmtScore(state.min) + '–' + fmtScore(state.max);
  }

  /* ---------------- 列表与翻页 ---------------- */
  /* 卡片上的「大众」本来是空的：服务器把这一页算好后补上来。
     一页 20 部，服务器边算边记，翻过一次的番下次就现成了 */
  function fillScores() {
    var need = [];
    var byId = {};
    (state.results || []).forEach(function (r) {
      if (!r || !r.seasonId) return;
      byId[String(r.seasonId)] = r;
      if (r.scorePending) need.push(r);
    });
    if (!need.length) return;
    var groups = [];
    for (var i = 0; i < need.length; i += 20) groups.push(need.slice(i, i + 20));
    groups.forEach(function (g) {
      window.JHJX_API.fanguScores(g).then(function (res) {
        if (res.status !== 200 || !res.data || !res.data.scores) return;
        var got = res.data.scores;
        Object.keys(got).forEach(function (sid) {
          var row = got[sid];
          var item = byId[sid];
          if (!item || !row) return;
          item.scoreGlobal = row.global == null ? null : row.global;
          item.globalSources = row.sources || [];
          item.scoreFew = !!row.few;
          item.scoreGu = row.gu || 0;
          item.guCount = row.guCount || 0;
          /* 服务器这次也没个说法（取不到）→ 留着，下次渲染再要一次 */
          item.scorePending = !!row.pending;
          patchCard(sid, item);
        });
      }, function () { /* 补不上就算了，卡片上先写着「暂无」 */ });
    });
  }

  /* 只把这张卡片上的分数换掉，不重画整个列表（重画会把滚动位置也弄丢） */
  function patchCard(seasonId, item) {
    if (!listEl) return;
    var cards = listEl.querySelectorAll('.fg-card');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute('data-id') !== String(seasonId)) continue;
      try {
        var old = cards[i].querySelector('.fg-scores');
        if (old && old.parentNode === cards[i]) cards[i].replaceChild(scoresRow(item), old);
      } catch (e) { /* 列表刚好重画了就跳过：下次渲染自然会带上分数 */ }
      return;
    }
  }

  function renderList() {
    var rows = state.results || [];
    renderGrid(listEl, rows);
    emptyEl.hidden = rows.length > 0;
    if (!rows.length) {
      emptyEl.textContent = state.mode === 'search'
        ? '没搜到。换个写法试试，日文原名也行。'
        : '这一页没取到番，翻回去看看别页。';
    }
    fillScores();
  }

  /* 页码：两头固定，中间跟着当前页走；中间断档给个省略号，
     点省略号能多展开一些页；旁边还能直接写「跳到第几页」 */
  function pageNumbers(cur, pages, span) {
    var keep = [];
    var add = function (n) { if (n >= 1 && n <= pages && keep.indexOf(n) < 0) keep.push(n); };
    add(1);
    for (var i = cur - span; i <= cur + span; i++) add(i);
    add(pages);
    keep.sort(function (a, b) { return a - b; });
    var out = [];
    for (var k = 0; k < keep.length; k++) {
      if (k && keep[k] - keep[k - 1] > 1) out.push({ gap: true, from: keep[k - 1] + 1, to: keep[k] - 1 });
      out.push({ page: keep[k] });
    }
    return out;
  }

  function renderPager() {
    if (!pagerEl) return;
    var pages = Number(state.pages) || 1;
    pagerEl.innerHTML = '';
    if (state.mode === 'hall' || pages <= 1) { pagerEl.hidden = true; return; }
    pagerEl.hidden = false;
    function btn(label, page, cls, disabled) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'fg-page-btn' + (cls ? ' ' + cls : '');
      b.textContent = label;
      if (disabled) b.disabled = true;
      else b.addEventListener('click', function () { goPage(page); });
      pagerEl.appendChild(b);
    }
    btn('上一页', state.page - 1, 'fg-page-btn--nav', state.page <= 1);
    pageNumbers(state.page, pages, state.span).forEach(function (it) {
      if (it.gap) {
        var g = document.createElement('button');
        g.type = 'button';
        g.className = 'fg-page-btn fg-page-btn--gap';
        g.textContent = '…';
        g.setAttribute('aria-label', '展开更多页码');
        g.title = '这里还有 ' + (it.to - it.from + 1) + ' 页没摆出来（点一下多显示一些）';
        g.addEventListener('click', function () {
          state.span = Math.min(40, state.span + 10);
          renderPager();
        });
        pagerEl.appendChild(g);
        return;
      }
      btn(String(it.page), it.page, it.page === state.page ? 'is-on' : '', false);
    });
    btn('下一页', state.page + 1, 'fg-page-btn--nav', state.page >= pages);
    /* 想直接去哪一页就写数字 */
    var jump = document.createElement('span');
    jump.className = 'fg-jump';
    var lab = document.createElement('span');
    lab.className = 'fg-jump__label';
    lab.textContent = '跳到第';
    var inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'fg-jump__input';
    inp.id = 'fgJumpInput';
    inp.min = '1';
    inp.max = String(pages);
    inp.placeholder = String(state.page);
    inp.setAttribute('aria-label', '要跳到第几页');
    var unit = document.createElement('span');
    unit.className = 'fg-jump__label';
    unit.textContent = '页';
    var goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.className = 'fg-btn fg-btn--ghost fg-jump__go';
    goBtn.id = 'fgJumpGo';
    goBtn.textContent = '跳过去';
    function submitJump() {
      var n = Math.floor(Number(inp.value));
      if (!n || n < 1 || n > pages) {
        msg('页码写 ' + 1 + ' 到 ' + pages + ' 之间', true);
        inp.focus();
        return;
      }
      goPage(n);
    }
    goBtn.addEventListener('click', submitJump);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitJump(); } });
    jump.appendChild(lab);
    jump.appendChild(inp);
    jump.appendChild(unit);
    jump.appendChild(goBtn);
    pagerEl.appendChild(jump);
    var info = document.createElement('span');
    info.className = 'fg-page-info';
    info.textContent = '第 ' + state.page + ' / ' + pages + ' 页 · 共 ' + (state.total || 0) + ' 部';
    pagerEl.appendChild(info);
  }

  function renderCrumb() {
    if (!crumbEl) return;
    crumbEl.innerHTML = '';
    var parts = [];
    if (state.mode === 'search') {
      parts.push('搜「' + state.keyword + '」找到 ' + (state.total || 0) + ' 部');
    } else {
      if (state.tag) parts.push('标签「' + (tagName(state.tag) || state.tag) + '」');
      if (state.score) parts.push(scoreLabel());
      if (!parts.length) parts.push('全部番剧 · 按追番人数排');
      parts.push('共 ' + (state.total || 0) + ' 部');
    }
    var span = document.createElement('span');
    span.textContent = parts.join(' · ');
    crumbEl.appendChild(span);
    if (state.mode === 'search' || state.tag || state.score) {
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'fg-crumb__back';
      back.textContent = state.mode === 'search' ? '回到全部番剧' : '取消筛选';
      back.addEventListener('click', function () {
        state.tag = '';
        state.score = '';
        state.min = 0;
        state.max = 10;
        state.keyword = '';
        queryEl.value = '';
        loadBrowse(1);
      });
      crumbEl.appendChild(back);
    }
    crumbEl.hidden = false;
  }

  function goPage(p) {
    var pages = Number(state.pages) || 1;
    if (p < 1 || p > pages || p === state.page) return;
    if (state.mode === 'search') doSearch(state.keyword, p);
    else loadBrowse(p);
    try {
      var top = listEl.getBoundingClientRect().top + window.pageYOffset - 130;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } catch (e) { /* 老浏览器不支持平滑滚动就算了 */ }
  }

  /* 翻着看：一页 20 部，带标签 / 评分筛选
     手快连点几下时，只认最后一次（不然前面的请求还没回来，后面点的就没反应） */
  var queuedPage = null;
  function loadBrowse(page) {
    if (state.busy) { queuedPage = page || 1; return null; }
    state.busy = true;
    msg('正在翻…');
    function settled() {
      state.busy = false;
      if (queuedPage !== null) {
        var p = queuedPage;
        queuedPage = null;
        loadBrowse(p);
      }
    }
    var pending = window.JHJX_API.fanguBrowse(page || 1, state.tag, state.score, state.min, state.max).then(function (res) {
      if (res.status !== 200) {
        settled();
        msg((res.data && res.data.error) || '列表没取回来，过一会儿再试', true);
        return;
      }
      var d = res.data || {};
      state.mode = 'browse';
      state.page = Number(d.page) || 1;
      state.pages = Number(d.pages) || 1;
      state.total = Number(d.total) || 0;
      state.results = d.list || [];
      state.tag = String(d.tag || '');
      state.score = String(d.score || '');
      state.min = Number(d.min) || 0;
      state.max = d.max == null ? 10 : Number(d.max);
      state.scope = String(d.scope || 'all');
      state.pending = Number(d.pending) || 0;
      state.span = 2;      /* 换了一批番，页码重新收拢 */
      if (d.tags && d.tags.length) state.tags = d.tags;
      state.keyword = '';
      queryEl.value = '';
      /* 标签没取到时至少把当前这个显示出来，别让人以为自己点丢了 */
      if (state.tag && !tagName(state.tag)) state.tags = state.tags.concat([{ id: state.tag, name: '已选标签' }]);
      renderTags();
      renderScoreFilters();
      renderList();
      renderPager();
      renderCrumb();
      /* 咕咪评分只有咱们自己打过分（点开过）的番才有：这一份是从哪儿来的要说清楚。
         大众评分每部番都有，服务器边挑边算，没算完的会告诉我们还差几部 */
      if (libHint) {
        var lib = state.score === 'gu';
        var parts = [];
        if (lib) parts.push('咕咪评分只有本站点开过的番才有，所以这一份是从「本站看过的番」里挑的（一共 ' + state.total + ' 部）。');
        if (state.pending > 0) parts.push('这一档还有 ' + state.pending + ' 部的大众评分正在核对，翻下一页或者过会儿再看就会补齐。');
        libHint.hidden = !parts.length;
        libHint.textContent = parts.join(' ');
      }
      emptyEl.hidden = state.results.length > 0;
      if (!state.results.length) {
        emptyEl.textContent = lib
          ? '本站看过的番里，这一档还挑不出东西来。去「全部番剧」点开几部番，点开过的番就有咕咪评分了。'
          : '这一档没挑出番来，换个分数段试试。';
      }
      msg('');
      settled();
    }, function () {
      settled();
      msg('网络不太好，列表没取回来', true);
    });
    return pending;
  }

  function doSearch(q, page) {
    var kw = String(q == null ? queryEl.value : q).trim();
    if (!kw) { msg('想找什么番？写个名字', true); queryEl.focus(); return; }
    var p = Math.max(1, Math.floor(Number(page) || 1));
    state.keyword = kw;
    goBtn.disabled = true;
    msg('正在找…');
    window.JHJX_API.fanguSearch(kw, p).then(function (res) {
      goBtn.disabled = false;
      if (res.status !== 200) {
        msg((res.data && res.data.error) || '没搜出来，过一会儿再试', true);
        return;
      }
      var d = res.data || {};
      state.mode = 'search';
      state.page = Number(d.page) || 1;
      state.pages = Number(d.pages) || 1;
      state.total = Number(d.total) || 0;
      state.results = d.list || [];
      renderList();
      renderPager();
      renderCrumb();
      msg(state.results.length ? '' : '没找到这部番，换个写法试试（日文原名也行）');
    }, function () {
      goBtn.disabled = false;
      msg('网络不太好，没搜出来', true);
    });
  }

  /* 豪番推荐：点进这一栏才去拉榜 */
  function loadHall() {
    msg('');
    window.JHJX_API.fanguHome().then(function (res) {
      if (res.status !== 200) {
        msg((res.data && res.data.error) || '榜单没取回来', true);
        return;
      }
      state.need = Number(res.data.need) || 0;
      state.totalUsers = Number(res.data.totalUsers) || 0;
      var rec = res.data.recommend || [];
      renderGrid(hallEl, rec);
      hallEmpty.hidden = rec.length > 0;
      hallHint.textContent = '';
      hallHint.hidden = true;
    }, function () { msg('网络不太好，榜单没取回来', true); });
  }

  function setTab(hall) {
    tabAll.className = 'fg-tab' + (hall ? '' : ' is-on');
    tabAll.setAttribute('aria-selected', hall ? 'false' : 'true');
    tabHall.className = 'fg-tab' + (hall ? ' is-on' : '');
    tabHall.setAttribute('aria-selected', hall ? 'true' : 'false');
    allPane.hidden = hall;
    hallPane.hidden = !hall;
    if (hall) {
      state.mode = 'hall';
      renderPager();
      loadHall();
      return null;
    }
    state.mode = state.keyword ? 'search' : 'browse';
    return loadBrowse(state.page || 1);
  }

  /* ---------------- 详情抽屉 ---------------- */
  function closeSheet() {
    sheet.hidden = true;
    sheetBox.innerHTML = '';
    state.open = null;
    document.body.style.overflow = '';
    if (state.lastFocus && state.lastFocus.focus) { try { state.lastFocus.focus(); } catch (e) { /* 忽略 */ } }
  }

  /* 详情里的标签点了就去看这一类：标签表里有它就按标签翻，没有就按名字搜 */
  function goTag(name) {
    var hit = (state.tags || []).filter(function (t) { return String(t.name) === String(name); })[0];
    closeSheet();
    /* 先把筛选条件摆好，再切回「全部番剧」——
       不然切栏目时先拉一次、设完条件又拉一次，第二次会被「正在忙」挡掉，标签就没生效 */
    state.score = '';
    state.min = 0;
    state.max = 10;
    state.keyword = '';
    if (hit) {
      state.tag = String(hit.id);
      queryEl.value = '';
      setTab(false);
      return;
    }
    state.tag = '';
    var pend = setTab(false);
    if (pend && pend.then) pend.then(function () { queryEl.value = name; doSearch(name, 1); });
  }

  function tagChips(sub) {
    var wrap = document.createElement('div');
    wrap.className = 'fg-tags';
    (sub.styles || []).forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'fg-tag';
      b.textContent = t;
      b.addEventListener('click', function () { goTag(t); });
      wrap.appendChild(b);
    });
    return wrap;
  }

  /* 后端没凑到大众评分时，当场用浏览器查一次 AniList——
     它允许跨域，而且走的是用户自己的网络，国内一般能通。 */
  function fetchGlobalFromBrowser(sub) {
    var titles = [sub.jpTitle, sub.title].filter(Boolean);
    if (!titles.length) return;
    var q = 'query ($s: String) { Media(search: $s, type: ANIME) { averageScore isAdult title { native romaji } } }';
    var norm = function (s) {
      return String(s || '').toLowerCase().replace(/[\s:：·!！?？~～\-—'"”“「」『』（）()【】\[\]]/g, '');
    };
    function tryOne(i) {
      if (i >= titles.length) return;
      var t = titles[i];
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 7000);
      fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: q, variables: { s: t } }),
        signal: ctrl ? ctrl.signal : undefined,
      }).then(function (r) { return r.json(); }).then(function (data) {
        clearTimeout(timer);
        var m = data && data.data && data.data.Media;
        if (!m || m.isAdult || !m.averageScore) { tryOne(i + 1); return; }
        var names = [m.title && m.title.native, m.title && m.title.romaji].map(norm).filter(Boolean);
        var want = norm(t);
        var hit = names.some(function (n) { return n && (n === want || n.indexOf(want) >= 0 || want.indexOf(n) >= 0); });
        if (!hit) { tryOne(i + 1); return; }
        var score = Math.round(m.averageScore / 10 * 10) / 10;
        var cell = document.querySelector('#fgSheetBox .fg-score-big > div[data-big="global"]');
        if (cell) {
          cell.querySelector('b').textContent = fmtScore(score);
          cell.querySelector('span').textContent = '大众评分 · 本机现查的 AniList';
          cell.className = 'is-live';
        }
      }).catch(function () { clearTimeout(timer); tryOne(i + 1); });
    }
    tryOne(0);
  }

  /* 「大众评分是哪几个平台平均出来的」写清楚，别让人以为是瞎编的 */
  function globalNote(sub) {
    var src = Array.isArray(sub.globalSources) ? sub.globalSources : [];
    if (sub.scoreFew) return '评分来源太少，暂无';
    if (src.length) return src.map(function (s) { return s.name + ' ' + fmtScore(s.score); }).join(' · ');
    return '几个平台加 B 站的平均分';
  }

  function renderDetail(sub, reviews) {
    sheetBox.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'fg-detail__head';
    var img = document.createElement('img');
    img.className = 'fg-detail__cover';
    img.alt = sub.title + ' 封面';
    setCover(img, sub);
    head.appendChild(img);

    var meta = document.createElement('div');
    meta.className = 'fg-detail__meta';
    var h = document.createElement('h3');
    h.className = 'fg-detail__title';
    h.textContent = sub.title || '（没有名字）';
    meta.appendChild(h);
    if (sub.jpTitle) {
      var jp = document.createElement('p');
      jp.className = 'fg-detail__jp';
      jp.textContent = sub.jpTitle;
      meta.appendChild(jp);
    }
    var line = document.createElement('p');
    line.className = 'fg-detail__line';
    line.textContent = [sub.area, sub.eps, sub.publish, sub.status].filter(Boolean).join(' · ');
    meta.appendChild(line);
    var rec = document.createElement('p');
    rec.className = 'fg-detail__line';
    rec.id = 'fgDetailRec';
    meta.appendChild(rec);
    if ((sub.styles || []).length) meta.appendChild(tagChips(sub));
    head.appendChild(meta);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'fg-detail__close';
    close.setAttribute('aria-label', '关闭');
    close.textContent = '×';
    close.addEventListener('click', closeSheet);
    head.appendChild(close);
    sheetBox.appendChild(head);

    /* 三个评分 */
    var secScore = document.createElement('div');
    secScore.className = 'fg-sec';
    var l1 = document.createElement('div');
    l1.className = 'fg-sec__label';
    l1.textContent = '三个评分（都是 10 分制）';
    secScore.appendChild(l1);
    var big = document.createElement('div');
    big.className = 'fg-score-big';
    [
      ['咕咪评分', sub.scoreGu, (sub.guCount || 0) + ' 人打过', 'gu', '暂无'],
      ['大众评分', sub.scoreGlobal, globalNote(sub), 'global', sub.scoreFew ? '来源太少' : '暂无'],
      ['B 站评分', sub.scoreBili, sub.scoreBiliCount ? sub.scoreBiliCount + ' 人打过' : 'B 站评分', 'bili', '暂无'],
    ].forEach(function (r) {
      var d = document.createElement('div');
      d.setAttribute('data-big', r[3]);
      var b = document.createElement('b');
      b.textContent = fmtScore(r[1]) || r[4] || '暂无';
      d.appendChild(b);
      var s = document.createElement('span');
      s.textContent = r[0] + ' · ' + r[2];
      d.appendChild(s);
      big.appendChild(d);
    });
    secScore.appendChild(big);
    sheetBox.appendChild(secScore);

    /* 简介 */
    if (sub.summary) {
      var secSum = document.createElement('div');
      secSum.className = 'fg-sec';
      var l2 = document.createElement('div');
      l2.className = 'fg-sec__label';
      l2.textContent = '简介';
      secSum.appendChild(l2);
      var p = document.createElement('p');
      p.className = 'fg-detail__summary';
      p.textContent = sub.summary;
      secSum.appendChild(p);
      sheetBox.appendChild(secSum);
    }

    /* 我的评分 + 评价（没登录的人看不到这块，换成一句登录提示） */
    var canAct = (sub.loggedIn === undefined) ? loggedIn() : !!sub.loggedIn;
    if (!canAct) {
      var secGuest = document.createElement('div');
      secGuest.className = 'fg-sec';
      var lg = document.createElement('div');
      lg.className = 'fg-sec__label';
      lg.textContent = '打分 · 写评价 · 推荐';
      secGuest.appendChild(lg);
      var tip = document.createElement('p');
      tip.className = 'fg-detail__line';
      tip.id = 'fgGuestTip';
      tip.textContent = '这三件事要先登录，登录之后你给的分和推荐都记在你名下。别的都能看，不用登录。';
      secGuest.appendChild(tip);
      var go = document.createElement('a');
      go.className = 'fg-btn fg-btn--main';
      go.id = 'fgGuestLogin';
      go.href = 'account.html';
      go.textContent = '去登录';
      secGuest.appendChild(go);
      sheetBox.appendChild(secGuest);
    } else {
    var secMine = document.createElement('div');
    secMine.className = 'fg-sec';
    var l3 = document.createElement('div');
    l3.className = 'fg-sec__label';
    l3.textContent = sub.myScore ? '我的评分：' + fmtScore(sub.myScore) + ' 分（改一下也行）' : '给它打个分（1 ~ 10）';
    secMine.appendChild(l3);
    var pick = document.createElement('div');
    pick.className = 'fg-pick';
    pick.id = 'fgPick';
    var chosen = Number(sub.myScore) || 0;
    for (var i = 1; i <= 10; i++) {
      (function (n) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = String(n);
        b.setAttribute('data-score', String(n));
        if (n === Math.round(chosen)) b.className = 'is-on';
        b.addEventListener('click', function () {
          chosen = n;
          var all = pick.querySelectorAll('button');
          for (var k = 0; k < all.length; k++) all[k].className = (Number(all[k].getAttribute('data-score')) === n) ? 'is-on' : '';
        });
        pick.appendChild(b);
      })(i);
    }
    secMine.appendChild(pick);

    var ta = document.createElement('textarea');
    ta.className = 'fg-textarea';
    ta.id = 'fgText';
    ta.maxLength = 500;
    ta.placeholder = '说两句：哪里好看、哪里劝退（最多 500 字，不写也行）';
    ta.value = sub.myText || '';
    secMine.appendChild(ta);

    var acts = document.createElement('div');
    acts.className = 'fg-acts';
    var save = document.createElement('button');
    save.type = 'button';
    save.className = 'fg-btn fg-btn--main';
    save.id = 'fgSaveRate';
    save.textContent = sub.myScore ? '改一下' : '提交评分';
    save.addEventListener('click', function () {
      if (!chosen) { msg('先点一个 1 ~ 10 的分数', true); return; }
      save.disabled = true;
      window.JHJX_API.fanguRate(sub.seasonId, chosen, ta.value).then(function (res) {
        save.disabled = false;
        if (res.status !== 200) { msg((res.data && res.data.error) || '没提交上，再试一次', true); return; }
        msg('评好了：' + fmtScore(res.data.guAvg) + ' 分（' + res.data.guCount + ' 人打过）');
        openSubject(sub.seasonId, sub.jpTitle);   /* 重新拉一次，评价列表和平均分都刷新 */
      }, function () { save.disabled = false; msg('网络不太好，没提交上', true); });
    });
    acts.appendChild(save);

    /* 推荐 */
    var recWrap = document.createElement('span');
    recWrap.className = 'fg-rec' + (sub.myRec ? ' is-on' : '');
    recWrap.id = 'fgRecWrap';
    var recBtn = document.createElement('button');
    recBtn.type = 'button';
    recBtn.className = 'fg-btn fg-btn--ghost';
    recBtn.id = 'fgRecBtn';
    recBtn.textContent = sub.myRec ? '已推荐（点一下取消）' : '推荐这部番';
    recBtn.addEventListener('click', function () {
      recBtn.disabled = true;
      window.JHJX_API.fanguRecommend(sub.seasonId).then(function (res) {
        recBtn.disabled = false;
        if (res.status !== 200) { msg((res.data && res.data.error) || '没点上，再试一次', true); return; }
        var d = res.data;
        recBtn.textContent = d.on ? '已推荐（点一下取消）' : '推荐这部番';
        recWrap.className = 'fg-rec' + (d.on ? ' is-on' : '');
        updateRecLine(d.recCount, d.hall);
        msg(d.on ? (d.hall ? '推荐成功，已经进「豪番推荐」了' : '推荐成功') : '取消推荐了');
      }, function () { recBtn.disabled = false; msg('网络不太好，没点上', true); });
    });
    recWrap.appendChild(recBtn);
    acts.appendChild(recWrap);

    if (sub.link && sub.linkOk !== false) {
      var out = document.createElement('a');
      out.className = 'fg-btn fg-btn--ghost';
      out.id = 'fgBiliLink';
      out.href = sub.link;
      out.target = '_blank';
      out.rel = 'noopener noreferrer';
      out.textContent = '去 B 站看';
      acts.appendChild(out);
    } else {
      /* B 站那边没有（或者已经下架）：不给外链，点了就说清，别让人白跳一趟 */
      var off = document.createElement('button');
      off.type = 'button';
      off.className = 'fg-btn fg-btn--ghost is-off';
      off.id = 'fgNoLink';
      off.textContent = 'B 站上没有这部番';
      off.addEventListener('click', function () {
        msg('这部番 B 站那边没有（或者已经下架了），点过去也只会被兜回首页，先在这儿看看评价吧。', true);
      });
      acts.appendChild(off);
    }
    secMine.appendChild(acts);
    sheetBox.appendChild(secMine);
    }

    /* 大家的评价 */
    var secRev = document.createElement('div');
    secRev.className = 'fg-sec';
    var l4 = document.createElement('div');
    l4.className = 'fg-sec__label';
    l4.textContent = reviews.length ? '大家的评价（' + reviews.length + ' 条）' : '大家的评价';
    secRev.appendChild(l4);
    if (!reviews.length) {
      var none = document.createElement('p');
      none.className = 'fg-detail__line';
      none.textContent = '还没有人写评价，你来做第一个。';
      secRev.appendChild(none);
    }
    reviews.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'fg-review';
      var sc = document.createElement('div');
      sc.className = 'fg-review__score';
      sc.textContent = fmtScore(r.score) || '—';
      row.appendChild(sc);
      var body = document.createElement('div');
      body.style.minWidth = '0';
      var who = document.createElement('div');
      who.className = 'fg-review__who';
      who.textContent = r.name + (r.mine ? '（我）' : '');
      var when = document.createElement('span');
      when.className = 'fg-review__when';
      when.textContent = ' ' + fmtTime(r.at);
      who.appendChild(when);
      body.appendChild(who);
      if (r.text) {
        var t = document.createElement('p');
        t.className = 'fg-review__text';
        t.textContent = r.text;
        body.appendChild(t);
      }
      row.appendChild(body);
      secRev.appendChild(row);
    });
    sheetBox.appendChild(secRev);

    updateRecLine(sub.recCount, sub.hall);
    /* 后端没拿到大众评分时，当场用浏览器查一次 */
    if (sub.scoreGlobal == null) fetchGlobalFromBrowser(sub);
  }

  function updateRecLine(count, hall) {
    var el = $('fgDetailRec');
    if (!el) return;
    var n = Number(count) || 0;
    var parts = ['已经有 ' + n + ' 人推荐'];
    if (hall) parts.push('已经在「豪番推荐」里了');
    el.textContent = parts.join(' · ');
  }

  function openSubject(seasonId, jpTitle) {
    if (!seasonId) return;
    state.lastFocus = document.activeElement;
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    sheetBox.innerHTML = '';
    var loading = document.createElement('p');
    loading.className = 'fg-detail__line';
    loading.id = 'fgLoading';
    loading.textContent = '正在取这部番的信息…';
    sheetBox.appendChild(loading);
    /* 把列表里的日文原名带过去：大众评分按原名才找得准（B 站详情里有时没有原名） */
    window.JHJX_API.fanguSubject(seasonId, jpTitle).then(function (res) {
      if (res.status !== 200) {
        sheetBox.innerHTML = '';
        var err = document.createElement('p');
        err.className = 'fg-detail__line';
        err.textContent = (res.data && res.data.error) || '这部番的信息取不到，过一会儿再试';
        sheetBox.appendChild(err);
        var c = document.createElement('button');
        c.type = 'button';
        c.className = 'fg-btn fg-btn--ghost';
        c.style.marginTop = '12px';
        c.textContent = '关闭';
        c.addEventListener('click', closeSheet);
        sheetBox.appendChild(c);
        return;
      }
      state.open = res.data.subject;
      renderDetail(res.data.subject, res.data.reviews || []);
      sheetBox.scrollTop = 0;
    }, function () {
      sheetBox.innerHTML = '';
      var err = document.createElement('p');
      err.className = 'fg-detail__line';
      err.textContent = '网络不太好，没取到这部番';
      sheetBox.appendChild(err);
    });
  }

  /* ---------------- 起来 ---------------- */
  goBtn.addEventListener('click', function () { doSearch(null, 1); });
  queryEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(null, 1); }
  });
  if (tabAll) tabAll.addEventListener('click', function () { if (state.mode !== 'hall') return; setTab(false); });
  if (tabHall) tabHall.addEventListener('click', function () { if (state.mode === 'hall') return; setTab(true); });
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
  window.addEventListener('jhjx:session', function () { location.reload(); });

  if (!loggedIn()) {
    /* 没登录：照样能用，只在上面挂一条「要打分/写评价/推荐就登录」 */
    guestEl.hidden = false;
    mainEl.hidden = false;
  } else {
    guestEl.hidden = true;
    mainEl.hidden = false;
  }
  setTab(false);
})();
