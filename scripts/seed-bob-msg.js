#!/usr/bin/env node
'use strict';
/*
 * Сид для проверки «история на другом устройстве»:
 * делает bob другом vuser и отправляет ему зашифрованное сообщение на ТОТ публичный
 * ключ, который лежит в аккаунте vuser (его выложило «первое устройство»).
 * Запуск: node scripts/seed-bob-msg.js <base> <vuser> <vpass> [текст]
 */
const sec = require('../public/js/crypto.js');

const BASE = (process.argv[2] || 'http://127.0.0.1:8099').replace(/\/$/, '');
const VUSER = process.argv[3] || 'vuser';
const VPASS = process.argv[4] || 'vpass1234';
const TEXT = process.argv[5] || 'Привет с другого устройства 🔐 (это сообщение зашифровано на твой ключ)';

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* пусто */ }
  if (!res.ok) { const err = new Error((data && data.error) || ('HTTP ' + res.status)); err.status = res.status; throw err; }
  return data;
}

async function login(nick, pass) {
  try { return await req('POST', '/api/login', { nick, pass }); }
  catch (e) {
    if (e.status !== 401 && e.status !== 404) throw e;
    return await req('POST', '/api/register', { nick, pass });
  }
}

(async () => {
  const bobNick = 'bob' + Date.now().toString(36).slice(-5);
  const bobPass = 'bobpass1234';

  const bob = await login(bobNick, bobPass);
  const kpBob = sec.generateKeypair();
  const bobSecret = sec.exportSecret(kpBob);
  await req('PUT', '/api/me', { pub: sec.publicB64(kpBob) }, bob.token);

  const vuserTok = (await login(VUSER, VPASS)).token;

  // дружба
  try { await req('POST', '/api/friend/request', { nick: VUSER }, bob.token); } catch (e) { /* уже */ }
  const reqs = await req('GET', '/api/friend/requests', null, vuserTok);
  if ((reqs.incoming || []).some(r => r.nick.toLowerCase() === bobNick.toLowerCase())) {
    await req('POST', '/api/friend/accept', { nick: bobNick }, vuserTok);
  }

  const friends = await req('GET', '/api/friends', null, bob.token);
  const friend = (friends.friends || []).find(f => f.nick.toLowerCase() === VUSER.toLowerCase());
  if (!friend || !friend.pub) throw new Error('у ' + VUSER + ' нет публичного ключа в аккаунте — сначала прогони «первое устройство»');

  const aad = [bobNick, VUSER].sort().join('|');
  const shared = sec.sharedSecret(kpBob.secretKey, friend.pub);
  const body = await sec.sealMessage(shared, TEXT, aad);
  await req('POST', '/api/msg', { to: VUSER, body }, bob.token);

  console.log(JSON.stringify({
    ok: true, bob: bobNick, bobSecret, to: VUSER, text: TEXT,
    vuserPubPrefix: friend.pub.slice(0, 12), aad
  }));
})().catch(e => { console.error('seed-bob-msg FAILED:', e.message); process.exit(1); });
