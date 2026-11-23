/*async*/
// «Устройство 1»: свежая регистрация (?t=ник|пароль&fresh=1) — создаётся ключ,
// конверт ключа уезжает в аккаунт, показывается окно бэкапа. Закрываем его и отчитываемся.
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(500);

const modalShown = !!document.querySelector('.overlay .key-box');
const doneBtn = document.querySelector('#backupDone');
if (doneBtn) doneBtn.click();
await sleep(1500);

const nick = localStorage.getItem('sk_nick');
const token = localStorage.getItem('sk_token');
const key = localStorage.getItem('sk_kp_' + String(nick || '').toLowerCase());

let vaultLen = null, vaultErr = null, serverPub = null, hasVault = null;
try {
  const r = await fetch('/api/vault', { headers: { Authorization: 'Bearer ' + token } });
  const j = await r.json();
  vaultLen = j.vault ? j.vault.length : 0;
} catch (e) { vaultErr = String(e && e.message || e); }
try {
  const r2 = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });
  const j2 = await r2.json();
  serverPub = j2.pub; hasVault = j2.hasVault;
} catch (e) { /* ignore */ }

return {
  device: 1, nick, modalShown, backupClosed: !!doneBtn,
  keyPrefix: key ? key.slice(0, 12) : null, keyLen: key ? key.length : 0,
  vaultLen, vaultErr, hasVault, pubPrefix: serverPub ? serverPub.slice(0, 12) : null,
  mainVisible: !!document.querySelector('.rail'),
  version: (document.querySelector('.rail-ver') || {}).textContent || null
};
