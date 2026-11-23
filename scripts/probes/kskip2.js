/*async*/
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 16; i++) {
  if (document.querySelector('#restoreGo')) break;
  await sleep(500);
}
const q = s => document.querySelector(s);
q('#restoreSkip').click();
let snap = null;
for (let i = 0; i < 30; i++) {
  await sleep(400);
  if (q('#askYes')) { snap = 'askYes'; break; }
  if (q('.main')) { snap = 'main'; break; }
  if (!q('.overlay')) { snap = 'no-overlay'; break; }
}
const h3s = Array.prototype.slice.call(document.querySelectorAll('.overlay .modal h3')).map(e => e.textContent);
const ps = Array.prototype.slice.call(document.querySelectorAll('.overlay .modal p')).map(e => e.textContent);
return {
  snap,
  overlays: document.querySelectorAll('.overlay').length,
  h3s,
  ps,
  askYes: !!q('#askYes'),
  restoreGo: !!q('#restoreGo'),
  restoreSkip: !!q('#restoreSkip'),
  main: !!q('.main'),
  version: (q('.rail-ver') || {}).textContent || null
};
