/* =========================================================
   浙江嘉豪嘉欣协会 · 伪用户系统后端（路由逻辑）
   ---------------------------------------------------------
   同一份逻辑，三种跑法：
     · Cloudflare Worker + D1   → 见本文件底部 default export
     · 阿里云函数计算 + OSS     → backend/fc/handler.js
     · 本地联调（文件/SQLite）  → backend/dev-server.mjs
   存储由 env.STORE 提供（接口见 store-json.js）。

   登录：昵称 + 邀请码。没有密码 —— 这是「伪用户系统」：
   它保证「昵称不重复」和「谁在说话能对上号」，不保证安全性。
   邀请码只存在服务端（环境变量/secret），不进前端、不进仓库。

   第一次用某个昵称进来 = 认领这个昵称，服务端发一个本机凭证；
   之后换设备想用同一个昵称，需要管理员「重置登录」。
   ========================================================= */

import { createJsonStore } from './store-json.js';

const RESERVED = ['管理员', '管理', 'admin', 'administrator', '社长', '会长', '部长',
                  '官方', '客服', '协会', '群主', '老师', '管理组'];
const REASONS = ['骚扰或辱骂', '冒充他人', '发广告或刷屏', '泄露他人隐私', '其他'];
const NAME_MIN = 2;
const NAME_MAX = 12;
const DETAIL_MAX = 200;
const REPORT_PER_DAY = 5;         /* 每人每天最多举报 5 次 */
const SAME_TARGET_HOURS = 24;     /* 同一个对象 24 小时内只受理一次 */

/* 只允许这些来源调用接口（本地调试随便，正式只认协会站点） */
const ALLOWED_ORIGINS = [
  'https://xbc-zjja.com.cn',
  'https://www.xbc-zjja.com.cn',
  'https://huade520.github.io',
];

function originAllowed(o) {
  if (!o) return true;                                    /* 命令行 / 服务端调用 */
  if (o === 'null') return true;                          /* 本地用 file:// 打开页面 */
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return true;
  return ALLOWED_ORIGINS.includes(o);
}

function pickOrigin(request, env) {
  /* env.ORIGIN 是给阿里云函数计算留的口子：那边是自己拼的 Request，
     而 Origin 属于 fetch 的「禁止设置」头，拼不到 Request 上 */
  const o = (env && env.ORIGIN) || request.headers.get('Origin');
  return originAllowed(o) ? o : null;
}

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  });
}

function fail(message, status, origin, extra) {
  return json({ ok: false, error: message, ...(extra || {}) }, status || 400, origin);
}

function nameKey(name) {
  return String(name == null ? '' : name).replace(/\s+/g, '').toLowerCase();
}

function nameProblem(name) {
  const raw = String(name == null ? '' : name).trim();
  if (!raw) return '请填写昵称';
  const len = Array.from(raw).length;
  if (len < NAME_MIN || len > NAME_MAX) return `昵称长度请在 ${NAME_MIN}–${NAME_MAX} 个字之间`;
  if (/\s/.test(raw)) return '昵称里不要有空格';
  const lower = raw.toLowerCase();
  for (const word of RESERVED) {
    if (lower.includes(word.toLowerCase())) return `昵称里不能包含「${word}」`;
  }
  return null;
}

function roleOfCode(code, env) {
  const c = String(code == null ? '' : code).trim();
  if (!c) return null;
  if (env.ADMIN_CODE && c === env.ADMIN_CODE) return 'admin';
  if (env.USER_CODE && c === env.USER_CODE) return 'user';
  return null;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    avatar: row.avatar ? `/api/avatar/${row.id}?v=${row.avatar_ver || 0}` : null,
  };
}

/* 只对外露出的字段（好友列表、消息里用） */
function briefUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar ? `/api/avatar/${row.id}?v=${row.avatar_ver || 0}` : null,
  };
}

function publicMessage(m) {
  return { id: m.id, from: m.from, to: m.to, body: m.body, createdAt: m.created_at, readAt: m.read_at || null };
}

function publicReport(r) {
  return {
    id: r.id,
    targetId: r.target_id,
    targetName: r.target_name,
    reporterName: r.reporter_name,
    reason: r.reason,
    detail: r.detail,
    status: r.status,
    createdAt: r.created_at,
    handledBy: r.handled_by,
    handledAt: r.handled_at,
    handleNote: r.handle_note,
  };
}

async function authUser(store, request) {
  const h = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (!m) return null;
  const token = m[1].trim();
  if (!token) return null;
  return store.getUserByToken(token);
}

