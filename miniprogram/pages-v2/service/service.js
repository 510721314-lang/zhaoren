// pages-v2/service/service · 服务项目浏览（SOP 卡片列表）
// 数据源：home-action.service_list（只读，不下发 sop_content）；点击卡片进分包 service-detail 看 SOP
const { callCloud } = require('../../utils/cloud.js');
const { SCENES } = require('../../config/enums.js');

Page({
  data: {
    loading: true,
    list: [],
    chips: [],
    activeChip: 'all'
  },

  // 场景筛选：优先全局动态场景（与广场/发布页同源），兜底 enums SCENES；补 icon/color 供宫格渲染
  buildChips() {
    let list = null;
    const app = (typeof getApp === 'function') ? getApp() : null;
    const dyn = app && app.globalData && app.globalData.availableScenes;
    if (Array.isArray(dyn) && dyn.length) list = dyn;
    if (!list) list = SCENES;
    return [{ code: 'all', name: '全部', icon: '🗂️', color: '#F0F0F0' }]
      .concat(list.map((s) => {
        // 动态源可能缺 icon/color，按 code 与 SCENES 合并兜底
        const base = SCENES.find((x) => x.code === s.code) || {};
        return {
          code: s.code,
          name: s.name,
          icon: s.icon || base.icon || '🛎️',
          color: s.color || base.color || '#F0F0F0'
        };
      }));
  },

  onLoad() {
    // onLoad 已拉首屏，首次 onShow 跳过避免双拉
    this.__skipNextShow = true;
    this.setData({ chips: this.buildChips() });
    this.fetchList();
  },

  onShow() {
    // tabBar 索引：0首页 1广场 2服务 3消息 4我的
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    if (this.__skipNextShow) { this.__skipNextShow = false; return; }
  },

  onPullDownRefresh() {
    this.fetchList(this.data.activeChip).then(() => wx.stopPullDownRefresh());
  },

  fetchList(sceneCode) {
    this.setData({ loading: true });
    const data = { action: 'service_list' };
    if (sceneCode && sceneCode !== 'all') data.scene_code = sceneCode;
    return callCloud('home-action', data)
      .then((r) => {
        if (r && r.ok && r.data) {
          this.setData({ list: r.data.list || [] });
        } else {
          this.setData({ list: [] });
          if (r && r.msg) wx.showToast({ title: r.msg, icon: 'none' });
        }
      })
      .catch(() => {
        this.setData({ list: [] });
      })
      .then(() => {
        this.setData({ loading: false });
      });
  },

  onChipTap(e) {
    const code = e.currentTarget.dataset.code;
    if (code === this.data.activeChip) return;
    this.setData({ activeChip: code });
    this.fetchList(code);
  },

  onCardTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages-v2/pkg-low/service-detail/service-detail?id=${id}` });
  }
});
