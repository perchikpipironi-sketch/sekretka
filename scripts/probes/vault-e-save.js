/*async*/
// «Старый аккаунт» без конверта + пароля в памяти (?keysave=1): появляется окно
// «Сохранить ключ в аккаунт». Сразу вводим пароль и жмём «Сохранить ключ».
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(900);

const nick = localStorage.getItem('sk_nick');
const token = localStorage.getItem('sk_token');
const localKey = localStorage.getItem('sk_kp_' + String(nick || '').toLowerCase());

const hasVaultNow = async () => (await (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } })).json()).hasVault;
const vaultBefore = await hasVaultNow();

const modal = document.querySelector('#vaultSaveModal');
const passIn = document.querySelector('#vaultPass');
const go = document.querySelector('#vaultSaveGo');

if (passIn) passIn.value = 'pass1234';
if (go) go.click();
await sleep(1400);

const afterSave = await hasVaultNow();
const toasts = Array.prototype.slice.call(document.querySelectorAll('#toasts *')).map(t => t.textContent).join(' | ');

return {
  nick,
  localKey: !!localKey,
  modalShown: !!modal,
  hasPassField: !!passIn,
  vaultBefore,
  afterSave,
  savedOk: afterSave === true,
  modalClosed: !document.querySelector('#vaultSaveModal'),
  toastText: toasts,
  version: (document.querySelector('.rail-ver') || {}).textContent || null
};