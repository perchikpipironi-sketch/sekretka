#!/usr/bin/env node
'use strict';
/*
 * E2E API хранилища ключа: загрузка конверта, выдача, удаление, защита токеном.
 * Запуск: BASE=http://127.0.0.1:8099 node test/e2e-vault.js
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
  try { data = await res.json(); } catch (e) { /* пусто */ }
  return { status: res.status, data };
}

(async () => {
  const nick = 'vt_' + Date.now().toString(36).slice(-6);
  const pw = 'vault-pass-1234';

  const reg = await req('POST', '/api/register', { nick, pass: pw });
  ok('регистрация', reg.status === 200 && !!reg.data.token, reg);
  const token = reg.data.token;

  const empty = await req('GET', '/api/vault', null, token);
  ok('у нового аккаунта нет конверта', empty.status === 200 && empty.data.vault === null, empty);

  const kp = sec.generateKeypair();
  const vault = await sec.wrapSecret(sec.exportSecret(kp), pw);
  const saved = await req('POST', '/api/vault', { vault }, token);
  ok('конверт загружен', saved.status === 200 && saved.data.ok === true, saved);

  const got = await req('GET', '/api/vault', null, token);
  ok('конверт выдаётся как есть', got.data.vault === vault, { same: got.data.vault === vault });

  const secret = await sec.unwrapSecret(got.data.vault, pw);
  ok('конверт распаковывается паролем в тот же ключ', secret === sec.exportSecret(kp));

  const wrong = await sec.unwrapSecret(got.data.vault, 'не-тот-пароль');
  ok('чужой пароль конверт не открывает', wrong === null);

  const me = await req('GET', '/api/me', null, token);
  ok('GET /api/me отдаёт ник, pub и наличие конверта', me.status === 200 && me.data.nick === nick && me.data.hasVault === true, me);

  const pub = sec.publicB64(kp);
  const put = await req('PUT', '/api/me', { pub }, token);
  ok('публичный ключ сохранён', put.status === 200, put);
  const me2 = await req('GET', '/api/me', null, token);
  ok('pub читается обратно', me2.data.pub === pub);

  const bad = await req('POST', '/api/vault', { vault: 'AAA' }, token);
  ok('слишком короткий конверт отклонён (400)', bad.status === 400, bad);

  const noTok = await req('GET', '/api/vault');
  ok('без токена 401', noTok.status === 401, noTok);

  const del = await req('DELETE', '/api/vault', null, token);
  ok('конверт удаляется', del.status === 200 && del.data.ok === true, del);
  const after = await req('GET', '/api/vault', null, token);
  ok('после удаления пусто', after.data.vault === null);
  ok('hasVault сброшен', (await req('GET', '/api/me', null, token)).data.hasVault === false);

  console.log('\ne2e-vault: ' + pass + ' ok, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('e2e-vault FAILED:', e.message); process.exit(1); });
