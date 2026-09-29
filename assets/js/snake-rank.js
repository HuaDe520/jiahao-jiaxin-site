/* =========================================================
   嘉游 · 贪吃蛇：好友分数排行榜
   ---------------------------------------------------------
   分数存在服务端（一个人每种速度只留最高分），榜上只有「自己 + 好友」。
   三种模式（悠闲 / 标准 / 挑战）各一张榜，和上面的「模式」是同一个设置：
   这里点一下换榜，游戏那边也会跟着换速度。
   没登录就只提示去登录，不显示任何人的分数。
   ========================================================= */
(function () {
  'use strict';

  var API = window.JHJX_API;
  var listEl = document.getElementById('snRankList');
  var hintEl = document.getElementById('snRankHint');
  var refreshBtn = document.getElementById('snRankRefresh');
  var modesEl = document.getElementById('snRankModes');
  var MODE_NAMES = { easy: '悠闲', normal: '标准', hard: '挑战' };
  var MODES = ['easy', 'normal', 'hard'];
  if (!listEl || !hintEl) return;

  var busy = false;
  var lastAt = 0;
  var pushedLocal = false;   /* 本机最高分只补交一次，免得和刷新互相触发 */
  var lastData = null;       /* 最近一次拿到的榜单：交分数失败时还能把它显示出来 */
  var mode = 'normal';

  function setHint(text) { hintEl.textContent = text; }
  function clearList() { listEl.innerHTML = ''; }

  function currentMode() {
    var m = (window.jhjxSnake && window.jhjxSnake.mode) ? window.jhjxSnake.mode() : mode;
    return MODES.indexOf(m) >= 0 ? m : 'normal';
  }

  /* 两边的「模式」是同一个设置：点榜单上的标签，游戏也跟着换 */
  function setMode(next) {
    if (MODES.indexOf(next) < 0) return;
    mode = next;
    if (window.jhjxSnake && window.jhjxSnake.setMode) {
      window.jhjxSnake.setMode(next);   /* 它会发事件回来，刷新由事件负责 */
      return;
    }
    paintModes();
    refresh();
  }

  function paintModes() {
    if (!modesEl) return;
    var all = modesEl.querySelectorAll('.sn-rank__mode');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.toggle('is-active', all[i].getAttribute('data-mode') === mode);
    }
  }

  /* 一个「去登录」的按钮（放进 li 里，ol 的直接子元素只能是 li） */
  function guest() {
    clearList();
    setHint('登录之后，就能看到自己和好友的分数了。');
    var li = document.createElement('li');
    li.className = 'sn-rank__guest';
    var a = document.createElement('a');
    a.className = 'sn-rank__go';
    a.href = 'account.html';
    a.textContent = '去我的账号登录';
    li.appendChild(a);
    listEl.appendChild(li);
  }

  function notice(text) {
    clearList();
    setHint(text);
  }

  function scoreText(item) {
    return item.best > 0 ? String(item.best) : '还没交过';
  }

  function renderRow(item, index) {
    var rankNo = Number(item.rank) > 0 ? Number(item.rank) : index + 1;
    var li = document.createElement('li');
    li.className = 'sn-rank__row' + (item.me ? ' is-me' : '') + (rankNo <= 3 && item.best > 0 ? ' is-top' : '');
    li.setAttribute('data-user', String(item.id));

    var rank = document.createElement('span');
    rank.className = 'sn-rank__no';
    rank.textContent = String(rankNo);
    li.appendChild(rank);

    var avatar = document.createElement('span');
    avatar.className = 'sn-rank__avatar';
    if (item.avatar) {
      var img = document.createElement('img');
      img.src = API && API.asset ? API.asset(item.avatar) : item.avatar;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onerror = function () { this.style.display = 'none'; };
      avatar.appendChild(img);
    } else {
      avatar.textContent = String(item.name || '?').slice(0, 1);
    }
    li.appendChild(avatar);

    var name = document.createElement('span');
    name.className = 'sn-rank__name';
    name.textContent = item.name + (item.me ? '（我）' : '');
    li.appendChild(name);

    var score = document.createElement('strong');
    score.className = 'sn-rank__score' + (item.best > 0 ? '' : ' is-empty');
    score.textContent = scoreText(item);
    li.appendChild(score);

    return li;
  }

  function render(data, note) {
    var list = (data && data.list) || [];
    clearList();
    if (!list.length) {
      setHint('还没有人交过分数，玩一局就是第一名。');
      return;
    }

    var played = list.filter(function (x) { return x.best > 0; }).length;
    var friends = Math.max(0, list.length - 1);
    var modeName = MODE_NAMES[mode] || '标准';
    if (note) {
      setHint(note);
    } else if (!friends) {
      setHint('「' + modeName + '」模式还没有好友一起排。加了好友之后，这里就是你们俩的分数。');
    } else {
      setHint('「' + modeName + '」模式：自己 + ' + friends + ' 位好友，' + played + ' 人已经有分数。');
    }

    list.forEach(function (item, i) { listEl.appendChild(renderRow(item, i)); });
  }

  function refresh(note) {
    if (busy) return;
    if (!API) { notice('排行榜加载失败，刷新页面再试试。'); return; }
    if (!API.serviceReady()) { notice('账号服务还没开通，先玩着，分数存在本机。'); return; }
    mode = currentMode();
    paintModes();
    if (!API.token()) { guest(); return; }

    busy = true;
    setHint('正在读取…');
    clearList();
    var want = mode;
    API.snakeBoard(want).then(function (r) {
      busy = false;
      /* 请求发出去的这段时间里用户可能又换了模式，那这份数据就作废 */
      if (want !== currentMode()) return;
      if (r.status === 401) { guest(); return; }
      if (r.status !== 200 || !r.data || !r.data.ok) {
        /* 403 之类是有话要说的（比如账号被停用），别一律当成「没登录」 */
        notice((r.data && r.data.error) ? ('排行榜读不到：' + r.data.error) : '排行榜暂时读不到，过会儿再刷新。');
        return;
      }
      lastAt = Date.now();
      lastData = r.data;
      /* 服务端记录比本机高（比如换过设备玩），把本机最高分抬上去 */
      var serverBest = (r.data.me && Number(r.data.me.best)) || 0;
      if (window.jhjxSnake && window.jhjxSnake.syncBest) {
        window.jhjxSnake.syncBest(serverBest, want);
      }
      /* 反过来，本机最高分比服务端高（登录之前玩过），补交一次 */
      var localBest = (window.jhjxSnake && window.jhjxSnake.bestOf) ? Number(window.jhjxSnake.bestOf(want)) || 0 : 0;
      if (!pushedLocal && localBest > serverBest) {
        pushedLocal = true;
        submit(localBest, want);
        return;   /* 交完 submit 自己会再刷一次榜 */
      }
      render(r.data, note);
    });
  }

  /* 一局结束就把分数交上去（只交大于 0 的）。
     服务端要求两次提交之间有间隔：赶上连着重开两局就隔一会儿再补交一次，
     别把这一局的分数悄悄丢了。
     不管交成没交成，最后都要把榜单显示出来 —— 不能停在「正在读取…」。 */
  function submit(score, forMode, retried) {
    if (!API || !API.serviceReady() || !API.token()) return;
    if (!(score > 0)) return;
    var m = MODES.indexOf(forMode) >= 0 ? forMode : currentMode();
    API.snakeScore(score, m).then(function (r) {
      if (r.status === 429 && !retried) {
        setTimeout(function () { submit(score, m, true); }, 1700);
        return;
      }
      if (r.status === 200 && r.data && r.data.ok) {
        /* 交完把榜切到刚玩的这个模式，用户马上能看到自己排第几 */
        if (currentMode() !== m && window.jhjxSnake && window.jhjxSnake.setMode) {
          window.jhjxSnake.setMode(m);
          return;   /* setMode 会发事件回来刷新 */
        }
        /* 刷新之后把这一局的结果留在提示行上，别让用户以为没交上去 */
        refresh(r.data.improved
          ? ('刚交了这一局：' + MODE_NAMES[m] + ' ' + score + ' 分，是你的最高分。')
          : ('刚交了这一局：' + MODE_NAMES[m] + ' ' + score + ' 分。'));
        return;
      }
      var why = (r.data && r.data.error) ? r.data.error : (r.status === 429 ? '交得太频繁了' : '网络不太好');
      if (lastData) render(lastData, '这一局（' + MODE_NAMES[m] + ' ' + score + ' 分）没能交上：' + why + '。');
      else notice('这一局没能交上：' + why + '。');
    });
  }

  /* 注意：这两个监听器要把事件对象挡在外面，不然它会被当成「提示文案」 */
  if (refreshBtn) refreshBtn.addEventListener('click', function () { refresh(); });
  if (modesEl) {
    modesEl.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.sn-rank__mode') : null;
      if (!btn) return;
      setMode(btn.getAttribute('data-mode'));
    });
  }

  /* 游戏那边换了模式（点速度、或者一局结束自动切榜）就跟着换榜 */
  window.addEventListener('jhjx:snake-mode', function () { refresh(); });

  /* 本机登录状态变了（在别的标签页登录/退出）就重新拉一次 */
  window.addEventListener('jhjx:session', function () { refresh(); });
  window.addEventListener('storage', function (e) {
    if (e && (e.key === 'jhjx-account-token' || e.key === 'jhjx-account-user')) refresh();
  });

  window.jhjxSnakeRank = {
    submit: submit,
    refresh: refresh,
    setMode: setMode,
    mode: currentMode,
    lastAt: function () { return lastAt; }
  };
  refresh();
})();
