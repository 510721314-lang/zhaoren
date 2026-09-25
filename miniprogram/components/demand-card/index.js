// components/demand-card · 需求卡（pages-spec P03 卡片规格）
// props: demand 需求对象 / role user|partner / certified 当前耍伴是否已认证该场景
//        grabbed 是否已被抢 / actionText 按钮文案
const { getScene } = require('../../utils/redline.js');

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
      const scene = getScene(d.scene_code);
      const online = d.scene_code === 'W11';
      const distanceText = online
        ? '线上 · 不限距离'
        : `${d.district || ''} · ${d.distance_km != null ? d.distance_km + 'km' : '--'}`;
      const pub = d.publisher || {};
      const publisherText = `${pub.surname || ''}** · ${pub.real_name_verified ? '已实名' : '未实名'} · ${this.formatIso(d.created_at)}`;
      this.setData({
        scene,
        certName: scene ? scene.cert : '',
        distanceText,
        publisherText,
        closed: this.properties.grabbed || d.status !== 'matching'
      });
    },
    // 发布时间: ISO 8601 本地时区格式 YYYY-MM-DDTHH:MM:SS±HH:MM
    formatIso(ts) {
      if (!ts) return '';
      const d = ts && ts.$date ? new Date(ts.$date) : new Date(ts);
      if (isNaN(d.getTime())) return '';
      const pad = (n) => (n < 10 ? '0' + n : '' + n);
      const y = d.getFullYear();
      const mo = pad(d.getMonth() + 1);
      const day = pad(d.getDate());
      const h = pad(d.getHours());
      const mi = pad(d.getMinutes());
      const s = pad(d.getSeconds());
      const offMin = -d.getTimezoneOffset();
      const sign = offMin >= 0 ? '+' : '-';
      const offAbs = Math.abs(offMin);
      const oz = `${sign}${pad(Math.floor(offAbs / 60))}:${pad(offAbs % 60)}`;
      return `${y}-${mo}-${day}T${h}:${mi}:${s}${oz}`;
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
