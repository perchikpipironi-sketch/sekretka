/*async*/
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 16; i++) {
  if (document.querySelector('#restoreGo')) break;
  await sleep(500);
}
const q = s => document.querySelector(s);
q('#restoreBox').value = '@@@ не base64 @@@';
q('#restoreGo').click();
await sleep(1200);
return {
  modalStill: !!q('#restoreGo'),
  mainVisible: !!q('.main'),
  toast: (q('.toasts') || { innerText: '' }).innerText
};
