#!/usr/bin/env node
'use strict';
/*
 * live-ui-req.js — воспроизводит РЕАЛЬНЫЙ сценарий «мне прислали заявку в друзья»:
 *   получатель — настоящий браузер (страница открыта, WS подключён),
 *   отправители — обычные HTTP-клиенты (другие пользователи).
 * Проверяет два пути доставки:
 *   1) живой WS-push (бейдж/тост/модалка БЕЗ перезагрузки);
 *   2) «push не дошёл» (сокет получателя порван) — должен выручить поллинг.
 *
 * Запуск: node scripts/live-ui-req.js http://127.0.0.1:8098
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const SecCrypto = require('../public/js/crypto.js');

const BASE = process.argv[2] || 'http://127.0.0.1:8098';
const CDP_PORT = parseInt(process.env.CDP_PORT || '9345', 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STAMP = Date.now().toString(36).slice(-4);
const ALICE = 'rev_a' + STAMP;
const BOB = 'rev_b' + STAMP;
const CAROL = 'rev_c' + STAMP;

function findChromium() {
  const base = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter(d => /^chromium(_headless_shell)?-\d+$/.test(d)).sort();
  for (const d of dirs.filter(x => x.startsWith('chromium-'))) {
    for (const rel of ['chrome-win64\\chrome.exe', 'chrome-win\\chrome.exe']) {
      const p = path.join(base, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

async function http(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(`${p} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// регистрируем «обычного» пользователя и возвращаем его токен
async function makeUser(nick) {
  const kp = SecCrypto.generateKeypair();
  await http('POST', '/api/register', { nick, pass: 'pass1234', pub: SecCrypto.publicB64(kp) });
  const l = await http('POST', '/api/login', { nick, pass: 'pass1234' });
  return l.token;
}

(async () => {
  const out = { base: BASE, alice: ALICE, steps: [] };
  const step = (name, val) => { out.steps.push({ name, ...val }); };

  const bobToken = await makeUser(BOB);
  step('sender-ready', { bob: BOB, tokenLen: bobToken.length });

  const exe = findChromium();
  if (!exe) throw new Error('chromium не найден');
  const userDir = path.join(os.tmpdir(), 'sekretka-live-req-' + Date.now());
  const child = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--hide-scrollbars',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDir}`,
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 60; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); if (list.some(t => t.type === 'page')) break; } catch (e) {}
    await sleep(250);
  }
  if (!list) throw new Error('CDP не поднялся');
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push((msg.params.args || []).map(a => a.value || a.description || '').join(' '));
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');

  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', {
      expression: `(function(){ try { return JSON.stringify((function(){ ${expr} })()); } catch(e){ return JSON.stringify({error:String(e && e.message || e)}); } })()`,
      returnByValue: true, awaitPromise: true
    });
    try { return JSON.parse(r.result.value); } catch (e) { return { raw: r.result.value }; }
  };

  const snapshot = `return {
    badge: (document.querySelector('#requestsBadge')||{}).textContent || '',
    toasts: [...document.querySelectorAll('#toasts *')].map(t=>t.textContent),
    incoming: (typeof state !== 'undefined' && state.incoming) ? state.incoming.map(x=>x.nick) : null,
    ws: (typeof state !== 'undefined' && state.ws) ? state.ws.readyState : null
  };`;

  // v21: аккаунт без ключа теперь честно просит ключ, поэтому «первое устройство»
  // создаём через &fresh=1 и закрываем окно бэкапа, чтобы попасть в интерфейс.
  await send('Page.navigate', { url: `${BASE}/?t=${ALICE}|pass1234&fresh=1` });
  let ready = null, clickedBackup = false;
  for (let i = 0; i < 60; i++) {
    ready = await evaluate(`return {
      rail: !!document.querySelector('#railRequests'),
      backup: !!document.querySelector('#backupDone'),
      badge: (document.querySelector('#requestsBadge')||{}).textContent || null,
      ws: (typeof state !== 'undefined' && state.ws) ? state.ws.readyState : null,
      me: (typeof state !== 'undefined') ? state.me : null
    };`);
    if (!clickedBackup && ready && ready.backup) {
      await evaluate(`document.querySelector('#backupDone').click(); return true;`);
      clickedBackup = true;
    }
    if (ready.rail && ready.ws === 1) break;
    await sleep(300);
  }
  step('receiver-ready', ready);
  if (!ready || ready.ws !== 1) throw new Error('браузер получателя не подключил WS: ' + JSON.stringify(ready));

  const before = await evaluate(snapshot);
  step('before-request', before);

  // путь 1: живой WS-push
  await http('POST', '/api/friend/request', { nick: ALICE }, bobToken);
  let live = null;
  for (let i = 0; i < 30; i++) {
    live = await evaluate(snapshot);
    if (live.badge && live.badge !== before.badge) break;
    await sleep(300);
  }
  step('after-request-live', live);

  await evaluate(`document.querySelector('#railRequests').click(); return true;`);
  await sleep(600);
  const modal = await evaluate(`return {
    open: !!document.querySelector('.req-modal'),
    items: [...document.querySelectorAll('.req-item .req-name')].map(e=>e.textContent),
    buttons: [...document.querySelectorAll('.req-item button')].map(e=>e.textContent)
  };`);
  step('requests-modal', modal);
  await evaluate(`closeModal(); return true;`);

  // путь 2: push не дошёл — рвём сокет и сразу шлём заявку третьим пользователем
  const carolToken = await makeUser(CAROL);
  await evaluate(`try { state.ws.close(); } catch (e) {} return true;`);
  await sleep(200);
  const afterKill = await evaluate(snapshot);
  step('ws-killed', afterKill);
  await http('POST', '/api/friend/request', { nick: ALICE }, carolToken);
  let polled = null;
  for (let i = 0; i < 45; i++) {
    polled = await evaluate(snapshot);
    if (polled.incoming && polled.incoming.length >= 2) break;
    await sleep(400);
  }
  step('after-missed-push', polled);

  out.verdict = {
    liveBadge: !!live && live.badge !== before.badge,
    liveToast: !!(live && live.toasts.length),
    modalShowsRequest: !!(modal && modal.items && modal.items.includes(BOB)),
    missedPushRecovered: !!(polled && polled.incoming && polled.incoming.length >= 2),
    consoleErrors
  };
  out.ok = out.verdict.liveBadge && out.verdict.modalShowsRequest && out.verdict.missedPushRecovered;

  console.log(JSON.stringify(out, null, 2));
  ws.close();
  try { child.kill(); } catch (e) {}
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(out.ok ? 0 : 1);
})().catch(err => { console.error('live-ui-req error:', err.message); process.exit(2); });
