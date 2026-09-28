#!/usr/bin/env node
/**
 * 给 HTML 里的本站样式/脚本加上内容指纹：assets/js/calc.js?v=1a2b3c4d
 *
 * 为什么需要：GitHub Pages 给静态文件设了 10 分钟缓存。若 HTML 已经更新、
 * 而浏览器手里的 calc.js 还是旧的，页面就会出现「改了但没生效」的错位。
 * 文件名后带内容哈希后，文件一变 URL 就变，浏览器必然取到新版本。
 *
 * 用法：
 *   node tools/stamp-assets.mjs      # 单独执行
 *   publish.mjs 会在上传前自动调用它
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(__dirname, '..');

/* 只处理本站 assets/ 下的 .css 与 .js；外链、图片、vendor 库不动 */
const ASSET_RE = /(href|src)="(assets\/[^"?#]+\.(?:css|js))(\?v=[0-9a-z]+)?"/g;

export function stampAssets(root = DEFAULT_ROOT) {
  const cache = new Map();
  const hashOf = (rel) => {
    if (cache.has(rel)) return cache.get(rel);
    let hash = null;
    try {
      hash = createHash('sha1').update(readFileSync(join(root, rel))).digest('hex').slice(0, 8);
    } catch { hash = null; }
    cache.set(rel, hash);
    return hash;
  };

  const report = [];
  for (const page of readdirSync(root).filter((f) => f.endsWith('.html'))) {
    const file = join(root, page);
    const src = readFileSync(file, 'utf8');
    let stamped = 0;

    const out = src.replace(ASSET_RE, (match, attr, rel, old) => {
      const hash = hashOf(rel);
      if (!hash) return match;
      const next = `?v=${hash}`;
      if (old !== next) stamped += 1;
      return `${attr}="${rel}${next}"`;
    });

    if (out !== src) writeFileSync(file, out, 'utf8');
    report.push({ page, stamped });
  }
  return report;
}

if (process.argv[1] && process.argv[1].endsWith('stamp-assets.mjs')) {
  const report = stampAssets();
  const total = report.reduce((s, r) => s + r.stamped, 0);
  for (const r of report) if (r.stamped) console.log(`  ${r.page}  更新 ${r.stamped} 处引用`);
  console.log(total ? `已为 ${total} 处样式/脚本引用刷新版本号` : '样式/脚本引用已是最新，无需改动');
}
