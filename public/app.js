'use strict';
/* Секретка — клиент. Вся криптография — здесь, в браузере. */

const LS = { nick: 'sk_nick', token: 'sk_token', kp: 'sk_kp', theme: 'sk_theme' };
const APP_VERSION = '26';

const state = {
  me: null, token: null, kp: null,
  friends: [], incoming: [], outgoing: [],
  conv: null, convPub: null, shared: null,
  msgs: [], unread: {}, typing: {}, typingTimers: {},
  lastTs: 0,
  guilds: [], gview: null, view: 'dm',
  ws: null, wsTry: 0, dec: 0
};

const $ = (sel, root) => (root || document).querySelector(sel);
const app = () => $('#app');
const esc = s => String(s);
const timeStr = ts => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

// ---------- темы ----------
const THEMES = [
  { id: 'neon', name: 'Неон', desc: 'бирюза + розовый — как сейчас', sw: ['#04121b', '#16DBFF', '#FF5C97'] },
  { id: 'crimson', name: 'Нуаръ', desc: 'чёрный + багровый, строгий', sw: ['#0B0B0B', '#8B0D1A', '#C6283A'] },
  { id: 'light', name: 'Светлая', desc: 'off-white, для дня', sw: ['#F2F7F9', '#0891b2', '#e10f5f'] },
  { id: 'amethyst', name: 'Аметист', desc: 'тёмная с розово-фиолетовым', sw: ['#150a26', '#a78bfa', '#f472b6'] }
];

function applyTheme(id) {
  const t = THEMES.find(x => x.id === id) ? id : 'neon';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(LS.theme, t); } catch (e) {}
  return t;
}

function showThemeModal() {
  const modal = h('div', { class: 'modal' },
    h('h3', {}, 'Темы 🎨'),
    h('p', {}, 'Выбери оформление — оно сохранится на этом устройстве.')
  );
  const list = h('div', { class: 'theme-list' });
  const current = (document.documentElement.getAttribute('data-theme') || 'neon');
  for (const t of THEMES) {
    const row = h('button', { class: 'theme-item' + (t.id === current ? ' on' : ''), type: 'button', 'data-theme-id': t.id },
      h('div', { class: 'theme-swatches' },
        ...t.sw.map(c => h('span', { class: 'theme-swatch', style: 'background:' + c }))
      ),
      h('div', { class: 'theme-info' },
        h('div', { class: 'theme-name' }, t.name),
        h('div', { class: 'theme-desc' }, t.desc)
      )
    );
    row.addEventListener('click', () => {
      applyTheme(t.id);
      closeModal();
      toast('Тема: ' + t.name);
    });
    list.append(row);
  }
  modal.append(list);
  modal.append(h('div', { class: 'modal-actions' }, h('button', { class: 'btn-ghost', id: 'themeClose', type: 'button' }, 'Закрыть')));
  modal.querySelector('#themeClose').addEventListener('click', closeModal);
  attachOverlay(modal);
}

// ---------- шторка-навигация (телефон) ----------
function openDrawer() { document.documentElement.classList.add('drawer-open'); }
function closeDrawer() { document.documentElement.classList.remove('drawer-open'); }

// ---------- DOM-помощники ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v);
  }
  for (const k of kids) {
    if (k == null) continue;
    el.append(k.nodeType ? k : document.createTextNode(k));
  }
  return el;
}

function toast(msg, kind) {
  const t = h('div', { class: 'toast' + (kind === 'err' ? ' err' : '') }, msg);
  $('#toasts').append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 350); }, 2600);
}

function avatarEl(nick, size) {
  let hash = 0;
  for (let i = 0; i < nick.length; i++) hash = (hash * 31 + nick.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const ch = (nick[0] || '?').toUpperCase();
  const a = h('div', { class: 'avatar' }, ch);
  if (size) { a.style.width = size + 'px'; a.style.height = size + 'px'; a.style.fontSize = Math.max(11, size * 0.42) + 'px'; }
  a.style.background = `linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${(hue + 40) % 360} 70% 42%))`;
  return a;
}

// ---------- API ----------
async function api(method, p, body, token) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...((token || state.token) ? { Authorization: 'Bearer ' + (token || state.token) } : {})
    }
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(p, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* noop */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || ('Ошибка ' + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}
const apiToken = (tok, method, p, body) => api(method, p, body, tok);

// ---------- локальные ключи ----------
// Ключ хранится отдельно для каждого аккаунта: на одном браузере можно держать
// несколько разных личностей, не перетирая друг другу отмычки.
function keySlot(nick) { return 'sk_kp_' + String(nick || '').toLowerCase(); }
function kpNick(nick) { return nick || state.me || localStorage.getItem(LS.nick); }

function makeKp(nick) {
  const kp = window.SecCrypto.generateKeypair();
  saveKp(kp, nick);
  return kp;
}
function loadKp(nick) {
  const n = kpNick(nick);
  let s = n ? localStorage.getItem(keySlot(n)) : null;
  if (!s) {
    // миграция со старых сборок: глобальный ключ принадлежит тому аккаунту,
    // который последним входил (LS.nick), — чужой ключ другому аккаунту не отдаём
    const legacyNick = kpNick(localStorage.getItem(LS.nick));
    if (!n || !legacyNick || legacyNick === n) s = localStorage.getItem(LS.kp);
  }
  return s ? window.SecCrypto.keypairFromSecret(s) : null;
}
function saveKp(kp, nick) {
  const s = window.SecCrypto.exportSecret(kp);
  const n = kpNick(nick);
  if (n) localStorage.setItem(keySlot(n), s);
  localStorage.setItem(LS.kp, s); // совместимость со старыми сборками
  return s;
}
function dropKp(nick) {
  const n = kpNick(nick);
  if (n) localStorage.removeItem(keySlot(n));
  localStorage.removeItem(LS.kp);
}

// ---------- хранилище ключа в аккаунте ----------
// Секретный ключ заворачивается паролем (PBKDF2 210k + AES-GCM) и уезжает на сервер
// конвертом: сервер не может его открыть, а новое устройство после входа по паролю
// получает историю расшифрованной. Пароль живёт только в памяти вкладки.
async function vaultSave(pass, kp) {
  const key = kp || state.kp;
  if (!pass || !key) return false;
  try {
    const vault = await window.SecCrypto.wrapSecret(window.SecCrypto.exportSecret(key), pass);
    await api('POST', '/api/vault', { vault });
    return true;
  } catch (e) { return false; }
}

async function vaultRestore(pass) {
  if (!pass) return null;
  let vault = null;
  try { vault = (await api('GET', '/api/vault')).vault; } catch (e) { return null; }
  if (!vault) return null;
  const secret = await window.SecCrypto.unwrapSecret(vault, pass);
  if (!secret) return null;
  try { return window.SecCrypto.keypairFromSecret(secret); } catch (e) { return null; }
}

// Подбирает ключ под аккаунт: свой локальный -> из хранилища на сервере -> спросить человека.
// Никогда не создаёт новый ключ молча: иначе старое устройство перестанет читать переписку.
async function resolveKeyForAccount(pass) {
  let pub = null;
  try { pub = (await api('GET', '/api/me')).pub; } catch (e) { /* не критично */ }
  const local = loadKp(state.me);
  if (local && (!pub || window.SecCrypto.publicB64(local) === pub)) return { kp: local, from: 'local', pub };
  const fromVault = await vaultRestore(pass);
  if (fromVault) { saveKp(fromVault); return { kp: fromVault, from: 'vault', pub }; }
  return { kp: null, from: local ? 'conflict' : 'missing', pub };
}

// Приводим публичный ключ в аккаунте в согласие с локальным. Чужой ключ НЕ перетираем:
// если в аккаунте уже лежит другой pub (ключ сменили на другом устройстве) — отдаём false.
// Заодно запоминаем, есть ли в аккаунте конверт ключа (нужно initMain, чтобы предложить бэкап).
let lastHasVault = false;
async function syncPub() {
  const localPub = window.SecCrypto.publicB64(state.kp);
  let serverPub = null;
  lastHasVault = false;
  try {
    const me = await api('GET', '/api/me');
    serverPub = me.pub;
    lastHasVault = !!me.hasVault;
  } catch (e) { /* не критично */ }
  if (!serverPub) {
    try { await api('PUT', '/api/me', { pub: localPub }); } catch (e) { /* не критично */ }
    return true;
  }
  return serverPub === localPub;
}

function convKey(a, b) { return [a, b].sort().join('|'); }

function hashNick(nick) {
  let hsh = 0;
  for (let i = 0; i < nick.length; i++) hsh = (hsh * 31 + nick.charCodeAt(i)) >>> 0;
  return hsh;
}

// ---------- экран входа ----------
function renderAuth() {
  const wrap = h('div', { class: 'auth-wrap' });

  // левая половина: герой с картинкой, крупный заголовок, чипы
  const hero = h('div', { class: 'auth-hero' },
    h('div', { class: 'hero-copy' },
      h('div', { class: 'hero-badge' }, h('i'), 'сквозное шифрование'),
      h('h1', { class: 'hero-title' }, 'Секретка'),
      h('p', { class: 'hero-sub' }, 'Личный мессенджер, который шифрует всё прямо в браузере. Сервер видит только набор байтов — прочитать переписку не может даже он.'),
      h('div', { class: 'hero-chips' },
        h('span', {}, '🔐 X25519 + AES-GCM'),
        h('span', {}, '👥 друзья и заявки'),
        h('span', {}, '📎 фото, видео, файлы'),
        h('span', {}, '🎥 видеокружки')
      )
    )
  );

  // правая половина: форма
  const card = h('div', { class: 'auth-card' });

  card.append(
    h('div', { class: 'logo-row' },
      h('div', { class: 'logo-mark' }, '🔐'),
      h('div', {},
        h('div', { class: 'logo-name' }, 'Секретка'),
        h('div', { class: 'logo-sub' }, 'шифрованный мессенджер')
      )
    ),
    h('div', { class: 'auth-tabs' },
      h('button', { class: 'on', id: 'tabLogin', type: 'button' }, 'Вход'),
      h('button', { id: 'tabReg', type: 'button' }, 'Регистрация')
    ),
    h('div', { class: 'field' },
      h('label', {}, 'Имя'),
      h('input', { id: 'authNick', placeholder: 'например, alina', maxlength: '20' })
    ),
    h('div', { class: 'field' },
      h('label', {}, 'Пароль'),
      h('input', { id: 'authPass', type: 'password', placeholder: '••••••••', maxlength: '72' })
    ),
    h('button', { class: 'btn-primary', id: 'authGo', type: 'button' }, 'Войти'),
    h('div', { class: 'auth-err', id: 'authErr' }),
    h('div', { class: 'auth-note' }, '🔑 Ключ шифрования лежит в аккаунте зашифрованным твоим паролем — на новом телефоне войди тем же именем и паролем, и история откроется сама.'),
    h('div', { class: 'feats' },
      h('div', { class: 'feat' }, h('span', {}, '🔒'), h('span', {}, h('b', {}, 'Сквозное шифрование'), ' — X25519 + AES-GCM, ключи живут только у вас')),
      h('div', { class: 'feat' }, h('span', {}, '🕶️'), h('span', {}, 'Сервер хранит только шифротекст — даже он не прочитает переписку')),
      h('div', { class: 'feat' }, h('span', {}, '👥'), h('span', {}, 'Друзья, заявки, статус «онлайн», уведомления о новых сообщениях'))
    )
  );

  const panel = h('div', { class: 'auth-panel' },
    card,
    h('div', { class: 'auth-ver' }, 'Секретка v' + APP_VERSION)
  );
  wrap.append(hero, panel);
  app().replaceChildren(wrap);

  let mode = 'login';
  const nickIn = $('#authNick'), passIn = $('#authPass'), errBox = $('#authErr');
  const setMode = m => {
    mode = m;
    $('#tabLogin').classList.toggle('on', m === 'login');
    $('#tabReg').classList.toggle('on', m === 'reg');
    $('#authGo').textContent = m === 'login' ? 'Войти' : 'Создать аккаунт';
    errBox.style.display = 'none';
  };
  $('#tabLogin').addEventListener('click', () => setMode('login'));
  $('#tabReg').addEventListener('click', () => setMode('reg'));

  const submit = async () => {
    errBox.style.display = 'none';
    const nick = nickIn.value.trim(), pass = passIn.value;
    if (!nick || !pass) { errBox.textContent = 'Заполни оба поля'; errBox.style.display = 'block'; return; }
    try {
      const ep = mode === 'login' ? '/api/login' : '/api/register';
      const r = await api('POST', ep, { nick, pass });
      state.me = r.nick; state.token = r.token; state.pass = pass;
      localStorage.setItem(LS.nick, state.me);
      localStorage.setItem(LS.token, state.token);

      const res = await resolveKeyForAccount(pass);
      if (res.kp) {
        state.kp = res.kp;
        if (res.from === 'vault') toast('Ключ подтянут из аккаунта 🔑');
        await initMain();
        vaultSave(pass); // держим конверт свежим
        return;
      }
      if (mode === 'reg' && !res.pub) {
        // новое устройство и новый аккаунт: создаём ключ и сразу кладём конверт в аккаунт
        state.kp = makeKp();
        await vaultSave(pass);
        showKeyModal('new');
        return;
      }
      showKeyModal('enter', { reason: res.from, pass });
    } catch (e) {
      errBox.textContent = e.message;
      errBox.style.display = 'block';
    }
  };
  $('#authGo').addEventListener('click', submit);
  passIn.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });

  const demo = new URLSearchParams(location.search).get('demo');
  if (demo) { nickIn.value = demo; passIn.value = 'demo'; mode = 'login'; setMode('login'); submit(); }
}

