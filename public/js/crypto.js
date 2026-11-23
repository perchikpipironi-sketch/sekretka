/**
 * Крипто-ядро Секретки.
 * - Ключи: X25519 (TweetNaCl box)
 * - Шифрование сообщения: AES-GCM (WebCrypto), ключ сообщения = SHA-256(shared || salt),
 *   salt и IV случайные на каждое сообщение => ключ каждого сообщения уникален.
 * - Аутентификация: AES-GCM с AAD = ключ диалога.
 * Работает и в браузере (window.SecCrypto), и в Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SecCrypto = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var nacl = (typeof require !== 'undefined') ? require('../vendor/nacl.min.js') : window.nacl;
  var enc = new TextEncoder(), dec = new TextDecoder();

  function randomBytes(n) { return nacl.randomBytes(n); }

  function concatBytes(arr) {
    var total = 0, i;
    for (i = 0; i < arr.length; i++) total += arr[i].length;
    var out = new Uint8Array(total), p = 0;
    for (i = 0; i < arr.length; i++) { out.set(arr[i], p); p += arr[i].length; }
    return out;
  }

  // --- base64 (без btoa, чтобы работало и в Node) ---
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64(u8) {
    var out = '', i, j, b0, b1, b2;
    for (i = 0; i < u8.length; i += 3) {
      b0 = u8[i]; b1 = i + 1 < u8.length ? u8[i + 1] : NaN; b2 = i + 2 < u8.length ? u8[i + 2] : NaN;
      out += B64[b0 >> 2];
      out += B64[((b0 & 3) << 4) | (b1 >> 4)];
      out += isNaN(b1) ? '=' : B64[((b1 & 15) << 2) | (b2 >> 6)];
      out += isNaN(b2) ? '=' : B64[b2 & 63];
    }
    return out;
  }
  function unb64(s) {
    s = String(s).replace(/[^A-Za-z0-9+/]/g, '');
    var out = new Uint8Array(Math.floor(s.length * 3 / 4));
    var p = 0;
    for (var i = 0; i < s.length; i += 4) {
      var c0 = B64.indexOf(s[i]), c1 = B64.indexOf(s[i + 1]);
      var c2 = s[i + 2] ? B64.indexOf(s[i + 2]) : NaN;
      var c3 = s[i + 3] ? B64.indexOf(s[i + 3]) : NaN;
      out[p++] = (c0 << 2) | (c1 >> 4);
      if (!isNaN(c2)) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
      if (!isNaN(c3)) out[p++] = ((c2 & 3) << 6) | c3;
    }
    return out.subarray(0, p);
  }

  function sha256(data) {
    return crypto.subtle.digest('SHA-256', data).then(function (buf) { return new Uint8Array(buf); });
  }

  function generateKeypair() { return nacl.box.keyPair(); }

  function keypairFromSecret(secretB64) { return nacl.box.keyPair.fromSecretKey(unb64(secretB64)); }

  function exportSecret(kp) { return b64(kp.secretKey); }

  function publicB64(kp) { return b64(kp.publicKey); }

  function sharedSecret(mySecretKey, theirPublicB64) {
    return nacl.box.before(unb64(theirPublicB64), mySecretKey);
  }

  function sealMessage(shared, plaintext, aad) {
    var salt = randomBytes(16), iv = randomBytes(12);
    return sha256(concatBytes([shared, salt])).then(function (keyBytes) {
      return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    }).then(function (key) {
      return crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv, additionalData: enc.encode(aad || '') },
        key, enc.encode(plaintext)
      );
    }).then(function (ct) {
      return b64(concatBytes([salt, iv, new Uint8Array(ct)]));
    });
  }

  // Шифрование произвольных байтов (файлы). Тот же формат конверта: salt(16)||iv(12)||ct.
  function sealBytes(shared, dataU8, aad) {
    var salt = randomBytes(16), iv = randomBytes(12);
    return sha256(concatBytes([shared, salt])).then(function (keyBytes) {
      return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    }).then(function (key) {
      return crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv, additionalData: enc.encode(aad || '') },
        key, dataU8
      );
    }).then(function (ct) {
      return b64(concatBytes([salt, iv, new Uint8Array(ct)]));
    });
  }

  // Расшифровка байтов: принимает и конверт-base64, и сырые байты (salt||iv||ct).
  function openBytes(shared, data, aad) {
    return Promise.resolve().then(function () {
      var raw = (typeof data === 'string') ? unb64(data) : data;
      if (!raw || raw.length < 28) return null;
      var salt = raw.subarray(0, 16), iv = raw.subarray(16, 28), ct = raw.subarray(28);
      if (ct.length < 16) return null;
      return sha256(concatBytes([shared, salt])).then(function (keyBytes) {
        return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
      }).then(function (key) {
        return crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv, additionalData: enc.encode(aad || '') },
          key, ct
        );
      }).then(function (pt) { return pt; });
    }).catch(function () { return null; });
  }

  function openMessage(shared, envelopeB64, aad) {
    return Promise.resolve().then(function () {
      var raw = unb64(envelopeB64);
      if (raw.length < 28) return null;
      var salt = raw.subarray(0, 16), iv = raw.subarray(16, 28), ct = raw.subarray(28);
      if (ct.length < 16) return null;
      return sha256(concatBytes([shared, salt])).then(function (keyBytes) {
        return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
      }).then(function (key) {
        return crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv, additionalData: enc.encode(aad || '') },
          key, ct
        );
      }).then(function (pt) { return dec.decode(pt); });
    }).catch(function () { return null; });
  }

  // --- хранилище ключа в аккаунте: секрет заворачивается паролем (PBKDF2-SHA256 + AES-GCM) ---
  // Сервер получает только конверт. Пароль нигде не сохраняется — он живёт в памяти до перезагрузки страницы.
  var PBKDF2_ITER = 210000;
  var VAULT_AAD = 'sekretka-vault-1';

  function pbkdf2Key(pass, salt, usage) {
    return crypto.subtle.importKey('raw', enc.encode(String(pass)), { name: 'PBKDF2' }, false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, usage
        );
      });
  }

  // secretB64 (отмычка) + пароль -> конверт b64(salt16||iv12||ct)
  function wrapSecret(secretB64, pass) {
    var salt = randomBytes(16), iv = randomBytes(12);
    return pbkdf2Key(pass, salt, ['encrypt']).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: enc.encode(VAULT_AAD) }, key, enc.encode(secretB64));
    }).then(function (ct) {
      return b64(concatBytes([salt, iv, new Uint8Array(ct)]));
    });
  }

  // конверт + пароль -> secretB64 или null (неверный пароль / порча / чужое хранилище)
  function unwrapSecret(vaultB64, pass) {
    return Promise.resolve().then(function () {
      var raw = unb64(vaultB64);
      if (!raw || raw.length < 28) return null;
      var salt = raw.subarray(0, 16), iv = raw.subarray(16, 28), ct = raw.subarray(28);
      if (ct.length < 16) return null;
      return pbkdf2Key(pass, salt, ['decrypt']).then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv, additionalData: enc.encode(VAULT_AAD) }, key, ct);
      }).then(function (pt) { return dec.decode(pt); });
    }).catch(function () { return null; });
  }

  return {
    randomBytes: randomBytes,
    b64: b64,
    unb64: unb64,
    wrapSecret: wrapSecret,
    unwrapSecret: unwrapSecret,
    generateKeypair: generateKeypair,
    keypairFromSecret: keypairFromSecret,
    exportSecret: exportSecret,
    publicB64: publicB64,
    sharedSecret: sharedSecret,
    sealMessage: sealMessage,
    openMessage: openMessage,
    sealBytes: sealBytes,
    openBytes: openBytes
  };
});
