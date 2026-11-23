/*async*/
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 16; i++) {
  if (document.querySelector('#restoreGo')) break;
  await sleep(500);
}
const q = s => document.querySelector(s);
q('#restoreSkip').click();
let askShown = false, askText = null;
for (let i = 0; i < 16; i++) {
  await sleep(300);
  if (q('#askYes')) { askShown = true; askText = q('.modal p') ? q('.modal p').textContent : null; break; }
}
q('#askYes').click();
let mainVisible = false;
for (let i = 0; i < 24; i++) {
  await sleep(500);
  if (q('.main')) { mainVisible = true; break; }
}
return { askShown, askText, mainVisible, version: (q('.rail-ver') || {}).textContent || null };
