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
await wait(700);
const join = q('#callJoinBtn');
const inputHidden = q('#chatInput') ? q('#chatInput').style.display === 'none' : null;
return {
  joinVisible: !!join,
  joinText: join ? join.textContent : null,
  status: q('#callStatus') ? q('#callStatus').textContent : null,
  sub: q('#callSub') ? q('#callSub').textContent : null,
  inputHidden,
  version: (q('.side-ver') || {}).textContent || null
};
