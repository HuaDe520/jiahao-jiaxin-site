# 伪用户系统后端（阿里云函数计算 + 私有 OSS）

昵称 + 邀请码就能进来：昵称不重复，能加好友、聊天、传头像，管理员能收举报、处理举报。
整套东西跑在阿里云函数计算的免费额度上，**正常使用基本是 ¥0**。

> 说明：这是「伪用户系统」。它保证的是**昵称不重复**和**谁在说话能对上号**，
> 不是安全性。没有密码，凭证丢了要靠管理员重置；邀请码会随着群分享扩散。

---

## 一、这套东西长什么样

```
浏览器（网站静态页，GitHub Pages）
        │  fetch + Bearer token
        ▼
阿里云函数计算 FC 3.0（nodejs20，cn-hangzhou）
  函数名 jhjx-account   handler: handler.handler
        │  读写
        ▼
私有 OSS 桶 jhjx-account-data
  jhjx-account/db.json      ← 整个数据库就是一个 JSON 文档
  avatars/<用户id>-<版本>.jpg ← 头像单独存对象，文档里只记 key
```

整个数据库就是**一个 JSON 文档**，每次请求都重新读一遍（函数实例会被复用，
缓存住会拿到旧数据）。写入用一把内存锁串行化，规模到「几十个用户、
一天几十条消息」都够用。

代码分工：

| 文件 | 干什么 |
|---|---|
| `backend/worker.js` | 所有接口逻辑（与运行环境无关，本地和线上同一份） |
| `backend/store-json.js` | JSON 文档存储层（用户、举报、好友、消息） |
| `backend/fc/handler.js` | 函数计算入口：把 FC 的事件转成标准 Request/Response |
| `backend/fc/oss.js` | 读写 OSS（V1 签名，支持 STS） |
| `backend/dev-server.mjs` | 本地联调服务器：静态页 + 接口，数据落在本地文件 |

线上接口地址：`https://jhjx-account-srebqdthiq.cn-hangzhou.fcapp.run`
（已写进 `assets/js/api.js` 的 `PROD_API`）

---

## 二、本地先跑起来（不花钱、不用注册）

```powershell
# 1) 写本地邀请码（这个文件不会进仓库、也不会发布）
#    backend/.dev.vars
#    USER_CODE=你的普通邀请码
#    ADMIN_CODE=你的管理员邀请码

# 2) 启动本地联调服务器
node backend/dev-server.mjs
```

然后打开：

- 账号页 http://127.0.0.1:8787/account.html
- 好友页 http://127.0.0.1:8787/friends.html
- 管理台 http://127.0.0.1:8787/admin.html

本地数据存在 `backend/.dev-db.json`（可用环境变量 `JSON_FILE` 换路径），头像存在
`backend/.dev-objects`，删掉这两个就是重置。

自动化测试（全部是「真实浏览器点按钮」级别的端到端）：

```powershell
node .preview/fc-handler-test.mjs     # 函数计算入口 21 项
node .preview/api-test.mjs            # 账号 / 举报 / 管理接口 47 项
node .preview/api-social-test.mjs     # 好友 / 消息 / 头像接口 32 项
node .preview/account-ui-test.mjs     # 账号页浏览器端到端 31 项
node .preview/friends-ui-test.mjs     # 好友页与聊天浏览器端到端 21 项
node tools/check-guard.mjs            # 人工内容护栏（发布前必跑）
```

线上验收（会真的写线上库，跑完要清理）：

```powershell
node .preview/live-social-test.mjs       # 线上接口直连验证
node .preview/live-account-test.mjs      # 线上账号页端到端
node .preview/live-friends-test.mjs      # 线上好友 / 聊天 / 头像端到端
# 清理测试账号（只删昵称以「联测」「测试」开头的，真实账号不动）
cd D:\dsh\.aliyun-tools ; node clean-test-rows.mjs
```

---

## 三、重新部署

部署脚本和密钥都放在仓库外面（`D:\dsh\.aliyun-tools`），
`ak.json` 里是只开通了 OSS + FC 权限的 RAM 子账号 AccessKey。

```powershell
cd D:\dsh\.aliyun-tools
node deploy.mjs              # 打包 backend → 创建/更新函数 → 配 HTTP 触发器 → 自检
node deploy.mjs --verify-only # 只做健康检查
node dump-db.mjs             # 看一眼线上库里有什么（只读）
node clean-test-rows.mjs     # 清掉测试账号
```

