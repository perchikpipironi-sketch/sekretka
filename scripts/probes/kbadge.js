/*async*/
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 16; i++) {
  if (document.querySelector('#restoreGo')) break;
  await sleep(500);
}
const q = s => document.querySelector(s);
const title = q('.modal h3') ? q('.modal h3').textContent : null;
return {
  title,
  intro: q('.modal p') ? q('.modal p').textContent : null,
  hasGo: !!q('#restoreGo'),
  hasSkip: !!q('#restoreSkip'),
  goLabel: q('#restoreGo') ? q('#restoreGo').textContent : null,
  skipLabel: q('#restoreSkip') ? q('#restoreSkip').textContent : null,
  hasNew: !!q('#restoreNew'),
  hasRetry: !!q('#restoreRetry'),
  hasRestoreLink: !!q('#keyRestoreLink'),
  hasChangeKey: !!q('#changeKeyLink'),
  mainVisible: !!q('.main'),
  version: (q('.rail-ver') || {}).textContent || null
};
