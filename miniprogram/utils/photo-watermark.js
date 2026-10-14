// 履约留痕照片水印(前端 canvas 合成): 在图片底部叠加半透明底栏 + 地址/时间文字。
// 用途: 需求 B「开始履约」强制资料 —— 现场照片须带地址与时间信息, 作为履约到场的可信留痕。
// 依赖: 基础库 2.16.1+ 的离屏 canvas(type=2d)。合成失败由调用方降级(仍上传原图, 不阻断履约主流程)。

/**
 * 给单张图片叠加水印, 返回新的临时文件路径。
 * @param {string} srcPath  原图临时路径(chooseMedia 返回的 tempFilePath)
 * @param {string[]} lines  水印文本行(如 [订单号, 地址, 时间]); 空行会被忽略
 * @returns {Promise<string>} 加水印后的临时文件路径(失败 reject)
 */
function watermark(srcPath, lines) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: srcPath,
      success: (info) => {
        // 长边限制 1600, 控制内存与上传体积(照片本身仅作留痕, 不需要原图分辨率)
        const MAX = 1600;
        const scale = Math.min(1, MAX / Math.max(info.width || 1, info.height || 1));
        const w = Math.max(1, Math.round((info.width || 1) * scale));
        const h = Math.max(1, Math.round((info.height || 1) * scale));
        let canvas;
        try {
          canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
        } catch (e) { reject(e); return; }
        const ctx = canvas.getContext('2d');
        const img = canvas.createImage();
        img.onload = () => {
          try {
            ctx.drawImage(img, 0, 0, w, h);
            drawBand(ctx, w, h, lines);
          } catch (e) { reject(e); return; }
          wx.canvasToTempFilePath({
            canvas,
            fileType: 'jpg',
            quality: 0.92,
            success: (r) => resolve(r.tempFilePath),
            fail: (err) => reject(err)
          });
        };
        img.onerror = (err) => reject(err || new Error('watermark_image_load_fail'));
        img.src = srcPath;
      },
      fail: (err) => reject(err)
    });
  });
}

// 底部半透明底栏 + 逐行白字(字号随图宽缩放, 保证各机型比例一致)
function drawBand(ctx, w, h, lines) {
  const rows = (lines || []).filter((t) => t);
  if (!rows.length) return;
  const fs = Math.max(14, Math.round(w * 0.03));
  const pad = Math.round(fs * 0.6);
  const lh = Math.round(fs * 1.35);
  const bandH = lh * rows.length + pad * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, h - bandH, w, bandH);
  ctx.font = `${fs}px sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  rows.forEach((t, i) => ctx.fillText(String(t), pad, h - bandH + pad + i * lh));
}

module.exports = { watermark };
