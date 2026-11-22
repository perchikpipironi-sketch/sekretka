// Сид: много сообщений в чат ui_girl/ui_boy (для проверки кнопки «вниз»)
const SecCrypto = require('../public/js/crypto.js');
const PORT = process.argv[2] || '8092';
const BASE = `http://127.0.0.1:${PORT}`;

async function api(method, p, body, token) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

(async () => {
  for (const n of ['ui_girl', 'ui_boy']) {
    try { await api('POST', '/api/register', { nick: n, pass: 'pass1234' }); }
    catch (e) { if (!String(e.message).includes('409')) throw e; }
  }
  const girl = await api('POST', '/api/login', { nick: 'ui_girl', pass: 'pass1234' });
  const boy = await api('POST', '/api/login', { nick: 'ui_boy', pass: 'pass1234' });
  const kpG = SecCrypto.generateKeypair(), kpB = SecCrypto.generateKeypair();
  await api('PUT', '/api/me', { pub: SecCrypto.publicB64(kpG) }, girl.token);
  await api('PUT', '/api/me', { pub: SecCrypto.publicB64(kpB) }, boy.token);
  try { await api('POST', '/api/friend/request', { nick: 'ui_girl' }, boy.token); } catch (e) {}
  try { await api('POST', '/api/friend/accept', { nick: 'ui_boy' }, girl.token); } catch (e) {}
  const shared = SecCrypto.sharedSecret(kpG.secretKey, SecCrypto.publicB64(kpB));
  const aad = ['ui_girl', 'ui_boy'].sort().join('|');
  for (let i = 1; i <= 30; i++) {
    const body = await SecCrypto.sealMessage(shared, `Сообщение #${i} — проверка прокрутки и кнопки «вниз». Ещё немного текста для длины.`, aad);
    await api('POST', '/api/msg', { to: 'ui_boy', body }, girl.token);
  }
  const conv = await api('GET', '/api/conv/ui_boy?after=0', null, girl.token);
  console.log('seeded msgs:', conv.msgs.length);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
