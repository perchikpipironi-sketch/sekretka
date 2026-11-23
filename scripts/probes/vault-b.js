/*async*/
// «Устройство 2»: профиль браузера пустой (ни ключа, ни localStorage), вход тем же
// именем и паролем (?t=ник|пароль&nokey=1). Ключ должен приехать из аккаунта,
// а история — расшифроваться.
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(500);

const nick = localStorage.getItem('sk_nick');
const token = localStorage.getItem('sk_token');
const slot = 'sk_kp_' + String(nick || '').toLowerCase();
const key = localStorage.getItem(slot);
const legacy = localStorage.getItem('sk_kp');

let vaultLen = null, hasVault = null;
try {
  const r = await fetch('/api/vault', { headers: { Authorization: 'Bearer ' + token } });
  vaultLen = (await r.json()).vault ? 1 : 0;
} catch (e) { /* ignore */ }
try {
  const r2 = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });
  hasVault = (await r2.json()).hasVault;
} catch (e) { /* ignore */ }

// ждём, пока откроется чат (?conv=...) и подтянется история
let bubbles = [], hint = '';
for (let i = 0; i < 12; i++) {
  await sleep(500);
  bubbles = Array.prototype.slice.call(document.querySelectorAll('#chatBody .msg-row .msg'))
    .map(el => (el.innerText || '').trim()).filter(Boolean);
  const body = document.querySelector('#chatBody');
  hint = body ? (body.innerText || '') : '';
  if (bubbles.length) break;
}

const modalOpen = !!document.querySelector('.overlay');
return {
  device: 2, nick,
  keyRestored: !!key, keyPrefix: key ? key.slice(0, 12) : null, keyLen: key ? key.length : 0,
  legacyKey: !!legacy, vaultLen, hasVault,
  bubbles, bubbleCount: bubbles.length,
  decryptedOk: bubbles.length > 0,
  notDecryptedHint: /не расшифровалась/i.test(hint),
  keyModalOpen: modalOpen,
  version: (document.querySelector('.rail-ver') || {}).textContent || null
};
