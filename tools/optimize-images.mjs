#!/usr/bin/env node
/**
 * 图片瘦身：把站点用到的图片重新导出成「显示尺寸够用 + PNG 调色板压缩」的小图。
 *
 * 背景：原图是 640×640 的会徽（592 KB）、512 的图标（344 KB）、
 *      九个部门徽标各 70–115 KB。首页光图片就有 1.8 MB，
 *      在国内访问 GitHub Pages 的环境下直接卡到打不开。
 *      实际显示尺寸只有 46–360 px，按显示尺寸导出即可。
 *
 * 原始文件统一备份到 D:\dsh\image-sources\，随时可以重新导出。
 * 需要 sharp：本机装在 D:\dsh\.imgtools（npm i sharp）。
 *
 * 用法：node tools/optimize-images.mjs [--force]
 */
import { existsSync, mkdirSync, copyFileSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMG = join(SITE_ROOT, 'assets', 'img');
const BACKUP = 'D:/dsh/image-sources';

let sharp;
for (const spec of ['sharp', 'D:/dsh/.imgtools/node_modules/sharp']) {
  try { sharp = require(spec); break; } catch { /* 试下一个 */ }
}
if (!sharp) {
  console.error('找不到 sharp。先执行：cd D:\\dsh\\.imgtools && npm i sharp');
  process.exit(1);
}

/* 目标尺寸按真实显示尺寸 ×2~3 倍来定：
   .brand__logo 46px / 页脚 56px / 弹窗 84px / 社团徽标 82px / 首屏会徽 min(360px,78vw)
   部门徽标 76px，PWA 图标按 manifest 要求 */
const JOBS = [
  { file: 'logo-main.png', width: 256, quality: 88, why: '页头 46px / 页脚 56px / 弹窗 84px / 标签页图标' },
  { file: 'emblem.png', from: 'logo-main.png', width: 512, quality: 76, why: '首屏会徽 min(360px,78vw) 的兜底' },
  { file: 'dept-01-shutong.png', width: 192, quality: 88, why: '部门徽标 76px' },
  { file: 'dept-02-fanxun.png', width: 192, quality: 88, why: '部门徽标 76px' },
  { file: 'dept-03-youlun.png', width: 192, quality: 88, why: '部门徽标 76px' },
  { file: 'dept-04-mohui.png', width: 192, quality: 88, why: '部门徽标 76px' },
  { file: 'dept-05-lixing.png', width: 192, quality: 88, why: '部门徽标 76px' },
  { file: 'dept-06-tongyou.png', width: 192, quality: 88, why: '部门徽标 76px' },
  { file: 'dept-07-xianfu.png', width: 192, quality: 88, why: '部门徽标 76px' },
  { file: 'dept-08-qingtan.png', width: 192, quality: 88, why: '部门徽标 76px' },
  { file: 'dept-09-jieyou.png', width: 192, quality: 88, why: '部门徽标 76px' },
  { file: 'apple-touch-icon.png', width: 180, quality: 88, why: 'iOS 主屏图标 180px' },
  { file: 'icon-192.png', width: 192, quality: 88, why: 'PWA 图标 192px' },
  { file: 'icon-512.png', width: 512, quality: 60, why: 'PWA 图标 512px（只在安装时下载）' },
  { file: 'icon-maskable-512.png', width: 512, quality: 60, why: 'PWA 自适应图标 512px' },
];

/* 顺带导出一份 WebP：首屏会徽用它，比 PNG 小一半多（<picture> 里当首选，PNG 兜底） */
const WEBP = [
  { file: 'emblem.webp', from: 'logo-main.png', width: 512, quality: 84 },
];

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const originals = join(IMG, 'original');
mkdirSync(BACKUP, { recursive: true });

/* 1. 备份原图（只备份没备份过的） */
let backed = 0;
for (const f of readdirSync(IMG)) {
  const p = join(IMG, f);
  if (!statSync(p).isFile()) continue;
  const b = join(BACKUP, f);
  if (!existsSync(b)) { copyFileSync(p, b); backed++; }
}
/* 种子文件（logo-main.png 之后会被覆盖，备份里留的是原始 640px 版本） */
const seed = (f) => {
  const p = join(BACKUP, f);
  if (!existsSync(p)) throw new Error('备份里没有 ' + f);
  return p;
};
console.log(`原图备份：${BACKUP}（本次新增 ${backed} 个）\n`);

const before = {};
for (const f of readdirSync(IMG)) {
  const p = join(IMG, f);
  if (statSync(p).isFile()) before[f] = statSync(p).size;
}

/* 2. 重新导出 PNG */
console.log('重新导出（尺寸 / 压缩后）：');
for (const job of JOBS) {
  const srcPath = seed(job.from || job.file);
  const out = join(IMG, job.file);
  const buf = await sharp(srcPath)
    .resize({ width: job.width, height: job.width, fit: 'inside', withoutEnlargement: true })
    .png({ palette: true, quality: job.quality, effort: 10, compressionLevel: 9 })
    .toBuffer();
  writeFileSync(out, buf);
  const oldSize = before[job.file];
  const flag = oldSize ? `${kb(oldSize)} → ` : '新增 → ';
  console.log(`  ${job.file.padEnd(26)} ${String(job.width).padStart(4)}px  ${flag}${kb(buf.length).padStart(10)}   ${job.why}`);
}

/* 3. WebP */
console.log('\nWebP：');
for (const job of WEBP) {
  const srcPath = seed(job.from);
  const out = join(IMG, job.file);
  const buf = await sharp(srcPath)
    .resize({ width: job.width, height: job.width, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: job.quality, effort: 6 })
    .toBuffer();
  writeFileSync(out, buf);
  console.log(`  ${job.file.padEnd(26)} ${String(job.width).padStart(4)}px  新增 → ${kb(buf.length).padStart(10)}`);
}

/* 4. 汇总 */
let sumBefore = 0, sumAfter = 0;
console.log('\n图片总体积：');
for (const f of readdirSync(IMG)) {
  const p = join(IMG, f);
  if (!statSync(p).isFile()) continue;
  const isGenerated = JOBS.some((j) => j.file === f) || WEBP.some((j) => j.file === f);
  if (before[f]) sumBefore += before[f];
  if (isGenerated) sumAfter += statSync(p).size;
}
let originalBytes = 0;
if (existsSync(originals)) {
  for (const f of readdirSync(originals)) {
    const p = join(originals, f);
    if (statSync(p).isFile()) originalBytes += statSync(p).size;
  }
}
console.log(`  站点用图合计：${kb(sumBefore)}  →  ${kb(sumAfter)}   省下 ${(100 - (sumAfter / sumBefore) * 100).toFixed(0)}%`);
console.log(`  assets/img/original/ 里另有 ${kb(originalBytes)} 的原始文件（留在仓库当素材，不发布到线上）`);
