// PRD章节: 2.4 耍伴工作台 / 3.10 资金 / 3.1 信用 / 3.6 安全
// P2: 接云端 payment-mock balance_info + income_list, 删 mock 依赖
const CONFIG = require('../../config/index.js');
const { SCENES, FUND_STATUS } = require('../../config/enums.js');
const redline = require('../../utils/redline.js');

const { callCloud } = require('../../utils/cloud.js');

Page({
  data: {
    acceptingOrders: true,
    todaySummary: { count: 0, upcoming: '' },
    todayCount: 0,
    weekIncomeYuan: '0.00',
    creditLevel: 'L2',
    weekDays: [],
    todayOrders: [],
    // T-7.3 附近新单轮询(仅耍伴端, workbench 同步)
    isPartner: false,
    nearbyList: [],
    // W4 资金速览 tab
    fundTabs: [
      { key: 'withdrawable', name: '可提现' },
      { key: 'splitting', name: '分账中' },
      { key: 'processing', name: '处理中' }
    ],
    fundActive: 'withdrawable',
    fundAmount: '0.00',
    fundAmountMap: { withdrawable: '0.00', splitting: '0.00', processing: '0.00' },
    incomeList: [],
    pendingOrders: [],
    loading: false,
    loadError: false,
    isRedline: false,
    confirmTimeoutMin: CONFIG.ORDER.confirmTimeoutMin
  },
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  },


  onLoad() {
    // onLoad 已拉首屏, 首次 onShow 跳过避免双拉; 操作后返回 onShow 正常刷新
    this.__skipNextShow = true;
    this.fetchUser();  // T-7.3 判定耍伴身份 → 启动附近新单轮询
    this.fetchData();
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    if (this.data.isPartner) this.startNearbyPoll();  // T-7.3 耍伴端回工作台恢复轮询
    if (this.__skipNextShow) { this.__skipNextShow = false; return; }
    this.fetchData();
  },

  fetchData() {
    this.setData({ loading: true, loadError: false });
    // 独立 catch: 不让一个接口超时拖死全部
    Promise.all([
      callCloud('payment-mock', { action: 'balance_info' }).catch(() => ({ ok: false })),
      callCloud('payment-mock', { action: 'income_list', limit: Number(CONFIG.WORKBENCH.incomeShow) || 5 }).catch(() => ({ ok: false })),
      callCloud('partner-action', { action: 'my_profile' }).catch(() => ({ ok: false })),
      // P2-11: 取耍伴最近进行中订单, 供 SOS 上报填 orderId
      callCloud('order-action', { action: 'my_orders', role: 'partner', filter: 'doing', page_size: 1 }).catch(() => ({ ok: false }))
    ]).then(([balR, incR, prfR, ordR]) => {
      const d = {};
      if (prfR.ok && prfR.data && prfR.data.profile) {
        // 接单开关初始值:从云端拿真实状态
        d.acceptingOrders = !!prfR.data.profile.accept_switch;
      }
      if (balR.ok) {
        const b = balR.data;
        const amtMap = {
          withdrawable: ((b.withdrawable_fen || 0) / 100).toFixed(2),
          splitting: ((b.splitting_fen || 0) / 100).toFixed(2),
          processing: ((b.processing_fen || 0) / 100).toFixed(2)
        };
        d.fundAmountMap = amtMap;
        d.fundAmount = amtMap[this.data.fundActive] || amtMap.withdrawable;
        d.weekIncomeYuan = ((b.month_income_fen || 0) / 100).toFixed(2);
        d.todayCount = b.total_completed || 0;
        d.creditLevel = b.credit_level || 'L1';
      }
      if (incR.ok) {
        d.incomeList = (incR.data.list || []).slice(0, Number(CONFIG.WORKBENCH.incomeShow) || 5).map((i) => ({
          order_no: i.order_no,
          scene: i.scene,
          status: i.status,
          netYuan: ((i.partner_income_fen || 0) / 100).toFixed(2),
          created_at: i.created_at
        }));
      } else {
        d.incomeList = [];
      }
      // P2-11: 最近进行中订单, 供 SOS 上报 & 时间轴占位
      const doingList = (ordR.ok && ordR.data && ordR.data.list) || [];
      d.todayOrders = doingList;
      d.currentOrderId = doingList.length > 0 ? doingList[0].order_id : '';
      d.todaySummary = {
        count: d.todayCount,
        upcoming: d.incomeList && d.incomeList.length ? `${d.incomeList[0].scene || ''} 待处理` : '暂无进行中订单'
      };
      // 周日历 (静态占位, 后续接真实排期)
      const today = new Date();
      const wdNames = ['日', '一', '二', '三', '四', '五', '六'];
      const weekDays = [];
      for (let i = 0; i < 7; i++) {
        const dt = new Date(today.getTime() + i * 86400000);
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const dd = String(dt.getDate()).padStart(2, '0');
        weekDays.push({ wd: wdNames[dt.getDay()], dateStr: `${mm}/${dd}`, isToday: i === 0, hasOrder: false });
      }
      d.weekDays = weekDays;
      this.setData(Object.assign(d, { loading: false }));
    }).catch(() => {
      this.setData({ loading: false, loadError: true });
    });
  },

  reload() { this.fetchData(); },

  onAcceptToggle(e) {
    // switch bindchange: e.detail.value 为切换后状态
    const on = (e && e.detail && typeof e.detail.value === 'boolean') ? e.detail.value : !this.data.acceptingOrders;
    const prev = this.data.acceptingOrders;
    // 乐观更新本地 UI, 云端校验后若失败再回滚
    this.setData({ acceptingOrders: on });
    callCloud('partner-action', { action: 'set_switch', accept_switch: on }).then((r) => {
      if (!r.ok) {
        this.setData({ acceptingOrders: prev });
        wx.showToast({ title: r.msg || '设置失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: on ? '已开启接单' : '已暂停接单', icon: 'success' });
    }).catch(() => {
      this.setData({ acceptingOrders: prev });
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },

  // W3 周日历: 选中某天 (当前仅切换高亮, 真实排期待接)
  onWeekDayTap(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ activeDayIndex: idx });
  },

  // W3 时间轴操作
  onNavigate() {
    // 占位处理: 订单数据结构接经纬度后改为 wx.openLocation; 当前路径被 todayOrders.length wx:if 保护不可达
    wx.showToast({ title: '导航暂不可用', icon: 'none' });
  },
  onContactUser() {
    wx.showToast({ title: '请从消息列表进入沟通', icon: 'none' });
  },

  // W4 资金
  goWallet() {
    wx.navigateTo({ url: '/pages-v2/pkg-low/wallet/wallet', fail: () => wx.switchTab({ url: '/pages-v2/profile/profile' }) });
  },
  onFundTabTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.fundActive) return;
    this.setData({ fundActive: key, fundAmount: (this.data.fundAmountMap || {})[key] || '0.00' });
  },

  // W6 待办订单 (pendingOrders 当前无云端数据源, 区块 wx:if 保护; 方法保留兜底)
  onConfirmOrder() {
    wx.showToast({ title: '请到订单详情确认', icon: 'none' });
  },
  onRejectOrder() {
    wx.showToast({ title: '请到订单详情处理', icon: 'none' });
  },

  // W5 一键报警: 上报云端 + 可选拨号
  onAlarmTap() {
    wx.showModal({
      title: '确认报警？',
      content: '将向平台安全中心上报并拨打110报警电话（可选）',
      confirmText: '拨号上报',   // wx.showModal confirmText 限 ≤4 字符; 完整语义见 title/content
      cancelText: '仅上报',
      confirmColor: '#fa5151',
      fail: () => wx.showToast({ title: '弹窗加载失败', icon: 'none' }),
      success: (res) => {
        if (!res.confirm && !res.cancel) return;
        // P2-11: 取最近进行中订单 orderId, 兜底为空串
        // currentOrderId 由 fetchData 中 my_orders(doing) 赋值; todayOrders 同样来自该源
        const orderId = this.data.currentOrderId || '';
        if (!orderId) {
          // 无进行中订单 —— 仍允许用户直接拨号 110, 仅提示无法关联订单上报
          wx.showToast({ title: '当前无进行中订单, 上报时无法关联', icon: 'none' });
        } else {
          callCloud('safety-report', { action: 'sos', order_id: orderId, source: 'workbench' })
            .then((r) => {
              if (!r.ok) {
                wx.showToast({ title: '上报失败, 请直接拨打110', icon: 'none' });
              }
            }).catch(() => {
              wx.showToast({ title: '网络异常, 请直接拨打110', icon: 'none' });
            });
        }
        // 拨号 110
        if (res.confirm) {
          wx.makePhoneCall({
            phoneNumber: '110',
            fail: () => wx.showToast({ title: '请手动拨打110', icon: 'none' })
          });
        } else {
          wx.showToast({ title: '已通知客服', icon: 'success' });
        }
      }
    });
  },
  onReserve() { require('../../utils/redline.js').reserveNotice(); },

  // ─── T-7.3 附近新单轮询(与首页逐字同构, 仅 workbench tab 可见期间轮询) ───

  fetchUser() {
    callCloud('user-login', { action: 'peek_login' }).then((r) => {
      if (r.ok && r.data && r.data.found && r.data.user) {
        const u = r.data.user;
        const isPartner = (u.roles || []).indexOf('partner') >= 0;
        this.setData({ user: u, isPartner });
        if (isPartner) { this.fetchNearby(); this.startNearbyPoll(); }
      }
    });
  },

  async fetchNearby() {
    if (this.__nearbyFetching) return;
    this.__nearbyFetching = true;
    try {
      const app = getApp();
      const r = await app.cloudCall('home-action', { action: 'nearby', page: 1, page_size: (CONFIG.PAGING && CONFIG.PAGING.indexNearby) || 10 });
      if (r.ok && r.data) {
        const list = r.data.list || [];
        this.setData({ nearbyList: list });
        this.__notifyNearbyNew(list);
      }
    } finally {
      this.__nearbyFetching = false;
    }
  },
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
  startNearbyPoll() {
    this.stopNearbyPoll();
    this.__nearbyPollTimer = setInterval(() => { if (this.data.isPartner) this.fetchNearby(); }, 30000);
  },
  stopNearbyPoll() {
    if (this.__nearbyPollTimer) { clearInterval(this.__nearbyPollTimer); this.__nearbyPollTimer = null; }
  },
  // 页面不可见/销毁即停轮询(与首页 onHide/onUnload 同构)
  onHide() { this.stopNearbyPoll(); },
  onUnload() { this.stopNearbyPoll(); }
});