邀请码是函数的环境变量（`USER_CODE` / `ADMIN_CODE`），改完成员就立刻生效；
它们不会出现在网页里，只会出现在函数配置中。

---

## 四、接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/enter` | 昵称 + 邀请码进入（首次即认领昵称） |
| GET | `/api/me` | 取自己的信息（管理员附带待处理举报数） |
| POST | `/api/report` | 举报某个昵称（原因必选，每人每天限 5 次） |
| GET | `/api/admin/summary` | 待处理举报 / 成员数 / 已停用数 |
| GET | `/api/admin/reports?status=open\|all` | 举报列表 |
| POST | `/api/admin/reports/:id` | 标记已处理 / 驳回 |
| GET | `/api/admin/users` | 成员列表（含被举报次数） |
| POST | `/api/admin/users/:id` | 停用 / 恢复 / 重置登录 / 设为管理员 / 取消管理员 |
| POST | `/api/password` | 改密码（要带修改权限码 `XBCNB`） |
| POST | `/api/password/reset` | 忘了密码：昵称 + 邀请码 + 修改权限码 → 重设并登录 |
| GET | `/api/search?q=` | 按昵称找人 |
| POST | `/api/profile` | 改个人信息（性别 男/女/未知/自定义≤8字、签名≤50字） |
| GET | `/api/user/:用户id` | 看别人的主页（昵称/头像/性别/签名/加入时间，**不含角色**） |
| GET | `/api/friends` | 好友 / 收到的请求 / 发出的请求 / 未读总数 |
| POST | `/api/friends/request` | 加好友（对方也发过就直接成为好友） |
| POST | `/api/friends/respond` | 同意 / 拒绝（`action=accept\|decline`） |
| POST | `/api/friends/remove` | 解除好友 |
| GET | `/api/threads` | 会话列表（最后一句 + 未读数） |
| GET | `/api/messages/:好友id?since=` | 和某个好友的消息（读的时候顺手标记已读） |
| POST | `/api/messages` | 发消息（必须是好友，一分钟最多 30 条） |
| POST | `/api/messages/:消息id/recall` | 撤回自己发的消息（**发出后 2 分钟内**，撤回后正文不再下发） |
| POST | `/api/avatar` | 传头像（data URL，PNG/JPG/WebP，200B–400KB） |
| GET | `/api/avatar/:用户id?v=` | 取头像（公开，浏览器 `<img>` 直接用） |
| GET | `/api/health` | 健康检查 |

跨域：函数网关会原样回显任何 `Origin`，所以**来源白名单写在代码里**
（`worker.js` 顶部的 `ALLOWED_ORIGINS`），不在名单里的来源一律 403。

---

## 五、这套设计的边界（务必知道）

- **登录是「昵称 + 密码 + 邀请码」**。换设备、换浏览器都能自己进，不用管理员帮忙；
  同一账号在别处登录，旧的那台会被挤下线（凭证轮换）。
- **改密码要「修改权限码」**（默认 `XBCNB`，可用环境变量 `PERM_CODE` 换）。
  没有手机验证，所以这个码就是「本人凭证」：忘了密码也能拿它自助重设。
  ⚠️ 邀请码和权限码都是共享的，谁拿到谁就能改任何人的密码，别发到大群。
- **主页只展示昵称 / 头像 / 性别 / 签名 / 加入时间**，不显示角色，
  所以从主页看不出谁是管理员。
- **邀请码是共享的**，它会随群扩散。普通人拿到管理员邀请码就是管理员，
  所以管理员邀请码不要发到大群；泄露了就直接在函数配置里换一个。
- **昵称不能包含「管理员」「社长」这类词**（服务端拦），防止冒充部门。
- 举报是「有记录、可追溯」的：谁举报的、谁处理的都会留档。
- 消息每人每条最多 500 字，发出后 **2 分钟内可撤回**（撤回后正文从库里清空，
  双方看到的都是「已撤回」），整库最多留 5000 条（超了丢最旧的）。
- 目前只存昵称、角色、时间、性别、签名、举报内容、好友关系、聊天内容，
  **不收集手机号、身份证等敏感信息**。真要对外公开运营，按国内要求还需要备案；这一步请自行评估。
- `backend/wrangler.toml`、`backend/schema.sql` 是早先试 Cloudflare Workers + D1
  留下的壳子，现在**没有用到**，别照着它们部署。
