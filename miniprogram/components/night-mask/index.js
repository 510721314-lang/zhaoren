// components/night-mask · R1夜间红线全局遮罩（时间窗来自 CONFIG.TIME_REDLINE，后台可配）
// 页面在 isInRedline() 命中时挂载；拦截所有触控，仅允许「预约明早」动作
const CONFIG = require('../../config/index.js');

Component({
  properties: {
    visible: { type: Boolean, value: false }
  },
  data: {
    openTime: '',
    closeTime: ''
  },
  observers: {
    'visible': function (v) { if (v) this._syncTimes(); }
  },
  lifetimes: {
    attached() { this._syncTimes(); }
  },
  methods: {
    // 渲染时读取最新 CONFIG(启动时云端同步为异步, 避免落到同步前的默认值)
    _syncTimes() {
      const close = CONFIG.TIME_REDLINE.close;
      this.setData({
        openTime: CONFIG.TIME_REDLINE.open,
        closeTime: close === '24:00' ? '00:00' : close
      });
    },
    noop() {},
    onReserve() {
      this.triggerEvent('reserve');
    }
  }
});
