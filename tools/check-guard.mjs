#!/usr/bin/env node
/**
 * 受保护内容校验（护栏）
 * ---------------------------------------------------------------
 * 用法：
 *   node tools/check-guard.mjs            # 校验，全部通过退出码 0
 *   node tools/check-guard.mjs --init     # 打印当前指纹，用于更新 AGENT-GUARD.md
 *
 * 它只做一件事：确认几处「人工写的、被明确要求保留的」内容没被覆盖掉。
 * 被保护内容见仓库根目录 AGENT-GUARD.md。
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 归一化：去首尾空白 + 压缩连续空白，规避行号/缩进漂移导致的误报 */
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const fp = (s) => createHash('sha256').update(norm(s), 'utf8').digest('hex').slice(0, 16);

const GUARDS = [
  {
    id: 'owner-declaration',
    file: 'README.md',
    what: '号主声明（README 里那一行，人工写的，禁止删除或改写）',
    must: [
      '> 号主声明:这么嘉豪的社团不是HuaDe520创建的,只是挂在我的github下,项目内容(几乎)纯ai无人工 糖醋鲤鱼xbc神了',
    ],
    hash: '741511fd3c8f3c0f',
  },
  {
    id: 'comfort-egg',
    file: 'assets/js/comfort-quotes.js',
    what: '安慰盲盒彩蛋（手工加入，禁止在批量重写时静默删除）',
    must: [
      "/* ---------- 彩蛋,xbc神了 ---------- */",
      "'在一千余条话语里,你见到了这条信息,看来你有好好运气,xbc真的神哩',",
    ],
    hash: 'ccb0e7ef1ee6ec02',
  },
];

const init = process.argv.includes('--init');
let failed = 0;

for (const g of GUARDS) {
  const p = join(ROOT, g.file);
  if (!existsSync(p)) {
    console.log(`❌ [${g.id}] 文件不存在：${g.file}`);
    failed++;
    continue;
  }
  const text = readFileSync(p, 'utf8');
  const missing = g.must.filter((m) => !text.includes(m));
  const h = fp(g.must.join('\n'));

  if (init) {
    console.log(`${g.id}\n  file : ${g.file}\n  hash : ${h}`);
    continue;
  }
  if (missing.length) {
    console.log(`❌ [${g.id}] ${g.what}`);
    console.log(`   文件 ${g.file} 里找不到被保护内容，可能已被覆盖：`);
    for (const m of missing) console.log(`     - ${m.slice(0, 80)}`);
    failed++;
  } else {
    console.log(`✅ [${g.id}] ${g.what} —— 完好（指纹 ${h}）`);
  }
}

if (init) process.exit(0);

console.log('');
if (failed) {
  console.log(`护栏校验未通过：${failed} 处被改动。`);
  console.log('这些内容是人工写的、被明确要求保留的。若确实需要修改，请先读 AGENT-GUARD.md。');
  process.exit(1);
}
console.log('护栏校验通过：受保护内容全部完好。');