/* ---------------- 路由 ---------------- */
export async function handle(request, env) {
  const origin = pickOrigin(request, env);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const store = env.STORE || (env.DB ? createJsonStore(env.DB) : null);

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (!store) return fail('服务端没有配置存储', 500, origin);

  /* 阿里云函数计算的网关会反射任意 Origin（CORS 配置还在内测），
     所以这里自己拦一道：带了 Origin 但不在白名单里的请求直接拒绝 */
  const rawOriginValue = (env && env.ORIGIN) || request.headers.get('Origin');
  if (rawOriginValue && !originAllowed(rawOriginValue)) {
    return fail('来源不被允许', 403, null);
  }

  try {
    /* ---- 进入（注册 + 登录，同一个动作） ---- */
    if (path === '/api/enter' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const name = String(body.name == null ? '' : body.name).trim();
      const role = roleOfCode(body.code, env);
      if (!role) return fail('邀请码不对，问一下群里的管理员', 403, origin);

      const problem = nameProblem(name);
      if (problem) return fail(problem, 400, origin);

      const key = nameKey(name);
      const now = Date.now();
      const exist = await store.getUserByKey(key);

      if (!exist) {
        const token = crypto.randomUUID();
        const row = await store.createUser({ name, nameKey: key, role, token, now });
        return json({ ok: true, token, user: publicUser(row), created: true }, 200, origin);
      }

      if (exist.status === 'banned') {
        return fail('这个昵称已被停用，找管理员处理一下', 403, origin);
      }

      /* 同一个昵称换设备进来：不允许直接冒用；
         管理员「重置登录」会把凭证清空，这时昵称回到可认领状态 */
      const claimable = !exist.token;
      const sameDevice = claimable || (body.token && String(body.token) === exist.token);
      if (!sameDevice) {
        return fail('这个昵称已经有人用了。如果就是你，让管理员点一下「重置登录」，就能重新进来', 409, origin, { needReset: true });
      }

      const nextRole = role === 'admin' ? 'admin' : exist.role;
      const nextToken = claimable ? crypto.randomUUID() : exist.token;
      const row = await store.updateUser(exist.id, {
        last_seen_at: now,
        role: nextRole,
        name,
        token: nextToken,
      });
      return json({ ok: true, token: nextToken, user: publicUser(row), created: false, reclaimed: claimable }, 200, origin);
    }

    /* ---- 我是谁 ---- */
    if (path === '/api/me' && method === 'GET') {
      const me = await authUser(store, request);
      if (!me) return fail('还没进来，先填昵称和邀请码', 401, origin);
      if (me.status === 'banned') return fail('这个昵称已被停用', 403, origin);
      await store.updateUser(me.id, { last_seen_at: Date.now() });
      const out = { ok: true, user: publicUser(me) };
      if (me.role === 'admin') out.openReports = await store.countOpenReports();
      return json(out, 200, origin);
    }

    /* ---- 举报某个昵称 ---- */
    if (path === '/api/report' && method === 'POST') {
      const me = await authUser(store, request);
      if (!me) return fail('请先填昵称和邀请码进来', 401, origin);
      if (me.status === 'banned') return fail('这个昵称已被停用', 403, origin);

      const body = await request.json().catch(() => ({}));
      const targetName = String(body.targetName == null ? '' : body.targetName).trim();
      const reason = String(body.reason == null ? '' : body.reason).trim();
      const detail = String(body.detail == null ? '' : body.detail).trim().slice(0, DETAIL_MAX);
      if (!targetName) return fail('请填写要举报的昵称', 400, origin);
      if (!REASONS.includes(reason)) return fail('请选择一个举报原因', 400, origin);

      const target = await store.getUserByKey(nameKey(targetName));
      if (!target) return fail('没有找到这个昵称，检查一下有没有写错', 404, origin);
      if (target.id === me.id) return fail('不能举报自己', 400, origin);

      const now = Date.now();
      const dayAgo = now - 24 * 3600 * 1000;
      if (await store.countReportsByReporterSince(me.id, dayAgo) >= REPORT_PER_DAY) {
        return fail('今天举报得有点多，明天再说吧', 429, origin);
      }
      const dup = await store.countReportsForTargetSince(me.id, target.id, now - SAME_TARGET_HOURS * 3600 * 1000);
      if (dup > 0) return fail('这个昵称你已经举报过了，管理员会看到', 429, origin);

      await store.createReport({
        target_id: target.id,
        target_name: target.name,
        reporter_id: me.id,
        reporter_name: me.name,
        reason,
        detail,
        created_at: now,
      });
      return json({ ok: true }, 200, origin);
    }

    /* ---- 管理端 ---- */
    if (path.startsWith('/api/admin/')) {
      const me = await authUser(store, request);
      if (!me) return fail('请先填昵称和邀请码进来', 401, origin);
      if (me.status === 'banned') return fail('这个昵称已被停用', 403, origin);
      if (me.role !== 'admin') return fail('这里只有管理员能看', 403, origin);

      if (path === '/api/admin/summary' && method === 'GET') {
        return json({
          ok: true,
          openReports: await store.countOpenReports(),
          users: await store.countUsers(),
          banned: await store.countBannedUsers(),
        }, 200, origin);
      }

      if (path === '/api/admin/reports' && method === 'GET') {
        const status = url.searchParams.get('status') || 'open';
        const rows = await store.listReports(status === 'all' ? null : status, 200);
        return json({ ok: true, reports: rows.map(publicReport) }, 200, origin);
      }

      const reportAction = /^\/api\/admin\/reports\/(\d+)$/.exec(path);
      if (reportAction && method === 'POST') {
        const id = Number(reportAction[1]);
        const body = await request.json().catch(() => ({}));
        const action = String(body.action || '');
        if (action !== 'handled' && action !== 'rejected') return fail('动作不对', 400, origin);
        const note = String(body.note == null ? '' : body.note).trim().slice(0, DETAIL_MAX);
        const row = await store.getReport(id);
        if (!row) return fail('没有这条举报', 404, origin);
        await store.updateReport(id, {
          status: action,
          handled_by: me.name,
          handled_at: Date.now(),
          handle_note: note,
        });
        return json({ ok: true }, 200, origin);
      }

      if (path === '/api/admin/users' && method === 'GET') {
        const rows = await store.listUsersWithReportCounts(300);
        return json({
          ok: true,
          users: rows.map((u) => ({
            id: u.id,
            name: u.name,
            role: u.role,
            status: u.status,
            createdAt: u.created_at,
            lastSeenAt: u.last_seen_at,
            reports: u.reports,
          })),
        }, 200, origin);
      }

      const userAction = /^\/api\/admin\/users\/(\d+)$/.exec(path);
      if (userAction && method === 'POST') {
        const id = Number(userAction[1]);
        const body = await request.json().catch(() => ({}));
        const action = String(body.action || '');
        const target = await store.getUserById(id);
        if (!target) return fail('没有这个用户', 404, origin);

        if (action === 'ban') {
          if (target.id === me.id) return fail('不能停用自己', 400, origin);
          await store.updateUser(id, { status: 'banned' });
        } else if (action === 'unban') {
          await store.updateUser(id, { status: 'active' });
        } else if (action === 'reset') {
          /* 重置登录：清掉旧凭证，昵称回到「可认领」状态 */
          await store.updateUser(id, { token: '' });
        } else if (action === 'grant_admin') {
          await store.updateUser(id, { role: 'admin' });
        } else if (action === 'revoke_admin') {
          if (target.id === me.id) return fail('不能取消自己的管理员', 400, origin);
          await store.updateUser(id, { role: 'user' });
        } else {
          return fail('动作不对', 400, origin);
        }
        return json({ ok: true }, 200, origin);
      }

      return fail('没有这个管理接口', 404, origin);
    }

    /* ---- 头像：上传 ---- */
    if (path === '/api/avatar' && method === 'POST') {
      const me = await authUser(store, request);
      if (!me) return fail('请先填昵称和邀请码进来', 401, origin);
      if (me.status === 'banned') return fail('这个昵称已被停用', 403, origin);

      const body = await request.json().catch(() => ({}));
      const dataUrl = String(body.dataUrl || '');
      const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!m) return fail('头像格式不对，请用 PNG / JPG / WebP', 400, origin);
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const bytes = Buffer.from(m[2], 'base64');
      if (bytes.length < 200) return fail('图片太小了', 400, origin);
      if (bytes.length > 400 * 1024) return fail('头像请压到 400KB 以内', 400, origin);

      const ver = (me.avatar_ver || 0) + 1;
      const key = `avatars/${me.id}-${ver}.${ext}`;
      try {
        await store.putObject(key, bytes, `image/${ext === 'jpg' ? 'jpeg' : ext}`);
      } catch (e) {
        return fail('头像存不进去：' + e.message, 500, origin);
      }
      const old = me.avatar;
      const row = await store.updateUser(me.id, { avatar: key, avatar_ver: ver });
      /* 老图删掉，别占空间 */
      if (old && old !== key) { try { await store.deleteObject(old); } catch { /* 忽略 */ } }
      return json({ ok: true, user: publicUser(row) }, 200, origin);
    }

    /* ---- 头像：读取（公开，img 标签直接用）---- */
    {
      const av = /^\/api\/avatar\/(\d+)$/.exec(path);
      if (av && (method === 'GET' || method === 'HEAD')) {
        const target = await store.getUserById(Number(av[1]));
        if (!target || !target.avatar) return fail('没有头像', 404, origin);
        let obj = null;
        try { obj = await store.getObject(target.avatar); } catch { obj = null; }
        if (!obj) return fail('头像丢了', 404, origin);
        return new Response(obj.bytes, {
          status: 200,
          headers: {
            'Content-Type': obj.contentType || 'image/png',
            'Cache-Control': 'public, max-age=604800',
            ...corsHeaders(origin),
          },
        });
      }
    }

    /* ---- 找人（按昵称搜索）---- */
    if (path === '/api/search' && method === 'GET') {
      const me = await authUser(store, request);
      if (!me) return fail('请先填昵称和邀请码进来', 401, origin);
      const q = url.searchParams.get('q') || '';
      const rows = await store.searchUsers(q, me.id, 20);
      return json({ ok: true, users: rows.map(briefUser) }, 200, origin);
    }

    /* ---- 好友列表 / 请求 ---- */
    if (path === '/api/friends' && method === 'GET') {
      const me = await authUser(store, request);
      if (!me) return fail('请先填昵称和邀请码进来', 401, origin);
      const rel = await store.listFriendshipsFor(me.id);
      const friends = [], incoming = [], outgoing = [];
      for (const f of rel) {
        const otherId = f.a === me.id ? f.b : f.a;
        const other = await store.getUserById(otherId);
        if (!other) continue;
        if (f.status === 'accepted') {
          friends.push({ ...briefUser(other), since: f.updated_at || f.created_at, unread: await store.countUnreadFrom(me.id, otherId) });
        } else if (f.requester === me.id) {
          outgoing.push({ ...briefUser(other), id: f.id, at: f.created_at });
        } else {
          incoming.push({ ...briefUser(other), id: f.id, at: f.created_at });
        }
      }
      friends.sort((a, b) => (b.unread - a.unread) || (b.since - a.since));
      return json({ ok: true, friends, incoming, outgoing, unread: await store.countUnreadTotal(me.id) }, 200, origin);
    }

    if (path === '/api/friends/request' && method === 'POST') {
      const me = await authUser(store, request);
      if (!me) return fail('请先填昵称和邀请码进来', 401, origin);
      const body = await request.json().catch(() => ({}));
      const targetId = Number(body.targetId);
      if (!targetId || targetId === me.id) return fail('不能加自己', 400, origin);
      const target = await store.getUserById(targetId);
      if (!target) return fail('没有这个人', 404, origin);
      if (target.status === 'banned') return fail('这个昵称已被停用', 400, origin);

      const exist = await store.getFriendship(me.id, targetId);
      if (exist) {
        if (exist.status === 'accepted') return fail('你们已经是好友了', 400, origin);
        if (exist.requester === me.id) return fail('已经发过请求了，等对方同意', 400, origin);
        /* 对方先发的请求：直接互相成为好友 */
        await store.updateFriendship(exist.id, { status: 'accepted', updated_at: Date.now() });
        return json({ ok: true, accepted: true }, 200, origin);
      }
      await store.createFriendship({ a: me.id, b: targetId, requester: me.id, updated_at: Date.now() });
      return json({ ok: true }, 200, origin);
    }

    if (path === '/api/friends/respond' && method === 'POST') {
      const me = await authUser(store, request);
      if (!me) return fail('请先填昵称和邀请码进来', 401, origin);
      const body = await request.json().catch(() => ({}));
      const id = Number(body.id);
      const action = String(body.action || '');
      const mine = (await store.listFriendshipsFor(me.id)).find((f) => f.id === id);
      if (!mine) return fail('没有这条好友请求', 404, origin);
      if (mine.requester === me.id) return fail('这是你自己发的请求', 400, origin);
      if (mine.status !== 'pending') return fail('这条请求已经处理过了', 400, origin);
      if (action === 'accept') {
        await store.updateFriendship(id, { status: 'accepted', updated_at: Date.now() });
        return json({ ok: true }, 200, origin);
      }
      if (action === 'decline') {
        await store.deleteFriendship(id);
        return json({ ok: true }, 200, origin);
      }
      return fail('动作不对', 400, origin);
    }

    if (path === '/api/friends/remove' && method === 'POST') {
      const me = await authUser(store, request);
      if (!me) return fail('请先填昵称和邀请码进来', 401, origin);
      const body = await request.json().catch(() => ({}));
      const friendId = Number(body.friendId);
      const rel = await store.getFriendship(me.id, friendId);
      if (!rel) return fail('你们不是好友', 400, origin);
      await store.deleteFriendship(rel.id);
      return json({ ok: true }, 200, origin);
    }

    /* ---- 会话列表 ---- */
    if (path === '/api/threads' && method === 'GET') {
      const me = await authUser(store, request);
      if (!me) return fail('请先填昵称和邀请码进来', 401, origin);
      const rows = await store.listMessagesForThreads(me.id, 500);
      const map = new Map();
      for (const m of rows) {
        const otherId = m.from === me.id ? m.to : m.from;
        const cur = map.get(otherId) || { id: otherId, last: '', lastAt: 0, unread: 0 };
        cur.last = m.body;
        cur.lastAt = m.created_at;
        if (m.to === me.id && !m.read_at) cur.unread += 1;
        map.set(otherId, cur);
      }
      const threads = [];
      for (const t of map.values()) {
        const other = await store.getUserById(t.id);
        if (!other) continue;
        threads.push({ ...briefUser(other), last: t.last, lastAt: t.lastAt, unread: t.unread });
      }
      threads.sort((a, b) => b.lastAt - a.lastAt);
      return json({ ok: true, threads, unread: await store.countUnreadTotal(me.id) }, 200, origin);
    }

    /* ---- 和某个好友的消息 ---- */
    {
      const msgRoute = /^\/api\/messages\/(\d+)$/.exec(path);
      if (msgRoute && method === 'GET') {
        const me = await authUser(store, request);
        if (!me) return fail('请先填昵称和邀请码进来', 401, origin);
        const otherId = Number(msgRoute[1]);
        const rel = await store.getFriendship(me.id, otherId);
        if (!rel || rel.status !== 'accepted') return fail('你们还不是好友', 403, origin);
        const other = await store.getUserById(otherId);
        if (!other) return fail('没有这个人', 404, origin);
        const since = Number(url.searchParams.get('since') || 0);
        const rows = await store.listMessagesBetween(me.id, otherId, since, 200);
        await store.markMessagesRead(me.id, otherId, Date.now());
        return json({ ok: true, friend: briefUser(other), messages: rows.map(publicMessage) }, 200, origin);
      }
    }

    if (path === '/api/messages' && method === 'POST') {
      const me = await authUser(store, request);
      if (!me) return fail('请先填昵称和邀请码进来', 401, origin);
      if (me.status === 'banned') return fail('这个昵称已被停用', 403, origin);
      const body = await request.json().catch(() => ({}));
      const to = Number(body.to);
      const text = String(body.body == null ? '' : body.body).trim();
      if (!text) return fail('消息不能是空的', 400, origin);
      if (Array.from(text).length > 500) return fail('一条消息最多 500 字', 400, origin);
      const rel = await store.getFriendship(me.id, to);
      if (!rel || rel.status !== 'accepted') return fail('你们还不是好友，先加好友', 403, origin);

      /* 简单限频：一分钟内最多 30 条 */
      const recent = await store.listMessagesBetween(me.id, to, Date.now() - 60000, 200);
      if (recent.filter((m) => m.from === me.id).length >= 30) return fail('发得太快了，慢一点', 429, origin);

      const row = await store.createMessage({ from: me.id, to, body: text, created_at: Date.now() });
      return json({ ok: true, message: publicMessage(row) }, 200, origin);
    }

    if (path === '/api/health') return json({ ok: true, service: 'jhjx-account' }, 200, origin);
    return fail('没有这个接口: ' + method + ' ' + path + (env.DIAG ? ' | ' + env.DIAG : ''), 404, origin);
  } catch (err) {
    return fail('服务端出错了：' + (err && err.message ? err.message : '未知错误'), 500, origin);
  }
}

/* ---------------- Cloudflare Worker 入口 ---------------- */
export default {
  fetch(request, env) {
    return handle(request, env);
  },
};
