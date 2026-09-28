/* =========================================================
   存储层 · Cloudflare D1（SQL）版
   接口与 store-json.js 完全一致
   ========================================================= */

export function createD1Store(db) {
  const one = async (sql, args) => {
    const row = await db.prepare(sql).bind(...args).first();
    return row || null;
  };
  const all = async (sql, args) => {
    const res = await db.prepare(sql).bind(...args).all();
    return (res && res.results) || [];
  };
  const run = async (sql, args) => db.prepare(sql).bind(...args).run();

  return {
    async getUserByToken(token) {
      if (!token) return null;
      return one('SELECT * FROM users WHERE token = ?', [token]);
    },
    async getUserByKey(nameKey) {
      return one('SELECT * FROM users WHERE name_key = ?', [nameKey]);
    },
    async getUserById(id) {
      return one('SELECT * FROM users WHERE id = ?', [id]);
    },
    async createUser({ name, nameKey, role, token, now }) {
      await run(
        'INSERT INTO users (name, name_key, role, status, token, created_at, last_seen_at) VALUES (?,?,?,?,?,?,?)',
        [name, nameKey, role, 'active', token, now, now]
      );
      return one('SELECT * FROM users WHERE name_key = ?', [nameKey]);
    },
    async updateUser(id, patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return one('SELECT * FROM users WHERE id = ?', [id]);
      const sets = keys.map((k) => `${k} = ?`).join(', ');
      await run(`UPDATE users SET ${sets} WHERE id = ?`, [...keys.map((k) => patch[k]), id]);
      return one('SELECT * FROM users WHERE id = ?', [id]);
    },
    async countOpenReports() {
      const row = await one("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'", []);
      return row ? row.n : 0;
    },
    async countReportsByReporterSince(reporterId, since) {
      const row = await one('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?', [reporterId, since]);
      return row ? row.n : 0;
    },
    async countReportsForTargetSince(reporterId, targetId, since) {
      const row = await one(
        'SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND target_id = ? AND created_at > ?',
        [reporterId, targetId, since]
      );
      return row ? row.n : 0;
    },
    async createReport(rec) {
      await run(
        'INSERT INTO reports (target_id, target_name, reporter_id, reporter_name, reason, detail, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [rec.target_id, rec.target_name, rec.reporter_id, rec.reporter_name, rec.reason, rec.detail, 'open', rec.created_at]
      );
      const row = await one('SELECT * FROM reports ORDER BY id DESC LIMIT 1', []);
      return row;
    },
    async listReports(status, limit) {
      if (status) return all('SELECT * FROM reports WHERE status = ? ORDER BY created_at DESC LIMIT ?', [status, limit || 200]);
      return all('SELECT * FROM reports ORDER BY created_at DESC LIMIT ?', [limit || 200]);
    },
    async getReport(id) {
      return one('SELECT * FROM reports WHERE id = ?', [id]);
    },
    async updateReport(id, patch) {
      const keys = Object.keys(patch);
      if (keys.length) {
        const sets = keys.map((k) => `${k} = ?`).join(', ');
        await run(`UPDATE reports SET ${sets} WHERE id = ?`, [...keys.map((k) => patch[k]), id]);
      }
      return one('SELECT * FROM reports WHERE id = ?', [id]);
    },
    async listUsersWithReportCounts(limit) {
      const rows = await all(
        `SELECT u.id, u.name, u.role, u.status, u.created_at, u.last_seen_at,
                (SELECT COUNT(*) FROM reports r WHERE r.target_id = u.id) AS reports
         FROM users u ORDER BY u.created_at DESC LIMIT ?`,
        [limit || 300]
      );
      return rows;
    },
    async countUsers() {
      const row = await one('SELECT COUNT(*) AS n FROM users', []);
      return row ? row.n : 0;
    },
    async countBannedUsers() {
      const row = await one("SELECT COUNT(*) AS n FROM users WHERE status = 'banned'", []);
      return row ? row.n : 0;
    },
  };
}
