/*async*/
(async () => {
  const q = s => document.querySelector(s);
  const inp = q('#msgInput');
  if (!inp) return { err: 'no input' };
  inp.value = 'Отправка из UI 🚀';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  try {
    await sendMessage();
    return { sent: true, gview: !!state.gview, gLastError: state.gLastError };
  } catch (e) {
    return { err: String(e && e.stack || e) };
  }
})()
