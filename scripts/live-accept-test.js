// Проверка: после принятия заявки автору(онлайн) приходит WS {type:'friend-accepted',by}
// и оба видят друг друга в /api/friends. Запуск: node scripts/live-accept-test.js <port>
const WebSocket = require('ws');
const PORT = process.argv[2] || '8093';
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

function wsOpen(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(token)}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextEvent(ws, type, windowMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout: ${type} не пришло`)); }, windowMs);
    const onMsg = data => {
      const m = JSON.parse(data.toString());
      if (m.type === type) { cleanup(); resolve(m); }
    };
    const onErr = e => { cleanup(); reject(e); };
    function cleanup() { clearTimeout(timer); ws.off('message', onMsg); ws.off('error', onErr); }
    ws.on('message', onMsg);
    ws.on('error', onErr);
  });
}

(async () => {
  const A = 'acc_alice', B = 'acc_bob';
  for (const n of [A, B]) {
    try { await api('POST', '/api/register', { nick: n, pass: 'pass1234' }); }
    catch (e) { if (!String(e.message).includes('409')) throw e; }
  }
  const a = await api('POST', '/api/login', { nick: A, pass: 'pass1234' });
  const b = await api('POST', '/api/login', { nick: B, pass: 'pass1234' });
  const pub = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  await api('PUT', '/api/me', { pub }, a.token).catch(() => {});
  await api('PUT', '/api/me', { pub }, b.token).catch(() => {});

  const aWs = await wsOpen(a.token);
  const bWs = await wsOpen(b.token);

  // B подаёт заявку A; A ждёт request, затем принимает
  const aReq = nextEvent(aWs, 'request', 4000);
  await api('POST', '/api/friend/request', { nick: A }, b.token);
  const req = await aReq;
  if (req.from !== B) throw new Error('request.from != ' + B);

  // B ждёт friend-accepted (именно автор заявки)
  const bAcc = nextEvent(bWs, 'friend-accepted', 4000);
  await api('POST', '/api/friend/accept', { nick: B }, a.token);
  const ev = await bAcc;
  const okEv = ev.type === 'friend-accepted' && ev.by === A;

  const fa = await api('GET', '/api/friends', null, a.token);
  const fb = await api('GET', '/api/friends', null, b.token);
  const okList = fa.friends.some(f => f.nick === B) && fb.friends.some(f => f.nick === A);

  aWs.close(); bWs.close();
  console.log('B got event:', JSON.stringify(ev));
  console.log('A friends:', fa.friends.map(f => f.nick).join(','));
  console.log('B friends:', fb.friends.map(f => f.nick).join(','));
  console.log(okEv && okList ? 'PASS: accept виден автору мгновенно по WS и в списках' : 'FAIL');
  process.exit(okEv && okList ? 0 : 1);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
