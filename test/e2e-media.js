'use strict';
/* E2E: дружба + текст + медиа. Адрес сервера: BASE=<url> или http://127.0.0.1:8090 */
const SecCrypto = require('../public/js/crypto.js');

const BASE = process.env.BASE || 'http://127.0.0.1:8090';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, p, body, token) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    }
  };
  if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + p, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(method + ' ' + p + ' -> ' + res.status + ' ' + JSON.stringify(data));
  return { status: res.status, data };
}

(async () => {
  let fails = 0;
  const check = (name, cond) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + name);
    if (!cond) fails++;
  };

  await sleep(400);

  // 1. регистрация (409 = уже зарегистрирован с прошлого прогона — ок)
  const reg = async n => { try { await api('POST', '/api/register', { nick: n, pass: 'pass1234' }); } catch (e) { if (!/409/.test(e.message)) throw e; } };
  await reg('testgirl');
  await reg('testboy');
  await reg('testzombie');
  const girl = (await api('POST', '/api/login', { nick: 'testgirl', pass: 'pass1234' })).data;
  const boy = (await api('POST', '/api/login', { nick: 'testboy', pass: 'pass1234' })).data;
  const zombie = (await api('POST', '/api/login', { nick: 'testzombie', pass: 'pass1234' })).data;
  check('login tokens', !!girl.token && !!boy.token && !!zombie.token);

  // 2. ключи (X25519)
  const kpG = SecCrypto.generateKeypair(), kpB = SecCrypto.generateKeypair(), kpZ = SecCrypto.generateKeypair();
  await api('PUT', '/api/me', { pub: SecCrypto.publicB64(kpG) }, girl.token);
  await api('PUT', '/api/me', { pub: SecCrypto.publicB64(kpB) }, boy.token);
  await api('PUT', '/api/me', { pub: SecCrypto.publicB64(kpZ) }, zombie.token);

  // 3. дружба (идемпотентно)
  let gf = (await api('GET', '/api/friends', null, girl.token)).data.friends;
  if (!gf.some(x => x.nick === 'testboy')) {
    try { await api('POST', '/api/friend/request', { nick: 'testgirl' }, boy.token); }
    catch (e) { if (!/Заявка|друзья/.test(e.message)) throw e; }
    let reqs = (await api('GET', '/api/friend/requests', null, girl.token)).data;
    if (reqs.incoming.some(r => r.nick === 'testboy')) await api('POST', '/api/friend/accept', { nick: 'testboy' }, girl.token);
    gf = (await api('GET', '/api/friends', null, girl.token)).data.friends;
  }
  check('friends list', gf.some(x => x.nick === 'testboy' && x.pub));

  // 4. зашифрованный текст (roundtrip через сервер)
  const sharedG = SecCrypto.sharedSecret(kpG.secretKey, SecCrypto.publicB64(kpB));
  const sharedB = SecCrypto.sharedSecret(kpB.secretKey, SecCrypto.publicB64(kpG));
  const aad = 'testboy|testgirl';
  const sealedText = await SecCrypto.sealMessage(sharedG, 'Привет, файл уже летит! 📦', aad);
  const msg = (await api('POST', '/api/msg', { to: 'testboy', body: sealedText }, girl.token)).data;
  check('msg id', typeof msg.id === 'number');
  const conv = (await api('GET', '/api/conv/testgirl?after=0', null, boy.token)).data;
  const opened = await SecCrypto.openMessage(sharedB, conv.msgs[conv.msgs.length - 1].body, aad);
  check('msg decrypt by boy', opened === 'Привет, файл уже летит! 📦');

  // 5. медиа: загрузка + скачивание + чужой без доступа
  const fileBytes = Buffer.from('HELLO-SEKRETKA-FILE-0123456789-IMAGE-PNG-BYTES');
  const sealedFile = await SecCrypto.sealBytes(sharedG, fileBytes, aad);
  const up = (await api('POST', '/api/media', {
    to: 'testboy', name: 'pic.png', mime: 'image/png', size: fileBytes.length, b64: sealedFile
  }, girl.token)).data;
  check('media upload id', !!up.id);
  const dl = await fetch(BASE + '/api/media/' + up.id, { headers: { Authorization: 'Bearer ' + boy.token } });
  const dlBuf = Buffer.from(await dl.arrayBuffer());
  check('media download = envelope bytes', dlBuf.equals(Buffer.from(sealedFile, 'base64')));
  const dec = await SecCrypto.openBytes(sharedB, dlBuf, aad);
  check('media decrypt', dec && Buffer.from(dec).equals(fileBytes));
  const z = await fetch(BASE + '/api/media/' + up.id, { headers: { Authorization: 'Bearer ' + zombie.token } });
  check('media forbidden for non-friend', z.status === 403);

  // 6. сообщение-файл (метаданные внутри зашифрованного текста)
  const metaBody = JSON.stringify({ t: 'file', id: up.id, n: 'pic.png', m: 'image/png', s: fileBytes.length });
  const sealedMeta = await SecCrypto.sealMessage(sharedG, metaBody, aad);
  await api('POST', '/api/msg', { to: 'testboy', body: sealedMeta }, girl.token);
  const conv2 = (await api('GET', '/api/conv/testgirl?after=0', null, boy.token)).data;
  const opened2 = await SecCrypto.openMessage(sharedB, conv2.msgs[conv2.msgs.length - 1].body, aad);
  const parsed = JSON.parse(opened2);
  check('file meta json', parsed.t === 'file' && parsed.id === up.id && parsed.m === 'image/png');

  // 7. неавторизованные попытки
  const unauth = await fetch(BASE + '/api/media/' + up.id);
  check('media unauth -> 401', unauth.status === 401);

  // 8. большой JSON не проходит в обычном сообщении (ограничение осталось)
  const big = await fetch(BASE + '/api/msg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + girl.token },
    body: JSON.stringify({ to: 'testboy', body: 'A'.repeat(50000) })
  });
  check('oversized msg rejected', big.status === 400);

  console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES');
  process.exit(fails === 0 ? 0 : 1);
})();
