// pages/index/index.js - 首页 · 找人帮忙
// 问候+定位城市 / 场景五宫格 / 耍伴动态 / 最新BLOG·最新需求·活跃用户·活跃耍伴 / 进行中订单横条 / 安全提示
const { SCENE_LIST, ORDER_STATUS } = require('../../utils/constants.js');
const app = getApp();

// 首页「进行中订单」口径:待支付/待确认/待履约/履约中
const ACTIVE_STATUS = ['S0', 'S1', 'S2', 'S3'];

// 场景 code → 名称
const SCENE_NAME_MAP = SCENE_LIST.reduce((m, s) => { m[s.code] = s.name; return m; }, {});

// 相对时间
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return Math.floor(diff / 86400000) + '天前';
}
// 分 → 元(整数)
function fenToYuan(fen) { return Math.round((fen || 0) / 100); }
// 服务时间 MM月DD日 HH:mm
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 全部服务项摊平(场景 → 服务项),供热门与搜索
const ALL_OPTIONS = SCENE_LIST.reduce((arr, s) => arr.concat(
  s.options.map((name) => ({ name, sceneCode: s.code, sceneName: s.name, icon: s.icon }))
), []);
// 场景行(服务项拼接为文本,WXML 不能调 join)
const SCENE_ROWS = SCENE_LIST.map((s) => ({
  code: s.code, name: s.name, icon: s.icon, optionsText: s.options.join(' / ')
}));
const HIST_KEY = 'home_search_hist';
const HIST_MAX = 8;

