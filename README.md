# 浙江嘉豪嘉欣协会 · 官方网站

<!-- ============================================================
     号主声明：以下这一行请勿删除（发布时会被原样保留）
     ============================================================ -->
> 号主声明:这么嘉豪的社团不是HuaDe520创建的,只是挂在我的github下,项目内容(几乎)纯ai无人工 糖醋鲤鱼xbc神了

<!-- ============================================================
     ↓↓↓ 以下护栏段给自动化 agent / 批量生成脚本看，请勿删除 ↓↓↓
     ============================================================ -->

> [!IMPORTANT]
> **给 AI agent / 批量重写脚本：本仓库有两处内容是人写的，禁止覆盖。**
>
> 1. **上面那一行「号主声明」** —— 逐字保留，连半角逗号和空格都别动。
> 2. **安慰盲盒的彩蛋**（`assets/js/comfort-quotes.js` 数组里的第一条）：
>    `'在一千余条话语里,你见到了这条信息,看来你有好好运气,xbc真的神哩'`
>    它是**抽签才能抽到的彩蛋**，必须留在库内、必须能抽到；全库共 **1001** 条，不要"顺手"删成 1000 条。
>
> 完整清单、指纹和事故复盘见 **[AGENT-GUARD.md](AGENT-GUARD.md)**。
> 改完请跑 `node tools\check-guard.mjs` 自检（全 ✅ 才算没踩到）。
> **改文件一律做外科手术式编辑，永远不要整份文件/整站重新生成后覆盖。**


纯静态站点，零依赖、可离线打开。直接把整个 `jiahao-jiaxin-site` 文件夹拷到任意静态托管即可上线（部署步骤见 [DEPLOY.md](DEPLOY.md)）。

## 当前状态

| 项目 | 值 |
| --- | --- |
| **正式网址** | **https://xbc-zjja.com.cn/** （`www.xbc-zjja.com.cn` 会 301 跳到主域名） |
| 备用地址 | https://huade520.github.io/jiahao-jiaxin-site/ （已 301 跳转到自定义域名） |
| 仓库 | https://github.com/HuaDe520/jiahao-jiaxin-site |
| 域名解析 | 阿里云云解析：4×A + 4×AAAA + `www` 的 CNAME，**全部已生效** ✅ |
| HTTPS | ✅ 已启用强制 HTTPS（Let's Encrypt 证书，同时覆盖 `xbc-zjja.com.cn` 与 `www.xbc-zjja.com.cn`） |
| 手机 App | ✅ 支持「添加到手机桌面」（PWA）：**图标就是协会会徽**，点开全屏无地址栏、离线也能看 → 见 [手机App安装说明.md](手机App安装说明.md) |
| 发布方式 | GitHub Pages · 分支发布（`main` 分支根目录） |
| 更新内容 | 本地改完后执行 `node tools\publish.mjs`（走 `api.github.com`，不需要 git push） |
| 相关文档 | [DEPLOY.md](DEPLOY.md) · [自定义域名教程.md](自定义域名教程.md) · [域名解析配置单.md](域名解析配置单.md) · [手机App安装说明.md](手机App安装说明.md) |
| 站点模块 | 首页 / 协会简介 / 部门矩阵（九部门，点开可见部长）/ 活动安排 / 群规公约 / 加入我们 / **社团联系（嘉协首座微信）** |

## 目录结构

```
jiahao-jiaxin-site/
├─ index.html                  主站（首屏 / 协会简介 / 部门矩阵 / 活动安排 / 群规 / 加入我们 / 页脚）
├─ 协会官网-单文件版.html        单文件版：CSS、JS、全部徽标都内联在里面，可以单独发给别人或离线打开
├─ 404.html                    自定义 404 页（GitHub Pages / Vercel 自动使用）
├─ robots.txt                  允许搜索引擎收录
├─ vercel.json                 Vercel 配置：cleanUrls + 资源缓存与安全响应头
├─ deploy-vercel.ps1           一键部署到 Vercel
├─ deploy-github.ps1           一键推送到 GitHub
├─ .nojekyll                   让 GitHub Pages 跳过 Jekyll 处理
├─ .github/workflows/pages.yml GitHub Actions 自动部署到 Pages
├─ DEPLOY.md                   三种上线方式的操作步骤
└─ assets/
   ├─ css/style.css            设计系统与全部样式（玉青 + 鎏金 + 藏青 + 宣纸白）
   ├─ js/main.js               交互脚本 + 九个部门的详情文案
   └─ img/
      ├─ logo-main.png              协会主会徽
      ├─ dept-01-shutong.png        嘉枢统筹部
      ├─ dept-02-fanxun.png         嘉番巡礼部
      ├─ dept-03-youlun.png         嘉游论衡部
      ├─ dept-04-mohui.png          嘉墨绘梦部
      ├─ dept-05-lixing.png         嘉体砺行部
      ├─ dept-06-tongyou.png        嘉盟同游部
      ├─ dept-07-xianfu.png         嘉闲浮生部
      ├─ dept-08-qingtan.png        嘉学清谈部
      ├─ dept-09-jieyou.png         嘉窗解忧部
      └─ original/                  你提供的原始图片（webp / jpg，仅供留档，页面不引用）
```

