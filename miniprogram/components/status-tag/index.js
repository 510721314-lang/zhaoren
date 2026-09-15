// components/status-tag · 订单13态标签
// 色值映射唯一来源 config/enums.js ORDER_STATUS（S1紫/S2蓝/S3橙/S5绿/S6灰/S10.5红）
const { ORDER_STATUS } = require('../../config/enums.js');

Component({
  properties: {
    code: { type: String, value: '' }
  },
  data: {
    cfg: null
  },
  observers: {
    code(code) {
      // 兼容 S3.5 / S10.5 点号键写法
      const cfg = ORDER_STATUS[code] || ORDER_STATUS[String(code).replace('.', '_')];
      this.setData({ cfg: cfg || null });
    }
  },
  lifetimes: {
    attached() {
      const code = this.properties.code;
      const cfg = ORDER_STATUS[code] || ORDER_STATUS[String(code).replace('.', '_')];
      this.setData({ cfg: cfg || null });
    }
  }
});
