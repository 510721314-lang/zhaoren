// components/night-mask · R1夜间红线全局遮罩（23:00-06:00）
// 页面在 isInRedline() 命中时挂载；拦截所有触控，仅允许「预约明早」动作
const CONFIG = require('../../config/index.js');

Component({
  properties: {
    visible: { type: Boolean, value: false }
  },
  data: {
    openTime: CONFIG.TIME_REDLINE.open,
    closeTime: CONFIG.TIME_REDLINE.close
  },
  methods: {
    noop() {},
    onReserve() {
      this.triggerEvent('reserve');
    }
  }
});
