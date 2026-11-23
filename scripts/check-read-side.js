#!/usr/bin/env node
'use strict';
/*
 * Проверка «старое устройство читает новое»: с точки зрения bob'а читаем диалог
 * с vuser и расшифровываем ПОСЛЕДНЕЕ сообщение ключом bob'а и публичным ключом
 * vuser из аккаунта. Если vuser отправил что-то С НОВОГО устройства (тот же ключ,
 * что лёг в конверт), здесь оно обязано прочитаться.
 *
 * Запуск: BOB_SECRET=<секрет bob> node scripts/check-read-side.js <base> <bob> <bob_pass> <vuser> [ожидаемый текст]
 */
const sec = require('../public/js/crypto.js');
const BASE = (process.argv[2] || 'http://127.0.0.1:8099').replace(/\/$/, '');
const BOB = process.argv[3] || 'bob';
const BOB_PASS = process.argv[4] || 'bobpass1234';
const VUSER = process.argv[5] || 'vuser';
const EXPECTED = process.argv[6];
const BOB_SECRET = process.env.BOB_SECRET || null;

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(path + ' -> ' + res.status + ' ' + JSON.stringify(data));
  return data;
}

(async () => {
  const bob = await req('POST', '/api/login', { nick: BOB, pass: BOB_PASS });
  // ключ bob'а должен быть ТЕМ ЖЕ, что при его первом входе (эмуляция «старого устройства»)
  const bobKp = BOB_SECRET
    ? sec.keypairFromSecret(BOB_SECRET)
    : sec.generateKeypair();

  // публичный ключ vuser из его аккаунта — тот, что должен совпадать с ключом
  // «первого устройства» (т.е. с ключом, которым шифровала новое устройство)
  const me = await req('GET', '/api/me', null, bob.token);
  const vinfo = await req('GET', '/api/me', null, (await req('POST', '/api/login', { nick: VUSER, pass: 'vpass1234' })).token);
  const vpub = vinfo.pub;
  if (!vpub) throw new Error('у ' + VUSER + ' нет публичного ключа в аккаунте');

  const aad = [BOB, VUSER].sort().join('|');
  const shared = sec.sharedSecret(bobKp.secretKey, vpub);

  const conv = await req('GET', '/api/conv/' + VUSER + '?after=0', null, bob.token);
  const msgs = conv.msgs || [];
  if (!msgs.length) throw new Error('диалог пуст');

  const last = msgs[msgs.length - 1];
  const plain = await sec.openMessage(shared, last.body, aad);
  const ok = plain !== null;

  console.log(JSON.stringify({
    ok,
    base: BASE,
    as: BOB, with: VUSER,
    vuserPubPrefix: vpub.slice(0, 12),
    lastFrom: last.from,
    lastTs: last.ts,
    decrypted: plain || null,
    expectedFor: EXPECTED || null,
    matchesExpected: EXPECTED ? plain === EXPECTED : null,
    total: msgs.length
  }, null, 2));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('check-read-side FAILED:', e.message); process.exit(2); });
