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
| 文件名 | `download/zhangshang-jiaxie-1.5.apk` |
| 版本 | 1.5（versionCode 6） |
| 大小 | 125 KB |
| 包名 | `com.jiahaojiaxin.assoc` |
| 支持系统 | Android 5.0（API 21）及以上 |
| 目标版本 | Android 14（API 34） |
| 权限 | 仅 `INTERNET`、`ACCESS_NETWORK_STATE` |
| 签名证书 | CN=Zhejiang Jiahao Jiaxin Association |
| 证书 SHA-256 | `302b107e38b8da634d0d7c24691e97d88248643f6aa7f108729fa1c068ec5bec` |
| APK SHA-256 | `862e3f575a0bd407f6d941a2473239942ee17e164c840d6fc2fa834fb622b43d` |

App 本质是一个 WebView 外壳，**打开的就是官网**——所以官网内容一更新，App 里立刻就是新的，不需要重新发版。只有用到安卓本机能力的功能才需要重新打包，1.5 就是这种情况。

### 1.5 改了什么

安卓 WebView 里没有网页版的 `speechSynthesis`，所以千词奇域的朗读按钮以前在 App 里是**不显示**的。1.5 加了一个原生朗读桥：

- `MainActivity` 里起一个系统 `TextToSpeech`，作为 `window.JHJX_APP` 注入网页；
- 网页点喇叭 → 先问 App 要原生朗读（`JHJX_APP.speak(word)`，返回 true 表示已经交给系统念了）；
- App 没有或念不了 → 退回浏览器的系统语音 → 再不行才提示「照着音标念」；
- 只接受英文字母、空格、连字符、撇号，最长 64 字符，避免这个桥被拿去做别的用途。

---

## 重新打包（以后要改 App 时）

工程在 **`D:\dsh\android-app\`**（放在网站仓库之外，避免签名密钥被上传）：

```
android-app/
├─ app/                     安卓工程源码（Manifest / Java / 资源 / 图标）
├─ build.ps1                一键构建脚本（aapt2 → javac → d8 → zipalign → apksigner）
├─ jiahaojiaxin.keystore    签名密钥（务必保管好）
└─ README.md                构建说明
```

改完源码执行：

```powershell
powershell -ExecutionPolicy Bypass -File D:\dsh\android-app\build.ps1
```

生成的 APK 在 `D:\dsh\android-app\build\` 下，复制到网站目录 `download/` 再执行 `node tools\publish.mjs` 即可上线。

> ⚠️ **密钥库千万别丢**：安卓要求升级包的签名与旧版一致，换密钥会导致老用户无法覆盖安装（必须卸载重装）。
