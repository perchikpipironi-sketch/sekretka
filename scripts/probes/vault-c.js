/*async*/
// Проверка «нет хранилища, нет локального ключа»: приложение НЕ должно молча
// подменять ключ. Оно обязано показать окно ввода отмычки с понятным текстом.
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(1200);

const nick = localStorage.getItem('sk_nick');
const token = localStorage.getItem('sk_token');
const localKey = localStorage.getItem('sk_kp_' + String(nick || '').toLowerCase());

let hasVault = null, serverPub = null;
try {
  const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });
  const j = await r.json();
  hasVault = j.hasVault; serverPub = j.pub;
} catch (e) { /* ignore */ }

const ov = document.querySelector('.overlay');
const modalText = ov ? (ov.innerText || '') : '';
const mainVisible = !!document.querySelector('.rail');

return {
  nick, localKey: !!localKey, hasVault, pubPrefix: serverPub ? serverPub.slice(0, 12) : null,
  keyModalOpen: !!ov,
  modalMentionsMissing: /не нашл|нет ключа|отмычк/i.test(modalText),
  hasRestoreBox: !!document.querySelector('#restoreBox'),
  hasRestoreRetry: !!document.querySelector('#restoreRetry'),
  intro: modalText.split('\n').filter(Boolean).slice(0, 4),
  mainVisible
};
