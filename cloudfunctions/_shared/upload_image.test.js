// upload_image 服务端尺寸校验单测（批 6.3）· readImageDims 解析 PNG/JPEG 文件头
const test = require('node:test');
const assert = require('node:assert');
const { readImageDims } = require('../admin-action/action_misc.js');

// 构造最小合法 PNG: 8 字节签名 + IHDR(len=13, 'IHDR', w, h, 5 字节头字段, 4 CRC)
function pngBuf(w, h) {
  const b = Buffer.alloc(8 + 4 + 4 + 4 + 4 + 5 + 4);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((v, i) => b[i] = v);
  b.writeUInt32BE(13, 8);          // IHDR length
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
// 构造最小 JPEG: SOI + SOF0 段(ff c0 len precision h w ...)
function jpgBuf(w, h) {
  const b = Buffer.alloc(16);
  b[0] = 0xff; b[1] = 0xd8;                 // SOI
  b[2] = 0xff; b[3] = 0xc0;                 // SOF0 marker
  b.writeUInt16BE(11, 4);                   // segment length
  b[6] = 0x08;                              // precision
  b.writeUInt16BE(h, 7);
  b.writeUInt16BE(w, 9);
  return b;
}

test('PNG 解析宽高', () => {
  const r = readImageDims(pngBuf(750, 750));
  assert.deepStrictEqual(r, { format: 'png', width: 750, height: 750 });
});
test('JPEG 解析宽高', () => {
  const r = readImageDims(jpgBuf(800, 600));
  assert.deepStrictEqual(r, { format: 'jpg', width: 800, height: 600 });
});
test('非正方形 PNG 可被识别(宽≠高)', () => {
  const r = readImageDims(pngBuf(1080, 720));
  assert.notStrictEqual(r.width, r.height);
});
test('无法解析的 buffer 返回 null', () => {
  assert.strictEqual(readImageDims(Buffer.from([0x00, 0x01, 0x02])), null);
  assert.strictEqual(readImageDims(null), null);
});
// 构造带 0xFF 填充的 JPEG: SOI + 填充字节 + SOF0(评审修复 R3: 填充不应对齐错位)
function jpgBufPadded(w, h) {
  const b = Buffer.alloc(19);
  b[0] = 0xff; b[1] = 0xd8;                 // SOI
  b[2] = 0xff; b[3] = 0xff; b[4] = 0xff;    // 填充字节(JPEG 规范允许 marker 前多个 0xFF)
  b[5] = 0xff; b[6] = 0xc0;                 // SOF0 marker
  b.writeUInt16BE(11, 7);                   // segment length
  b[9] = 0x08;                              // precision
  b.writeUInt16BE(h, 10);
  b.writeUInt16BE(w, 12);
  return b;
}
test('JPEG marker 前 0xFF 填充可正确解析(R3)', () => {
  const r = readImageDims(jpgBufPadded(750, 750));
  assert.deepStrictEqual(r, { format: 'jpg', width: 750, height: 750 });
});
