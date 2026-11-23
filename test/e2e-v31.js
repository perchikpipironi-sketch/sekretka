'use strict';
// v31: закрепление/удаление чата, удаление своих сообщений, сгорающие сообщения.
// Запуск: BASE=http://127.0.0.1:8099 node test/e2e-v31.js
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
const H = { 'Content-Type': 'application/json' };
let passed = 0, failed = 0;

async function api(method, p, body, token) {
  const r = await fetch(BASE + p, {
    method,
    headers: Object.assign({}, H, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null;
  try { j = await r.json(); } catch (e) {}
  return { status: r.status, j };
}

function check(name, cond) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name); }
}

(async () => {
  const a = 'v31_a' + Date.now().toString(36), b = 'v31_b' + Date.now().toString(36);
  const pass = 'pass1234';
  const r1 = await api('POST', '/api/register', { nick: a, pass });
  const r2 = await api('POST', '/api/register', { nick: b, pass });
  check('register a/b', r1.status === 200 && r2.status === 200);
  const ta = r1.j.token, tb = r2.j.token;
  await api('PUT', '/api/me', { pub: 'A'.repeat(44) }, ta);
  await api('PUT', '/api/me', { pub: 'B'.repeat(44) }, tb);
  await api('POST', '/api/friend/request', { nick: b }, ta);
  const acc = await api('POST', '/api/friend/accept', { nick: a }, tb);
  check('friend accepted', acc.status === 200);

  // сгорающее
  const burn = await api('POST', '/api/msg', { to: b, body: 'QUJD', burn: true }, ta);
  check('send burn', burn.status === 200 && burn.j.burn === true);
  const conv1 = await api('GET', '/api/conv/' + b + '?after=0', null, ta);
  check('burn visible, flag kept', conv1.status === 200 && conv1.j.msgs.length === 1 && conv1.j.msgs[0].burn === true);

  // удаление своего сообщения
  const id = burn.j.id;
  const del = await api('DELETE', '/api/msg/' + id + '?conv=' + encodeURIComponent(b), null, ta);
  console.log('DELETE msg ->', del.status, JSON.stringify(del.j));
  check('delete own msg', del.status === 200 && del.j.ok === true);
  const conv2 = await api('GET', '/api/conv/' + b + '?after=0', null, ta);
  check('msg gone after delete', conv2.j.msgs.length === 0);

  // чужие сообщения удалять нельзя
  await api('POST', '/api/msg', { to: a, body: 'QUJD' }, tb);
  const conv3 = await api('GET', '/api/conv/' + a + '?after=0', null, tb);
  const otherId = conv3.j.msgs[0].id;
  const delOther = await api('DELETE', '/api/msg/' + otherId + '?conv=' + encodeURIComponent(a), null, ta);
  check('cannot delete other\'s msg', delOther.status === 404);

  // удаление чата
  const delConv = await api('DELETE', '/api/conv?nick=' + encodeURIComponent(b), null, ta);
  check('delete conv', delConv.status === 200 && delConv.j.ok === true);
  const conv4 = await api('GET', '/api/conv/' + b + '?after=0', null, ta);
  check('conv empty after delete', conv4.j.msgs.length === 0);
  // сообщения от b (в другой стороне ключа) не пострадали? deleteConv удаляет ключ a|b целиком — проверим отсутствие
  const convB = await api('GET', '/api/conv/' + a + '?after=0', null, tb);
  check('conv empty for b too', convB.j.msgs.length === 0);

  console.log(`\ne2e-v31: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
