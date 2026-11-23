/*async*/
// «Старый аккаунт»: ключ есть только на устройстве, конверта в аккаунте нет,
// пароля в памяти нет (?keysave=1). Должно появиться окно «Сохранить ключ в аккаунт».
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(900);

const nick = localStorage.getItem('sk_nick');
const token = localStorage.getItem('sk_token');
const localKey = localStorage.getItem('sk_kp_' + String(nick || '').toLowerCase());

let hasVault = null;
try {
  const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });
  hasVault = (await r.json()).hasVault;
} catch (e) { /* ignore */ }

const modal = document.querySelector('#vaultSaveModal');
const passIn = document.querySelector('#vaultPass');

// вариант А: «Позже» — окно закрывается, ничего не меняется
let afterLaterHasVault = null;
if (modal) {
  const later = document.querySelector('#vaultSaveLater');
  if (later) later.click();
  await sleep(700);
  afterLaterHasVault = (await (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } })).json()).hasVault;
}

// вариант Б: полное сохранение — вводим пароль и жмём «Сохранить ключ»
const modal2 = document.querySelector('#vaultSaveModal');
let savedOk = false, afterSaveHasVault = null, toastText = null;
if (modal2) {
  const pass = document.querySelector('#vaultPass');
  if (pass) pass.value = 'pass1234';
  const go = document.querySelector('#vaultSaveGo');
  if (go) go.click();
  await sleep(1200);
  afterSaveHasVault = (await (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } })).json()).hasVault;
  savedOk = afterSaveHasVault === true;
  const ts = Array.prototype.slice.call(document.querySelectorAll('#toasts *')).map(t => t.textContent);
  toastText = ts.join(' | ');
}

return {
  nick,
  localKey: !!localKey,
  hasVaultBefore: hasVault,
  modalShown: !!modal,
  hasPassField: !!passIn,
  afterLaterHasVault,
  afterSaveHasVault,
  savedOk,
  toastText,
  modalClosedAfterSave: !document.querySelector('#vaultSaveModal'),
  version: (document.querySelector('.rail-ver') || {}).textContent || null
};