/* =========================================================
   嘉闲 · 闲事笺
   ---------------------------------------------------------
   一个特别简单的便签本：写、改、删、置顶、找。
   · 便签只存在这台设备上（localStorage），不上传、不联网；
   · 不拼 HTML，正文一律走 textContent，写什么都只是文字；
   · 删除要问一句「真的删掉？」，别一点就没。
   ========================================================= */
(function () {
  var KEY = 'jhjx-xianshi-notes';
  var MAX_NOTES = 300;
  var MAX_LEN = 1000;
  var COLORS = ['cream', 'jade', 'gold', 'rose'];

  function $(id) { return document.getElementById(id); }

  var grid = $('xsGrid');
  var input = $('xsInput');
  var countEl = $('xsCount');
  var saveBtn = $('xsSave');
  var colorsBox = $('xsColors');
  var toolsBox = $('xsTools');
  var searchEl = $('xsSearch');
  var totalEl = $('xsTotal');
  var emptyEl = $('xsEmpty');
  var hintEl = $('xsHint');
  if (!grid || !input) return;

  var notes = [];
  var color = 'cream';
  var editingId = 0;      /* 正在编辑哪一张 */
  var askingId = 0;       /* 哪一张在等「真的删掉？」 */
  var keyword = '';
  var hintTimer = 0;

  /* ---------------- 存取 ---------------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return list.filter(function (n) {
        return n && typeof n.text === 'string' && n.text;
      }).slice(0, MAX_NOTES).map(function (n) {
        return {
          id: Number(n.id) || 0,
          text: String(n.text).slice(0, MAX_LEN),
          color: COLORS.indexOf(n.color) >= 0 ? n.color : 'cream',
          pinned: !!n.pinned,
          at: Number(n.at) || 0
        };
      });
    } catch (e) { return []; }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(notes));
      return true;
    } catch (e) {
      hint('这台设备不让存东西（可能是隐私模式），便签存不下来。', true);
      return false;
    }
  }

  function nextId() {
    var max = 0;
    for (var i = 0; i < notes.length; i++) if (notes[i].id > max) max = notes[i].id;
    return max + 1;
  }

  function find(id) {
    for (var i = 0; i < notes.length; i++) if (notes[i].id === id) return notes[i];
    return null;
  }

  /* ---------------- 一行提示 ---------------- */
  function hint(text, isError) {
    if (!hintEl) return;
    hintEl.textContent = text || '';
    hintEl.className = 'xs-hint' + (text ? ' is-show' : '') + (isError ? ' is-error' : '');
    if (hintTimer) clearTimeout(hintTimer);
    if (text) hintTimer = setTimeout(function () { hintEl.className = 'xs-hint'; }, 6000);
  }

  /* ---------------- 时间写法 ---------------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function timeText(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var now = new Date();
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
    var yst = new Date(now.getTime() - 24 * 3600 * 1000);
    if (d.toDateString() === yst.toDateString()) return '昨天 ' + hm;
    if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + hm;
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }

  /* ---------------- 画出来 ---------------- */
  function shown() {
    var k = keyword.trim().toLowerCase();
    var list = notes.filter(function (n) {
      if (!k) return true;
      return n.text.toLowerCase().indexOf(k) >= 0;
    });
    /* 置顶的排前面，其余按最后改过的时间倒序 */
    list.sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.at || 0) - (a.at || 0);
    });
    return list;
  }

  function actBtn(label, act, id, extraClass) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'xs-note__act' + (extraClass ? ' ' + extraClass : '');
    b.setAttribute('data-act', act);
    b.setAttribute('data-id', String(id));
    b.textContent = label;
    return b;
  }

  function noteCard(n) {
    var card = document.createElement('article');
    card.className = 'xs-note xs-note--' + n.color + (n.pinned ? ' is-pinned' : '');
    card.setAttribute('data-id', String(n.id));

    if (editingId === n.id) {
      var ta = document.createElement('textarea');
      ta.className = 'xs-note__edit';
      ta.id = 'xsEditBox';
      ta.maxLength = MAX_LEN;
      ta.value = n.text;
      ta.setAttribute('aria-label', '改这张便签');
      card.appendChild(ta);

      var foot0 = document.createElement('div');
      foot0.className = 'xs-note__foot';
      var t0 = document.createElement('span');
      t0.className = 'xs-note__time';
      t0.textContent = '改完点「保存」，Esc 取消';
      var acts0 = document.createElement('div');
      acts0.className = 'xs-note__acts';
      acts0.appendChild(actBtn('取消', 'cancel', n.id));
      acts0.appendChild(actBtn('保存', 'save', n.id));
      foot0.appendChild(t0);
      foot0.appendChild(acts0);
      card.appendChild(foot0);
      return card;
    }

    var p = document.createElement('p');
    p.className = 'xs-note__text';
    p.textContent = n.text;
    card.appendChild(p);

    var foot = document.createElement('div');
    foot.className = 'xs-note__foot';

    var time = document.createElement('time');
    time.className = 'xs-note__time';
    time.textContent = timeText(n.at);
    foot.appendChild(time);

    var acts = document.createElement('div');
    acts.className = 'xs-note__acts';
    acts.appendChild(actBtn(n.pinned ? '取消置顶' : '置顶', 'pin', n.id, n.pinned ? 'is-on' : ''));
    acts.appendChild(actBtn('改', 'edit', n.id));
    acts.appendChild(actBtn('复制', 'copy', n.id));
    if (askingId === n.id) {
      acts.appendChild(actBtn('真的删掉', 'del-yes', n.id, 'is-danger'));
      acts.appendChild(actBtn('算了', 'del-no', n.id));
    } else {
      acts.appendChild(actBtn('删', 'del', n.id, 'is-danger'));
    }
    foot.appendChild(acts);
    card.appendChild(foot);
    return card;
  }

  function render() {
    var list = shown();
    grid.innerHTML = '';
    for (var i = 0; i < list.length; i++) grid.appendChild(noteCard(list[i]));

    if (emptyEl) {
      emptyEl.hidden = notes.length > 0;
      if (!notes.length) emptyEl.textContent = '还没有便签。在上面写点什么，点「记下来」就行。';
    }
    if (toolsBox) toolsBox.hidden = notes.length === 0;
    if (totalEl) {
      totalEl.textContent = notes.length
        ? (keyword.trim() ? '找到 ' + list.length + ' 张 / 共 ' + notes.length + ' 张' : '共 ' + notes.length + ' 张')
        : '';
    }
    /* 编辑框自动聚焦，光标落在末尾，接着改就行 */
    if (editingId) {
      var box = $('xsEditBox');
      if (box) {
        box.focus();
        try { box.setSelectionRange(box.value.length, box.value.length); } catch (e) { /* 忽略 */ }
      }
    }
  }

  function updateCount() {
    if (!countEl) return;
    var left = MAX_LEN - String(input.value || '').length;
    countEl.textContent = '还可以写 ' + (left > 0 ? left : 0) + ' 字';
  }

  /* ---------------- 写一张 ---------------- */
  function addNote() {
    var text = String(input.value || '').replace(/^\s+|\s+$/g, '');
    if (!text) {
      hint('先写点什么吧。', true);
      input.focus();
      return;
    }
    if (notes.length >= MAX_NOTES) {
      hint('便签最多 ' + MAX_NOTES + ' 张，先删掉几张吧。', true);
      return;
    }
    notes.push({ id: nextId(), text: text.slice(0, MAX_LEN), color: color, pinned: false, at: Date.now() });
    if (!save()) { notes.pop(); return; }
    input.value = '';
    updateCount();
    render();
    hint('记下来了。');
    input.focus();
  }

  /* ---------------- 改 / 删 / 置顶 / 复制 ---------------- */
  function startEdit(id) {
    editingId = id;
    askingId = 0;
    render();
  }

  function commitEdit(id) {
    var box = $('xsEditBox');
    var n = find(id);
    if (!n) { editingId = 0; render(); return; }
    var text = box ? String(box.value || '').replace(/^\s+|\s+$/g, '') : '';
    if (!text) { hint('内容不能是空的，想删就点「删」。', true); return; }
    n.text = text.slice(0, MAX_LEN);
    n.at = Date.now();
    editingId = 0;
    if (!save()) return;
    render();
    hint('改好了。');
  }

  function togglePin(id) {
    var n = find(id);
    if (!n) return;
    n.pinned = !n.pinned;
    if (!save()) return;
    render();
    /* 置顶会跑最前面，说一声免得以为便签丢了 */
    hint(n.pinned ? '置顶了，它现在排在最前面。' : '取消置顶了。');
  }

  function removeNote(id) {
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].id === id) {
        notes.splice(i, 1);
        break;
      }
    }
    askingId = 0;
    editingId = 0;
    if (!save()) return;
    render();
    hint('删掉了。');
  }

  function copyNote(id) {
    var n = find(id);
    if (!n) return;
    var text = n.text;
    function done() { hint('复制好了。'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
      return;
    }
    fallbackCopy(text, done);
  }

  /* 老浏览器 / 非 https 下的兜底：塞进一个临时输入框选中再复制 */
  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) done(); else hint('这个浏览器不让自动复制，手动选中吧。', true);
    } catch (e) {
      hint('这个浏览器不让自动复制，手动选中吧。', true);
    }
  }

  /* ---------------- 事件 ---------------- */
  saveBtn.addEventListener('click', addNote);

  input.addEventListener('input', updateCount);
  input.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      addNote();
    }
  });

  colorsBox.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.xs-color') : null;
    if (!btn) return;
    color = btn.getAttribute('data-color') || 'cream';
    var all = colorsBox.querySelectorAll('.xs-color');
    for (var i = 0; i < all.length; i++) {
      var on = all[i] === btn;
      all[i].className = 'xs-color xs-color--' + all[i].getAttribute('data-color') + (on ? ' is-on' : '');
      all[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  });

  searchEl.addEventListener('input', function () {
    keyword = String(searchEl.value || '');
    render();
  });

  /* 便签上的按钮：一个委托就够了，卡片重画也不用重新绑 */
  grid.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.xs-note__act') : null;
    if (!btn) return;
    var id = Number(btn.getAttribute('data-id'));
    var act = btn.getAttribute('data-act');
    if (!id) return;
    if (act === 'pin') togglePin(id);
    else if (act === 'edit') startEdit(id);
    else if (act === 'cancel') { editingId = 0; render(); }
    else if (act === 'save') commitEdit(id);
    else if (act === 'copy') copyNote(id);
    else if (act === 'del') { askingId = id; editingId = 0; render(); }
    else if (act === 'del-no') { askingId = 0; render(); }
    else if (act === 'del-yes') removeNote(id);
  });

  /* 编辑框里按 Ctrl / ⌘ + Enter 保存，Esc 取消 */
  grid.addEventListener('keydown', function (e) {
    var box = e.target;
    if (!box || box.id !== 'xsEditBox') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      commitEdit(Number(box.closest('.xs-note').getAttribute('data-id')));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editingId = 0;
      render();
    }
  });

  /* ---------------- 起来 ---------------- */
  notes = load();
  updateCount();
  render();

  /* 同一台设备开两个标签页时，这边改了那边也能跟上 */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    notes = load();
    render();
  });

  /* 留在页面上方便排查：便签都存不进时能一眼看出问题 */
  window.jhjxXianshi = {
    count: function () { return notes.length; },
    raw: function () { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  };
})();
