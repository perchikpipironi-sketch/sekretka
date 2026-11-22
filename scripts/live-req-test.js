// Проверка: при отправке заявки адресату-онлайн приходит WS-событие {type:'request',from}
// Запуск: node scripts/live-req-test.js <port>
const WebSocket = require('ws');
const PORT = process.argv[2] || '8091';
const BASE = `http://127.0.0.1:${PORT}`;

async function api(method, p, body, token) {
  const r = await fetch(BASE + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

(async () => {
  const A = 'reqalice', B = 'reqbob';
  for (const n of [A, B]) {
    try { await api('POST', '/api/register', { nick: n, pass: 'pass1234' }); }
    catch (e) { if (!String(e.message).includes('409')) throw e; }
  }
  const a = await api('POST', '/api/login', { nick: A, pass: 'pass1234' });
  const b = await api('POST', '/api/login', { nick: B, pass: 'pass1234' });
  // публичные ключи (нужны для будущего accept, не для request)
  const pub = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  await api('PUT', '/api/me', { pub }, a.token).catch(() => {});
  await api('PUT', '/api/me', { pub }, b.token).catch(() => {});

  const got = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(a.token)}`);
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout: WS-событие request не пришло')); }, 4000);
    ws.on('message', data => {
      const m = JSON.parse(data.toString());
      if (m.type === 'request') { clearTimeout(timer); ws.close(); resolve(m); }
    });
    ws.on('open', async () => {
      try { await api('POST', '/api/friend/request', { nick: A }, b.token); }
      catch (e) { clearTimeout(timer); ws.close(); reject(e); }
    });
    ws.on('error', e => { clearTimeout(timer); reject(e); });
  });

  const reqs = await api('GET', '/api/friend/requests', null, a.token);
  const ok = got.type === 'request' && got.from === B && reqs.incoming.some(r => r.nick === B);
  console.log('WS event:', JSON.stringify(got));
  console.log('incoming:', reqs.incoming.map(r => r.nick).join(','));
  console.log(ok ? 'PASS: заявка пришла по WS и видна в списке' : 'FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
