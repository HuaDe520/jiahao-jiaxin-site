# 把官网装到手机桌面（像 App 一样）

> 网址：**https://xbc-zjja.com.cn/**
> 装好后：桌面出现**协会会徽图标**，点开是全屏打开、**没有浏览器地址栏**，和 App 一样。

站点已经做了完整的 PWA 支持（`manifest.webmanifest` + 图标 + Service Worker），绝大多数手机浏览器都支持。

---

## 安卓手机（Chrome / Edge / 三星浏览器 / 小米·华为自带浏览器）

1. 用手机浏览器（Chrome / Edge / 三星浏览器 / 小米·华为自带浏览器）打开 https://xbc-zjja.com.cn/
2. 点右上角 **⋮**（菜单）
3. 选「**安装应用**」或「**添加到主屏幕**」
4. 确认 → 桌面出现会徽图标

个别浏览器菜单里叫「添加到桌面」「创建快捷方式」，意思一样。

---

## iPhone / iPad（必须用 Safari）

iOS 只能通过 Safari 添加，**微信内置浏览器、Chrome iOS 都不行**：

1. 用 **Safari** 打开 https://xbc-zjja.com.cn/
2. 点屏幕**底部中间的「分享」按钮**（方框带向上箭头 ⬆️）
3. 在弹出列表里往下滑，选「**添加到主屏幕**」
4. 右上角点「添加」→ 桌面出现会徽图标

> iOS 16 及以上：也可以先点地址栏左边的「大小」→「添加到主屏幕」。

---

## 微信里打开怎么办

微信内置浏览器不支持安装，页面上会提示：**点右上角「…」→「在浏览器打开」**，然后用上面安卓/iOS 的方法添加。

---

## 装好之后是什么样

| 对比项 | 普通浏览器打开 | 装到桌面后 |
| --- | --- | --- |
| 图标 | 浏览器默认图标 | **协会会徽** |
| 打开方式 | 有地址栏、标签栏 | **全屏，无地址栏** |
| 状态栏配色 | 默认 | 与站点主色一致（墨绿） |
| 断网时 | 打不开 | 看过的页面还能打开 |
| 更新 | 立刻生效 | 立刻生效（采用网络优先策略，不会看到旧版） |

---

## 想换图标 / 改名字？

| 想改的东西 | 改哪里 |
| --- | --- |
| 桌面显示的名称 | `manifest.webmanifest` 里的 `name` / `short_name`；iOS 还看 `index.html` 里的 `apple-mobile-web-app-title` |
| 图标 | 替换 `assets/img/icon-192.png`、`icon-512.png`、`icon-maskable-512.png`、`apple-touch-icon.png`（后四个都由会徽生成） |
| 状态栏 / 主题色 | `manifest.webmanifest` 的 `theme_color` 与 `index.html` 的 `<meta name="theme-color">` |

改完执行 `node tools\publish.mjs` 即可上线。**已经装在桌面上的图标会沿用旧图标**，需要删掉重新添加一次才会更新（安卓有时会自动更新）。

---

## 生成图标的方式（留档）

图标是从会徽 `assets/img/logo-main.png` 用 canvas 生成的：

- `icon-192.png` / `icon-512.png`：会徽占 90%，四周留白（`purpose: any`）
- `icon-maskable-512.png`：会徽占 62%，留足安全区（`purpose: maskable`，安卓圆形/异形图标不会被裁切）
- `apple-touch-icon.png`：180×180，会徽占 96%（iOS 主屏图标规格）
