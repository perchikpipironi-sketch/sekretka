'use strict';
/**
 * Секретка — сервер.
 * Не знает открытых текстов: сообщения приходят и хранятся только как шифротекст.
 * Зависимость одна: ws (WebSocket). Всё остальное — встроенные модули Node.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { WebSocketServer } = require('ws');
const Store = require('./lib/store');

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const ROOT = path.join(__dirname, 'public');
const store = new Store(DATA_FILE);

// ---------- медиа (файлы): храним только шифротекст, как и сообщения ----------
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, 'media');
const MEDIA_IDX = path.join(MEDIA_DIR, 'index.json');
let mediaIdx = {};
try { if (fs.existsSync(MEDIA_IDX)) mediaIdx = JSON.parse(fs.readFileSync(MEDIA_IDX, 'utf8')); } catch (e) { mediaIdx = {}; }
function saveMediaIdx() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const tmp = MEDIA_IDX + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(mediaIdx));
  fs.renameSync(tmp, MEDIA_IDX);
}
function mediaId() { return Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex'); }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// ---------- криптопримитивы сервера (только для аутентификации) ----------
function hashToken(tok) { return crypto.createHash('sha256').update(String(tok)).digest('hex'); }
function scryptHash(pass, salt) { return crypto.scryptSync(String(pass), salt, 64).toString('hex'); }
function issueToken(nick) {
  const tok = crypto.randomBytes(32).toString('hex');
  store.addToken(hashToken(tok), nick);
  return tok;
}
function verifyPass(user, pass) {
  const h = scryptHash(pass, user.salt);
  const a = Buffer.from(h, 'hex'), b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- демо-сид (DEMO=1) ----------
function seedDemo() {
  for (const n of ['demo_alice', 'demo_bob']) {
    if (!store.getUser(n)) {
      const salt = crypto.randomBytes(16).toString('hex');
      store.createUser(n, scryptHash('demo', salt), salt);
    }
  }
}
if (process.env.DEMO === '1') seedDemo();

// ---------- онлайн-присутствие ----------
// nick(нижний регистр) -> Set<ws>: у одного аккаунта может быть несколько вкладок/устройств,
// и КАЖДАЯ из них должна получать события (push в одну «последнюю» ломал живые обновления).
const online = new Map();

function onlineAdd(nick, ws) {
  const k = String(nick).toLowerCase();
  if (!online.has(k)) online.set(k, new Set());
  online.get(k).add(ws);
}
function onlineRemove(nick, ws) {
  const k = String(nick).toLowerCase();
  const set = online.get(k);
  if (!set) return;
  set.delete(ws);
  if (!set.size) online.delete(k);
}
function onlineCount(nick) {
  const set = online.get(String(nick).toLowerCase());
  return set ? set.size : 0;
}
function sendTo(nick, obj) {
  const set = online.get(String(nick).toLowerCase());
  if (!set || !set.size) return 0;
  const data = JSON.stringify(obj);
  let sent = 0;
  for (const ws of set) {
    if (ws.readyState === 1) {
      try { ws.send(data); sent++; } catch (e) { /* сокет уже мёртв */ }
    }
  }
  return sent;
}

// ---------- голосовые комнаты (звонки в каналах) ----------
// Комната хранит соединения: sessionId (sid) -> nick (нижний регистр).
// У одного ника может быть несколько устройств/вкладок — каждое получает
// собственный sid и видит остальные соединения как отдельных «участников».
// Сигналы WebRTC ретранслируются точечно от одного sid к другому.
const voiceRooms = new Map(); // `${guildId}:${channelId}` -> Map<sid, nick>
const voiceSockets = new Map(); // sid -> ws
let voiceSeq = 1;
function voiceRoomKey(guildId, channelId) { return String(guildId) + ':' + String(channelId); }
function voicePeers(guildId, channelId) {
  const room = voiceRooms.get(voiceRoomKey(guildId, channelId));
  if (!room) return [];
  const out = [];
  for (const [sid, nick] of room) out.push({ sid, nick });
  return out;
}
function voiceBroadcast(key, exceptSid, obj) {
  const room = voiceRooms.get(key);
  if (!room) return;
  const data = JSON.stringify(obj);
  for (const sid of room.keys()) {
    if (sid === exceptSid) continue;
    const ws = voiceSockets.get(sid);
    if (ws && ws.readyState === 1) { try { ws.send(data); } catch (e) {} }
  }
}
function voiceSendSid(sid, obj) {
  const ws = voiceSockets.get(sid);
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); return true; } catch (e) {} 
  }
  return false;
}
function voiceLeaveSocket(ws) {
  const key = ws._voiceKey;
  if (!key) return;
  const sid = ws._voiceSid;
  if (sid) voiceSockets.delete(sid);
  const room = voiceRooms.get(key);
  if (room) {
    room.delete(sid);
    if (!room.size) voiceRooms.delete(key);
  }
  ws._voiceKey = null;
  ws._voiceSid = null;
  const parts = key.split(':');
  voiceBroadcast(key, sid, {
    type: 'voice-state', guildId: parts[0], channelId: parts[1],
    state: 'peer-left', sid, peers: voicePeers(parts[0], parts[1])
  });
}

