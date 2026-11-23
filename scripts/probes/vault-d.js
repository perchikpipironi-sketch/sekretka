/*async*/
// «Устройство 2» (телефон): вход с пустым профилем, ключ подтягивается из аккаунта,
// история расшифровывается. Затем отправляем ПИСЬМО от имени этого же аккаунта —
// оно должно быть зашифровано ТЕМ ЖЕ ключом и читаться на «старом» устройстве.
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(900);

const nick = localStorage.getItem('sk_nick');
const token = localStorage.getItem('sk_token');
const slot = 'sk_kp_' + String(nick || '').toLowerCase();
const key = localStorage.getItem(slot);

let bubbles = [];
for (let i = 0; i < 12; i++) {
  await sleep(500);
  bubbles = Array.prototype.slice.call(document.querySelectorAll('#chatBody .msg-row .msg'))
    .map(el => (el.innerText || '').trim()).filter(Boolean);
  if (bubbles.length) break;
}

// отправка от имени этого устройства (частный ключ устройства 2 / = тот же ключ аккаунта)
const sendText = 'Ответ с нового устройства 📱 — читается на старом?';
const inp = document.querySelector('#msgInput');
const btn = document.querySelector('#sendBtn');
const sendOk = !!(inp && btn);
if (sendOk) {
  inp.value = sendText;
  btn.click();
}
await sleep(1800);
const afterSend = Array.prototype.slice.call(document.querySelectorAll('#chatBody .msg-row .msg'))
  .map(el => (el.innerText || '').trim()).filter(Boolean);

return {
  device: 2,
  nick,
  keyRestored: !!key,
  keyPrefix: key ? key.slice(0, 12) : null,
  receivedBubbles: bubbles,
  receivedCount: bubbles.length,
  sendBoxPresent: sendOk,
  sentText: sendText,
  afterSendCount: afterSend.length,
  sentVisible: afterSend.includes(sendText),
  version: (document.querySelector('.rail-ver') || {}).textContent || null
};