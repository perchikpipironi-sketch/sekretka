/*async*/
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(3000);
const q = s => document.querySelector(s);
const nick = localStorage.getItem('sk_nick');
const token = localStorage.getItem('sk_token');
let mePub = null, hasVault = null, vaultLen = null, vaultHttp = null;
try {
  const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });
  const j = await r.json();
  mePub = j.pub; hasVault = j.hasVault;
} catch (e) { mePub = 'ERR ' + e.message; }
try {
  const r = await fetch('/api/vault', { headers: { Authorization: 'Bearer ' + token } });
  vaultHttp = r.status;
  const j = await r.json();
  vaultLen = j.vault ? j.vault.length : 0;
} catch (e) { vaultHttp = 'ERR ' + e.message; }
return {
  nick, hasToken: !!token,
  slotKey: !!localStorage.getItem('sk_kp_' + String(nick || '').toLowerCase()),
  legacyKey: !!localStorage.getItem('sk_kp'),
  mePub, hasVault, vaultLen, vaultHttp,
  mainVisible: !!q('.main'),
  keyModalTitle: q('.modal h3') ? q('.modal h3').textContent : null,
  restoreGo: !!q('#restoreGo'),
  overlays: document.querySelectorAll('.overlay').length
};
