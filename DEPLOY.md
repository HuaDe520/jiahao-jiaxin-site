# 上线部署指南

> ## ✅ 当前状态：已上线并绑定自定义域名
>
> | 项目 | 值 |
> | --- | --- |
> | 正式网址 | **https://xbc-zjja.com.cn/** （www 301 跳主域名） |
> | 仓库 | https://github.com/HuaDe520/jiahao-jiaxin-site |
> | 域名解析 | 阿里云云解析：4×A + 4×AAAA + www 的 CNAME，已全部生效 |
> | 发布方式 | GitHub Pages · 分支发布（`main` 分支根目录，`build_type=legacy`） |
> | HTTPS | GitHub 自动签发 Let's Encrypt 证书并开启强制 HTTPS |
> | 更新内容 | 在本地改完后执行 `node tools/publish.mjs`（见下面《更新线上内容》） |
>
> 下文的「方式 A/B/C」是最初的三种备选方案，留作参考；日常更新只需要看下面《更新线上内容》一节。

## 更新线上内容（日常只需这一步）

本站的首次发布是通过 GitHub REST API 完成的，**不依赖 `git push`**：这台机器直连 `github.com` 不稳定，而 `api.github.com` 稳定可用，所以发布脚本只走 API。

在本地改完文件后执行：

```powershell
node tools\publish.mjs
```

脚本会自动完成：上传全部文件 → 创建提交 → 更新 `main` 分支 → 等待 Pages 构建 → 抓取线上页面自检。
只想预览会上传哪些文件时，先跑 `node tools\publish.mjs --dry-run`。

令牌保存在 `D:\dsh\token.txt`（已加入 `.gitignore`，不会被上传）。令牌过期或失效时，重新生成一个 classic token（勾选 `repo` + `workflow`）覆盖该文件即可。

### 什么时候才需要 git

`git` 已经装好（`%LOCALAPPDATA%\Programs\PortableGit`，已加入用户 PATH），本地仓库已初始化并完成首次提交（身份为你的 GitHub 账号 HuaDe520）。
当网络能稳定访问 `github.com` 时，也可以改回用 git 推送：

```powershell
git push -u origin main --force   # 仅首次：本地与远端内容一致，只是历史起点不同
git push                          # 之后正常推送即可
```

---

站点是纯静态的，`index.html` + `assets/` 原样上传即可，不需要构建、不需要服务器环境。

---

## 方式 A · GitHub Pages + 网页上传（零安装，最省事）

1. 打开 https://github.com/new 新建仓库
   - Repository name 填 `jiahao-jiaxin-site`
   - 选 **Public**（私有仓库的 Pages 需要付费）
   - 不要勾选 "Add a README file"
   - 点 **Create repository**
2. 进入仓库，点 **Add file → Upload files**
3. 打开本地文件夹 `D:\dsh\jiahao-jiaxin-site`，把里面的内容全选拖进去：
   - 必须包含：`index.html`、`404.html`、`robots.txt`、`assets` 文件夹
   - 可选：`README.md`、`vercel.json`、`deploy-*.ps1`
   - 隐藏文件（`.nojekyll`、`.github`、`.gitignore`）网页上传时容易漏掉，漏了不影响显示，可以后面用 **Add file → Create new file** 手动补：
     - 文件名输入 `.nojekyll`，内容留空
     - 文件名输入 `.github/workflows/pages.yml`，把仓库里这个文件的内容粘进去
4. 点 **Commit changes**
5. 打开 **Settings → Pages**
   - **Source** 选 `Deploy from a branch`
   - **Branch** 选 `main`，目录选 `/ (root)`，点 **Save**
   - （仓库里已经带了 Actions 工作流，也可以把 Source 改成 `GitHub Actions`，效果一样，推送后自动发布）
6. 等 1～2 分钟，访问：

```
https://<你的用户名>.github.io/jiahao-jiaxin-site/
```

之后想更新，重复第 2～4 步重新上传覆盖即可。

---

## 方式 B · GitHub Pages + Git 命令行

先安装 Git（装完重开一个终端）：

```powershell
winget install --id Git.Git -e --source winget
```

然后在 GitHub 上建一个空仓库，回到本文件夹执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-github.ps1 -RepoUrl https://github.com/你的用户名/jiahao-jiaxin-site.git
```

推送完成后到 **Settings → Pages** 选择发布源（`GitHub Actions` 或 `main / (root)`），地址同样是
`https://<你的用户名>.github.io/jiahao-jiaxin-site/`。

---

## 方式 C · Vercel（地址更短，形如 `xxx.vercel.app`）

需要 Node.js（这台机器已有）。在本文件夹执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-vercel.ps1
```

或者手动两条命令：

```powershell
npx vercel login     # 首次运行，按提示用邮箱或 GitHub 授权登录一次
npx vercel --prod    # 部署到生产环境，结束后会打印公开地址
```

- 项目名默认取文件夹名 `jiahao-jiaxin-site`，想换名字加参数：`npx vercel --prod --name jiahao-jiaxin`
- `vercel.json` 已经配好 `cleanUrls`、静态资源长缓存和安全响应头，不用再改

---

## 部署后自检清单

- [ ] 首屏主会徽「嘉」显示正常
- [ ] 部门矩阵九张部徽全部是图案（**如果只看到圆形里一段文字，说明图片没加载出来**，见下）
- [ ] 点任意部门卡片，弹出详情；按 Esc 能关闭
- [ ] 手机浏览器打开，导航变成右上角汉堡菜单，横向不出现滚动条
- [ ] 随便输一个不存在的路径（如 `/xxx`），显示的是协会风格的 404 页
- [ ] 群号、微信群等占位内容已经替换（见 README 「上线前需要替换的占位内容」）

### 如果线上看不到部徽

按顺序排查：

1. 打开浏览器 F12 → Network，刷新，看 `assets/img/*.png` 是否 404。
   404 = 图片没传上去（网页上传时 `assets` 文件夹可能没拖全），补传即可。
2. 看是不是打开了 `协会官网-单文件版.html` 之外的单页而 assets 目录缺失——
   本仓库里 `assets/` 必须和 `index.html` 同级。
3. 想彻底避免这类问题，可以直接把 `协会官网-单文件版.html` 作为对外分享的页面：
   它把 CSS、JS、十张徽标全部内联在一个文件里，脱离 `assets` 也能完整显示。

---

## 关于单文件版

`协会官网-单文件版.html`（约 725KB）适合：

- 单独发给别人（微信 / QQ 传文件，对方双击就能看）
- 上传到不支持相对路径的地方
- 离线演示

它可以一起上传到仓库（不影响主站），改完主站后需要重新生成一次。
