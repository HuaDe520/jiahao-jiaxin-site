/* =========================================================
   嘉番 · 番咕咪
   ---------------------------------------------------------
   搜番 → 点开看简介 / 类型 / 三个评分 → 打分写评价 → 推荐。
   · 番剧信息是后端从 B 站取的（不是我们编的），封面走后端转发；
   · 咕咪评分 = 自己人打分的平均分；大众评分 = AniList；B 站评分 = 哔哩哔哩；
   · 推荐够多（超过协会用户数一半）或管理员推荐过 → 进「豪番推荐」。
   ========================================================= */
(function () {
  function $(id) { return document.getElementById(id); }

  var guestEl = $('fgGuest');
  var mainEl = $('fgMain');
  var hallWrap = $('fgHallWrap');
  var hallEl = $('fgHall');
  var hallHint = $('fgHallHint');
  var hotWrap = $('fgHotWrap');
  var hotEl = $('fgHot');
  var listEl = $('fgList');
  var emptyEl = $('fgEmpty');
  var msgEl = $('fgMsg');
  var queryEl = $('fgQuery');
  var goBtn = $('fgGo');
  var moreWrap = $('fgMoreWrap');
  var moreBtn = $('fgMore');
  var filterWrap = $('fgFilterWrap');
  var tagsEl = $('fgTags');
  var sheet = $('fgSheet');
  var sheetBox = $('fgSheetBox');

  var state = {
    keyword: '',
    results: [],       /* 搜回来的（或热门）番剧 */
    tag: '',           /* 当前按标签筛的那个标签 */
    need: 0,
    totalUsers: 0,
    open: null,        /* 当前打开的番 */
    lastFocus: null,
  };
  var msgTimer = 0;

  function msg(text, isError) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.className = 'fg-msg' + (text ? ' is-show' : '') + (isError ? ' is-error' : '');
    if (msgTimer) clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(function () { msgEl.className = 'fg-msg'; }, 7000);
  }

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

  /* 三档评分徽章：没有的就写「暂无」，别空着让人以为坏了 */
  function scoresRow(s, small) {
    var wrap = document.createElement('div');
    wrap.className = 'fg-scores';
    var rows = [
      ['gu', '咕咪', s.scoreGu],
      ['global', '大众', s.scoreGlobal],
      ['bili', 'B站', s.scoreBili],
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
        span.textContent = r[1] + ' 暂无';
      }
      wrap.appendChild(span);
    });
    void small;
    return wrap;
  }

  function card(item) {
    var el = document.createElement('article');
    el.className = 'fg-card';
    el.setAttribute('data-id', String(item.seasonId || ''));
    if (item.hall) {
      var flag = document.createElement('span');
      flag.className = 'fg-card__flag';
      flag.textContent = item.adminRec ? '管理员推荐' : '豪番推荐';
      el.appendChild(flag);
    }
    var img = document.createElement('img');
    img.className = 'fg-card__cover';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = item.title + ' 封面';
    if (item.cover) img.src = item.cover;
    el.appendChild(img);

    var body = document.createElement('div');
    body.className = 'fg-card__body';
    var h = document.createElement('h4');
    h.className = 'fg-card__title';
    h.textContent = item.title || '（没有名字）';
    body.appendChild(h);
    if (item.jpTitle) {
      var jp = document.createElement('p');
      jp.className = 'fg-card__jp';
      jp.textContent = item.jpTitle;
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

  /* 按标签筛：标签来自当前这批结果，选一个就把不含它的收起来 */
  function renderTags() {
    var seen = {};
    var order = [];
    state.results.forEach(function (r) {
      (r.styles || []).forEach(function (t) {
        var k = String(t);
        if (!k || seen[k]) return;
        seen[k] = true;
        order.push(k);
      });
    });
    tagsEl.innerHTML = '';
    if (!order.length) { filterWrap.hidden = true; return; }
    filterWrap.hidden = false;
    order.slice(0, 24).forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'fg-tag' + (state.tag === t ? ' is-on' : '');
      b.textContent = t;
      b.addEventListener('click', function () {
        state.tag = state.tag === t ? '' : t;
        renderTags();
        renderList();
      });
      tagsEl.appendChild(b);
    });
  }

  function shownRows() {
    if (!state.tag) return state.results;
    return state.results.filter(function (r) {
      return (r.styles || []).some(function (t) { return String(t) === state.tag; });
    });
  }

  function renderList() {
    var rows = shownRows();
    renderGrid(listEl, rows);
    emptyEl.hidden = rows.length > 0;
    if (!rows.length) {
      emptyEl.textContent = state.tag
        ? '这批结果里没有「' + state.tag + '」标签的番，换个标签或者再搜搜。'
        : '还没有结果。上面搜一个番名试试，比如「孤独摇滚」。';
    }
  }

  function loadHome() {
    return window.JHJX_API.fanguHome().then(function (res) {
      if (res.status !== 200) {
        msg((res.data && res.data.error) || '榜单没取回来', true);
        return;
      }
      state.need = Number(res.data.need) || 0;
      state.totalUsers = Number(res.data.totalUsers) || 0;
      var rec = res.data.recommend || [];
      if (rec.length) {
        hallWrap.hidden = false;
        renderGrid(hallEl, rec);
        hallHint.textContent = rec.some(function (r) { return r.adminRec; })
          ? '管理员推荐过的番会直接放上来；大家推荐够多（超过协会用户数的一半，现在 ' + state.need + ' 票）也会进这里。'
          : '大家推荐够了就上来：现在协会 ' + state.totalUsers + ' 人，超过一半（' + state.need + ' 票）进榜。';
      } else {
        hallWrap.hidden = true;
        hallHint.textContent = '';
      }
      var hot = res.data.hot || [];
      if (hot.length) {
        hotWrap.hidden = false;
        renderGrid(hotEl, hot);
      } else {
        hotWrap.hidden = true;
      }
    }, function () { msg('网络不太好，榜单没取回来', true); });
  }

  function doSearch(q) {
    var kw = String(q == null ? queryEl.value : q).trim();
    if (!kw) { msg('想找什么番？写个名字', true); queryEl.focus(); return; }
    state.keyword = kw;
    goBtn.disabled = true;
    msg('正在找…');
    window.JHJX_API.fanguSearch(kw).then(function (res) {
      goBtn.disabled = false;
      if (res.status !== 200) {
        msg((res.data && res.data.error) || '没搜出来，过一会儿再试', true);
        return;
      }
      state.results = res.data.list || [];
      state.tag = '';
      state.need = Number(res.data.need) || state.need;
      renderTags();
      renderList();
      moreWrap.hidden = true;      /* 搜索接口一次给全，就不做翻页了 */
      msg(state.results.length ? '找到 ' + state.results.length + ' 部番' : '没找到这部番，换个写法试试（日文原名也行）');
    }, function () {
      goBtn.disabled = false;
      msg('网络不太好，没搜出来', true);
    });
  }

  /* ---------------- 详情抽屉 ---------------- */
  function closeSheet() {
    sheet.hidden = true;
    sheetBox.innerHTML = '';
    state.open = null;
    document.body.style.overflow = '';
    if (state.lastFocus && state.lastFocus.focus) { try { state.lastFocus.focus(); } catch (e) { /* 忽略 */ } }
  }

  function tagChips(sub) {
    var wrap = document.createElement('div');
    wrap.className = 'fg-tags';
    (sub.styles || []).forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'fg-tag';
      b.textContent = t;
      b.addEventListener('click', function () {
        closeSheet();
        queryEl.value = t;
        /* 标签没法当关键词搜（B 站只按名字搜），那就把当前结果按它筛 */
        if (state.results.some(function (r) { return (r.styles || []).indexOf(t) >= 0; })) {
          state.tag = t;
          renderTags();
          renderList();
          msg('已经按「' + t + '」把当前这批结果筛出来了');
          window.scrollTo({ top: listEl.offsetTop - 120, behavior: 'smooth' });
        } else {
          doSearch(t);
        }
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  /* 大众评分：优先用后端缓存里的（服务器查一次大家都能用）。
     后端查不到（比如机房出口被 AniList 拦了）就当场从浏览器查一次——
     AniList 的接口允许跨域，而且走的是用户自己的网络，国内一般能通。 */
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
        var m = data && data.data && data.Media;
        if (!m || m.isAdult || !m.averageScore) { tryOne(i + 1); return; }
        var names = [m.title && m.title.native, m.title && m.title.romaji].map(norm).filter(Boolean);
        var want = norm(t);
        var hit = names.some(function (n) { return n && (n === want || n.indexOf(want) >= 0 || want.indexOf(n) >= 0); });
        if (!hit) { tryOne(i + 1); return; }
        var score = Math.round(m.averageScore / 10 * 10) / 10;
        var cell = document.querySelector('#fgSheetBox .fg-score-big > div[data-big="global"]');
        if (cell) {
          cell.querySelector('b').textContent = fmtScore(score);
          cell.querySelector('span').textContent = '大众评分 · 来自 AniList（本机实时查的）';
          cell.className = 'is-live';
        }
      }).catch(function () { clearTimeout(timer); tryOne(i + 1); });
    }
    tryOne(0);
  }

  function renderDetail(sub, reviews) {
    sheetBox.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'fg-detail__head';
    var img = document.createElement('img');
    img.className = 'fg-detail__cover';
    img.alt = sub.title + ' 封面';
    if (sub.cover) img.src = sub.cover;
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
      ['咕咪评分', sub.scoreGu, (sub.guCount || 0) + ' 人打过', 'gu'],
      ['大众评分', sub.scoreGlobal, sub.scoreGlobalSrc === 'anilist' ? '来自 AniList' : '网上的一般评分', 'global'],
      ['B 站评分', sub.scoreBili, sub.scoreBiliCount ? sub.scoreBiliCount + ' 人打过' : 'B 站评分', 'bili'],
    ].forEach(function (r) {
      var d = document.createElement('div');
      d.setAttribute('data-big', r[3]);
      var b = document.createElement('b');
      b.textContent = fmtScore(r[1]) || '暂无';
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

    /* 我的评分 + 评价 */
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
        updateRecLine(d.recCount, d.need, d.hall, sub.adminRec);
        msg(d.on
          ? (d.hall ? '推荐成功，已经进「豪番推荐」了' : '推荐成功：现在 ' + d.recCount + ' 票，够 ' + d.need + ' 票就进豪番推荐')
          : '取消推荐了');
      }, function () { recBtn.disabled = false; msg('网络不太好，没点上', true); });
    });
    recWrap.appendChild(recBtn);
    acts.appendChild(recWrap);

    if (sub.link) {
      var out = document.createElement('a');
      out.className = 'fg-btn fg-btn--ghost';
      out.href = sub.link;
      out.target = '_blank';
      out.rel = 'noopener noreferrer';
      out.textContent = '去 B 站看';
      acts.appendChild(out);
    }
    secMine.appendChild(acts);
    sheetBox.appendChild(secMine);

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

    updateRecLine(sub.recCount, sub.needRecs, sub.hall, sub.adminRec);
    /* 后端没拿到大众评分时，当场用浏览器查一次 */
    if (sub.scoreGlobal == null) fetchGlobalFromBrowser(sub);
  }

  function updateRecLine(count, need, hall, adminRec) {
    var el = $('fgDetailRec');
    if (!el) return;
    var n = Number(count) || 0;
    var parts = ['已经有 ' + n + ' 人推荐'];
    if (need) parts.push('够 ' + need + ' 票进「豪番推荐」');
    if (adminRec) parts.push('管理员推荐过，已经上榜');
    else if (hall) parts.push('已经进「豪番推荐」了');
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
    /* 把搜索结果里的日文原名带过去：大众评分按原名才找得准（B 站详情里有时没有原名） */
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
  goBtn.addEventListener('click', function () { doSearch(); });
  queryEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
  });
  if (moreBtn) moreBtn.addEventListener('click', function () { msg('这个数据源一次就把结果给全了，换个关键词试试'); });
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
  window.addEventListener('jhjx:session', function () { location.reload(); });

  if (!loggedIn()) {
    guestEl.hidden = false;
    mainEl.hidden = true;
  } else {
    guestEl.hidden = true;
    mainEl.hidden = false;
    loadHome();
  }
})();
