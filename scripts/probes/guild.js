// Проба режима «Серверы»: структура панели, каналы, сообщения канала.
const q = s => document.querySelector(s);
const qa = s => Array.from(document.querySelectorAll(s));
const chatBody = q('#chatBody');
return {
  view: state.view,
  railDmOn: q('#railDm') ? q('#railDm').classList.contains('on') : null,
  railGuildsOn: q('#railGuilds') ? q('#railGuilds').classList.contains('on') : null,
  gItems: qa('.g-item').length,
  gNames: qa('.g-name').map(e => e.textContent.trim().split('\n')[0]),
  gChannels: qa('.g-ch').map(e => e.textContent.trim()),
  activeG: state.gview ? state.gview.guildId : null,
  activeCh: state.gview ? state.gview.channelId : null,
  chatTitle: q('#chatTitle') ? q('#chatTitle').textContent.trim() : null,
  chatStatus: q('#chatStatus') ? q('#chatStatus').textContent.trim() : null,
  msgCount: qa('#chatBody .msg-row').length,
  mineCount: qa('#chatBody .msg-row.mine').length,
  hasDecryptedText: !!chatBody && chatBody.textContent.indexOf('Привет, канал!') >= 0,
  daySeps: qa('#chatBody .day-sep').map(e => e.textContent.trim()),
  composerVisible: !!(q('#chatInput') && q('#msgInput')),
  gLastError: state.gLastError || null,
  sendBtnExists: !!q('#sendBtn'),
  inputValue: (q('#msgInput') || {}).value || '',
  fnTypes: { sendMessage: typeof sendMessage, sendGuildMessage: typeof sendGuildMessage },
  version: document.body.textContent.indexOf('v' + APP_VERSION) >= 0 ? APP_VERSION : null
};
