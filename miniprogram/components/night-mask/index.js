// components/night-mask · R1夜间红线提示弹窗（时间窗来自 CONFIG.TIME_REDLINE，后台可配）
// 用户可关闭弹窗继续浏览；同一夜间段不再自动弹出（redline.shouldShowNightMask 守门）
// 预约/接单/履约入口由各页面 checkEntryLocked/isRedline 独立拦截，弹窗本身不阻塞背景操作
const CONFIG = require('../../config/index.js');
const redline = require('../../utils/redline.js');

Component({
  properties: {
    visible: { type: Boolean, value: false }
  },
  data: {
    openTime: '',
    closeTime: '',
    hidden: false  // 用户已关闭，本夜间段内不再显示
  },
  observers: {
    'visible': function (v) {
      if (v) {
        // 页面 setData isRedline=true 时，先问 redline 是否还该弹
        if (redline.shouldShowNightMask()) {
          this.setData({ hidden: false });
          this._syncTimes();
        } else {
          this.setData({ hidden: true });
        }
      }
    }
  },
  lifetimes: {
    attached() { this._syncTimes(); }
  },
  // 页面 onShow 时重新检查（处理跨页面关闭后切回、isRedline 值未变 observer 不触发的情况）
  pageLifetimes: {
    show() {
      if (!this.data.visible) return;
      if (redline.shouldShowNightMask()) {
        if (this.data.hidden) { this.setData({ hidden: false }); this._syncTimes(); }
      } else if (!this.data.hidden) {
        this.setData({ hidden: true });
      }
    }
  },
  methods: {
    _syncTimes() {
      const close = CONFIG.TIME_REDLINE.close;
      this.setData({
        openTime: CONFIG.TIME_REDLINE.open,
        closeTime: close === '24:00' ? '00:00' : close
      });
    },
    // 点弹窗外部背景关闭
    onBackdrop() {
      this._dismiss();
    },
    // 「继续浏览」按钮
    onDismiss() {
      this._dismiss();
    },
    _dismiss() {
      redline.dismissNightMask();
      this.setData({ hidden: true });
      this.triggerEvent('dismiss');
    },
    onReserve() {
      this.triggerEvent('reserve');
    },
    // 点弹窗本体（非按钮区域）阻止冒泡到背景层，避免误关闭
    noop() {}
  }
});
