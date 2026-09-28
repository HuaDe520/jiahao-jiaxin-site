/* =========================================================
   阿里云函数计算（FC 3.0）入口
   ---------------------------------------------------------
   用法：函数类型选「事件函数」，加一个 HTTP 触发器，
   代码包为本目录 + 上级目录的 worker.js / store-*.js。

   环境变量（函数配置里填）：
     USER_CODE   普通邀请码
     ADMIN_CODE  管理员邀请码
     OSS_BUCKET  OSS Bucket 名
     OSS_REGION  例：oss-cn-hangzhou
     OSS_KEY     存数据的对象名，默认 jhjx-account/db.json
     OSS_AK / OSS_SK   RAM 用户的 AccessKey（若用函数角色则不用填）

   前端接口形状与 Cloudflare 版完全一致。
   ========================================================= */

import { handle } from '../worker.js';
import { createJsonStore } from '../store-json.js';
import { createOssIo } from './oss.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

let store = null;   /* 同一个实例里复用，省掉重复读 OSS */

/* 本地测试用：把存储换成文件，就能在没有 OSS 的情况下跑通整个函数 */
function createFileIo(file) {
  return {
    async read() { return existsSync(file) ? readFileSync(file, 'utf8') : null; },
    async write(text) { writeFileSync(file, text, 'utf8'); return true; },
  };
}

function buildStore(env, context) {
  if (process.env.JHJX_LOCAL_DB_FILE) {
    return createJsonStore(createFileIo(process.env.JHJX_LOCAL_DB_FILE));
  }

  const bucket = env.OSS_BUCKET;
  const region = env.OSS_REGION;
  if (!bucket || !region) throw new Error('缺少 OSS_BUCKET / OSS_REGION 环境变量');

  /* 优先用环境变量里的 RAM AccessKey，其次用函数角色给的临时凭证 */
  const cred = (context && context.credentials) || {};
  const ak = env.OSS_AK || cred.accessKeyId;
  const sk = env.OSS_SK || cred.accessKeySecret;
  const stsToken = env.OSS_AK ? undefined : cred.securityToken;
  if (!ak || !sk) throw new Error('没有可用的 OSS 凭证（OSS_AK/OSS_SK 或函数角色）');

  const io = createOssIo({
    bucket,
    region,
    ak,
    sk,
    stsToken,
    key: env.OSS_KEY || 'jhjx-account/db.json',
  });
  return createJsonStore(io);
}

/* FC 不同部署方式传进来的第一个参数形状不一样：
   · JSON 事件对象（事件函数 + HTTP 触发器）
   · Buffer / 字符串（原始 HTTP 请求文本，或 JSON 文本）
   · http.IncomingMessage（Web 函数）
   这里统一成事件对象。 */
function coerceEvent(raw) {
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw) && typeof raw !== 'string') {
    if (typeof raw.method === 'string' && typeof raw.url === 'string') {
      return { httpMethod: raw.method, rawPath: raw.url, headers: raw.headers || {}, __web: true, __req: raw };
    }
    return raw;
  }
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw == null ? '' : raw);
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch { /* 继续按原始请求解析 */ }
  }
  const line = /^([A-Z]+)\s+(\S+)/.exec(trimmed);
  if (line) {
    /* 原始 HTTP 文本：取请求行，再看有没有 body */
    const parts = trimmed.split(/\r?\n\r?\n/);
    return { httpMethod: line[1], rawPath: line[2], body: parts[1] || undefined, __raw: true };
  }
  return { __rawText: text.slice(0, 200) };
}

/* 路径在不同触发器形状里可能是 rawPath / path / requestContext.http.path，
   偶尔还会带完整域名，这里统一成 /xxx 形式 */
function normalizePath(event, http) {
  let p = event.rawPath || event.path || (http && http.path) || (event.requestContext && event.requestContext.path) || '/';
  if (typeof p !== 'string') p = '/';
  if (/^https?:\/\//i.test(p)) {
    try { p = new URL(p).pathname; } catch { /* 保持原样 */ }
  }
  if (!p.startsWith('/')) p = '/' + p;
  return p;
}

/* 把 FC 触发器的各种事件形状统一成标准 Request */
function toRequest(event) {
  const e = event || {};
  const http = (e.requestContext && e.requestContext.http) || {};
  const method = (e.httpMethod || e.method || http.method || 'GET').toUpperCase();
  const rawPath = normalizePath(e, http);
  const qs = e.queryStringParameters || e.queryParameters || {};
  const query = Object.keys(qs).length
    ? '?' + Object.entries(qs).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';

  const headers = new Headers();
  Object.entries(e.headers || {}).forEach(([k, v]) => {
    if (v != null) headers.set(k, String(v));
  });

  let body;
  if (e.body) {
    body = e.isBase64Encoded ? Buffer.from(e.body, 'base64') : e.body;
  }

  const host = headers.get('host') || 'fc.local';
  return new Request(`https://${host}${rawPath}${query}`, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });
}

function toFcResponse(res) {
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  const type = (res.headers.get('content-type') || '').toLowerCase();
  /* 图片是二进制，必须用 base64 回传，否则会被当文本搞坏 */
  if (type.startsWith('image/')) {
    return res.arrayBuffer().then((buf) => ({
      statusCode: res.status,
      headers,
      body: Buffer.from(buf).toString('base64'),
      isBase64Encoded: true,
    }));
  }
  return res.text().then((text) => ({
    statusCode: res.status,
    headers,
    body: text,
    isBase64Encoded: false,
  }));
}

/* Origin 是 fetch 的「禁止设置」头，拼不到 Request 上，单独取出来传给路由 */
function rawOrigin(event) {
  const h = (event && event.headers) || {};
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === 'origin') return h[k];
  }
  return undefined;
}

export const handler = async (event, context) => {
  try {
    const ev = coerceEvent(event);
    const env = {
      USER_CODE: process.env.USER_CODE,
      ADMIN_CODE: process.env.ADMIN_CODE,
      OSS_BUCKET: process.env.OSS_BUCKET,
      OSS_REGION: process.env.OSS_REGION,
      OSS_KEY: process.env.OSS_KEY,
      OSS_AK: process.env.OSS_AK,
      OSS_SK: process.env.OSS_SK,
    };

    if (!store) store = buildStore(env, context);

    const request = toRequest(ev);
    const e = ev || {};
    const http = (e.requestContext && e.requestContext.http) || {};
    /* DIAG 只在 404 时回显，方便排查触发器传过来的路径形状 */
    const diag = JSON.stringify({
      rawPath: e.rawPath,
      path: e.path,
      httpPath: http.path,
      httpMethod: e.httpMethod,
      method: e.method,
      raw: !!e.__raw,
      keys: Object.keys(e).slice(0, 12),
    });
    const response = await handle(request, { ...env, STORE: store, ORIGIN: rawOrigin(ev), DIAG: diag });
    return await toFcResponse(response);
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: false, error: '函数出错：' + (err && err.message ? err.message : '未知') }),
      isBase64Encoded: false,
    };
  }
};

/* 兼容 FC 的 web 函数写法（万一配成了 web 函数也能跑） */
export default { handler };
