'use strict';
/**
 * Хранилище Секретки: один JSON-файл с атомарной записью.
 * Сервер хранит ТОЛЬКО шифротекст сообщений — открытые тексты не проходят через него.
 * Токены хранятся как SHA-256 хэши, пароли — как scrypt.
 */
const fs = require('fs');

function normalize(nick) { return String(nick || '').trim().toLowerCase(); }

// Сгорающие сообщения живут на сервере не дольше этого времени (мс):
// получатель успевает прочитать, после чего запись вычищается.
const BURN_TTL_MS = 10000;

class Store {
  constructor(file) {
    this.file = file;
    this.data = { users: {}, tokens: {}, friends: {}, msgs: {}, seq: 0 };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (d && d.users) this.data = d;
      }
    } catch (err) { console.error('[store] load:', err.message); }
  }

  save() {
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) { console.error('[store] save:', err.message); }
  }

  // ---------- пользователи ----------
  createUser(nick, passHash, salt) {
    const n = normalize(nick);
    if (this.data.users[n]) return null;
    this.data.users[n] = { name: String(nick).trim(), hash: passHash, salt, pub: null, vault: null, created: Date.now() };
    this.save();
    return this.data.users[n];
  }

  getUser(nick) { return this.data.users[normalize(nick)] || null; }

  setPub(nick, pub) {
    const u = this.getUser(nick);
    if (!u) return false;
    u.pub = pub;
    this.save();
    return true;
  }

  // Зашифрованный паролем секретный ключ (конверт). Сервер не может его открыть.
  setVault(nick, vault) {
    const u = this.getUser(nick);
    if (!u) return false;
    u.vault = vault || null;
    this.save();
    return true;
  }
  getVault(nick) {
    const u = this.getUser(nick);
    return u && u.vault ? u.vault : null;
  }

  // ---------- токены ----------
  addToken(hash, nick) { this.data.tokens[hash] = normalize(nick); this.save(); }
  userByToken(hash) {
    const n = this.data.tokens[hash];
    return n ? this.getUser(n) : null;
  }
  removeToken(hash) { delete this.data.tokens[hash]; this.save(); }

  // ---------- друзья ----------
  _rel(a, b) {
    const key = [normalize(a), normalize(b)].sort().join('|');
    if (!this.data.friends[key]) this.data.friends[key] = {};
    return this.data.friends[key];
  }

  requestFriend(from, to) {
    const A = normalize(from), B = normalize(to);
    const r = this._rel(A, B);
    if (r.status === 'accepted') return 'already';
    if (r.status === 'pending') return 'pending';
    r.status = 'pending';
    r.since = Date.now();
    r.by = A;
    r[A] = (this.getUser(A) || {}).pub || null;
    this.save();
    return 'ok';
  }

  acceptFriend(a, b) {
    // a принимает заявку от b
    const A = normalize(a), B = normalize(b);
    const r = this._rel(A, B);
    if (r.status === 'accepted') return false;
    const uA = this.getUser(A), uB = this.getUser(B);
    if (!uA || !uB || !uA.pub || !uB.pub) return false;
    r.status = 'accepted';
    r.addedAt = Date.now();
    r[A] = uA.pub;
    r[B] = uB.pub;
    this.save();
    return true;
  }

  declineFriend(a, b) { delete this.data.friends[[normalize(a), normalize(b)].sort().join('|')]; this.save(); }

  removeFriend(a, b) { delete this.data.friends[[normalize(a), normalize(b)].sort().join('|')]; this.save(); }

  // Синхронизация публичных ключей в записи дружбы с текущими ключами аккаунтов.
  // Вызывается при каждой отправке сообщения: если собеседник сменил ключ
  // (например, на новом устройстве), получатель должен видеть актуальный pub,
  // иначе он не сможет расшифровать новые сообщения.
  syncFriendKeys(a, b) {
    const A = normalize(a), B = normalize(b);
    const r = this._rel(A, B);
    if (r.status !== 'accepted') return false;
    const uA = this.getUser(A), uB = this.getUser(B);
    let changed = false;
    if (uA && uA.pub && r[A] !== uA.pub) { r[A] = uA.pub; changed = true; }
    if (uB && uB.pub && r[B] !== uB.pub) { r[B] = uB.pub; changed = true; }
    if (changed) this.save();
    return changed;
  }

  friendStatus(a, b) {
    const r = this._rel(a, b);
    return r.status || null;
  }

  friendsOf(nick) {
    const N = normalize(nick);
    const out = [];
    for (const [key, r] of Object.entries(this.data.friends)) {
      if (r.status !== 'accepted') continue;
      const arr = key.split('|');
      if (!arr.includes(N)) continue;
      const other = arr[0] === N ? arr[1] : arr[0];
      const u = this.getUser(other);
      out.push({ nick: u ? u.name : other, pub: r[other] || null, addedAt: r.addedAt });
    }
    return out;
  }

  incomingRequests(nick) {
    const N = normalize(nick);
    const out = [];
    for (const [key, r] of Object.entries(this.data.friends)) {
      if (r.status !== 'pending' || r.by === N) continue;
      const arr = key.split('|');
      if (!arr.includes(N)) continue;
      const other = r.by;
      out.push({ nick: this.getUser(other).name || other, since: r.since });
    }
    return out;
  }

  outgoingRequests(nick) {
    const N = normalize(nick);
    const out = [];
    for (const [key, r] of Object.entries(this.data.friends)) {
      if (r.status !== 'pending' || r.by !== N) continue;
      const arr = key.split('|');
      if (!arr.includes(N)) continue;
      const other = arr[0] === N ? arr[1] : arr[0];
      out.push({ nick: this.getUser(other).name || other, since: r.since });
    }
    return out;
  }

  // ---------- сообщения (только шифротекст) ----------
  convKey(a, b) { return [normalize(a), normalize(b)].sort().join('|'); }

  addMsg(from, to, body, burn) {
    const key = this.convKey(from, to);
    if (!this.data.msgs[key]) this.data.msgs[key] = [];
    const m = this.data.msgs[key];
    const rec = { id: ++this.data.seq, from: normalize(from), body, ts: Date.now(), seen: false };
    if (burn) rec.burn = true; // сгорающее сообщение
    m.push(rec);
    if (m.length > 1000) m.splice(0, m.length - 1000);
    this.save();
    return rec;
  }

  // ленивая чистка сгоревших записей (время жизни истекло)
  sweepBurnedForKey(a, b) {
    const key = this.convKey(a, b);
    const m = this.data.msgs[key];
    if (!m) return 0;
    const now = Date.now();
    const kept = m.filter(x => !(x.burn && (now - x.ts) >= BURN_TTL_MS));
    if (kept.length !== m.length) {
      this.data.msgs[key] = kept;
      this.save();
    }
    return m.length - kept.length;
  }

  getMsgs(a, b, after) {
    this.sweepBurnedForKey(a, b);
    const m = this.data.msgs[this.convKey(a, b)] || [];
    return after ? m.filter(x => x.ts > after) : m.slice();
  }

  // удалить весь диалог (переписку между двумя пользователями)
  deleteConv(a, b) {
    const key = this.convKey(a, b);
    if (this.data.msgs[key]) {
      delete this.data.msgs[key];
      this.save();
      return true;
    }
    return false;
  }

  // удалить одно сообщение, только если его автор — a
  deleteMsg(a, b, id) {
    const key = this.convKey(a, b);
    const m = this.data.msgs[key];
    if (!m) return null;
    const idx = m.findIndex(x => x.id === Number(id));
    if (idx < 0) return null;
    if (m[idx].from !== normalize(a)) return null;
    const [rec] = m.splice(idx, 1);
    this.save();
    return rec;
  }

  markSeen(viewer, other) {
    const m = this.data.msgs[this.convKey(viewer, other)] || [];
    let changed = false;
    for (const x of m) {
      if (x.from !== normalize(viewer) && !x.seen) { x.seen = true; changed = true; }
    }
    if (changed) this.save();
  }

  // ---------- серверы (гильдии) и каналы ----------
  genInvite() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let code;
    do {
      code = '';
      for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    } while (this.guildByCode(code));
    return code;
  }

  guildByCode(code) {
    if (!code) return null;
    const c = String(code).trim().toLowerCase();
    for (const g of Object.values(this.data.guilds || {})) {
      if (String(g.code || '').toLowerCase() === c) return g;
    }
    return null;
  }

  createGuild(owner, name) {
    if (!this.data.guilds) this.data.guilds = {};
    const id = 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    const guild = {
      id,
      name: String(name || '').trim().slice(0, 40) || 'Сервер',
      owner: normalize(owner),
      created: Date.now(),
      code: this.genInvite(),
      members: [normalize(owner)],
      channels: [{ id: 'c1', kind: 'text', name: 'общий' }]
    };
    this.data.guilds[id] = guild;
    this.save();
    return guild;
  }

  getGuild(id) { return (this.data.guilds || {})[id] || null; }

  guildOfMember(nick) {
    const N = normalize(nick);
    const out = [];
    for (const g of Object.values(this.data.guilds || {})) {
      if (g.members.includes(N)) out.push(g);
    }
    return out;
  }

  joinGuild(guild, nick) {
    const N = normalize(nick);
    if (guild.members.includes(N)) return false;
    guild.members.push(N);
    this.save();
    return true;
  }

  leaveGuild(guild, nick) {
    const N = normalize(nick);
    const i = guild.members.indexOf(N);
    if (i < 0) return false;
    guild.members.splice(i, 1);
    if (guild.members.length === 0) { delete this.data.guilds[guild.id]; }
    this.save();
    return true;
  }

  deleteGuild(id) {
    const g = this.data.guilds || {};
    if (!g[id]) return false;
    delete g[id];
    this.save();
    return true;
  }

  addChannel(guild, kind, name) {
    const ch = { id: 'c' + (Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)), kind: kind === 'voice' ? 'voice' : 'text', name: String(name || '').trim().slice(0, 30) || (kind === 'voice' ? 'Голосовой' : 'новый-канал') };
    guild.channels.push(ch);
    this.save();
    return ch;
  }

  removeChannel(guild, channelId) {
    const i = guild.channels.findIndex(c => c.id === channelId);
    if (i < 0) return false;
    const [ch] = guild.channels.splice(i, 1);
    if (this.data.gmsgs) delete this.data.gmsgs[guild.id + ':' + ch.id];
    this.save();
    return true;
  }

  guildMsgKey(guildId, channelId) { return guildId + ':' + channelId; }

  addGuildMsg(guildId, channelId, from, envelopes) {
    if (!this.data.gmsgs) this.data.gmsgs = {};
    const key = this.guildMsgKey(guildId, channelId);
    if (!this.data.gmsgs[key]) this.data.gmsgs[key] = [];
    const rec = { id: ++this.data.seq, from: normalize(from), body: envelopes, ts: Date.now() };
    const arr = this.data.gmsgs[key];
    arr.push(rec);
    if (arr.length > 2000) arr.splice(0, arr.length - 2000);
    this.save();
    return rec;
  }

  getGuildMsgs(guildId, channelId, me, after) {
    const arr = (this.data.gmsgs || {})[this.guildMsgKey(guildId, channelId)] || [];
    const N = normalize(me);
    const out = [];
    for (const x of arr) {
      if (after && x.ts <= after) continue;
      const env = x.body && x.body[N];
      const y = { id: x.id, from: x.from, ts: x.ts };
      if (env) { y.body = env; out.push(y); }
    }
    return out;
  }
}

module.exports = Store;
