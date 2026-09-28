/* =========================================================
   浙江嘉豪嘉欣协会 · 官方网站 交互脚本
   纯原生 JS，无外部依赖
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 1. 部门详情数据 ---------- */
  var DEPARTMENTS = {
    shutong: {
      no: '壹 · 中枢',
      name: '嘉枢统筹部',
      motto: '居中调度，让协会顺畅运转。',
      leader: '暂无',
      logo: 'assets/img/dept-01-shutong.png',
      desc: '嘉枢统筹部是协会的中枢部门，负责社群日常运营、活动排期与跨部门协同。任何一次活动从想法到落地，都从这里开始被拆解成清单。',
      duties: [
        '维护群秩序与入群审核，执行群规并处理纠纷',
        '统筹活动排期，协调各部门时间与场地',
        '对外联络：跨校联谊、社团合作与投稿对接',
        '整理群内公告、活动纪要与资料归档'
      ],
      tags: ['社群运营', '活动策划', '跨部协同', '对外联络']
    },
    fanxun: {
      no: '贰 · 巡礼',
      name: '嘉番巡礼部',
      motto: '新番导视，也补一部经典。',
      leader: '暂无',
      logo: 'assets/img/dept-02-fanxun.png',
      desc: '为二次元同好而设。每周更新番剧导视，组织线上观影会，也在假期策划线下圣地巡礼与漫展同行。',
      duties: [
        '每季新番导视与追番清单整理',
        '线上观影会：同步开麦、弹幕式吐槽',
        '经典老番补完计划与专题安利',
        '漫展、主题展与圣地巡礼的结伴出行'
      ],
      tags: ['番剧', '观影会', '圣地巡礼', '漫展']
    },
    youlun: {
      no: '叁 · 论衡',
      name: '嘉游论衡部',
      motto: '玩过，才有资格评。',
      leader: '碳氘氕',
      logo: 'assets/img/dept-03-youlun.png',
      desc: '围绕 3A 大作与各类游戏展开讨论：新作试玩、通关复盘、剧情解析与联机开黑，也欢迎硬核评测与投稿。',
      duties: [
        '3A 大作新作试玩与首发体验分享',
        '每周联机之夜：多人合作与竞技轮换',
        '游戏评测、剧情解析与世界观专题',
        '主机 / PC / 掌机设备与配置交流'
      ],
      tags: ['3A 大作', '联机开黑', '游戏评测', '主机 PC']
    },
    mohui: {
      no: '肆 · 绘梦',
      name: '嘉墨绘梦部',
      motto: '把脑内的画面画出来。',
      leader: '吃芋头',
      logo: 'assets/img/dept-04-mohui.png',
      desc: '绘画与创作的聚集地。无论板绘、手绘还是 AI 辅助创作，这里都有同好互相看稿、给建议、一起进步。',
      duties: [
        '每周绘画自习室：线上同画、限时命题',
        '作品互评：只提可执行的建议，不做拉踩',
        '每月主题创作合集，集结成电子月历',
        '同人创作、角色设计与视觉笔记交流'
      ],
      tags: ['板绘', '同人创作', '作品互评', '命题创作']
    },
    lixing: {
      no: '伍 · 砺行',
      name: '嘉体砺行部',
      motto: '身体先动起来，其他再说。',
      leader: '暂无',
      logo: 'assets/img/dept-05-lixing.png',
      desc: '运动健康部门。晨跑、夜跑、健身、球类约战，按城市与校区就近组队，主打坚持而非成绩。',
      duties: [
        '每周约跑：按城市分组的固定路线',
        '健身打卡与新手动作指导互助',
        '篮球、羽毛球、乒乓球等球局组织',
        '季度体测小目标与坚持榜'
      ],
      tags: ['约跑', '健身打卡', '球类约战', '健康作息']
    },
    tongyou: {
      no: '陆 · 同游',
      name: '嘉盟同游部',
      motto: '一个人出发，一群人抵达。',
      leader: '暂无',
      logo: 'assets/img/dept-06-tongyou.png',
      desc: '专治「想去但没人陪」。组队开黑、线下同游、跨校联谊、短途旅行，都在这里凑人成行。',
      duties: [
        '周末与假期的短途出行组队',
        '跨校联谊与联合活动的对接',
        '桌游、剧本杀、KTV 等轻量聚会',
        '拼车、住宿与行程攻略共享'
      ],
      tags: ['结伴出行', '跨校联谊', '桌游聚会', '攻略共享']
    },
    xianfu: {
      no: '柒 · 浮生',
      name: '嘉闲浮生部',
      motto: '偷得浮生半日闲。',
      leader: 'ln.',
      logo: 'assets/img/dept-07-xianfu.png',
      desc: '慢节奏生活部门。喝茶、探店、city walk、看展、养植物，把日子过得有一点讲究。',
      duties: [
        '茶饮与咖啡探店清单，轮流试喝',
        'City walk 路线设计与周末散步',
        '看展、市集与生活美学分享',
        '慢生活话题：作息、收纳、做饭日常'
      ],
      tags: ['茶饮美食', 'city walk', '看展', '慢生活']
    },
    qingtan: {
      no: '捌 · 清谈',
      name: '嘉学清谈部',
      motto: '学问与困惑，都可以摆上桌。',
      leader: '睡一会',
      logo: 'assets/img/dept-08-qingtan.png',
      desc: '学习交流部门。课程互助、读书会、考研保研与实习信息互通，也聊纯粹的清谈话题。',
      duties: [
        '读书会：每月一本，清谈式分享',
        '课程与专业课资料互助、组队复习',
        '考研、保研、留学与实习经验交流',
        '学习方法、时间管理与自律陪跑'
      ],
      tags: ['读书会', '课程互助', '升学交流', '经验分享']
    },
    jieyou: {
      no: '玖 · 解忧',
      name: '嘉窗解忧部',
      motto: '一窗灯火，有人听你说。',
      leader: '暂无',
      logo: 'assets/img/dept-09-jieyou.png',
      desc: '朋辈倾听与情绪陪伴。树洞、解忧信箱与匿名倾诉通道，让不开心有地方安放。本部门提供的是同伴支持，不替代专业心理咨询。',
      duties: [
        '匿名树洞与解忧信箱，值班倾听',
        '情绪陪伴：不评判、不说教、不传播',
        '考前、失恋、人际压力等主题互助小贴士',
        '情况超出朋辈支持范围时，协助对接学校心理中心'
      ],
      tags: ['树洞', '朋辈倾听', '情绪陪伴', '心理资源对接']
    }
  };

  /* ---------- 2. 页面元素 ---------- */
  var header = document.getElementById('siteHeader');
  var navToggle = document.getElementById('navToggle');
  var siteNav = document.getElementById('siteNav');
  var toTop = document.getElementById('toTop');
  var modal = document.getElementById('deptModal');
  var panel = modal ? modal.querySelector('.modal__panel') : null;
  var lastFocused = null;

  /* ---------- 3. 顶部导航：吸顶 + 移动端菜单 ---------- */
  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    if (header) header.classList.toggle('is-stuck', y > 6);
    if (toTop) toTop.classList.toggle('is-visible', y > 560);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (navToggle && siteNav) {
    navToggle.addEventListener('click', function () {
      var open = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!open));
      siteNav.classList.toggle('is-open', !open);
    });
    siteNav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        navToggle.setAttribute('aria-expanded', 'false');
        siteNav.classList.remove('is-open');
      }
    });
  }

  /* ---------- 4. 滚动入场动画 ---------- */
  var revealItems = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var delay = parseInt(entry.target.getAttribute('data-delay') || '0', 10);
        entry.target.style.transitionDelay = delay + 'ms';
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    revealItems.forEach(function (el) { io.observe(el); });
  } else {
    revealItems.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- 5. 导航高亮（滚动监听） ---------- */
  var navLinks = siteNav ? Array.prototype.slice.call(siteNav.querySelectorAll('a[href^="#"]')) : [];
  var sections = navLinks
    .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (a) {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ---------- 6. 部门详情弹窗 ---------- */
  function openModal(key, trigger) {
    var d = DEPARTMENTS[key];
    if (!d || !modal) return;
    lastFocused = trigger || null;

    document.getElementById('modalLogo').src = d.logo;
    document.getElementById('modalLogo').alt = d.name + '部徽';
    document.getElementById('modalKicker').textContent = 'DEPARTMENT ' + d.no;
    document.getElementById('modalTitle').textContent = d.name;
    document.getElementById('modalMotto').textContent = d.motto;
    document.getElementById('modalLeader').textContent = '部长：' + (d.leader || '暂无');
    document.getElementById('modalDesc').textContent = d.desc;

    var duties = document.getElementById('modalDuties');
    duties.innerHTML = '';
    d.duties.forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = t;
      duties.appendChild(li);
    });

    var tags = document.getElementById('modalTags');
    tags.innerHTML = '';
    d.tags.forEach(function (t) {
      var s = document.createElement('span');
      s.textContent = t;
      tags.appendChild(s);
    });

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (panel) panel.scrollTop = 0;
    var closeBtn = modal.querySelector('.modal__close');
    if (closeBtn) closeBtn.focus();
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocused) lastFocused.focus();
  }

  document.querySelectorAll('.dept-card').forEach(function (card) {
    card.addEventListener('click', function () {
      openModal(card.getAttribute('data-dept'), card);
    });
  });

  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close')) closeModal();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal && !modal.hidden) closeModal();
  });

  /* ---------- 6b. 支持 #dept-xxx 深链接 ---------- */
  function openFromHash() {
    var m = /^#dept-([a-z]+)$/.exec(window.location.hash);
    if (m && DEPARTMENTS[m[1]]) openModal(m[1], null);
  }
  openFromHash();
  window.addEventListener('hashchange', openFromHash);

  /* ---------- 6c. 复制首座微信号 ---------- */
  var copyBtn = document.getElementById('copyWechat');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var idEl = document.getElementById('wechatId');
      var wechat = idEl ? idEl.textContent.trim() : '';
      var restore = function () { window.setTimeout(function () { copyBtn.textContent = '复制微信号'; }, 2000); };
      var done = function () { copyBtn.textContent = '已复制 ✓'; restore(); };
      var fallback = function () {
        var ta = document.createElement('textarea');
        ta.value = wechat;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { copyBtn.textContent = '请长按手动复制'; restore(); }
        document.body.removeChild(ta);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(wechat).then(done).catch(fallback);
      } else {
        fallback();
      }
    });
  }

  /* ---------- 7. 返回顶部 ---------- */
  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- 8. PWA：注册 Service Worker ---------- */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 注册失败不影响使用 */ });
    });
  }

  /* ---------- 9. 手机桌面快捷方式 ---------- */
  var installBtn = document.getElementById('installApp');
  var installHint = document.getElementById('installHint');
  var installPanel = document.getElementById('installPanel');
  var installList = document.getElementById('installList');
  var copyUrlBtn = document.getElementById('copySiteUrl');
  var deferredPrompt = null;
  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isWeChat = /MicroMessenger/i.test(ua);
  var isAndroid = /Android/i.test(ua);
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  var INSTALL_STEPS = {
    wechat: [
      '点右上角「…」（三个点）',
      '选「在浏览器打开」',
      '再点页面里的「安装到手机桌面」，或从浏览器菜单选「添加到主屏幕」'
    ],
    ios: [
      '确认是用 Safari 打开的（微信、Chrome 不行）',
      '点屏幕底部中间的「分享」按钮（方框带向上箭头）',
      '在弹出的列表里往下滑，选「添加到主屏幕」',
      '右上角点「添加」，桌面就会出现会徽图标'
    ],
    iosOther: [
      'iPhone 只能用 Safari 添加到桌面',
      '先点下面「复制网址」，再用 Safari 打开它',
      '然后点底部「分享」→「添加到主屏幕」'
    ],
    android: [
      '点浏览器右上角的「⋮」菜单',
      '选「安装应用」或「添加到主屏幕」',
      '确认后桌面就会出现会徽图标'
    ],
    desktop: [
      '点浏览器地址栏右侧的「安装」小图标，或菜单里的「安装 浙江嘉豪嘉欣协会」',
      '手机端：用手机浏览器打开本页，再点「安装到手机桌面」',
      'iPhone 需要 Safari；安卓用 Chrome / Edge / 自带浏览器都可以'
    ],
    installed: [
      '已经装到桌面了 ✓',
      '直接在桌面上点会徽图标打开即可'
    ]
  };

  function showInstallHint(text) {
    if (!installHint) return;
    installHint.textContent = text;
    installHint.hidden = false;
  }

  function renderInstallSteps() {
    if (!installPanel || !installList) return;
    var isSafariIOS = isIOS && !/CriOS|FxiOS|EdgiOS|MicroMessenger/i.test(ua);
    var key = 'desktop';
    if (isStandalone) key = 'installed';
    else if (isWeChat) key = 'wechat';
    else if (isIOS) key = isSafariIOS ? 'ios' : 'iosOther';
    else if (isAndroid) key = 'android';

    var steps = INSTALL_STEPS[key] || INSTALL_STEPS.desktop;
    installList.innerHTML = '';
    steps.forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s;
      installList.appendChild(li);
    });
    installPanel.hidden = false;
  }

  if (isStandalone && installBtn) {
    installBtn.textContent = '已安装到桌面 ✓';
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (installHint) installHint.hidden = true;
  });

  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function () { deferredPrompt = null; });
        return;
      }
      if (installPanel && !installPanel.hidden) { installPanel.hidden = true; return; }
      renderInstallSteps();
    });
  }

  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', function () {
      var url = location.origin + location.pathname;
      var restore = function () { window.setTimeout(function () { copyUrlBtn.textContent = '复制网址'; }, 2000); };
      var done = function () { copyUrlBtn.textContent = '已复制 ✓'; restore(); };
      var fallback = function () {
        var ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { copyUrlBtn.textContent = '请手动复制'; restore(); }
        document.body.removeChild(ta);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(fallback);
      } else {
        fallback();
      }
    });
  }

  if (isWeChat && !isStandalone) {
    showInstallHint('微信里请点右上角「…」→「在浏览器打开」，再点「安装到手机桌面」');
  }

  window.addEventListener('appinstalled', function () {
    if (installBtn) installBtn.textContent = '已安装到桌面 ✓';
    if (installPanel) installPanel.hidden = true;
    showInstallHint('已添加到手机桌面 ✓');
  });

  /* ---------- 10. 页脚年份 ---------- */
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();
