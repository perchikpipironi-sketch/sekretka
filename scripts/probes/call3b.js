/*async*/
const wait = ms => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);
for (let i = 0; i < 30; i++) {
  if (window.state && state.guilds && state.guilds.length) break;
  await wait(500);
}
const g = state.guilds[0];
const vc = g ? g.channels.find(c => c.kind === 'voice') : null;
if (!g || !vc) return { missing: true };
await openGuildChannel(g, vc);
const joinBtn = q('#callJoinBtn');
if (!joinBtn) return { noJoinBtn: true };
joinBtn.click();
let sawPeer = false, remoteVideoTracks = 0, remoteAudioTracks = 0, audioBeforeVideo = 0, afterOffNoVideo = false;
for (let i = 0; i < 90; i++) {
  await wait(500);
  const boxes = document.querySelectorAll('#callVideos .call-video:not(.local)');
  if (boxes.length) {
    sawPeer = true;
    let vid = 0, aud = 0;
    for (const bx of boxes) {
      const v = bx.querySelector('video');
      if (v && v.srcObject) {
        vid += v.srcObject.getVideoTracks().length;
        aud += v.srcObject.getAudioTracks().length;
      }
      if (bx.classList.contains('no-video')) afterOffNoVideo = true;
    }
    if (remoteVideoTracks === 0) audioBeforeVideo = aud;
    remoteVideoTracks = vid;
    remoteAudioTracks = aud;
    if (remoteVideoTracks > 0 && remoteAudioTracks > 0 && i > 24) break;
  }
}
// ждём событие демонстрации экрана от собеседника (крупный режим)
let screenOnRemote = false, panelHasScreen = false;
for (let i = 0; i < 40; i++) {
  const screenBox = q('#callVideos .call-video.screen-on');
  if (screenBox) { screenOnRemote = true; panelHasScreen = !!q('#callPanel.has-screen'); break; }
  await wait(500);
}
return {
  sawPeer, remoteVideoTracks, remoteAudioTracks, audioBeforeVideo, afterOffNoVideo,
  screenOnRemote, panelHasScreen, screenSeen: !!window.__screenSeen,
  status: q('#callStatus') ? q('#callStatus').textContent : null,
  waitTimerVisible: !!q('#callWaitTimer'),
  waitTimerText: q('#callWaitTimer') ? q('#callWaitTimer').textContent : null
};
