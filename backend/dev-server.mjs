/* =========================================================
   本地联调服务器
   ---------------------------------------------------------
   作用：不开云、不花钱，就能把整套用户系统跑起来验收。
   · 直接用 worker.js 里的同一份路由逻辑（不复制代码）
   · 数据库用 Node 自带的 node:sqlite，SQL 与线上 D1 完全一致
   · 同时托管站点静态文件，所以不存在跨域问题

   用法：node backend/dev-server.mjs          （默认 http://127.0.0.1:8787）
   邀请码从 backend/.dev.vars 读取，这个文件不会进仓库、也不会发布。
   ========================================================= */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { handle } from './worker.js';
import { createJsonStore } from './store-json.js';
import { createD1Store } from './store-d1.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = join(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const DB_FILE = process.env.DB_FILE || join(__dirname, '.dev.sqlite');
const JSON_FILE = process.env.JSON_FILE || join(__dirname, '.dev-db.json');
/* 默认用 JSON 版存储 —— 它和阿里云上跑的是同一份实现 */
const STORE_KIND = (process.env.STORE || 'json').toLowerCase();

/* ---------- 邀请码：只从 .dev.vars 或环境变量来，不写死在代码里 ---------- */
function loadVars() {
  const out = { ...process.env };
  const file = join(__dirname, '.dev.vars');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
  return out;
}

const vars = loadVars();
if (!vars.USER_CODE || !vars.ADMIN_CODE) {
  console.error('缺少邀请码：请在 backend/.dev.vars 里写 USER_CODE=... 和 ADMIN_CODE=...');
  process.exit(1);
}

/* ---------- 存储：JSON 版（与阿里云一致）或 SQLite/D1 版 ---------- */
let STORE;
if (STORE_KIND === 'sqlite') {
  const sqlite = new DatabaseSync(DB_FILE);
  sqlite.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
  const DB = {
    prepare(sql) {
      let params = [];
      const stmt = {
        bind(...args) { params = args; return stmt; },
        async first() {
          const row = sqlite.prepare(sql).get(...params);
          return row === undefined ? null : row;
        },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async run() { return { meta: sqlite.prepare(sql).run(...params) }; },
      };
      return stmt;
    },
  };
  STORE = createD1Store(DB);
} else {
  STORE = createJsonStore({
    async read() { return existsSync(JSON_FILE) ? readFileSync(JSON_FILE, 'utf8') : null; },
    async write(text) { writeFileSync(JSON_FILE, text, 'utf8'); return true; },
  });
}

const env = {
  STORE,
  USER_CODE: vars.USER_CODE,
  ADMIN_CODE: vars.ADMIN_CODE,
};

/* ---------- 静态文件 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive',
  '.md': 'text/markdown; charset=utf-8',
};

function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel.endsWith('/')) rel += 'index.html';
  const full = join(SITE_ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(SITE_ROOT) || !existsSync(full) || !statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(readFileSync(full));
}

/* ---------- 请求转发给 Worker 的那份逻辑 ---------- */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (!url.pathname.startsWith('/api/')) {
    serveStatic(url.pathname, res);
    return;
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const request = new Request(url.toString(), {
    method: req.method,
    headers: req.headers,
    body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
  });

  const response = await handle(request, env);
  const text = await response.text();
  const headers = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(response.status, headers);
  res.end(text);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`本地联调服务器已启动：http://127.0.0.1:${PORT}`);
  console.log(`  账号页  http://127.0.0.1:${PORT}/account.html`);
  console.log(`  管理页  http://127.0.0.1:${PORT}/admin.html`);
  console.log(`  数据库  ${DB_FILE}`);
});
