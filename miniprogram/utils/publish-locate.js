// miniprogram/utils/publish-locate.js · 发布页「定位」服务模块
// 拆分阶段2(文件2, 2026-10-16): 原 publish.js 方法逐字迁出(用户书面批准, 方案 §8.2 前置3); 接收 page
// 设计: 只搬不改逻辑; 禁 getApp()/globalData(方案 §5.8); 页面 publish.js 留同名薄代理, 全部调用点零改
// 迁出源: publish.js onLocationPick(现 L782) / _locatePublish(现 L879) / _offerManualPick(现 L944) / onRelocatePublish(现 L970)
// reverseGeocode 按方案 §3 迁 utils/geo-wx.js(与文件1 addrOf 共置), 本模块 require 复用

const { pad2, haversineKm, fmtDist } = require('./publish-validate.js');
const { reverseGeocode } = require('./geo-wx.js');

// 迁自 publish.js onLocationPick(手动地图选点); this.data/this.setData → page.* (机械替换)
function onLocationPick(page) {
  wx.chooseLocation({
    success: (res) => {
      const pub = page.data.publishLocation;
      const dist = (pub && Number(res.latitude) && Number(res.longitude))
        ? haversineKm(pub.latitude, pub.longitude, Number(res.latitude), Number(res.longitude))
        : 0;
      page.setData({
        'form.location_name': res.name || res.address,
        'form.latitude': res.latitude,
        'form.longitude': res.longitude,
        distanceKm: dist,
        distanceText: fmtDist(dist)
      });
    },
    fail: (err) => {
      // 用户主动取消不提示
      if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return;
      console.error('[onLocationPick] fail:', err);
      wx.showModal({
        title: '选点失败',
        content: (err && err.errMsg) || '请检查系统定位服务是否开启',
        showCancel: false
      });
    }
  });
}

// 迁自 publish.js _locatePublish(自动记录当前位置); 原体内 this._offerManualPick/this._locatePublish → 模块内 offerManualPick(page,...)/locatePublish(page,...)
// 2026-10-27: 增加 8s 看门狗 + 高精度超时; wx.getLocation 回调不返回时必须复位 locating, 防旋转图标永久卡死
const LOCATE_TIMEOUT_MS = 8000;
function locatePublish(page, showToast) {
  if (page.data.locating) return;
  const seq = (page.__locateSeq || 0) + 1;
  page.__locateSeq = seq;
  const isCurrent = () => page.__locateSeq === seq;
  if (page.__locateTimer) clearTimeout(page.__locateTimer);
  page.setData({ locating: true });
  page.__locateTimer = setTimeout(() => {
    if (!isCurrent()) return;
    page.__locateSeq = seq + 1;   // 作废迟到回调
    page.setData({ locating: false });
    console.warn('[locatePublish] timeout', LOCATE_TIMEOUT_MS);
    offerManualPick(page, `定位超时(${LOCATE_TIMEOUT_MS / 1000}s)`);
  }, LOCATE_TIMEOUT_MS);
  wx.getLocation({
    type: 'gcj02',
    isHighAccuracy: true,
    highAccuracyExpireTime: 4000,
    success: async (res) => {
      if (!isCurrent()) return;
      clearTimeout(page.__locateTimer);
      const now = new Date();
      const pub = {
        latitude: res.latitude,
        longitude: res.longitude,
        name: '当前位置',
        address: '',  // 逆地理编码回填, key 空则保持空
        updatedAt: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
      };
      const f = page.data.form;
      const dist = (Number(f.latitude) && Number(f.longitude))
        ? haversineKm(pub.latitude, pub.longitude, Number(f.latitude), Number(f.longitude))
        : 0;
      page.setData({
        locating: false,
        publishLocation: pub,
        distanceKm: dist,
        distanceText: fmtDist(dist)
      });
      // 逆地理编码(异步, 不阻塞页面; key 空则静默跳过)
      const addr = await reverseGeocode(pub.latitude, pub.longitude);
      if (!isCurrent()) return;   // 期间已发起新定位/离开页面 → 丢弃旧结果
      if (addr) {
        page.setData({ 'publishLocation.address': addr });
      }
      if (showToast) wx.showToast({ title: '已重新定位', icon: 'success' });
    },
    fail: (err) => {
      if (!isCurrent()) return;
      clearTimeout(page.__locateTimer);
      page.setData({ locating: false });
      const msg = (err && err.errMsg) || 'unknown';
      if (/cancel/i.test(msg)) return;
      console.warn('[getLocation fail]', msg);
      // 权限被拒(含"不再询问") → 引导去设置开启, 恢复后自动重新定位
      if (/auth|deny|denied/i.test(msg)) {
        wx.showModal({
          title: '需要定位权限',
          content: '定位权限未开启, 是否前往设置开启?',
          confirmText: '去设置',
          cancelText: '手动选点',
          success: (r) => {
            if (!r.confirm) return offerManualPick(page);
            wx.openSetting({
              success: (s) => {
                if (s.authSetting && s.authSetting['scope.userLocation']) {
                  locatePublish(page, true);
                } else {
                  offerManualPick(page);
                }
              },
              fail: () => offerManualPick(page)
            });
          }
        });
        return;
      }
      // 非权限类失败: 弹窗带出具体 errMsg, 现场可见根因
      offerManualPick(page, msg);
    }
  });
}

// 迁自 publish.js _offerManualPick; 手动选点兜底弹窗(errMsg 附加展示, 便于现场定位根因)
function offerManualPick(page, msg) {
  wx.showModal({
    title: '定位不可用',
    content: `定位失败(${msg || 'unknown'}), 是否在地图上手动选点?`,
    confirmText: '手动选点',
    cancelText: '跳过',
    success: (r) => {
      if (!r.confirm) return;
      wx.chooseLocation({
        success: async (loc) => {
          const now = new Date();
          const pub = {
            latitude: loc.latitude, longitude: loc.longitude,
            name: loc.name || '手动选点', address: loc.address || '',
            updatedAt: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
          };
          const f = page.data.form;
          const dist = (Number(f.latitude) && Number(f.longitude))
            ? haversineKm(pub.latitude, pub.longitude, Number(f.latitude), Number(f.longitude)) : 0;
          page.setData({ publishLocation: pub, distanceKm: dist, distanceText: fmtDist(dist) });
        },
        fail: () => wx.showToast({ title: '未选择位置', icon: 'none' })
      });
    }
  });
}

// 迁自 publish.js onRelocatePublish
function onRelocatePublish(page) {
  locatePublish(page, true);
}

module.exports = { onLocationPick, locatePublish, offerManualPick, onRelocatePublish };
