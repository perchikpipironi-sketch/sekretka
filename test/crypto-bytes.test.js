'use strict';
const SecCrypto = require('../public/js/crypto.js');

(async () => {
  const alice = SecCrypto.generateKeypair();
  const bob = SecCrypto.generateKeypair();
  const s1 = SecCrypto.sharedSecret(alice.secretKey, SecCrypto.publicB64(bob));
  const s2 = SecCrypto.sharedSecret(bob.secretKey, SecCrypto.publicB64(alice));
  const eq = s1.length === s2.length && s1.every((v, i) => v === s2[i]);
  console.log('shared equal:', eq);

  const data = new Uint8Array([1, 2, 3, 255, 0, 128, 7, 9, 42]);
  const env = await SecCrypto.sealBytes(s1, data, 'a|b');
  console.log('envelope b64 len:', env.length);

  const pt = await SecCrypto.openBytes(s2, env, 'a|b');
  const ok1 = pt && new Uint8Array(pt).length === data.length && new Uint8Array(pt).every((v, i) => v === data[i]);
  console.log('bytes roundtrip:', ok1);

  const bad = await SecCrypto.openBytes(s2, env, 'x|y');
  console.log('wrong aad -> null:', bad === null);

  const envU8 = SecCrypto.unb64(env);
  const pt2 = await SecCrypto.openBytes(s2, envU8, 'a|b');
  const ok2 = pt2 && new Uint8Array(pt2).every((v, i) => v === data[i]);
  console.log('raw bytes input open:', ok2);

  const tampered = envU8.slice();
  tampered[40] ^= 0xff;
  const pt3 = await SecCrypto.openBytes(s2, tampered, 'a|b');
  console.log('tampered -> null:', pt3 === null);

  process.exit(ok1 && ok2 && bad === null && pt3 === null && eq ? 0 : 1);
})();