// ---------- модальные окна ----------
let escFn = null;
function closeModal() {
  const o = $('.overlay');
  if (o) o.remove();
  if (escFn) { document.removeEventListener('keydown', escFn); escFn = null; }
}
function attachOverlay(modal) {
  escFn = e => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', escFn);
  const ov = h('div', { class: 'overlay' }, modal);
  modal.addEventListener('click', e => e.stopPropagation());
  ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
  document.body.append(ov);
}

function fallbackCopy(text, done) {
  const ta = h('textarea', { style: 'position:fixed;left:-9999px' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); done(); }
  catch (e) { toast('Не удалось скопировать', 'err'); }
  ta.remove();
}

function showKeyModal(kind, opts) {
  opts = opts || {};
  const modal = h('div', { class: 'modal' });
  if (kind === 'new') {
    const secret = window.SecCrypto.exportSecret(state.kp);
    modal.append(
      h('h3', {}, 'Твой секретный ключ 🔑'),
      h('p', {}, 'Это «отмычка» к твоим сообщениям. Она уже сохранена в аккаунте зашифрованной паролем — на другом устройстве достаточно войти с тем же именем и паролем. Но сохрани её и вручную: если забудешь пароль, только она вернёт доступ к переписке.'),
      h('div', { class: 'key-box', id: 'backupBox' }, secret),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn-primary', id: 'copyKey', type: 'button' }, '📋 Скопировать'),
        h('button', { class: 'btn-ghost', id: 'backupDone', type: 'button' }, 'Я сохранил(а)')
      ),
      h('button', { class: 'btn-link', id: 'keyRestoreLink', type: 'button' }, 'Вставить отмычку с другого устройства'),
      h('button', { class: 'btn-link', id: 'backupSkip', type: 'button' }, 'Пропустить — войти без бэкапа')
    );
    modal.querySelector('#copyKey').addEventListener('click', () => {
      const done = () => toast('Ключ скопирован 📋');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(secret).then(done).catch(() => fallbackCopy(secret, done));
      } else fallbackCopy(secret, done);
    });
    modal.querySelector('#backupDone').addEventListener('click', () => { closeModal(); initMain(); });
    modal.querySelector('#backupSkip').addEventListener('click', () => { closeModal(); initMain(); });
    modal.querySelector('#keyRestoreLink').addEventListener('click', () => { closeModal(); showKeyModal('enter', { reason: 'manual', pass: state.pass }); });
  } else if (kind === 'enter') {
    const reason = opts.reason || 'missing';
    const intro = reason === 'conflict'
      ? 'На этом устройстве лежит ключ от другого аккаунта. Вставь отмычку от этого аккаунта — или создай новый ключ (тогда старая переписка станет недоступной):'
      : 'На этом устройстве ещё нет ключа от этого аккаунта, и в самом аккаунте он не сохранён. Возьми отмычку на старом устройстве (кнопка «Ключ» слева) и вставь сюда — или создай новый ключ (старая переписка станет недоступной):';
    modal.append(
      h('h3', {}, 'Ключ от этого аккаунта'),
      h('p', {}, intro),
      h('textarea', { id: 'restoreBox', placeholder: 'Вставь секретный ключ (base64)…' }),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn-primary', id: 'restoreGo', type: 'button' }, 'Восстановить'),
        h('button', { class: 'btn-ghost', id: 'restoreNew', type: 'button' }, 'Создать новый')
      ),
      opts.pass ? h('button', { class: 'btn-link', id: 'restoreRetry', type: 'button' }, 'Попробовать снова с паролем') : null
    );
    modal.querySelector('#restoreGo').addEventListener('click', async () => {
      try {
        const kp = window.SecCrypto.keypairFromSecret($('#restoreBox').value.trim());
        saveKp(kp); state.kp = kp;
        if (state.pass) vaultSave(state.pass, kp);
        closeModal(); initMain();
      } catch (e) { toast('Не похоже на ключ 🤔', 'err'); }
    });
    modal.querySelector('#restoreNew').addEventListener('click', async () => {
      if (!window.confirm('Создать новый ключ? Переписка, зашифрованная старым ключом, останется недоступной.')) return;
      state.kp = makeKp();
      if (state.pass) await vaultSave(state.pass);
      closeModal(); showKeyModal('new');
    });
    if (opts.pass) {
      modal.querySelector('#restoreRetry').addEventListener('click', async () => {
        const kp = await vaultRestore(opts.pass);
        if (kp) { saveKp(kp); state.kp = kp; closeModal(); initMain(); toast('Ключ подтянут из аккаунта 🔑'); }
        else toast('В аккаунте нет сохранённого ключа', 'err');
      });
    }
  }
  attachOverlay(modal);
}

