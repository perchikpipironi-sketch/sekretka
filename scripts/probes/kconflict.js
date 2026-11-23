/*async*/
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 16; i++) {
  if (document.querySelector('#restoreGo')) break;
  await sleep(500);
}
const q = s => document.querySelector(s);
q('#restoreBox').value = 'TFmovLbAoSkeODoAYx/sH7KFLprgVnRowXqN2fKL9so=';
q('#restoreGo').click();
let askShown = false, askText = null, mainVisible = false;
for (let i = 0; i < 20; i++) {
  await sleep(400);
  if (q('#askYes')) {
    askShown = true;
    const m = q('.overlay .modal p');
    askText = m ? m.textContent : null;
    q('#askYes').click();
    for (let j = 0; j < 20; j++) { await sleep(300); if (q('.main')) { mainVisible = true; break; } }
    break;
  }
  if (q('.main')) { mainVisible = true; break; }
}
return { askShown, askText, mainVisible, version: (q('.rail-ver') || {}).textContent || null };
