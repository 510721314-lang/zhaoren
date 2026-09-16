// components/partner-card · 耍伴卡（pages-spec P02-H7b / P08 精简规格，含动态模块）
// props: partner 对象；事件: invite(邀TA帮忙) / consult(咨询) / cardtap / more(查看更多动态)
const { SCENES } = require('../../config/enums.js');

Component({
  properties: {
    partner: { type: Object, value: {} }
  },
  data: {
    sceneList: [],
    statsText: ''
  },
  observers: {
    partner: function () { this.compute(); }
  },
  lifetimes: {
    attached() { this.compute(); }
  },
  methods: {
    compute() {
      const p = this.properties.partner || {};
      // avatar 只接受 http(s) URL, 否则置空避免渲染 openid 等脏值
      const normalized = Object.assign({}, p, {
        avatar: (p.avatar && /^https?:/.test(p.avatar)) ? p.avatar : ''
      });
      const sceneList = (p.scenes || p.accept_scenes || p.certified_scenes || [])
        .map((code) => SCENES.find((s) => s.code === code))
        .filter(Boolean);
      // PRD 3.2.3：数据<3次显示「数据积累中」
      const statsText = (p.order_count != null && p.order_count < 3) ? '数据积累中' : '';
      this.setData({ sceneList, statsText, normalized });
    },
    onInvite() {
      this.triggerEvent('invite', { partner: this.properties.partner });
    },
    onCard() {
      this.triggerEvent('cardtap', { partner: this.properties.partner });
    },
    onMore() {
      this.triggerEvent('more', { partner: this.properties.partner });
    }
  }
});