Page({
  data: {
    greeting: '你好',
    city: '定位中…',
    scenes: SCENE_LIST,
    hasActiveOrder: false,   // 派生布尔:是否有进行中订单(JS 预处理,WXML 只消费它)
    activeOrder: null,       // 最近一笔 {order_id, scene_name, status_name, time_str}
    activeCount: 0,
    // ── 搜索面板 ──
    showSearch: false,
    keyword: '',
    history: [],             // 搜索历史(本地缓存)
    hotOptions: ALL_OPTIONS, // 热门服务=全部服务项
    sceneRows: SCENE_ROWS,   // 全部场景(含 optionsText)
    sceneResults: [],        // 场景名命中
    optionResults: [],        // 服务项命中
    // ── 首页概览四块 ──
    blogs: [], demands: [], users: [], partners: [],
    hasBlogs: false, hasDemands: false, hasUsers: false, hasPartners: false
  },

  onShow() {
    app.syncTabBar();
    this.setGreeting();
    this.locateCity();
    this.loadActiveOrder();
    // 概览数据节流: 30 秒内不重复请求
    const now = Date.now();
    if (!this._lastOverviewTs || now - this._lastOverviewTs > 30000) {
      this._lastOverviewTs = now;
      this.loadHomeOverview();
    }
  },

  // 按时段问候
  setGreeting() {
    const h = new Date().getHours();
    let greeting;
    if (h >= 5 && h < 11) greeting = '早上好';
    else if (h >= 11 && h < 14) greeting = '中午好';
    else if (h >= 14 && h < 18) greeting = '下午好';
    else if (h >= 18 && h < 23) greeting = '晚上好';
    else greeting = '夜深了';
    this.setData({ greeting });
  },

  // 定位 → 反查城市;反查失败/未配置 key 兜底「成都」(首发城市)
  async locateCity() {
    const ok = await getApp().requirePrivacyAuth();
    if (!ok) { this.setData({ city: '成都' }); return; }
    wx.getLocation({
      type: 'gcj02',
      success: (loc) => this.reverseCity(loc.latitude, loc.longitude),
      fail: () => this.setData({ city: '成都' })
    });
  },
  reverseCity(lat, lng) {
    // 配置腾讯地图 key 后启用逆地址解析;未配置按规则兜底成都
    const MAP_KEY = '';
    if (!MAP_KEY) {
      this.setData({ city: '成都' });
      return;
    }
    wx.request({
      url: `https://apis.map.qq.com/ws/geocoder/v1/?location=${lat},${lng}&key=${MAP_KEY}`,
      success: (r) => {
        const city = r.data && r.data.result && r.data.result.address_component && r.data.result.address_component.city;
        this.setData({ city: city || '成都' });
      },
      fail: () => this.setData({ city: '成都' })
    });
  },

  // 我的进行中订单(发单方视角;仅参与方可读,order-action 已做身份校验)
  loadActiveOrder() {
    wx.cloud.callFunction({
      name: 'order-action',
      data: { action: 'my_orders', role: 'user' },
      success: (res) => {
        const list = (res.result && res.result.ok && res.result.data.list) || [];
        const actives = list.filter((o) => ACTIVE_STATUS.indexOf(o.status) >= 0);
        if (!actives.length) {
          this.setData({ hasActiveOrder: false, activeOrder: null, activeCount: 0 });
          return;
        }
        const o = actives[0];   // my_orders 按 start_time 升序,取最早一笔
        const st = Object.keys(ORDER_STATUS).map((k) => ORDER_STATUS[k])
          .find((s) => s.code === o.status) || { name: o.status };
        const d = new Date(o.start_time);
        const pad = (n) => n < 10 ? '0' + n : '' + n;
        this.setData({
          hasActiveOrder: true,
          activeCount: actives.length,
          activeOrder: {
            order_id: o.order_id,
            scene_name: o.scene_name,
            status_name: st.name,
            time_str: `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
          }
        });
      },
      fail: () => this.setData({ hasActiveOrder: false })
    });
  },

  // 首页概览: 最新BLOG / 最新需求 / 活跃用户 / 活跃耍伴(单次调用)
  loadHomeOverview() {
    wx.cloud.callFunction({
      name: 'home-action',
      data: { action: 'overview' },
      success: (res) => {
        const r = res.result;
        if (!r || !r.ok) return;
        const d = r.data || {};
        const blogs = (d.blogs || []).map((b) => ({
          _id: b._id,
          author_nickname: b.author_nickname,
          hasAvatar: !!b.author_avatar,
          author_avatar: b.author_avatar,
          content: b.content,
          hasCover: !!b.cover,
          cover: b.cover,
          tags: b.tags || [],
          hasTags: (b.tags || []).length > 0,
          scene_name: SCENE_NAME_MAP[b.scene] || '',
          hasScene: !!SCENE_NAME_MAP[b.scene],
          like_count: b.like_count || 0,
          time_text: timeAgo(b.created_at)
        }));
        const demands = (d.demands || []).map((x) => ({
          _id: x._id,
          scene_name: x.scene_name || SCENE_NAME_MAP[x.scene] || '',
          opts_text: (x.content_options || []).join(' / '),
          hasOpts: (x.content_options || []).length > 0,
          location_name: x.location_name,
          rate_yuan: fenToYuan(x.rate_fen),
          time_text: fmtTime(x.start_time)
        }));
        const users = (d.users || []).map((u) => ({
          openid: u.openid,
          nickname: u.nickname,
          hasAvatar: !!u.avatar,
          avatar: u.avatar,
          time_text: timeAgo(u.created_at)
        }));
        const partners = (d.partners || []).map((p) => ({
          openid: p.openid,
          nickname: p.nickname,
          hasAvatar: !!p.avatar,
          avatar: p.avatar,
          city: p.city,
          hasCity: !!p.city,
          scenes_text: (p.accept_scenes || []).map((c) => SCENE_NAME_MAP[c]).filter(Boolean).join(' '),
          hasScenes: (p.accept_scenes || []).length > 0,
          score: p.partner_credit_score || 0
        }));
        this.setData({
          blogs, demands, users, partners,
          hasBlogs: blogs.length > 0,
          hasDemands: demands.length > 0,
          hasUsers: users.length > 0,
          hasPartners: partners.length > 0
        });
      },
      fail: () => {}
    });
  },

  goBlogDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/blog-detail/blog-detail?post_id=' + id });
  },

  goHall() {
    wx.switchTab({ url: '/pages/hall/hall' });
  },

  goPartnerHome(e) {
    const oid = e.currentTarget.dataset.openid;
    if (!oid) return;
    wx.navigateTo({ url: '/pages/partner-home/partner-home?openid=' + oid });
  },

  goUserHome(e) {
    const oid = e.currentTarget.dataset.openid;
    if (!oid) return;
    wx.navigateTo({ url: '/pages/user-home/user-home?openid=' + oid });
  },

  // 场景五宫格 → 发布页并预选场景
  onSceneTap(e) {
    const code = e.currentTarget.dataset.code;
    wx.navigateTo({ url: `/pages/demand-publish/demand-publish?scene=${code}` });
  },

  // ───────── 搜索服务/场景 ─────────
  noop() {},

  onSearchTap() {
    this.loadHistory();
    this.setData({ showSearch: true, keyword: '', sceneResults: [], optionResults: [] });
  },

  closeSearch() {
    this.setData({ showSearch: false });
  },

  loadHistory() {
    try { this.setData({ history: wx.getStorageSync(HIST_KEY) || [] }); } catch (e) {}
  },

  saveHistory(kw) {
    kw = (kw || '').trim();
    if (!kw) return;
    let h = this.data.history.filter((x) => x !== kw);
    h.unshift(kw);
    h = h.slice(0, HIST_MAX);
    this.setData({ history: h });
    try { wx.setStorageSync(HIST_KEY, h); } catch (e) {}
  },

  clearHistory() {
    this.setData({ history: [] });
    try { wx.removeStorageSync(HIST_KEY); } catch (e) {}
  },

  onSearchInput(e) {
    this.applySearch(e.detail.value);
  },

  onSearchConfirm() {
    // 键盘「搜索」: 有结果则跳第一条, 同时记历史
    const kw = (this.data.keyword || '').trim();
    if (!kw) return;
    this.saveHistory(kw);
    const r = this.data.optionResults[0] || this.data.sceneResults[0];
    if (r) {
      if (r.sceneCode) this.goPublish(r.sceneCode, r.name);
      else this.goPublish(r.code, null);
    }
  },

  // 实时过滤: 场景名命中 → 场景行; 服务项名/所属场景命中 → 服务项行
  applySearch(raw) {
    const kw = (raw || '').trim();
    if (!kw) {
      this.setData({ keyword: raw, sceneResults: [], optionResults: [] });
      return;
    }
    const sceneResults = SCENE_ROWS.filter((s) => s.name.indexOf(kw) >= 0);
    const optionResults = ALL_OPTIONS
      .filter((o) => o.name.indexOf(kw) >= 0 || o.sceneName.indexOf(kw) >= 0)
      .map((o) => Object.assign({ key: o.sceneCode + '_' + o.name }, o));
    this.setData({ keyword: raw, sceneResults, optionResults });
  },

  clearKeyword() {
    this.setData({ keyword: '', sceneResults: [], optionResults: [] });
  },

  onHistTap(e) {
    const kw = e.currentTarget.dataset.kw;
    this.setData({ keyword: kw });
    this.applySearch(kw);
  },

  // 跳发布页: 场景必带, 服务项可选(预选); 关闭面板并记历史
  goPublish(sceneCode, optName, histWord) {
    if (histWord) this.saveHistory(histWord);
    let url = `/pages/demand-publish/demand-publish?scene=${sceneCode}`;
    if (optName) url += `&opt=${encodeURIComponent(optName)}`;
    this.setData({ showSearch: false });
    wx.navigateTo({ url });
  },

  onSceneResultTap(e) {
    const code = e.currentTarget.dataset.code;
    const kw = (this.data.keyword || '').trim();
    const row = SCENE_ROWS.find((s) => s.code === code);
    this.goPublish(code, null, kw || (row && row.name));
  },

  onOptionTap(e) {
    const { name, scene } = e.currentTarget.dataset;
    this.goPublish(scene, name, name);
  },

  // 进行中订单横条 → 订单详情(事件兜底:无订单不跳转)
  goActiveOrder() {
    if (!this.data.hasActiveOrder || !this.data.activeOrder || !this.data.activeOrder.order_id) return;
    wx.navigateTo({
      url: `/pages/order-detail/order-detail?order_id=${this.data.activeOrder.order_id}`,
      fail: () => wx.showToast({ title: '打开订单失败，请重试', icon: 'none' })
    });
  },

  // 耍伴动态信息流
  goBlog() {
    wx.navigateTo({
      url: '/pages/blog/blog',
      fail: () => wx.showToast({ title: '打开动态失败', icon: 'none' })
    });
  }
});
