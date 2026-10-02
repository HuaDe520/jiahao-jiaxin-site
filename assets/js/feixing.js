/* =========================================================
   嘉盟 · 超豪飞行派对（联机飞行棋）
   ---------------------------------------------------------
   这一页只做三件事：把房间号喊出去、把棋盘画出来、把服务器的
   局面照着画一遍。规则一律不在这里算 —— 服务器会告诉我「哪几架
   现在能走」（state.legal），我只负责让它们一闪一闪，点哪架就把
   哪架的编号报上去。
   几个约定：
   · 飞机的编号 0~15，颜色 = 编号 ÷ 4（红 0 黄 1 蓝 2 绿 3）；
     位置 -1 在机场，0~50 在外圈（0 是自己那家的起点格），
     51~56 在自己跑道里，57 到家。
   · 每 1.5 秒问一次房间。seq 没变就当没这回事，不重画、不重播
     动画；页面切到后台就先不问，切回来立刻补一次。
   ========================================================= */
(function () {
  'use strict';

  var API = window.JHJX_API;
  var COLOR_NAME = ['红', '黄', '蓝', '绿'];
  var POLL_MS = 1500;     /* 问房间的间隔 */
  var STEP_MS = 120;      /* 动画里每走一格用多久 */

  function $(id) { return document.getElementById(id); }
  function colorOf(id) { return Math.floor(Number(id) / 4); }
  function slotOf(id) { return Number(id) % 4; }

  var S = {
    board: null,
    boardReady: false,
    pieces: {},        /* 编号 → 棋盘上那个圆点 */
    room: null,
    code: '',
    legalMap: {},
    sig: '',           /* 这一份局面「长什么样」，一样就不重画 */
    lastSeq: -1,
    mvSig: '',         /* 上一步走的是什么，用来判断要不要播动画 */
    timer: 0,
    polling: false,
    animating: false,
    queued: null,      /* 动画期间收到的新局面，动画完再画 */
    busy: false,
    inviteLoaded: false,
    activeColors: [],  /* 这一局在用的颜色（两个人就是两家，只画 8 架飞机） */
  };
  var msgTimer = 0;

  /* ---------------- 小工具 ---------------- */
  function msg(text, isError) {
    var el = $('fxMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'fx-msg' + (isError ? ' is-error' : '');
    if (msgTimer) clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(function () { el.textContent = ''; }, 8000);
  }

  function realError(res, fallback) {
    return (res && res.data && res.data.error) || fallback;
  }

  function dot(color) {
    var s = document.createElement('span');
    s.className = 'fx-dot';
    s.setAttribute('data-c', String(color));
    s.textContent = COLOR_NAME[color] || '?';
    return s;
  }

  function colorsOf(colors) {
    var box = document.createElement('span');
    box.className = 'fx-seat__colors';
    (colors || []).forEach(function (c) { box.appendChild(dot(c)); });
    return box;
  }

  function loggedIn() {
    try { return !!(API && API.token && API.token()); } catch (e) { return false; }
  }

  function showGuest() {
    stopPoll();
    $('fxGuest').hidden = false;
    $('fxMain').hidden = true;
  }

  /* ---------------- 棋盘几何 ----------------
     服务器给的是 [行, 列]，行 0 在上、列 0 在左；画的时候要 +1
     才是 CSS 网格里的第几行第几列。 */
  function planeCell(id, p) {
    var b = S.board;
    if (!b) return null;
    var color = colorOf(id);
    var n = Number(p);
    if (!isFinite(n)) return null;
    if (n < 0) return b.hangars[color][slotOf(id)];
    if (n <= 50) return b.ring[(b.startIndex[color] + n) % b.ring.length];
    if (n <= 56) return b.homes[color][n - 51];
    return b.center;
  }

  function putCell(el, rc) {
    el.style.gridRow = String(rc[0] + 1);
    el.style.gridColumn = String(rc[1] + 1);
  }

  /* 把一架飞机摆到某个位置上。同一格上挤了好几架就稍微岔开一点，
     不然叠在一起看不出是几架 */
  function placePiece(el, id, p, idx, count) {
    var rc = planeCell(id, p);
    if (!rc || !S.board) return;
    el.style.left = ((rc[1] + 0.5) / S.board.cols * 100) + '%';
    el.style.top = ((rc[0] + 0.5) / S.board.rows * 100) + '%';
    var dx = 0;
    var dy = 0;
    if (count > 1) {
      dx = (idx % 2) ? 30 : -30;
      dy = (idx > 1) ? 30 : -30;
    }
    el.style.setProperty('--dx', dx + '%');
    el.style.setProperty('--dy', dy + '%');
    el.setAttribute('data-pos', String(p));
    el.setAttribute('data-row', String(rc[0]));
    el.setAttribute('data-col', String(rc[1]));
  }

  /* 一次性把外圈、跑道、机场和 16 架飞机搭出来，之后只挪飞机 */
  function ensureBoard() {
    if (S.boardReady || !S.board) return;
    var b = S.board;
    var board = $('fxBoard');
    board.innerHTML = '';
    S.pieces = {};

    /* 四角的机场底盘：红左上、黄右上、蓝右下、绿左下，各占 6×6 */
    var corners = [[1, 1, 0], [1, 10, 1], [10, 10, 2], [10, 1, 3]];
    corners.forEach(function (c) {
      var bg = document.createElement('div');
      bg.className = 'fx-hangar-bg';
      bg.setAttribute('data-c', String(c[2]));
      bg.style.gridRow = (c[0] + 1) + ' / span 6';
      bg.style.gridColumn = (c[1] + 1) + ' / span 6';
      board.appendChild(bg);
    });

    /* 外圈 52 格，按服务器给的颜色上色，四家的起点格加粗 */
    b.ring.forEach(function (rc, i) {
      var cell = document.createElement('div');
      cell.className = 'fx-cell fx-cell--track' + (b.startIndex.indexOf(i) >= 0 ? ' is-start' : '');
      cell.setAttribute('data-c', String(b.ringColor[i]));
      putCell(cell, rc);
      board.appendChild(cell);
    });

    /* 四家各自的 6 格跑道，越靠中心越深 */
    b.homes.forEach(function (list, color) {
      list.forEach(function (rc, j) {
        var cell = document.createElement('div');
        cell.className = 'fx-cell fx-cell--home' + (j === 5 ? ' is-last' : '');
        cell.setAttribute('data-c', String(color));
        putCell(cell, rc);
        board.appendChild(cell);
      });
    });

    /* 机场里的 16 个停机位 */
    b.hangars.forEach(function (list, color) {
      list.forEach(function (rc) {
        var cell = document.createElement('div');
        cell.className = 'fx-cell fx-cell--hangar';
        cell.setAttribute('data-c', String(color));
        putCell(cell, rc);
        board.appendChild(cell);
      });
    });

    var goal = document.createElement('div');
    goal.className = 'fx-cell fx-cell--goal';
    putCell(goal, b.center);
    board.appendChild(goal);

    var layer = document.createElement('div');
    layer.className = 'fx-pieces';
    for (var id = 0; id < 16; id++) {
      var pl = document.createElement('button');
      pl.type = 'button';
      pl.className = 'fx-plane';
      pl.setAttribute('data-c', String(colorOf(id)));
      pl.setAttribute('data-plane', String(id));
      pl.setAttribute('aria-label', COLOR_NAME[colorOf(id)] + '色第 ' + (slotOf(id) + 1) + ' 架飞机');
      (function (pid) {
        pl.addEventListener('click', function () { onPlaneClick(pid); });
      })(id);
      layer.appendChild(pl);
      S.pieces[id] = pl;
    }
    board.appendChild(layer);
    S.boardReady = true;
    applyActiveColors(S.activeColors);

    /* 老一点的 WebView 不认 aspect-ratio，棋盘会塌成 0 高。
       量一个正方形高度兜着，窗口变了再量一次 */
    if (!(window.CSS && window.CSS.supports && window.CSS.supports('aspect-ratio', '1 / 1'))) {
      var fit = function () { board.style.height = Math.round(board.clientWidth) + 'px'; };
      fit();
      window.addEventListener('resize', fit);
    }
  }

  /* 照着服务器给的 16 个位置把飞机摆好 */
  function syncPieces(planes) {
    if (!S.board || !planes) return;
    var groups = {};
    var id, rc, key;
    for (id = 0; id < planes.length; id++) {
      rc = planeCell(id, planes[id]);
      if (!rc) continue;
      key = rc[0] + ',' + rc[1];
      if (!groups[key]) groups[key] = [];
      groups[key].push(id);
    }
    for (id = 0; id < planes.length; id++) {
      var el = S.pieces[id];
      if (!el) continue;
      el.classList.remove('is-hit');
      el.classList.remove('is-moving');
      rc = planeCell(id, planes[id]);
      if (!rc) continue;
      key = rc[0] + ',' + rc[1];
      var list = groups[key] || [id];
      placePiece(el, id, planes[id], list.indexOf(id), list.length);
    }
  }

  /* 服务器说能走的飞机才让它闪、才点得动 */
  function renderLegal(room) {
    var legal = (room.state && room.state.legal) || [];
    S.legalMap = {};
    legal.forEach(function (m) { if (m && m.plane != null) S.legalMap[m.plane] = m; });
    Object.keys(S.pieces).forEach(function (k) {
      var el = S.pieces[k];
      if (S.legalMap[k]) el.classList.add('is-legal');
      else el.classList.remove('is-legal');
    });
    refreshRoll();
  }

  function clearLegal() {
    S.legalMap = {};
    Object.keys(S.pieces).forEach(function (k) { S.pieces[k].classList.remove('is-legal'); });
  }

  /* ---------------- 骰子与「掷骰子」 ---------------- */
  function refreshRoll() {
    var room = S.room;
    var st = (room && room.state) || null;
    var roll = $('fxRoll');
    var hint = $('fxDiceHint');
    if (!roll) return;
    var playing = !!room && room.status === 'playing';
    roll.hidden = !playing;
    var myTurn = !!(room && room.me && playing && room.me.isTurn);
    var rolled = !!(st && Number(st.dice));
    roll.disabled = !myTurn || rolled || !!S.busy || !!S.animating;
    if (!hint) return;
    if (!playing) { hint.textContent = ''; return; }
    if (!myTurn) {
      var cur = (room.seats || [])[st ? st.turn : 0];
      hint.textContent = cur ? '等 ' + cur.name + ' 掷骰子' : '等别人掷骰子';
      return;
    }
    if (rolled) {
      hint.textContent = legalList().length ? '点一架闪着的飞机' : '这一点没有能走的飞机';
      return;
    }
    hint.textContent = '轮到你了，掷骰子';
  }

  function legalList() {
    return Object.keys(S.legalMap).map(function (k) { return S.legalMap[k]; });
  }

  /* ---------------- 走到哪画到哪 ---------------- */
  function moveSigOf(mv) {
    if (!mv) return '';
    return [mv.kind, mv.seat, mv.plane, mv.dice, mv.from, mv.to, (mv.path || []).join('.')].join('|');
  }

  function applyRoom(room, opts) {
    opts = opts || {};
    if (!room) return;
    /* 动画没播完就来新消息：先排队，别把飞机挪乱了 */
    if (S.animating) { S.queued = room; return; }

    var st = room.state || null;
    var seq = st ? Number(st.seq) : -1;
    var seatSig = (room.seats || []).map(function (s) {
      return s.seat + ':' + s.userId + ':' + (s.colors || []).join('') + ':' + (s.isHost ? 'h' : '');
    }).join(',');
    var sig = [room.status, seq, seatSig, room.canStart ? 1 : 0, room.me ? room.me.seat : '-'].join('|');
    var mvSig = st ? moveSigOf(st.lastMove) : '';
    var changed = sig !== S.sig;
    if (!changed && !opts.force) return;

    /* 只有「刚有人走了一步」才播动画：自己开场看到的一半局面不重播 */
    var animate = !!st && !!st.lastMove && !!st.lastMove.path && !!mvSig
      && mvSig !== S.mvSig && seq > S.lastSeq && S.sig !== '';

    S.room = room;
    S.code = room.code;
    S.sig = sig;
    S.lastSeq = seq;
    S.mvSig = mvSig;

    renderRoom(room);

    if (animate) runAnimation(room);
    else {
      syncPieces(st ? st.planes : null);
      renderLegal(room);
    }
  }

  function renderRoom(room) {
    $('fxLobby').hidden = true;
    if (room.status === 'waiting') {
      $('fxWait').hidden = false;
      $('fxPlay').hidden = true;
      renderSeats(room);
      renderWaiting(room);
      loadInvite();
      return;
    }
    $('fxWait').hidden = true;
    $('fxPlay').hidden = false;
    if (!S.board) {
      $('fxTurn').textContent = '棋盘正在取回来…';
      loadBoard().then(function () {
        if (S.animating || !S.room) return;
        ensureBoard();
        renderPlay(S.room);
        syncPieces(S.room.state ? S.room.state.planes : null);
        renderLegal(S.room);
      });
      return;
    }
    ensureBoard();
    renderPlay(room);
  }

  /* ---------------- 大厅 ---------------- */
  function lobby(text) {
    stopPoll();
    S.code = '';
    S.room = null;
    S.sig = '';
    S.lastSeq = -1;
    S.mvSig = '';
    S.queued = null;
    clearLegal();
    $('fxWait').hidden = true;
    $('fxPlay').hidden = true;
    $('fxLobby').hidden = false;
    if (text) msg(text, true);
  }

  function createRoom(n) {
    msg('正在开一桌…');
    API.flightCreate(n).then(function (res) {
      if (res.status !== 200) { msg(realError(res, '没开成，过一会儿再试'), true); return; }
      msg('这一桌开好了，把房间号发给同学');
      applyRoom(res.data.room, {});
      startPoll();
    }, function () { msg('网络不太好，没开成', true); });
  }

  function joinRoom(code) {
    msg('正在坐进去…');
    API.flightJoin(code).then(function (res) {
      if (res.status !== 200) { msg(realError(res, '没进去，房间号再对一下'), true); return; }
      msg('坐进来了');
      applyRoom(res.data.room, {});
      startPoll();
    }, function () { msg('网络不太好，没进去', true); });
  }

  function resumeMine() {
    return API.flightMine().then(function (res) {
      if (res.status === 401) { showGuest(); return; }
      if (res.status !== 200) { lobby(realError(res, '网络不太好，稍后再试')); return; }
      if (res.data.room) {
        applyRoom(res.data.room, {});
        startPoll();
      } else {
        lobby('');
        msg('现在没有没打完的桌，开一桌或者用房间号进去');
      }
    }, function () { lobby('网络不太好，稍后再试'); });
  }

  /* ---------------- 等待室 ----------------
     开局前服务器还不发颜色（颜色是点「开始」那一刻才分的），等待室里
     先按人数把「这个座位将来坐哪一家」写出来：**一个人一种颜色**，
     两个人是红 / 蓝两边，三个人红黄蓝，四个人一人一色。
     开局之后一律以服务器给的 colors 为准。 */
  function planColors(n) {
    if (n <= 2) return [[0], [2]];
    if (n === 3) return [[0], [1], [2]];
    return [[0], [1], [2], [3]];
  }

  function seatColors(room, seat) {
    var s = (room.seats || [])[seat];
    if (s && s.colors && s.colors.length) return s.colors;
    var plan = planColors((room.seats || []).length || Number(room.maxPlayers) || 2);
    return plan[seat] || [];
  }

  function renderSeats(room) {
    var box = $('fxSeats');
    box.innerHTML = '';
    var seats = room.seats || [];
    var max = Number(room.maxPlayers) || seats.length || 2;
    $('fxCodeBig').textContent = room.code || '······';
    $('fxCodeTip').textContent = (max === 2 ? '两人一桌 · 红一边蓝一边，各 4 架' : max + ' 人一桌 · 一人一色');

    for (var i = 0; i < max; i++) {
      var s = seats[i];
      var row = document.createElement('div');
      if (!s) {
        row.className = 'fx-seat is-empty';
        var no0 = document.createElement('span');
        no0.className = 'fx-seat__no';
        no0.textContent = String(i + 1);
        row.appendChild(no0);
        var t0 = document.createElement('span');
        t0.className = 'fx-seat__name';
        t0.textContent = '空位，还等人坐';
        row.appendChild(t0);
        box.appendChild(row);
        continue;
      }
      var mine = !!(room.me && room.me.seat === s.seat);
      row.className = 'fx-seat' + (mine ? ' is-me' : '') + (s.left ? ' is-left' : '');
      var no = document.createElement('span');
      no.className = 'fx-seat__no';
      no.textContent = String(s.seat + 1);
      row.appendChild(no);
      var name = document.createElement('span');
      name.className = 'fx-seat__name';
      name.textContent = s.name || '（没有名字）';
      row.appendChild(name);
      if (s.isHost) {
        var tag = document.createElement('span');
        tag.className = 'fx-seat__tag';
        tag.textContent = '房主';
        row.appendChild(tag);
      }
      if (mine) {
        var me = document.createElement('span');
        me.className = 'fx-seat__mine';
        me.textContent = '（我）';
        row.appendChild(me);
      }
      row.appendChild(colorsOf(seatColors(room, i)));
      box.appendChild(row);
    }

    var need = Math.max(0, 2 - seats.length);
    var needEl = $('fxNeed');
    if (need > 0) {
      needEl.textContent = '还差 ' + need + ' 个人就能开局，把房间号发给同学吧。';
    } else if (seats.length < max) {
      needEl.textContent = '人够了，还能再坐 ' + (max - seats.length) + ' 个；房主点「开始」就发牌。';
    } else {
      needEl.textContent = '人齐了。';
    }
  }

  function renderWaiting(room) {
    var start = $('fxStart');
    start.hidden = !room.canStart;
    start.disabled = !room.canStart;
    start.textContent = '开始';
  }

  /* 邀请好友：把房间号塞进一条聊天消息发出去 */
  function loadInvite() {
    if (S.inviteLoaded) return;
    S.inviteLoaded = true;
    var box = $('fxInviteList');
    box.innerHTML = '';
    var loading = document.createElement('p');
    loading.className = 'fx-friend__none';
    loading.textContent = '正在取好友名单…';
    box.appendChild(loading);

    function failed() {
      box.innerHTML = '';
      var p = document.createElement('p');
      p.className = 'fx-friend__none';
      p.textContent = '好友名单没取回来，把这一栏收起来再点开就能重试。';
      box.appendChild(p);
      S.inviteLoaded = false;
    }

    API.friends().then(function (res) {
      if (res.status !== 200) { failed(); return; }
      var list = res.data.friends || [];
      box.innerHTML = '';
      if (!list.length) {
        var p = document.createElement('p');
        p.className = 'fx-friend__none';
        p.textContent = '还没有好友。先去';
        var a = document.createElement('a');
        a.href = 'friends.html';
        a.textContent = '好友页';
        p.appendChild(a);
        p.appendChild(document.createTextNode('加几个，回头一喊就能开局。'));
        box.appendChild(p);
        return;
      }
      list.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'fx-friend';
        var n = document.createElement('span');
        n.className = 'fx-friend__name';
        n.textContent = f.name || '好友';
        row.appendChild(n);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn--ghost';
        btn.textContent = '邀请';
        btn.addEventListener('click', function () { invite(f, btn); });
        row.appendChild(btn);
        box.appendChild(row);
      });
    }, failed);
  }

  function invite(friend, btn) {
    if (!S.code) return;
    btn.disabled = true;
    btn.textContent = '发着…';
    API.sendMessage(friend.id, { body: '来玩超豪飞行派对，房间号 ' + S.code, kind: 'text' }).then(function (res) {
      if (res.status !== 200) {
        btn.disabled = false;
        btn.textContent = '邀请';
        msg(realError(res, '没发出去，再试一次'), true);
        return;
      }
      btn.textContent = '已邀请';
      msg('邀请发给 ' + (friend.name || '好友') + ' 了');
    }, function () {
      btn.disabled = false;
      btn.textContent = '邀请';
      msg('网络不太好，邀请没发出去', true);
    });
  }

  /* 只画「这一局真在用」的颜色：两个人就是两方 8 架，三个人 12 架。
     没在用的那几家，飞机收起来、格子也压暗，别让人以为漏了什么 */
  function applyActiveColors(colors) {
    var active = (colors && colors.length) ? colors : [0, 1, 2, 3];
    S.activeColors = active;
    if (!S.boardReady) return;
    Object.keys(S.pieces || {}).forEach(function (k) {
      var el = S.pieces[k];
      var on = active.indexOf(colorOf(k)) >= 0;
      el.hidden = !on;
      if (!on) el.classList.remove('is-legal', 'is-moving', 'is-hit');
    });
    var board = $('fxBoard');
    if (!board) return;
    var cells = board.querySelectorAll('[data-c]');
    for (var i = 0; i < cells.length; i++) {
      var c = Number(cells[i].getAttribute('data-c'));
      if (cells[i].classList.contains('fx-plane')) continue;   /* 飞机单独在上面处理过了 */
      if (active.indexOf(c) >= 0) cells[i].classList.remove('is-off');
      else cells[i].classList.add('is-off');
    }
  }

  /* 跑到最后的排名：先到家的在前，退出的排最后 */
  function renderRanking(room) {
    var box = $('fxRank');
    if (!box) return;
    var list = (room.ranking || []).slice();
    var st = room.state || {};
    if (room.status !== 'over') { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '';
    var head = document.createElement('div');
    head.className = 'fx-rank__head';
    head.textContent = '这一局的到达顺序';
    box.appendChild(head);
    var arrived = list.filter(function (r) { return r.rank > 0; });
    var left = list.filter(function (r) { return !(r.rank > 0); });
    arrived.sort(function (a, b) { return a.rank - b.rank; });
    arrived.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'fx-rank__row' + (r.rank === 1 ? ' is-first' : '');
      row.setAttribute('data-seat', String(r.seat));
      var n = document.createElement('span');
      n.className = 'fx-rank__no';
      n.textContent = '第 ' + r.rank + ' 名';
      row.appendChild(n);
      var w = document.createElement('span');
      w.className = 'fx-rank__who';
      w.textContent = r.name || '（没有名字）';
      row.appendChild(w);
      row.appendChild(colorsOf((room.seats[r.seat] || {}).colors));
      box.appendChild(row);
    });
    left.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'fx-rank__row is-left';
      var n = document.createElement('span');
      n.className = 'fx-rank__no';
      n.textContent = '没到';
      row.appendChild(n);
      var w = document.createElement('span');
      w.className = 'fx-rank__who';
      w.textContent = (r.name || '（没有名字）') + '（退出了这一轮）';
      row.appendChild(w);
      box.appendChild(row);
    });
    if (!arrived.length) {
      var none = document.createElement('div');
      none.className = 'fx-rank__row is-left';
      none.textContent = '这一局没人跑完，就到这儿了。';
      box.appendChild(none);
    }
    void st;
  }

  /* ---------------- 对局 ---------------- */
  function renderPlay(room) {
    var st = room.state || {};
    var seats = room.seats || [];
    var me = room.me;

    $('fxRoomChip').textContent = '房间 ' + room.code;
    applyActiveColors(room.activeColors);

    var you = $('fxYou');
    you.innerHTML = '';
    if (me) {
      var label = document.createElement('span');
      label.textContent = me.left ? '你已经退出这一轮（用房间号还能回来），你本来是' : '你是';
      you.appendChild(label);
      (me.colors || []).forEach(function (c) { you.appendChild(dot(c)); });
      if (me.isHost) {
        var tag = document.createElement('span');
        tag.className = 'fx-seat__tag';
        tag.textContent = '房主';
        you.appendChild(tag);
      }
    } else {
      you.textContent = room.canRejoin ? '你退出过这一轮，点「坐回这一家」还能接着打' : '你在旁边看这一桌';
    }

    /* 轮到谁了 / 这一局结束了 */
    var turnEl = $('fxTurn');
    if (room.status === 'over') {
      var first = (room.ranking || []).filter(function (r) { return r.rank === 1; })[0];
      turnEl.textContent = first ? ('这一局结束：' + first.name + ' 第一个到家') : '这一局结束了';
      turnEl.className = 'fx-turn';
    } else if (me && me.left) {
      turnEl.textContent = '你退出了这一轮';
      turnEl.className = 'fx-turn';
    } else if (me && me.isTurn) {
      turnEl.textContent = '轮到你了';
      turnEl.className = 'fx-turn is-mine';
    } else {
      var cur = seats[st.turn];
      turnEl.textContent = cur ? ('轮到 ' + cur.name + ' 了，先等他掷' + (cur.left ? '（他退出了）' : '')) : '等着开局';
      turnEl.className = 'fx-turn';
    }

    /* 骰子 */
    var diceEl = $('fxDice');
    var dice = Number(st.dice) || (st.lastMove && Number(st.lastMove.dice)) || 0;
    var diceText = dice ? String(dice) : '—';
    if (diceEl.textContent !== diceText) {
      diceEl.textContent = diceText;
      if (dice) {
        diceEl.classList.remove('is-new');
        void diceEl.offsetWidth;
        diceEl.classList.add('is-new');
      }
    }

    /* 服务器写的那句话，原样摆出来 */
    $('fxNote').textContent = st.note || '';

    /* 散了、人不够的时候别递「再来一局」，那一下服务器也会拦回来 */
    $('fxAgain').hidden = !(room.status === 'over' && me && me.isHost && (room.seats || []).filter(function (s) { return !s.left; }).length >= 2);
    /* 退出了这一轮的人，可以就地坐回来（也还能用房间号搜回来） */
    var rejoin = $('fxRejoin');
    if (rejoin) rejoin.hidden = !(me && me.left && room.status === 'playing');

    /* 这一桌的轮次条：谁到齐了、谁退出了，一眼看得出来 */
    var strip = $('fxStrip');
    strip.innerHTML = '';
    seats.forEach(function (s) {
      var row = document.createElement('div');
      row.className = 'fx-strip__seat'
        + (room.status === 'playing' && st.turn === s.seat && !s.left ? ' is-turn' : '')
        + (s.left ? ' is-left' : '')
        + (s.done ? ' is-done' : '');
      var no = document.createElement('span');
      no.className = 'fx-seat__no';
      no.textContent = s.done && s.rank ? ('第' + s.rank) : String(s.seat + 1);
      row.appendChild(no);
      var who = document.createElement('span');
      who.className = 'fx-strip__who';
      who.textContent = (s.name || '（没有名字）') + (me && me.seat === s.seat ? '（我）' : '') + (s.left ? '（退出）' : (s.done ? '（到家）' : ''));
      row.appendChild(who);
      if (s.isHost) {
        var tag = document.createElement('span');
        tag.className = 'fx-seat__tag';
        tag.textContent = '房主';
        row.appendChild(tag);
      }
      row.appendChild(colorsOf(s.colors));
      strip.appendChild(row);
    });

    renderRanking(room);
    refreshRoll();
  }

  /* 照着服务器给的 path 一格一格挪；最后再按服务器的说法定住 */
  function runAnimation(room) {
    var mv = (room.state && room.state.lastMove) || {};
    var el = S.pieces[mv.plane];
    var path = (mv.path || []).slice();
    if (!el || !path.length || !S.board) {
      syncPieces(room.state ? room.state.planes : null);
      renderLegal(room);
      return;
    }
    S.animating = true;
    clearLegal();
    refreshRoll();
    el.classList.add('is-moving');

    var i = 0;
    function step() {
      if (i >= path.length) { land(); return; }
      var p = path[i++];
      placePiece(el, mv.plane, p);
      setTimeout(step, STEP_MS);
    }

    function land() {
      el.classList.remove('is-moving');
      var events = mv.events || [];
      var kicked = null;
      var bounced = null;
      events.forEach(function (e) {
        if (e.type === 'kick') kicked = e;
        if (e.type === 'bounce') bounced = e;
      });
      var hit = kicked || bounced;
      if (kicked) msg('把' + (COLOR_NAME[kicked.color] || '') + '色一架飞机撞回机场了');
      if (bounced) msg('落点上是对方的叠子，这架被撞回机场了');
      if (hit) {
        var target = S.pieces[hit.plane];
        if (target) target.classList.add('is-hit');
      }
      setTimeout(finish, hit ? 420 : 60);
    }

    function finish() {
      S.animating = false;
      var queued = S.queued;
      S.queued = null;
      if (queued) { applyRoom(queued, { animate: true, force: true }); return; }
      syncPieces(room.state ? room.state.planes : null);
      renderLegal(room);
    }

    step();
  }

  function onPlaneClick(id) {
    if (S.animating || S.busy) return;
    if (!S.legalMap[id]) { msg('这架现在走不了，点一闪一闪的那几架', true); return; }
    S.busy = true;
    refreshRoll();
    API.flightMove(S.code, id).then(function (res) {
      S.busy = false;
      refreshRoll();
      if (res.status !== 200) {
        msg(realError(res, '这一步没走成，再试一次'), true);
        poll();     /* 拉一次最新的，别停在旧局面上 */
        return;
      }
      applyRoom(res.data.room, {});
    }, function () {
      S.busy = false;
      refreshRoll();
      msg('网络不太好，这一步没走成', true);
    });
  }

  function rollDice() {
    if (S.busy || S.animating || !S.room || S.room.status !== 'playing') return;
    S.busy = true;
    refreshRoll();
    API.flightRoll(S.code).then(function (res) {
      S.busy = false;
      refreshRoll();
      if (res.status !== 200) {
        msg(realError(res, '这一下没掷成，再点一次'), true);
        poll();
        return;
      }
      applyRoom(res.data.room, {});
    }, function () {
      S.busy = false;
      refreshRoll();
      msg('网络不太好，骰子没掷成', true);
    });
  }

  function startGame() {
    var btn = $('fxStart');
    btn.disabled = true;
    API.flightStart(S.code).then(function (res) {
      btn.disabled = false;
      if (res.status !== 200) { msg(realError(res, '没能开局'), true); return; }
      msg('开局，掷到 6 才能起飞');
      applyRoom(res.data.room, {});
    }, function () {
      btn.disabled = false;
      msg('网络不太好，没能开局', true);
    });
  }

  function leaveRoom() {
    var code = S.code;
    if (!code) { lobby(''); return; }
    /* 打了一半退出，退的是「这一轮」：牌桌还在，记住房间号随时能坐回来 */
    var playing = !!(S.room && S.room.status === 'playing');
    stopPoll();
    API.flightLeave(code).then(function () {
      lobby(playing
        ? '你退出了这一轮。想接着打，还用房间号 ' + code + ' 就能坐回来'
        : '已经离开这一桌了');
    }, function () {
      lobby('已经离开这一桌了');
    });
  }

  /* 退出了这一轮的人，就地坐回自己那一家（飞机重新摆回机场） */
  function rejoin() {
    if (!S.code) return;
    msg('正在坐回这一家…');
    API.flightJoin(S.code).then(function (res) {
      if (res.status !== 200) { msg(realError(res, '没坐回来，用房间号再试一次'), true); return; }
      msg('回来了，飞机重新摆好，接着打');
      applyRoom(res.data.room, { force: true });
      startPoll();
    }, function () { msg('网络不太好，没坐回来', true); });
  }

  function again() {
    API.flightAgain(S.code).then(function (res) {
      if (res.status !== 200) { msg(realError(res, '没能重开'), true); return; }
      msg('重开一局，这次谁先手？');
      applyRoom(res.data.room, { force: true });
    }, function () { msg('网络不太好，没能重开', true); });
  }

  /* ---------------- 问房间 ---------------- */
  function startPoll() {
    stopPoll();
    if (document.hidden) return;
    S.timer = setInterval(poll, POLL_MS);
  }

  function stopPoll() {
    if (S.timer) { clearInterval(S.timer); S.timer = 0; }
  }

  function poll() {
    if (document.hidden || !S.code || S.polling) return;
    S.polling = true;
    API.flightRoom(S.code).then(function (res) {
      S.polling = false;
      if (res.status === 404) { lobby(realError(res, '房间没了')); return; }
      if (res.status === 401) { showGuest(); return; }
      if (res.status !== 200) return;
      applyRoom(res.data.room, {});
    }, function () { S.polling = false; });
  }

  /* ---------------- 复制房间号 ---------------- */
  function copyCode() {
    var code = S.code;
    if (!code) return;

    /* 老一点的 WebView 没有 clipboard，就用选中 + 复制这条老路 */
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = code;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) msg('房间号复制好了，粘给同学就行');
      else msg('房间号是 ' + code + '，长按也能选中复制');
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function () {
          msg('房间号复制好了，粘给同学就行');
        }, fallback);
        return;
      }
    } catch (e) { /* 走下面的老办法 */ }
    fallback();
  }

  /* ---------------- 起来 ---------------- */
  function loadBoard() {
    if (S.board) return Promise.resolve(S.board);
    return API.flightBoard().then(function (res) {
      if (res.status === 200 && res.data && res.data.board) S.board = res.data.board;
      return S.board;
    }, function () { return null; });
  }

  function enterMain() {
    $('fxGuest').hidden = true;
    $('fxMain').hidden = false;
    $('fxLobby').hidden = false;
    loadBoard().then(function () { resumeMine(); });
  }

  function boot() {
    if (!loggedIn()) { showGuest(); return; }
    /* 凭证在就先让他进去；真过期了接口会回 401，那时候再请他去登录。
       网络不通不算「没登录」，别把人挡在门外 */
    API.me().then(function (res) {
      if (res.status === 401) { showGuest(); return; }
      enterMain();
    }, function () { enterMain(); });
  }

  /* 三个人数按钮各挂一个，别用事件代理去猜点到了谁 */
  (function () {
    var btns = document.querySelectorAll('#fxSizes .fx-size');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          createRoom(Number(btn.getAttribute('data-max')) || 2);
        });
      })(btns[i]);
    }
  })();

  $('fxJoin').addEventListener('click', function () {
    var code = String($('fxCode').value || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) { msg('房间号是 6 位数字', true); $('fxCode').focus(); return; }
    $('fxCode').value = code;
    joinRoom(code);
  });
  $('fxCode').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('fxJoin').click(); }
  });
  $('fxCode').addEventListener('input', function () {
    this.value = String(this.value || '').replace(/\D/g, '').slice(0, 6);
  });
  $('fxFindMine').addEventListener('click', function () { resumeMine(); });
  $('fxCodeBig').addEventListener('click', copyCode);
  $('fxStart').addEventListener('click', startGame);
  $('fxLeaveWait').addEventListener('click', leaveRoom);
  $('fxLeavePlay').addEventListener('click', leaveRoom);
  if ($('fxRejoin')) $('fxRejoin').addEventListener('click', rejoin);
  $('fxAgain').addEventListener('click', again);
  $('fxRoll').addEventListener('click', rollDice);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopPoll(); return; }
    if (!S.code) return;
    startPoll();
    poll();     /* 切回来先补一次，别等下一个 1.5 秒 */
  });

  window.addEventListener('jhjx:session', function () { location.reload(); });

  boot();
})();
