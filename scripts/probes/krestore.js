/*async*/
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 16; i++) {
  if (document.querySelector('#restoreGo')) break;
  await sleep(500);
}
const q = s => document.querySelector(s);
q('#restoreBox').value = 'EHE3YJDxjTMR0ICzL+cafPVI8YmexZOoxhT/+2kIa4Y=';
q('#restoreGo').click();
let mainVisible = false, askShown = false, modalStill = true;
for (let i = 0; i < 24; i++) {
  await sleep(500);
  askShown = askShown || !!q('#askYes');
  if (q('.main')) { mainVisible = true; break; }
  if (!q('#restoreGo') && !q('.main')) { modalStill = false; break; }
}
return {
  mainVisible,
  askShown,
  modalStill,
  hasGoAfter: !!q('#restoreGo'),
  version: (q('.rail-ver') || {}).textContent || null
};
