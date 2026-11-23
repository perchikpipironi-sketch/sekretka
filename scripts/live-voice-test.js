// Проверка signaling голосовых комнат: join/leave и ретрансляция voice-signal.
// Версия про sid: у одного ника может быть несколько устройств — находятся по sid.
// Запуск: node scripts/live-voice-test.js <port>
const WebSocket = require('ws');
const PORT = process.argv[2] || '8099';
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

function nextEvent(ws, type, filter, windowMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout: ${type} не пришло`)); }, windowMs || 5000);
    const onMsg = data => {
      const m = JSON.parse(data.toString());
      if (m.type === type && (!filter || filter(m))) { cleanup(); resolve(m); }
    };
    const onErr = e => { cleanup(); reject(e); };
    function cleanup() { clearTimeout(timer); ws.off('message', onMsg); ws.off('error', onErr); }
    ws.on('message', onMsg);
    ws.on('error', onErr);
  });
}

function send(ws, obj) { ws.send(JSON.stringify(obj)); }
function peerNicks(peers) { return (peers || []).map(p => p.nick).sort().join(','); }

(async () => {
  const A = 'voa', B = 'vob';
  const pass = 'pass1234';
  for (const n of [A, B]) {
    try { await api('POST', '/api/register', { nick: n, pass }); }
    catch (e) { if (!String(e.message).includes('409')) throw e; }
  }
  const a = await api('POST', '/api/login', { nick: A, pass });
  const b = await api('POST', '/api/login', { nick: B, pass });
  const pub = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  await api('PUT', '/api/me', { pub }, a.token).catch(() => {});
  await api('PUT', '/api/me', { pub }, b.token).catch(() => {});

  // гилдия от A, голосовой канал, join B
  const g = (await api('POST', '/api/guild', { name: 'Звонки' }, a.token)).guild;
  const ch = (await api('POST', '/api/guild/channel', { guildId: g.id, kind: 'voice', name: 'Голосовой' }, a.token)).channel;
  await api('POST', '/api/guild/join', { code: g.code }, b.token);

  const aWs = await wsOpen(a.token);
  const bWs = await wsOpen(b.token);

  // A входит в комнату
  const aJoined = nextEvent(aWs, 'voice-state', m => m.state === 'joined', 4000);
  send(aWs, { type: 'voice', action: 'join', guildId: g.id, channelId: ch.id });
  const ja = await aJoined;
  if (!ja.sid) throw new Error('joined без sid');
  if (!ja.peers.some(p => p.nick === A)) throw new Error('joined.peers не содержит A');
  const sidA = ja.sid;

  // B входит: A видит peer-joined с двумя участниками
  const aPeer = nextEvent(aWs, 'voice-state', m => m.state === 'peer-joined', 4000);
  const bJoined = nextEvent(bWs, 'voice-state', m => m.state === 'joined', 4000);
  send(bWs, { type: 'voice', action: 'join', guildId: g.id, channelId: ch.id });
  const jb = await bJoined;
  const pj = await aPeer;
  const sidB = jb.sid;
  const okPeers = peerNicks(jb.peers) === [A, B].sort().join(',') &&
    peerNicks(pj.peers) === [A, B].sort().join(',') && pj.sid === sidB;

  // A шлёт сигнал B (по sid)
  const bSig = nextEvent(bWs, 'voice-signal', m => m.signal && m.signal.kind === 'offer', 4000);
  send(aWs, { type: 'voice-signal', to: sidB, signal: { kind: 'offer', sdp: { type: 'offer', sdp: 'fake-sdp-a' } } });
  const sig = await bSig;
  const okSignal = sig.from === sidA && sig.signal.sdp.sdp === 'fake-sdp-a';

  // B отвечает, A получает answer
  const aAns = nextEvent(aWs, 'voice-signal', m => m.signal && m.signal.kind === 'answer', 4000);
  send(bWs, { type: 'voice-signal', to: sidA, signal: { kind: 'answer', sdp: { type: 'answer', sdp: 'fake-sdp-b' } } });
  const ans = await aAns;
  const okAnswer = ans.from === sidB && ans.signal.sdp.sdp === 'fake-sdp-b';

  // B выходит: A видит peer-left (остался один)
  const aLeft = nextEvent(aWs, 'voice-state', m => m.state === 'peer-left', 4000);
  send(bWs, { type: 'voice', action: 'leave', guildId: g.id, channelId: ch.id });
  const pl = await aLeft;
  const okLeft = pl.sid === sidB && pl.peers.length === 1 && pl.peers[0].nick === A;

  aWs.close(); bWs.close();
  console.log('joined A sid:', sidA, 'peers:', JSON.stringify(ja.peers));
  console.log('joined B sid:', sidB, 'peers:', JSON.stringify(jb.peers));
  console.log('peer-joined event:', JSON.stringify(pj));
  console.log('offer relayed from', sig.from, ':', sig.signal.sdp.sdp);
  console.log('answer relayed from', ans.from, ':', ans.signal.sdp.sdp);
  console.log('peer-left event:', JSON.stringify(pl));
  const ok = okPeers && okSignal && okAnswer && okLeft;
  console.log(ok ? 'PASS: голосовые комнаты (sid) и ретрансляция сигналов работают' : 'FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
