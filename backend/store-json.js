/* =========================================================
   存储层 · JSON 文档版
   ---------------------------------------------------------
   整个数据库就是一个 JSON 文档，适合协会这种「几十个用户、
   一天几条写入」的规模，可以直接放在阿里云 OSS 上。

   接口与 store-d1.js 完全一致，所以上层的路由逻辑不用改。
   写入用一把内存锁串行化，避免同一个实例内自己踩自己。
   ========================================================= */

export function createJsonStore(io) {
  let doc = null;
  let chain = Promise.resolve();

  function emptyDoc() {
    return { v: 1, seq: { user: 0, report: 0 }, users: [], reports: [] };
  }

  async function load() {
    /* 每次都从存储重新读：函数实例可能被复用很多次，
       缓存住会拿到旧数据，多实例之间也会互相覆盖 */
    const raw = await io.read();
    let parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
    }
    doc = parsed && Array.isArray(parsed.users) && Array.isArray(parsed.reports) ? parsed : emptyDoc();
    if (!doc.seq) doc.seq = { user: doc.users.length, report: doc.reports.length };
    if (!raw) await persist();
    return doc;
  }

  async function persist() {
    await io.write(JSON.stringify(doc));
  }

  /* 所有写操作排队执行，读操作直接读内存 */
  function withLock(fn) {
    const run = chain.then(() => fn());
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  const num = (v) => (typeof v === 'number' ? v : 0);

  return {
    async getUserByToken(token) {
      const d = await load();
      if (!token) return null;
      return d.users.find((u) => u.token === token) || null;
    },

    async getUserByKey(nameKey) {
      const d = await load();
      return d.users.find((u) => u.name_key === nameKey) || null;
    },

    async getUserById(id) {
      const d = await load();
      return d.users.find((u) => u.id === id) || null;
    },

    async createUser({ name, nameKey, role, token, now }) {
      return withLock(async () => {
        const d = await load();
        const row = {
          id: ++d.seq.user,
          name,
          name_key: nameKey,
          role,
          status: 'active',
          token,
          created_at: now,
          last_seen_at: now,
        };
        d.users.push(row);
        await persist();
        return row;
      });
    },

    async updateUser(id, patch) {
      return withLock(async () => {
        const d = await load();
        const row = d.users.find((u) => u.id === id);
        if (!row) return null;
        Object.assign(row, patch);
        await persist();
        return row;
      });
    },

    async countOpenReports() {
      const d = await load();
      return d.reports.filter((r) => r.status === 'open').length;
    },

    async countReportsByReporterSince(reporterId, since) {
      const d = await load();
      return d.reports.filter((r) => r.reporter_id === reporterId && num(r.created_at) > since).length;
    },

    async countReportsForTargetSince(reporterId, targetId, since) {
      const d = await load();
      return d.reports.filter((r) => r.reporter_id === reporterId && r.target_id === targetId && num(r.created_at) > since).length;
    },

    async createReport(rec) {
      return withLock(async () => {
        const d = await load();
        const row = { id: ++d.seq.report, status: 'open', ...rec };
        d.reports.push(row);
        await persist();
        return row;
      });
    },

    async listReports(status, limit) {
      const d = await load();
      const rows = status
        ? d.reports.filter((r) => r.status === status)
        : d.reports.slice();
      rows.sort((a, b) => num(b.created_at) - num(a.created_at));
      return rows.slice(0, limit || 200);
    },

    async getReport(id) {
      const d = await load();
      return d.reports.find((r) => r.id === id) || null;
    },

    async updateReport(id, patch) {
      return withLock(async () => {
        const d = await load();
        const row = d.reports.find((r) => r.id === id);
        if (!row) return null;
        Object.assign(row, patch);
        await persist();
        return row;
      });
    },

    async listUsersWithReportCounts(limit) {
      const d = await load();
      const rows = d.users.map((u) => ({
        ...u,
        reports: d.reports.filter((r) => r.target_id === u.id).length,
      }));
      rows.sort((a, b) => num(b.created_at) - num(a.created_at));
      return rows.slice(0, limit || 300);
    },

    async countUsers() {
      const d = await load();
      return d.users.length;
    },

    async countBannedUsers() {
      const d = await load();
      return d.users.filter((u) => u.status === 'banned').length;
    },
  };
}
