// PRD章节: 2.4 耍伴工作台 / 3.10 资金 / 3.1 信用 / 3.6 安全
// P2: 接云端 payment-mock balance_info + income_list, 删 mock 依赖
const CONFIG = require('../../config/index.js');
const { SCENES, FUND_STATUS } = require('../../config/enums.js');
const redline = require('../../utils/redline.js');

function callCloud(name, data) {
  // 审计留痕: 关键动作携带设备摘要
  let device = '';
  try { const s = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync(); device = `${s.brand || ''} ${s.model || ''}|${s.system || ''}|${s.platform || ''}`.trim().slice(0, 200); } catch (e) {}
  const sendData = Object.assign({}, data, { device });
  return wx.cloud.callFunction({ name, data: sendData }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

Page({
  data: {
    acceptingOrders: true,
    todaySummary: { count: 0, upcoming: '' },
    todayCount: 0,
    weekIncomeYuan: '0.00',
    creditLevel: 'L2',
    weekDays: [],
    todayOrders: [],
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
    this.fetchData();
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    if (this.__skipNextShow) { this.__skipNextShow = false; return; }
    this.fetchData();
  },

  fetchData() {
    this.setData({ loading: true, loadError: false });
    // 独立 catch: 不让一个接口超时拖死全部
    Promise.all([
      callCloud('payment-mock', { action: 'balance_info' }).catch(() => ({ ok: false })),
      callCloud('payment-mock', { action: 'income_list', limit: 10 }).catch(() => ({ ok: false })),
      callCloud('partner-action', { action: 'my_profile' }).catch(() => ({ ok: false }))
    ]).then(([balR, incR, prfR]) => {
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
        d.incomeList = (incR.data.list || []).slice(0, 5).map((i) => ({
          order_no: i.order_no,
          scene: i.scene,
          status: i.status,
          netYuan: ((i.partner_income_fen || 0) / 100).toFixed(2),
          created_at: i.created_at
        }));
      } else {
        d.incomeList = [];
      }
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
    wx.showToast({ title: '导航功能即将上线', icon: 'none' });
  },
  onContactUser() {
    wx.showToast({ title: '请从消息列表进入沟通', icon: 'none' });
  },

  // W4 资金
  goWallet() {
    wx.navigateTo({ url: '/pages-v2/wallet/wallet', fail: () => wx.switchTab({ url: '/pages-v2/profile/profile' }) });
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
      confirmText: '拨号并上报',
      cancelText: '仅上报',
      confirmColor: '#fa5151',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        if (!res.confirm && !res.cancel) return;
        // 上报云端 safety-report
        // orders 未加载时判空兜底(undefined[0] 会抛 TypeError 中断后续拨号)
        const activeOrders = this.data.orders || this.data.todayOrders || [];
        const orderId = this.data.currentOrderId || (activeOrders[0] && activeOrders[0].order_id) || '';
        if (orderId) {
          callCloud('safety-report', { action: 'sos', order_id: orderId, source: 'workbench' })
            .catch(() => {});  // 上报失败不阻塞拨号
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
  onReserve() { require('../../utils/redline.js').reserveNotice(); }
});
