// @VERIFIED 2026-10-13 已真机验证：首页5场景宫格+更多场景折叠+搜索+云端排序生效（依据：project_memory L73-74, L82, L136）
// PRD章节: 3.2.1 首页 / 3.2.3 耍伴推荐 / 1.8.1 新人福利 / 1.7 紧急联系人 / R1 夜间红线
// P1: 接云端 user-login peek_login, 删除 mock CURRENT_USER 依赖
const redline = require('../../utils/redline.js');
const { getScene } = redline;
// requireRealname 在 enterScene 入口按需动态加载, 不在顶部 require 避免冷启动时序
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');
const swr = require('../../utils/swr.js');

// ── 首页场景宫格: 主宫格常驻 + 「更多场景」折叠 ──
// 2026-10-13 需求: 显示顺序由管理后台「场景管理」排序决定(admin_config.scene_list 数组序);
// 可见场景按序取前 GRID_PRIMARY_MAX 个进主宫格, 其余进「更多场景」折叠区(同源: 广场 chips/发布页/接单配置)
const GRID_PRIMARY_MAX = 5;
const MORE_CELL = { code: '__MORE__', name: '更多场景', icon: '➕', color: 'var(--bg-segment)', isMore: true };
const COLLAPSE_CELL = { code: '__MORE__', name: '收起', icon: '➖', color: 'var(--bg-segment)', isMore: true };

// 按后台排序拆分为 主宫格/更多 两组(前 5 常驻, 其余折叠)
function splitScenes(list) {
  const l = list || [];
  return { primary: l.slice(0, GRID_PRIMARY_MAX), more: l.slice(GRID_PRIMARY_MAX) };
}

// 宫格实际渲染列表: 搜索态平铺命中; 常态 = 常用(+展开的更多) + 「更多场景/收起」入口格
function buildGrid(primary, more, expanded, searchKey, filtered) {
  if (searchKey) return filtered || [];
  const cells = (primary || []).slice();
  if (more && more.length) {
    if (expanded) cells.push.apply(cells, more);
    cells.push(expanded ? COLLAPSE_CELL : MORE_CELL);
  }
  return cells;
}

// 关键词过滤(场景名 / 子服务)
function matchScenes(list, key) {
  const kw = String(key || '').toLowerCase();
  return (list || []).filter((s) => {
    const inName = String(s.name || '').toLowerCase().indexOf(kw) >= 0;
    const inOptions = (s.options || []).some((o) => String(o).toLowerCase().indexOf(kw) >= 0);
    return inName || inOptions;
  });
}

const INITIAL_SPLIT = splitScenes(SCENES);

// S8 SWR: 首页广场数据本地缓存 10 分钟, 冷启动先渲染旧数据秒开, 网络回来静默覆盖
const SQUARE_CACHE_KEY = 'home_square_v1';
const SQUARE_TTL_MS = 10 * 60 * 1000;
// 2026-10-10 性能: 场景宫格同样本地缓存 —— 云端 square 刻意不内联 scene_groups(5 个额外查询会致冷启动超时),
// 故独立 scene_groups action 每次进首页都会被调一次; 加缓存后第 2 次起免掉这次往返(与 square 同 TTL)
// v2: 场景新增「前端不显示」开关(home-action scene_groups 已过滤), 升版清掉含隐藏场景的旧缓存
const SCENE_GROUPS_CACHE_KEY = 'home_scene_groups_v2';

const { callCloud } = require('../../utils/cloud.js');

