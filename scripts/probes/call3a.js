/*async*/
const wait = ms => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);
for (let i = 0; i < 30; i++) {
  if (window.state && state.guilds && state.guilds.length) break;
  await wait(500);
}
const g = state.guilds[0];
const vc = g ? g.channels.find(c => c.kind === 'voice') : null;
if (!g || !vc) return { missing: true, guilds: (state.guilds || []).length, chans: g ? g.channels.map(c => c.kind + ':' + c.name) : [] };
// как пользователь: открываем голосовой канал → панель «Присоединиться» → клик
await openGuildChannel(g, vc);
const joinBtn = q('#callJoinBtn');
if (!joinBtn) return { noJoinBtn: true };
joinBtn.click();
let sawPeer = false, audioBefore = 0, videoBefore = 0;
let maxAud = 0, maxVid = 0, camToggled = false, camOff = false;
let camOnLocalHasVideo = false, camOffLocalNoVideo = false, camOnLocalMuted = false;
let screenShown = false, screenOnLocal = false;
for (let i = 0; i < 60; i++) {
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
    }
    maxVid = Math.max(maxVid, vid);
    maxAud = Math.max(maxAud, aud);
    if (!camToggled) {
      audioBefore = aud; videoBefore = vid;
      camToggled = true;
      if (vid === 0) { try { await toggleCam(); } catch (e) {} }
      await wait(3000);
      const loc = q('#callVideos .call-video.local');
      const lv = loc ? loc.querySelector('video') : null;
      camOnLocalHasVideo = !!(lv && lv.srcObject && lv.srcObject.getVideoTracks().length);
      camOnLocalMuted = !!(lv && lv.muted);
    } else if (!camOff) {
      try { await toggleCam(); } catch (e) {}
      await wait(1500);
      const loc = q('#callVideos .call-video.local');
      camOffLocalNoVideo = !!(loc && loc.classList.contains('no-video'));
      camOff = true;
    } else if (!screenShown) {
      screenShown = true;
      try { await toggleScreen(); } catch (e) {}
      await wait(3000);
      screenOnLocal = !!(call && call.screenOn);
    }
    if (camOff && screenShown) break;
  }
}
return {
  missing: false,
  guild: g.name, voiceChannel: vc ? vc.name : null,
  sawPeer, audioBefore, videoBefore, camToggled, camOff,
  camOnLocalHasVideo, camOffLocalNoVideo, camOnLocalMuted,
  maxAud, maxVid, screenShown, screenOnLocal,
  status: q('#callStatus') ? q('#callStatus').textContent : null,
  consoleLog: window.__lastConsole || null
};
