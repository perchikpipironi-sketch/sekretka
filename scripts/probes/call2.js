/*async*/
// Проба звонка с ДВУМЯ браузерами: каждый ждёт появления второго участника,
// проверяет смену статуса, остановку таймера ожидания и карточки участников.
const q = s => document.querySelector(s);
const wait = ms => new Promise(r => setTimeout(r, ms));

let panel = null;
for (let i = 0; i < 20 && !panel; i++) {
  panel = q('.call-panel');
  if (!panel) await wait(300);
}
if (!panel) {
  const done = q('#backupDone') || q('#backupSkip');
  if (done) { done.click(); await wait(1200); }
  if (typeof setView === 'function') { try { setView('guild'); } catch (e) {} }
  for (let i = 0; i < 20 && !panel; i++) {
    panel = q('.call-panel');
    if (!panel) await wait(300);
  }
}
if (!panel) return { panelMissing: true };

// ждём появления второго участника (карточка не-локального участника)
let sawPeer = false;
for (let i = 0; i < 25; i++) {
  if (document.querySelectorAll('#callVideos .call-video:not(.local)').length >= 1) { sawPeer = true; break; }
  await wait(400);
}
await wait(1500);

const nonSelf = document.querySelectorAll('#callVideos .call-video:not(.local)');
return {
  panel: !!panel,
  sawPeer,
  status: q('#callStatus') ? q('#callStatus').textContent : null,
  nonSelfVideos: nonSelf.length,
  peerNames: Array.from(nonSelf).map(b => b.querySelector('.call-name') ? b.querySelector('.call-name').textContent : null),
  timerVisible: !!q('#callWaitTimer'),
  timerText: q('#callWaitTimer') ? q('#callWaitTimer').textContent : null,
  localVideoStream: !!q('#callVideos .call-video.local video') && !!q('#callVideos .call-video.local video').srcObject,
  version: q('.rail-ver') ? q('.rail-ver').textContent : null
};
