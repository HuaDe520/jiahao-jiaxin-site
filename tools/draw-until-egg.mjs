#!/usr/bin/env node
/**
 * 安慰盲盒 · 连抽脚本：一直抽，直到抽到彩蛋
 * ---------------------------------------------------------------
 * 彩蛋（号主手工加入，提交 c51427c「增加小彩蛋」）：
 *   '在一千余条话语里,你见到了这条信息,看来你有好好运气,xbc真的神哩'
 * 它被后来的批量重写覆盖过（提交 612dba6），后来已恢复。
 * 相关护栏见仓库根目录 AGENT-GUARD.md，自检用 tools/check-guard.mjs。
 *
 * 用法：
 *   node tools/draw-until-egg.mjs                 # 抽到彩蛋为止
 *   node tools/draw-until-egg.mjs --delay 0       # 不等待，最快跑完
 *   node tools/draw-until-egg.mjs --max 200       # 最多抽 200 次
 *   node tools/draw-until-egg.mjs --seed 20260928 # 固定种子，可复现
 *   node tools/draw-until-egg.mjs --log run.json  # 写出每次抽取记录
 *   node tools/draw-until-egg.mjs --selftest      # 只自检
 *
 * 抽取规则与 assets/js/comfort.js 完全一致：
 * 整库洗成一副牌 → 按顺序发 → 发完一轮才重新洗牌 → 新一轮首张不撞上一轮收尾。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const LIB = join(ROOT, 'assets', 'js', 'comfort-quotes.js');

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const MAX = Number(flag('--max', 0));
const DELAY = Number(flag('--delay', 250));
const SEED = flag('--seed', null);
const LOG = flag('--log', null);

/* ---------- 可复现随机（给了 --seed 时） ---------- */
let rnd = Math.random;
if (SEED) {
  let s = 0;
  for (const ch of String(SEED)) s = (s * 31 + ch.codePointAt(0)) >>> 0;
  rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ---------- 读库（直接读源码，不 eval，安全且零依赖） ---------- */
const src = readFileSync(LIB, 'utf8');
const QUOTES = [...src.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
const EGG_RE = /xbc真的神哩|xbc神了|彩蛋/;
const EGG_INDEX = QUOTES.findIndex((q) => EGG_RE.test(q));

console.log(`话语库 : ${LIB}`);
console.log(`句子数 : ${QUOTES.length}`);
if (EGG_INDEX < 0) {
  console.log('彩蛋   : ⚠ 未找到 —— 彩蛋已从话语库消失，请对照 AGENT-GUARD.md 恢复后再抽');
} else {
  console.log(`彩蛋   : 库内第 ${EGG_INDEX + 1} 条 → ${QUOTES[EGG_INDEX]}`);
}
console.log('-'.repeat(60));

/* ---------- 发牌器（与 comfort.js 同规则） ---------- */
let order = [], pos = 0, last = -1, round = 0;

function newDeck(avoidLast) {
  const o = QUOTES.map((_, i) => i);
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [o[i], o[j]] = [o[j], o[i]];
  }
  if (typeof avoidLast === 'number' && avoidLast >= 0 && o.length > 1 && o[0] === avoidLast) {
    const k = 1 + Math.floor(rnd() * (o.length - 1));
    [o[0], o[k]] = [o[k], o[0]];
  }
  order = o; pos = 0; round += 1;
}

function nextIndex() {
  if (pos >= order.length) newDeck(last);
  const idx = order[pos++];
  last = idx;
  return idx;
}

/* ---------- 自检 ---------- */
if (has('--selftest')) {
  newDeck(-1);
  const seen = Array.from({ length: QUOTES.length }, () => nextIndex());
  const cover = new Set(seen).size === QUOTES.length;
  const first = nextIndex();
  const avoid = first !== seen[seen.length - 1];
  console.log(`自检 一轮覆盖全部句子   : ${cover ? '✅' : '❌'}`);
  console.log(`自检 新一轮首张不撞轮尾 : ${avoid ? '✅' : '❌'}`);
  console.log(`自检 彩蛋在库内         : ${EGG_INDEX >= 0 ? '✅' : '❌'}`);
  process.exit(cover && avoid && EGG_INDEX >= 0 ? 0 : 1);
}

/* ---------- 开抽 ---------- */
const draws = [];
let n = 0, hit = false;
const t0 = Date.now();

function step() {
  const idx = nextIndex();
  n += 1;
  const q = QUOTES[idx];
  draws.push({ n, index: idx, round, quote: q });
  const isEgg = idx === EGG_INDEX;
  console.log(`#${String(n).padEnd(4)} ${q}${isEgg ? '   🥚 <<< 彩蛋！' : ''}`);

  if (isEgg) { hit = true; return finish(); }
  if (MAX && n >= MAX) return finish();
  if (DELAY > 0) setTimeout(step, DELAY); else step();
}

function finish() {
  const sec = (Date.now() - t0) / 1000;
  console.log('-'.repeat(60));
  if (hit) {
    console.log(`🥚 抽到彩蛋了！第 ${n} 次抽取命中（第 ${round} 轮）`);
    console.log(`   ${QUOTES[EGG_INDEX]}`);
    console.log(`   库内第 ${EGG_INDEX + 1} 条 · 全库 ${QUOTES.length} 条`);
  } else {
    console.log(`没抽到彩蛋：共抽 ${n} 次（上限 ${MAX}）`);
  }
  console.log(`耗时 ${sec.toFixed(1)} 秒`);
  if (LOG) {
    writeFileSync(LOG, JSON.stringify({ library: LIB, total: QUOTES.length, eggIndex: EGG_INDEX, drawn: n, hit, seconds: +sec.toFixed(3), draws }, null, 1), 'utf8');
    console.log(`记录已写入 ${LOG}`);
  }
  process.exit(hit ? 0 : 2);
}

step();
