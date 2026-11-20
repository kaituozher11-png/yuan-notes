const enc = new TextEncoder();
const dec = new TextDecoder();
const bytes = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const base64 = (value) => btoa(String.fromCharCode(...new Uint8Array(value)));

async function derive(passphrase, salt) {
  if (!crypto.subtle) throw new Error('此连接不支持安全保存模型密钥。请改用 HTTPS 网站地址后重试。');
  const input = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, input, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function seal(secret, passphrase) {
  if (passphrase.length < 8) throw new Error('保护口令至少需要 8 个字符');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase, salt);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(secret));
  return { salt: base64(salt), iv: base64(iv), cipher: base64(cipher) };
}
export async function openVault(stored, passphrase) {
  try {
    const key = await derive(passphrase, bytes(stored.salt));
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(stored.iv) }, key, bytes(stored.cipher)));
  } catch { throw new Error('口令不正确，或密钥数据已损坏'); }
}
