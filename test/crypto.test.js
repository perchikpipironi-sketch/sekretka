'use strict';
const assert = require('assert');
const Sec = require('../public/js/crypto.js');

(async () => {
  const a = Sec.generateKeypair();
  const b = Sec.generateKeypair();

  const shAB = Sec.sharedSecret(a.secretKey, Sec.publicB64(b));
  const shBA = Sec.sharedSecret(b.secretKey, Sec.publicB64(a));
  assert.strictEqual(Buffer.from(shAB).toString('hex'), Buffer.from(shBA).toString('hex'), 'shared secrets equal');

  const aad = 'demo_alice|demo_bob';
  const payloads = [
    'привет, Секретка! 🎉',
    'тест с эмодзи и кириллицей: ё, ж, щ',
    'line1\nline2\ttab   spaced',
    'a'.repeat(5000)
  ];
  for (const m of payloads) {
    const env = await Sec.sealMessage(shAB, m, aad);
    assert.strictEqual(typeof env, 'string');
    assert.ok(env.length > 40);
    const pt = await Sec.openMessage(shBA, env, aad);
    assert.strictEqual(pt, m, 'roundtrip: ' + m.slice(0, 30));
  }

  const env2 = await Sec.sealMessage(shAB, 'тайна', aad);
  assert.strictEqual(await Sec.openMessage(shBA, env2, 'other|conv'), null, 'wrong aad rejected');

  const raw = Sec.unb64(env2);
  raw[raw.length - 3] ^= 0x40;
  assert.strictEqual(await Sec.openMessage(shBA, Sec.b64(raw), aad), null, 'tampered rejected');

  const secretB64 = Sec.exportSecret(a);
  const a2 = Sec.keypairFromSecret(secretB64);
  assert.strictEqual(Sec.publicB64(a2), Sec.publicB64(a), 'derived public key matches');

  console.log('OK crypto: shared, roundtrip x' + payloads.length + ', aad, tamper, export/import');
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