// ---------- HTTP ----------
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limitMB) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const limit = (limitMB || 2) * 1024 * 1024;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}

function parseToken(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+([A-Za-z0-9]+)$/.exec(h);
  return m ? store.userByToken(hashToken(m[1])) : null;
}

const NICK_RE = /^[\p{L}\p{N}_]{2,20}$/u;
function validNick(n) { return typeof n === 'string' && NICK_RE.test(n); }
function validPass(p) { return typeof p === 'string' && p.length >= 4 && p.length <= 72; }
function validPub(p) { return typeof p === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(p) && p.length >= 40 && p.length <= 120; }
function validVault(v) { return typeof v === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(v) && v.length >= 80 && v.length <= 512; }
function normNick(n) { return String(n || '').trim().toLowerCase(); }

// ---------- API ----------
async function handleApi(req, res) {
  const method = req.method;
  const u = new URL(req.url, 'http://x');

  if (method === 'GET' && u.pathname === '/api/health') return sendJSON(res, 200, { ok: true });

  if (method === 'POST' && u.pathname === '/api/register') {
    const body = await readBody(req);
    const nick = String(body.nick || '').trim();
    if (!validNick(nick)) return sendJSON(res, 400, { error: 'Имя: 2–20 символов, буквы/цифры/подчёркивание' });
    if (!validPass(body.pass)) return sendJSON(res, 400, { error: 'Пароль: 4–72 символа' });
    if (store.getUser(nick)) return sendJSON(res, 409, { error: 'Такое имя уже занято' });
    const salt = crypto.randomBytes(16).toString('hex');
    store.createUser(nick, scryptHash(body.pass, salt), salt);
    return sendJSON(res, 200, { token: issueToken(nick), nick: store.getUser(nick).name });
  }

  if (method === 'POST' && u.pathname === '/api/login') {
    const body = await readBody(req);
    const nick = String(body.nick || '').trim();
    const user = store.getUser(nick);
    if (!user || !verifyPass(user, body.pass)) return sendJSON(res, 401, { error: 'Неверное имя или пароль' });
    return sendJSON(res, 200, { token: issueToken(nick), nick: user.name });
  }

  const user = parseToken(req);
  if (!user) return sendJSON(res, 401, { error: 'Требуется вход' });
  const me = user.name;

  if (method === 'PUT' && u.pathname === '/api/me') {
    const body = await readBody(req);
    if (!validPub(body.pub)) return sendJSON(res, 400, { error: 'Неверный публичный ключ' });
    store.setPub(me, body.pub);
    return sendJSON(res, 200, { ok: true });
  }

  if (method === 'GET' && u.pathname === '/api/me') {
    const u2 = store.getUser(me) || {};
    return sendJSON(res, 200, { nick: u2.name || me, pub: u2.pub || null, hasVault: !!store.getVault(me) });
  }

  // Хранилище ключа: сервер держит только конверт, зашифрованный паролем владельца.
  if (method === 'GET' && u.pathname === '/api/vault') {
    return sendJSON(res, 200, { vault: store.getVault(me) });
  }

  if (method === 'POST' && u.pathname === '/api/vault') {
    const body = await readBody(req);
    if (!validVault(body.vault)) return sendJSON(res, 400, { error: 'Неверный конверт ключа' });
    store.setVault(me, body.vault);
    return sendJSON(res, 200, { ok: true, size: body.vault.length });
  }

  if (method === 'DELETE' && u.pathname === '/api/vault') {
    store.setVault(me, null);
    return sendJSON(res, 200, { ok: true });
  }

  if (method === 'GET' && u.pathname === '/api/friends') {
    return sendJSON(res, 200, { friends: store.friendsOf(me).map(f => ({ ...f, online: onlineCount(f.nick) > 0 })) });
  }

  if (method === 'GET' && u.pathname === '/api/friend/requests') {
    return sendJSON(res, 200, {
      incoming: store.incomingRequests(me),
      outgoing: store.outgoingRequests(me)
    });
  }

  if (method === 'POST' && u.pathname === '/api/friend/request') {
    const body = await readBody(req);
    const nick = String(body.nick || '').trim();
    if (!validNick(nick)) return sendJSON(res, 400, { error: 'Имя: 2–20 символов' });
    if (nick.toLowerCase() === me.toLowerCase()) return sendJSON(res, 400, { error: 'Нельзя добавить себя' });
    if (!store.getUser(nick)) return sendJSON(res, 404, { error: 'Пользователь не найден' });
    const st = store.requestFriend(me, nick);
    if (st === 'already') return sendJSON(res, 400, { error: 'Вы уже друзья' });
    if (st === 'pending') return sendJSON(res, 400, { error: 'Заявка уже отправлена' });
    // мгновенно сообщаем адресату, если он онлайн (во все его вкладки/устройства)
    sendTo(nick, { type: 'request', from: me });
    return sendJSON(res, 200, { ok: true });
  }

  if (method === 'POST' && u.pathname === '/api/friend/accept') {
    const body = await readBody(req);
    const nick = String(body.nick || '').trim();
    if (!store.acceptFriend(me, nick)) return sendJSON(res, 400, { error: 'Нет такой заявки или нет ключей' });
    const f = store.friendsOf(me).find(x => x.nick.toLowerCase() === nick.toLowerCase());
    // мгновенно сообщаем автору заявки, что его приняли
    sendTo(nick, { type: 'friend-accepted', by: me });
    return sendJSON(res, 200, { ok: true, pub: f ? f.pub : null });
  }

  if (method === 'POST' && u.pathname === '/api/friend/decline') {
    const body = await readBody(req);
    store.declineFriend(me, String(body.nick || '').trim());
    sendTo(String(body.nick || '').trim(), { type: 'friend-declined', by: me });
    return sendJSON(res, 200, { ok: true });
  }

  if (method === 'POST' && u.pathname === '/api/friend/remove') {
    const body = await readBody(req);
    store.removeFriend(me, String(body.nick || '').trim());
    return sendJSON(res, 200, { ok: true });
  }

  if (method === 'POST' && u.pathname === '/api/media') {
    const body = await readBody(req, 26);
    const to = String(body.to || '').trim();
    if (!validNick(to)) return sendJSON(res, 400, { error: 'Имя: 2–20 символов' });
    if (store.friendStatus(me, to) !== 'accepted') return sendJSON(res, 403, { error: 'Нет доступа: вы не друзья' });
    if (typeof body.b64 !== 'string' || !body.b64) return sendJSON(res, 400, { error: 'Нет данных файла' });
    const buf = Buffer.from(body.b64, 'base64');
    if (!buf.length) return sendJSON(res, 400, { error: 'Пустой файл' });
    if (buf.length > 24 * 1024 * 1024) return sendJSON(res, 413, { error: 'Файл больше 24 МБ' });
    const name = String(body.name || 'file').slice(0, 120);
    const mime = String(body.mime || 'application/octet-stream').slice(0, 100);
    const id = mediaId();
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    fs.writeFileSync(path.join(MEDIA_DIR, id), buf);
    mediaIdx[id] = { owner: me, size: buf.length, name: mime };
    saveMediaIdx();
    return sendJSON(res, 200, { id, size: buf.length });
  }

  const mediaM = /^\/api\/media\/([A-Za-z0-9-]+)$/.exec(u.pathname);
  if (method === 'GET' && mediaM) {
    const id = mediaM[1];
    const meta = mediaIdx[id];
    if (!meta) return sendJSON(res, 404, { error: 'Файл не найден' });
    if (meta.owner !== me && store.friendStatus(me, meta.owner) !== 'accepted')
      return sendJSON(res, 403, { error: 'Нет доступа' });
    const p = path.join(MEDIA_DIR, id);
    if (!fs.existsSync(p)) return sendJSON(res, 404, { error: 'Файл не найден' });
    const buf = fs.readFileSync(p);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length });
    res.end(buf);
    return;
  }

  if (method === 'POST' && u.pathname === '/api/msg') {
    const body = await readBody(req);
    const to = String(body.to || '').trim();
    if (!validNick(to)) return sendJSON(res, 400, { error: 'Имя: 2–20 символов' });
    if (store.friendStatus(me, to) !== 'accepted') return sendJSON(res, 403, { error: 'Нет доступа: вы не друзья' });
    if (typeof body.body !== 'string' || !body.body || body.body.length > 40000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.body))
      return sendJSON(res, 400, { error: 'Неверный шифротекст' });
    store.syncFriendKeys(me, to); // держим pub собеседника свежим — иначе после смены ключа диалог «немеет»
    const burn = !!body.burn;
    const rec = store.addMsg(me, to, body.body, burn);
    sendTo(to, { type: 'msg', from: store.getUser(me).name, to, id: rec.id, ts: rec.ts, body: rec.body, burn });
    return sendJSON(res, 200, { id: rec.id, ts: rec.ts, burn });
  }

  // удалить переписку с другом (обе стороны)
  if (method === 'DELETE' && u.pathname === '/api/conv') {
    const nick = String(u.searchParams.get('nick') || '').trim();
    if (!validNick(nick)) return sendJSON(res, 400, { error: 'Имя: 2–20 символов' });
    store.deleteConv(me, nick);
    sendTo(nick, { type: 'conv-deleted', nick: store.getUser(me).name });
    return sendJSON(res, 200, { ok: true });
  }

  // удалить своё сообщение
  const msgDelM = /^\/api\/msg\/(\d+)$/.exec(u.pathname);
  if (method === 'DELETE' && msgDelM) {
    const to = String(u.searchParams.get('conv') || '').trim();
    if (!validNick(to)) return sendJSON(res, 400, { error: 'Имя: 2–20 символов' });
    const id = msgDelM[1];
    const rec = store.deleteMsg(me, to, id);
    if (!rec) return sendJSON(res, 404, { error: 'Сообщение не найдено или не твоё' });
    const nick = store.getUser(me).name;
    sendTo(to, { type: 'msg-deleted', nick, id: rec.id });
    sendTo(me, { type: 'msg-deleted', nick: to, id: rec.id });
    return sendJSON(res, 200, { ok: true });
  }

  const convM = /^\/api\/conv\/([A-Za-z0-9_%]+)$/.exec(u.pathname);
  if (method === 'GET' && convM) {
    const nick = decodeURIComponent(convM[1]);
    if (store.friendStatus(me, nick) !== 'accepted') return sendJSON(res, 403, { error: 'Нет доступа' });
    const after = u.searchParams.get('after') ? parseInt(u.searchParams.get('after'), 10) : 0;
    const msgs = store.getMsgs(me, nick, after || 0);
    store.markSeen(me, nick);
    return sendJSON(res, 200, { msgs });
  }

  if (method === 'POST' && u.pathname === '/api/seen') {
    const body = await readBody(req);
    store.markSeen(me, String(body.nick || '').trim());
    return sendJSON(res, 200, { ok: true });
  }

  // ---------- серверы (гильдии) ----------
  if (method === 'GET' && u.pathname === '/api/guilds') {
    const list = store.guildOfMember(me);
    const out = list.map(g => ({
      id: g.id, name: g.name, owner: g.owner, code: g.code,
      channels: g.channels,
      members: g.members.map(nick => ({ nick, pub: store.getUser(nick) ? store.getUser(nick).pub : null }))
    }));
    return sendJSON(res, 200, { guilds: out });
  }

  if (method === 'POST' && u.pathname === '/api/guild') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const g = store.createGuild(me, name);
    return sendJSON(res, 200, { guild: { id: g.id, name: g.name, owner: g.owner, code: g.code, channels: g.channels } });
  }

  if (method === 'POST' && u.pathname === '/api/guild/join') {
    const body = await readBody(req);
    const g = store.guildByCode(body.code);
    if (!g) return sendJSON(res, 404, { error: 'Сервер по коду не найден' });
    const joined = store.joinGuild(g, me);
    return sendJSON(res, 200, { guild: { id: g.id, name: g.name, owner: g.owner, code: g.code, channels: g.channels }, joined });
  }

  if (method === 'POST' && u.pathname === '/api/guild/leave') {
    const body = await readBody(req);
    const g = store.getGuild(String(body.guildId || ''));
    if (!g) return sendJSON(res, 404, { error: 'Сервер не найден' });
    store.leaveGuild(g, me);
    return sendJSON(res, 200, { ok: true });
  }

  if (method === 'DELETE' && u.pathname === '/api/guild') {
    const body = await readBody(req);
    const g = store.getGuild(String(body.guildId || ''));
    if (!g) return sendJSON(res, 404, { error: 'Сервер не найден' });
    if (normNick(g.owner) !== normNick(me)) return sendJSON(res, 403, { error: 'Удалять может только владелец' });
    store.deleteGuild(g.id);
    return sendJSON(res, 200, { ok: true });
  }

  if (method === 'POST' && u.pathname === '/api/guild/channel') {
    const body = await readBody(req);
    const g = store.getGuild(String(body.guildId || ''));
    if (!g) return sendJSON(res, 404, { error: 'Сервер не найден' });
    if (!g.members.includes(normNick(me))) return sendJSON(res, 403, { error: 'Вы не участник сервера' });
    if (normNick(g.owner) !== normNick(me)) return sendJSON(res, 403, { error: 'Каналы создаёт владелец' });
    const ch = store.addChannel(g, body.kind, body.name);
    return sendJSON(res, 200, { channel: ch });
  }

  if (method === 'DELETE' && u.pathname === '/api/guild/channel') {
    const body = await readBody(req);
    const g = store.getGuild(String(body.guildId || ''));
    if (!g) return sendJSON(res, 404, { error: 'Сервер не найден' });
    if (normNick(g.owner) !== normNick(me)) return sendJSON(res, 403, { error: 'Каналы удаляет владелец' });
    store.removeChannel(g, String(body.channelId || ''));
    return sendJSON(res, 200, { ok: true });
  }

  if (method === 'POST' && u.pathname === '/api/guild/msg') {
    const body = await readBody(req);
    const g = store.getGuild(String(body.guildId || ''));
    if (!g) return sendJSON(res, 404, { error: 'Сервер не найден' });
    if (!g.members.includes(normNick(me))) return sendJSON(res, 403, { error: 'Вы не участник сервера' });
    const ch = g.channels.find(c => c.id === String(body.channelId || ''));
    if (!ch) return sendJSON(res, 404, { error: 'Канал не найден' });
    if (ch.kind !== 'text') return sendJSON(res, 400, { error: 'В голосовом канале пишут' });
    const env = body.body;
    if (!env || typeof env !== 'object') return sendJSON(res, 400, { error: 'Неверный конверт' });
    const keys = Object.keys(env);
    if (!keys.length || keys.length > 50) return sendJSON(res, 400, { error: 'Пусто или слишком много получателей' });
    for (const k of keys) {
      if (!g.members.includes(k)) return sendJSON(res, 400, { error: 'Получатель не участник сервера' });
      const v = env[k];
      if (typeof v !== 'string' || !v || v.length > 40000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v))
        return sendJSON(res, 400, { error: 'Неверный шифротекст' });
    }
    const rec = store.addGuildMsg(g.id, ch.id, me, env);
    for (const m of g.members) {
      if (normNick(m) === normNick(me)) continue;
      sendTo(m, { type: 'guild-msg', guildId: g.id, channelId: ch.id, id: rec.id, from: store.getUser(me).name, ts: rec.ts });
    }
    return sendJSON(res, 200, { id: rec.id, ts: rec.ts });
  }

  const gconvM = /^\/api\/guild\/conv\/([A-Za-z0-9_%]+)\/([A-Za-z0-9_%]+)$/.exec(u.pathname);
  if (method === 'GET' && gconvM) {
    const guildId = decodeURIComponent(gconvM[1]);
    const channelId = decodeURIComponent(gconvM[2]);
    const g = store.getGuild(guildId);
    if (!g) return sendJSON(res, 404, { error: 'Сервер не найден' });
    if (!g.members.includes(normNick(me))) return sendJSON(res, 403, { error: 'Вы не участник сервера' });
    const ch = g.channels.find(c => c.id === channelId);
    if (!ch) return sendJSON(res, 404, { error: 'Канал не найден' });
    const after = u.searchParams.get('after') ? parseInt(u.searchParams.get('after'), 10) : 0;
    const msgs = store.getGuildMsgs(guildId, channelId, me, after || 0);
    return sendJSON(res, 200, { msgs });
  }

  return sendJSON(res, 404, { error: 'Не найдено' });
}

