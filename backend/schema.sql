-- 浙江嘉豪嘉欣协会 · 伪用户系统数据库结构（Cloudflare D1 / SQLite）
-- 两个邀请码只存在服务端（wrangler secret），不进数据库也不进前端

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,              -- 昵称（原样显示）
  name_key     TEXT    NOT NULL UNIQUE,       -- 归一化后的昵称，用来判重（去空格 + 转小写）
  role         TEXT    NOT NULL DEFAULT 'user',    -- user | admin
  status       TEXT    NOT NULL DEFAULT 'active',  -- active | banned
  token        TEXT    NOT NULL,              -- 本机登录凭证（伪用户系统：没有密码）
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id     INTEGER NOT NULL,
  target_name   TEXT    NOT NULL,
  reporter_id   INTEGER,
  reporter_name TEXT,
  reason        TEXT    NOT NULL,
  detail        TEXT,
  status        TEXT    NOT NULL DEFAULT 'open',  -- open | handled | rejected
  created_at    INTEGER NOT NULL,
  handled_by    TEXT,
  handled_at    INTEGER,
  handle_note   TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_status  ON reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_target  ON reports (target_id);
CREATE INDEX IF NOT EXISTS idx_users_token     ON users (token);
