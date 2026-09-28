#!/usr/bin/env node
/**
 * 给页面做「省流量」微调（纯属性，不动内容、不动样式）：
 *   1. 页头/页脚/社团徽标：补 width/height（避免图片没到时布局跳动），页脚图改成懒加载
 *   2. 首页首屏会徽：换成 <picture>，优先用 42KB 的 WebP，老浏览器退回 PNG
 *   3. 九个部门徽标：懒加载（首屏不用下 300KB）
 *
 * 用法：node tools/tune-html.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pages = readdirSync(SITE_ROOT).filter((f) => f.endsWith('.html'));

const RULES = [
  {
    name: '页头会徽 + 宽高',
    from: '<img class="brand__logo" src="assets/img/logo-main.png" alt="浙江嘉豪嘉欣协会会徽">',
    to: '<img class="brand__logo" src="assets/img/logo-main.png" alt="浙江嘉豪嘉欣协会会徽" width="46" height="46" decoding="async">',
  },
  {
    name: '页脚会徽 懒加载 + 宽高',
    from: '<img src="assets/img/logo-main.png" alt="" aria-hidden="true">',
    to: '<img src="assets/img/logo-main.png" alt="" aria-hidden="true" width="56" height="56" loading="lazy" decoding="async">',
  },
  {
    name: '社团徽标 + 宽高',
    from: '<span class="club__badge"><img src="assets/img/logo-main.png" alt="浙江嘉豪嘉欣协会会徽"></span>',
    to: '<span class="club__badge"><img src="assets/img/logo-main.png" alt="浙江嘉豪嘉欣协会会徽" width="82" height="82" loading="lazy" decoding="async"></span>',
  },
  {
    name: '首屏会徽 换 WebP（PNG 兜底）',
    from: '<img src="assets/img/logo-main.png" alt="浙江嘉豪嘉欣协会会徽：圆章之中一枚「嘉」字，下衬海浪纹样">',
    to: '<picture><source srcset="assets/img/emblem.webp" type="image/webp">'
      + '<img src="assets/img/emblem.png" alt="浙江嘉豪嘉欣协会会徽：圆章之中一枚「嘉」字，下衬海浪纹样" width="512" height="512" fetchpriority="high" decoding="async">'
      + '</picture>',
  },
];

/* 部门徽标：<img src="assets/img/dept-0X-....png" alt="...部徽"> → 加懒加载与宽高 */
const DEPT = /<img src="(assets\/img\/dept-\d+-[a-z]+\.png)" alt="([^"]+)">/g;

let total = 0;
for (const page of pages) {
  const p = join(SITE_ROOT, page);
  let html = readFileSync(p, 'utf8');
  const before = html;
  const notes = [];

  for (const rule of RULES) {
    const n = html.split(rule.from).length - 1;
    if (!n) continue;
    html = html.split(rule.from).join(rule.to);
    notes.push(`${rule.name}×${n}`);
  }

  let deptCount = 0;
  html = html.replace(DEPT, (m, src, alt) => {
    deptCount++;
    return `<img src="${src}" alt="${alt}" width="76" height="76" loading="lazy" decoding="async">`;
  });
  if (deptCount) notes.push(`部门徽标懒加载×${deptCount}`);

  if (html !== before) {
    writeFileSync(p, html, 'utf8');
    total++;
    console.log(`  ${page}：${notes.join('，')}`);
  }
}
console.log(`\n共改动 ${total} 个页面`);
