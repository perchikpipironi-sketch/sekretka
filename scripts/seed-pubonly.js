// Сид: аккаунт с ПУБЛИЧНЫМ ключом, но БЕЗ конверта (vault) — для теста плашки «Ключ от этого аккаунта».
// Использование: node scripts/seed-pubonly.js <port> [nick]
const http = require('http');
const crypto = require('../public/js/crypto.js');

const PORT = process.argv[2] || '8099';
const NICK = process.argv[3] || 'kvpub';
const PASS = 'pass1234';
const BASE = `http://127.0.0.1:${PORT}`;

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(BASE + path);
    const r = http.request(u, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(data ? { 'content-length': Buffer.byteLength(data) } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {})
      }
    }, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(chunks); } catch (e) {}
        resolve({ status: res.statusCode, json: j });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  // регистрация (если уже есть — логин)
  let r = await req('POST', '/api/register', { nick: NICK, pass: PASS });
  if (r.status !== 200 && r.status !== 409) { console.error('register fail', r.status, r.json); process.exit(1); }
  r = await req('POST', '/api/login', { nick: NICK, pass: PASS });
  if (r.status !== 200) { console.error('login fail', r.status, r.json); process.exit(1); }
  const token = r.json.token;

  const kp = crypto.generateKeypair();
  const pub = crypto.publicB64(kp);
  r = await req('PUT', '/api/me', { pub }, token);
  if (r.status !== 200) { console.error('put pub fail', r.status, r.json); process.exit(1); }

  // удостовериться, что конверта нет
  r = await req('GET', '/api/vault', null, token);
  const hasVault = r.status === 200 && !!r.json.vault;

  console.log(JSON.stringify({ nick: NICK, pub, secret: crypto.exportSecret(kp), hasVault }));
})();