// ---------- инициализация основной части ----------
function avatarColor(nick) {
  const hue = hashNick(nick) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${(hue + 40) % 360} 70% 42%))`;
}

// Окно «сохранить ключ в аккаунт»: сессия восстановлена по токену (пароля в памяти нет),
// а конверта в аккаунте ещё нет — значит история не откроется на другом устройстве.
function showVaultSaveModal() {
  if (document.querySelector('#vaultSaveModal')) return;
  const modal = h('div', { class: 'modal', id: 'vaultSaveModal' });
  const passIn = h('input', { id: 'vaultPass', type: 'password', placeholder: '••••••••', maxlength: '72', autocomplete: 'current-password' });
  const err = h('div', { class: 'auth-err', id: 'vaultErr' });
  const go = h('button', { class: 'btn-primary', id: 'vaultSaveGo', type: 'button' }, 'Сохранить ключ');
  const later = h('button', { class: 'btn-ghost', id: 'vaultSaveLater', type: 'button' }, 'Позже');
  modal.append(
    h('h3', {}, 'Сохранить ключ в аккаунт 🔑'),
    h('p', {}, 'Чтобы история открывалась на телефоне, один раз подтверди пароль от аккаунта — ключ ляжет в аккаунт зашифрованным паролем, и сервер его не прочитает.'),
    h('div', { class: 'field' }, h('label', {}, 'Пароль'), passIn),
    err,
    h('div', { class: 'modal-actions' }, go, later)
  );

  const submit = async () => {
    const pw = passIn.value.trim();
    if (pw.length < 4) { err.textContent = 'Пароль слишком короткий'; err.style.display = 'block'; return; }
    go.disabled = true; go.textContent = 'Сохраняю…';
    try {
      const r = await api('POST', '/api/login', { nick: state.me, pass: pw });
      state.token = r.token;
      localStorage.setItem(LS.token, r.token);
      state.pass = pw;
      await vaultSave(pw);
      closeModal();
      toast('Ключ сохранён в аккаунт — история откроется на другом устройстве 🔑');
    } catch (e) {
      err.textContent = e.status === 400 || e.status === 401 ? 'Пароль не подошёл' : e.message;
      err.style.display = 'block';
      go.disabled = false; go.textContent = 'Сохранить ключ';
    }
  };

  attachOverlay(modal);
  go.addEventListener('click', submit);
  passIn.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  later.addEventListener('click', closeModal);
  setTimeout(() => { try { passIn.focus(); } catch (e) { /* ignore */ } }, 120);
}

async function initMain() {
  if (!state.kp) state.kp = loadKp();
  if (!state.kp) { showKeyModal('enter', { reason: 'missing', pass: state.pass }); return; }
  if (!(await syncPub())) {
    // локальный ключ не от этого аккаунта — не подменяем ключ в аккаунте молча
    showKeyModal('enter', { reason: 'conflict', pass: state.pass });
    return;
  }
  // аккаунт без конверта: сохраним ключ, если знаем пароль, иначе предложим сохранить
  if (!lastHasVault) {
    if (state.pass) { vaultSave(state.pass); }
    else { setTimeout(() => showVaultSaveModal(), 500); }
  }
  renderMain();
  connectWS();
  startPoll();
  await Promise.all([loadFriends(), loadRequests()]);
  if (state.conv) await openChat(state.conv);
}

// dev: принудительно показать кнопку «вниз» (?forcejump=1)
function applyForceJump() {
  if (new URLSearchParams(location.search).get('forcejump') === '1') {
    const jd = $('#jumpDown');
    if (jd) jd.classList.add('show');
  }
}

// dev: набить открытый чат синтетическими сообщениями (?fill=120) — проверка длинного скролла
function applyFill() {
  const n = parseInt(new URLSearchParams(location.search).get('fill') || '0', 10);
  const body = $('#chatBody');
  if (!n || !body || !state.conv) return;
  const txt = ['Ага 😏', 'Ну да', 'Смотри, всё летает', 'Ок', 'Тестовое сообщение для длинного чата', 'Хм', 'И это тоже', 'Держи ещё одно'];
  for (let i = 0; i < n; i++) {
    const mine = i % 3 !== 0;
    body.append(msgEl({ id: 'fill-' + i, from: mine ? state.me : state.conv, ts: Date.now() - (n - i) * 60000 }, txt[i % txt.length]));
  }
  markGrouped(Array.prototype.slice.call(body.querySelectorAll('.msg-row')));
  scrollChat(true);
}

function renderMain() {
  const main = h('div', { class: 'main' });

  // v15: вертикальный рейл — вся навигация в одном месте
  const rail = h('div', { class: 'rail' },
    h('div', { class: 'rail-brand', title: 'Секретка' }, '🔐'),
    h('div', { class: 'rail-nav' },
      h('button', { class: 'rail-btn on', id: 'railDm', type: 'button', title: 'Личные сообщения' },
        h('span', { class: 'ri' }, '💬'), h('span', { class: 'rl' }, 'Чаты'),
        h('span', { class: 'badge', id: 'dmBadge' })),
      h('button', { class: 'rail-btn', id: 'railGuilds', type: 'button', title: 'Серверы (каналы)' },
        h('span', { class: 'ri' }, '🏰'), h('span', { class: 'rl' }, 'Серверы')),
      h('button', { class: 'rail-btn', id: 'railRequests', type: 'button', title: 'Заявки в друзья' },
        h('span', { class: 'ri' }, '💌'), h('span', { class: 'rl' }, 'Заявки'),
        h('span', { class: 'badge', id: 'requestsBadge' })),
      h('button', { class: 'rail-btn', id: 'railTheme', type: 'button', title: 'Темы оформления' },
        h('span', { class: 'ri' }, '🎨'), h('span', { class: 'rl' }, 'Темы')),
      h('button', { class: 'rail-btn', id: 'railKeys', type: 'button', title: 'Мой секретный ключ' },
        h('span', { class: 'ri' }, '🔑'), h('span', { class: 'rl' }, 'Ключ'))
    ),
    h('div', { class: 'rail-foot' },
      h('div', { class: 'rail-sep' }),
      h('button', { class: 'rail-btn', id: 'railExit', type: 'button', title: 'Выйти из аккаунта' },
        h('span', { class: 'ri' }, '🚪'), h('span', { class: 'rl' }, 'Выйти')),
      h('div', { class: 'rail-ver' }, 'v' + APP_VERSION)
    )
  );

  const side = h('div', { class: 'side' }, h('div', { id: 'sideVbox' }));

  const chat = h('div', { class: 'chat' },
    h('div', { class: 'chat-head', id: 'chatHead' },
      h('button', { class: 'burger', id: 'chatBurger', type: 'button', title: 'Меню' }, '☰'),
      h('div', { class: 'avatar', id: 'chatAvatar' }),
      h('div', {},
        h('div', { class: 'chat-title', id: 'chatTitle' }),
        h('div', { class: 'chat-status', id: 'chatStatus' })
      ),
      h('div', { class: 'spacer' }),
      h('button', { class: 'menu-btn', id: 'chatMenu', type: 'button' }, '⋯')
    ),
    h('div', { class: 'chat-body', id: 'chatBody' },
      h('div', { class: 'empty-note' }, 'Выбери друга слева 💬')
    ),
    h('div', { class: 'typing-hint', id: 'typingHint' }),
    h('button', { class: 'jump-down', id: 'jumpDown', type: 'button', title: 'Вниз' }, '⬇'),
    h('div', { class: 'chat-input no-text', id: 'chatInput' },
      h('div', { class: 'composer-logo', title: 'Секретка — шифрованный мессенджер' }, '◈'),
      h('textarea', { id: 'msgInput', placeholder: 'Сообщение…', rows: '1' }),
      h('button', { class: 'attach-btn', id: 'attachBtn', type: 'button', title: 'Прикрепить файл' }, '📎'),
      h('button', { class: 'rec-round', id: 'recBtn', type: 'button', 'data-mode': 'voice', title: 'Удерживай — запись · тап — сменить режим' }, '🎤'),
      h('button', { class: 'send-btn', id: 'sendBtn', type: 'button', title: 'Отправить' }, '➤')
    )
  );

  // v5: правая панель «детали собеседника»
  const right = h('div', { class: 'right-panel', id: 'rightPanel' },
    h('button', { class: 'rp-close', id: 'rpClose', type: 'button', title: 'Закрыть' }, '✕'),
    h('div', { class: 'rp-body', id: 'rpBody' })
  );

  main.append(rail, side, chat, right);
  const backdrop = h('div', { class: 'drawer-backdrop', id: 'drawerBackdrop' });
  app().replaceChildren(main, backdrop);

  // рендер содержимого боковой панели по режиму (личка / серверы)
  if (state.view === 'guild') renderGuildSide(); else renderDmSide();

  $('#railDm').addEventListener('click', () => setView('dm'));
  $('#railGuilds').addEventListener('click', () => setView('guild'));
  $('#addGo').addEventListener('click', addFriend);
  $('#addNick').addEventListener('keydown', e => { if (e.key === 'Enter') addFriend(); });
  $('#railRequests').addEventListener('click', () => {
    refreshRequests(false).then(() => renderRequests()).catch(() => renderRequests());
  });
  $('#railKeys').addEventListener('click', () => state.kp ? showKeyModal('new') : showKeyModal('enter', { reason: 'missing', pass: state.pass }));
  $('#railTheme').addEventListener('click', showThemeModal);
  $('#railExit').addEventListener('click', logout);
  $('#chatMenu').addEventListener('click', () => showChatMenu());
  $('#chatBurger').addEventListener('click', openDrawer);
  $('#sideClose').addEventListener('click', closeDrawer);
  $('#drawerBackdrop').addEventListener('click', closeDrawer);
  $('#rpClose').addEventListener('click', closeRightPanel);
  renderRightPanel(null);
  $('#sendBtn').addEventListener('click', sendMessage);
  $('#attachBtn').addEventListener('click', () => $('#fileInput').click());
  bindRecButton();
  const jumpDown = $('#jumpDown');
  if (jumpDown) {
    const jb = $('#chatBody');
    jb.addEventListener('scroll', updateJump, { passive: true });
    jumpDown.addEventListener('click', () => {
      jb.scrollTo({ top: jb.scrollHeight, behavior: 'smooth' });
      updateJump();
    });
  }
  const input = $('#msgInput');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    syncComposer(input);
    if (state.conv) wsSend({ type: 'typing', to: state.conv });
  });
}

async function addFriend() {
  const nick = $('#addNick').value.trim();
  if (!nick) return;
  try {
    await api('POST', '/api/friend/request', { nick });
    toast('Заявка отправлена 💌');
    $('#addNick').value = '';
    await loadRequests();
  } catch (e) { toast(e.message, 'err'); }
}

// ---------- друзья / заявки ----------
async function loadFriends() {
  const r = await api('GET', '/api/friends');
  state.friends = r.friends;
  renderFriends();
}

function renderFriends() {
  const list = $('#friendList');
  if (!list) return;
  list.replaceChildren();
  const cnt = $('#sideCount');
  if (cnt) cnt.textContent = state.friends.length ? String(state.friends.length) : '';
  if (!state.friends.length) {
    list.append(h('div', { class: 'empty-note' }, 'Пока никого нет.\nНайди друга по имени выше 👆'));
    return;
  }
  for (const f of state.friends) {
    const online = !!f.online;
    const unread = state.unread[f.nick.toLowerCase()] || 0;
    const item = h('div', { class: 'friend-item' + (state.conv === f.nick ? ' on' : ''), id: 'fr-' + hashNick(f.nick) },
      avatarEl(f.nick),
      h('div', { class: 'friend-info' },
        h('div', { class: 'friend-name' }, f.nick, h('span', { class: 'dot' + (online ? ' on' : '') })),
        h('div', { class: 'friend-sub' }, online ? 'онлайн' : 'не в сети')
      ),
      unread ? h('div', { class: 'unread' }, unread) : null
    );
    item.addEventListener('click', () => { closeDrawer(); openChat(f.nick); });
    list.append(item);
  }
}

async function loadRequests() {
  return refreshRequests(false);
}

// подпись списка по никам — чтобы замечать реальные изменения, а не перерисовывать зря
function nicksSig(list) {
  return (list || []).map(x => String(x.nick || '').toLowerCase()).sort().join(',');
}

// ---------- серверы (гильдии): как в Discord ----------
function gAad(guildId, channelId) { return 'g:' + guildId + ':' + channelId; }
function guildById(id) { return state.guilds.find(g => g.id === id) || null; }
function guildUnread(g) {
  if (!state.gview || state.gview.guildId !== g.id) return g.unread || 0;
  return 0;
}

async function loadGuilds() {
  const r = await api('GET', '/api/guilds');
  state.guilds = r.guilds;
  if (state.view === 'guild') renderGuildSide();
  return r;
}

function setView(mode) {
  if (!state.kp) return;
  state.view = mode;
  $('#railDm').classList.toggle('on', mode === 'dm');
  $('#railGuilds').classList.toggle('on', mode === 'guild');
  closeRightPanel();
  if (mode === 'guild') {
    state.conv = null; state.shared = null;
    loadGuilds().then(() => {
      renderGuildSide();
      const g = state.guilds.find(x => x.channels && x.channels.length);
      if (!state.gview) {
        if (g) {
          openGuildChannel(g, g.channels[0]);
        } else {
          const head = $('#chatHead');
          if (head) {
            head.replaceChildren(
              h('button', { class: 'burger', id: 'chatBurger', type: 'button', title: 'Меню' }, '☰'),
              h('div', { class: 'avatar g-avatar' }, '#'),
              h('div', {}, h('div', { class: 'chat-title', id: 'chatTitle' }, 'Серверы'),
                h('div', { class: 'chat-status', id: 'chatStatus' }, 'каналов пока нет')),
              h('div', { class: 'spacer' }),
              h('button', { class: 'menu-btn', id: 'chatMenu', type: 'button' }, '⋯')
            );
            $('#chatBurger').addEventListener('click', openDrawer);
            $('#chatMenu').addEventListener('click', () => { if (state.guilds.length) gMenu(state.guilds[0]); });
          }
          const body = $('#chatBody');
          if (body) body.replaceChildren(h('div', { class: 'empty-note' }, 'В серверах пока нет каналов — создай первый 🛠️'));
        }
      }
    });
  } else {
    state.gview = null;
    $('#chatHead').replaceChildren(
      h('button', { class: 'burger', id: 'chatBurger', type: 'button', title: 'Меню' }, '☰'),
      h('div', { class: 'avatar', id: 'chatAvatar' }),
      h('div', {}, h('div', { class: 'chat-title', id: 'chatTitle' }), h('div', { class: 'chat-status', id: 'chatStatus' })),
      h('div', { class: 'spacer' }),
      h('button', { class: 'menu-btn', id: 'chatMenu', type: 'button' }, '⋯')
    );
    $('#chatBurger').addEventListener('click', openDrawer);
    $('#chatMenu').addEventListener('click', showChatMenu);
    $('#chatBody').replaceChildren(h('div', { class: 'empty-note' }, 'Выбери друга слева 💬'));
    renderDmSide();
  }
}

function renderDmSide() {
  const box = $('#sideVbox');
  if (!box) return;
  const head = h('div', { class: 'side-head' },
    h('div', { class: 'mini-brand' },
      h('span', {}, 'Чаты'),
      h('span', { class: 'side-count', id: 'sideCount' }),
      h('button', { class: 'side-close', id: 'sideClose', type: 'button', title: 'Закрыть' }, '✕')
    ),
    h('div', { class: 'add-row' },
      h('input', { id: 'addNick', placeholder: 'Имя друга…', maxlength: '20' }),
      h('button', { id: 'addGo', type: 'button' }, '+')
    )
  );
  const list = h('div', { class: 'friend-list', id: 'friendList' });
  box.replaceChildren(head, list);
  $('#sideClose').addEventListener('click', closeDrawer);
  $('#addGo').addEventListener('click', addFriend);
  $('#addNick').addEventListener('keydown', e => { if (e.key === 'Enter') addFriend(); });
  renderFriends();
}

function renderGuildSide() {
  const box = $('#sideVbox');
  if (!box) return;
  const isOwner = g => g.owner === String(state.me).toLowerCase();
  const head = h('div', { class: 'side-head' },
    h('div', { class: 'mini-brand' },
      h('span', {}, 'Серверы'),
      h('span', { class: 'side-count', id: 'sideCount' }, state.guilds.length),
      h('button', { class: 'side-close', id: 'sideClose', type: 'button', title: 'Закрыть' }, '✕')
    ),
    h('div', { class: 'add-row' },
      h('button', { class: 'g-action', id: 'gNew', type: 'button', title: 'Создать сервер' }, '+'),
      h('button', { class: 'g-action', id: 'gJoin', type: 'button', title: 'Присоединиться по коду' }, '🔗')
    )
  );
  const list = h('div', { class: 'gpanel', id: 'gList' });
  if (!state.guilds.length) {
    list.append(h('div', { class: 'empty-note' }, 'Серверов пока нет. Создай свой! 🏰'));
  }
  for (const g of state.guilds) {
    const activeG = state.gview && state.gview.guildId === g.id;
    const row = h('div', { class: 'g-item' + (activeG ? ' on' : '') },
      h('button', { class: 'g-name', type: 'button' }, g.name,
        h('span', { class: 'g-sub' }, g.members.length + ' участн. · #' + String(g.code).toUpperCase())),
      h('span', { class: 'g-badge', id: 'gBadge_' + g.id })
    );
    if (activeG) {
      for (const ch of g.channels) {
        const activeCh = state.gview.channelId === ch.id;
        const btn = h('button', { class: 'g-ch' + (activeCh ? ' on' : ''), type: 'button' },
          h('span', { class: 'g-ico' }, ch.kind === 'voice' ? '🔊' : '#'),
          h('span', {}, ch.name));
        if (activeCh) btn.classList.add('on');
        btn.addEventListener('click', () => openGuildChannel(g, ch));
        row.append(btn);
      }
      if (isOwner(g)) {
        const chRow = h('div', { class: 'g-chadd' },
          h('button', { class: 'g-action', id: 'gAddCh_' + g.id, type: 'button' }, '+ канал'),
          h('button', { class: 'g-action ghost', id: 'gDelCh_' + g.id, type: 'button' }, '─ канал'));
        chRow.querySelector('#gAddCh_' + g.id).addEventListener('click', async () => {
          const kind = confirm('Голосовой канал?') ? 'voice' : 'text';
          const name = prompt('Название канала:', kind === 'text' ? 'общий' : 'голосовой');
          if (name === null) return;
          try { await api('POST', '/api/guild/channel', { guildId: g.id, kind, name }); await loadGuilds(); }
          catch (e) { toast(e.message, 'err'); }
        });
        chRow.querySelector('#gDelCh_' + g.id).addEventListener('click', async () => {
          const del = state.gview && state.gview.guildId === g.id ? document.querySelector('.g-ch.on') : null;
          if (!del) { toast('Сначала выбери канал', 'err'); return; }
          const chId = state.gview.channelId;
          if (!confirm('Удалить канал?')) return;
          try {
            await api('DELETE', '/api/guild/channel', { guildId: g.id, channelId: chId });
            state.gview = null;
            await loadGuilds();
            if (state.guilds.length) openGuildChannel(g, state.guilds.find(x => x.id === g.id).channels[0]);
          } catch (e) { toast(e.message, 'err'); }
        });
        row.append(chRow);
      }
    }
    row.querySelector('.g-name').addEventListener('click', () => {
      if (activeG) return;
      openGuildChannel(g, g.channels[0]);
    });
    row.querySelector('.g-name').addEventListener('contextmenu', e => {
      e.preventDefault();
      gMenu(g);
    });
    list.append(row);
  }
  box.replaceChildren(head, list);
  $('#sideClose').addEventListener('click', closeDrawer);
  $('#gNew').addEventListener('click', async () => {
    const name = prompt('Название сервера:');
    if (name === null) return;
    try { await api('POST', '/api/guild', { name }); await loadGuilds(); }
    catch (e) { toast(e.message, 'err'); }
  });
  $('#gJoin').addEventListener('click', async () => {
    const code = prompt('Код приглашения (6 символов):');
    if (!code) return;
    try {
      const r = await api('POST', '/api/guild/join', { code });
      await loadGuilds();
      toast('Ты в сервере «' + r.guild.name + '» 🎉');
    } catch (e) { toast(e.message, 'err'); }
  });
  updateGuildBadges();
}

function gMenu(g) {
  const isOwner = g.owner === String(state.me).toLowerCase();
  const modal = h('div', { class: 'modal' },
    h('h3', {}, g.name),
    h('p', {}, 'Код приглашения: ' + String(g.code).toUpperCase()),
    h('button', { class: 'btn-primary', style: 'width:100%;margin-bottom:8px', type: 'button' }, 'Скопировать код'),
    h('button', { class: 'btn-ghost', style: 'width:100%;margin-bottom:8px', type: 'button' }, 'Выйти из сервера'),
    isOwner ? h('button', { class: 'btn-danger', style: 'width:100%', type: 'button' }, 'Удалить сервер') : null
  );
  const ov = attachOverlay(modal);
  modal.querySelectorAll('button')[0].addEventListener('click', () => { fallbackCopy(String(g.code).toUpperCase()); toast('Код скопирован 🔗'); closeModal(ov); });
  modal.querySelectorAll('button')[1].addEventListener('click', async () => {
    try { await api('POST', '/api/guild/leave', { guildId: g.id }); state.gview = null; closeModal(ov); await loadGuilds(); }
    catch (e) { toast(e.message, 'err'); }
  });
  if (isOwner) {
    modal.querySelectorAll('button')[2].addEventListener('click', async () => {
      if (!confirm('Удалить сервер навсегда?')) return;
      try { await api('DELETE', '/api/guild', { guildId: g.id }); state.gview = null; closeModal(ov); await loadGuilds(); }
      catch (e) { toast(e.message, 'err'); }
    });
  }
  document.body.append(ov);
}

function updateGuildBadges() {
  for (const g of state.guilds) {
    const b = $('#gBadge_' + g.id);
    if (b) {
      b.replaceChildren();
      const n = guildUnread(g);
      if (n) b.append(String(n));
    }
  }
}

async function openGuildChannel(guild, ch) {
  if (!guild || !ch) return;
  if (call && !(call.guildId === guild.id && call.channelId === ch.id)) closeCall(false);
  state.gview = { guildId: guild.id, channelId: ch.id };
  state.conv = null; state.shared = null; state.lastTs = 0;
  state.msgs = [];
  renderGuildSide();

  const head = $('#chatHead');
  if (head) {
    head.replaceChildren(
      h('button', { class: 'burger', id: 'chatBurger', type: 'button', title: 'Меню' }, '☰'),
      h('div', { class: 'avatar g-avatar' }, ch.kind === 'voice' ? '🔊' : '#'),
      h('div', {},
        h('div', { class: 'chat-title', id: 'chatTitle' }, (ch.kind === 'voice' ? '🔊 ' : '# ') + ch.name),
        h('div', { class: 'chat-status', id: 'chatStatus' }, guild.name + ' · ' + guild.members.length + ' участн.')
      ),
      h('div', { class: 'spacer' }),
      h('button', { class: 'menu-btn', id: 'chatMenu', type: 'button' }, '⋯')
    );
    $('#chatBurger').addEventListener('click', openDrawer);
    $('#chatMenu').addEventListener('click', () => gMenu(guild));
  }

  const body = $('#chatBody'), input = $('#msgInput');
  body.replaceChildren(h('div', { class: 'empty-note' }, 'Загружаем историю…'));
  if (input) input.placeholder = ch.kind === 'voice' ? 'В голосовом канале пишут…' : 'Сообщение в канал…';

  if (ch.kind === 'voice') {
    openVoiceCall(guild, ch);
    return;
  }

  if (!guild.members.length || !guild.members.some(m => m.pub)) {
    body.replaceChildren(h('div', { class: 'empty-note' }, 'Ещё нет участников с ключами — пригласи друзей по коду 🔗'));
    return;
  }

  const aad = gAad(guild.id, ch.id);
  try {
    const r = await api('GET', '/api/guild/conv/' + encodeURIComponent(guild.id) + '/' + encodeURIComponent(ch.id) + '?after=0');
    renderGuildMsgs(r.msgs, aad, false);
    api('POST', '/api/seen', { nick: 'g:' + guild.id }).catch(() => {});
  } catch (e) {
    body.replaceChildren(h('div', { class: 'empty-note' }, 'Не удалось загрузить канал: ' + (e.message || e)));
  }
}

// ---------- звонки (голосовые каналы, WebRTC P2P) ----------
const CALL_WAIT_MS = 15 * 60 * 1000; // ждём собеседника до 15 минут
let call = null; // { guildId, channelId, guild, ch, peers, pcMap, localStream, camStream, screenStream, micOn, camOn, screenOn, waitMs, waitTimer, closed }

function wsMessage(obj) { if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(obj)); }

function callControlBtn(id, text, title, on) {
  return h('button', { class: 'call-btn' + (on ? ' on' : ''), id, type: 'button', title }, text);
}
function callVideoBox(nick, local) {
  const box = h('div', { class: 'call-video' + (local ? ' local' : '') },
    h('div', { class: 'call-avatar' }, avatarEl(nick, 56)),
    h('video', { class: 'call-vid', autoplay: '1', playsinline: '1', muted: local ? '1' : '' }),
    h('div', { class: 'call-name' }, local ? 'Ты' : nick)
  );
  return box;
}

function buildCallPanel(mode) {
  const status = h('div', { class: 'call-status', id: 'callStatus' });
  const timer = h('div', { class: 'call-wait-timer', id: 'callWaitTimer' });
  const videos = h('div', { class: 'call-videos', id: 'callVideos' });
  const controls = h('div', { class: 'call-controls' },
    callControlBtn('callMic', '🎤', 'Микрофон', true),
    callControlBtn('callCam', '📹', 'Камера', false),
    callControlBtn('callScreen', '🖥', 'Экран', false),
    callControlBtn('callLeave', '📞', 'Выйти из звонка', false)
  );
  if (mode === 'waiting') {
    status.textContent = 'Ожидание собеседника…';
    timer.textContent = fmtWait(15 * 60);
  }
  return h('div', { class: 'call-panel' }, status, timer, videos, controls);
}

function fmtWait(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

async function openVoiceCall(guild, ch) {
  if (call && call.guildId === guild.id && call.channelId === ch.id) return;
  closeCall(false);
  const input = $('#chatInput');
  if (input) input.style.display = 'none';
  const body = $('#chatBody');
  if (body) body.replaceChildren(buildCallPanel('waiting'));
  call = {
    guildId: guild.id, channelId: ch.id, guild, ch,
    peers: new Map(), pcMap: new Map(), mySid: null,
    localStream: null, camStream: null, screenStream: null,
    micOn: true, camOn: false, screenOn: false,
    waitMs: CALL_WAIT_MS, waitTimer: null, closed: false
  };
  $('.call-btn') && (() => {})();
  document.getElementById('callMic').addEventListener('click', toggleMic);
  document.getElementById('callCam').addEventListener('click', toggleCam);
  document.getElementById('callScreen').addEventListener('click', toggleScreen);
  document.getElementById('callLeave').addEventListener('click', () => leaveCall('Ты вышел из звонка'));
  startWaitTimer();
  // захват микрофона и вход в комнату
  try {
    call.localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    toast('Не удалось включить микрофон: ' + (e.message || e), 'err');
  }
  wsMessage({ type: 'voice', action: 'join', guildId: guild.id, channelId: ch.id });
  if (new URLSearchParams(location.search).get('dbg') === '1') {
    console.info('[voice] join sent', guild.id, ch.id, 'me=', state.me, 'ws=', state.ws ? state.ws.readyState : 'none');
  }
}

function startWaitTimer() {
  if (!call || call.waitTimer) return;
  call.waitMs = CALL_WAIT_MS;
  const t0 = $('#callWaitTimer');
  if (t0) { t0.textContent = fmtWait(15 * 60); t0.style.display = ''; }
  call.waitTimer = setInterval(() => {
    if (!call || call.closed) { clearInterval(call.waitTimer); call.waitTimer = null; return; }
    if (call.peers.size >= 1) { clearInterval(call.waitTimer); call.waitTimer = null; return; }
    call.waitMs -= 1000;
    const t = $('#callWaitTimer');
    if (t) t.textContent = fmtWait(Math.max(0, Math.ceil(call.waitMs / 1000)));
    if (call.waitMs <= 0) {
      clearInterval(call.waitTimer); call.waitTimer = null;
      leaveCall('Никто не присоединился за 15 минут — звонок завершён');
    }
  }, 1000);
}

function setCallStatus(text) {
  const s = $('#callStatus');
  if (s) s.textContent = text;
}

function renderCallPeers() {
  if (!call) return;
  const videos = $('#callVideos');
  if (!videos) return;
  const meLower = String(state.me).toLowerCase();
  videos.replaceChildren(callVideoBox(meLower, true));
  for (const [sid, nick] of call.peers) {
    const nickL = String(nick).toLowerCase();
    const box = callVideoBox(nickL === meLower ? nick + ' · устройство' : nick, false);
    box.dataset.peer = sid;
    videos.append(box);
    const v = box.querySelector('video');
    if (v) {
      v.muted = false;
      v.autoplay = true;
      v.playsInline = true;
    }
  }
  if (call.peers.size >= 1) {
    setCallStatus('Звонок идёт · ' + (call.peers.size + 1) + ' участн.');
    const t = $('#callWaitTimer');
    if (t) t.style.display = 'none';
  } else {
    setCallStatus('Ожидание собеседника…');
    const t = $('#callWaitTimer');
    if (t) t.style.display = '';
  }
}

function updateVoicePeers(peers) {
  if (!call) return;
  call.peers = new Map();
  for (const p of peers || []) {
    if (p.sid && p.sid !== call.mySid) call.peers.set(p.sid, String(p.nick || '?'));
  }
  renderCallPeers();
  if (call.peers.size >= 1) {
    for (const [sid, nick] of call.peers) ensurePeer(sid, nick).catch(() => {});
  } else {
    closeAllPeers();
    // снова ждём собеседника: таймер ожидания перезапускается
    if (!call.waitTimer) startWaitTimer();
  }
}

async function ensurePeer(sid, nick) {
  if (!call || call.closed) return;
  if (!sid || call.pcMap.has(sid)) return;
  const pc = new RTCPeerConnection({ iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ] });
  call.pcMap.set(sid, pc);
  pc.onicecandidate = e => {
    if (e.candidate && !call.closed) {
      wsMessage({ type: 'voice-signal', to: sid, signal: { kind: 'ice', candidate: e.candidate } });
    }
  };
  pc.ontrack = e => {
    const box = attachRemoteStream(sid, e.streams[0] || new MediaStream([e.track]));
    if (box) box.dataset.peer = sid;
  };
  if (call.localStream) {
    for (const t of call.localStream.getTracks()) pc.addTrack(t, call.localStream);
  }
  if (call.screenStream) {
    for (const t of call.screenStream.getTracks()) pc.addTrack(t, call.screenStream);
  } else if (call.camStream) {
    for (const t of call.camStream.getTracks()) pc.addTrack(t, call.camStream);
  }
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  if (!call.closed) {
    if (new URLSearchParams(location.search).get('dbg') === '1') console.info('[voice] sig offer ->', sid);
    wsMessage({ type: 'voice-signal', to: sid, signal: { kind: 'offer', sdp: pc.localDescription } });
  }
}

function attachRemoteStream(sid, stream) {
  const videos = $('#callVideos');
  if (!videos) return null;
  let box = videos.querySelector(`[data-peer="${sid}"]`);
  if (!box) {
    const nick = call && call.peers.get(sid);
    box = callVideoBox(nick || '…', false);
    box.dataset.peer = sid;
    videos.append(box);
  }
  const v = box.querySelector('video');
  if (v && !v.srcObject) { v.srcObject = stream; v.muted = false; v.autoplay = true; v.playsInline = true; }
  return box;
}

async function handleVoiceSignal(fromSid, signal) {
  if (!call || call.closed) return;
  if (!fromSid || fromSid === call.mySid) return;
  if (new URLSearchParams(location.search).get('dbg') === '1') console.info('[voice] sig recv', signal && signal.kind, 'from', fromSid);
  if (signal.kind === 'offer') {
    if (!call.pcMap.has(fromSid)) {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      call.pcMap.set(fromSid, pc);
      pc.onicecandidate = e => { if (e.candidate && !call.closed) wsMessage({ type: 'voice-signal', to: fromSid, signal: { kind: 'ice', candidate: e.candidate } }); };
      pc.ontrack = e => attachRemoteStream(fromSid, e.streams[0] || new MediaStream([e.track]));
      if (call.localStream) for (const t of call.localStream.getTracks()) pc.addTrack(t, call.localStream);
      if (call.screenStream) for (const t of call.screenStream.getTracks()) pc.addTrack(t, call.screenStream);
      else if (call.camStream) for (const t of call.camStream.getTracks()) pc.addTrack(t, call.camStream);
    }
    const pc = call.pcMap.get(fromSid);
    try {
      await pc.setRemoteDescription(signal.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsMessage({ type: 'voice-signal', to: fromSid, signal: { kind: 'answer', sdp: pc.localDescription } });
    } catch (e) { /* ignore */ }
  } else if (signal.kind === 'answer') {
    const pc = call.pcMap.get(fromSid);
    if (pc) { try { await pc.setRemoteDescription(signal.sdp); } catch (e) {} }
  } else if (signal.kind === 'ice') {
    const pc = call.pcMap.get(fromSid);
    if (pc && signal.candidate) { try { await pc.addIceCandidate(signal.candidate); } catch (e) {} }
  }
}

function closeAllPeers() {
  if (!call) return;
  for (const pc of call.pcMap.values()) { try { pc.close(); } catch (e) {} }
  call.pcMap.clear();
}

function stopStream(s) { if (s) s.getTracks().forEach(t => t.stop()); }

function toggleMic() {
  if (!call) return;
  call.micOn = !call.micOn;
  if (call.localStream) call.localStream.getAudioTracks().forEach(t => t.enabled = call.micOn);
  const b = $('#callMic');
  if (b) b.classList.toggle('on', call.micOn);
}

async function toggleCam() {
  if (!call) return;
  call.camOn = !call.camOn;
  const b = $('#callCam');
  const meL = String(state.me).toLowerCase();
  if (call.camOn) {
    try {
      if (!call.camStream) call.camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      call.camStream.getVideoTracks().forEach(t => t.enabled = true);
      for (const pc of call.pcMap.values()) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) await sender.replaceTrack(call.camStream.getVideoTracks()[0]).catch(() => {});
        else call.camStream.getVideoTracks().forEach(t => pc.addTrack(t, call.camStream));
      }
      const v = document.querySelector('#callVideos .call-video.local video');
      if (v) v.srcObject = call.camStream;
    } catch (e) { toast('Не удалось включить камеру', 'err'); call.camOn = false; }
  } else {
    if (call.camStream) call.camStream.getVideoTracks().forEach(t => t.enabled = false);
    const v = document.querySelector('#callVideos .call-video.local video');
    if (v && v.srcObject === call.camStream) v.removeAttribute('srcObject');
  }
  if (b) b.classList.toggle('on', call.camOn);
}

function stopScreenShareTracks() {
  if (call.screenStream) { stopStream(call.screenStream); call.screenStream = null; }
}

async function toggleScreen() {
  if (!call) return;
  const b = $('#callScreen');
  if (call.screenOn) {
    // выключить демонстрацию: вернуть видео камеры (или ничего)
    call.screenOn = false;
    if (call.camStream) call.camStream.getVideoTracks().forEach(t => t.enabled = true);
    for (const pc of call.pcMap.values()) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender && call.camStream) await sender.replaceTrack(call.camStream.getVideoTracks()[0]).catch(() => {});
      else if (sender) await sender.replaceTrack(null).catch(() => {});
    }
    stopScreenShareTracks();
  } else {
    try {
      call.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      call.screenOn = true;
      if (call.camStream) call.camStream.getVideoTracks().forEach(t => t.enabled = false);
      for (const pc of call.pcMap.values()) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) await sender.replaceTrack(call.screenStream.getVideoTracks()[0]).catch(() => {});
        else call.screenStream.getVideoTracks().forEach(t => pc.addTrack(t, call.screenStream));
      }
      const v = document.querySelector('#callVideos .call-video.local video');
      if (v) v.srcObject = call.screenStream;
      call.screenStream.getVideoTracks()[0].addEventListener('ended', () => { if (call.screenOn) toggleScreen(); });
    } catch (e) { call.screenOn = false; }
  }
  if (b) b.classList.toggle('on', call.screenOn);
}

function closeCall(notify) {
  if (!call) return;
  call.closed = true;
  if (call.waitTimer) { clearInterval(call.waitTimer); call.waitTimer = null; }
  closeAllPeers();
  stopStream(call.localStream); stopStream(call.camStream); stopScreenShareTracks();
  call = null;
  const input = $('#chatInput');
  if (input) input.style.display = '';
  if (notify) {
    const body = $('#chatBody');
    if (body) body.replaceChildren(h('div', { class: 'empty-note' }, notify));
  }
}

function leaveCall(msg) {
  if (call) wsMessage({ type: 'voice', action: 'leave', guildId: call.guildId, channelId: call.channelId });
  closeCall(msg || 'Ты вышел из звонка');
  if (call && call.guild) renderGuildSide();
}

async function renderGuildMsgs(msgs, aad, append) {
  const body = $('#chatBody');
  if (!body) return;
  // общий ключ для каждого собеседника в сервере (E2E: на каждого участника свой конверт)
  const meLower = String(state.me).toLowerCase();
  const g = state.gview ? guildById(state.gview.guildId) : null;
  const sharedCache = {};
  // свой конверт тоже читаем (self-envelope: автор видит свои сообщения)
  sharedCache[meLower] = window.SecCrypto.sharedSecret(state.kp.secretKey, window.SecCrypto.publicB64(state.kp));
  if (g) {
    for (const member of g.members) {
      const nickLower = String(member.nick).toLowerCase();
      if (nickLower !== meLower && member.pub) {
        sharedCache[nickLower] = window.SecCrypto.sharedSecret(state.kp.secretKey, member.pub);
      }
    }
  }
  const nodes = [];
  let lastDay = '';
  if (append) {
    const lastSep = body.querySelectorAll('.day-sep');
    lastDay = lastSep.length ? lastSep[lastSep.length - 1].textContent.trim().toLowerCase() : '';
  }
  let okCnt = 0;
  for (const m of msgs) {
    if (append && body.querySelector(`[data-id="${m.id}"]`)) continue;
    const shared = sharedCache[String(m.from).toLowerCase()];
    if (!shared) continue;
    const pt = await window.SecCrypto.openMessage(shared, m.body, aad);
    if (pt == null) continue;
    okCnt++;
    const day = new Date(m.ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const key = day.charAt(0).toUpperCase() + day.slice(1);
    if (key.toLowerCase() !== lastDay) { lastDay = key.toLowerCase(); nodes.push(h('div', { class: 'day-sep' }, key)); }
    const row = msgEl(m, pt);
    row.setAttribute('data-from', String(m.from).toLowerCase());
    nodes.push(row);
    if (m.ts > state.lastTs) state.lastTs = m.ts;
  }
  if (append) {
    const rows = body.querySelectorAll('.msg-row');
    const lastRow = rows[rows.length - 1];
    if (lastRow && nodes.length) {
      const gap = h('div', { class: 'msg-row', style: 'display:none' });
      body.append(gap);
      for (const n of nodes) body.append(n);
      markGrouped(Array.prototype.slice.call(body.querySelectorAll('.msg-row')));
      gap.remove();
    }
  } else {
    if (!nodes.length) nodes.push(h('div', { class: 'empty-note' }, okCnt === 0 && msgs.length ? 'Не удалось расшифровать — проверь свой ключ 🔑' : 'Канал пуст. Напиши первым ✨'));
    markGrouped(nodes);
    body.replaceChildren(...nodes);
  }
  scrollChat(append ? true : true);
}

async function refreshGuildChat() {
  if (!state.gview) return;
  const g = guildById(state.gview.guildId);
  if (!g) return;
  const ch = g.channels.find(c => c.id === state.gview.channelId);
  if (!ch || ch.kind === 'voice') return;
  try {
    const r = await api('GET', '/api/guild/conv/' + encodeURIComponent(g.id) + '/' + encodeURIComponent(ch.id) + '?after=' + state.lastTs);
    if (r.msgs.length) renderGuildMsgs(r.msgs, gAad(g.id, ch.id), true);
  } catch (e) {}
}

async function sendGuildMessage() {
  const input = $('#msgInput');
  const text = input ? input.value.trim() : '';
  if (!text) { console.info('SGM no-text'); return; }
  state.gLastError = null;
  console.info('SGM start', !!state.gview, text.length);
  const g = guildById(state.gview.guildId);
  const ch = g.channels.find(c => c.id === state.gview.channelId);
  const aad = gAad(g.id, ch.id);
  const env = {};
  const meLower = String(state.me).toLowerCase();
  for (const m of g.members) {
    const nickLower = String(m.nick).toLowerCase();
    if (nickLower === meLower || !m.pub) continue;
    const shared = window.SecCrypto.sharedSecret(state.kp.secretKey, m.pub);
    env[nickLower] = await window.SecCrypto.sealMessage(shared, text, aad);
  }
  // свой конверт тоже кладём — чтобы автор видел своё сообщение в истории
  env[meLower] = await window.SecCrypto.sealMessage(
    window.SecCrypto.sharedSecret(state.kp.secretKey, window.SecCrypto.publicB64(state.kp)), text, aad);
  if (!Object.keys(env).length) { toast('В сервере пока нет собеседников с ключами', 'err'); return; }
  try {
    await api('POST', '/api/guild/msg', { guildId: g.id, channelId: ch.id, body: env });
    console.info('SGM sent', g.id, ch.id, Object.keys(env).length);
    if (input) { input.value = ''; input.style.height = 'auto'; syncComposer(input); }
    await refreshGuildChat();
  } catch (e) {
    state.gLastError = (e && e.message) || String(e);
    toast(state.gLastError, 'err');
  }
}

// Единая точка обновления заявок: WS-push, поллинг и ручные действия ходят сюда.
// announce=true — показать тост о НОВЫХ входящих (первый заход не считается новым).
async function refreshRequests(announce) {
  const r = await api('GET', '/api/friend/requests');
  const prevInc = nicksSig(state.incoming);
  state.incoming = r.incoming;
  state.outgoing = r.outgoing;
  const badge = $('#requestsBadge');
  if (badge) {
    badge.replaceChildren();
    if (state.incoming.length) badge.append(String(state.incoming.length));
  }
  if (document.querySelector('.req-modal')) renderRequests();
  const nowInc = nicksSig(state.incoming);
  if (announce && state.reqLoaded && nowInc !== prevInc) {
    const before = prevInc ? prevInc.split(',') : [];
    const fresh = state.incoming.filter(x => !before.includes(String(x.nick).toLowerCase()));
    if (fresh.length) toast('Новая заявка от ' + fresh.map(x => x.nick).join(', ') + ' 💌');
  }
  state.reqLoaded = true;
  return r;
}

// Друзья: список, онлайн-статусы и ЛЮБЫЕ новые друзья (заявку могли принять без WS-push).
async function refreshFriends() {
  const r = await api('GET', '/api/friends');
  let changed = false;
  let pubChangedForConv = false;
  for (const f of r.friends) {
    const g = state.friends.find(x => String(x.nick).toLowerCase() === String(f.nick).toLowerCase());
    if (!g) { changed = true; continue; }
    if (g.online !== f.online) { g.online = f.online; changed = true; }
    if (g.pub !== f.pub) {
      g.pub = f.pub;
      changed = true;
      // у собеседника сменился ключ — пересчитаем общий секрет и перезагрузим диалог
      if (state.conv && String(f.nick).toLowerCase() === String(state.conv).toLowerCase()) pubChangedForConv = true;
    }
  }
  if (nicksSig(r.friends) !== nicksSig(state.friends)) changed = true;
  if (changed) {
    await loadFriends();
    if (pubChangedForConv) {
      try { await openChat(state.conv); } catch (e) { /* чат уже перезагружен */ }
    } else {
      updateChatHeader();
    }
  }
  return r;
}

function renderRequests() {
  const modal = h('div', { class: 'modal req-modal' });
  const inc = state.incoming, out = state.outgoing;
  modal.append(h('h3', {}, 'Заявки в друзья'),
    h('p', {}, 'Посмотри, кто хочет добавить тебя, и отправь свои.'));
  if (!inc.length && !out.length) modal.append(h('div', { class: 'empty-note' }, 'Заявок нет 🤍'));
  if (inc.length) {
    modal.append(h('h3', { style: 'font-size:14px;margin-top:14px' }, 'Входящие'));
    for (const r of inc) {
      const row = h('div', { class: 'req-item' },
        avatarEl(r.nick),
        h('div', { class: 'req-name' }, r.nick),
        h('div', { class: 'req-actions' },
          h('button', { class: 'btn-primary', style: 'flex:0 0 auto;padding:7px 14px;width:auto', type: 'button' }, 'Принять'),
          h('button', { class: 'btn-danger', style: 'flex:0 0 auto', type: 'button' }, 'Отклонить')
        )
      );
      row.querySelectorAll('button')[0].addEventListener('click', async () => {
        try {
          await api('POST', '/api/friend/accept', { nick: r.nick });
          toast(r.nick + ' теперь твой друг 🎉');
          closeModal();
          await Promise.all([loadFriends(), loadRequests()]);
          state.unread[r.nick.toLowerCase()] = 0;
        } catch (e) { toast(e.message, 'err'); }
      });
      row.querySelectorAll('button')[1].addEventListener('click', async () => {
        try { await api('POST', '/api/friend/decline', { nick: r.nick }); loadRequests(); closeModal(); }
        catch (e) { toast(e.message, 'err'); }
      });
      modal.append(row);
    }
  }
  if (out.length) {
    modal.append(h('h3', { style: 'font-size:14px;margin-top:14px' }, 'Исходящие'));
    for (const r of out) {
      const row = h('div', { class: 'req-item' },
        avatarEl(r.nick),
        h('div', { class: 'req-name' }, r.nick),
        h('button', { class: 'btn-ghost', style: 'flex:0 0 auto', type: 'button' }, 'Отменить')
      );
      row.querySelector('button').addEventListener('click', async () => {
        try { await api('POST', '/api/friend/decline', { nick: r.nick }); loadRequests(); closeModal(); }
        catch (e) { toast(e.message, 'err'); }
      });
      modal.append(row);
    }
  }
  modal.append(h('div', { class: 'modal-actions' }, h('button', { class: 'btn-ghost', id: 'reqClose', type: 'button' }, 'Закрыть')));
  modal.querySelector('#reqClose').addEventListener('click', closeModal);
  attachOverlay(modal);
}

function logout() {
  stopPoll();
  closeCall(false);
  closeDrawer();
  closeRightPanel();
  state.ws?.close();
  localStorage.removeItem(LS.nick);
  localStorage.removeItem(LS.token);
  state.token = null; state.me = null; state.conv = null;
  state.kp = null; state.pass = null; // ключ остаётся в localStorage под своим ником, пароль — не хранится нигде
  state.incoming = []; state.outgoing = []; state.reqLoaded = false;
  state.guilds = []; state.gview = null; state.view = 'dm';
  renderAuth();
}

// ---------- чат ----------
async function openChat(nick) {
  try {
  closeCall(false);
  state.conv = nick;
  state.gview = null;
  state.msgs = [];
  state.lastTs = 0;
  const f = state.friends.find(x => x.nick === nick);
  if (f) { state.convPub = f.pub; state.shared = null; }
  renderFriends();

  const head = $('#chatHead'), body = $('#chatBody');
  if (!head) return;
  const online = f ? f.online : false;
  head.replaceChildren(
    h('button', { class: 'burger', id: 'chatBurger', type: 'button', title: 'Меню' }, '☰'),
    avatarEl(nick),
    h('div', {},
      h('div', { class: 'chat-title', id: 'chatTitle' }, nick, h('span', { class: 'dot' + (online ? ' on' : '') })),
      h('div', { class: 'chat-status', id: 'chatStatus' }, online ? 'онлайн' : 'не в сети')
    ),
    h('div', { class: 'spacer' }),
    h('button', { class: 'menu-btn', id: 'chatInfo', type: 'button', title: 'Информация о собеседнике' }, 'ℹ️'),
    h('button', { class: 'menu-btn', id: 'chatMenu', type: 'button' }, '⋯')
  );
  $('#chatMenu').addEventListener('click', showChatMenu);
  $('#chatBurger').addEventListener('click', openDrawer);
  $('#chatInfo').addEventListener('click', toggleRightPanel);
  const avNow = head.querySelector('.avatar');
  if (avNow) avNow.id = 'chatAvatar';

  body.replaceChildren(h('div', { class: 'empty-note' }, 'Загружаем историю…'));
  $('#msgInput').focus();

  renderRightPanel(f || null);

  if (!f || !f.pub) {
    body.replaceChildren(h('div', { class: 'empty-note' }, 'Ключ друга ещё не получен 🤔'));
    return;
  }

  state.shared = window.SecCrypto.sharedSecret(state.kp.secretKey, f.pub);
  const aad = convKey(state.me, nick);

  try {
    const r = await api('GET', '/api/conv/' + encodeURIComponent(nick) + '?after=0');
    const arr = r.msgs;
    const nodes = [];
    let lastDay = '';
    let okCnt = 0;
    for (const m of arr) {
      const pt = await window.SecCrypto.openMessage(state.shared, m.body, aad);
      if (pt == null) continue;
      okCnt++;
      const day = new Date(m.ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      if (day !== lastDay) { lastDay = day; nodes.push(h('div', { class: 'day-sep' }, day.charAt(0).toUpperCase() + day.slice(1))); }
      nodes.push(msgEl(m, pt));
      if (m.ts > state.lastTs) state.lastTs = m.ts;
    }
    const bodyNow = $('#chatBody');
    if (!nodes.length) nodes.push(h('div', { class: 'empty-note' }, okCnt === 0 && arr.length ? 'История не расшифровалась — проверь ключ' : 'Пока тихо. Напиши первым(ой) ✨'));
    markGrouped(nodes);
    bodyNow.replaceChildren(...nodes);
    state.unread[nick.toLowerCase()] = 0;
    renderFriends();
    scrollChat(true);
    state.typing[nick] = 0;
    updateTypingHint();
    api('POST', '/api/seen', { nick }).catch(() => {});
    applyFill();
  } catch (e) {
    body.replaceChildren(h('div', { class: 'empty-note' }, 'Не удалось загрузить историю: ' + (e && e.message ? e.message : e)));
  }
  } catch (e) {
    const body = $('#chatBody');
    if (body) body.replaceChildren(h('div', { class: 'empty-note' }, 'Ошибка чата: ' + (e && e.message ? e.message : e)));
  }
}

function humanSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' Б';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
  return (n / (1024 * 1024)).toFixed(1) + ' МБ';
}

function iconFor(mime, name) {
  const n = (name || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(n)) return '🖼️';
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/.test(n)) return '🎬';
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/.test(n)) return '🎵';
  if (/\.(pdf)$/.test(n)) return '📕';
  if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return '🗜️';
  if (/\.(docx?|xlsx?|pptx?)$/.test(n)) return '📑';
  return '📄';
}

// Рендер сообщения: строка с аватаркой + пузырь (текст или файл)
function msgEl(m, text) {
  // сравнение без учёта регистра: защита от ников, записанных с разным CapsLock
  const mine = String(m.from).toLowerCase() === String(state.me).toLowerCase();
  const nick = mine ? state.me : (state.conv || m.from);
  const row = h('div', { class: 'msg-row ' + (mine ? 'mine' : 'theirs'), 'data-id': m.id, 'data-from': String(m.from).toLowerCase() },
    avatarEl(nick, 28)
  );
  // дата у каждого сообщения не показывается — она в подсказке при наведении
  const bubble = h('div', { class: 'msg ' + (mine ? 'mine' : 'theirs'), title: fullStamp(m.ts) });

  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* не JSON — обычный текст */ }

  if (parsed && (parsed.t === 'file' || parsed.t === 'circle' || parsed.t === 'voice')) {
    const isCircle = parsed.t === 'circle';
    let card;
    if (parsed.t === 'voice') {
      card = voiceCard(parsed);
    } else if (isCircle) {
      card = h('div', { class: 'file-card circle' },
        h('div', { class: 'circle-inner' },
          h('button', { class: 'circle-play', type: 'button' }, '▶')
        )
      );
    } else {
      const info = h('div', { class: 'file-info' },
        h('div', { class: 'file-name' }, parsed.n || 'файл'),
        h('div', { class: 'file-meta' }, humanSize(parsed.s))
      );
      card = h('div', { class: 'file-card' },
        h('div', { class: 'file-ico' }, iconFor(parsed.m, parsed.n)),
        info
      );
    }
    bubble.append(card);
    hydrateFile(card, card.querySelector('.file-info'), parsed);
  } else {
    bubble.append(text);
  }

  row.append(bubble);
  return row;
}

// Полная метка времени для подсказки («21 ноября, 03:01»)
function fullStamp(ts) {
  const d = new Date(ts);
  const day = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return day + ', ' + timeStr(ts);
}

// Подряд идущие сообщения одного автора: следующая строка получает класс grouped
// (аватарка не дублируется, пузыри выстраиваются ровным столбиком)
function markGrouped(rows) {
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i], prev = rows[i - 1];
    if (cur && prev && cur.classList && prev.classList
      && cur.classList.contains('msg-row') && prev.classList.contains('msg-row')
      && cur.dataset.from === prev.dataset.from) cur.classList.add('grouped');
  }
}

async function hydrateFile(card, info, meta) {
  try {
    const res = await fetch('/api/media/' + encodeURIComponent(meta.id), {
      headers: { Authorization: 'Bearer ' + state.token }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const ab = await res.arrayBuffer();
    const aad = convKey(state.me, state.conv || meta.to || '');
    const pt = await window.SecCrypto.openBytes(state.shared, new Uint8Array(ab), aad);
    if (!pt) throw new Error('bad decrypt');
    const blob = new Blob([pt], { type: meta.m || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    if (meta.t === 'circle') {
      const inner = card.querySelector('.circle-inner');
      if (!inner) return;
      const video = h('video', { class: 'circ-video', src: url, muted: '', playsinline: '' });
      const play = h('button', { class: 'circle-play', type: 'button' }, '▶');
      inner.replaceChildren(video, play);
      const showPlay = () => { play.style.display = 'grid'; };
      video.addEventListener('click', () => {
        if (video.paused) { video.play().catch(() => {}); play.style.display = 'none'; }
        else { video.pause(); showPlay(); }
      });
      play.addEventListener('click', () => {
        video.play().catch(() => {});
        play.style.display = 'none';
      });
      // одно нажатие — один просмотр: после конца показываем ▶ снова
      video.addEventListener('ended', showPlay);
      return;
    }

    if (meta.t === 'voice') {
      const play = card.querySelector('.voice-play');
      const bars = card.querySelector('.voice-bars');
      const durEl = card.querySelector('.voice-dur');
      const audio = h('audio', { src: url, preload: 'metadata' });
      card.append(audio);
      const total = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
      const paint = () => {
        const d = total();
        if (durEl && d) durEl.textContent = fmtDur(d);
        if (!bars) return;
        const n = d ? Math.round((audio.currentTime / d) * bars.children.length) : 0;
        for (let i = 0; i < bars.children.length; i++) bars.children[i].classList.toggle('on', i < n);
      };
      audio.addEventListener('loadedmetadata', paint);
      audio.addEventListener('timeupdate', paint);
      audio.addEventListener('pause', () => { play.textContent = '▶'; card.classList.remove('playing'); });
      audio.addEventListener('ended', () => { play.textContent = '▶'; card.classList.remove('playing'); paint(); });
      play.addEventListener('click', () => {
        if (audio.paused) {
          // другие голосовые в чате ставим на паузу, чтобы не накладывались
          document.querySelectorAll('.file-card.voice audio').forEach(a => { if (a !== audio) a.pause(); });
          audio.play()
            .then(() => { play.textContent = '⏸'; card.classList.add('playing'); })
            .catch(() => toast('Не удалось воспроизвести', 'err'));
        } else {
          audio.pause();
        }
      });
      if (bars) bars.addEventListener('click', e => {
        const d = total();
        if (!d) return;
        const r = bars.getBoundingClientRect();
        audio.currentTime = Math.min(d, Math.max(0, ((e.clientX - r.left) / Math.max(1, r.width)) * d));
        paint();
      });
      return;
    }

    if (meta.m && meta.m.startsWith('image/')) {
      card.classList.add('has-preview');
      card.append(h('img', { class: 'file-preview', src: url, alt: meta.n || '', loading: 'lazy' }));
    } else if (meta.m && meta.m.startsWith('video/')) {
      card.classList.add('has-preview');
      card.append(h('video', { class: 'file-video', src: url, controls: true }));
    } else if (meta.m && meta.m.startsWith('audio/')) {
      card.classList.add('has-preview');
      card.append(h('audio', { class: 'file-audio', src: url, controls: true }));
    } else {
      info.append(h('a', { class: 'file-dl', href: url, download: meta.n || 'file' }, '⬇ Скачать'));
    }
  } catch (e) {
    card.classList.add('broken');
    if (card.querySelector('.circle-inner')) {
      card.querySelector('.circle-inner').replaceChildren(h('div', { class: 'file-meta' }, 'не удалось расшифровать'));
    } else {
      card.append(h('div', { class: 'file-meta' }, 'не удалось расшифровать'));
    }
  }
}

function appendReceived(m, text, force) {
  const body = $('#chatBody');
  if (!body) return;
  const day = new Date(m.ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const dayKey = day.charAt(0).toUpperCase() + day.slice(1);
  // ищем ПОСЛЕДНИЙ разделитель в переписке, а не последний элемент списка:
  // иначе после каждого живого сообщения рисовался бы новый «день»
  const seps = body.querySelectorAll('.day-sep');
  const lastDay = seps.length ? seps[seps.length - 1].textContent.trim().toLowerCase() : '';
  const isNewDay = lastDay !== dayKey.toLowerCase();
  if (isNewDay) body.append(h('div', { class: 'day-sep' }, dayKey));
  const row = msgEl(m, text);
  body.append(row);
  if (isNewDay) row.classList.remove('grouped');
  else markGrouped(Array.prototype.slice.call(body.querySelectorAll('.msg-row'), -2));
  scrollChat(force);
}

function nearBottom(body) {
  return body.scrollHeight - body.scrollTop - body.clientHeight < 120;
}

function updateJump() {
  const jump = $('#jumpDown');
  const body = $('#chatBody');
  if (jump && body) jump.classList.toggle('show', !nearBottom(body));
}

function scrollChat(force) {
  const body = $('#chatBody');
  if (!body) return;
  if (!force && !nearBottom(body)) return;
  body.scrollTop = body.scrollHeight;
  updateJump();
}

async function sendMessage() {
  const input = $('#msgInput');
  const text = input.value.trim();
  if (!text) return;
  if (state.gview) { await sendGuildMessage(); return; }
  if (!state.conv) return;
  if (!state.shared) { toast('Нет ключа для собеседника', 'err'); return; }
  try {
    const aad = convKey(state.me, state.conv);
    const body = await window.SecCrypto.sealMessage(state.shared, text, aad);
    const r = await api('POST', '/api/msg', { to: state.conv, body });
    const m = { id: r.id, from: state.me, ts: r.ts };
    appendReceived(m, text, true);
    if (r.ts > state.lastTs) state.lastTs = r.ts;
    input.value = ''; input.style.height = 'auto'; syncComposer(input);
  } catch (e) {
    toast('Не удалось отправить: ' + e.message, 'err');
  }
}

async function sendFile(file) {
  if (state.gview) { toast('Файлы в каналах пока недоступны — скоро 🙃', 'err'); $('#fileInput').value = ''; return; }
  if (!state.conv) return;
  if (!state.shared) { toast('Нет ключа для собеседника', 'err'); return; }
  if (file.size > 15 * 1024 * 1024) { toast('Файл больше 15 МБ — выбери поменьше', 'err'); $('#fileInput').value = ''; return; }
  const btn = $('#attachBtn');
  if (btn) { btn.classList.add('busy'); btn.textContent = '⏳'; }
  try {
    const buf = await file.arrayBuffer();
    await sendEncodedMedia(new Uint8Array(buf), file.name, file.type || 'application/octet-stream', file.size, { t: 'file' });
  } catch (e) {
    toast('Не удалось отправить файл: ' + e.message, 'err');
  } finally {
    if (btn) { btn.classList.remove('busy'); btn.textContent = '📎'; }
    $('#fileInput').value = '';
  }
}

// Общий путь отправки медиа: шифрование → /api/media → шифрование метаданных → /api/msg
async function sendEncodedMedia(buf, name, mime, size, meta) {
  if (state.gview) { toast('Файлы в каналах пока недоступны — скоро 🙃', 'err'); return; }
  const aad = convKey(state.me, state.conv);
  const env = await window.SecCrypto.sealBytes(state.shared, buf, aad);
  const up = await api('POST', '/api/media', { to: state.conv, name, mime, size, b64: env });
  const body = JSON.stringify({ t: meta.t || 'file', id: up.id, n: name, m: mime, s: up.size, d: meta.d || 0 });
  const sealed = await window.SecCrypto.sealMessage(state.shared, body, aad);
  const r = await api('POST', '/api/msg', { to: state.conv, body: sealed });
  const m = { id: r.id, from: state.me, ts: r.ts };
  appendReceived(m, body, true);
  if (r.ts > state.lastTs) state.lastTs = r.ts;
}

// ---------- запись: одна кнопка, два режима (голосовое / кружок) ----------
// Тап по кнопке — переключить режим; удержание — писать и отправить при отпускании.
let recMode = (function () { try { return localStorage.getItem('sk_recmode') || 'voice'; } catch (e) { return 'voice'; } })();
let rec = null;          // активная запись: { mode, stream, recorder, bubble, timer, startedAt, iv }
let recPending = null;   // запрос доступа к микрофону/камере ещё не завершён
let recSeq = 0;
const REC_LIMIT = { voice: 300, circle: 60 };   // максимальная длина, секунды

function fmtDur(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// Пустое поле — кнопка «записать», есть текст — «отправить»
function syncComposer(input) {
  const el = input || $('#msgInput');
  if (!el) return;
  const wrap = el.closest ? el.closest('.chat-input') : null;
  if (wrap) wrap.classList.toggle('no-text', !String(el.value || '').trim());
}

function paintRecButton() {
  const b = $('#recBtn');
  if (!b) return;
  const circle = recMode === 'circle';
  b.dataset.mode = recMode;
  b.textContent = circle ? '📹' : '🎤';
  b.classList.toggle('circle-mode', circle);
  b.title = circle
    ? 'Удерживай — кружок · тап — переключить на голосовое'
    : 'Удерживай — голосовое · тап — переключить на кружок';
}

function bindRecButton() {
  paintRecButton();
  const b = $('#recBtn');
  if (!b) return;
  let from = 0, holdTimer = null, started = false;

  const stopHold = cancel => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (started) { started = false; endRec(); return; }
    if (cancel) return;
    if (Date.now() - from < 500) {                 // короткое нажатие = тап
      recMode = recMode === 'voice' ? 'circle' : 'voice';
      try { localStorage.setItem('sk_recmode', recMode); } catch (e) {}
      paintRecButton();
      toast(recMode === 'voice' ? 'Голосовое 🎤' : 'Кружок 📹', 'ok');
    }
  };

  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    from = Date.now(); started = false;
    try { b.setPointerCapture(e.pointerId); } catch (_) {}
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { started = true; beginRec(recMode); }, 220);
  });
  b.addEventListener('pointerup', () => stopHold(false));
  b.addEventListener('pointerleave', e => { if (e.buttons) stopHold(true); });
  b.addEventListener('pointercancel', () => stopHold(true));
  b.addEventListener('contextmenu', e => e.preventDefault());
}

async function beginRec(mode) {
  if (!state.conv) return;
  if (!state.shared) { toast('Нет ключа для собеседника', 'err'); return; }
  if (rec || recPending) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Запись не поддерживается в этом браузере', 'err');
    return;
  }
  if (!window.MediaRecorder) { toast('Запись не поддерживается в этом браузере', 'err'); return; }

  const wantVideo = mode === 'circle';
  const seq = ++recSeq;
  recPending = { mode };

  const audioC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(wantVideo
      ? { video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 } }, audio: audioC }
      : { audio: audioC });
  } catch (e) {
    if (seq === recSeq) recPending = null;
    toast(wantVideo ? 'Не удалось включить камеру или микрофон' : 'Не удалось включить микрофон', 'err');
    return;
  }

  // отпустили, пока браузер спрашивал доступ: ничего не пишем и не оставляем окно записи
  if (!recPending || seq !== recSeq) {
    stream.getTracks().forEach(t => t.stop());
    return;
  }
  recPending = null;

  const bubble = h('div', { class: 'rec-bubble ' + (wantVideo ? 'video' : 'voice') });
  const timer = h('div', { class: wantVideo ? 'rec-timer-badge' : 'rec-timer-inline' }, '0:00');
  if (wantVideo) {
    const live = h('video', { class: 'circ-live', autoplay: '', muted: '', playsinline: '' });
    live.muted = true; // никогда не воспроизводим свой микрофон локально
    live.srcObject = stream;
    live.play().catch(() => {});
    bubble.append(live, timer);
  } else {
    const wave = h('div', { class: 'rec-wave' }, ...Array.from({ length: 7 }, () => h('span', {})));
    bubble.append(h('div', { class: 'rec-mic' }, '🎤'), wave, timer, h('div', { class: 'rec-hint' }, 'отпусти — отправлю'));
  }
  document.body.append(bubble);

  let recorder;
  const mime = wantVideo
    ? (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm')
    : (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'));
  try { recorder = new MediaRecorder(stream, { mimeType: mime }); }
  catch (e) { recorder = new MediaRecorder(stream); }

  const startedAt = Date.now(), chunks = [];
  recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    const dur = Date.now() - startedAt;
    const type = recorder.mimeType || (wantVideo ? 'video/webm' : 'audio/webm');
    const blob = new Blob(chunks, { type });
    cleanupRec();
    if (dur < 500 || !chunks.length) { toast('Слишком коротко — подержи чуть дольше', 'err'); return; }
    (async () => {
      try {
        const name = (wantVideo ? 'video_' : 'voice_') + Date.now() + (type.indexOf('mp4') >= 0 ? '.m4a' : '.webm');
        const meta = wantVideo ? { t: 'circle' } : { t: 'voice', d: Math.max(1, Math.round(dur / 1000)) };
        await sendEncodedMedia(new Uint8Array(await blob.arrayBuffer()), name, type, blob.size, meta);
        toast(wantVideo ? 'Кружок отправлен 🎥' : 'Голосовое отправлено 🎤', 'ok');
      } catch (e) { toast('Ошибка отправки: ' + e.message, 'err'); }
    })();
  };

  rec = { mode, stream, recorder, bubble, timer, startedAt };
  recorder.start(250);
  rec.iv = setInterval(() => {
    if (!rec || rec.recorder !== recorder) return;
    const s = Math.floor((Date.now() - startedAt) / 1000);
    timer.textContent = '0:' + String(s).padStart(2, '0');
    if (s >= (REC_LIMIT[mode] || 60) && recorder.state === 'recording') { try { recorder.stop(); } catch (e) {} }
  }, 250);
}

function endRec() {
  if (recPending) {            // отпустили раньше, чем пришёл доступ — отменяем
    recSeq++;
    recPending = null;
    cleanupRec();
    return;
  }
  if (!rec) { cleanupRec(); return; }
  if (rec.recorder && rec.recorder.state === 'recording') {
    try { rec.recorder.stop(); return; } catch (e) {}
  }
  cleanupRec();
}

function cleanupRec() {
  const r = rec;
  rec = null;
  if (r) {
    if (r.iv) clearInterval(r.iv);
    if (r.stream) r.stream.getTracks().forEach(t => t.stop());
    if (r.bubble && r.bubble.parentNode) r.bubble.parentNode.removeChild(r.bubble);
  }
  // страховка: на экране не должно оставаться ни одного окна записи
  document.querySelectorAll('.rec-bubble').forEach(el => { if (el.parentNode) el.parentNode.removeChild(el); });
}

// Голосовое сообщение в переписке: ▶ + дорожка + длительность
function voiceCard(meta) {
  const bars = h('div', { class: 'voice-bars' });
  const heights = [8, 15, 22, 11, 26, 18, 9, 20, 14, 24, 12, 17, 25, 10, 19, 13, 23, 16, 8, 21, 15, 27, 12, 18];
  heights.forEach(hh => bars.append(h('span', { style: 'height:' + hh + 'px' })));
  return h('div', { class: 'file-card voice' },
    h('button', { class: 'voice-play', type: 'button', title: 'Прослушать' }, '▶'),
    bars,
    h('div', { class: 'voice-dur' }, fmtDur(meta && meta.d))
  );
}

function showChatMenu() {
  if (!state.conv) return;
  const modal = h('div', { class: 'modal' },
    h('h3', {}, state.conv),
    h('p', {}, 'Действия с этим диалогом:'),
    h('button', { class: 'btn-danger', style: 'width:100%', type: 'button' }, 'Удалить из друзей')
  );
  modal.querySelector('button').addEventListener('click', async () => {
    try {
      await api('POST', '/api/friend/remove', { nick: state.conv });
      state.friends = state.friends.filter(x => x.nick !== state.conv);
      state.conv = null; state.shared = null; state.lastTs = 0;
      closeModal(); renderFriends(); renderMain();
      toast('Удалено');
    } catch (e) { toast(e.message, 'err'); }
  });
  attachOverlay(modal);
}

// ---------- живое обновление: WS + страховочный поллинг ----------
function wsSend(obj) { if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(obj)); }

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(state.token)}`);
  state.ws = ws;

  ws.onopen = () => { state.wsTry = 0; };

  ws.onmessage = e => {
    let m;
    try { m = JSON.parse(e.data); } catch (_) { return; }
    if (m.type === 'presence') {
      const f = state.friends.find(x => x.nick === m.nick);
      if (f) { f.online = m.online; renderFriends(); updateChatHeader(); }
    } else if (m.type === 'msg') {
      if (state.conv === m.from) {
        const aad = convKey(state.me, m.from);
        window.SecCrypto.openMessage(state.shared, m.body, aad).then(pt => {
          if (pt != null) {
            const body = $('#chatBody');
            if (body && !body.querySelector(`[data-id="${m.id}"]`)) {
              appendReceived(m, pt);
              if (m.ts > state.lastTs) state.lastTs = m.ts;
              api('POST', '/api/seen', { nick: m.from }).catch(() => {});
            }
          }
        });
      } else {
        const k = m.from.toLowerCase();
        state.unread[k] = (state.unread[k] || 0) + 1;
        renderFriends();
      }
    } else if (m.type === 'typing') {
      state.typing[m.nick] = Date.now();
      updateTypingHint();
      clearTimeout(state.typingTimers[m.nick]);
      state.typingTimers[m.nick] = setTimeout(() => { state.typing[m.nick] = 0; updateTypingHint(); }, 2800);
    } else if (m.type === 'request') {
      // новая заявка в друзья — обновляем бейдж, модалку и показываем тост
      refreshRequests(true).catch(() => {});
    } else if (m.type === 'friend-accepted') {
      // мой запрос приняли — друг появляется в списке сразу, без перезагрузки
      toast(m.by + ' принял(а) твою заявку 🎉');
      loadFriends().then(() => {
        if (state.conv === m.by) updateChatHeader();
      }).catch(() => {});
    } else if (m.type === 'friend-declined') {
      toast(m.by + ' отклонил(а) заявку');
      refreshRequests(false).catch(() => {});
    } else if (m.type === 'guild-msg') {
      if (state.gview && state.gview.guildId === m.guildId && state.gview.channelId === m.channelId) {
        refreshGuildChat().catch(() => {});
      } else {
        const g = guildById(m.guildId);
        if (g) {
          g.unread = (g.unread || 0) + 1;
          updateGuildBadges();
        }
      }
    } else if (m.type === 'voice-state') {
      if (new URLSearchParams(location.search).get('dbg') === '1') console.info('[voice] evt', m.state, m.sid, JSON.stringify(m.peers || []));
      if (call && call.guildId === m.guildId && call.channelId === m.channelId) {
        if (m.state === 'joined' && m.sid) call.mySid = m.sid;
        updateVoicePeers(m.peers || []);
      }
    } else if (m.type === 'voice-signal') {
      handleVoiceSignal(m.from, m.signal).catch(() => {});
    }
  };

  ws.onclose = () => {
    if (!state.token) return;
    const wait = Math.min(1000 * Math.pow(2, state.wsTry), 8000);
    state.wsTry++;
    setTimeout(connectWS, wait);
  };
}

