// miniprogram/utils/order-evidence.js · 订单详情「履约留痕」采集/上传服务模块
// 拆分阶段2b(2026-10-16): 原 order-detail.js @VERIFIED 方法逐字迁出(用户书面批准, 方案 §8.2 前置3); 接收 page
// 设计: 只搬不改逻辑; 禁 getApp()/globalData(方案 §5.8); 页面 order-detail.js 留同名薄代理, 全部调用点零改
// 迁出源: order-detail.js _collectStartEvidence(现 L700) / _uploadStartPhotos(现 L747) / _uploadEvidenceOne(现 L802)
// ⚠ 全文件唯一 wx.cloud.uploadFile 直接调用点在 uploadEvidenceOne 内(方案 §5.5: 组件化后上传仍须留页面侧, 本阶段约定不变)

const { addrOf } = require('./geo-wx.js');

// 迁自 order-detail.js _collectStartEvidence; 原体内 that._addrOf → 模块内 addrOf, that._uploadStartPhotos → uploadStartPhotos(page,...)(机械替换)
function collectStartEvidence(page, serverAt, stage) {
  return new Promise((resolve) => {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 4000,
      success: (loc) => {
        // L1-1(2026-10-14) 异常隔离: 采集/上传链任何抛错都须收敛为 resolve(null), 不得悬空 Promise 或卡住 loading
        try {
          const at = Number(serverAt) || Date.now();
          addrOf(loc.latitude, loc.longitude).then((addr) => {
            wx.chooseMedia({
              count: 3,
              mediaType: ['image'],
              sizeType: ['compressed'],
              sourceType: ['camera', 'album'],
              // uploadStartPhotos 内部已兜底返回 null; 末尾 .catch 为防御性二次兜底
              success: (res) => uploadStartPhotos(page, res.tempFiles || [], { loc, addr, at, stage }).then(resolve).catch(() => resolve(null)),
              fail: () => resolve(null)
            });
          }).catch(() => {
            wx.showToast({ title: '定位解析失败,请重试', icon: 'none' });
            resolve(null);
          });
        } catch (e) {
          console.error('[start-evidence collect]', e);
          wx.showToast({ title: '采集失败,请重试', icon: 'none' });
          resolve(null);
        }
      },
      fail: () => {
        wx.showToast({ title: '开始履约需授权定位, 请开启后重试', icon: 'none' });
        resolve(null);
      }
    });
  });
}

// 迁自 order-detail.js _uploadStartPhotos; this.data.order→page.data.order, this.__orderId→page.__orderId, this._uploadEvidenceOne→uploadEvidenceOne(机械替换)
async function uploadStartPhotos(page, files, ctx) {
  if (!files.length) {
    wx.showToast({ title: '请至少拍摄1张现场照片', icon: 'none' });
    return null;
  }
  const { watermark } = require('./photo-watermark.js');
  const d = new Date(ctx.at);
  const pad = (n) => String(n).padStart(2, '0');
  const timeText = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const orderNo = (page.data.order && page.data.order.order_no) || '';
  wx.showLoading({ title: '处理照片…', mask: true });
  try {
    // 先逐张叠水印(可失败降级原图), 再并行上传 —— 缩短总耗时
    const jobs = [];
    for (let i = 0; i < Math.min(files.length, 3); i++) {
      const tmp = files[i].tempFilePath;
      let out = tmp;
      try {
        // 水印内容(规范 §2.4): 角色标识 + 订单号 + 地点 + 服务端时间
        out = await watermark(tmp, ['耍伴', `订单 ${orderNo}`, ctx.addr, timeText]);
      } catch (e) { /* 水印合成失败: 降级上传原图, 不阻断 */ }
      const name = String(tmp).split('/').pop();
      const ext = String(name.split('.').pop() || 'jpg').toLowerCase();
      jobs.push({
        filePath: out,
        cloudPath: `${ctx.stage || 'start'}-evidence/${page.__orderId}/${ctx.at}-${i}.${ext}`,
        // 首张默认「周边环境」, 其余默认「局部」(服务端仅做归一化, 不强制比例)
        kind: i === 0 ? 'scene' : 'closeup',
        at: ctx.at
      });
    }
    const photos = await Promise.all(jobs.map((j) => uploadEvidenceOne(j)));
    wx.hideLoading();
    return {
      photos,
      partner_location: {
        latitude: ctx.loc.latitude,
        longitude: ctx.loc.longitude,
        accuracy: Math.round(ctx.loc.accuracy || 0),
        address: ctx.addr,
        at: ctx.at
      }
    };
  } catch (e) {
    // L1-1: 上传/合成任何失败都收敛为 null, 保证 loading 关闭并给出可读提示(不再静默卡死)
    wx.hideLoading();
    console.error('[start-evidence upload]', e);
    const raw = (e && (e.errMsg || e.message)) || '';
    const title = raw ? `上传失败:${raw}` : '照片上传失败,请重试';
    wx.showToast({ title: title.length > 20 ? title.slice(0, 20) : title, icon: 'none', duration: 3000 });
    return null;
  }
}

// 迁自 order-detail.js _uploadEvidenceOne(单张留痕照片上传: 单次 15s 超时; 失败自动重试 1 次(仅该张); 仍失败则 reject; 不依赖 page)
function uploadEvidenceOne(job) {
  const attempt = () => new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('upload_timeout')); } }, 15000);
    wx.cloud.uploadFile({ cloudPath: job.cloudPath, filePath: job.filePath })
      .then((up) => { if (settled) return; settled = true; clearTimeout(timer); resolve(up); })
      .catch((err) => { if (settled) return; settled = true; clearTimeout(timer); reject(err); });
  });
  return attempt()
    .catch(() => attempt())
    .then((up) => ({ file_id: up.fileID, kind: job.kind, at: job.at }));
}

module.exports = { collectStartEvidence, uploadStartPhotos, uploadEvidenceOne };
