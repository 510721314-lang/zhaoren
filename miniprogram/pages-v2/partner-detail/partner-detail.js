// PRD章节: 3.2.3 耍伴详情 / 3.1.4 认证标识
const redline = require('../../utils/redline.js');
const { SCENES } = require('../../config/enums.js');
const { partners } = require('../../mock/users.js');

Page({
  data: {
    partner: null,
    sceneList: [],
    showStats: true,   // 累计单<3 → false
    expanded: false,   // 二级折叠
    activeTab: 'intro', // intro|eval|dynamic|cert
    evaluations: [
      { stars: 5, tags: ['准时到达', '服务专业'], content: '非常满意，态度很好！', at: '2天前' },
      { stars: 5, tags: ['值得推荐'], content: '下次还找她。', at: '5天前' },
      { stars: 4, tags: ['基本满意'], content: '整体不错。', at: '1周前' }
    ],
    certs: [
      { name: '实名认证', status: '已通过' },
      { name: '人脸核验', status: '已通过' },
      { name: '陪诊认证', status: '已通过' },
      { name: '学习认证', status: '已通过' }
    ],
    loading: false,
    loadError: false,
    isRedline: false
  },

  onLoad(options) {
    this.fetchData(options);
  },

  fetchData(options) {
    this.__lastOptions = options || {};
    this.setData({ loading: true, loadError: false });
    setTimeout(() => {
      try {
        const partner = partners[0]; // 小雅酱
        const sceneList = (partner.scenes || []).map((code) => SCENES.find((s) => s.code === code)).filter(Boolean);
        const showStats = (partner.order_count || 0) >= 3;
        this.setData({ partner, sceneList, showStats, loading: false });
      } catch (e) {
        this.setData({ loading: false, loadError: true });
      }
    }, 300);
  },

  reload() { this.fetchData(this.__lastOptions || {}); },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  toggleExpand() {
    this.setData({ expanded: !this.data.expanded });
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  onConsult() {
    wx.navigateTo({
      url: '/pages-v2/chat/chat?orderId=o_s1_001',
      fail: () => wx.showToast({ title: '聊天页已上线', icon: 'none' })
    });
  },

  onInvite() {
    wx.showToast({ title: '定向邀约已发送，等待对方确认', icon: 'none' });
    setTimeout(() => {
      wx.navigateTo({
        url: '/pages-v2/chat/chat?orderId=o_s1_001',
        fail: () => {}
      });
    }, 800);
  }
});