let pollTimer = null;
function startPoll() {
  stopPoll();
  pollTimer = setInterval(pollTick, 3000);
}
function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function pollTick() {
  try {
    if (state.conv && state.shared && state.lastTs) {
      const r = await api('GET', '/api/conv/' + encodeURIComponent(state.conv) + '?after=' + state.lastTs);
      if (r.msgs && r.msgs.length) {
        const body = $('#chatBody');
        const aad = convKey(state.me, state.conv);
        for (const m of r.msgs) {
          if (body.querySelector(`[data-id="${m.id}"]`)) continue;
          const pt = await window.SecCrypto.openMessage(state.shared, m.body, aad);
          if (pt == null) continue;
          body.append(msgEl(m, pt));
          if (m.ts > state.lastTs) state.lastTs = m.ts;
        }
        scrollChat();
        api('POST', '/api/seen', { nick: state.conv }).catch(() => {});
      }
    }
    // друзья и заявки обновляем ВСЕГДА, а не только при мёртвом WS:
    // push может не дойти (несколько вкладок, перезапуск сервера, протухший сокет) —
    // раньше в этом случае заявка появлялась только после перезагрузки страницы.
    await refreshFriends();
    await refreshRequests(true);
    // серверы: держим список свежим, канал — живым
    if (state.view === 'guild') {
      try { await loadGuilds(); } catch (e) {}
    } else if (state.gview) {
      state.gview = null;
    }
    if (state.gview) await refreshGuildChat();
  } catch (e) { /* тихо: следующая итерация */ }
}

