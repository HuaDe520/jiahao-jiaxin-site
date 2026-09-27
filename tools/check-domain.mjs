#!/usr/bin/env node
/**
 * 域名解析与线上可用性自检。
 *
 * 用法：
 *   node tools/check-domain.mjs xbc-zjja.com.cn
 *   node tools/check-domain.mjs xbc-zjja.com.cn --site huade520.github.io/jiahao-jiaxin-site
 *
 * 为什么用 DoH：部分网络环境会干扰本机 UDP 53 查询，走 HTTPS(443) 的
 * DNS over HTTPS 更可靠，也能看到权威解析结果。
 */

const domain = process.argv[2];
if (!domain) {
  console.error('用法: node tools/check-domain.mjs <域名>');
  process.exit(1);
}
const siteIdx = process.argv.indexOf('--site');
const sitePath = siteIdx > 0 ? process.argv[siteIdx + 1] : null;

const GITHUB_A = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
const GITHUB_AAAA = ['2606:50c0:8000::153', '2606:50c0:8001::153', '2606:50c0:8002::153', '2606:50c0:8003::153'];
const DOH = [
  { name: '阿里 DoH', url: (n, t) => `https://dns.alidns.com/resolve?name=${n}&type=${t}` },
  { name: 'Cloudflare DoH', url: (n, t) => `https://cloudflare-dns.com/dns-query?name=${n}&type=${t}` },
];

const RCODE = { 0: 'NOERROR', 2: 'SERVFAIL', 3: 'NXDOMAIN（域名不存在/未委派）', 5: 'REFUSED' };

async function query(name, type) {
  for (const server of DOH) {
    try {
      const res = await fetch(server.url(name, type), {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(15000),
      });
      const json = await res.json();
      return { server: server.name, status: json.Status, answers: (json.Answer || []).map((a) => a.data) };
    } catch { /* 换下一个 DoH */ }
  }
  return null;
}

const line = (ok, text) => `${ok === true ? '✅' : ok === false ? '❌' : '⚠️ '} ${text}`;

async function main() {
  console.log(`\n=== 域名自检: ${domain} ===\n`);

  /* 1. 委派状态 */
  const soa = await query(domain, 'SOA');
  const ns = await query(domain, 'NS');
  console.log('【1】域名委派');
  if (!ns) {
    console.log(line(false, 'NS 查询失败（DoH 不可达）'));
  } else if (!ns.answers.length) {
    console.log(line(false, `NS 无记录 → ${RCODE[ns.status] || ns.status}`));
    console.log('    → 域名还没被委派。国别域名常见原因：实名认证未通过（serverHold）或刚注册还在处理。');
  } else {
    console.log(line(true, `NS 已委派: ${ns.answers.join(', ')}`));
    const soaAns = soa && soa.answers.length ? soa.answers[0] : null;
    if (soaAns) console.log(`    权威 SOA: ${soaAns}`);
  }

  /* 2. A 记录（裸域） */
  console.log('\n【2】裸域 A 记录 (@)');
  const a = await query(domain, 'A');
  if (!a) {
    console.log(line(false, 'A 查询失败'));
  } else if (!a.answers.length) {
    console.log(line(false, `A 无记录 → ${RCODE[a.status] || a.status}`));
  } else {
    const got = a.answers.slice().sort();
    const missing = GITHUB_A.filter((ip) => !got.includes(ip));
    console.log(line(missing.length === 0, `解析结果: ${got.join(', ')}`));
    if (missing.length) {
      console.log(`    ⚠️ 缺少 GitHub 的 A 记录: ${missing.join(', ')}`);
      const alien = got.filter((ip) => !GITHUB_A.includes(ip));
      if (alien.length) console.log(`    ⚠️ 存在非 GitHub 的地址（可能是注册商默认停放记录，需要删除）: ${alien.join(', ')}`);
    }
  }

  /* 3. www CNAME */
  console.log('\n【3】www 子域');
  const www = await query('www.' + domain, 'CNAME');
  const wwwA = await query('www.' + domain, 'A');
  const cnameOk = www && www.answers.some((d) => /\.github\.io\.?$/i.test(d));
  if (cnameOk) {
    console.log(line(true, `CNAME → ${www.answers.join(', ')}`));
  } else if (www && www.answers.length) {
    console.log(line(false, `CNAME 指向了别处: ${www.answers.join(', ')}（应指向 <用户名>.github.io）`));
  } else if (wwwA && wwwA.answers.length) {
    console.log(line(null, `www 直接解析到 A 记录: ${wwwA.answers.join(', ')}（能用，但推荐用 CNAME）`));
  } else {
    console.log(line(false, `www 无记录 → ${RCODE[(www && www.status) || (wwwA && wwwA.status)] || '无'}`));
  }

  /* 4. HTTPS 可用性 */
  console.log('\n【4】线上可用性');
  for (const url of [`https://${domain}/`, `https://www.${domain}/`]) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
      const html = await res.text();
      const ok = res.ok && html.includes('浙江嘉豪嘉欣协会');
      console.log(line(ok, `${url}  HTTP ${res.status}${ok ? '，页面内容正确' : res.ok ? '，内容未匹配' : ''}`));
    } catch (e) {
      console.log(line(false, `${url}  失败: ${e.message}`));
    }
  }

  if (sitePath) {
    console.log('\n【5】GitHub Pages 原地址（应 301 跳到自定义域名）');
    try {
      const res = await fetch(`https://${sitePath}/`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
      console.log(line(res.status >= 300 && res.status < 400, `HTTP ${res.status} → ${res.headers.get('location') || '(无 Location)'}`));
    } catch (e) {
      console.log(line(false, `失败: ${e.message}`));
    }
  }

  console.log('');
}

await main();
