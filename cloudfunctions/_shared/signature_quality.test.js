// signature-quality 纯函数单测 · 覆盖空签/单点/笔画过少/过小/正常五种判定
const test = require('node:test');
const assert = require('node:assert');
const { analyzeInkPixels } = require('../../miniprogram/utils/signature-quality.js');

const W = 400;
const H = 200;

function blank() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  return data;
}

function paint(data, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * W + x) * 4;
      data[i] = 31;
      data[i + 1] = 41;
      data[i + 2] = 55;
      data[i + 3] = 255;
    }
  }
}

test('空画布 → empty', () => {
  const r = analyzeInkPixels(blank(), W, H);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'empty');
  assert.strictEqual(r.inkPixels, 0);
});

test('单点落笔 → single_point', () => {
  const d = blank();
  paint(d, 200, 100, 201, 101);
  const r = analyzeInkPixels(d, W, H);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'single_point');
});

test('短划痕笔画过少 → too_few', () => {
  const d = blank();
  paint(d, 180, 100, 210, 102);
  const r = analyzeInkPixels(d, W, H);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'too_few');
});

test('小尺寸涂写 → too_small', () => {
  const d = blank();
  paint(d, 180, 90, 209, 104);
  const r = analyzeInkPixels(d, W, H);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'too_small');
});

test('短划痕(80x25) → too_small', () => {
  const d = blank();
  paint(d, 160, 88, 239, 112);
  const r = analyzeInkPixels(d, W, H);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'too_small');
});

test('极短横向划痕(120x10) → too_small', () => {
  const d = blank();
  paint(d, 140, 95, 259, 104);
  const r = analyzeInkPixels(d, W, H);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'too_small');
});

test('正常姓名书写 → ok', () => {
  const d = blank();
  paint(d, 60, 60, 300, 140);
  const r = analyzeInkPixels(d, W, H);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.code, 'ok');
  assert.ok(r.inkRatio > 0.003);
  assert.deepStrictEqual(r.bbox, { x: 60, y: 60, w: 241, h: 81 });
});

test('浅灰像素不计入墨迹 → empty', () => {
  const d = blank();
  paint(d, 60, 60, 300, 140);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 240;
    d[i + 1] = 240;
    d[i + 2] = 240;
  }
  const r = analyzeInkPixels(d, W, H);
  assert.strictEqual(r.code, 'empty');
});

test('尺寸参数缺失 → canvas_not_ready', () => {
  const r = analyzeInkPixels(null, 0, 0);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'canvas_not_ready');
});