function updateChatHeader() {
  const f = state.friends.find(x => x.nick === state.conv);
  if (!f) return;
  const st = $('#chatStatus');
  if (st) st.textContent = f.online ? 'онлайн' : 'не в сети';
  const dot = $('#chatTitle .dot');
  if (dot) dot.classList.toggle('on', !!f.online);
  const rps = $('#rpStatus');
  if (rps) {
    rps.textContent = f.online ? '🟢 онлайн' : '⚪ не в сети';
    rps.classList.toggle('on', !!f.online);
  }
}

// ---------- правая панель: детали собеседника (v5) ----------
function openRightPanel() { document.documentElement.classList.add('right-open'); }
function closeRightPanel() { document.documentElement.classList.remove('right-open'); }
function toggleRightPanel() { document.documentElement.classList.toggle('right-open'); }

function renderRightPanel(f) {
  const body = $('#rpBody');
  if (!body) return;
  if (!f) {
    body.replaceChildren(h('div', { class: 'empty-note rp-empty' }, 'Выбери друга — здесь будут детали ✨'));
    return;
  }
  const online = !!f.online;
  body.replaceChildren(
    h('div', { class: 'rp-profile' },
      avatarEl(f.nick, 84),
      h('div', { class: 'rp-name' }, f.nick),
      h('div', { class: 'rp-status' + (online ? ' on' : ''), id: 'rpStatus' }, online ? '🟢 онлайн' : '⚪ не в сети')
    ),
    h('div', { class: 'rp-section' },
      h('div', { class: 'rp-label' }, 'Действия'),
      h('button', { class: 'btn-danger rp-remove', type: 'button' }, 'Удалить из друзей')
    )
  );
  body.querySelector('.rp-remove').addEventListener('click', async () => {
    try {
      await api('POST', '/api/friend/remove', { nick: f.nick });
      state.friends = state.friends.filter(x => x.nick !== f.nick);
      state.conv = null; state.shared = null; state.lastTs = 0;
      closeRightPanel();
      renderFriends(); renderMain();
      toast('Удалено');
    } catch (e) { toast(e.message, 'err'); }
  });
}

