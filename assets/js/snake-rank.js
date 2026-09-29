/* =========================================================
   嘉游 · 贪吃蛇：好友分数排行榜
   ---------------------------------------------------------
   分数存在服务端（一个人只留最高分），排行榜只列「自己 + 好友」。
   没登录就只提示去登录，不显示任何人的分数。
   ========================================================= */
(function () {
  'use strict';

  var API = window.JHJX_API;
  var listEl = document.getElementById('snRankList');
  var hintEl = document.getElementById('snRankHint');
  var refreshBtn = document.getElementById('snRankRefresh');
  if (!listEl || !hintEl) return;

  var busy = false;
  var lastAt = 0;

  function setHint(text) { hintEl.textContent = text; }
  function clearList() { listEl.innerHTML = ''; }

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
    var li = document.createElement('li');
    li.className = 'sn-rank__row' + (item.me ? ' is-me' : '') + (index < 3 && item.best > 0 ? ' is-top' : '');
    li.setAttribute('data-user', String(item.id));

    var rank = document.createElement('span');
    rank.className = 'sn-rank__no';
    rank.textContent = String(item.rank || index + 1);
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

  function render(data) {
    var list = (data && data.list) || [];
    clearList();
    if (!list.length) {
      setHint('还没有人交过分数，玩一局就是第一名。');
      return;
    }

    var played = list.filter(function (x) { return x.best > 0; }).length;
    var friends = Math.max(0, list.length - 1);
    if (!friends) {
      setHint('还没有好友一起排。加了好友之后，这里就是你们俩的分数。');
    } else {
      setHint('自己 + ' + friends + ' 位好友，' + played + ' 人已经有分数。');
    }

    list.forEach(function (item, i) { listEl.appendChild(renderRow(item, i)); });
  }

  function refresh() {
    if (busy) return;
    if (!API) { notice('排行榜加载失败，刷新页面再试试。'); return; }
    if (!API.serviceReady()) { notice('账号服务还没开通，先玩着，分数存在本机。'); return; }
    if (!API.token()) { guest(); return; }

    busy = true;
    setHint('正在读取…');
    clearList();
    API.snakeBoard().then(function (r) {
      busy = false;
      if (r.status === 401) { guest(); return; }
      if (r.status !== 200 || !r.data || !r.data.ok) {
        /* 403 之类是有话要说的（比如账号被停用），别一律当成「没登录」 */
        notice((r.data && r.data.error) ? ('排行榜读不到：' + r.data.error) : '排行榜暂时读不到，过会儿再刷新。');
        return;
      }
      lastAt = Date.now();
      /* 服务端记录比本机高（比如换过设备玩），把本机最高分抬上去 */
      if (r.data.me && window.jhjxSnake && window.jhjxSnake.syncBest) {
        window.jhjxSnake.syncBest(r.data.me.best);
      }
      render(r.data);
    });
  }

  /* 一局结束就把分数交上去（只交大于 0 的）。
     服务端要求两次提交之间有间隔：赶上连着重开两局就隔一会儿再补交一次，
     别把这一局的分数悄悄丢了。 */
  function submit(score, retried) {
    if (!API || !API.serviceReady() || !API.token()) return;
    if (!(score > 0)) return;
    API.snakeScore(score).then(function (r) {
      if (r.status === 429 && !retried) {
        setTimeout(function () { submit(score, true); }, 1700);
        return;
      }
      if (r.status === 200 && r.data && r.data.ok) {
        if (r.data.improved) setHint('这一局的 ' + score + ' 分已经是你的最高分，排行榜马上更新。');
        refresh();
      } else if (r.status === 429) {
        refresh();   /* 补交也没赶上，至少把榜单刷一次 */
      }
    });
  }

  if (refreshBtn) refreshBtn.addEventListener('click', refresh);

  /* 本机登录状态变了（在别的标签页登录/退出）就重新拉一次 */
  window.addEventListener('jhjx:session', refresh);
  window.addEventListener('storage', function (e) {
    if (e && (e.key === 'jhjx-account-token' || e.key === 'jhjx-account-user')) refresh();
  });

  window.jhjxSnakeRank = { submit: submit, refresh: refresh, lastAt: function () { return lastAt; } };
  refresh();
})();
