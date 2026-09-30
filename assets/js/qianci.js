/* =========================================================
   嘉学 · 千词奇域
   ---------------------------------------------------------
   一个词库 = 一堆 [单词, 音标, 释义]，进度按词库存本机浏览器。

   词的状态（决定它多常出现）：
     unknown  不认识      —— 权重 8，最常回来看你
     wrong    选错过      —— 权重 5
     fuzzy    模糊        —— 权重 3
     learning 刚认识      —— 权重 3（跟模糊一样；再答错退回 unknown，再答对才变 known）
     known    完全认识    —— 权重 0.25，很低很低

   答对一次：原来是 unknown / wrong → 变 learning（进「豪到了」，但按模糊的频率重复）；
             原来是 fuzzy / learning / known → 变 known。
   答错：learning 变回 unknown；known 选错变 wrong、不认识变 unknown；fuzzy 保持。
   待豪本 = 状态还在 unknown / wrong / fuzzy 的词（答对就从这里剔除，进「豪到了」）
   豪到了 = 状态是 learning / known 的词

   牌堆：长牌堆按权重洗整个词库 + 短队列把刚答错/模糊/不认识的词插到后面几张。
   「重新背」= 不管历史，从头过一遍整个词库（不动两个本子）。
   ========================================================= */
(function () {
  'use strict';

  var STATE_KEY = 'jhjx-qianci-v1';
  var BANKS = (window.JHJX_WORD_BANKS || []).slice();
  var DETAIL = window.JHJX_DETAIL_INDEX || { base: 'assets/data/qianci-detail/', version: '' };
  var DECK_WEIGHT = { unknown: 8, wrong: 5, fuzzy: 3, learning: 3, known: 0.25, unseen: 2.5 };
  var REINJECT = { unknown: [3, 5], wrong: [5, 8], fuzzy: [8, 12], learning: [8, 12] };
  var RECENT_GUARD = 5;
  var OPTION_COUNT = 4;
  var STATE_LABEL = { unknown: '不认识', wrong: '选错过', fuzzy: '模糊', learning: '刚认识', known: '已掌握' };
  var TODO_STATES = ['unknown', 'wrong', 'fuzzy'];
  var KNOWN_STATES = ['learning', 'known'];

  /* ---------- DOM ---------- */
  var homeEl = document.getElementById('qcHome');
  var banksEl = document.getElementById('qcBanks');
  var homeTip = document.getElementById('qcHomeTip');
  var studyEl = document.getElementById('qcStudy');
  var booksEl = document.getElementById('qcBooks');
  var detailEl = document.getElementById('qcDetail');
  var rankEl = document.getElementById('qcRank');
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
  var booksHintEl = document.getElementById('qcBooksHint');
  var listEl = document.getElementById('qcList');
  var clearBtn = document.getElementById('qcClearBtn');
  var clearConfirm = document.getElementById('qcClearConfirm');
  var clearText = document.getElementById('qcClearText');
  var clearOk = document.getElementById('qcClearOk');
  var clearCancel = document.getElementById('qcClearCancel');
  var detailBack = document.getElementById('qcDetailBack');
  var detailWord = document.getElementById('qcDetailWord');
  var detailPhonetic = document.getElementById('qcDetailPhonetic');
  var detailTag = document.getElementById('qcDetailTag');
  var detailLoading = document.getElementById('qcDetailLoading');
  var detailBody = document.getElementById('qcDetailBody');
  var detailSpeak = document.getElementById('qcDetailSpeak');
  var rankBack = document.getElementById('qcRankBack');
  var rankBankEl = document.getElementById('qcRankBank');
  var rankTabs = document.getElementById('qcRankTabs');
  var rankHint = document.getElementById('qcRankHint');
  var rankList = document.getElementById('qcRankList');
  var rankRefresh = document.getElementById('qcRankRefresh');
  if (!homeEl || !studyEl || !booksEl || !banksEl) return;

  /* ---------- 本机进度 ---------- */
  function emptyStore() { return { v: 1, banks: {}, lastBank: '', pushed: {} }; }
  function loadStore() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.v === 1 && s.banks && typeof s.banks === 'object') {
          if (!s.pushed) s.pushed = {};
          return s;
        }
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
  function inStates(row, list) { return !!row && list.indexOf(row.s) >= 0; }
  function todoCount(id) { return countState(id, function (r) { return inStates(r, TODO_STATES); }); }
  function knownCount(id) { return countState(id, function (r) { return inStates(r, KNOWN_STATES); }); }
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
  if (!canSpeak) {
    if (speakBtn) speakBtn.hidden = true;
    if (detailSpeak) detailSpeak.hidden = true;
  }

  /* ---------- 牌堆 ---------- */
  var bank = null;
  var bankId = '';
  var deck = [];
  var deckPos = 0;
  var shortQueue = [];
  var recent = [];
  var current = null;
  var sessionCount = 0;
  var view = 'home';
  var passMode = 'continue';       /* continue = 接着背（按历史权重），restart = 重新背（从头过一遍） */

  function weightOf(i) {
    var row = wordRow(bankId, bank.words[i][0].toLowerCase());
    if (!row) return DECK_WEIGHT.unseen;
    return DECK_WEIGHT[row.s] || DECK_WEIGHT.unseen;
  }

  function rebuildDeck(uniform) {
    var n = bank.words.length;
    var arr = new Array(n);
    for (var i = 0; i < n; i++) {
      var w = uniform ? 1 : weightOf(i);
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
  function takeFromDeck() {
    if (passMode === 'restart') {
      if (deckPos >= deck.length) return -1;
      return deck[deckPos++];
    }
    while (deckPos < deck.length) {
      var i = deck[deckPos++];
      if (inShortQueue(i) || recent.indexOf(i) >= 0) continue;
      return i;
    }
    rebuildDeck(false);
    while (deckPos < deck.length) {
      var j = deck[deckPos++];
      if (inShortQueue(j) || recent.indexOf(j) >= 0) continue;
      return j;
    }
    return deck.length ? deck[0] : -1;
  }
  function takeFromQueue() {
    for (var k = 0; k < shortQueue.length; k++) {
      if (shortQueue[k].at <= 0) { var i = shortQueue[k].i; shortQueue.splice(k, 1); return i; }
    }
    return -1;
  }
  function tickQueue() { for (var k = 0; k < shortQueue.length; k++) shortQueue[k].at--; }
  function scheduleAgain(i, kind) {
    var range = REINJECT[kind] || REINJECT.wrong;
    var at = range[0] + Math.floor(Math.random() * (range[1] - range[0] + 1));
    for (var k = 0; k < shortQueue.length; k++) {
      if (shortQueue[k].i === i) { shortQueue[k].at = Math.max(shortQueue[k].at, at); return; }
    }
    shortQueue.push({ i: i, at: at });
  }

  /* ---------- 选项 ---------- */
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
      if (!core || seenCore[core]) return false;
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
    while (picks.length < OPTION_COUNT - 1 && tries < 400) { tries++; tryPick(Math.floor(Math.random() * words.length), true); }
    tries = 0;
    while (picks.length < OPTION_COUNT - 1 && tries < 400) { tries++; tryPick(Math.floor(Math.random() * words.length), false); }
    var opts = picks.concat([right]);
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
    if (i < 0) {
      passMode = 'continue';          /* 重新背过完一遍，自动回到接着背 */
      rebuildDeck(false);
      i = takeFromDeck();
      if (i < 0) return;
    }
    recent.push(i);
    while (recent.length > RECENT_GUARD) recent.shift();
    var row = bank.words[i];
    current = { i: i, word: row[0], phonetic: row[1], mean: row[2], options: buildOptions(i), answered: false };
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
    updateProgressText();
  }

  function updateProgressText() {
    if (passMode === 'restart') progressEl.textContent = '重背 ' + Math.min(deckPos, deck.length) + ' / 共 ' + deck.length;
    else progressEl.textContent = '本次 ' + sessionCount + ' 张';
  }

  function hideFeedback() {
    feedbackEl.hidden = true;
    feedbackEl.className = 'qc-feedback';
    nextBtn.hidden = true;
  }
  function showFeedback(title, text, tone) {
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

  /* ---------- 状态机 ---------- */
  function nextState(prev, kind) {
    if (kind === 'right') {
      if (prev === 'unknown' || prev === 'wrong') return 'learning';   /* 一次答对只算「刚认识」 */
      return 'known';                                                  /* 模糊/刚认识/已掌握 再答对 = 完全认识 */
    }
    if (kind === 'unknown') return 'unknown';
    if (kind === 'fuzzy') return 'fuzzy';
    /* 选错：刚认识或已掌握 掉下来 */
    if (prev === 'learning') return 'unknown';
    return 'wrong';
  }

  function recordAnswer(kind) {
    var st = bankState(bankId);
    var key = current.word.toLowerCase();
    var row = st.words[key] || { s: '', r: 0, u: 0, x: 0, f: 0, n: 0, t: 0 };
    row.s = nextState(row.s, kind);
    row.n++;
    row.t = Date.now();
    if (kind === 'right') row.r++;
    else if (kind === 'unknown') row.u++;
    else if (kind === 'fuzzy') row.f++;
    else row.x++;
    st.words[key] = row;
    st.answered = (st.answered || 0) + 1;
    saveStore();
    sessionCount++;
    updateProgressText();
    schedulePush();
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
      var now = wordRow(bankId, current.word.toLowerCase());
      /* 「刚认识」按模糊的频率再回来考你（跟模糊词一个待遇） */
      if (now && now.s === 'learning') scheduleAgain(current.i, 'learning');
      showFeedback('正确', now && now.s === 'learning'
        ? '记住了 —— 先算「刚认识」，还会再来考你一次。'
        : current.mean, '');
    } else {
      recordAnswer('wrong');
      scheduleAgain(current.i, 'wrong');
      showFeedback('错误', '正确释义：' + current.mean, 'is-bad');
    }
  }
  function markFuzzy() {
    if (!current || current.answered) return;
    current.answered = true;
    lockOptions();
    recordAnswer('fuzzy');
    scheduleAgain(current.i, 'fuzzy');
    showFeedback('加深印象', '正确释义：' + current.mean, 'is-fuzzy');
  }
  function markUnknown() {
    if (!current || current.answered) return;
    current.answered = true;
    lockOptions();
    recordAnswer('unknown');
    scheduleAgain(current.i, 'unknown');
    showFeedback('得认识一下了', '正确释义：' + current.mean, 'is-bad');
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

  /* ---------- 视图 ---------- */
  function showView(name) {
    view = name;
    homeEl.hidden = name !== 'home';
    studyEl.hidden = name !== 'study';
    booksEl.hidden = name !== 'books';
    detailEl.hidden = name !== 'detail';
    rankEl.hidden = name !== 'rank';
    if (name === 'home') renderBanks();
    if (name === 'books') renderBooks();
    if (name === 'rank') renderRank();
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
      var rankLink = document.createElement('button');
      rankLink.type = 'button';
      rankLink.className = 'qc-book-link';
      rankLink.setAttribute('data-open', 'rank');
      rankLink.textContent = '好友排行榜';
      rankLink.addEventListener('click', function () { openRank(b.id); });
      links.appendChild(todoLink);
      links.appendChild(knownLink);
      links.appendChild(rankLink);
      body.appendChild(links);
      card.appendChild(body);

      var goWrap = document.createElement('div');
      goWrap.className = 'qc-bank__actions';
      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'qc-bank__go';
      go.setAttribute('data-start', b.id);
      go.textContent = learnedCount(b.id) ? '接着背' : '开始背';
      go.addEventListener('click', function () { startBank(b.id, 'continue'); });
      goWrap.appendChild(go);
      if (learnedCount(b.id)) {
        var again = document.createElement('button');
        again.type = 'button';
        again.className = 'qc-bank__go qc-bank__go--ghost';
        again.setAttribute('data-restart', b.id);
        again.textContent = '重新背';
        again.addEventListener('click', function () { startBank(b.id, 'restart'); });
        goWrap.appendChild(again);
      }
      card.appendChild(goWrap);
      banksEl.appendChild(card);
    });

    if (homeTip) {
      homeTip.textContent = '词库都剔除了小学就学过的单词。答错的、模糊的、不认识的进「待豪本」，答对过的收进「豪到了」。进度存在这台设备上。';
    }
    renderMore();
  }

  function renderMore() {
    var old = document.getElementById('qcMore');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var div = document.createElement('div');
    div.className = 'qc-more';
    div.id = 'qcMore';
    div.textContent = '目前上线 ' + BANKS.length + ' 个词库，更多词库还在筹备。';
    banksEl.parentNode.appendChild(div);
  }

  function globalNameOf(b) { return b.global || ('JHJX_WORDS_' + String(b.id).toUpperCase()); }
  function bankMeta(id) {
    for (var i = 0; i < BANKS.length; i++) { if (BANKS[i].id === id) return BANKS[i]; }
    return null;
  }

  function startBank(id, mode) {
    var meta = bankMeta(id);
    if (!meta) return;
    bankId = id;
    passMode = mode === 'restart' ? 'restart' : 'continue';
    store.lastBank = id;
    saveStore();
    var g = globalNameOf(meta);
    if (window[g] && window[g].length) { bank = { id: meta.id, name: meta.name, words: window[g] }; beginStudy(); return; }
    homeTip.textContent = '正在加载「' + meta.name + '」…';
    var s = document.createElement('script');
    s.src = meta.file;
    s.onload = function () {
      var data = window[g];
      if (!data || !data.length) { homeTip.textContent = '词库加载失败，刷新页面再试。'; return; }
      bank = { id: meta.id, name: meta.name, words: data };
      beginStudy();
    };
    s.onerror = function () { homeTip.textContent = '词库加载失败（网络不太好），刷新页面再试。'; };
    document.head.appendChild(s);
  }

  function beginStudy() {
    shortQueue = [];
    recent = [];
    sessionCount = 0;
    rebuildDeck(passMode === 'restart');
    bankNameEl.textContent = bank.name;
    booksBankEl.textContent = bank.name;
    if (speakBtn) speakBtn.hidden = !canSpeak;
    showView('study');
    nextCard();
    if (passMode === 'restart') showFeedback('重新过一遍', '这一轮从头开始走，两个本子里的记录都留着。', 'is-fuzzy');
  }

  /* ---------- 单词本 ---------- */
  var booksBankId = '';
  var booksWhich = 'todo';

  function openBooks(id, which) {
    booksBankId = id || bankId || (BANKS[0] && BANKS[0].id) || '';
    booksWhich = which || 'todo';
    clearConfirm.hidden = true;
    clearBtn.hidden = false;
    var tabs = bookTabsEl.querySelectorAll('.qc-tab');
    for (var k = 0; k < tabs.length; k++) tabs[k].classList.toggle('is-active', tabs[k].getAttribute('data-book') === booksWhich);
    showView('books');
  }

  function ensureBankLoaded(id, cb) {
    if (bank && bank.id === id) { cb(true); return; }
    var meta = bankMeta(id);
    if (!meta) { cb(false); return; }
    var g = globalNameOf(meta);
    if (window[g] && window[g].length) { bank = { id: meta.id, name: meta.name, words: window[g] }; bankId = meta.id; cb(true); return; }
    var s = document.createElement('script');
    s.src = meta.file;
    s.onload = function () {
      var data = window[g];
      if (!data || !data.length) { cb(false); return; }
      bank = { id: meta.id, name: meta.name, words: data };
      bankId = meta.id;
      cb(true);
    };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }

  function bookRows(which) {
    var st = bankState(booksBankId);
    var rows = [];
    var want = which === 'todo' ? TODO_STATES : KNOWN_STATES;
    for (var idx = 0; idx < bank.words.length; idx++) {
      var row = bank.words[idx];
      var s = st.words[row[0].toLowerCase()];
      if (!s || want.indexOf(s.s) < 0) continue;
      rows.push({ word: row[0], phonetic: row[1], mean: row[2], s: s });
    }
    if (which === 'todo') {
      rows.sort(function (a, b) {
        if ((b.s.u || 0) !== (a.s.u || 0)) return (b.s.u || 0) - (a.s.u || 0);   /* 没认出来次数多的排前面 */
        return (b.s.t || 0) - (a.s.t || 0);
      });
    } else {
      rows.sort(function (a, b) { return a.word.toLowerCase() < b.word.toLowerCase() ? -1 : 1; });
    }
    return rows;
  }

  function renderBooks() {
    var meta = bankMeta(booksBankId);
    booksBankEl.textContent = meta ? meta.name : '';
    if (!bank || bank.id !== booksBankId) {
      booksHintEl.textContent = '正在加载词库…';
      listEl.innerHTML = '';
      ensureBankLoaded(booksBankId, function (ok) {
        if (!ok) { booksHintEl.textContent = '词库加载失败，刷新页面再试。'; return; }
        renderBooks();
      });
      return;
    }
    var rows = bookRows(booksWhich);
    var total = rows.length;
    if (booksWhich === 'todo') {
      var sumU = rows.reduce(function (n, r) { return n + (r.s.u || 0); }, 0);
      booksHintEl.textContent = '待豪本：' + total + ' 个词，累计没认出来 ' + sumU + ' 次。答对一次就会从这里移到「豪到了」。';
    } else {
      var half = rows.filter(function (r) { return r.s.s === 'learning'; }).length;
      booksHintEl.textContent = '豪到了：' + total + ' 个词，其中 ' + half + ' 个是「刚认识」（还会按模糊的频率再考你）。';
    }
    booksCountEl.textContent = total + ' 个词';

    listEl.innerHTML = '';
    if (!rows.length) {
      var empty = document.createElement('li');
      empty.className = 'qc-empty';
      empty.textContent = booksWhich === 'todo'
        ? '待豪本还是空的。选错的、模糊的、不认识的词都会自动进来。'
        : '豪到了还是空的。答对一个词，它就会进来。';
      listEl.appendChild(empty);
      return;
    }
    rows.forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'qc-item';
      li.setAttribute('data-word', r.word);
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', '0');
      li.addEventListener('click', function () { openDetail(r.word); });

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
      t1.className = 'qc-tag ' + (r.s.s === 'fuzzy' || r.s.s === 'learning' ? 'qc-tag--fuzzy' : (r.s.s === 'known' ? 'qc-tag--ok' : 'qc-tag--bad'));
      t1.textContent = STATE_LABEL[r.s.s] || '看过';
      tags.appendChild(t1);
      var t2 = document.createElement('span');
      t2.className = 'qc-tag qc-tag--bad';
      t2.textContent = '未认出 ' + (r.s.u || 0) + ' 次';
      tags.appendChild(t2);
      var t3 = document.createElement('span');
      t3.className = 'qc-tag';
      t3.textContent = '对 ' + (r.s.r || 0) + ' · 错 ' + ((r.s.x || 0) + (r.s.u || 0));
      tags.appendChild(t3);
      if (r.s.f) {
        var t4 = document.createElement('span');
        t4.className = 'qc-tag qc-tag--fuzzy';
        t4.textContent = '模糊 ' + r.s.f + ' 次';
        tags.appendChild(t4);
      }
      body.appendChild(tags);
      li.appendChild(body);

      var arrow = document.createElement('span');
      arrow.className = 'qc-item__arrow';
      arrow.textContent = '›';
      li.appendChild(arrow);
      listEl.appendChild(li);
    });
  }

  /* 清空（带二次确认） */
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      var which = booksWhich === 'todo' ? '待豪本' : '豪到了';
      var meta = bankMeta(booksBankId);
      clearText.textContent = '确定清空「' + (meta ? meta.name : '') + ' · ' + which + '」吗？清掉之后这些词的学习记录就没了，恢复不了。';
      clearConfirm.hidden = false;
      clearBtn.hidden = true;
    });
  }
  if (clearCancel) {
    clearCancel.addEventListener('click', function () {
      clearConfirm.hidden = true;
      clearBtn.hidden = false;
    });
  }
  if (clearOk) {
    clearOk.addEventListener('click', function () {
      var st = bankState(booksBankId);
      var want = booksWhich === 'todo' ? TODO_STATES : KNOWN_STATES;
      var changed = 0;
      for (var k in st.words) {
        if (!Object.prototype.hasOwnProperty.call(st.words, k)) continue;
        if (want.indexOf(st.words[k].s) >= 0) { delete st.words[k]; changed++; }
      }
      saveStore();
      clearConfirm.hidden = true;
      clearBtn.hidden = false;
      schedulePush();
      renderBooks();
      if (homeTip) homeTip.textContent = '已清空 ' + changed + ' 个词的记录。';
    });
  }

  /* ---------- 单词详情 ---------- */
  var detailWordKey = '';
  var detailLoadingChunk = {};
  var detailWaiters = {};

  /* 词条数据按「每桶 50 个词」切好，索引里存每桶的第一个词，二分找桶 */
  function bucketOf(word) {
    var starts = DETAIL.starts || [];
    if (!starts.length) return -1;
    var lo = 0;
    var hi = starts.length - 1;
    var ans = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (starts[mid] <= word) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  function loadDetailChunk(word, cb) {
    var idx = bucketOf(word);
    if (idx < 0) { cb(null); return; }
    var g = 'JHJX_DETAIL_D' + idx;
    if (window[g]) { cb(window[g] || null); return; }
    if (detailLoadingChunk[g]) { detailWaiters[g].push(cb); return; }
    detailLoadingChunk[g] = true;
    detailWaiters[g] = [cb];
    var s = document.createElement('script');
    s.src = (DETAIL.base || 'assets/data/qianci-detail/') + 'd' + idx + '.js' + (DETAIL.version ? '?v=' + DETAIL.version : '');
    var done = function (ok) {
      detailLoadingChunk[g] = false;
      var data = ok ? (window[g] || null) : null;
      var list = detailWaiters[g] || [];
      detailWaiters[g] = [];
      list.forEach(function (f) { f(data); });
    };
    s.onload = function () { done(true); };
    s.onerror = function () { done(false); };
    document.head.appendChild(s);
  }

  function openDetail(word) {
    if (!word) return;
    detailWordKey = String(word).toLowerCase();
    detailWord.textContent = word;
    var id = booksBankId || bankId;
    var row = wordRow(id, detailWordKey);
    detailTag.textContent = row ? ((STATE_LABEL[row.s] || '') + ' · 对 ' + (row.r || 0) + ' · 未认出 ' + (row.u || 0) + ' 次') : '';
    var known = null;
    if (bank && bank.id === id) {
      for (var i = 0; i < bank.words.length; i++) { if (bank.words[i][0].toLowerCase() === detailWordKey) { known = bank.words[i]; break; } }
    }
    detailPhonetic.textContent = known && known[1] ? '[' + known[1] + ']' : '';
    /* 网络慢的时候先把词库里已有的释义显示出来，详细资料到了再补上 */
    detailBody.innerHTML = '';
    if (known && known[2]) {
      var quick = section('释义');
      line(quick, known[2]);
      detailBody.appendChild(quick);
    }
    detailLoading.hidden = false;
    detailLoading.textContent = '正在取这个词的详细释义…';
    showView('detail');
    loadDetailChunk(detailWordKey, function (chunk) {
      if (view !== 'detail') return;
      renderDetail(chunk ? chunk[detailWordKey] : null, known);
    });
  }

  function section(title) {
    var box = document.createElement('section');
    box.className = 'qc-sec';
    var h = document.createElement('h4');
    h.className = 'qc-sec__title';
    h.textContent = title;
    box.appendChild(h);
    return box;
  }
  function line(parent, text, cls) {
    var p = document.createElement('p');
    p.className = 'qc-sec__line' + (cls ? ' ' + cls : '');
    p.textContent = text;
    parent.appendChild(p);
    return p;
  }

  function renderDetail(rec, known) {
    detailLoading.hidden = true;
    detailBody.innerHTML = '';
    if (known && known[1]) detailPhonetic.textContent = '[' + known[1] + ']';

    if (!rec) {
      var box0 = section('释义');
      if (known && known[2]) line(box0, known[2]);
      detailBody.appendChild(box0);
      line(detailBody, '这个词暂时没有更详细的资料（例句、固定搭配、词根词缀）。', 'qc-sec__note');
      return;
    }
    if (rec.p && (!detailPhonetic.textContent || detailPhonetic.textContent === '—')) detailPhonetic.textContent = '[' + rec.p + ']';
    if (rec.ox) {
      var ox = document.createElement('span');
      ox.className = 'qc-detail__ox';
      ox.textContent = '牛津核心词';
      detailBody.appendChild(ox);
    }

    if (rec.cn && rec.cn.length) {
      var cnBox = section('中文释义');
      var ul = document.createElement('ul');
      ul.className = 'qc-defs';
      rec.cn.forEach(function (t) {
        var li = document.createElement('li');
        if (t[0]) {
          var pos = document.createElement('em');
          pos.className = 'qc-pos';
          pos.textContent = t[0] + '.';
          li.appendChild(pos);
        }
        li.appendChild(document.createTextNode(t[1]));
        ul.appendChild(li);
      });
      cnBox.appendChild(ul);
      detailBody.appendChild(cnBox);
    }

    if (rec.en && rec.en.length) {
      var enBox = section('英文释义');
      rec.en.forEach(function (t) { line(enBox, t); });
      detailBody.appendChild(enBox);
    }

    if (rec.ex && rec.ex.length) {
      var exBox = section('例句');
      rec.ex.forEach(function (x) {
        var d = document.createElement('div');
        d.className = 'qc-ex';
        line(d, x[0], 'qc-ex__en');
        if (x[1]) line(d, x[1], 'qc-ex__cn');
        exBox.appendChild(d);
      });
      detailBody.appendChild(exBox);
    }

    if (rec.col && rec.col.length) {
      var colBox = section('固定搭配');
      rec.col.forEach(function (c) {
        var item = document.createElement('div');
        item.className = 'qc-col';
        var head = document.createElement('button');
        head.type = 'button';
        head.className = 'qc-col__head';
        var p = document.createElement('strong');
        p.textContent = c[0];
        head.appendChild(p);
        var m = document.createElement('span');
        m.className = 'qc-col__mean';
        m.textContent = c[1];
        head.appendChild(m);
        item.appendChild(head);
        if (c[2]) {
          var exWrap = document.createElement('div');
          exWrap.className = 'qc-col__ex';
          exWrap.hidden = true;
          line(exWrap, c[2][0], 'qc-ex__en');
          if (c[2][1]) line(exWrap, c[2][1], 'qc-ex__cn');
          var more = document.createElement('span');
          more.className = 'qc-col__more';
          more.textContent = '看例句';
          head.appendChild(more);
          head.addEventListener('click', function () {
            exWrap.hidden = !exWrap.hidden;
            more.textContent = exWrap.hidden ? '看例句' : '收起';
          });
          item.appendChild(exWrap);
        }
        colBox.appendChild(item);
      });
      detailBody.appendChild(colBox);
    }

    if (rec.dv && rec.dv.length) {
      var dvBox = section('衍生词 / 词形变化');
      var dl = document.createElement('ul');
      dl.className = 'qc-defs';
      rec.dv.forEach(function (d) {
        var li = document.createElement('li');
        var b = document.createElement('strong');
        b.textContent = d[0];
        li.appendChild(b);
        li.appendChild(document.createTextNode('（' + d[1] + '）'));
        dl.appendChild(li);
      });
      dvBox.appendChild(dl);
      detailBody.appendChild(dvBox);
    }

    if (rec.rt && rec.rt.length) {
      var rtBox = section('词根词缀');
      rec.rt.forEach(function (r) {
        var d = document.createElement('div');
        d.className = 'qc-root';
        var f = document.createElement('strong');
        f.textContent = r[0];
        d.appendChild(f);
        var t = document.createElement('span');
        t.className = 'qc-root__class';
        t.textContent = r[1];
        d.appendChild(t);
        d.appendChild(document.createTextNode('：' + r[2]));
        if (r[3] && r[3] !== '不详') {
          var o = document.createElement('span');
          o.className = 'qc-root__origin';
          o.textContent = '（来自 ' + r[3] + '）';
          d.appendChild(o);
        }
        rtBox.appendChild(d);
      });
      detailBody.appendChild(rtBox);
    }

    var missing = [];
    if (!rec.ex) missing.push('例句');
    if (!rec.col) missing.push('固定搭配');
    if (!rec.rt) missing.push('词根词缀');
    if (missing.length) line(detailBody, '这个词暂时没有：' + missing.join('、') + '。', 'qc-sec__note');
  }

  /* ---------- 好友排行榜（按「豪到了」的词数） ---------- */
  var rankBank = 'cet4';
  var rankBusy = false;

  function openRank(id) {
    rankBank = id || bankId || 'cet4';
    var tabs = rankTabs.querySelectorAll('.qc-tab');
    for (var k = 0; k < tabs.length; k++) tabs[k].classList.toggle('is-active', tabs[k].getAttribute('data-bank') === rankBank);
    showView('rank');
  }

  function renderRank() {
    var meta = bankMeta(rankBank);
    rankBankEl.textContent = meta ? meta.name : '';
    var API = window.JHJX_API;
    rankList.innerHTML = '';
    if (!API) { rankHint.textContent = '排行榜加载失败，刷新页面再试试。'; return; }
    if (!API.serviceReady()) { rankHint.textContent = '账号服务还没开通，先自己背。'; return; }
    if (!API.token()) {
      rankHint.textContent = '登录之后，就能看到自己和好友的「豪到了」词数了。';
      var li = document.createElement('li');
      li.className = 'qc-rank__guest';
      var a = document.createElement('a');
      a.className = 'qc-rank__go';
      a.href = 'account.html';
      a.textContent = '去我的账号登录';
      li.appendChild(a);
      rankList.appendChild(li);
      return;
    }
    if (rankBusy) return;
    rankBusy = true;
    rankHint.textContent = '正在读取…';
    pushProgress(true);
    API.qianciBoard(rankBank).then(function (r) {
      rankBusy = false;
      if (r.status === 401) { rankHint.textContent = '登录之后就能看到好友的词数了。'; return; }
      if (r.status !== 200 || !r.data || !r.data.ok) {
        rankHint.textContent = (r.data && r.data.error) ? ('排行榜读不到：' + r.data.error) : '排行榜暂时读不到，过会儿再刷新。';
        return;
      }
      var list = r.data.list || [];
      if (!list.length) { rankHint.textContent = '榜上还没有人。'; return; }
      var friends = Math.max(0, list.length - 1);
      rankHint.textContent = (meta ? meta.name : '') + '：自己 + ' + friends + ' 位好友，按「豪到了」的词数排。';
      list.forEach(function (item) {
        var li = document.createElement('li');
        li.className = 'qc-item qc-rank__row' + (item.me ? ' is-me' : '');
        var no = document.createElement('span');
        no.className = 'qc-rank__no';
        no.textContent = String(item.rank || '');
        li.appendChild(no);
        var body = document.createElement('div');
        body.className = 'qc-item__body';
        var name = document.createElement('strong');
        name.className = 'qc-item__word';
        name.textContent = item.name + (item.me ? '（我）' : '');
        body.appendChild(name);
        var metaLine = document.createElement('div');
        metaLine.className = 'qc-item__mean';
        metaLine.textContent = '豪到了 ' + item.known + ' 词' + (item.todo ? ' · 待豪本 ' + item.todo + ' 词' : '');
        body.appendChild(metaLine);
        li.appendChild(body);
        rankList.appendChild(li);
      });
    });
  }

  /* 把「豪到了」的词数报给服务端（给好友排行榜用），几秒合并一次 */
  var pushTimer = 0;
  function schedulePush() {
    var API = window.JHJX_API;
    if (!API || !API.serviceReady() || !API.token()) return;
    if (pushTimer) return;
    pushTimer = setTimeout(function () { pushTimer = 0; pushProgress(false); }, 4000);
  }
  function pushProgress(force) {
    var API = window.JHJX_API;
    if (!API || !API.serviceReady() || !API.token() || !bankId) return;
    var known = knownCount(bankId);
    var todo = todoCount(bankId);
    if (!force && store.pushed[bankId] === known) return;
    store.pushed[bankId] = known;
    saveStore();
    API.qianciProgress(bankId, known, todo);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pushProgress(false);
  });

  /* ---------- 事件 ---------- */
  backBtn.addEventListener('click', function () { pushProgress(false); showView('home'); });
  booksBtn.addEventListener('click', function () { openBooks(bankId, 'todo'); });
  booksBackBtn.addEventListener('click', function () { if (bank) showView('study'); else showView('home'); });
  detailBack.addEventListener('click', function () { showView('books'); });
  rankBack.addEventListener('click', function () { showView('home'); });
  nextBtn.addEventListener('click', function () { nextCard(); });
  fuzzyBtn.addEventListener('click', markFuzzy);
  unknownBtn.addEventListener('click', markUnknown);
  if (speakBtn) speakBtn.addEventListener('click', function () { if (current) speak(current.word); });
  if (detailSpeak) detailSpeak.addEventListener('click', function () { speak(detailWordKey); });
  if (rankRefresh) rankRefresh.addEventListener('click', function () { rankBusy = false; renderRank(); });
  bookTabsEl.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.qc-tab') : null;
    if (!btn) return;
    booksWhich = btn.getAttribute('data-book');
    clearConfirm.hidden = true;
    clearBtn.hidden = false;
    var tabs = bookTabsEl.querySelectorAll('.qc-tab');
    for (var k = 0; k < tabs.length; k++) tabs[k].classList.toggle('is-active', tabs[k] === btn);
    renderBooks();
  });
  rankTabs.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.qc-tab') : null;
    if (!btn) return;
    rankBank = btn.getAttribute('data-bank');
    var tabs = rankTabs.querySelectorAll('.qc-tab');
    for (var k = 0; k < tabs.length; k++) tabs[k].classList.toggle('is-active', tabs[k] === btn);
    renderRank();
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
      if (current && !current.answered) { e.preventDefault(); chooseOption(Number(e.key) - 1); }
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
    mode: function () { return passMode; },
    banks: function () { return BANKS.map(function (b) { return { id: b.id, name: b.name, count: b.count, file: b.file }; }); },
    bank: function () { return bank ? { id: bank.id, name: bank.name, count: bank.words.length } : null; },
    current: function () {
      if (!current) return null;
      var correctIndex = -1;
      for (var k = 0; k < current.options.length; k++) { if (current.options[k].right) correctIndex = k; }
      return {
        word: current.word, phonetic: current.phonetic, mean: current.mean,
        options: current.options.map(function (o) { return o.text; }),
        correctIndex: correctIndex, answered: current.answered,
      };
    },
    stats: function () {
      var id = bankId || (BANKS[0] && BANKS[0].id) || '';
      return {
        bank: id,
        learned: learnedCount(id), todo: todoCount(id), known: knownCount(id),
        answered: (bankState(id).answered) || 0,
        session: sessionCount, queue: shortQueue.length, deckLeft: deck.length - deckPos,
      };
    },
    counts: function (id) { return { learned: learnedCount(id), todo: todoCount(id), known: knownCount(id) }; },
    word: function (w) {
      var row = wordRow(bankId, String(w).toLowerCase());
      if (!row) return null;
      return { s: row.s, r: row.r || 0, u: row.u || 0, x: row.x || 0, f: row.f || 0, n: row.n || 0 };
    },
    detail: function () {
      return { word: detailWordKey, open: view === 'detail', text: detailBody ? detailBody.textContent : '' };
    },
    books: function (which) {
      if (!bank) return null;
      return bookRows(which || booksWhich).map(function (r) {
        return { word: r.word, s: r.s.s, u: r.s.u || 0, r: r.s.r || 0 };
      });
    },
    recent: function () { return recent.slice(); },
    weights: function () { return DECK_WEIGHT; },
  };

  showView('home');
})();
