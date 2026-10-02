# 掌上嘉协 · 手机安装说明

> 下载页：**https://xbc-zjja.com.cn/app.html**（首页导航栏也有「下载 App」入口）

---

## 安卓手机

**方式一：下载安装包（推荐）**

1. 手机浏览器打开 https://xbc-zjja.com.cn/app.html
2. 点「**下载 APK**」
3. 下载完成后点击安装，如提示「**未知来源应用**」→ 选择允许
4. 桌面出现协会会徽图标

**方式二：添加到主屏幕（不用装包）**

用浏览器打开官网 → 右上角 `⋮` → 「安装应用」或「添加到主屏幕」。

两者出来的效果一样（会徽图标 + 全屏无地址栏），区别只是方式一有独立的安装包。

---

## iPhone / iPad

iOS 不允许安装第三方安装包，只能用 **Safari** 添加到主屏幕：

1. 用 **Safari** 打开 https://xbc-zjja.com.cn/
2. 点屏幕**底部中间的「分享」按钮**
3. 选「**添加到主屏幕**」→ 右上角「添加」

> 微信内置浏览器、iOS 版 Chrome 都不支持，必须先换 Safari。

---

## 微信里打开链接怎么办

微信内置浏览器不支持安装，点右上角「**…**」→「**在浏览器打开**」，再用上面安卓 / iOS 的方法。

---

## 安卓安装包信息（留档）

| 项目 | 值 |
| --- | --- |
| 文件名 | `download/zhangshang-jiaxie-1.12.apk` |
| 版本 | 1.12（versionCode 13） |
| 大小 | 141 KB |
| 包名 | `com.jiahaojiaxin.assoc` |
| 支持系统 | Android 5.0（API 21）及以上 |
| 目标版本 | Android 14（API 34） |
| 权限 | `INTERNET`、`ACCESS_NETWORK_STATE`、`RECORD_AUDIO`（发语音）、`REQUEST_INSTALL_PACKAGES`（自己装更新用）|
| 签名证书 | CN=Zhejiang Jiahao Jiaxin Association |
| 证书 SHA-256 | `302b107e38b8da634d0d7c24691e97d88248643f6aa7f108729fa1c068ec5bec` |
| APK SHA-256 | `50a1a86e7b79218b254033570490a0040f3d0642e3ca8050de9dbb134a72b88a` |

App 本质是一个 WebView 外壳，**打开的就是官网**——所以官网内容一更新，App 里立刻就是新的，不需要重新发版。只有用到安卓本机能力的功能（朗读、更新）才需要重新打包。

### 1.12 改了什么：聊天里能收文件了

以前在 App 里点聊天中的文件是下不了的：网页用的是 `blob:` 链接 + `<a download>`，WebView 处理不了这种下载，转而把它交给 App 的下载监听——而那个监听**把任何下载都当成 App 自己的安装包在更新**，于是转一圈失败，弹一句「请打开浏览器访问 xbc-zjja.com.cn/app.html 下载新版」。

1.12 分两头修：

- App 这边：`onDownloadStart` 先判断「这是不是安装包」（URL / MIME / Content-Disposition 里有没有 `.apk`），不是就立刻返回，不再动更新流程；
- 网页这边：App 里点文件改走新的原生桥 `JHJX_APP.saveFile(名字, MIME, base64)`——网页照旧用带登录凭证的请求把字节取回来，再交给 App 存进手机的「下载」（安卓 10 及以上用 `MediaStore.Downloads`，不需要任何权限；更老的系统写进应用自己的外部下载目录）。存完 App 会回一句「已保存到手机的「下载」里：xxx」。
- 顺手把 `setMediaPlaybackRequiresUserGesture` 关掉，语音在取回字节之后就能直接播；语音气泡也改成**整条都能点**（点气泡留白、点转写那行小字、点小三角键都算播放/暂停）。

### 1.11 改了什么：语音改由 App 自己录

以前网页在 App 里发语音，是网页自己去跟 WebView 要麦克风（`getUserMedia`）。有些机型上系统权限明明给了，WebView 那一层还是打不开话筒——用户看到的就是「点了语音没反应」或者「麦克风打不开」，怎么重试都没用。

1.11 换了个思路：**录音这一步交给 App 自己做**。网页点「语音」时先问 `JHJX_APP.nativeRecSupported()`，有原生录音就直接调：

- `nativeRecStart()` 开始录（MPEG_4 + AAC，单声道 32 kbps，最长 60 秒，65 秒兜底自动停）；
- `nativeRecStop()` 停下并把录好的字节用 Base64 交回网页，网页再照旧上传；
- `nativeRecCancel()` 取消，临时文件直接删掉；
- `micProbe()` 探一下「系统这一层到底让不让录」，网页据此分清是系统拦的还是网页层拦的，并在录不了时给一个「自检」按钮。

