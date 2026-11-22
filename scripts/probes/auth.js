const q = s => document.querySelector(s);
const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
return {
  viewport: [innerWidth, innerHeight],
  theme: document.documentElement.getAttribute('data-theme'),
  hero: rect(q('.auth-hero')),
  panel: rect(q('.auth-panel')),
  card: rect(q('.auth-card')),
  title: (q('.hero-title') || {}).textContent || '',
  sub: (q('.hero-sub') || {}).textContent || '',
  chips: [...document.querySelectorAll('.hero-chips span')].map(e => e.textContent),
  heroBgLayers: (() => { const b = getComputedStyle(q('.auth-hero'), '::before').backgroundImage; return (b.match(/url\(/g) || []).length; })(),
  heroArt: !!q('.hero-art'),
  tabs: [...document.querySelectorAll('.auth-tabs button')].map(b => b.textContent),
  fields: [...document.querySelectorAll('.field input')].map(i => ({ id: i.id, w: Math.round(i.getBoundingClientRect().width) })),
  goBtn: rect(q('#authGo')),
  errVisible: (q('#authErr') || {}).style ? getComputedStyle(q('#authErr')).display : null,
  ver: (q('.auth-ver') || {}).textContent || '',
  overflowX: document.documentElement.scrollWidth > innerWidth + 1,
  docScrollWidth: document.documentElement.scrollWidth,
  overflowing: [...document.querySelectorAll('.auth-wrap > *, .auth-card, .hero-copy')].filter(e => e.getBoundingClientRect().width > innerWidth + 2).map(e => e.className),
  minFontPx: (() => { let m = 99; document.querySelectorAll('*').forEach(e => { if (e.children.length === 0 && e.textContent.trim()) { const f = parseFloat(getComputedStyle(e).fontSize); if (f < m) m = f; } }); return m; })()
};
