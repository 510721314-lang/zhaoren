// phone_crypt 纯规则单测(P0-3 整改): 加密/解密/确定性查询键/掩码/兼容读
const test = require('node:test');
const assert = require('node:assert');
const pc = require('./phone_crypt');

const KEY = 'a'.repeat(64);          // 合法 64 hex 密钥
const PHONE = '13812345678';

test('isHexKey: 仅接受 64 位 hex', () => {
  assert.strictEqual(pc.isHexKey(KEY), true);
  assert.strictEqual(pc.isHexKey('A'.repeat(64)), true);
  assert.strictEqual(pc.isHexKey(''), false);
  assert.strictEqual(pc.isHexKey(null), false);
  assert.strictEqual(pc.isHexKey('z'.repeat(64)), false);
  assert.strictEqual(pc.isHexKey('a'.repeat(63)), false);
});

test('maskPhone: 11 位掩中间四位; 非 11 位原样', () => {
  assert.strictEqual(pc.maskPhone(PHONE), '138****5678');
  assert.strictEqual(pc.maskPhone(''), '');
  assert.strictEqual(pc.maskPhone('12345'), '12345');
});

test('phoneHash: 确定性(同号同键恒等) + 不同号不同值', () => {
  const h1 = pc.phoneHash(PHONE, KEY);
  const h2 = pc.phoneHash(PHONE, KEY);
  assert.strictEqual(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(pc.phoneHash('13800000000', KEY), h1);
});

test('encryptPhone/decryptPhone: 往返一致 + 随机 IV(同明文两次密文不同)', () => {
  const e1 = pc.encryptPhone(PHONE, KEY);
  const e2 = pc.encryptPhone(PHONE, KEY);
  assert.notStrictEqual(e1, e2, '随机 IV 应使密文不同');
  assert.strictEqual(pc.decryptPhone(e1, KEY), PHONE);
  assert.strictEqual(pc.decryptPhone(e2, KEY), PHONE);
});

test('decryptPhone: 错误密钥应抛错(GCM 认证)', () => {
  const e = pc.encryptPhone(PHONE, KEY);
  assert.throws(() => pc.decryptPhone(e, 'b'.repeat(64)));
});

test('phonePatch: 产出三字段且不含明文 phone', () => {
  const p = pc.phonePatch(PHONE, KEY);
  assert.ok(p.phone_enc && p.phone_hash && p.phone_mask);
  assert.strictEqual(p.phone_mask, '138****5678');
  assert.strictEqual(p.phone, undefined, '不得含明文 phone 字段');
  assert.strictEqual(pc.decryptPhone(p.phone_enc, KEY), PHONE);
});

test('readPhone: 密文文档解密; 存量明文文档回退; 空文档空串', () => {
  const p = pc.phonePatch(PHONE, KEY);
  assert.strictEqual(pc.readPhone({ phone_enc: p.phone_enc }, KEY), PHONE);
  assert.strictEqual(pc.readPhone({ phone: PHONE }, KEY), PHONE, '存量明文兼容');
  assert.strictEqual(pc.readPhone(null, KEY), '');
  assert.strictEqual(pc.readPhone({}, KEY), '');
  assert.strictEqual(pc.readPhone({ phone_enc: 'deadbeef' }, KEY), '', '密文损坏返回空而非抛错');
});

test('displayPhone: 优先落库掩码; 否则由明文现算; 密文文档无掩码时返回空', () => {
  assert.strictEqual(pc.displayPhone({ phone_mask: '138****5678' }), '138****5678');
  assert.strictEqual(pc.displayPhone({ phone: PHONE }), '138****5678');
  assert.strictEqual(pc.displayPhone({}), '');
  assert.strictEqual(pc.displayPhone(null), '');
});