function updateTypingHint() {
  const el = $('#typingHint');
  if (!el) return;
  let any = false, nick = '';
  for (const [k, v] of Object.entries(state.typing)) {
    if (v && Date.now() - v < 3000) { any = true; nick = k; }
  }
  el.textContent = any ? nick + ' печатает…' : '';
}

// ---------- демо (для скриншотов/знакомства) ----------
async function demoInit(user) {
  for (const u of ['demo_alice', 'demo_bob']) {
    try { await api('POST', '/api/login', { nick: u, pass: 'demo' }); }
    catch (e) { try { await api('POST', '/api/register', { nick: u, pass: 'demo' }); } catch (e2) { /* уже есть */ } }
  }
  const r = await api('POST', '/api/login', { nick: user, pass: 'demo' });
  state.me = r.nick; state.token = r.token; state.pass = 'demo';
  localStorage.setItem(LS.nick, state.me);
  localStorage.setItem(LS.token, state.token);
  const dres = await resolveKeyForAccount('demo');
  if (dres.kp) {
    state.kp = dres.kp;
  } else {
    state.kp = makeKp();
    await api('PUT', '/api/me', { pub: window.SecCrypto.publicB64(state.kp) });
  }
  vaultSave('demo', state.kp);

  const other = user === 'demo_alice' ? 'demo_bob' : 'demo_alice';

  if (user === 'demo_alice') {
    let friends = (await api('GET', '/api/friends')).friends;
    if (!friends.find(x => x.nick.toLowerCase() === other)) {
      await api('POST', '/api/friend/request', { nick: other });
      const tok2 = (await api('POST', '/api/login', { nick: other, pass: 'demo' })).token;
      const kp2 = localStorage.getItem('sk_kp_demo_bob')
        ? window.SecCrypto.keypairFromSecret(localStorage.getItem('sk_kp_demo_bob'))
        : (() => { const k = window.SecCrypto.generateKeypair(); localStorage.setItem('sk_kp_demo_bob', window.SecCrypto.exportSecret(k)); return k; })();
      await apiToken(tok2, 'PUT', '/api/me', { pub: window.SecCrypto.publicB64(kp2) });
      // демо: ключ второго участника тоже кладём в аккаунт — иначе его «устройство» не увидит историю
      try {
        const vb = await window.SecCrypto.wrapSecret(window.SecCrypto.exportSecret(kp2), 'demo');
        await apiToken(tok2, 'POST', '/api/vault', { vault: vb });
      } catch (e) { /* не критично */ }
      const reqs = await apiToken(tok2, 'GET', '/api/friend/requests');
      if (reqs.incoming.length) await apiToken(tok2, 'POST', '/api/friend/accept', { nick: reqs.incoming[0].nick });
      friends = (await api('GET', '/api/friends')).friends;
    }
    const f = friends.find(x => x.nick.toLowerCase() === other);
    if (f && f.pub) {
      const aad = convKey(state.me, other);
      const shared = window.SecCrypto.sharedSecret(state.kp.secretKey, f.pub);
      const send = async (to, text) => {
        const body = await window.SecCrypto.sealMessage(shared, text, aad);
        await api('POST', '/api/msg', { to, body });
      };
      await send(other, 'Привет! Это Секретка 🎉');
      await send(other, 'Всё шифруется прямо в браузере — даже сервер не видит наши тексты.');
      const tok2 = (await api('POST', '/api/login', { nick: other, pass: 'demo' })).token;
      const kp2 = localStorage.getItem('sk_kp_demo_bob')
        ? window.SecCrypto.keypairFromSecret(localStorage.getItem('sk_kp_demo_bob'))
        : (() => { const k = window.SecCrypto.generateKeypair(); localStorage.setItem('sk_kp_demo_bob', window.SecCrypto.exportSecret(k)); return k; })();
      await apiToken(tok2, 'PUT', '/api/me', { pub: window.SecCrypto.publicB64(kp2) });
      // демо: ключ второго участника тоже кладём в аккаунт — иначе его «устройство» не увидит историю
      try {
        const vb = await window.SecCrypto.wrapSecret(window.SecCrypto.exportSecret(kp2), 'demo');
        await apiToken(tok2, 'POST', '/api/vault', { vault: vb });
      } catch (e) { /* не критично */ }
      const f2 = (await apiToken(tok2, 'GET', '/api/friends')).friends.find(x => x.nick.toLowerCase() === 'demo_alice');
      const shared2 = window.SecCrypto.sharedSecret(kp2.secretKey, f2.pub);
      const body2 = await window.SecCrypto.sealMessage(shared2, 'Ага, вижу 😏 И никто не подслушает.', aad);
      await apiToken(tok2, 'POST', '/api/msg', { to: 'demo_alice', body: body2 });
    }
  }
  state.conv = other;
}

