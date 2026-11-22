'use strict';
/**
 * Хранилище Секретки: один JSON-файл с атомарной записью.
 * Сервер хранит ТОЛЬКО шифротекст сообщений — открытые тексты не проходят через него.
 * Токены хранятся как SHA-256 хэши, пароли — как scrypt.
 */
const fs = require('fs');

function normalize(nick) { return String(nick || '').trim().toLowerCase(); }

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
    this.data.users[n] = { name: String(nick).trim(), hash: passHash, salt, pub: null, created: Date.now() };
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

  addMsg(from, to, body) {
    const key = this.convKey(from, to);
    if (!this.data.msgs[key]) this.data.msgs[key] = [];
    const m = this.data.msgs[key];
    const rec = { id: ++this.data.seq, from: normalize(from), body, ts: Date.now(), seen: false };
    m.push(rec);
    if (m.length > 1000) m.splice(0, m.length - 1000);
    this.save();
    return rec;
  }

  getMsgs(a, b, after) {
    const m = this.data.msgs[this.convKey(a, b)] || [];
    return after ? m.filter(x => x.ts > after) : m.slice();
  }

  markSeen(viewer, other) {
    const m = this.data.msgs[this.convKey(viewer, other)] || [];
    let changed = false;
    for (const x of m) {
      if (x.from !== normalize(viewer) && !x.seen) { x.seen = true; changed = true; }
    }
    if (changed) this.save();
  }
}

module.exports = Store;
