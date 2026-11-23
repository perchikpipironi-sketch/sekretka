/*async*/
const wait = ms => new Promise(r => setTimeout(r, ms));
// ждём сообщения и крестики
let dels = [];
for (let i = 0; i < 20; i++) {
  dels = Array.from(document.querySelectorAll('.msg-row.mine .msg-del'));
  if (dels.length) break;
  await wait(500);
}
const beforeCount = document.querySelectorAll('#chatBody .msg-row').length;
const delInfo = dels.length ? {
  count: dels.length,
  visible: getComputedStyle(dels[0]).opacity !== '0',
  rect: (() => {
    const r = dels[0].getBoundingClientRect();
    const bubble = dels[0].closest('.msg');
    const b = bubble ? bubble.getBoundingClientRect() : null;
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      leftOfBubble: b ? r.right <= b.left + 2 : null
    };
  })()
} : null;
// кликаем первый крестик и подтверждаем
let afterCount = beforeCount;
let error = null;
if (dels.length) {
  dels[0].click();
  await wait(400);
  const yes = document.getElementById('askYes');
  if (yes) {
    yes.click();
    await wait(800);
    afterCount = document.querySelectorAll('#chatBody .msg-row').length;
  } else {
    error = 'no askYes';
  }
} else {
  error = 'no .msg-del found';
}
return { beforeCount, afterCount, delInfo, error, ver: document.body.textContent.includes('v32') ? 'v32' : '?' };
