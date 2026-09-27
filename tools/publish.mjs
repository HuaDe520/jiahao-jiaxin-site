#!/usr/bin/env node
/**
 * 通过 GitHub REST API 发布本站。
 *
 * 为什么不用 git push：部分网络环境中 github.com 直连不稳定甚至不通，
 * 但 api.github.com 一直可用。本脚本只用 api.github.com 完成
 * 「建仓库 → 上传全部文件 → 开启 Pages」，不依赖 git 推送，也不需要 gh CLI。
 *
 * 用法：
 *   node tools/publish.mjs                       # 发布（仓库名 jiahao-jiaxin-site）
 *   node tools/publish.mjs --repo my-site        # 指定仓库名
 *   node tools/publish.mjs --dry-run             # 只列出将要上传的文件
 *   node tools/publish.mjs --token-file D:\x.txt # 指定令牌文件
 *   node tools/publish.mjs --domain jhjx.com     # 顺带绑定自定义域名
 *
 * 令牌来源优先级：--token-file > 环境变量 GITHUB_TOKEN / GH_TOKEN > 上一级目录的 token.txt
 * 需要的权限：classic token 勾选 repo + workflow
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.github.com';
const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = join(__dirname, '..');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(name);

const REPO = flag('--repo', 'jiahao-jiaxin-site');
const DOMAIN = flag('--domain', null);
const DRY = has('--dry-run');
const SKIP_DIRS = new Set(['.git', '.preview', 'node_modules', '.vercel', '.netlify']);
const SKIP_FILES = new Set(['token.txt', '.DS_Store', 'Thumbs.db']);
const MAX_BYTES = 25 * 1024 * 1024;

/* ---------- 工具 ---------- */

function readToken() {
  const candidates = [
    flag('--token-file', null),
    process.env.GITHUB_TOKEN,
    process.env.GH_TOKEN,
    join(SITE_ROOT, '..', 'token.txt'),
    join(SITE_ROOT, 'token.txt'),
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      const token = lines.map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
      if (token) return { token, from: file };
    } catch { /* 尝试下一个来源 */ }
  }
  return null;
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'jiahao-jiaxin-publish',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { message: text }; }
  return { status: res.status, ok: res.ok, json };
}

function collectFiles(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, base, out);
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) continue;
      const size = statSync(full).size;
      if (size > MAX_BYTES) { console.warn(`  ! 跳过超过 25MB 的文件: ${entry.name}`); continue; }
      out.push({ path: relative(base, full).split(sep).join('/'), file: full, size });
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 主流程 ---------- */

const found = readToken();
if (!found && !DRY) {
  console.error('找不到访问令牌。请把 token 写进 token.txt（或设置 GITHUB_TOKEN 环境变量）。');
  process.exit(1);
}

const files = collectFiles(SITE_ROOT).sort((a, b) => a.path.localeCompare(b.path));
const totalBytes = files.reduce((s, f) => s + f.size, 0);
console.log(`准备上传 ${files.length} 个文件，共 ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
if (DRY) {
  for (const f of files) console.log(`  ${f.path}  ${(f.size / 1024).toFixed(1)}KB`);
  process.exit(0);
}
const token = found.token;
console.log(`令牌来源: ${found.from}`);

const me = await api('GET', '/user', { token });
if (!me.ok) { console.error('令牌无效：', me.status, me.json?.message); process.exit(1); }
const owner = me.json.login;
console.log(`已认证为 ${owner}`);

/* 1. 建仓库（已存在则复用） */
const repoRes = await api('POST', '/user/repos', {
  token,
  body: {
    name: REPO,
    description: '浙江嘉豪嘉欣协会官方网站',
    homepage: `https://${owner}.github.io/${REPO}/`,
    private: false,
    has_issues: true,
    has_wiki: false,
    has_projects: false,
    auto_init: false,
  },
});
if (repoRes.status === 201) {
  console.log(`已创建仓库 ${owner}/${REPO}`);
} else if (repoRes.status === 422) {
  const check = await api('GET', `/repos/${owner}/${REPO}`, { token });
  if (!check.ok) { console.error('仓库创建失败：', repoRes.json?.message); process.exit(1); }
  console.log(`仓库 ${owner}/${REPO} 已存在，继续更新内容`);
} else {
  console.error('创建仓库失败：', repoRes.status, repoRes.json?.message);
  process.exit(1);
}

/* 2. 空仓库没有 HEAD，无法直接建 blob：先用 Contents API 造一个初始提交 */
let repoInfo = await api('GET', `/repos/${owner}/${REPO}`, { token });
let branch = repoInfo.json?.default_branch || 'main';
let refRes = await api('GET', `/repos/${owner}/${REPO}/git/ref/heads/${branch}`, { token });

