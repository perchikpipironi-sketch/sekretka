// Проба модалки тем: список тем, активная, размеры, подписи
const q = s => document.querySelector(s);
const items = [...document.querySelectorAll('.theme-item')].map(b => ({
  id: b.getAttribute('data-theme-id'),
  text: (b.textContent || '').replace(/\s+/g, ' ').trim(),
  on: b.classList.contains('on')
}));
const swatches = document.querySelectorAll('.theme-item .theme-swatch').length;
return {
  modalOpen: !!q('.theme-list'),
  themeAttr: document.documentElement.getAttribute('data-theme'),
  themes: items,
  swatches,
  mikuInPage: document.body.innerHTML.toLowerCase().includes('miku') || document.body.textContent.toLowerCase().includes('мику'),
  imgTags: [...document.querySelectorAll('img')].map(i => i.getAttribute('src')),
  ver: (q('.rail-ver') || {}).textContent || (q('.auth-ver') || {}).textContent || ''
};