Page({
  data: {
    loading: false,  // 不阻塞渲染: 首页先展示骨架, 数据返回后填充, 避免云函数超时导致白屏
    statusBarHeight: 20,
    city: '成都',
    greeting: '你好',
    scenes: SCENES,
    filteredScenes: SCENES,   // 搜索关键词实时过滤后的场景
    primaryScenes: INITIAL_SPLIT.primary,   // 主宫格常驻场景(更多场景之外)
    moreScenes: INITIAL_SPLIT.more,         // 「更多场景」折叠区场景
    gridScenes: buildGrid(INITIAL_SPLIT.primary, INITIAL_SPLIT.more, false, '', SCENES),  // 宫格实际渲染
    showMoreScenes: false,                  // 「更多场景」展开态
    searchKey: '',
    activePartners: [],       // 活跃耍伴(头像横滑+信用分)
    banners: [],              // 运营 banner 轮播(home_activity 后台管理)
    nearbyList: [],        // 附近可接单池(仅耍伴端, 就近排序)
    isPartner: false,      // 当前用户是否为耍伴(决定是否展示附近可接块)
    sceneGroups: [],        // 场景分组(内部派生场景宫格数据, 首页不再渲染列表)
    user: {},
    unconfirmedContact: null,
    showEmergency: false,
    showWelfare: true,
    welfare: CONFIG.NEWBIE,
    isRedline: false,
    redlineOpen: CONFIG.TIME_REDLINE.open,
    redlineClose: redline.DISPLAY_CLOSE,
    favorited: false,   // 首页收藏态(轻提示, 暂无服务端收藏对象)
    // 批2(2026-10-23 用户批准): 首页顶部续作条件条——发布中断(P2-8) / 入驻中断(P2-9)
    resumeTip: null,       // { sceneCode } 有值=显示「继续完成发布」
    onboardTip: null       // { step, status, switchOff } 有值=显示「继续完成入驻（第 x 步）」
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

  // H9 客服: 跳自建客服会话(后台客服工作台可见可回)
  onFloatKefu() {
    wx.navigateTo({ url: '/pages-v2/pkg-low/kefu/kefu', fail: () => wx.showToast({ title: '客服打开失败', icon: 'none' }) });
  },


  onLoad() {
    // onLoad 已拉首屏, 首次 onShow 跳过避免双拉; 切 tab/发布返回时 onShow 正常刷新
    this.__skipNextShow = true;
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: info.statusBarHeight || 20, greeting: this.computeGreeting() });
    } catch (e) {}
    this.fetchUser();
    this.fetchSquare(true);   // S8: 冷启动允许先用 SWR 本地缓存秒开
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
        const u = r.data.user;
        const isPartner = (u.roles || []).indexOf('partner') >= 0;
        this.setData({ user: u, isPartner });
        if (isPartner) { this.fetchNearby(); this.startNearbyPoll(); }   // 附近可接单池仅耍伴端拉取 + 新单轮询
      }
    });
  },

  // 批2 P2-8/P2-9: 顶部续作条计算。互斥优先级——发布中断 > 入驻中断;
  // 发布条纯本地 intent 读取, 有它时不发入驻探针(省一次云调用)
  _refreshGuides() {
    let resumeTip = null;
    try {
      const it = require('../../utils/bootstrap.js').getOnboardIntent();
      if (it && it.kind === 'publish') resumeTip = { sceneCode: it.scene || '' };
    } catch (e) {}
    this.setData({ resumeTip, onboardTip: null });   // 先清入驻条, 防上一轮残留
    if (resumeTip || this.data.isPartner) return;     // 已是耍伴/在续作发布 → 不显示入驻条
    let logged = false;
    try { logged = require('../../utils/bootstrap.js').isLoggedIn(); } catch (e) {}
    if (!logged) return;
    // 批3c(2026-10-23): 步骤推导统一由 utils/onboard-chain.js 提供(与我的页进度卡同源)
    require('../../utils/take-order.js').fetchTakeReadiness('', false).then((rd) => {
      if (!rd || rd.can_take === true) return;
      const chain = require('../../utils/onboard-chain.js');
      const key = chain.entryKey(rd);
      const st = chain.stepOf(key) || { index: 1, total: chain.TOTAL, label: '' };
      this.setData({ onboardTip: { key, step: st.index, total: st.total, label: st.label, status: (rd.missing || [])[0] === 'review_pending' ? 'pending' : 'todo', switchOff: !rd.accept_switch, ecTip: key === 'ec' } });
    }).catch(() => {});
  },
  // P2-8: 回发布页续作(带场景预选)
  onResumePublishTap() {
    const t = this.data.resumeTip || {};
    wx.navigateTo({
      url: '/pages-v2/publish/publish' + (t.sceneCode ? '?sceneCode=' + t.sceneCode : ''),
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    });
  },
  // P2-9 / 批3c: 按首缺步直达(路由与我的页进度卡同源: utils/onboard-chain.js)
  onOnboardTipTap() {
    const t = this.data.onboardTip || {};
    const bs = require('../../utils/bootstrap.js');
    if (t.key === 'realname') { bs.showRealnameGuide('完成实名认证后即可继续申请耍伴。'); return; }
    if (t.status === 'pending') {
      wx.showModal({ title: '申请审核中', content: '已提交，平台通常在 24 小时内完成审核，通过后会自动开通接单权限。', showCancel: false, confirmText: '我知道了' });
      return;
    }
    if (!require('../../utils/onboard-chain.js').open(t.key)) {
      wx.showToast({ title: '页面暂不可用', icon: 'none' });
    }
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    // 批2 P2-8/P2-9: 每次显示刷新续作条(发布条纯本地读取; 入驻条走 60s 缓存探针)
    this._refreshGuides();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    if (this.data.isPartner) this.startNearbyPoll();   // 仅耍伴端: 首页可见期间轮询附近新单
    // 首次 onShow 跳过(onLoad 已拉); 之后切回首页/发布返回刷新广场
    if (this.__skipNextShow) { this.__skipNextShow = false; return; }
    this.fetchSquare();
    if (this.data.isPartner) this.fetchNearby();
  },

  // 拉取附近可接单池(仅耍伴端): 复用 nearby action 按发布时间倒序, 首页只取前10条
  // 轮询内部门锁: 上一轮未 resolve 时不发下一轮(防叠请求)
  async fetchNearby() {
    if (this.__nearbyFetching) return;
    this.__nearbyFetching = true;
    try {
      const app = getApp();
      const r = await app.cloudCall('home-action', { action: 'nearby', page: 1, page_size: CONFIG.PAGING.indexNearby });
      if (r.ok && r.data) {
        const list = r.data.list || [];
        this.setData({ nearbyList: list });
        this.__notifyNearbyNew(list);
      }
    } finally {
      this.__nearbyFetching = false;
    }
  },
  // 附近新单提醒(方案B 震动+toast, 音效后补): 首条变化即新单; 去响键=需求id+created_at(精确到秒)
  __notifyNearbyNew(list) {
    const first = (list || [])[0];
    if (!first) return;
    const key = String(first._id || first.demand_no || '') + '|' + String(first.created_at || '');
    if (!this.__nearbyLastKey) { this.__nearbyLastKey = key; return; }
    if (key === this.__nearbyLastKey) return;
    this.__nearbyLastKey = key;
    if (typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'medium', fail: () => {} });
    wx.showToast({ title: '附近有新需求', icon: 'none' });
  },
  // 首页可见期间 30s 轮询附近新单(仅耍伴端)
  startNearbyPoll() {
    this.stopNearbyPoll();
    this.__nearbyPollTimer = setInterval(() => { if (this.data.isPartner) this.fetchNearby(); }, 30000);
  },
  stopNearbyPoll() {
    if (this.__nearbyPollTimer) { clearInterval(this.__nearbyPollTimer); this.__nearbyPollTimer = null; }
  },
  // 页面不可见/销毁即停轮询(仅页面可见时轮询)
  onHide() { this.stopNearbyPoll(); },
  onUnload() { this.stopNearbyPoll(); },

  // 附近可接单「更多」→ 附近列表页(全部可接需求, 分页加载)
  onNearbyMoreTap() {
    wx.navigateTo({
      url: '/pages-v2/nearby-list/nearby-list',
      fail: () => wx.showToast({ title: '附近列表打开失败', icon: 'none' })
    });
  },

  // 广场数据统一渲染落点(SWR 缓存与网络数据共用)
  // allowFallback=true(网络数据): 缺失 banners/scene_groups 时发独立懒调兜底(兼容旧云端/冷态缓存未命中)
  // allowFallback=false(SWR 缓存): 只渲染缓存已有字段, 不发兜底请求(元数据统一由随后的网络请求负责, 防翻倍)
  applySquareData(d, allowFallback) {
    const patch = {
      activePartners: d.active_partners || []
    };
    if (Array.isArray(d.banners)) patch.banners = d.banners;
    this.setData(patch);
    if (Array.isArray(d.scene_groups) && d.scene_groups.length) {
      this.renderSceneGroups(d.scene_groups);
      swr.set(SCENE_GROUPS_CACHE_KEY, d.scene_groups);
    } else if (allowFallback) {
      // 性能(2026-10-10): 命中本地缓存则直接渲染, 不再打 scene_groups(每次进首页一次的额外云调用)
      const cachedGroups = swr.get(SCENE_GROUPS_CACHE_KEY, SQUARE_TTL_MS);
      if (Array.isArray(cachedGroups) && cachedGroups.length) this.renderSceneGroups(cachedGroups);
      else this.fetchSceneGroups();
    }
    if (!Array.isArray(d.banners) && allowFallback) {
      this.fetchActivities();
    }
  },

  // useCache=true 仅冷启动 onLoad 使用: 先渲染 10 分钟内的本地缓存秒开, 再静默拉网络覆盖
  async fetchSquare(useCache) {
    const app = getApp();
    if (useCache) {
      const cached = swr.get(SQUARE_CACHE_KEY, SQUARE_TTL_MS);
      if (cached) this.applySquareData(cached, false);
    }
    const r = await app.cloudCall('home-action', { action: 'square', limit: CONFIG.PAGING.indexSquare });
    if (r.ok && r.data) {
      this.applySquareData(r.data, true);
      swr.set(SQUARE_CACHE_KEY, r.data);
      return true;
    }
    return false;   // 供下拉刷新区分成功/失败提示
  },

  // H2b 运营 banner 轮播: 后台 home_activity 配置, 首页展示
  fetchActivities() {
    const app = getApp();
    return app.cloudCall('home-action', { action: 'home_activity_list' }).then((r) => {
      if (r.ok && r.data) {
        this.setData({ banners: r.data.banners || [] });
      }
    }).catch(() => { /* 拉取失败静默降级, 首页仍可用 */ });
  },

  onActivityTap(e) {
    const idx = e.currentTarget.dataset.idx;
    const act = this.data.banners[idx];
    if (!act) return;
    const p = act.jump_param || {};
    switch (act.jump_to) {
      case 'demand_publish': {
        // 访客引导: 未登录先登录, 未实名先实名(2026-10-21 统一守卫)
        const bs = require('../../utils/bootstrap.js');
        if (!bs.gateOnboard('publish', '发布需求', { scene: p.scene || '' })) break;
        const url = '/pages-v2/publish/publish' + (p.scene ? '?scene=' + p.scene : '');
        wx.navigateTo({ url });
        break;
      }
      case 'scene_list': {
        const url = '/pages-v2/square/square' + (p.scene_code ? '?scene_code=' + p.scene_code : '');
        wx.redirectTo({ url });
        break;
      }
      case 'activity_detail': {
        const id = p.id || act.id;
        if (id) {
          wx.navigateTo({ url: '/pages-v2/pkg-low/activity-detail/activity-detail?id=' + id });
        }
        break;
      }
      default: {
        // 服务端 pickActivities 已过滤非法 jump_to, 此处纯防御(不可达)
      }
    }
  },

  async fetchSceneGroups() {
    const app = getApp();
    const r = await app.cloudCall('home-action', { action: 'scene_groups' });
    if (r.ok && r.data && r.data.scene_groups) {
      this.renderSceneGroups(r.data.scene_groups);
      swr.set(SCENE_GROUPS_CACHE_KEY, r.data.scene_groups);   // 供下次进首页免调(2026-10-10)
    }
  },

  // 场景分组视图渲染(square 内联与 scene_groups 懒调共用同一落点)
  renderSceneGroups(groups) {
    const app = getApp();
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
    this.applySceneList(scenes);
    // 同步到全局, redline.js R9 白名单校验 + 组件 getScene 动态兜底(存完整场景对象)
    if (app) app.globalData.availableScenes = scenes;
  },

  // 场景列表统一落点(云端 scene_groups 与硬编码 SCENES 共用):
  // 拆分为 常用/更多 两组并重建宫格; 搜索态下按关键词过滤平铺(不受折叠影响)
  applySceneList(list) {
    const { primary, more } = splitScenes(list);
    const patch = { scenes: list, primaryScenes: primary, moreScenes: more };
    if (this.data.searchKey) {
      patch.filteredScenes = matchScenes(list, this.data.searchKey);
      patch.gridScenes = patch.filteredScenes;
    } else {
      patch.filteredScenes = list;
      patch.gridScenes = buildGrid(primary, more, this.data.showMoreScenes, '', list);
    }
    this.setData(patch);
  },

  // 仅重建宫格(展开/收起「更多场景」时复用)
  rebuildGrid() {
    const d = this.data;
    this.setData({ gridScenes: buildGrid(d.primaryScenes, d.moreScenes, d.showMoreScenes, d.searchKey, d.filteredScenes) });
  },

  async onPullDownRefresh() {
    // 复用 fetchSquare: 内联/兜底逻辑统一, 避免刷新时先置空场景宫格造成闪动
    const ok = await this.fetchSquare();
    wx.stopPullDownRefresh();
    // 仅云端真正成功才提示「已刷新」; 失败(超时/网络/云端错误)明确提示, 避免误导
    wx.showToast({ title: ok ? '已刷新' : '刷新失败，请稍后重试', icon: 'none' });
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
    this.setData({ searchKey: '' }, () => this.applySceneList(this.data.scenes || SCENES));
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
    const list = this.data.scenes || SCENES;
    if (!key) {
      // 清空搜索: 回到 常用 + 更多 折叠态
      this.setData({
        filteredScenes: list,
        gridScenes: buildGrid(this.data.primaryScenes, this.data.moreScenes, this.data.showMoreScenes, '', list)
      });
      return;
    }
    // 搜索态平铺命中(含「更多场景」内的场景, 搜索不受折叠限制)
    const hit = matchScenes(list, key);
    this.setData({ filteredScenes: hit, gridScenes: hit });
  },
  onBellTap() {
    wx.navigateTo({ url: '/pages-v2/pkg-low/notices/notices', fail: () => wx.showToast({ title: '通知页暂不可用', icon: 'none' }) });
  },

  // H3 紧急联系人
  onEmergencyConfirm() {
    this.setData({ showEmergency: false });
    wx.navigateTo({ url: '/pages-v2/pkg-low/contacts/contacts', fail: () => wx.showToast({ title: '紧急联系人页暂不可用', icon: 'none' }) });
  },
  onEmergencyClose() {
    this.setData({ showEmergency: false });
  },

  // H4 场景宫格 → P06 预选场景; 「更多场景」入口格 → 就地展开/收起
  onSceneTap(e) {
    const { code } = e.currentTarget.dataset;
    if (code === '__MORE__') {
      this.setData({ showMoreScenes: !this.data.showMoreScenes });
      this.rebuildGrid();
      return;
    }
    this.enterScene(code);
  },
  enterScene(code) {
    const gate = redline.checkEntryLocked();
    if (gate.locked) {
      wx.showToast({ title: gate.msg, icon: 'none' });
      return;
    }
    // 统一守卫(四态): 访客→登录引导; 已注册未实名→实名引导; 已实名→放行
    try {
      const { gateOnboard } = require('../../utils/bootstrap.js');
      if (!gateOnboard('publish', '发布需求', { scene: code })) return;
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

  // H6 广场入口卡: 首页只做发现门户, 需求列表汇入广场
  onGoSquare() {
    wx.switchTab({ url: '/pages-v2/square/square', fail: () => wx.showToast({ title: '广场打开失败', icon: 'none' }) });
  },

  // H6b 地图找TA入口卡: 附近地图(位置共享开关在地图页内管理)
  onGoMap() {
    wx.navigateTo({ url: '/pages-v2/nearby-map/nearby-map', fail: () => wx.showToast({ title: '地图页打开失败', icon: 'none' }) });
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
