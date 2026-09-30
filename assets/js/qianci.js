/* =========================================================
   嘉学 · 千词奇域
   ---------------------------------------------------------
   一个词库 = 一堆 [单词, 音标, 释义]，进度按词库存本机浏览器。

   词的状态（决定它多常出现，权重越大出现越勤）：
     unknown  不认识      —— 8   （保持不变）
     wrong    选错过      —— 5
     fuzzy    模糊        —— 5   （调高了，之前是 3）
     known    完全认识    —— 1   （调高了，之前是 0.25）

   连对阶梯（答错/不认识之后要连对 4 次才算完全认识）：
     答错一次           → 连对次数清零，状态回到 不认识 / 选错过
     再连对 2 次        → 机制上等同「模糊」（频率跟模糊一样，还在待豪本）
     再连对 2 次（共 4）→ 完全认识，进「豪到了」
   第一次就答对的词：直接算完全认识（不用爬阶梯）。
   答错 / 不认识之后不会再「隔两张就回来」，会拉开 8~15 张，免得靠短时记忆蒙对。
   待豪本 = 状态还是 unknown / wrong / fuzzy 的词
   豪到了 = 状态是 known 的词

   牌堆：长牌堆按权重洗整个词库 + 短队列把弱词插到后面第几张再考一次。
   「重新背」= 不管历史，从头过一遍整个词库（不动两个本子）。
   ========================================================= */
