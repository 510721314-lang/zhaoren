// components/night-mask · R1夜间红线全局遮罩（00:00-06:00）
// 页面在 isInRedline() 命中时挂载；拦截所有触控，仅允许「预约明早」动作
const CONFIG = require('../../config/index.js');
const redline = require('../../utils/redline.js');

Component({
  properties: {
    visible: { type: Boolean, value: false }
  },
  data: {
    openTime: CONFIG.TIME_REDLINE.open,
    closeTime: redline.DISPLAY_CLOSE
  },
  methods: {
    noop() {},
    onReserve() {
      this.triggerEvent('reserve');
    }
  }
});
