# 伪用户系统后端（Cloudflare Worker + D1）

昵称 + 邀请码就能进来，昵称不重复，管理员能收举报、处理举报。
整套东西跑在 Cloudflare 免费额度上，**正常使用是 ¥0**。

> 说明：这是「伪用户系统」。它保证的是**昵称不重复**和**谁在说话能对上号**，
> 不是安全性。没有密码，凭证丢了要靠管理员重置；邀请码会随着群分享扩散。

---

## 一、本地先跑起来（不花钱、不用注册）

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
- 管理台 http://127.0.0.1:8787/admin.html

本地用的是 Node 自带的 SQLite，SQL 与线上 D1 完全一致，
所以本地跑通 = 线上一定能跑通。数据存在 `backend/.dev.sqlite`，删掉就重置。

自动化测试：

```powershell
node .preview/api-test.mjs          # 后端接口 47 项
node .preview/account-ui-test.mjs   # 浏览器端到端 29 项
```

---

## 二、上线到 Cloudflare（大约 10 分钟）

前提：一个 Cloudflare 账号（免费注册，不需要信用卡）。

```powershell
cd backend

# 1) 登录（会打开浏览器让你点授权）
npx wrangler login

# 2) 建数据库，把输出的 database_id 填进 wrangler.toml
npx wrangler d1 create jhjx-account

# 3) 建表
npx wrangler d1 execute jhjx-account --remote --file=schema.sql

# 4) 配置两个邀请码（走 secret，不会进仓库、不会出现在网页里）
npx wrangler secret put USER_CODE
npx wrangler secret put ADMIN_CODE

# 5) 部署
npx wrangler deploy
```

部署成功后会得到一个地址，类似：

```
https://jhjx-account.<你的子域>.workers.dev
```

把这个地址填到 `assets/js/api.js` 的 `PROD_API` 里，然后发布网站即可。

---

## 三、上线前要改的两处

1. `assets/js/api.js` → `var PROD_API = '';` 填成 Worker 地址
2. `tools/publish.mjs` → 把顶部 `HOLD` 里那几行删掉（现在账号页是「暂缓上线」状态）

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

---

## 五、这套设计的边界（务必知道）

- **没有密码**，所以凭证（token）就是身份。凭证只存在本人浏览器里，
  换设备要管理员点「重置登录」才能重新认领昵称。
- **邀请码是共享的**，它会随群扩散。普通人拿到管理员邀请码就是管理员，
  所以管理员邀请码不要发到大群；泄露了就直接 `wrangler secret put ADMIN_CODE` 换一个。
- **昵称不能包含「管理员」「社长」这类词**（服务端拦），防止冒充部门。
- 举报是「有记录、可追溯」的：谁举报的、谁处理的都会留档。
- 目前只存昵称、角色、时间、举报内容，**不收集手机号、身份证等敏感信息**。
  真要对外公开运营，按国内要求还需要备案；这一步请自行评估。
