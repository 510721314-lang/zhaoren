// PRD章节: 3.6 安全报备 / V15 SAFETY配置 / 1.7.1 18-22岁保护
// P1: 接云端 order-action detail, 删 mock findOrder 依赖
const CONFIG = require('../../config/index.js');
const redline = require('../../utils/redline.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

Page({
  data: {
    order: null,
    redirect: false,
    // A1 报备状态
    checkinStartedAt: 0,
    elapsedSec: 0,
    // A2 实时定位（安全报警核心）
    locating: false,
    locStatus: 'idle',        // idle|locating|success|fail
    currentLat: 0,
    currentLng: 0,
    accuracy: 0,              // 精度半径(米), 越小越准
    accuracyText: '',         // 人类可读: "12 米" / "> 1000 米(低精度)"
    address: '',              // 逆地理编码后可读地址, 如"成都市双流区xxx"
    locUpdateAt: '',           // 上次定位时间 HH:mm:ss
    mapMarkers: [],            // <map> 组件 markers
    mapLat: 0,
    mapLng: 0,
    // A3 打卡
    lastCheckin: '',
    nextCheckinSec: CONFIG.SAFETY.checkinMin * 60,
    // A4 一键求助（长按时长取 CONFIG.SAFETY.oneKeyPressSec）
    sosProgress: 0,            // 0-360 度
    sosLongPressing: false,
    sosActive: false,          // 已发出
    // A4 静默求助
    silentCountdownSec: 0,
    silentActive: false,
    loading: false,
    loadError: false,
    isRedline: false,
    // C 可运营参数（供 WXML 绑定）
    checkinMin: CONFIG.SAFETY.checkinMin,
    oneKeyPressSec: CONFIG.SAFETY.oneKeyPressSec,
    sosCountdownSec: CONFIG.SAFETY.sosCountdownSec,
    locationRefreshSec: CONFIG.SAFETY.locationRefreshSec,
    hasMapKey: !!CONFIG.TENCENT_MAP_KEY
  },

  onLoad(options) {
    this.fetchData(options);
  },

  fetchData(options) {
    this.__orderId = (options && options.orderId) || '';
    this.__lastOptions = options || {};
    if (!/^[a-f0-9]{32}$/i.test(this.__orderId)) {
      this.setData({ loading: false, loadError: true });
      return;
    }
    this.setData({ loading: true, loadError: false });
    callCloud('order-action', { action: 'detail', order_id: this.__orderId }).then((r) => {
      if (!r.ok) {
        this.setData({ loading: false, loadError: true });
        return;
      }
      const d = r.data;
      const order = {
        _id: d.order_id,
        order_id: d.order_id,
        order_no: d.order_no,
        status: d.status,
        scene_code: d.scene,
        safety: {
          last_checkin: (d.safety && d.safety.checkins && d.safety.checkins[0])
            ? new Date(d.safety.checkins[0].created_at).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
            : null
        }
      };
      if (order.status !== 'S3') {
        this.setData({ loading: false, order, redirect: true });
        wx.redirectTo({
          url: '/pages-v2/order-detail/order-detail?orderId=' + order._id,
          fail: () => wx.showToast({ title: '订单状态不允许安全报备', icon: 'none' })
        });
        return;
      }
      this.setData({
        order,
        redirect: false,
        checkinStartedAt: Date.now(),
        lastCheckin: order.safety.last_checkin || '--:--',
        loading: false
      });
      this.startTimers();
      this.startLocationTracking();  // 安全场景立即开始高精度定位
    }).catch(() => {
      this.setData({ loading: false, loadError: true });
    });
  },

  reload() { this.fetchData(this.__lastOptions || {}); },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  onUnload() { this.clearTimers(); this.stopLocationTracking(); },
  onHide() { this.clearTimers(); this.stopLocationTracking(); },

  clearTimers() {
    if (this._elapsedTimer) { clearInterval(this._elapsedTimer); this._elapsedTimer = null; }
    if (this._checkinTimer) { clearInterval(this._checkinTimer); this._checkinTimer = null; }
    if (this._sosTimer) { clearInterval(this._sosTimer); this._sosTimer = null; }
    if (this._silentTimer) { clearInterval(this._silentTimer); this._silentTimer = null; }
  },

  // —— A2 高精度定位跟踪（安全报警核心）——
  stopLocationTracking() {
    if (this._locTimer) { clearInterval(this._locTimer); this._locTimer = null; }
  },

  startLocationTracking() {
    this.stopLocationTracking();
    // 立即第一次定位
    this.getHighAccuracyLocation();
    // 定时刷新（人在移动时持续更新位置）
    const interval = (CONFIG.SAFETY.locationRefreshSec || 15) * 1000;
    this._locTimer = setInterval(() => this.getHighAccuracyLocation(), interval);
  },

  // 高精度 GPS: isHighAccuracy=true + highAccuracyExpireTime=4s
  // 安全报警场景必须尽可能准, accuracy 越小越好
  getHighAccuracyLocation() {
    if (this.data.locating) return;
    this.setData({ locating: true, locStatus: 'locating' });
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 4000,
      success: (res) => this._applyLocation(res),
      fail: (err) => {
        console.error('[safety] getLocation fail:', err);
        this.setData({ locating: false, locStatus: 'fail' });
      }
    });
  },

  _applyLocation(res) {
    const lat = res.latitude;
    const lng = res.longitude;
    const acc = Math.round(res.accuracy || 0); // 米
    const accuracyText = acc > 0
      ? (acc < 100 ? `${acc} 米` : acc < 1000 ? `${acc} 米(一般)` : `> 1000 米(低精度)`)
      : '未知';
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    // 地图 markers（蓝点 + 精度半径圆圈）
    const markers = [{
      id: 1,
      latitude: lat,
      longitude: lng,
      width: 24,
      height: 24,
      iconPath: '',  // 微信默认蓝点
      callout: {
        content: `精度 ${acc > 0 ? acc + 'm' : '未知'}`,
        color: '#ffffff',
        fontSize: 11,
        borderRadius: 4,
        bgColor: '#07C160',
        padding: 4,
        display: 'ALWAYS',
        textAlign: 'center'
      }
    }];
    this.setData({
      locating: false,
      locStatus: 'success',
      currentLat: lat,
      currentLng: lng,
      accuracy: acc,
      accuracyText,
      locUpdateAt: `${hh}:${mm}:${ss}`,
      mapLat: lat,
      mapLng: lng,
      mapMarkers: markers
    });
    // 有腾讯地图 key → 逆地理编码转可读地址
    if (CONFIG.TENCENT_MAP_KEY) {
      this.reverseGeocode(lat, lng);
    } else {
      // 无 key → 降级显示坐标
      this.setData({ address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
    }
  },

  reverseGeocode(lat, lng) {
    wx.request({
      url: `https://apis.map.qq.com/ws/geocoder/v1/?location=${lat},${lng}&key=${CONFIG.TENCENT_MAP_KEY}`,
      timeout: 5000,
      success: (r) => {
        const res = r.data && r.data.result;
        if (!res) {
          this.setData({ address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
          return;
        }
        // 优先用 recommend 地址, 回退 address, 最后坐标
        const addr = (res.formatted_addresses && res.formatted_addresses.recommend)
          || res.address
          || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        this.setData({ address: addr });
      },
      fail: () => {
        this.setData({ address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
      }
    });
  },

  startTimers() {
    // A1 已报备时长
    this._elapsedTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - this.data.checkinStartedAt) / 1000);
      this.setData({ elapsedSec: sec });
    }, 1000);

    // A3 下次打卡倒计时
    this._checkinTimer = setInterval(() => {
      let next = this.data.nextCheckinSec;
      if (next > 0) next--;
      this.setData({ nextCheckinSec: next });
    }, 1000);
  },

  // A3 手动打卡(云端落库 safety_report type=checkin; 定位失败不阻塞打卡)
  onManualCheckin() {
    const doCheckin = (loc) => {
      callCloud('safety-report', { action: 'checkin', order_id: this.__orderId, location: loc }).then((r) => {
        if (!r.ok) {
          wx.showToast({ title: r.msg || '打卡失败', icon: 'none' });
          return;
        }
        const at = (r.data && r.data.created_at) ? new Date(r.data.created_at) : new Date();
        const h = String(at.getHours()).padStart(2, '0');
        const m = String(at.getMinutes()).padStart(2, '0');
        this.setData({ lastCheckin: `${h}:${m}`, nextCheckinSec: CONFIG.SAFETY.checkinMin * 60 });
        wx.showToast({ title: '打卡成功', icon: 'success' });
      }).catch(() => wx.showToast({ title: '网络异常，打卡失败', icon: 'none' }));
    };
    wx.getLocation({
      type: 'gcj02',
      success: (res) => doCheckin({ latitude: res.latitude, longitude: res.longitude }),
      fail: () => doCheckin(null)  // 无定位权限/用户拒绝 → 无位置打卡,不阻塞
    });
  },

  // A4 一键求助：长按
  onSosTouchStart() {
    if (this.data.sosActive) return;
    this.setData({ sosLongPressing: true, sosProgress: 0 });
    const duration = CONFIG.SAFETY.oneKeyPressSec * 1000; // 3秒
    const step = 30; // 30ms 间隔
    const stepDeg = (360 * step) / duration;
    let progress = 0;
    try { wx.vibrateShort({ type: 'light' }); } catch (e) {}
    this._sosTimer = setInterval(() => {
      if (!this.data.sosLongPressing) {
        clearInterval(this._sosTimer);
        return;
      }
      progress += stepDeg;
      if (progress >= 360) {
        progress = 360;
        clearInterval(this._sosTimer);
        this.triggerSos('sos');
        return;
      }
      this.setData({ sosProgress: progress });
      // 持续震动
      if (Math.floor(progress) % 60 === 0) {
        try { wx.vibrateShort({ type: 'light' }); } catch (e) {}
      }
    }, step);
  },

  onSosTouchEnd() {
    if (this.data.sosActive) return;
    if (this.data.sosLongPressing && this.data.sosProgress < 360) {
      clearInterval(this._sosTimer);
      this.setData({ sosLongPressing: false, sosProgress: 0 });
      wx.showToast({ title: '已取消', icon: 'none' });
    }
  },

  // A4 求助触发(kind: 'sos'=长按一键 / 'silent'=静默倒计时结束) → 云端写 active 求助记录
  triggerSos(kind) {
    const action = kind === 'silent' ? 'silent_sos' : 'sos';
    const isSilent = kind === 'silent';
    callCloud('safety-report', { action, order_id: this.__orderId }).then((r) => {
      if (!r.ok) {
        this.setData({
          sosActive: false, sosLongPressing: false, sosProgress: 0,
          silentActive: false, silentCountdownSec: 0
        });
        wx.showToast({ title: r.msg || '求助发送失败，请直接拨打110', icon: 'none', duration: 2500 });
        return;
      }
      this.setData({
        sosActive: true, sosLongPressing: false, sosProgress: 360,
        silentActive: isSilent, silentCountdownSec: 0
      });
      try { wx.vibrateShort({ type: 'medium' }); } catch (e) {}
      const contacts = (r.data && r.data.my_contacts) || [];
      wx.showModal({
        title: '求助已发出',
        content: contacts.length
          ? `已通知平台，请尽快联系紧急联系人${contacts[0].name || ''}，或拨打110/120`
          : '已通知平台，请立即拨打110/120',
        showCancel: false,
        confirmText: '知道了',
        fail: () => wx.showToast({ title: '求助已发出，请拨打110/120', icon: 'none', duration: 2500 })
      });
    }).catch(() => {
      this.setData({
        sosActive: false, sosLongPressing: false, sosProgress: 0,
        silentActive: false, silentCountdownSec: 0
      });
      wx.showToast({ title: '网络异常，请直接拨打110', icon: 'none', duration: 2500 });
    });
  },

  // A4 静默求助
  onSilentStart() {
    if (this.data.silentActive || this.data.silentCountdownSec > 0) return;
    const total = CONFIG.SAFETY.sosCountdownSec; // 10秒
    this.setData({ silentCountdownSec: total });
    this._silentTimer = setInterval(() => {
      let s = this.data.silentCountdownSec - 1;
      if (s <= 0) {
        clearInterval(this._silentTimer);
        this.setData({ silentCountdownSec: 0 });
        this.triggerSos('silent');
        return;
      }
      this.setData({ silentCountdownSec: s });
    }, 1000);
  },

  // 撤销静默求助(wx.showModal 原生二次确认, 真机稳定)
  onSilentCancel() {
    wx.showModal({
      title: '确认撤销？',
      content: '紧急情况下请保持求助状态',
      confirmText: '撤销',
      confirmColor: '#fa5151',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        if (!res.confirm) return;
        this._doCancelSilent();
      }
    });
  },

  _doCancelSilent() {
    clearInterval(this._silentTimer);
    // 已发出(静默求助已触发) → 云端撤销 active 求助记录
    if (this.data.silentActive || this.data.sosActive) {
      callCloud('safety-report', { action: 'cancel_silent_sos', order_id: this.__orderId }).then((r) => {
        if (r.ok) {
          this.setData({ silentCountdownSec: 0, silentActive: false, sosActive: false });
          wx.showToast({ title: '已撤销求助', icon: 'none' });
        } else {
          wx.showToast({ title: r.msg || '撤销失败', icon: 'none' });
        }
      }).catch(() => {
        wx.showToast({ title: '网络异常，撤销失败', icon: 'none' });
      });
      return;
    }
    // 倒计时中 → 尚未上报云端,仅本地撤销
    this.setData({ silentCountdownSec: 0 });
    wx.showToast({ title: '已撤销静默求助', icon: 'none' });
  },

  // 客服模拟解除(admin 白名单; 云端测试用管理员 mock_openid)
  onKefuResolve() {
    callCloud('safety-report', { action: 'resolve_sos', order_id: this.__orderId }).then((r) => {
      if (r.ok) {
        this.setData({ sosActive: false, silentActive: false });
        wx.showToast({ title: '客服已介入并解除', icon: 'none' });
      } else {
        wx.showToast({ title: r.msg || '解除失败', icon: 'none' });
      }
    }).catch(() => wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' }));
  },

  noop() {}
});
