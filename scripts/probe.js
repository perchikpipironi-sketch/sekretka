#!/usr/bin/env node
'use strict';
/*
 * probe.js — «глаза» без зрения: гоняет страницу в headless-Chromium через CDP
 * и печатает метрики раскладки/состояния DOM в JSON.
 *
 * Запуск:
 *   node scripts/probe.js --url http://127.0.0.1:8095/ --w 1440 --h 900 --eval scripts/probes/chat.js
 *   node scripts/probe.js --url <url> --eval "document.title"        (инлайн-выражение)
 *   node scripts/probe.js --url <url> --shot shots/x.png --wait 3000
 *
 * --eval: файл со JS-выражением (последнее выражение возвращается) или строка.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, '');
  args[k] = process.argv[i + 1];
}
const url = args.url || 'http://127.0.0.1:8080/';
const W = parseInt(args.w || '1440', 10);
const H = parseInt(args.h || '900', 10);
const waitMs = parseInt(args.wait || '2500', 10);
const port = parseInt(args.port || '9333', 10);
const shot = args.shot || null;

function findChromium() {
  const base = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter(d => /^chromium(_headless_shell)?-\d+$/.test(d)).sort();
  const prefer = dirs.filter(d => d.startsWith('chromium-')).concat(dirs.filter(d => d.startsWith('chromium_headless')));
  for (const d of prefer) {
    for (const rel of ['chrome-win64\\chrome.exe', 'chrome-win\\chrome.exe', 'chrome-headless-shell-win64\\chrome-headless-shell.exe']) {
      const p = path.join(base, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const exe = args.exe || findChromium();
if (!exe) { console.error('chromium не найден (--exe <путь>)'); process.exit(2); }

const userDir = path.join(os.tmpdir(), 'sekretka-probe-' + Date.now());
const chromeArgs = [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
  `--window-size=${W},${H}`, 'about:blank'
];
if (args['fake-media']) {
  // фейковые микрофон/камера: можно проверять запись голосовых и кружков без железа
  chromeArgs.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required');
}
const child = spawn(exe, chromeArgs, { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function targets() {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`);
  return r.json();
}

(async () => {
  let list = null;
  for (let i = 0; i < 60; i++) {
    try { list = await targets(); if (list && list.some(t => t.type === 'page')) break; } catch (e) {}
    await sleep(250);
  }
  if (!list) throw new Error('CDP не поднялся');
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) events.push(msg);
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  await new Promise(r => ws.on('open', r));

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: /phone|mobile/.test(args.mobile || '') });
  await send('Page.navigate', { url });
  for (let i = 0; i < 80 && !events.some(e => e.method === 'Page.loadEventFired'); i++) await sleep(100);
  await sleep(waitMs);

  const print = [];
  ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.method === 'Runtime.consoleAPICalled') print.push(m.params); });

  const exprRaw = args.eval
    ? (fs.existsSync(args.eval) ? fs.readFileSync(args.eval, 'utf8') : args.eval)
    : '({title: document.title, url: location.href})';
  // проба, начинающаяся с /*async*/, может использовать await (например, ждать запись)
  const isAsync = /^\s*\/\*async\*\//.test(exprRaw);
  const expr = exprRaw.replace(/^\s*\/\*async\*\//, '');
  const body = isAsync
    ? `(async function(){ try { return JSON.stringify(await (async function(){ ${expr} })()); } catch(e){ return JSON.stringify({error: String(e && e.stack || e)}); } })()`
    : `(function(){ try { return JSON.stringify((function(){ ${expr} })()); } catch(e){ return JSON.stringify({error: String(e && e.stack || e)}); } })()`;

  const res = await send('Runtime.evaluate', {
    expression: body,
    returnByValue: true, awaitPromise: true
  });
  let out;
  try { out = JSON.parse(res.result.value); } catch (e) { out = { raw: res.result.value, exception: res.exceptionDetails }; }

  let shotPath = null;
  if (shot) {
    const cap = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.dirname(path.resolve(shot)), { recursive: true });
    fs.writeFileSync(path.resolve(shot), Buffer.from(cap.data, 'base64'));
    shotPath = path.resolve(shot);
  }

  console.log(JSON.stringify({ url, size: [W, H], result: out, screenshot: shotPath, consoleEntries: print.length }, null, 2));

  ws.close();
  try { child.kill(); } catch (e) {}
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch(err => {
  console.error('probe error:', err.message);
  try { child.kill(); } catch (e) {}
  process.exit(1);
});