// Dev-хук для проб: шлёт текст и, если попросили, синтетическое медиа (file/circle/voice)
async function devAutosend(kind) {
  if (!kind || !state.conv || !state.shared) return;
  try {
    const conv = state.conv;
    const aad = convKey(state.me, conv);
    const sealed = await window.SecCrypto.sealMessage(state.shared, 'Тест отправки из браузера 🚀', aad);
    await api('POST', '/api/msg', { to: conv, body: sealed });
    // маленький webm-заголовок: рендер карточки проверяем без реальной камеры
    const fake = new Uint8Array([0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01]);
    if (kind === 'circle') {
      await sendEncodedMedia(fake, 'video_' + Date.now() + '.webm', 'video/webm', fake.length, { t: 'circle' });
    } else if (kind === 'voice') {
      await sendEncodedMedia(fake, 'voice_' + Date.now() + '.webm', 'audio/webm', fake.length, { t: 'voice', d: 7 });
    } else if (kind === '1') {
      const f = new File([new Blob(['файл тест Секретка 123'])], 'test.txt', { type: 'text/plain' });
      await sendFile(f);
    }
  } catch (e) { toast('autosend: ' + e.message, 'err'); }
}

// ---------- старт ----------
async function boot() {
  const q = new URLSearchParams(location.search);
  const demo = q.get('demo');
  const token = localStorage.getItem(LS.token);

  // единый обработчик выбора файла (иначе при каждом рендере дублировалась бы отправка)
  document.addEventListener('change', e => {
    if (!e.target || e.target.id !== 'fileInput') return;
    const f = e.target.files && e.target.files[0];
    if (f) sendFile(f);
  });

  const th = q.get('theme');
  if (th) applyTheme(th);
  if (q.get('recmode')) recMode = q.get('recmode') === 'circle' ? 'circle' : 'voice';
  if (q.get('pop') === 'theme') setTimeout(() => showThemeModal(), 900);
  if (q.get('drawer') === '1') setTimeout(() => openDrawer(), 900);

  // тестовый вход: ?t=ник|пароль (для автотестов интерфейса)
  //   &fresh=1   — «первое устройство»: сбросить локальный ключ, создать новый и залить конверт
  //   &nokey=1   — «второе устройство»: локального ключа нет, ключ должен приехать из аккаунта
  //   &novault=1 — удалить конверт из аккаунта (сценарий «отмычки нигде нет»)
  //   &plant=1   — подложить чужой локальный ключ (сценарий «ключ не от этого аккаунта»)
  //   &keysave=1 — «старый аккаунт»: ключ только на устройстве, конверта нет (сценарий «сохрани ключ»)
  const t = q.get('t');
  if (t) {
    const [nn, pp] = t.split('|');
    try { await api('POST', '/api/login', { nick: nn, pass: pp }); }
    catch (e) {
      if (e.status !== 401 && e.status !== 404) { renderAuth(); return; }
      try { await api('POST', '/api/register', { nick: nn, pass: pp }); }
      catch (e2) { if (e2.status !== 409) { renderAuth(); return; } }
    }
    const r = await api('POST', '/api/login', { nick: nn, pass: pp });
    state.me = r.nick; state.token = r.token; state.pass = pp;
    localStorage.setItem(LS.nick, state.me);
    localStorage.setItem(LS.token, state.token);
    state.kp = loadKp(state.me);
    if (q.get('fresh') === '1' || q.get('nokey') === '1') { dropKp(state.me); state.kp = null; }
    if (q.get('novault') === '1') { try { await api('DELETE', '/api/vault'); } catch (e) { /* ignore */ } }
    if (q.get('plant') === '1') { state.kp = makeKp(); saveKp(state.kp, state.me); }
    if (q.get('keysave') === '1') {
      // «старый аккаунт»: ключ есть только на этом устройстве, конверта в аккаунте нет,
      // пароля в памяти тоже нет — должен появиться запрос «Сохранить ключ в аккаунт»
      state.kp = makeKp(state.me);
      try { await api('PUT', '/api/me', { pub: window.SecCrypto.publicB64(state.kp) }); } catch (e) { /* ignore */ }
      try { await api('DELETE', '/api/vault'); } catch (e) { /* ignore */ }
      state.pass = null;
    }
    if (q.get('fresh') === '1') {
      state.kp = makeKp();
      await vaultSave(pp);
      try { await api('PUT', '/api/me', { pub: window.SecCrypto.publicB64(state.kp) }); }
      catch (e) { /* ignore */ }
      showKeyModal('new');
      return;
    }
    {
      // всегда сверяем ключ с аккаунтом: локальный может быть от другого устройства/ключа
      const res = await resolveKeyForAccount(pp);
      if (res.kp) { state.kp = res.kp; if (res.from === 'vault') vaultSave(pp); }
      else { showKeyModal('enter', { reason: res.from, pass: pp }); return; }
    }
    await initMain();
    if (q.get('view') === 'guild') setView('guild');
    if (q.get('send') === '1' && q.get('view') === 'guild') {
      setTimeout(async () => {
        for (let i = 0; i < 30 && !state.gview; i++) await new Promise(r => setTimeout(r, 300));
        const inp = $('#msgInput');
        if (!inp) return;
        inp.value = 'Отправка из UI 🚀';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        const sb = $('#sendBtn');
        if (sb) sb.click();
      }, 1500);
    }
    if (q.get('conv')) {
      try { await openChat(q.get('conv')); }
      catch (e) { /* уже показано в чате */ }
      if (q.get('top') === '1') {
        const tb = $('#chatBody');
        if (tb) { tb.scrollTop = 0; updateJump(); }
      }
      applyForceJump();
      await devAutosend(q.get('autosend'));
    }
    return;
  }

  if (demo) {
    try { await demoInit(demo); } catch (e) { console.error('demo', e); }
    await initMain();
    applyForceJump();
    if (q.get('view') === 'guild') setView('guild');
    if (q.get('conv')) { try { await openChat(q.get('conv')); } catch (e) {} }
    if (q.get('autosend')) await devAutosend(q.get('autosend'));
    return;
  }
  if (token) {
    state.token = token;
    state.me = localStorage.getItem(LS.nick);
    state.kp = loadKp();
    try {
      await api('GET', '/api/friends'); // проверка токена
      if (!state.kp) { toast('Войди заново — ключ подтянется из аккаунта 🔑'); logout(); }
      else { await initMain(); applyForceJump(); }
    } catch (e) {
      if (e.status === 401) { logout(); } else { renderAuth(); toast(e.message, 'err'); }
    }
  } else {
    renderAuth();
  }
}

boot();
