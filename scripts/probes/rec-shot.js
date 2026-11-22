/*async*/
// Снимок «пока идёт запись»: держим кнопку и не отпускаем, чтобы на скриншоте
// попало окно записи голосового. Требует probe.js с --fake-media 1.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);
const fire = (el, type) => el.dispatchEvent(new PointerEvent(type, {
  bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'mouse',
  buttons: type === 'pointerdown' ? 1 : 0
}));
const btn = q('#recBtn');
fire(btn, 'pointerdown');
await sleep(1500);
const b = q('.rec-bubble');
return {
  mode: btn.dataset.mode,
  icon: btn.textContent,
  bubbles: document.querySelectorAll('.rec-bubble').length,
  bubbleClass: b ? b.className : null,
  bubbleRect: b ? (() => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
  timer: (q('.rec-timer-inline') || q('.rec-timer-badge') || {}).textContent || null,
  hint: (q('.rec-hint') || {}).textContent || null,
  mic: (q('.rec-mic') || {}).textContent || null,
  waveBars: q('.rec-wave') ? q('.rec-wave').children.length : 0,
  composerChildren: [...document.querySelectorAll('.chat-input > *')].map(e => e.id || e.className)
};
