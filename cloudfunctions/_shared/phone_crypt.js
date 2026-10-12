// 共享：手机号加密存储 + 确定性查询键(评审整改 P0-3, 2026-10-12)
// ⚠️ 微信云开发按单函数目录打包, 不支持跨目录 require('../_shared/')。
// 本文件为「规范源」, 修改后需运行 sync-phone-crypt.ps1 同步复制到:
//   cloudfunctions/user-login/phone_crypt.js
//   cloudfunctions/demand-publish/phone_crypt.js
//   cloudfunctions/admin-action/phone_crypt.js
//
// 落库三字段(替代明文 phone):
//   phone_enc   AES-256-GCM 密文(hex: iv12 + tag16 + ct), 密钥 admin_config.phone_aes_key(64 hex)
//   phone_hash  HMAC-SHA256(phone, key) hex —— 确定性, 供 where({ phone_hash }) 查询/去重
//   phone_mask  138****1234 展示掩码(非敏感; 输出层直接用, 免解密)
//
// 兼容(dual-read): 存量未迁移文档仍读明文 doc.phone; 下次写入时由 phonePatch 升级为密文并移除明文。
const crypto = require('crypto');

// 与 user-login 同口径: 中国大陆手机号
const PHONE_RE = /^1[3-9]\d{9}$/;

function maskPhone(p) {
  const s = String(p || '');
  if (s.length < 11) return s;
  return s.slice(0, 3) + '****' + s.slice(7);
}

// 密钥合法性(64 hex = 32 字节)
function isHexKey(k) {
  return !!k && /^[0-9a-f]{64}$/i.test(String(k));
}

function phoneHash(phone, keyHex) {
  return crypto.createHmac('sha256', Buffer.from(String(keyHex), 'hex')).update(String(phone)).digest('hex');
}

function encryptPhone(plain, keyHex) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(String(keyHex), 'hex'), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('hex');
}

function decryptPhone(encHex, keyHex) {
  const buf = Buffer.from(String(encHex), 'hex');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(String(keyHex), 'hex'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// 生成落库补丁(加密三字段)。update 调用方须自行追加 phone: _.remove() 以清除存量明文。
function phonePatch(plain, keyHex) {
  const p = String(plain == null ? '' : plain).trim();
  return {
    phone_enc: encryptPhone(p, keyHex),
    phone_hash: phoneHash(p, keyHex),
    phone_mask: maskPhone(p)
  };
}

// 读取真实手机号(需密钥): 优先 phone_enc 解密; 回退存量明文 phone
function readPhone(doc, keyHex) {
  if (!doc) return '';
  if (doc.phone_enc && isHexKey(keyHex)) {
    try { return decryptPhone(doc.phone_enc, keyHex); } catch (e) { return ''; }
  }
  return String(doc.phone || '');
}

// 展示掩码(无需密钥, 优先落库掩码, 回退存量明文现算)
function displayPhone(doc) {
  if (!doc) return '';
  if (doc.phone_mask) return doc.phone_mask;
  return maskPhone(doc.phone || '');
}

module.exports = {
  PHONE_RE, maskPhone, isHexKey,
  phoneHash, encryptPhone, decryptPhone, phonePatch, readPhone, displayPhone
};
