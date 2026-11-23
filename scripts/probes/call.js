/*async*/
// Проба голосового канала: панель звонка, ожидание, таймер, кнопки, локальное видео.
// Запуск: node scripts/probe.js --url "http://127.0.0.1:8099/?t=call_girl|pass1234&view=guild" --w 1440 --h 900 --fake-media 1 --eval scripts/probes/call.js --wait 7000
const q = s => document.querySelector(s);
const wait = ms => new Promise(r => setTimeout(r, ms));

let panel = null;
for (let i = 0; i < 20 && !panel; i++) {
  panel = q('.call-panel');
  if (!panel) await wait(300);
}
// на свежем профиле может открыться окно бэкапа ключа — закрываем (кнопка «Я сохранил(а)»)
if (!panel) {
  const done = q('#backupDone') || q('#backupSkip');
  if (done) { done.click(); await wait(1200); }
  // ветка ?fresh=1 останавливается на модалке и не применяет ?view=guild — применяем сами
  if (typeof setView === 'function') { try { setView('guild'); } catch (e) {} }
  for (let i = 0; i < 20 && !panel; i++) {
    panel = q('.call-panel');
    if (!panel) await wait(300);
  }
}
if (!panel) return { panelMissing: true, version: q('.rail-ver') ? q('.rail-ver').textContent : null };

const status = q('#callStatus') ? q('#callStatus').textContent : null;
const timer = q('#callWaitTimer') ? q('#callWaitTimer').textContent : null;
const mic = q('#callMic');
const cam = q('#callCam');
const screen = q('#callScreen');
const leave = q('#callLeave');
const localVideo = q('#callVideos .call-video.local video');

let streamReady = !!(localVideo && localVideo.srcObject && localVideo.srcObject.getTracks().length);
for (let i = 0; i < 10 && !streamReady; i++) {
  await wait(300);
  streamReady = !!(localVideo && localVideo.srcObject && localVideo.srcObject.getTracks().length);
}

return {
  callPanel: true,
  status: status,
  timer: timer,
  timerStarts15m: !!timer && timer.indexOf('15:') === 0,
  micOn: !!(mic && mic.classList.contains('on')),
  camExists: !!cam,
  screenExists: !!screen,
  leaveExists: !!leave,
  localVideo: !!localVideo,
  streamReady: streamReady,
  videoTracks: localVideo && localVideo.srcObject ? localVideo.srcObject.getTracks().map(t => t.kind) : [],
  composerHidden: q('#chatInput') ? q('#chatInput').style.display === 'none' : null,
  version: q('.rail-ver') ? q('.rail-ver').textContent : null
};
