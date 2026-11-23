/*async*/
const burnBtn = document.getElementById('burnToggle');
await new Promise(r => setTimeout(r, 300));
const before = burnBtn ? { cls: burnBtn.className, txt: burnBtn.textContent } : null;
if (burnBtn) burnBtn.click();
await new Promise(r => setTimeout(r, 250));
const after1 = burnBtn ? { cls: burnBtn.className, txt: burnBtn.textContent } : null;
if (burnBtn) burnBtn.click();
await new Promise(r => setTimeout(r, 250));
const after2 = burnBtn ? { cls: burnBtn.className, txt: burnBtn.textContent } : null;
const menuBtn = document.getElementById('chatMenu');
await menuBtn.click();
await new Promise(r => setTimeout(r, 300));
const menuButtons = Array.from(document.querySelectorAll('.modal button')).map(x => x.textContent);
const pinBtn = Array.from(document.querySelectorAll('.modal button')).find(x => x.textContent.includes('Закрепить'));
if (pinBtn) pinBtn.click();
await new Promise(r => setTimeout(r, 300));
const pinnedFriend = !!document.querySelector('.friend-item .pin-ic');
return {
  before, after1, after2,
  menuButtons,
  pinnedFriend,
  ver: document.body.textContent.includes('v31') ? 'v31' : '?'
};
