// utils/signature-quality.js · 手写签名质量识别(纯函数, 不依赖 wx)
// 用途: 签字提交前判断笔画是否为空/过少/过小/单点, 避免无效签名进入取证链路
// 边界: 仅做几何统计, 不做笔迹/OCR 身份比对, 不引入第三方服务
const INK_THRESHOLD = 200;       // RGB 任一通道 < 200 视为墨迹(白底 255)
const MIN_INK_PIXELS = 60;       // 设备像素
const MIN_INK_RATIO = 0.0012;    // 墨迹占比下限 0.12%
const MIN_WIDTH_RATIO = 0.18;    // 包围盒宽度下限
const MIN_HEIGHT_RATIO = 0.10;   // 包围盒高度下限
const SINGLE_POINT_SPAN = 8;     // 包围盒宽高均 <= 8 设备像素视为单点

const MESSAGES = {
  ok: '签名识别通过',
  empty: '请先手写签名',
  too_few: '签名笔画过少，请完整书写姓名',
  too_small: '签名过小，请写大一些',
  single_point: '仅识别到单点，请完整书写姓名',
  canvas_not_ready: '签字板未就绪，请重试',
  recognize_failed: '签名识别失败，请重试'
};

function makeResult(code, inkPixels, inkRatio, bbox, canvas) {
  return {
    ok: code === 'ok',
    code,
    message: MESSAGES[code] || MESSAGES.recognize_failed,
    inkPixels,
    inkRatio,
    bbox,
    canvas
  };
}

// data: getImageData().data (RGBA); width/height: canvas 设备像素
function analyzeInkPixels(data, width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const canvas = { w, h };
  if (!data || !w || !h) return makeResult('canvas_not_ready', 0, 0, { x: 0, y: 0, w: 0, h: 0 }, canvas);

  const total = w * h;
  let ink = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let p = 0, i = 0; p < total; p++, i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r >= INK_THRESHOLD && g >= INK_THRESHOLD && b >= INK_THRESHOLD) continue;
    ink++;
    const x = p % w;
    const y = (p - x) / w;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (!ink) return makeResult('empty', 0, 0, { x: 0, y: 0, w: 0, h: 0 }, canvas);

  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const bbox = { x: minX, y: minY, w: bboxW, h: bboxH };
  const ratio = ink / total;

  if (bboxW <= SINGLE_POINT_SPAN && bboxH <= SINGLE_POINT_SPAN) {
    return makeResult('single_point', ink, ratio, bbox, canvas);
  }
  if (ink < MIN_INK_PIXELS || ratio < MIN_INK_RATIO) {
    return makeResult('too_few', ink, ratio, bbox, canvas);
  }
  if (bboxW < w * MIN_WIDTH_RATIO || bboxH < h * MIN_HEIGHT_RATIO) {
    return makeResult('too_small', ink, ratio, bbox, canvas);
  }
  return makeResult('ok', ink, ratio, bbox, canvas);
}

module.exports = { analyzeInkPixels, MESSAGES };
