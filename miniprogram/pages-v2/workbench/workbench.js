// PRD章节: 2.4 耍伴工作台 / 3.10 资金 / 3.1 信用 / 3.6 安全
// P2: 接云端 payment-mock balance_info + income_list, 删 mock 依赖
const CONFIG = require('../../config/index.js');
const { SCENES, FUND_STATUS } = require('../../config/enums.js');
const redline = require('../../utils/redline.js');

const { callCloud } = require('../../utils/cloud.js');

// F2(2026-11-04): 日期工具, 时间轴筛选与周日历计数共用(按本地时区取 YYYY-MM-DD)
const pad2 = (n) => ('0' + n).slice(-2);
const ymdOf = (t) => {
  const x = t ? new Date(t) : null;
  return (x && !isNaN(x.getTime())) ? x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate()) : '';
};

Page({
  data: {
    acceptingOrders: true,
    todaySummary: { count: 0, upcoming: '' },
    todayCount: 0,
    weekIncomeYuan: '0.00',
    creditLevel: 'L2',
    creditScore: 0,
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
      // P2-11: 进行中订单全量(≤20), 供 SOS 上报填 orderId + 时间轴/周日历
      callCloud('order-action', { action: 'my_orders', role: 'partner', filter: 'doing', page_size: 20 }).catch(() => ({ ok: false })),
      // F1a(2026-11-04): 取耍伴待确认订单(S1), 供 W6 待办卡; 仅展示, 确认/拒绝跳详情
      callCloud('order-action', { action: 'my_orders', role: 'partner', filter: 'confirm', page_size: 5 }).catch(() => ({ ok: false }))
    ]).then(([balR, incR, prfR, ordR, cfmR]) => {
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
        // P2-12/13(2026-11-02): 改用服务端口径; 旧字段仅在云函数未更新时兜底, 避免过渡期显示 0
        d.weekIncomeYuan = ((typeof b.week_income_fen === 'number' ? b.week_income_fen : (b.month_income_fen || 0)) / 100).toFixed(2);
        d.todayCount = typeof b.today_pending === 'number' ? b.today_pending : (b.total_completed || 0);
        d.creditLevel = b.credit_level || 'L1';
        // P3-16(2026-11-03): 信用分与等级统一取 partner_profile.score, 避免两源不一致
        // 2026-11-05: 收敛为单一展示字段 creditScore, 无档案时回退账户原值
        d.creditScore = typeof b.credit_score === 'number'
          ? b.credit_score
          : ((this.data.user && this.data.user.partner_credit_score) || 0);
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
      // P3-17(2026-11-03): 时间轴卡字段映射(my_orders 只返回 scene_name/location_name/start_time 等, 原字段全空)
      // F2(2026-11-04): 留存进行中全量, 供周日历计数与点选某日筛选
      this.allDoing = doingList;
      this._todayKey = ymdOf(new Date());
      this._mapOrder = (o) => {
        const st = o.start_time ? new Date(o.start_time) : null;
        const time = st ? ('0' + st.getHours()).slice(-2) + ':' + ('0' + st.getMinutes()).slice(-2) : '';
        return {
          _id: o.order_id,
          sceneName: o.scene_name || '',
          time,
          locationName: o.location_name || '',
          // P2-1(2026-11-04): my_orders 已返回 location_lat/lng(action_query.js), 供「导航」调 wx.openLocation
          lat: (typeof o.location_lat === 'number') ? o.location_lat : null,
          lng: (typeof o.location_lng === 'number') ? o.location_lng : null,
          partnerName: o.demand_title || '',
          sceneColor: 'var(--brand)'
        };
      };
      // F2(2026-11-04): 时间轴默认只显示今天, 按开始时间升序
      d.todayOrders = doingList
        .filter((o) => ymdOf(o.start_time) === this._todayKey)
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
        .map(this._mapOrder);
      d.currentOrderId = doingList.length > 0 ? doingList[0].order_id : '';
      // F1a(2026-11-04): W6 待办卡数据源 = my_orders(partner, confirm=S1); 字段按模板口径映射
      const cfmList = (cfmR.ok && cfmR.data && cfmR.data.list) || [];
      d.pendingOrders = cfmList.map((o) => {
        const st = o.start_time ? new Date(o.start_time) : null;
        const pad = (n) => ('0' + n).slice(-2);
        return {
          _id: o.order_id,
          // 对接方(发单人)无昵称字段时, 回落到需求标题/场景名, 不显示空白
          partner_name: o.demand_title || o.scene_name || '待确认订单',
          service_date: st ? (st.getMonth() + 1) + '/' + st.getDate() : '',
          service_time: st ? pad(st.getHours()) + ':' + pad(st.getMinutes()) : ''
        };
      });
      d.todaySummary = {
        count: d.todayCount,
        upcoming: d.incomeList && d.incomeList.length ? `${d.incomeList[0].scene || ''} 待处理` : '暂无进行中订单'
      };
      // F2(2026-11-04): 周日历接真实排期(未来7天, 按进行中订单的服务日计数出小圆点)
      const cntByDay = {};
      doingList.forEach((o) => {
        const k = ymdOf(o.start_time);
        if (k) cntByDay[k] = (cntByDay[k] || 0) + 1;
      });
      const today = new Date();
      const wdNames = ['日', '一', '二', '三', '四', '五', '六'];
      const weekDays = [];
      for (let i = 0; i < 7; i++) {
        const dt = new Date(today.getTime() + i * 86400000);
        const key = ymdOf(dt);
        weekDays.push({ key, wd: wdNames[dt.getDay()], dateStr: pad2(dt.getMonth() + 1) + '/' + pad2(dt.getDate()), isToday: i === 0, hasOrder: !!cntByDay[key] });
      }
      d.weekDays = weekDays;
      d.activeDayIndex = 0;
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

  // W3 周日历: 点选某天 → 时间轴按该日筛选(默认今天); F2(2026-11-04) 接真实排期
  onWeekDayTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const day = (this.data.weekDays || [])[idx];
    if (!day || !this._mapOrder) return;
    const list = (this.allDoing || [])
      .filter((o) => ymdOf(o.start_time) === day.key)
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
      .map((o) => this._mapOrder(o));
    this.setData({ activeDayIndex: idx, todayOrders: list });
  },

  // W3 时间轴操作
  // P2-1(2026-11-04): 接 my_orders 的 location_lat/lng; 无坐标(老订单)回落 toast, 不静默
  onNavigate(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.id : '';
    const it = (this.data.todayOrders || []).filter((x) => x._id === id)[0];
    if (!it || it.lat === null || it.lng === null) {
      wx.showToast({ title: '该订单暂无地点坐标', icon: 'none' });
      return;
    }
    wx.openLocation({
      latitude: it.lat,
      longitude: it.lng,
      name: it.locationName || it.sceneName || '服务地点',
      address: it.locationName || '',
      scale: 18,
      fail: () => wx.showToast({ title: '导航打开失败', icon: 'none' })
    });
  },
  // P2-2(2026-11-04): 直接进订单会话(聊天页校验 32 位订单 id, 四确认前仅模板消息)
  onContactUser(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.id : '';
    if (!id) { wx.showToast({ title: '订单参数缺失', icon: 'none' }); return; }
    wx.navigateTo({
      url: '/pages-v2/chat/chat?orderId=' + id,
      fail: () => wx.showToast({ title: '进入会话失败', icon: 'none' })
    });
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

  // F1a(2026-11-04): 待办卡按钮改为进订单详情处理(就地四确认/拒单属写状态机, 另案 F1b)
  onConfirmOrder(e) { this.goOrderDetail(e); },
  onRejectOrder(e) { this.goOrderDetail(e); },
  goOrderDetail(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.id : '';
    if (!id) { wx.showToast({ title: '订单参数缺失', icon: 'none' }); return; }
    wx.navigateTo({
      url: '/pages-v2/order-detail/order-detail?orderId=' + id,
      fail: () => wx.showToast({ title: '打开订单失败', icon: 'none' })
    });
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
          // P2-11 自由求助: 无进行中订单时写 platform_event(P0), 不读写 order_main(附录A 第9条)
          this.freeSosFlow();
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

  // P2-11 自由求助: 无订单报警 —— 已有进行中的求助则询问解除, 否则上报 P0 事件
  freeSosFlow() {
    callCloud('safety-report', { action: 'free_sos_status' }).then((r) => {
      if (!r.ok) {
        wx.showToast({ title: '状态查询失败,请直接拨打110', icon: 'none' });
        return;
      }
      if (r.data && r.data.active) {
        wx.showModal({
          title: '已有进行中的求助',
          content: '你已上报过自由求助,是否解除？',
          confirmText: '解除求助',
          confirmColor: '#fa5151',
          fail: () => wx.showToast({ title: '弹窗加载失败', icon: 'none' }),
          success: (m) => {
            if (!m.confirm) return;
            callCloud('safety-report', { action: 'free_sos_resolve', report_id: r.data.report_id }).then((x) => {
              wx.showToast({ title: x.ok ? '已解除求助' : (x.msg || '解除失败'), icon: 'none' });
            }).catch(() => wx.showToast({ title: '网络异常,解除失败', icon: 'none' }));
          }
        });
        return;
      }
      callCloud('safety-report', { action: 'free_sos', source: 'workbench' }).then((x) => {
        if (!x.ok) {
          wx.showToast({ title: '上报失败, 请直接拨打110', icon: 'none' });
          return;
        }
        wx.showToast({ title: '已上报平台安全中心', icon: 'none', duration: 2500 });
      }).catch(() => wx.showToast({ title: '网络异常, 请直接拨打110', icon: 'none' }));
    }).catch(() => wx.showToast({ title: '网络异常, 请直接拨打110', icon: 'none' }));
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
    this.__nearbyPollTimer = setInterval(() => { if (this.data.isPartner) this.fetchNearby(); }, 60000);
  },
  stopNearbyPoll() {
    if (this.__nearbyPollTimer) { clearInterval(this.__nearbyPollTimer); this.__nearbyPollTimer = null; }
  },
  // 页面不可见/销毁即停轮询(与首页 onHide/onUnload 同构)
  onHide() { this.stopNearbyPoll(); },
  onUnload() { this.stopNearbyPoll(); }
});
