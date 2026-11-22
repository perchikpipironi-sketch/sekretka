'use strict';
// Быстрая проверка live-доставки по WebSocket (push сообщения + presence).
const WebSocket = require('ws');
const BASE = 'http://127.0.0.1:8080';

async function call(method, p, body, token) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
}

(async () => {
  const a = await call('POST', '/api/login', { nick: 'demo_alice', pass: 'demo' });
  const t = await call('POST', '/api/login', { nick: 'tanya', pass: 'secret123' });

  const got = [];
  const ws = new WebSocket('ws://127.0.0.1:8080/ws?token=' + encodeURIComponent(t.token));
  ws.on('message', d => got.push(JSON.parse(d.toString())));
  await new Promise(res => ws.on('open', res));

  // подключаем alice — tanya должна увидеть presence online
  const wsA = new WebSocket('ws://127.0.0.1:8080/ws?token=' + encodeURIComponent(a.token));
  await new Promise(res => wsA.on('open', res));
  await new Promise(r => setTimeout(r, 400));

  const ct = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/';
  const m = await call('POST', '/api/msg', { to: 'tanya', body: ct }, a.token);
  await new Promise(r => setTimeout(r, 500));

  const pushed = got.find(x => x.type === 'msg' && x.from === 'demo_alice');
  const presence = got.some(x => x.type === 'presence');
  console.log('push msg:', !!pushed, '| id match:', !!(pushed && pushed.id === m.id), '| presence event:', presence);
  ws.close();
  process.exit(pushed && pushed.id === m.id && presence ? 0 : 1);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
