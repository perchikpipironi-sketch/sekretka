'use strict';
/* E2E: серверы (гильдии), каналы, E2E-сообщения в канале.
 * Использование: BASE=http://127.0.0.1:8099 node test/guild-e2e.js */
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
const SecCrypto = require('../public/js/crypto.js');

const api = async (method, p, body, token) => {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error || r.status) + ' @ ' + p);
  return j;
};

async function regUser(nick, pass) {
  try { await api('POST', '/api/register', { nick, pass }); } catch (e) { if (e.message.indexOf('409') < 0) throw e; }
  const s = await api('POST', '/api/login', { nick, pass });
  const kp = SecCrypto.generateKeypair();
  await api('PUT', '/api/me', { pub: SecCrypto.publicB64(kp) }, s.token);
  return { token: s.token, kp, nick };
}

async function main() {
  const results = [];
  const check = (name, ok, extra) => { results.push({ name, ok, extra }); };

  const u1 = await regUser('gu_a' + Date.now().toString(36), 'pass1234');
  const u2 = await regUser('gu_b' + Date.now().toString(36), 'pass1234');

  // создание сервера
  const { guild } = await api('POST', '/api/guild', { name: 'Тест-сервер' }, u1.token);
  check('guild created', !!guild.id && guild.channels.length === 1 && guild.channels[0].kind === 'text');

  // вступление по коду
  const join = await api('POST', '/api/guild/join', { code: guild.code }, u2.token);
  check('join by code', join.joined === true && join.guild.id === guild.id);

  // список у обоих
  const l1 = await api('GET', '/api/guilds', undefined, u1.token);
  const l2 = await api('GET', '/api/guilds', undefined, u2.token);
  check('members list', l1.guilds[0].members.length === 2 && l2.guilds[0].members.length === 2);
  check('pub visible in members', l1.guilds[0].members.every(x => !!x.pub));

  // канал создаёт владелец, участник — не может
  const ch = await api('POST', '/api/guild/channel', { guildId: guild.id, kind: 'text', name: 'болталка' }, u1.token);
  check('channel created', !!ch.channel.id && ch.channel.name === 'болталка');
  let denied = false;
  try { await api('POST', '/api/guild/channel', { guildId: guild.id, kind: 'text', name: 'x' }, u2.token); } catch (e) { denied = /403|владелец/.test(e.message); }
  check('non-owner denied', denied);

  // отправка: u1 шифрует для u2 (и себя)
  const aad = 'g:' + guild.id + ':' + ch.channel.id;
  const other = l1.guilds[0].members.find(x => x.nick === u2.nick);
  const shared = SecCrypto.sharedSecret(u1.kp.secretKey, other.pub);
  const env = {};
  env[u2.nick.toLowerCase()] = await SecCrypto.sealMessage(shared, 'Привет, канал!', aad);
  const sent = await api('POST', '/api/guild/msg', { guildId: guild.id, channelId: ch.channel.id, body: env }, u1.token);
  check('guild msg sent', !!sent.id);

  // кан2 читает и расшифровывает
  const conv2 = await api('GET', '/api/guild/conv/' + guild.id + '/' + ch.channel.id + '?after=0', undefined, u2.token);
  check('conv has 1 msg', conv2.msgs.length === 1);
  if (conv2.msgs.length === 1) {
    const m = conv2.msgs[0];
    const shared2 = SecCrypto.sharedSecret(u2.kp.secretKey, SecCrypto.publicB64(u1.kp));
    const pt = await SecCrypto.openMessage(shared2, m.body, aad);
    check('decrypted for u2', pt === 'Привет, канал!', pt);
  }

  // u1 не получает чужой конверт (отправляли только u2)
  const conv1 = await api('GET', '/api/guild/conv/' + guild.id + '/' + ch.channel.id + '?after=0', undefined, u1.token);
  check('u1 sees nothing (no envelope)', conv1.msgs.length === 0);

  // удаление канала владельцем
  const del = await api('DELETE', '/api/guild/channel', { guildId: guild.id, channelId: ch.channel.id }, u1.token);
  check('channel deleted', del.ok === true);

  // выход u2, удаление гилдии владельцем
  await api('POST', '/api/guild/leave', { guildId: guild.id }, u2.token);
  const delG = await api('DELETE', '/api/guild', { guildId: guild.id }, u1.token);
  check('guild deleted', delG.ok === true);
  const l1b = await api('GET', '/api/guilds', undefined, u1.token);
  check('guild gone', l1b.guilds.length === 0);

  const failed = results.filter(r => !r.ok);
  console.log('guild-e2e:', results.length, 'checks,', failed.length, 'failed');
  for (const r of results) {
    console.log((r.ok ? '  PASS ' : '  FAIL ') + r.name + (r.extra !== undefined ? ' → ' + JSON.stringify(r.extra) : ''));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
