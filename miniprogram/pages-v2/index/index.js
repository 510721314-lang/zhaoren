// PRD章节: 3.2.1 首页 / 3.2.3 耍伴推荐 / 1.8.1 新人福利 / 1.7 紧急联系人 / R1 夜间红线
// P1: 接云端 user-login peek_login, 删除 mock CURRENT_USER 依赖
const redline = require('../../utils/redline.js');
const { getScene } = redline;
// requireRealname 在 enterScene 入口按需动态加载, 不在顶部 require 避免冷启动时序
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

Page({
  data: {
    loading: false,  // 不阻塞渲染: 首页先展示骨架, 数据返回后填充, 避免云函数超时导致白屏
    statusBarHeight: 20,
    city: '成都',
    greeting: '你好',
    scenes: SCENES,
    filteredScenes: SCENES,   // 搜索关键词实时过滤后的场景
    searchKey: '',
    activeUsers: [],          // 活跃用户(头像横滑)
    activePartners: [],       // 活跃耍伴(头像横滑+信用分)
    activeTab: 'demand',
    demandList: [],
    sceneGroups: [],        // 需求广场按场景分组(每场景8条)
    partnerList: [],       // P2 接云端 partner-profile 列表
    user: {},
    unconfirmedContact: null,
    showEmergency: false,
    showWelfare: true,
    welfare: CONFIG.NEWBIE,
    isRedline: false,
    redlineOpen: CONFIG.TIME_REDLINE.open,
    redlineClose: redline.DISPLAY_CLOSE,
    trafficOrders: CONFIG.NEW_PARTNER.trafficSupportOrders,
    reserveDiscountText: `${CONFIG.MATCH.reserveDiscount * 10}折`,
    favorited: false   // 首页收藏态(轻提示, 暂无服务端收藏对象)
  },
  onShareAppMessage() {
    return {
      title: '找个人帮忙 · 同城帮忙撮合',
      path: '/pages-v2/index/index'
    };
  },

  // H9 右侧浮动: 收藏(轻提示, 收藏对象暂未上线)
  onFloatFavorite() {
    const v = !this.data.favorited;
    this.setData({ favorited: v });
    wx.showToast({ title: v ? '已收藏' : '已取消收藏', icon: 'none' });
  },


  onLoad() {
    // onLoad 已拉首屏, 首次 onShow 跳过避免双拉; 切 tab/发布返回时 onShow 正常刷新
    this.__skipNextShow = true;
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: info.statusBarHeight || 20, greeting: this.computeGreeting() });
    } catch (e) {}
    this.fetchUser();
    this.fetchSquare();
  },

  // 按时段生成问候语(图2: 夜深了，需要什么帮忙？)
  computeGreeting() {
    const h = new Date().getHours();
    if (h >= 23 || h < 5) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 13) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  },

  fetchUser() {
    callCloud('user-login', { action: 'peek_login' }).then((r) => {
      if (r.ok && r.data && r.data.found && r.data.user) {
        this.setData({ user: r.data.user });
      }
    });
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    // 首次 onShow 跳过(onLoad 已拉); 之后切回首页/发布返回刷新广场
    if (this.__skipNextShow) { this.__skipNextShow = false; return; }
    this.fetchSquare();
  },

  // 拉取需求广场(云端 demand 集合) + 耍伴推荐 + 活跃用户/活跃耍伴
  async fetchSquare() {
    const app = getApp();
    const r = await app.cloudCall('home-action', { action: 'square', limit: 20 });
    if (r.ok && r.data) {
      this.setData({
        demandList: r.data.list || [],
        partnerList: r.data.partners || [],
        activeUsers: r.data.active_users || [],
        activePartners: r.data.active_partners || []
      });
      this.fetchSceneGroups();
    }
  },

  async fetchSceneGroups() {
    const app = getApp();
    const r = await app.cloudCall('home-action', { action: 'scene_groups' });
    if (r.ok && r.data && r.data.scene_groups) {
      const groups = r.data.scene_groups;
      // 从 scene_groups 派生动态场景列表(去重 + SCENES 兜底 icon/color/disclaimer)
      const ICON_FALLBACK = { W1: '🏥', W2: '📚', W8: '🛠️', W10: '🚄', W11: '💬', W3: '🏋️', W4: '🎡', W7: '🫂', W9: '🐾' };
      const COLOR_FALLBACK = { W1: '#E8F1FF', W2: '#EDE8FF', W8: '#FFF3E0', W10: '#E0F5F4', W11: '#FFE9EC', W3: '#E8FFF0', W4: '#FFF0E8', W7: '#FFE8F3', W9: '#E8F5FF' };
      const scenes = groups.map((g) => {
        const hardCoded = getScene(g.scene_code);
        return {
          code: g.scene_code,
          name: g.scene_name,
          icon: hardCoded ? hardCoded.icon : (ICON_FALLBACK[g.scene_code] || '📌'),
          color: hardCoded ? hardCoded.color : (COLOR_FALLBACK[g.scene_code] || '#F5F5F5'),
          gb: hardCoded ? hardCoded.gb : false,
          disclaimer_type: g.scene_disclaimer_type || 'general_disclaimer',
          disclaimer_text: g.scene_disclaimer_text || (hardCoded && hardCoded.disclaimer ? hardCoded.disclaimer.content : ''),
          disclaimer_title: hardCoded && hardCoded.disclaimer ? hardCoded.disclaimer.title : '免责声明'
        };
      });
      this.setData({
        sceneGroups: groups,
        scenes,
        filteredScenes: scenes
      });
      // 同步到全局, redline.js R9 白名单校验 + 组件 getScene 动态兜底(存完整场景对象)
      const app = getApp();
      if (app) app.globalData.availableScenes = scenes;
    }
  },

  onPullDownRefresh() {
    wx.cloud.callFunction({
      name: 'home-action',
      data: { action: 'square', limit: 20 },
      success: (res) => {
        const r = res.result || {};
        if (r.ok && r.data) {
          this.setData({
            demandList: r.data.list || [],
            sceneGroups: r.data.scene_groups || [],
            partnerList: r.data.partners || [],
            activeUsers: r.data.active_users || [],
            activePartners: r.data.active_partners || []
          });
        }
        this.fetchSceneGroups();  // 同步刷新动态场景宫格
        wx.stopPullDownRefresh();
        wx.showToast({ title: '已刷新', icon: 'none' });
      },
      fail: () => {
        wx.stopPullDownRefresh();
      }
    });
  },

  // H1 城市切换（简化：action-sheet）
  onCityTap() {
    wx.showActionSheet({
      itemList: ['成都', '绵阳', '德阳'],
      success: (res) => {
        this.setData({ city: ['成都', '绵阳', '德阳'][res.tapIndex] });
      }
    });
  },
  // H1b 场景搜索: 实时按场景名/子服务过滤宫格
  onSearchInput(e) {
    const key = (e.detail.value || '').trim();
    this.setData({ searchKey: key }, () => this.filterScenes(key));
  },
  onSearchClear() {
    this.setData({ searchKey: '', filteredScenes: SCENES });
  },
  onSearchConfirm() {
    // 键盘搜索: 唯一匹配场景直接进发布, 否则保留过滤结果供点选
    const list = this.data.filteredScenes;
    if (list.length === 1) {
      this.enterScene(list[0].code);
    } else if (list.length === 0) {
      wx.showToast({ title: '未找到相关场景', icon: 'none' });
    }
  },
  filterScenes(key) {
    if (!key) {
      this.setData({ filteredScenes: SCENES });
      return;
    }
    const kw = key.toLowerCase();
    const hit = SCENES.filter((s) => {
      const inName = s.name.toLowerCase().indexOf(kw) >= 0;
      const inOptions = (s.options || []).some((o) => o.toLowerCase().indexOf(kw) >= 0);
      return inName || inOptions;
    });
    this.setData({ filteredScenes: hit });
  },
  onBellTap() {
    wx.showToast({ title: '系统通知列表待接入', icon: 'none' });
  },

  // H3 紧急联系人
  onEmergencyConfirm() {
    wx.showToast({ title: '紧急联系人设置页待接入', icon: 'none' });
  },
  onEmergencyClose() {
    this.setData({ showEmergency: false });
  },

  // H4 场景宫格 → P06 预选场景
  onSceneTap(e) {
    const { code } = e.currentTarget.dataset;
    this.enterScene(code);
  },
  enterScene(code) {
    const gate = redline.checkEntryLocked();
    if (gate.locked) {
      wx.showToast({ title: gate.msg, icon: 'none' });
      return;
    }
    // 实名门禁: 动态加载 bootstrap 避免冷启动时序
    try {
      const { requireRealname } = require('../../utils/bootstrap.js');
      if (!requireRealname('发布需求')) return;
    } catch (e) {}
    wx.navigateTo({
      url: `/pages-v2/publish/publish?sceneCode=${code}`,
      fail: () => wx.showToast({ title: '发布页打开失败', icon: 'none' })
    });
  },

  // H5 新人福利
  onWelfareReceive() {
    this.setData({ showWelfare: false });
    wx.showToast({ title: `领取成功，首单立减${CONFIG.NEWBIE.firstOrderDiscount}元`, icon: 'success' });
  },

  // H6 双Tab
  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  // 场景分组「更多」→ 该场景需求列表(每页50)
  onSceneMoreTap(e) {
    const { code, name } = e.currentTarget.dataset;
    if (!code) {
      wx.showToast({ title: '场景参数异常', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages-v2/demand-list/demand-list?scene=${code}&name=${encodeURIComponent(name || '')}`,
      fail: () => wx.showToast({ title: '列表页打开失败', icon: 'none' })
    });
  },

  // H7 卡片交互（跳详情页，带真实 demand _id）
  onDemandTap(e) {
    const demand = (e.detail && e.detail.demand) || {};
    const id = demand._id;
    if (!id) {
      wx.showToast({ title: '需求数据异常', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages-v2/demand-detail/demand-detail?id=${id}`,
      fail: () => wx.showToast({ title: '详情页打开失败', icon: 'none' })
    });
  },
  onPartnerTap(e) {
    const p = (e.detail && e.detail.partner) || {};
    const openid = p.openid;
    if (!openid) {
      wx.showToast({ title: '耍伴数据异常', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages-v2/partner-detail/partner-detail?partnerOpenid=${openid}`,
      fail: () => wx.showToast({ title: '耍伴详情打开失败', icon: 'none' })
    });
  },

  // 活跃用户头像 → 用户公开主页
  onActiveUserTap(e) {
    const openid = e.currentTarget.dataset.openid;
    if (!openid) {
      wx.showToast({ title: '用户数据异常', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/user-home/user-home?openid=${openid}`,
      fail: (err) => { console.error('[index] onActiveUserTap fail:', err); wx.showToast({ title: '用户主页打开失败', icon: 'none' }); }
    });
  },

  // 活跃耍伴头像 → 耍伴详情
  onActivePartnerTap(e) {
    const openid = e.currentTarget.dataset.openid;
    if (!openid) {
      wx.showToast({ title: '耍伴数据异常', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages-v2/partner-detail/partner-detail?partnerOpenid=${openid}`,
      fail: () => wx.showToast({ title: '耍伴详情打开失败', icon: 'none' })
    });
  },

  onReserve() {
    wx.showToast({ title: `已为您预约${CONFIG.TIME_REDLINE.open}开服提醒`, icon: 'none' });
  }
});