## 为什么徽标是 PNG

你最初提供的九张部徽里有八张是 **WebP** 格式。WebP 在 Chrome / Edge / 新版 Safari 上正常，但部分查看环境看不到（旧版浏览器、某些内置浏览器、部分预览面板），
浏览器在图片加载失败时会把 `alt` 文字显示在圆形徽章框里，看起来就像「logo 不见了，只剩一圈文字」。

所以现在：

1. 十张徽标统一转成 **PNG**（通用性最好，画质无损，显示尺寸下体积更小），原始文件留档在 `assets/img/original/`。
2. 去掉了 `loading="lazy"`：懒加载在部分预览环境里不会触发，同样会导致徽标不显示。
3. 提供了 `协会官网-单文件版.html`：所有图片都内联成 data URI，**即使脱离 assets 文件夹也能完整显示**，适合单独发送或在不解析相对路径的预览器里查看。

## 本地预览

- **推荐**：双击 `协会官网-单文件版.html`，一个文件包含全部内容，任何环境都能显示。
- 或者双击 `index.html`（需要 `assets` 文件夹在旁边）。
- 若想用本地服务器：

```powershell
cd D:\dsh\jiahao-jiaxin-site
python -m http.server 8080     # 然后访问 http://127.0.0.1:8080
```

## 上线前需要替换的占位内容

| 位置 | 现在的内容 | 需要改成 |
| --- | --- | --- |
| `index.html` 的 `#join` 区块 → QQ 群卡片 | 群号：请在群公告中获取 | 真实群号 / 加群链接 |
| `index.html` 的 `#join` 区块 → 微信群卡片 | 由管理员邀请加入 | 管理员微信号或群二维码图片 |
| `index.html` 的 `#join` 区块 → 合作与投稿 | 联系嘉枢统筹部 | 对接人邮箱或账号 |
| `index.html` 的 `#activities` 区块 | 周一~周日的常态活动 | 按实际排期修改 |
| `index.html` 的 `.topbar` 公告条 | 欢迎语 | 需要滚动播报的最新公告 |

改完后请删掉页面底部那句带 `<code>#join</code>` 的提示文案（`class="contact__note"` 的整段 `<p>`）。
改动主站后，单文件版需要重新生成（把 `index.html`、`assets/css/style.css`、`assets/js/main.js` 和图片一起内联即可，或者直接在主站上改完后告诉我，我再生成一次）。

## 修改部门介绍

九个部门的弹窗文案集中在 `assets/js/main.js` 顶部的 `DEPARTMENTS` 对象里，每个部门包含
`no`（序号）、`name`、`motto`（一句话口号）、`logo`、`desc`（简介）、`duties`（部门日常，数组）、`tags`（关键词）。
卡片上的标题与标签写在 `index.html` 的 `.dept-grid` 内，两处一起改即可。

支持深链接：`index.html#dept-youlun` 会直接打开嘉游论衡部的详情弹窗（可用作群内跳转链接）。

## 换配色

`assets/css/style.css` 顶部的 `:root` 变量控制全站颜色：

- `--jade-700 / --jade-600` 主色（青绿，取自会徽）
- `--gold-500 / --gold-400` 点缀色（鎏金）
- `--navy-900` 群规区块与页脚的深色底
- `--cream` 页面底色（宣纸白）

改这几个值即可整体换色，无需逐个改样式。

## 技术与兼容

- 原生 HTML / CSS / JS，无框架、无 CDN、无外部字体，断网也能正常显示。
- 图片全部为 PNG，兼容性覆盖到很老的浏览器。
- 响应式：三栏 → 两栏 → 单栏，≤820px 切换为汉堡菜单，已在 390px 宽度下验证。
- 无障碍：跳转链接、`aria` 标注、键盘可操作的部门卡片与弹窗（Esc 关闭）、`prefers-reduced-motion` 降级。
- 浏览器：Chrome / Edge / Safari / Firefox，含较老版本。