(function () {
  'use strict';

  var STATE_KEY = 'jhjx-qianci-v1';
  var BANKS = (window.JHJX_WORD_BANKS || []).slice();
  var DETAIL = window.JHJX_DETAIL_INDEX || { base: 'assets/data/qianci-detail/', version: '' };
  var DECK_WEIGHT = { unknown: 8, wrong: 5, fuzzy: 5, known: 1, unseen: 2.5 };
  /* 答错 / 不认识之后隔久一点再出现（张数） */
  var REINJECT = { unknown: [8, 12], wrong: [10, 15], fuzzy: [6, 9] };
  var LADDER = 4;              /* 连对这么多次才算完全认识（2 次等同模糊，再 2 次进豪到了） */
  var RECENT_GUARD = 5;
  var OPTION_COUNT = 4;
  var STATE_LABEL = { unknown: '不认识', wrong: '选错过', fuzzy: '模糊', known: '已掌握' };
  var TODO_STATES = ['unknown', 'wrong', 'fuzzy'];
  var KNOWN_STATES = ['known'];

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
  var inlineEl = document.getElementById('qcRankInline');
  var inlineHint = document.getElementById('qcRankInlineHint');
  var inlineList = document.getElementById('qcRankInlineList');
  var inlineRefresh = document.getElementById('qcRankInlineRefresh');
  var inlineOpen = document.getElementById('qcRankInlineOpen');
  if (!homeEl || !studyEl || !booksEl || !banksEl) return;

  /* ---------- 本机进度 ---------- */
  function emptyStore() { return { v: 1, banks: {}, lastBank: '', pushed: {} }; }
  /* 老版本的状态迁移：learning 是上一版的「刚认识」，现在归到模糊级（连对 2 次） */
  function migrateStore(s) {
    if (!s || !s.banks) return s;
    for (var id in s.banks) {
      if (!Object.prototype.hasOwnProperty.call(s.banks, id)) continue;
      var words = s.banks[id] && s.banks[id].words;
      if (!words) continue;
      for (var k in words) {
        if (!Object.prototype.hasOwnProperty.call(words, k)) continue;
        var row = words[k];
        if (!row) continue;
        if (row.s === 'learning') { row.s = 'fuzzy'; row.c = 2; }
        if (typeof row.c !== 'number') row.c = 0;
      }
    }
    return s;
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.v === 1 && s.banks && typeof s.banks === 'object') {
          if (!s.pushed) s.pushed = {};
          return migrateStore(s);
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

  /* 形近词：先按前两个字母分桶，再算编辑距离（只给最近的几个）。
     用途：错误选项优先用「长得像」的词，比如 conservation 的选项里
     会出现 conversation（谈话），别让人一眼就排除掉。 */
  var simIndex = null;
  var simCache = {};
  function buildSimIndex() {
    simIndex = {};
    for (var i = 0; i < bank.words.length; i++) {
      var w = bank.words[i][0].toLowerCase();
      /* 前两个字母 + 第 2~3 个字母：这样 affect / effect 这种也能撞到一起 */
      var keys = [w.slice(0, 2)];
      if (w.length > 3) keys.push(w.slice(1, 3));
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (!key) continue;
        if (!simIndex[key]) simIndex[key] = [];
        simIndex[key].push(i);
      }
    }
  }
  function editDistance(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    var prev = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      var best = i;
      for (var k = 1; k <= b.length; k++) {
        var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
        if (cur[k] < best) best = cur[k];
      }
      if (best > cap) return cap + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  function similarIndices(idx) {
    var w = bank.words[idx][0].toLowerCase();
    if (simCache[w]) return simCache[w];
    if (!simIndex) buildSimIndex();
    var pool = [];
    var seen = {};
    var keys = [w.slice(0, 2)];
    if (w.length > 3) keys.push(w.slice(1, 3));
    for (var b = 0; b < keys.length; b++) {
      var bucket = simIndex[keys[b]] || [];
      for (var c = 0; c < bucket.length; c++) {
        var candidate = bucket[c];
        if (seen[candidate]) continue;
        seen[candidate] = 1;
        pool.push(candidate);
      }
    }
    var out = [];
    for (var k = 0; k < pool.length; k++) {
      var j = pool[k];
      if (j === idx) continue;
      var o = bank.words[j][0].toLowerCase();
      var d = editDistance(w, o, 3);
      if (d >= 1 && d <= 3) out.push({ j: j, d: d });
    }
    out.sort(function (a, b) { return a.d - b.d; });
    var res = out.slice(0, 10).map(function (x) { return x.j; });
    simCache[w] = res;
    return res;
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
    /* 先放 1~2 个形近词的释义（真找不到就算了） */
    var sims = similarIndices(idx);
    for (var s = 0; s < sims.length && picks.length < 2; s++) tryPick(sims[s], true);
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

  /* ---------- 状态机 + 连对阶梯 ---------- */
  /* 返回 [新状态, 新连对次数] */
  function nextState(prev, streak, kind) {
    if (kind === 'right') {
      if (prev === 'known') return ['known', streak + 1];
      if (prev === '' || !prev) return ['known', 1];      /* 第一次就答对，直接算会了 */
      var c = streak + 1;
      if (c >= LADDER) return ['known', c];               /* 连对够 4 次 → 完全认识 */
      if (c >= 2) return ['fuzzy', c];                    /* 连对 2 次 → 机制上等同模糊 */
      return [prev, c];                                   /* 才答对一次，先维持原来的弱状态 */
    }
    if (kind === 'unknown') return ['unknown', 0];
    if (kind === 'fuzzy') return ['fuzzy', 0];
    /* 选错：已经爬到模糊级的，退回不认识；否则就是选错 */
    if (streak >= 2) return ['unknown', 0];
    return ['wrong', 0];
  }

  function recordAnswer(kind) {
    var st = bankState(bankId);
    var key = current.word.toLowerCase();
    var row = st.words[key] || { s: '', c: 0, r: 0, u: 0, x: 0, f: 0, n: 0, t: 0 };
    var out = nextState(row.s, row.c || 0, kind);
    row.s = out[0];
    row.c = out[1];
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
    scheduleInlineRank();
    return row;
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
      var row = recordAnswer('right');
      if (row.s === 'known') {
        showFeedback('正确', row.r > 1 ? ('连对 ' + row.c + ' 次 —— 这个词收进「豪到了」。') : current.mean, '');
      } else {
        /* 还没爬完阶梯：告诉他还差几次 */
        var need = LADDER - row.c;
        showFeedback('正确', '已连对 ' + row.c + ' 次，再连对 ' + need + ' 次就进「豪到了」。', 'is-fuzzy');
      }
      /* 还没完全认识的词，让它按当前状态再回来（模糊级隔 6~9 张，更弱的隔 8~15 张） */
      if (row.s !== 'known') scheduleAgain(current.i, row.s);
    } else {
      var row2 = recordAnswer('wrong');
      scheduleAgain(current.i, row2.s);
      showFeedback('错误', '正确释义：' + current.mean, 'is-bad');
    }
  }
  function markFuzzy() {
    if (!current || current.answered) return;
    current.answered = true;
    lockOptions();
    var row = recordAnswer('fuzzy');
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
    if (name === 'study') { refreshInlineRank(); }
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
    simIndex = null;
    simCache = {};
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

  /* 单词本、词条详情用的词库单独放一个变量。以前这里直接改 bank / bankId，
     于是「背四级 → 回首页 → 打开六级单词本 → 返回」之后，正在背的那张牌
     还停在四级，bankId 却成了六级：答案会记进六级，接着按「下一张」还会
     拿到越界的下标直接报错。 */
  var booksBank = null;
  function ensureBankLoaded(id, cb) {
    if (booksBank && booksBank.id === id) { cb(true); return; }
    var meta = bankMeta(id);
    if (!meta) { cb(false); return; }
    var g = globalNameOf(meta);
    if (window[g] && window[g].length) { booksBank = { id: meta.id, name: meta.name, words: window[g] }; cb(true); return; }
    var s = document.createElement('script');
    s.src = meta.file;
    s.onload = function () {
      var data = window[g];
      if (!data || !data.length) { cb(false); return; }
      booksBank = { id: meta.id, name: meta.name, words: data };
      cb(true);
    };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }

  function bookRows(which) {
    var st = bankState(booksBankId);
    var rows = [];
    if (!booksBank) return rows;
    var want = which === 'todo' ? TODO_STATES : KNOWN_STATES;
    for (var idx = 0; idx < booksBank.words.length; idx++) {
      var row = booksBank.words[idx];
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
    if (!booksBank || booksBank.id !== booksBankId) {
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
      booksHintEl.textContent = '待豪本：' + total + ' 个词，累计没认出来 ' + sumU + ' 次。答错/不认识之后要连对 '
        + LADDER + ' 次才进「豪到了」（连对 2 次先降成模糊的频率）。';
    } else {
      var perfect = rows.filter(function (r) { return (r.s.c || 0) >= LADDER; }).length;
      booksHintEl.textContent = '豪到了：' + total + ' 个词，都是连对 ' + LADDER + ' 次以上的。答对过的词也会再出现，只是频率低。';
      if (perfect !== total) booksHintEl.textContent += '（有 ' + (total - perfect) + ' 个是老版本记录的）';
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
      t1.className = 'qc-tag ' + (r.s.s === 'fuzzy' ? 'qc-tag--fuzzy' : (r.s.s === 'known' ? 'qc-tag--ok' : 'qc-tag--bad'));
      t1.textContent = STATE_LABEL[r.s.s] || '看过';
      tags.appendChild(t1);
      if (booksWhich === 'todo') {
        var t2 = document.createElement('span');
        t2.className = 'qc-tag qc-tag--bad';
        t2.textContent = '未认出 ' + (r.s.u || 0) + ' 次';
        tags.appendChild(t2);
        var t3 = document.createElement('span');
        t3.className = 'qc-tag';
        t3.textContent = '对 ' + (r.s.r || 0) + ' · 错 ' + ((r.s.x || 0) + (r.s.u || 0));
        tags.appendChild(t3);
        if (r.s.c > 0) {
          var t5 = document.createElement('span');
          t5.className = 'qc-tag qc-tag--fuzzy';
          t5.textContent = '已连对 ' + r.s.c + ' / ' + LADDER + ' 次';
          tags.appendChild(t5);
        }
        if (r.s.f) {
          var t4 = document.createElement('span');
          t4.className = 'qc-tag qc-tag--fuzzy';
          t4.textContent = '模糊 ' + r.s.f + ' 次';
          tags.appendChild(t4);
        }
      } else {
        /* 豪到了里显示「认出次数」 */
        var k1 = document.createElement('span');
        k1.className = 'qc-tag qc-tag--ok';
        k1.textContent = '认出 ' + (r.s.r || 0) + ' 次';
        tags.appendChild(k1);
        var k2 = document.createElement('span');
        k2.className = 'qc-tag';
        k2.textContent = '连对 ' + (r.s.c || 0) + ' 次';
        tags.appendChild(k2);
        if (r.s.u) {
          var k3 = document.createElement('span');
          k3.className = 'qc-tag qc-tag--bad';
          k3.textContent = '以前没认出 ' + r.s.u + ' 次';
          tags.appendChild(k3);
        }
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
      /* 清空之后立刻把新数字（0）报上去，排行榜里的数据也跟着清 */
      pushProgress(true, booksBankId);
      renderBooks();
      if (homeTip) homeTip.textContent = '已清空 ' + changed + ' 个词的记录（排行榜里的词数也一起更新了）。';
    });
  }

  /* ---------- 单词详情 ---------- */
  var detailWordKey = '';
  var detailLoadingChunk = {};
  var detailWaiters = {};

  /* 词条数据按「每桶 40 个词」切好，索引里存每桶的第一个词，二分找桶 */
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
    if (booksBank && booksBank.id === id) {
      for (var i = 0; i < booksBank.words.length; i++) { if (booksBank.words[i][0].toLowerCase() === detailWordKey) { known = booksBank.words[i]; break; } }
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
    var wantWord = detailWordKey;
    loadDetailChunk(detailWordKey, function (chunk) {
      /* 网络慢的时候连点两个词，先回来的那份可能是上一个词，别串到这一页上 */
      if (view !== 'detail' || detailWordKey !== wantWord) return;
      renderDetail(chunk ? chunk[wantWord] : null, known);
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
      line(detailBody, '这个词暂时没有更详细的资料（例句、固定搭配、衍生词、词根词缀、词源）。', 'qc-sec__note');
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
      var exBox = section(rec.exk === 'p' ? '常用说法' : '例句');
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

    /* 词源：这个词是从哪来的 */
    if (rec.et && (rec.et.o || rec.et.h || rec.et.r)) {
      var etBox = section('词源');
      if (rec.et.o || rec.et.r) {
        var l1 = '来自 ' + (rec.et.o || '不详');
        if (rec.et.r) l1 += ' · ' + rec.et.r;
        line(etBox, l1);
      }
      if (rec.et.h) line(etBox, rec.et.h, 'qc-et__history');
      detailBody.appendChild(etBox);
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
    if (!rec.dv) missing.push('衍生词');
    if (!rec.rt) missing.push('词根词缀');
    if (!rec.et) missing.push('词源');
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
    /* 连点词库标签时，先发出去的那份回来别把新词库的榜盖了 */
    var wantBank = rankBank;
    var wantName = meta ? meta.name : '';
    /* 先把自己的词数报上去，报完再取榜 —— 不然刚背完的分数这趟看不到 */
    var pushes = [pushProgress(true, wantBank)];
    if (store.lastBank && store.lastBank !== wantBank) pushes.push(pushProgress(true, store.lastBank));
    Promise.all(pushes).then(function () {
      return API.qianciBoard(wantBank);
    }).then(function (r) {
      rankBusy = false;
      if (wantBank !== rankBank) { renderRank(); return; }
      if (r.status === 401) { rankHint.textContent = '登录之后就能看到好友的词数了。'; return; }
      if (r.status !== 200 || !r.data || !r.data.ok) {
        rankHint.textContent = (r.data && r.data.error) ? ('排行榜读不到：' + r.data.error) : '排行榜暂时读不到，过会儿再刷新。';
        return;
      }
      var list = r.data.list || [];
      if (!list.length) { rankHint.textContent = '榜上还没有人。'; return; }
      var friends = Math.max(0, list.length - 1);
      rankHint.textContent = wantName + '：自己 + ' + friends + ' 位好友，按「豪到了」的词数排。';
      list.forEach(function (item) {
        var row = document.createElement('li');
        row.className = 'qc-item qc-rank__row' + (item.me ? ' is-me' : '');
        var no = document.createElement('span');
        no.className = 'qc-rank__no';
        no.textContent = String(item.rank || '');
        row.appendChild(no);
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
        row.appendChild(body);
        rankList.appendChild(row);
      });
      renderInlineRank(list, wantName);
    });
  }

  /* ---------- 背单词时下面的小榜 ---------- */
  var inlineBusy = false;
  function renderInlineRank(list, bankName) {
    if (!inlineEl) return;
    if (!list) return;
    inlineEl.hidden = false;
    inlineHint.textContent = (bankName || '') + ' 好友榜（按豪到了的词数）';
    inlineList.innerHTML = '';
    var top = list.slice(0, 5);
    var mine = null;
    for (var i = 0; i < list.length; i++) { if (list[i].me) mine = list[i]; }
    if (mine && top.indexOf(mine) < 0) top.push(mine);
    top.forEach(function (item) {
      var row = document.createElement('li');
      row.className = 'qc-item qc-rank__row' + (item.me ? ' is-me' : '');
      var no = document.createElement('span');
      no.className = 'qc-rank__no';
      no.textContent = String(item.rank || '');
      row.appendChild(no);
      var body = document.createElement('div');
      body.className = 'qc-item__body';
      var name = document.createElement('strong');
      name.className = 'qc-item__word';
      name.textContent = item.name + (item.me ? '（我）' : '');
      body.appendChild(name);
      var line2 = document.createElement('div');
      line2.className = 'qc-item__mean';
      line2.textContent = '豪到了 ' + item.known + ' 词';
      body.appendChild(line2);
      row.appendChild(body);
      inlineList.appendChild(row);
    });
  }

  function currentStudyBank() { return bankId || store.lastBank || 'cet4'; }
  function refreshInlineRank() {
    if (!inlineEl || inlineBusy) return;
    if (view !== 'study') return;              /* 这个小榜只在背单词页面里 */
    var API = window.JHJX_API;
    if (!API || !API.serviceReady()) { inlineEl.hidden = true; return; }
    if (!API.token()) {
      inlineEl.hidden = false;
      inlineHint.textContent = '登录之后，这里会显示好友的「豪到了」排行。';
      inlineList.innerHTML = '';
      return;
    }
    var wantBank = currentStudyBank();
    inlineBusy = true;
    /* 这里不强制上报：词数没变就不必再写一次服务端，只把榜读回来 */
    Promise.all([pushProgress(false, wantBank)]).then(function () {
      return API.qianciBoard(wantBank);
    }).then(function (r) {
      inlineBusy = false;
      /* 中途换了词库、或者已经离开背单词页面，这一份就丢掉 */
      if (view !== 'study' || wantBank !== currentStudyBank()) return;
      if (r.status !== 200 || !r.data || !r.data.ok) { inlineEl.hidden = true; return; }
      var meta = bankMeta(wantBank);
      renderInlineRank(r.data.list || [], meta ? meta.name : '');
    });
  }
  var inlineTimer = 0;
  function scheduleInlineRank() {
    if (!inlineEl || view !== 'study') return;
    if (inlineTimer) return;
    inlineTimer = setTimeout(function () { inlineTimer = 0; refreshInlineRank(); }, 3000);
  }

  /* 把「豪到了」的词数报给服务端（给好友排行榜用），几秒合并一次。
     注意：不要求词库已经加载进来 —— 只数本机记了多少个词，所以
     一进来就打开排行榜（还没点「开始背」）也能把自己的数报上去。 */
  var pushTimer = 0;
  function schedulePush() {
    var API = window.JHJX_API;
    if (!API || !API.serviceReady() || !API.token()) return;
    if (pushTimer) return;
    pushTimer = setTimeout(function () { pushTimer = 0; pushProgress(false); }, 4000);
  }
  function pushProgress(force, bank) {
    var API = window.JHJX_API;
    if (!API || !API.serviceReady() || !API.token()) return Promise.resolve(null);
    var id = bank || bankId || store.lastBank || '';
    if (!id) return Promise.resolve(null);
    var known = knownCount(id);
    var todo = todoCount(id);
    /* 待豪本的数也一起比：只答错、没进「豪到了」的时候 known 没变，
       但榜单上的「待豪本」词数应该跟着动 */
    var sig = known + '/' + todo;
    if (!force && store.pushed[id] === sig) return Promise.resolve(null);
    var mark = function (r) {
      var good = !!(r && r.status === 200 && r.data && r.data.ok);
      /* 报成功了才记下来；没成功就忘掉，下次接着报，免得丢一份就永远不补了 */
      if (good) store.pushed[id] = sig;
      else if (store.pushed[id] === sig) delete store.pushed[id];
      saveStore();
      return r;
    };
    return API.qianciProgress(id, known, todo).then(mark, function () { mark(null); return null; });
  }
  /* 两个词库都报一遍（清空、打开排行榜之前用） */
  function pushAll(force) {
    var list = [];
    for (var i = 0; i < BANKS.length; i++) list.push(pushProgress(force, BANKS[i].id));
    return Promise.all(list);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pushAll(false);
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
  if (inlineRefresh) inlineRefresh.addEventListener('click', function () { inlineBusy = false; refreshInlineRank(); });
  if (inlineOpen) inlineOpen.addEventListener('click', function () { openRank(bankId || store.lastBank || 'cet4'); });
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
      return { s: row.s, c: row.c || 0, r: row.r || 0, u: row.u || 0, x: row.x || 0, f: row.f || 0, n: row.n || 0 };
    },
    detail: function () {
      return { word: detailWordKey, open: view === 'detail', text: detailBody ? detailBody.textContent : '' };
    },
    /* 当前词库里、某个本子里的词（自检用，不依赖单词本视图开没开） */
    books: function (which) {
      var src = (booksBank && booksBank.id === booksBankId) ? booksBank : bank;
      if (!src) return null;
      var id = src.id;
      var st = bankState(id);
      var want = (which || booksWhich) === 'todo' ? TODO_STATES : KNOWN_STATES;
      var out = [];
      for (var i = 0; i < src.words.length; i++) {
        var row = src.words[i];
        var s = st.words[row[0].toLowerCase()];
        if (!s || want.indexOf(s.s) < 0) continue;
        out.push({ word: row[0], s: s.s, c: s.c || 0, u: s.u || 0, r: s.r || 0 });
      }
      return out;
    },
    recent: function () { return recent.slice(); },
    weights: function () { return DECK_WEIGHT; },
    /* 形近词（自检用） */
    similarOf: function (w) {
      if (!bank) return null;
      var idx = -1;
      for (var i = 0; i < bank.words.length; i++) {
        if (bank.words[i][0].toLowerCase() === String(w).toLowerCase()) { idx = i; break; }
      }
      if (idx < 0) return null;
      return similarIndices(idx).map(function (j) { return bank.words[j][0]; });
    },
    /* 把选项里的释义反查成单词（自检用） */
    wordOfMean: function (mean) {
      if (!bank) return null;
      for (var i = 0; i < bank.words.length; i++) {
        if (bank.words[i][2] === mean) return bank.words[i][0];
      }
      return null;
    },
  };

  showView('home');
})();
