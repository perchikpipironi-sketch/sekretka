#!/usr/bin/env node
'use strict';
/*
 * Тест «хранилища ключа»: секретный ключ заворачивается паролем (PBKDF2 210k + AES-GCM)
 * и распаковывается только верным паролем. Так новое устройство получает историю,
 * а сервер остаётся с конвертом, который не может открыть.
 */
const assert = require('assert');
const sec = require('../public/js/crypto.js');

(async () => {
  const kp = sec.generateKeypair();
  const secret = sec.exportSecret(kp);
  const pass = 'моя-супер-пароль-42';

  const vault = await sec.wrapSecret(secret, pass);
  assert.ok(typeof vault === 'string' && vault.length >= 80, 'конверт должен быть непустой base64-строкой');

  const back = await sec.unwrapSecret(vault, pass);
  assert.strictEqual(back, secret, 'верный пароль -> та же отмычка');

  const kp2 = sec.keypairFromSecret(back);
  assert.strictEqual(sec.publicB64(kp2), sec.publicB64(kp), 'публичный ключ совпадает');

  assert.strictEqual(await sec.unwrapSecret(vault, 'другой-пароль'), null, 'неверный пароль -> null');
  assert.strictEqual(await sec.unwrapSecret('', pass), null, 'пустой конверт -> null');
  assert.strictEqual(await sec.unwrapSecret('AAAA', pass), null, 'мусор -> null');

  const idx = vault.length - 6;
  const flip = vault[idx] === 'A' ? 'B' : 'A';
  const tampered = vault.slice(0, idx) + flip + vault.slice(idx + 1);
  assert.strictEqual(await sec.unwrapSecret(tampered, pass), null, 'порча конверта -> null');

  const v1 = await sec.wrapSecret(secret, pass);
  const v2 = await sec.wrapSecret(secret, pass);
  assert.notStrictEqual(v1, v2, 'соль и IV должны быть случайными');

  const secret2 = sec.exportSecret(sec.generateKeypair());
  assert.notStrictEqual(await sec.unwrapSecret(await sec.wrapSecret(secret2, pass), pass), secret,
    'чужой секрет не превращается в наш');

  console.log('vault.test: ALL PASS (roundtrip, wrong-pass, tamper, random salt, чужой секрет)');
})().catch(e => { console.error('vault.test FAILED:', e.message); process.exit(1); });
