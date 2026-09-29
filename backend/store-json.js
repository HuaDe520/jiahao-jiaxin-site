/* =========================================================
   存储层 · JSON 文档版
   ---------------------------------------------------------
   整个数据库就是一个 JSON 文档，适合协会这种「几十个用户、
   一天几十条消息」的规模，放在阿里云 OSS 上（私有桶）。

   每次请求都重新读一遍：函数实例会被复用，缓存住会拿到旧数据，
   多实例之间也会互相覆盖。写入用一把内存锁串行化。

   头像等二进制文件不放在这个文档里，走 io.putObject / getObject
   存成独立对象（文档里只记一个 key），避免文档膨胀。
   ========================================================= */

const MAX_MESSAGES = 5000;   /* 消息总量上限，超了就丢最旧的 */

export function createJsonStore(io) {
  let doc = null;
  let chain = Promise.resolve();

  function emptyDoc() {
    return {
      v: 2,
      seq: { user: 0, report: 0, friendship: 0, message: 0 },
      users: [],
      reports: [],
      friendships: [],
      messages: [],
    };
  }

  async function load() {
    const raw = await io.read();
    let parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
    }
    doc = parsed && Array.isArray(parsed.users) ? parsed : emptyDoc();
    if (!Array.isArray(doc.reports)) doc.reports = [];
    if (!Array.isArray(doc.friendships)) doc.friendships = [];
    if (!Array.isArray(doc.messages)) doc.messages = [];
    if (!doc.seq) doc.seq = {};
    for (const k of ['user', 'report', 'friendship', 'message']) {
      if (typeof doc.seq[k] !== 'number') doc.seq[k] = doc[k === 'user' ? 'users' : k + 's'].length;
    }
    if (!raw) await persist();
    return doc;
  }

  async function persist() {
    if (doc.messages.length > MAX_MESSAGES) {
      doc.messages = doc.messages.slice(doc.messages.length - MAX_MESSAGES);
    }
    await io.write(JSON.stringify(doc));
  }

  /* 所有写操作排队执行 */
  function withLock(fn) {
    const run = chain.then(() => fn());
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  const num = (v) => (typeof v === 'number' ? v : 0);
  const pairKey = (a, b) => (a < b ? a + ':' + b : b + ':' + a);

  return {
    /* ---------------- 用户 ---------------- */
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
    async searchUsers(q, excludeId, limit) {
      const d = await load();
      const needle = String(q || '').trim().toLowerCase();
      if (!needle) return [];
      return d.users
        .filter((u) => u.id !== excludeId && u.status === 'active' && u.name.toLowerCase().includes(needle))
        .slice(0, limit || 20);
    },
    async createUser({ name, nameKey, role, token, now, passHash, passSalt }) {
      return withLock(async () => {
        const d = await load();
        const row = {
          id: ++d.seq.user,
          name,
          name_key: nameKey,
          role,
          status: 'active',
          token,
          pass_hash: passHash || null,
          pass_salt: passSalt || null,
          gender: 'unknown',
          gender_custom: '',
          signature: '',
          avatar: null,
          avatar_ver: 0,
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

    /* ---------------- 举报 ---------------- */
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
      const rows = status ? d.reports.filter((r) => r.status === status) : d.reports.slice();
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

    /* ---------------- 好友 ---------------- */
    async getFriendship(a, b) {
      const d = await load();
      const key = pairKey(a, b);
      return d.friendships.find((f) => pairKey(f.a, f.b) === key) || null;
    },
    async listFriendshipsFor(userId) {
      const d = await load();
      return d.friendships.filter((f) => f.a === userId || f.b === userId);
    },
    async createFriendship(rec) {
      return withLock(async () => {
        const d = await load();
        const row = { id: ++d.seq.friendship, status: 'pending', created_at: Date.now(), ...rec };
        d.friendships.push(row);
        await persist();
        return row;
      });
    },
    async updateFriendship(id, patch) {
      return withLock(async () => {
        const d = await load();
        const row = d.friendships.find((f) => f.id === id);
        if (!row) return null;
        Object.assign(row, patch);
        await persist();
        return row;
      });
    },
    async deleteFriendship(id) {
      return withLock(async () => {
        const d = await load();
        const before = d.friendships.length;
        d.friendships = d.friendships.filter((f) => f.id !== id);
        if (d.friendships.length !== before) await persist();
        return true;
      });
    },

    /* ---------------- 消息 ---------------- */
    async createMessage(rec) {
      return withLock(async () => {
        const d = await load();
        const row = { id: ++d.seq.message, read_at: null, ...rec };
        d.messages.push(row);
        await persist();
        return row;
      });
    },
    async listMessagesBetween(a, b, since, limit) {
      const d = await load();
      const key = pairKey(a, b);
      let rows = d.messages.filter((m) => pairKey(m.from, m.to) === key);
      if (since) rows = rows.filter((m) => num(m.created_at) > since);
      rows.sort((x, y) => num(x.created_at) - num(y.created_at));
      return rows.slice(-(limit || 100));
    },
    async listMessagesForThreads(userId, limit) {
      const d = await load();
      const rows = d.messages.filter((m) => m.from === userId || m.to === userId);
      rows.sort((x, y) => num(x.created_at) - num(y.created_at));
      return rows.slice(-(limit || 500));
    },
    async getMessageById(id) {
      const d = await load();
      return d.messages.find((m) => m.id === id) || null;
    },
    async recallMessage(id, ts) {
      return withLock(async () => {
        const d = await load();
        const row = d.messages.find((m) => m.id === id);
        if (!row) return null;
        row.recalled_at = ts;
        await persist();
        return row;
      });
    },
    async markMessagesRead(userId, otherId, ts) {
      return withLock(async () => {
        const d = await load();
        let changed = 0;
        d.messages.forEach((m) => {
          if (m.to === userId && m.from === otherId && !m.read_at) { m.read_at = ts; changed++; }
        });
        if (changed) await persist();
        return changed;
      });
    },
    async countUnreadFrom(userId, otherId) {
      const d = await load();
      return d.messages.filter((m) => m.to === userId && m.from === otherId && !m.read_at).length;
    },
    async countUnreadTotal(userId) {
      const d = await load();
      return d.messages.filter((m) => m.to === userId && !m.read_at).length;
    },

    /* ---------------- 二进制对象（头像） ---------------- */
    async putObject(key, bytes, contentType) {
      if (!io.putObject) throw new Error('这个存储不支持二进制对象');
      await io.putObject(key, bytes, contentType);
      return true;
    },
    async getObject(key) {
      if (!io.getObject) return null;
      return io.getObject(key);
    },
    async deleteObject(key) {
      if (!io.deleteObject) return false;
      return io.deleteObject(key);
    },
  };
}
