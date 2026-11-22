/*async*/
// Проба кнопки записи: тап = смена режима, удержание = запись и отправка.
// Требует запуска probe.js с --fake-media 1 (фейковые микрофон и камера).
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);
const fire = (el, type) => el.dispatchEvent(new PointerEvent(type, {
  bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'mouse',
  buttons: type === 'pointerdown' ? 1 : 0
}));
const bubbles = () => document.querySelectorAll('.rec-bubble').length;
const voiceCards = () => document.querySelectorAll('.file-card.voice').length;
const circleCards = () => document.querySelectorAll('.file-card.circle').length;

const out = { steps: [] };
const btn = q('#recBtn');
out.hasRecBtn = !!btn;
out.composerChildren = [...document.querySelectorAll('.chat-input > *')].map(e => e.id || e.className);
out.logo = !!q('.composer-logo');
out.mode0 = btn.dataset.mode;
out.icon0 = btn.textContent;
out.voiceBefore = voiceCards();
out.circleBefore = circleCards();
out.bubblesBefore = bubbles();

// 1) тап — режим переключается на кружок, окна записи не появляется
fire(btn, 'pointerdown'); fire(btn, 'pointerup');
await sleep(350);
out.modeAfterTap = q('#recBtn').dataset.mode;
out.iconAfterTap = q('#recBtn').textContent;
out.bubblesAfterTap = bubbles();

// 2) тап обратно — снова голосовое
fire(btn, 'pointerdown'); fire(btn, 'pointerup');
await sleep(350);
out.modeAfterSecondTap = q('#recBtn').dataset.mode;

// 3) ГОНКА: доступ к микрофону приходит с задержкой, а палец уже отпустили.
//    Раньше это и оставляло «окно записи» висеть (запись продолжалась до лимита).
const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
let asked = 0;
navigator.mediaDevices.getUserMedia = async (c) => {
  asked++;
  await sleep(1200);
  return realGUM(c);
};
fire(btn, 'pointerdown');
await sleep(400);            // удержание уже началось (beginRec ушёл в getUserMedia)
out.raceBubbleDuringWait = bubbles();   // окно ещё не должно рисоваться
fire(btn, 'pointerup');      // отпустили, пока доступ не пришёл
await sleep(2000);
out.raceBubbles = bubbles();            // и после — пусто
out.raceAsked = asked;
out.raceVoiceAdded = voiceCards() - out.voiceBefore;
out.raceCircleAdded = circleCards() - out.circleBefore;
navigator.mediaDevices.getUserMedia = realGUM;

// 4) нормальное удержание в режиме голосового:
//    во время записи окно есть, после отпускания — исчезло и ушло голосовое
fire(btn, 'pointerdown'); await sleep(1100);
out.holdBubbles = bubbles();
out.holdBubbleClass = q('.rec-bubble') ? q('.rec-bubble').className : null;
out.holdTimer = (q('.rec-timer-inline') || q('.rec-timer-badge') || {}).textContent || null;
out.holdHint = (q('.rec-bubble.voice .rec-hint') || {}).textContent || null;
fire(btn, 'pointerup');
await sleep(3000);
out.afterReleaseBubbles = bubbles();
out.voiceAdded = voiceCards() - out.voiceBefore;
out.circleAdded = circleCards() - out.circleBefore;
out.voiceBars = q('.file-card.voice .voice-bars') ? q('.file-card.voice .voice-bars').children.length : 0;
out.voiceDur = (q('.file-card.voice .voice-dur') || {}).textContent || null;
out.voicePlay = !!q('.file-card.voice .voice-play');
out.voiceAudio = document.querySelectorAll('.file-card.voice audio').length;
out.modeNow = q('#recBtn').dataset.mode;

// 5) поле с текстом: показываем «отправить», пустое — «записать»
const inp = q('#msgInput');
inp.value = 'привет'; inp.dispatchEvent(new Event('input', { bubbles: true }));
await sleep(200);
out.textTyped = { sendVisible: !!(q('#sendBtn') && q('#sendBtn').offsetParent), recVisible: !!(q('#recBtn') && q('#recBtn').offsetParent) };
inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
await sleep(200);
out.textCleared = { sendVisible: !!(q('#sendBtn') && q('#sendBtn').offsetParent), recVisible: !!(q('#recBtn') && q('#recBtn').offsetParent) };

out.version = [...document.querySelectorAll('.rail-ver')].map(e => e.textContent);
out.overflowX = document.documentElement.scrollWidth > innerWidth + 1;
return out;