// ---------- статика ----------
// HTML отдаём с no-store: оболочка не должна закешироваться, иначе браузер долго
// грузит старый app.js (а версия ассетов задаётся в index.html через ?v=).
// Сами ассеты можно кешировать надолго — их адрес меняется вместе с версией.
function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/index.html' : pathname;
  p = path.normalize(path.join(ROOT, p));
  if (!p.startsWith(ROOT)) return sendJSON(res, 403, { error: 'Forbidden' });
  fs.readFile(p, (err, buf) => {
    if (err) return sendJSON(res, 404, { error: 'Not found' });
    const ext = path.extname(p).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': buf.length };
    if (ext === '.html' || ext === '') {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    } else {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    res.writeHead(200, headers);
    res.end(buf);
  });
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ noServer: true });

function broadcastPresence(nick, value) {
  const friends = store.friendsOf(nick);
  const msg = { type: 'presence', nick: store.getUser(nick).name, online: value };
  for (const f of friends) sendTo(f.nick, msg);
}

wss.on('connection', (ws, req) => {
  const u = new URL(req.url, 'http://x');
  const user = store.userByToken(hashToken(u.searchParams.get('token') || ''));
  if (!user) { ws.close(4001, 'unauthorized'); return; }
  const nick = user.name;
  const wasOnline = onlineCount(nick) > 0;
  onlineAdd(nick, ws);
  ws.send(JSON.stringify({ type: 'hello', me: nick }));
  if (!wasOnline) broadcastPresence(nick, true);

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'typing' && msg.to) {
        sendTo(msg.to, { type: 'typing', nick });
      } else if (msg.type === 'voice-signal') {
        // ретрансляция WebRTC-сигнала конкретному sid (соединению) в звонке
        const to = String(msg.to || '');
        if (to) voiceSendSid(to, { type: 'voice-signal', from: ws._voiceSid, signal: msg.signal });
      } else if (msg.type === 'voice-screen') {
        // статус демонстрации экрана: комната узнаёт, у кого включена демка
        const key = ws._voiceKey;
        if (!key) return;
        voiceBroadcast(key, ws._voiceSid, { type: 'voice-screen', from: ws._voiceSid, on: !!msg.on });
      } else if (msg.type === 'voice') {
        const g = store.getGuild(String(msg.guildId || ''));
        if (!g) return;
        const ch = g.channels.find(c => c.id === String(msg.channelId || ''));
        if (!ch || ch.kind !== 'voice') return;
        if (!g.members.includes(normNick(nick))) return;
        const key = voiceRoomKey(g.id, ch.id);
        if (msg.action === 'join') {
          let room = voiceRooms.get(key);
          if (!room) { room = new Map(); voiceRooms.set(key, room); }
          const sid = 'v' + (voiceSeq++) + '_' + Date.now().toString(36);
          room.set(sid, normNick(nick));
          voiceSockets.set(sid, ws);
          ws._voiceKey = key;
          ws._voiceSid = sid;
          ws.send(JSON.stringify({
            type: 'voice-state', guildId: g.id, channelId: ch.id,
            state: 'joined', sid, peers: voicePeers(g.id, ch.id)
          }));
          voiceBroadcast(key, sid, {
            type: 'voice-state', guildId: g.id, channelId: ch.id,
            state: 'peer-joined', nick: normNick(nick), sid, peers: voicePeers(g.id, ch.id)
          });
        } else if (msg.action === 'leave') {
          const room = voiceRooms.get(key);
          const sid = ws._voiceSid;
          if (room) {
            room.delete(sid);
            if (!room.size) voiceRooms.delete(key);
          }
          voiceSockets.delete(sid);
          ws._voiceKey = null;
          ws._voiceSid = null;
          voiceBroadcast(key, sid, {
            type: 'voice-state', guildId: g.id, channelId: ch.id,
            state: 'peer-left', sid, peers: voicePeers(g.id, ch.id)
          });
          ws.send(JSON.stringify({
            type: 'voice-state', guildId: g.id, channelId: ch.id, state: 'left'
          }));
        }
      }
    } catch (e) { /* ignore */ }
  });

  ws.on('close', () => {
    onlineRemove(nick, ws);
    if (onlineCount(nick) === 0) broadcastPresence(nick, false);
    voiceLeaveSocket(ws);
  });
});

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    handleApi(req, res).catch(err => {
      const code = err.message === 'bad_json' ? 400 : err.message === 'body_too_large' ? 413 : 500;
      sendJSON(res, code, { error: err.message === 'bad_json' ? 'Неверный JSON' : err.message === 'body_too_large' ? 'Слишком большой запрос' : 'Внутренняя ошибка' });
    });
  } else {
    serveStatic(req, res, u.pathname);
  }
});

server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    }
  }
  console.log('Секретка запущена:');
  console.log('  Локально:   http://127.0.0.1:' + PORT);
  for (const ip of ips) console.log('  В сети LAN: http://' + ip + ':' + PORT);
  console.log('  Хранилище: ' + DATA_FILE);
});
