// Проба: живые сообщения НЕ должны добавлять разделитель дня, если день тот же.
// Фаза 1 — три сообщения текущим днём: число .day-sep не меняется.
// Фаза 2 — сообщение другим днём: разделитель ДОЛЖЕН появиться.
const body = document.getElementById('chatBody');
if (!body) return { error: 'chatBody not found' };
const sepCount = () => body.querySelectorAll('.day-sep').length;
const sepText = () => {
  const s = body.querySelectorAll('.day-sep');
  return s.length ? s[s.length - 1].textContent.trim() : '';
};

const start = sepCount();
const now = Date.now();
window.appendReceived({ from: 'demo_bob', ts: now, id: 'probe-a1' }, 'проба 1', false);
window.appendReceived({ from: 'demo_bob', ts: now + 1000, id: 'probe-a2' }, 'проба 2', false);
window.appendReceived({ from: 'demo_alice', ts: now + 2000, id: 'probe-a3' }, 'проба 3', false);
const afterSameDay = sepCount();

window.appendReceived({ from: 'demo_alice', ts: now - 3 * 86400000, id: 'probe-b1' }, 'проба другого дня', false);
const afterOtherDay = sepCount();

const rows = body.querySelectorAll('.msg-row');
const tail = Array.prototype.slice.call(body.children, -6).map(el => el.className);

return {
  sepsAtStart: start,
  sepsAfterSameDayMessages: afterSameDay,
  addedSameDay: afterSameDay - start,
  sepsAfterOtherDayMessage: afterOtherDay,
  addedOtherDay: afterOtherDay - afterSameDay,
  lastSepText: sepText(),
  msgRows: rows.length,
  tailClasses: tail
};
