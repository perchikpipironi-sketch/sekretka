'use strict';
/* Сид для UI-проверки серверов: два пользователя, сервер, канал, сообщение.
 * Использование: BASE=http://127.0.0.1:8099 node scripts/seed-guild-ui.js */
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
  const vault = await SecCrypto.wrapSecret(SecCrypto.exportSecret(kp), pass);
  await api('POST', '/api/vault', { vault }, s.token);
  return { token: s.token, kp, nick };
}

async function main() {
  const girl = await regUser('sg_girl', 'pass1234');
  const boy = await regUser('sg_boy', 'pass1234');
  const { guild } = await api('POST', '/api/guild', { name: 'Тест-Сервер' }, girl.token);
  await api('POST', '/api/guild/join', { code: guild.code }, boy.token);
  const lst = await api('GET', '/api/guilds', undefined, girl.token);
  const g = lst.guilds[0];
  const ch = g.channels[0];
  const aad = 'g:' + g.id + ':' + ch.id;
  const env = {};
  for (const m of g.members) {
    if (m.nick === girl.nick || !m.pub) continue;
    const shared = SecCrypto.sharedSecret(girl.kp.secretKey, m.pub);
    env[m.nick.toLowerCase()] = await SecCrypto.sealMessage(shared, 'Привет, канал! Это тест 🏰', aad);
  }
  await api('POST', '/api/guild/msg', { guildId: g.id, channelId: ch.id, body: env }, girl.token);
  console.log('guild seeded:', g.id, ch.id, 'members', g.members.length, 'code', g.code);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
