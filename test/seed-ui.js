'use strict';
/* Подготовка данных для UI-проверки: ui_girl/ui_boy + текст + файл. */
const SecCrypto = require('../public/js/crypto.js');
const BASE = 'http://127.0.0.1:8090';

async function api(method, p, body, token) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } };
  if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + p, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(method + ' ' + p + ' -> ' + res.status + ' ' + JSON.stringify(data));
  return data;
}

(async () => {
  const reg = async n => { try { await api('POST', '/api/register', { nick: n, pass: 'pass1234' }); } catch (e) { if (!/409/.test(e.message)) throw e; } };
  await reg('ui_girl');
  await reg('ui_boy');
  const girl = await api('POST', '/api/login', { nick: 'ui_girl', pass: 'pass1234' });
  const boy = await api('POST', '/api/login', { nick: 'ui_boy', pass: 'pass1234' });
  const kpG = SecCrypto.generateKeypair(), kpB = SecCrypto.generateKeypair();
  await api('PUT', '/api/me', { pub: SecCrypto.publicB64(kpG) }, girl.token);
  await api('PUT', '/api/me', { pub: SecCrypto.publicB64(kpB) }, boy.token);
  let gf = (await api('GET', '/api/friends', null, girl.token)).friends;
  if (!gf.some(x => x.nick === 'ui_boy')) {
    try { await api('POST', '/api/friend/request', { nick: 'ui_girl' }, boy.token); } catch (e) { if (!/Заявка|друзья/.test(e.message)) throw e; }
    const reqs = await api('GET', '/api/friend/requests', null, girl.token);
    if (reqs.incoming.some(r => r.nick === 'ui_boy')) await api('POST', '/api/friend/accept', { nick: 'ui_boy' }, girl.token);
    gf = (await api('GET', '/api/friends', null, girl.token)).friends;
  }
  const f = gf.find(x => x.nick === 'ui_boy');
  const shared = SecCrypto.sharedSecret(kpG.secretKey, SecCrypto.publicB64(kpB));
  const aad = 'ui_boy|ui_girl';
  const send = async (to, text) => {
    const body = await SecCrypto.sealMessage(shared, text, aad);
    await api('POST', '/api/msg', { to, body }, girl.token);
  };
  await send('ui_boy', 'Привет! Это файлы 📎');
  // реальный маленький PNG 1x1
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const sealedFile = await SecCrypto.sealBytes(shared, png, aad);
  const up = await api('POST', '/api/media', { to: 'ui_boy', name: 'pic.png', mime: 'image/png', size: png.length, b64: sealedFile }, girl.token);
  const metaBody = JSON.stringify({ t: 'file', id: up.id, n: 'pic.png', m: 'image/png', s: up.size });
  await send('ui_boy', metaBody);
  await send('ui_boy', 'А это видео-файл 🎬');
  const avi = Buffer.from('FAKE-VIDEO-DATA-1234567890');
  const sealedVid = await SecCrypto.sealBytes(shared, avi, aad);
  const upv = await api('POST', '/api/media', { to: 'ui_boy', name: 'clip.mp4', mime: 'video/mp4', size: avi.length, b64: sealedVid }, girl.token);
  const metaVid = JSON.stringify({ t: 'file', id: upv.id, n: 'clip.mp4', m: 'video/mp4', s: upv.size });
  await send('ui_boy', metaVid);
  console.log('UI seed done');
})();