if (!refRes.ok) {
  console.log('仓库当前为空，先创建初始提交…');
  const seed = await api('PUT', `/repos/${owner}/${REPO}/contents/.gitkeep`, {
    token,
    body: { message: 'chore: 初始化仓库', content: Buffer.from('\n').toString('base64') },
  });
  if (!seed.ok) { console.error('初始化失败：', seed.status, seed.json?.message); process.exit(1); }
  repoInfo = await api('GET', `/repos/${owner}/${REPO}`, { token });
  branch = repoInfo.json?.default_branch || branch;
  refRes = await api('GET', `/repos/${owner}/${REPO}/git/ref/heads/${branch}`, { token });
  if (!refRes.ok) { console.error('初始化后仍读不到分支：', refRes.status, refRes.json?.message); process.exit(1); }
}
console.log(`目标分支: ${branch}`);
const parents = [refRes.json.object.sha];

/* 3. 逐个上传文件为 blob */
const tree = [];
let done = 0;
const CONCURRENCY = 4;
async function worker(queue) {
  while (queue.length) {
    const f = queue.shift();
    const blob = await api('POST', `/repos/${owner}/${REPO}/git/blobs`, {
      token,
      body: { content: readFileSync(f.file).toString('base64'), encoding: 'base64' },
    });
    if (!blob.ok) { console.error(`\n上传失败 ${f.path}: ${blob.status} ${blob.json?.message}`); process.exit(1); }
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.json.sha });
    done++;
    process.stdout.write(`\r  已上传 ${done}/${files.length}  ${f.path.slice(0, 44).padEnd(46)}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker([...files])));
process.stdout.write('\n');

/* 4. 建 tree / commit / 更新分支 */
const treeRes = await api('POST', `/repos/${owner}/${REPO}/git/trees`, { token, body: { tree } });
if (!treeRes.ok) { console.error('创建 tree 失败：', treeRes.status, treeRes.json?.message); process.exit(1); }

const commitRes = await api('POST', `/repos/${owner}/${REPO}/git/commits`, {
  token,
  body: {
    message: '初始化协会官网：首页、九个部门、群规、部署配置',
    tree: treeRes.json.sha,
    parents,
  },
});
if (!commitRes.ok) { console.error('创建提交失败：', commitRes.status, commitRes.json?.message); process.exit(1); }

const refWrite = await api('PATCH', `/repos/${owner}/${REPO}/git/refs/heads/${branch}`, {
  token,
  body: { sha: commitRes.json.sha, force: true },
});
if (!refWrite.ok) { console.error('更新分支失败：', refWrite.status, refWrite.json?.message); process.exit(1); }
console.log(`已提交并更新 ${branch} 分支 (${commitRes.json.sha.slice(0, 7)})`);

/* 5. 开启 Pages（分支发布，根目录） */
let pages = await api('GET', `/repos/${owner}/${REPO}/pages`, { token });
if (pages.status === 404) {
  pages = await api('POST', `/repos/${owner}/${REPO}/pages`, {
    token,
    body: { source: { branch, path: '/' } },
  });
  console.log(pages.ok ? '已开启 GitHub Pages（分支发布）' : `开启 Pages 失败: ${pages.status} ${pages.json?.message}`);
} else if (pages.ok) {
  const upd = await api('PUT', `/repos/${owner}/${REPO}/pages`, {
    token,
    body: { source: { branch, path: '/' } },
  });
  console.log(upd.ok ? 'Pages 已存在，已确认发布源' : `Pages 更新失败: ${upd.status} ${upd.json?.message}`);
}

/* 6. 可选：绑定自定义域名 */
if (DOMAIN) {
  const put = await api('PUT', `/repos/${owner}/${REPO}/pages`, { token, body: { cname: DOMAIN } });
  console.log(put.ok ? `已绑定自定义域名 ${DOMAIN}` : `绑定域名失败: ${put.status} ${put.json?.message}`);
}

/* 7. 等待构建完成并验证 */
const url = `https://${owner}.github.io/${REPO}/`;
console.log(`\n站点地址: ${url}`);
process.stdout.write('等待 Pages 构建');
let built = false;
for (let i = 0; i < 30; i++) {
  const st = await api('GET', `/repos/${owner}/${REPO}/pages`, { token });
  if (st.json?.status === 'built') { built = true; break; }
  process.stdout.write('.');
  await sleep(10000);
}
console.log(built ? '\n构建完成 (status=built)' : '\n构建状态查询超时，稍后可在仓库 Settings → Pages 查看');

try {
  const res = await fetch(url, { redirect: 'follow' });
  const html = await res.text();
  const ok = res.ok && html.includes('浙江嘉豪嘉欣协会');
  console.log(`线上自检: HTTP ${res.status}，${ok ? '页面内容正确 ✓' : '页面内容未匹配，请手动确认'}`);
} catch (e) {
  console.log('线上自检失败（可能是本机到 github.io 的网络问题）: ' + e.message);
}

console.log(`\n仓库: https://github.com/${owner}/${REPO}`);
console.log(`网站: ${url}`);
if (!DOMAIN) console.log('绑定自定义域名：node tools/publish.mjs --domain 你的域名');
