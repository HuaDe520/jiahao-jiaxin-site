#!/usr/bin/env node
/**
 * 等待 GitHub Pages 为自定义域名签发 TLS 证书，然后自动打开「Enforce HTTPS」并验证。
 *
 * 用法：
 *   node tools/enable-https.mjs                      # 默认仓库 jiahao-jiaxin-site
 *   node tools/enable-https.mjs <repo> <domain>
 *
 * 令牌来源：环境变量 GITHUB_TOKEN / GH_TOKEN，或上一级目录的 token.txt
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.github.com';
const SITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.argv[2] || 'jiahao-jiaxin-site';
const DOMAIN = process.argv[3] || 'xbc-zjja.com.cn';
const MAX_MINUTES = Number(process.env.MAX_MINUTES || 30);

function readToken() {
  for (const f of [process.env.GITHUB_TOKEN, process.env.GH_TOKEN, join(SITE_ROOT, '..', 'token.txt'), join(SITE_ROOT, 'token.txt')].filter(Boolean)) {
    try {
      const t = readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
      if (t) return t;
    } catch { /* next */ }
  }
  throw new Error('找不到访问令牌');
}

const TOKEN = readToken();
let owner = null;

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'jiahao-jiaxin-https',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { message: text }; }
  return { status: res.status, ok: res.ok, json };
}

const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

const me = await api('GET', '/user');
if (!me.ok) { console.error('令牌无效'); process.exit(1); }
owner = me.json.login;

console.log(`[${stamp()}] 仓库 ${owner}/${REPO}，域名 ${DOMAIN}，最多等待 ${MAX_MINUTES} 分钟`);

let issued = false;
for (let i = 0; i < MAX_MINUTES; i++) {
  const p = await api('GET', `/repos/${owner}/${REPO}/pages`);
  if (!p.ok) { console.error('读取 Pages 失败：', p.status, p.json?.message); process.exit(1); }
  const cert = p.json.https_certificate || {};
  const state = cert.state || '(空)';
  const domains = (cert.domains || []).join(',') || '-';
  console.log(`[${stamp()}] 第 ${i + 1} 次检查：证书 state=${state} domains=${domains} https_enforced=${p.json.https_enforced}`);

  if (state === 'approved' || state === 'issued' || (cert.domains || []).length > 0) { issued = true; break; }
  if (state === 'bad_authz' || state === 'disapproved') {
    console.error('证书签发失败（' + state + '），通常是 DNS 未生效或域名被其他仓库占用');
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 60000));
}

if (!issued) {
  console.log(`[${stamp()}] 等待超时，证书仍未签发。可在仓库 Settings → Pages 里点 “Request a new certificate”，或稍后重跑本脚本。`);
  process.exit(2);
}

const put = await api('PUT', `/repos/${owner}/${REPO}/pages`, { https_enforced: true });
console.log(`[${stamp()}] 开启 Enforce HTTPS：${put.ok ? '成功 ✅' : '失败 ' + put.status + ' ' + put.json?.message}`);

for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 15000));
  try {
    const res = await fetch(`https://${DOMAIN}/`, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const html = await res.text();
    const ok = res.ok && html.includes('浙江嘉豪嘉欣协会');
    if (ok) {
      console.log(`[${stamp()}] ✅ https://${DOMAIN}/ 已可用（HTTP ${res.status}，内容正确）`);
      const www = await fetch(`https://www.${DOMAIN}/`, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
      console.log(`[${stamp()}] www: HTTP ${www.status}（已跟随跳转到 ${www.url}）`);
      process.exit(0);
    }
    console.log(`[${stamp()}] HTTPS 已响应但内容未匹配：HTTP ${res.status}`);
  } catch (e) {
    console.log(`[${stamp()}] HTTPS 还不可用：${e.message}`);
  }
}
console.log(`[${stamp()}] 证书已签发但 HTTPS 尚未生效，稍后会自动好（最长 24 小时）`);
process.exit(3);
