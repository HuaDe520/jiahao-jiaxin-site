/* =========================================================
   嘉学 · 千词奇域
   ---------------------------------------------------------
   一个词库 = 一堆 [单词, 音标, 释义]，按词库分别记进度（存在本机浏览器）。

   记忆调度（两张牌堆一起用）：
     · 长牌堆：把整个词库按权重洗一遍，权重看这个词最近答得怎么样 ——
       不认识 8、错误 5、模糊 3、没见过的 2.5、已经答对的 0.25。
       所以答对过的词还会出现，但频率很低很低；错的越多出现越勤。
     · 短队列：刚答错/模糊/不认识的词，插到后面第几张再出现一次
       （不认识隔 3~5 张，错误 5~8 张，模糊 8~12 张）。
   状态：每个词记 { s: 最近一次结果, r: 答对次数, w: 答错次数, n: 总次数, t: 时间 }。
     · 待豪本 = w > 0（答错、模糊、不认识过的）
     · 豪到了 = r > 0（答对过的）
   两个本子都按词库分开。
   ========================================================= */
(function () {
  'use strict';

  var STATE_KEY = 'jhjx-qianci-v1';
  var BANKS = (window.JHJX_WORD_BANKS || []).slice();
  var DECK_WEIGHT = { unknown: 8, wrong: 5, fuzzy: 3, seen: 2.5, known: 0.25 };
  var REINJECT = { unknown: [3, 5], wrong: [5, 8], fuzzy: [8, 12] };
  var RECENT_GUARD = 5;         /* 最近看过的几张不重复出现 */
  var OPTION_COUNT = 4;

  /* ---------- DOM ---------- */
  var homeEl = document.getElementById('qcHome');
  var banksEl = document.getElementById('qcBanks');
  var homeTip = document.getElementById('qcHomeTip');
  var studyEl = document.getElementById('qcStudy');
  var booksEl = document.getElementById('qcBooks');
  var bankNameEl = document.getElementById('qcBankName');
  var progressEl = document.getElementById('qcProgress');
  var wordEl = document.getElementById('qcWord');
  var phoneticEl = document.getElementById('qcPhonetic');
  var optsEl = document.getElementById('qcOpts');
  var fuzzyBtn = document.getElementById('qcFuzzy');
  var unknownBtn = document.getElementById('qcUnknown');
  var feedbackEl = document.getElementById('qcFeedback');
  var fbTitleEl = document.getElementById('qcFbTitle');
  var fbTextEl = document.getElementById('qcFbText');
  var nextBtn = document.getElementById('qcNext');
  var speakBtn = document.getElementById('qcSpeak');
  var backBtn = document.getElementById('qcBack');
  var booksBtn = document.getElementById('qcBooksBtn');
  var booksBackBtn = document.getElementById('qcBooksBack');
  var booksBankEl = document.getElementById('qcBooksBank');
  var booksCountEl = document.getElementById('qcBooksCount');
  var bookTabsEl = document.getElementById('qcBookTabs');
  var filterEl = document.getElementById('qcFilter');
  var booksHintEl = document.getElementById('qcBooksHint');
  var listEl = document.getElementById('qcList');
  if (!homeEl || !studyEl || !booksEl || !banksEl) return;

  /* ---------- 本机进度 ---------- */
  function emptyStore() { return { v: 1, banks: {}, lastBank: '' }; }
  function loadStore() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.v === 1 && s.banks && typeof s.banks === 'object') return s;
      }
    } catch (e) { /* 忽略 */ }
    return emptyStore();
  }
  function saveStore() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(store)); } catch (e) { /* 忽略 */ }
  }
  var store = loadStore();

  function bankState(id) {
    if (!store.banks[id] || typeof store.banks[id] !== 'object') store.banks[id] = { words: {}, answered: 0 };
    if (!store.banks[id].words) store.banks[id].words = {};
    return store.banks[id];
  }
  function wordRow(id, key) { return bankState(id).words[key] || null; }
  function countState(id, fn) {
    var words = bankState(id).words;
    var n = 0;
    for (var k in words) { if (Object.prototype.hasOwnProperty.call(words, k) && fn(words[k])) n++; }
    return n;
  }
  function todoCount(id) { return countState(id, function (r) { return r && r.w > 0; }); }
  function knownCount(id) { return countState(id, function (r) { return r && r.r > 0; }); }
  function learnedCount(id) { return countState(id, function () { return true; }); }

  /* ---------- 朗读 ---------- */
  var canSpeak = !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  function speak(text) {
    if (!canSpeak || !text) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text));
      u.lang = 'en-US';
      u.rate = 0.92;
      window.speechSynthesis.speak(u);
    } catch (e) { /* 忽略 */ }
  }
  if (!canSpeak && speakBtn) speakBtn.hidden = true;

  /* ---------- 牌堆 ---------- */
  var bank = null;              /* { id, name, file, global, words } */
  var bankId = '';
  var deck = [];                /* 长牌堆：索引数组 */
  var deckPos = 0;
  var shortQueue = [];          /* [{ i, at }] */
  var recent = [];              /* 最近出过的索引 */
  var current = null;
  var sessionCount = 0;
  var view = 'home';

  function weightOf(i) {
    var row = wordRow(bankId, bank.words[i][0].toLowerCase());
    if (!row) return DECK_WEIGHT.seen;
    if (row.s === 'known') return DECK_WEIGHT.known;
    if (row.s === 'unknown') return DECK_WEIGHT.unknown;
    if (row.s === 'wrong') return DECK_WEIGHT.wrong;
    if (row.s === 'fuzzy') return DECK_WEIGHT.fuzzy;
    return DECK_WEIGHT.seen;
  }

  /* 加权随机洗牌：给每个词一个 -ln(U)/w 的键，排序即可 */
  function rebuildDeck() {
    var n = bank.words.length;
    var arr = new Array(n);
    for (var i = 0; i < n; i++) {
      var w = weightOf(i);
      if (!(w > 0)) w = 0.05;
      arr[i] = { i: i, k: -Math.log(Math.random() || 1e-9) / w };
    }
    arr.sort(function (a, b) { return a.k - b.k; });
    deck = arr.map(function (x) { return x.i; });
    deckPos = 0;
  }

  function inShortQueue(i) {
    for (var k = 0; k < shortQueue.length; k++) { if (shortQueue[k].i === i) return true; }
    return false;
  }
  function inRecent(i) {
    return recent.indexOf(i) >= 0;
  }

  function takeFromDeck() {
    while (deckPos < deck.length) {
      var i = deck[deckPos++];
      if (inShortQueue(i) || inRecent(i)) continue;
      return i;
    }
    rebuildDeck();
    while (deckPos < deck.length) {
      var j = deck[deckPos++];
      if (inShortQueue(j) || inRecent(j)) continue;
      return j;
    }
    return deck.length ? deck[0] : -1;   /* 词库小到没法避让时，随便给一个 */
  }

  function takeFromQueue() {
    var best = -1;
    for (var k = 0; k < shortQueue.length; k++) {
      if (shortQueue[k].at <= 0) { best = k; break; }
    }
    if (best < 0) return -1;
    var i = shortQueue[best].i;
    shortQueue.splice(best, 1);
    return i;
  }

  function tickQueue() {
    for (var k = 0; k < shortQueue.length; k++) shortQueue[k].at--;
  }

  function scheduleAgain(i, kind) {
    var range = REINJECT[kind] || REINJECT.wrong;
    var at = range[0] + Math.floor(Math.random() * (range[1] - range[0] + 1));
    for (var k = 0; k < shortQueue.length; k++) {
      if (shortQueue[k].i === i) { shortQueue[k].at = Math.max(shortQueue[k].at, at); return; }
    }
    shortQueue.push({ i: i, at: at });
  }

  /* ---------- 选项 ---------- */
  /* 去掉词性前缀和标点，只比较「意思」，避免出现两个几乎一样的选项 */
  function coreOf(mean) {
    return String(mean).replace(/^[a-z][a-z.&\s]*\.\s*/i, '').replace(/[，,；;。.、/\\|()（）\[\]\s'"“”‘’]/g, '');
  }

  function buildOptions(idx) {
    var right = bank.words[idx][2];
    var rightCore = coreOf(right);
    var rightFirst = rightCore.charAt(0);
    var words = bank.words;
    var picks = [];
    var seenCore = {};
    seenCore[rightCore] = 1;

    function tryPick(j, strict) {
      if (j === idx) return false;
      var mean = words[j][2];
      var core = coreOf(mean);
      if (!core) return false;
      if (seenCore[core]) return false;
      if (strict) {
        if (core === rightCore) return false;
        if (core.indexOf(rightCore) >= 0 || rightCore.indexOf(core) >= 0) return false;
        if (core.charAt(0) === rightFirst) return false;
      }
      seenCore[core] = 1;
      picks.push(mean);
      return true;
    }

    var tries = 0;
    while (picks.length < OPTION_COUNT - 1 && tries < 400) {
      tries++;
      tryPick(Math.floor(Math.random() * words.length), true);
    }
    tries = 0;
    while (picks.length < OPTION_COUNT - 1 && tries < 400) {
      tries++;
      tryPick(Math.floor(Math.random() * words.length), false);   /* 放宽：释义都很像时也得凑够 */
    }

    var opts = picks.concat([right]);
    /* 洗一下，正确答案不能总在同一个位置 */
    for (var k = opts.length - 1; k > 0; k--) {
      var t = Math.floor(Math.random() * (k + 1));
      var tmp = opts[k]; opts[k] = opts[t]; opts[t] = tmp;
    }
    return opts.map(function (text) { return { text: text, right: text === right }; });
  }

  /* ---------- 出牌 ---------- */
  function nextCard() {
    if (!bank || !bank.words.length) return;
    tickQueue();
    var i = takeFromQueue();
    if (i < 0) i = takeFromDeck();
    if (i < 0) return;

    recent.push(i);
    while (recent.length > RECENT_GUARD) recent.shift();

    var row = bank.words[i];
    current = {
      i: i,
      word: row[0],
      phonetic: row[1],
      mean: row[2],
      options: buildOptions(i),
      answered: false,
    };
    renderCard();
  }

  function renderCard() {
    hideFeedback();
    if (!current) return;
    wordEl.textContent = current.word;
    phoneticEl.textContent = current.phonetic ? '[' + current.phonetic + ']' : '（这个词表里没有音标）';
    optsEl.innerHTML = '';
    current.options.forEach(function (opt, idx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'qc-opt';
      b.setAttribute('data-index', String(idx));
      var no = document.createElement('span');
      no.className = 'qc-opt__no';
      no.textContent = String(idx + 1);
      var tx = document.createElement('span');
      tx.className = 'qc-opt__text';
      tx.textContent = opt.text;
      b.appendChild(no);
      b.appendChild(tx);
      b.addEventListener('click', function () { chooseOption(idx); });
      optsEl.appendChild(b);
    });
    fuzzyBtn.disabled = false;
    unknownBtn.disabled = false;
    progressEl.textContent = '本次 ' + sessionCount + ' 张';
  }

  function hideFeedback() {
    feedbackEl.hidden = true;
    feedbackEl.className = 'qc-feedback';
    nextBtn.hidden = true;
  }

  function showFeedback(kind, title, text, tone) {
    fbTitleEl.textContent = title;
    fbTextEl.innerHTML = '';
    if (text) {
      var b = document.createElement('b');
      b.textContent = text;
      fbTextEl.appendChild(b);
    }
    feedbackEl.className = 'qc-feedback' + (tone ? ' ' + tone : '');
    feedbackEl.hidden = false;
    nextBtn.hidden = false;
  }

  function recordAnswer(kind) {
    var st = bankState(bankId);
    var key = current.word.toLowerCase();
    var row = st.words[key] || { s: '', r: 0, w: 0, n: 0, t: 0 };
    row.n++;
    row.t = Date.now();
    /* 状态只有四种：known（答对了）/ wrong / fuzzy / unknown */
    row.s = kind === 'right' ? 'known' : kind;
    if (kind === 'right') row.r++;
    else row.w++;
    st.words[key] = row;
    st.answered = (st.answered || 0) + 1;
    saveStore();
    sessionCount++;
    progressEl.textContent = '本次 ' + sessionCount + ' 张';
  }

  function chooseOption(idx) {
    if (!current || current.answered) return;
    var opt = current.options[idx];
    if (!opt) return;
    current.answered = true;
    var buttons = optsEl.querySelectorAll('.qc-opt');
    for (var k = 0; k < buttons.length; k++) {
      buttons[k].disabled = true;
      if (current.options[k].right) buttons[k].classList.add('is-right');
      else if (k === idx) buttons[k].classList.add('is-wrong');
    }
    fuzzyBtn.disabled = true;
    unknownBtn.disabled = true;

    if (opt.right) {
      recordAnswer('right');
      showFeedback('right', '正确', current.mean, '');
    } else {
      recordAnswer('wrong');
      scheduleAgain(current.i, 'wrong');
      showFeedback('wrong', '错误', '正确释义：' + current.mean, 'is-bad');
    }
  }

  function markFuzzy() {
    if (!current || current.answered) return;
    current.answered = true;
    lockOptions();
    recordAnswer('fuzzy');
    scheduleAgain(current.i, 'fuzzy');
    showFeedback('fuzzy', '加深印象', '正确释义：' + current.mean, 'is-fuzzy');
  }

  function markUnknown() {
    if (!current || current.answered) return;
    current.answered = true;
    lockOptions();
    recordAnswer('unknown');
    scheduleAgain(current.i, 'unknown');
    showFeedback('unknown', '得认识一下了', '正确释义：' + current.mean, 'is-bad');
  }

  function lockOptions() {
    var buttons = optsEl.querySelectorAll('.qc-opt');
    for (var k = 0; k < buttons.length; k++) {
      buttons[k].disabled = true;
      if (current && current.options[k] && current.options[k].right) buttons[k].classList.add('is-right');
    }
    fuzzyBtn.disabled = true;
    unknownBtn.disabled = true;
  }

  /* ---------- 视图切换 ---------- */
  function showView(name) {
    view = name;
    homeEl.hidden = name !== 'home';
    studyEl.hidden = name !== 'study';
    booksEl.hidden = name !== 'books';
    if (name === 'home') renderBanks();
    if (name === 'books') renderBooks();
  }

  /* ---------- 选词库 ---------- */
  function renderBanks() {
    banksEl.innerHTML = '';
    if (!BANKS.length) {
      var p = document.createElement('p');
      p.className = 'qc-empty';
      p.textContent = '词库还没准备好，刷新一下页面再试。';
      banksEl.appendChild(p);
      return;
    }
    BANKS.forEach(function (b, i) {
      var card = document.createElement('div');
      card.className = 'qc-bank';
      card.setAttribute('data-bank', b.id);

      var badge = document.createElement('span');
      badge.className = 'qc-bank__badge' + (i % 2 ? ' qc-bank__badge--gold' : '');
      badge.textContent = b.name.replace('词库', '');
      card.appendChild(badge);

      var body = document.createElement('div');
      body.className = 'qc-bank__body';
      var name = document.createElement('div');
      name.className = 'qc-bank__name';
      name.appendChild(document.createTextNode(b.name));
      var em = document.createElement('em');
      em.textContent = b.count + ' 词';
      name.appendChild(em);
      body.appendChild(name);

      var meta = document.createElement('div');
      meta.className = 'qc-bank__meta';
      meta.appendChild(document.createTextNode('学过 '));
      var learned = document.createElement('b');
      learned.textContent = String(learnedCount(b.id));
      meta.appendChild(learned);
      meta.appendChild(document.createTextNode(' 词 · 待豪本 '));
      var todo = document.createElement('b');
      todo.textContent = String(todoCount(b.id));
      meta.appendChild(todo);
      meta.appendChild(document.createTextNode(' · 豪到了 '));
      var known = document.createElement('b');
      known.textContent = String(knownCount(b.id));
      meta.appendChild(known);
      body.appendChild(meta);

      var links = document.createElement('div');
      links.className = 'qc-bank__books';
      var todoLink = document.createElement('button');
      todoLink.type = 'button';
      todoLink.className = 'qc-book-link';
      todoLink.setAttribute('data-open', 'todo');
      todoLink.appendChild(document.createTextNode('待豪本 '));
      var tb = document.createElement('b');
      tb.textContent = String(todoCount(b.id));
      todoLink.appendChild(tb);
      todoLink.addEventListener('click', function () { openBooks(b.id, 'todo'); });
      var knownLink = document.createElement('button');
      knownLink.type = 'button';
      knownLink.className = 'qc-book-link';
      knownLink.setAttribute('data-open', 'known');
      knownLink.appendChild(document.createTextNode('豪到了 '));
      var kb = document.createElement('b');
      kb.textContent = String(knownCount(b.id));
      knownLink.appendChild(kb);
      knownLink.addEventListener('click', function () { openBooks(b.id, 'known'); });
      links.appendChild(todoLink);
      links.appendChild(knownLink);
      body.appendChild(links);
      card.appendChild(body);

      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'qc-bank__go';
      go.setAttribute('data-start', b.id);
      var started = learnedCount(b.id);
      go.textContent = started ? '接着背' : '开始背';
      go.addEventListener('click', function () { startBank(b.id); });
      card.appendChild(go);

      banksEl.appendChild(card);
    });

    if (homeTip) {
      homeTip.textContent = '词库都剔除了小学就学过的单词。选错的、模糊的、不认识的会进「待豪本」，答对过的收进「豪到了」。';
    }
    renderMore();
  }

  /* 以后加的词库会自己出现在这里 */
  function renderMore() {
    var old = document.getElementById('qcMore');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var div = document.createElement('div');
    div.className = 'qc-more';
    div.id = 'qcMore';
    div.textContent = '目前上线 ' + BANKS.length + ' 个词库，更多词库还在筹备。';
    banksEl.parentNode.appendChild(div);
  }

  function globalNameOf(b) {
    return b.global || ('JHJX_WORDS_' + String(b.id).toUpperCase());
  }

  function startBank(id) {
    var meta = null;
    for (var i = 0; i < BANKS.length; i++) { if (BANKS[i].id === id) meta = BANKS[i]; }
    if (!meta) return;
    bankId = id;
    store.lastBank = id;
    saveStore();
    var g = globalNameOf(meta);
    if (window[g] && window[g].length) {
      bank = { id: meta.id, name: meta.name, words: window[g] };
      beginStudy();
      return;
    }
    homeTip.textContent = '正在加载「' + meta.name + '」…';
    var s = document.createElement('script');
    s.src = meta.file;
    s.onload = function () {
      var data = window[g];
      if (!data || !data.length) {
        homeTip.textContent = '词库加载失败，刷新页面再试。';
        return;
      }
      bank = { id: meta.id, name: meta.name, words: data };
      beginStudy();
    };
    s.onerror = function () {
      homeTip.textContent = '词库加载失败（网络不太好），刷新页面再试。';
    };
    document.head.appendChild(s);
  }

  function beginStudy() {
    shortQueue = [];
    recent = [];
    sessionCount = 0;
    rebuildDeck();
    bankNameEl.textContent = bank.name;
    booksBankEl.textContent = bank.name;
    if (speakBtn) speakBtn.hidden = !canSpeak;
    showView('study');
    nextCard();
  }

  /* ---------- 单词本 ---------- */
  var booksBankId = '';
  var booksWhich = 'todo';
  var booksFilter = 'all';

  function openBooks(id, which) {
    booksBankId = id || bankId || (BANKS[0] && BANKS[0].id) || '';
    booksWhich = which || 'todo';
    booksFilter = 'all';
    var meta = null;
    for (var i = 0; i < BANKS.length; i++) { if (BANKS[i].id === booksBankId) meta = BANKS[i]; }
    booksBankEl.textContent = meta ? meta.name : '';
    var tabs = bookTabsEl.querySelectorAll('.qc-tab');
    for (var k = 0; k < tabs.length; k++) tabs[k].classList.toggle('is-active', tabs[k].getAttribute('data-book') === booksWhich);
    var chips = filterEl.querySelectorAll('.qc-chip');
    for (var c = 0; c < chips.length; c++) chips[c].classList.toggle('is-active', chips[c].getAttribute('data-filter') === 'all');
    showView('books');
  }

  function bookRows(which) {
    /* 单词本要按词库列出来，所以这里需要用词库里的词表：
       数据文件没加载过就顺手加载一下 */
    if (!bank || bank.id !== booksBankId) {
      var meta = null;
      for (var i = 0; i < BANKS.length; i++) { if (BANKS[i].id === booksBankId) meta = BANKS[i]; }
      if (!meta) return null;
      var g = globalNameOf(meta);
      if (!window[g] || !window[g].length) return 'loading';
      bank = { id: meta.id, name: meta.name, words: window[g] };
      bankId = meta.id;
    }
    var st = bankState(booksBankId);
    var rows = [];
    for (var idx = 0; idx < bank.words.length; idx++) {
      var row = bank.words[idx];
      var s = st.words[row[0].toLowerCase()];
      if (!s) continue;
      if (which === 'todo' ? !(s.w > 0) : !(s.r > 0)) continue;
      rows.push({ word: row[0], phonetic: row[1], mean: row[2], s: s });
    }
    if (which === 'todo') {
      rows.sort(function (a, b) {
        var am = a.s.s === 'known' ? 1 : 0;
        var bm = b.s.s === 'known' ? 1 : 0;
        if (am !== bm) return am - bm;                 /* 还没掌握的排前面 */
        return (b.s.t || 0) - (a.s.t || 0);            /* 最近错的靠前 */
      });
    } else {
      rows.sort(function (a, b) { return a.word.toLowerCase() < b.word.toLowerCase() ? -1 : 1; });
    }
    return rows;
  }

  var STATE_LABEL = { unknown: '不认识', wrong: '选错过', fuzzy: '模糊', known: '已掌握' };

  function renderBooks() {
    var rows = bookRows(booksWhich);
    if (rows === 'loading') {
      listEl.innerHTML = '';
      booksHintEl.textContent = '正在加载词库…';
      var meta = null;
      for (var i = 0; i < BANKS.length; i++) { if (BANKS[i].id === booksBankId) meta = BANKS[i]; }
      if (meta) {
        var g = globalNameOf(meta);
        if (!window[g] || !window[g].length) {
          var s = document.createElement('script');
          s.src = meta.file;
          s.onload = function () { bank = { id: meta.id, name: meta.name, words: window[g] }; bankId = meta.id; renderBooks(); };
          s.onerror = function () { booksHintEl.textContent = '词库加载失败，刷新页面再试。'; };
          document.head.appendChild(s);
        }
      }
      return;
    }
    if (!rows) { listEl.innerHTML = ''; booksHintEl.textContent = '还没选词库。'; return; }

    var total = rows.length;
    var shown = rows;
    if (booksWhich === 'todo') {
      filterEl.hidden = false;
      if (booksFilter === 'left') shown = rows.filter(function (r) { return r.s.s !== 'known'; });
      var left = rows.filter(function (r) { return r.s.s !== 'known'; }).length;
      booksHintEl.textContent = '待豪本：' + total + ' 个词，其中 ' + left + ' 个还没掌握。这些词之后会反复出现。';
    } else {
      filterEl.hidden = true;
      booksHintEl.textContent = '豪到了：' + total + ' 个词。答对过的词也会再出现，只是频率很低。';
    }
    booksCountEl.textContent = shown.length + ' 个词';

    listEl.innerHTML = '';
    if (!shown.length) {
      var empty = document.createElement('li');
      empty.className = 'qc-empty';
      empty.textContent = booksWhich === 'todo'
        ? '待豪本还是空的。选错的、模糊的、不认识的词都会自动进来。'
        : '豪到了还是空的。答对一个词，它就会进来。';
      listEl.appendChild(empty);
      return;
    }
    shown.forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'qc-item';
      li.setAttribute('data-word', r.word);

      var body = document.createElement('div');
      body.className = 'qc-item__body';
      var head = document.createElement('div');
      var w = document.createElement('strong');
      w.className = 'qc-item__word';
      w.textContent = r.word;
      head.appendChild(w);
      if (r.phonetic) {
        var ph = document.createElement('span');
        ph.className = 'qc-item__ph';
        ph.textContent = '[' + r.phonetic + ']';
        head.appendChild(ph);
      }
      body.appendChild(head);
      var mean = document.createElement('div');
      mean.className = 'qc-item__mean';
      mean.textContent = r.mean;
      body.appendChild(mean);

      var tags = document.createElement('div');
      tags.className = 'qc-item__tags';
      var t1 = document.createElement('span');
      t1.className = 'qc-tag ' + (r.s.s === 'known' ? 'qc-tag--ok' : (r.s.s === 'fuzzy' ? 'qc-tag--fuzzy' : 'qc-tag--bad'));
      t1.textContent = STATE_LABEL[r.s.s] || '看过';
      tags.appendChild(t1);
      var t2 = document.createElement('span');
      t2.className = 'qc-tag';
      t2.textContent = '对 ' + (r.s.r || 0) + ' / 错 ' + (r.s.w || 0);
      tags.appendChild(t2);
      body.appendChild(tags);
      li.appendChild(body);

      if (canSpeak) {
        var sp = document.createElement('button');
        sp.type = 'button';
        sp.className = 'qc-item__speak';
        sp.setAttribute('aria-label', '朗读 ' + r.word);
        sp.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5.5 6.8 9H4v6h2.8L11 18.5z"></path><path d="M15.4 9.2a4 4 0 0 1 0 5.6"></path></svg>';
        sp.addEventListener('click', function () { speak(r.word); });
        li.appendChild(sp);
      }
      listEl.appendChild(li);
    });
  }

  /* ---------- 事件 ---------- */
  backBtn.addEventListener('click', function () { showView('home'); });
  booksBtn.addEventListener('click', function () { openBooks(bankId, 'todo'); });
  booksBackBtn.addEventListener('click', function () {
    if (bank) showView('study'); else showView('home');
  });
  nextBtn.addEventListener('click', function () { nextCard(); });
  fuzzyBtn.addEventListener('click', markFuzzy);
  unknownBtn.addEventListener('click', markUnknown);
  if (speakBtn) {
    speakBtn.addEventListener('click', function () { if (current) speak(current.word); });
  }
  bookTabsEl.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.qc-tab') : null;
    if (!btn) return;
    booksWhich = btn.getAttribute('data-book');
    var tabs = bookTabsEl.querySelectorAll('.qc-tab');
    for (var k = 0; k < tabs.length; k++) tabs[k].classList.toggle('is-active', tabs[k] === btn);
    renderBooks();
  });
  filterEl.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.qc-chip') : null;
    if (!btn) return;
    booksFilter = btn.getAttribute('data-filter');
    var chips = filterEl.querySelectorAll('.qc-chip');
    for (var k = 0; k < chips.length; k++) chips[k].classList.toggle('is-active', chips[k] === btn);
    renderBooks();
  });

  function isInteractive(el) {
    if (!el || !el.tagName) return false;
    var t = el.tagName;
    return t === 'BUTTON' || t === 'A' || t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
  }

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (view !== 'study') return;
    if (isInteractive(e.target) && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.key >= '1' && e.key <= '4') {
      if (current && !current.answered) {
        e.preventDefault();
        chooseOption(Number(e.key) - 1);
      }
      return;
    }
    var low = String(e.key).toLowerCase();
    if (low === 'q') { if (current && !current.answered) { e.preventDefault(); markFuzzy(); } return; }
    if (low === 'w') { if (current && !current.answered) { e.preventDefault(); markUnknown(); } return; }
    if (e.key === ' ' || e.key === 'Enter') {
      if (current && current.answered) { e.preventDefault(); nextCard(); }
    }
  });

  /* ---------- 自检用的只读窗口 ---------- */
  window.jhjxQianci = {
    view: function () { return view; },
    banks: function () { return BANKS.map(function (b) { return { id: b.id, name: b.name, count: b.count, file: b.file }; }); },
    bank: function () { return bank ? { id: bank.id, name: bank.name, count: bank.words.length } : null; },
    current: function () {
      if (!current) return null;
      var correctIndex = -1;
      for (var k = 0; k < current.options.length; k++) { if (current.options[k].right) correctIndex = k; }
      return {
        word: current.word, phonetic: current.phonetic, mean: current.mean,
        options: current.options.map(function (o) { return o.text; }),
        correctIndex: correctIndex,
        answered: current.answered,
      };
    },
    stats: function () {
      var id = bankId || (BANKS[0] && BANKS[0].id) || '';
      return {
        bank: id,
        learned: learnedCount(id),
        todo: todoCount(id),
        known: knownCount(id),
        answered: (bankState(id).answered) || 0,
        session: sessionCount,
        queue: shortQueue.length,
        deckLeft: deck.length - deckPos,
      };
    },
    counts: function (id) {
      return { learned: learnedCount(id), todo: todoCount(id), known: knownCount(id) };
    },
    /* 某个词现在的状态（自检用） */
    word: function (w) {
      var row = wordRow(bankId, String(w).toLowerCase());
      if (!row) return null;
      return { s: row.s, r: row.r || 0, w: row.w || 0, n: row.n || 0 };
    },
    recent: function () { return recent.slice(); },
    weights: function () { return DECK_WEIGHT; },
  };

  showView('home');
})();
