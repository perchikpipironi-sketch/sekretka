/*async*/
// Проверка подсказки на экране входа: пользователь должен понимать, что ключ лежит
// в аккаунте и история подтянется на новом устройстве после входа по паролю.
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(600);

const note = document.querySelector('.auth-note');
const panel = document.querySelector('.auth-panel');
let minFont = 99;
if (panel) {
  Array.prototype.forEach.call(panel.querySelectorAll('*'), el => {
    const s = parseFloat(getComputedStyle(el).fontSize);
    if (s && s < minFont) minFont = s;
  });
}
const ov = document.querySelector('.overlay');

return {
  authScreen: !!document.querySelector('#authGo'),
  noteShown: !!note,
  noteText: note ? note.innerText : null,
  minFontPx: minFont,
  overlayOpen: !!ov,
  version: (document.querySelector('.auth-ver') || {}).textContent || null,
  heroVisible: !!document.querySelector('.auth-hero')
};