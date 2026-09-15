// components/demand-card · 需求卡（pages-spec P03 卡片规格）
// props: demand 需求对象 / role user|partner / certified 当前耍伴是否已认证该场景
//        grabbed 是否已被抢 / actionText 按钮文案
const { SCENES } = require('../../config/enums.js');

Component({
  properties: {
    demand: { type: Object, value: {} },
    role: { type: String, value: 'partner' },
    certified: { type: Boolean, value: false },
    grabbed: { type: Boolean, value: false },
    actionText: { type: String, value: '⚡ 抢单' }
  },
  data: {
    scene: null,
    certName: '',
    distanceText: '',
    publisherText: '',
    closed: false
  },
  observers: {
    'demand,grabbed': function () { this.compute(); }
  },
  lifetimes: {
    attached() { this.compute(); }
  },
  methods: {
    compute() {
      const d = this.properties.demand || {};
      const scene = SCENES.find((s) => s.code === d.scene_code) || null;
      const online = d.scene_code === 'W11';
      const distanceText = online
        ? '线上 · 不限距离'
        : `${d.district || ''} · ${d.distance_km != null ? d.distance_km + 'km' : '--'}`;
      const pub = d.publisher || {};
      const publisherText = `${pub.surname || ''}** · ${pub.real_name_verified ? '已实名' : '未实名'} · ${this.timeAgo(pub.minutes_ago)}`;
      this.setData({
        scene,
        certName: scene ? scene.cert : '',
        distanceText,
        publisherText,
        closed: this.properties.grabbed || d.status !== 'matching'
      });
    },
    timeAgo(mins) {
      if (mins == null) return '';
      if (mins < 60) return `${mins}分钟前`;
      const h = Math.floor(mins / 60);
      return h < 24 ? `${h}小时前` : `${Math.floor(h / 24)}天前`;
    },
    onAction() {
      if (this.data.closed) return;
      this.triggerEvent('action', { demand: this.properties.demand });
    },
    onCard() {
      this.triggerEvent('cardtap', { demand: this.properties.demand });
    }
  }
});
