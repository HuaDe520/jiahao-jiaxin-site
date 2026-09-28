/* =========================================================
   本地联调服务器
   ---------------------------------------------------------
   作用：不开云、不花钱，就能把整套用户系统跑起来验收。
   · 直接用 worker.js 里的同一份路由逻辑（不复制代码）
   · 存储用 store-json.js（和阿里云上跑的是同一份实现），
     数据库落在本地文件，头像等二进制落在 .dev-objects/
   · 同时托管站点静态文件，所以不存在跨域问题

   用法：node backend/dev-server.mjs          （默认 http://127.0.0.1:8787）
   邀请码从 backend/.dev.vars 读取，这个文件不会进仓库、也不会发布。
   ========================================================= */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './worker.js';
import { createJsonStore } from './store-json.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = join(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const JSON_FILE = process.env.JSON_FILE || join(__dirname, '.dev-db.json');

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

/* ---------- 存储：JSON 版（与阿里云一致） ---------- */
const OBJECT_DIR = join(__dirname, '.dev-objects');
const STORE = createJsonStore({
  async read() { return existsSync(JSON_FILE) ? readFileSync(JSON_FILE, 'utf8') : null; },
  async write(text) { writeFileSync(JSON_FILE, text, 'utf8'); return true; },
  /* 本地把「二进制对象」落到磁盘，模拟 OSS 上的头像文件 */
  async putObject(key, bytes, contentType) {
    const full = join(OBJECT_DIR, key);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
    writeFileSync(full + '.type', contentType || 'application/octet-stream', 'utf8');
    return true;
  },
  async getObject(key) {
    const full = join(OBJECT_DIR, key);
    if (!existsSync(full)) return null;
    const typeFile = full + '.type';
    return {
      bytes: readFileSync(full),
      contentType: existsSync(typeFile) ? readFileSync(typeFile, 'utf8') : 'image/png',
    };
  },
  async deleteObject(key) {
    const full = join(OBJECT_DIR, key);
    for (const f of [full, full + '.type']) { try { rmSync(f, { force: true }); } catch { /* 忽略 */ } }
    return true;
  },
});

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
  /* 用 Buffer 转发，头像这种二进制不能被当文本转（会变乱码） */
  const buf = Buffer.from(await response.arrayBuffer());
  const headers = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(response.status, headers);
  res.end(buf);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`本地联调服务器已启动：http://127.0.0.1:${PORT}`);
  console.log(`  账号页  http://127.0.0.1:${PORT}/account.html`);
  console.log(`  管理页  http://127.0.0.1:${PORT}/admin.html`);
  console.log(`  数据库  ${JSON_FILE}（头像在 ${OBJECT_DIR}）`);
});