权限那边也修了两处老毛病：以前 `micDeniedOnce` 在**还没问用户**就被置成 true，于是全新安装也会被报成「已拒绝」；现在只有用户真的拒了才算。另外 WebView 那次被拒的授权请求以前会挂在 `pendingPermission` 上不清理，现在拒绝时也会清掉。

网页那边同样做了加固：不再靠轮询权限状态开录，而是**先试着开话筒、失败了再去要权限**；录音条一定会出现，失败一定会给一句人话，还有一个「自检」按钮能一眼看出卡在哪一层。

### 1.6 改了什么：App 自己能更新了

- 启动时拉一次官网的 `download/version.json`（6 小时内只查一次，省流量），有新版就弹一句「有新版本 1.6（当前 1.5）」+ 更新说明，两个按钮：**立即更新** / 以后再说（点过「以后再说」的版本不再打扰）；
- 点「立即更新」→ 先看有没有「允许来自此来源的应用」权限，没有就带用户去开（回来自动继续）→ 用系统下载器下载 → 下完**自动弹出系统安装器**；下载通知里点一下也能装；
- 网页里点「下载 APK」在 App 内也有反应了（走同一条下载 + 安装的路，以前 WebView 不处理下载，点了没动静）；
- 版本信息由构建脚本自动生成，不用手工维护：`app-release.json` 里写更新说明和版本号，`build.ps1` 会补上文件名、大小、SHA-256，写成网站上的 `download/version.json`。

`version.json` 长这样（App 靠它判断要不要提示）：

```json
{
  "versionCode": 7,
  "versionName": "1.6",
  "file": "zhangshang-jiaxie-1.6.apk",
  "url": "https://xbc-zjja.com.cn/download/zhangshang-jiaxie-1.6.apk",
  "urlBackup": "https://huade520.github.io/jiahao-jiaxin-site/download/...",
  "size": 132459,
  "sha256": "3a9afbf7...",
  "notes": "1.6 版：App 自己会检查更新了……",
  "forceBelow": 1,
  "releasedAt": "2026-09-30"
}
```

`forceBelow` 用来强制老版本升级：装到的版本号低于它时，弹窗不给「以后再说」。

### 1.5 改了什么：App 里能朗读了

安卓 WebView 里没有网页版的 `speechSynthesis`，所以千词奇域的朗读按钮以前在 App 里是**不显示**的。1.5 加了一个原生朗读桥：

- `MainActivity` 里起一个系统 `TextToSpeech`，作为 `window.JHJX_APP` 注入网页；
- 网页点喇叭 → 先问 App 要原生朗读（`JHJX_APP.speak(word)`，返回 true 表示已经交给系统念了）；
- App 没有或念不了 → 退回浏览器的系统语音 → 再不行才提示「照着音标念」；
- 只接受英文字母、空格、连字符、撇号，最长 64 字符，避免这个桥被拿去做别的用途。

网页还能调 `JHJX_APP.version()`（当前版本号）和 `JHJX_APP.checkUpdate()`（手动查一次更新）——
下载页在 App 里打开时会多出一行「当前 App 版本 1.6 · 检查更新」。

---

## 重新打包（以后要改 App 时）

工程在 **`D:\dsh\android-app\`**（放在网站仓库之外，避免签名密钥被上传）：

```
android-app/
├─ app/                     安卓工程源码（Manifest / Java / 资源 / 图标）
├─ app-release.json         这一版的版本号 + 更新说明（App 弹窗里显示的话）
├─ build.ps1                一键构建脚本（aapt2 → javac → d8 → zipalign → apksigner）
├─ jiahaojiaxin.keystore    签名密钥（务必保管好）
└─ README.md                构建说明
```

发新版的完整流程：

1. 改 `app/AndroidManifest.xml` 里的 `versionCode` / `versionName`；
2. 改 `build.ps1` 里的 `--version-code` / `--version-name` 和产物文件名（`zhangshang-jiaxie-<版本>.apk`）；
3. 改 `app-release.json`（版本号 + 这次更新了什么，会直接显示在 App 的更新弹窗里）；
4. 跑构建：

```powershell
powershell -ExecutionPolicy Bypass -File D:\dsh\android-app\build.ps1
```

5. 把 `build\zhangshang-jiaxie-<版本>.apk` 复制到网站 `download/`（删掉上一版的 apk）；
6. 构建脚本已经顺手写好了 `download/version.json`，直接 `node tools\publish.mjs` 上线；
7. 更新 `app.html` 和本文件里的版本号、体积、SHA-256。

老用户打开 App 就会收到更新提示，点一下就能装，不用再去浏览器下载。

> ⚠️ **密钥库千万别丢**：安卓要求升级包的签名与旧版一致，换密钥会导致老用户无法覆盖安装（必须卸载重装）。
