#!/usr/bin/env node
'use strict';
/*
 * E2E «смена ключа»: если собеседник сменил ключ (например, на новом устройстве),
 * сервер при следующей отправке сообщения должен синхронизировать его публичный
 * ключ в записи дружбы — иначе получатель не сможет расшифровать новые сообщения.
 * Запуск: BASE=http://127.0.0.1:8099 node test/e2e-keysync.js
 */
const sec = require('../public/js/crypto.js');
const BASE = (process.env.BASE || 'http://127.0.0.1:8099').replace(/\/$/, '');
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

(async () => {
  const stamp = Date.now().toString(36).slice(-6);
  const A = 'ka_' + stamp, B = 'kb_' + stamp;
  const passA = 'passA1234', passB = 'passB1234';

  const regA = await req('POST', '/api/register', { nick: A, pass: passA });
  const regB = await req('POST', '/api/register', { nick: B, pass: passB });
  ok('регистрация A и B', regA.status === 200 && regB.status === 200);

  const kpA1 = sec.generateKeypair(), kpB = sec.generateKeypair();
  await req('PUT', '/api/me', { pub: sec.publicB64(kpA1) }, regA.data.token);
  await req('PUT', '/api/me', { pub: sec.publicB64(kpB) }, regB.data.token);

  await req('POST', '/api/friend/request', { nick: B }, regA.data.token);
  await req('POST', '/api/friend/accept', { nick: A }, regB.data.token);

  // B меняет ключ (как на новом устройстве) — без обновления дружбы
  const kpA2 = sec.generateKeypair();
  await req('PUT', '/api/me', { pub: sec.publicB64(kpA2) }, regA.data.token);

  const before = await req('GET', '/api/friends', null, regB.data.token);
  const oldPub = before.data.friends.find(f => f.nick.toLowerCase() === A.toLowerCase()).pub;
  ok('до отправки у B в друзьях старый pub A', oldPub === sec.publicB64(kpA1), { old: oldPub });

  // A (с НОВЫМ ключом) пишет B
  const aad = [A, B].sort().join('|');
  const sharedNew = sec.sharedSecret(kpA2.secretKey, sec.publicB64(kpB));
  const bodyMsg = await sec.sealMessage(sharedNew, 'привет после смены ключа', aad);
  const sent = await req('POST', '/api/msg', { to: B, body: bodyMsg }, regA.data.token);
  ok('A отправил сообщение', sent.status === 200, sent);

  // после отправки сервер обязан синхронизировать pub A в записи дружбы B
  const after = await req('GET', '/api/friends', null, regB.data.token);
  const newPub = after.data.friends.find(f => f.nick.toLowerCase() === A.toLowerCase()).pub;
  ok('после отправки у B новый pub A', newPub === sec.publicB64(kpA2), { got: newPub });

  // B читает это сообщение своим ключом и новым pub A
  const conv = await req('GET', '/api/conv/' + A + '?after=0', null, regB.data.token);
  const last = conv.data.msgs[conv.data.msgs.length - 1];
  const sharedB = sec.sharedSecret(kpB.secretKey, sec.publicB64(kpA2));
  const plain = await sec.openMessage(sharedB, last.body, aad);
  ok('B расшифровывает сообщение новым pub A', plain === 'привет после смены ключа', { plain });

  console.log('\ne2e-keysync: ' + pass + ' ok, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('e2e-keysync FAILED:', e.message); process.exit(2); });
