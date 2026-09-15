// pages/order-detail/order-detail.js - 订单详情(状态/四确认/支付/履约/评价/通勤)
const { ORDER_STATUS, aaTierLabel } = require('../../utils/constants.js');
const { formatMoney, haversineKm, estimateCommute } = require('../../utils/util.js');

// 待履约状态(耍伴需要导航到履约地点)
const NAV_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];
const CONFIRM_ORDER = ['time', 'location', 'content', 'fee'];
const CONFIRM_LABELS = { time: '服务时间', location: '服务地点', content: '服务内容', fee: '费用明细' };

// 各状态说明文案
const STATUS_TIP = {
  S1: '请双方确认服务时间、地点、内容、费用（共 8 个确认位）',
  S0: '四项已确认，请在支付时限内完成支付',
  S2: '已支付，等待耍伴开始服务',
  'S2.5': '改期申请处理中，等待耍伴确认', // PRD 3.5.2 分支态 S2.5
  S3: '服务进行中，请耍伴完成后点击"完成履约"',
  'S3.5': '服务中断处理中',
  S4: '服务部分完成',
  S5: '服务已完成，等待发单人评价',
  S6: '订单已取消',
  S7: '订单已全额退款',
  S8: '交易已完成，感谢使用',
  S9: '评价超时，系统已默认评价',
  S10: '订单已关闭',
  'S10.5': '争议处理中'
};

Page({
  data: {
    orderId: '',
    d: null,
    loading: true,
    paymentVisible: true,   // 审核开关: false 隐藏支付入口
    // 通勤(耍伴视角)
    toSite: null,
    hasLocation: false,
    locationTried: false,
    // 评价表单
    star: 5,
    stars: [],
    evalContent: '',
    submitting: false,
    acting: false,
    // 安全中心
    safety: null,
    safetyBusy: false
  },

  onLoad(opts) {
    if (!opts || !opts.order_id) {
      wx.showToast({ title: '缺少订单参数', icon: 'none' });
      return;
    }
    this.setData({ orderId: opts.order_id, stars: this.buildStars(5) });
    this.loadDetail();
  },

  onShow() {
    // 审核开关: payment_visible=false 隐藏支付入口(被拒后可快速隐藏二次提审)
    wx.cloud.callFunction({
      name: 'user-login',
      data: { action: 'global_config' },
      success: (r) => {
        if (r.result && r.result.ok) {
          this.setData({ paymentVisible: r.result.data.payment_visible !== false });
        }
      }
    });
    // 从收银台支付完成返回时静默刷新(首次 onLoad 时 d 为空,不重复请求)
    if (this.data.orderId && this.data.d) this.loadDetail(true);
  },

  onPullDownRefresh() {
    this.loadDetail(true, () => wx.stopPullDownRefresh());
  },

  // ───────── 加载详情 ─────────
  loadDetail(silent, done) {
    if (!silent) wx.showLoading({ title: '加载中', mask: true });
    wx.cloud.callFunction({
      name: 'order-action',
      data: { action: 'detail', order_id: this.data.orderId },
      success: (res) => {
        if (res.result && res.result.ok) {
          const d = this.decorate(res.result.data);
          this.setData({
            d,
            loading: false,
            stars: this.buildStars(this.data.star)
          });
          // 耍伴视角 + 待履约:算当前位置 → 履约地点通勤
          if (d.is_partner && NAV_STATUS.indexOf(d.status) >= 0 && d.location_lat) {
            this.calcToSite(d);
          } else {
            this.setData({ toSite: null, locationTried: false });
          }
          // 安全状态(求助中/报备记录/紧急联系人)
          if (d.can_safety) this.loadSafety();
          else this.setData({ safety: null });
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '加载失败', icon: 'none' });
        }
      },
      fail: () => wx.showToast({ title: '网络异常', icon: 'none' }),
      complete: () => { wx.hideLoading(); if (done) done(); }
    });
  },

  // ───────── 展示字段预处理(WXML 仅属性访问/三元) ─────────
  decorate(o) {
    const statusList = Object.keys(ORDER_STATUS).map((k) => ORDER_STATUS[k]);
    const st = statusList.find((s) => s.code === o.status) || { name: o.status, color: 'muted' };
    const pad = (n) => n < 10 ? '0' + n : '' + n;
    const fmtTime = (ts) => {
      const dd = new Date(ts);
      return `${dd.getMonth() + 1}月${dd.getDate()}日 ${pad(dd.getHours())}:${pad(dd.getMinutes())}`;
    };

    // 四确认项 → 数组(含双方勾选位/本方是否已确认/值摘要)
    let confirmItems = [];
    let myConfirmedCount = 0;
    if (o.confirm) {
      confirmItems = CONFIRM_ORDER.map((key) => {
        const it = (o.confirm.items && o.confirm.items[key]) || {};
        const myOk = o.role === 'user' ? !!it.user_ok : !!it.partner_ok;
        if (myOk) myConfirmedCount++;
        let valueStr = '';
        if (key === 'time') valueStr = fmtTime(it.value);
        else if (key === 'location') valueStr = (it.value && it.value.name) || '待确认';
        else if (key === 'content') valueStr = Array.isArray(it.value) ? it.value.join('、') : String(it.value || '');
        else if (key === 'fee') valueStr = '¥' + formatMoney(it.value);
        return {
          key,
          label: CONFIRM_LABELS[key],
          value_str: valueStr,
          user_ok: !!it.user_ok,
          partner_ok: !!it.partner_ok,
          my_ok: myOk
        };
      });
    }

    const isPartner = o.role === 'partner';
    const status = o.status;
    // 双方显示名:注册昵称优先, 无昵称回退角色名
    const userLabel = o.user_nickname || '发单人';
    const partnerLabel = o.partner_nickname || '耍伴';

    // 状态头提示(按视角+对方昵称)
    let statusTip = STATUS_TIP[status] || '';
    if (status === 'S2') statusTip = isPartner ? '已支付，请尽快出发并点击"开始履约"' : '已支付，等待' + partnerLabel + '开始服务';
    else if (status === 'S3') statusTip = isPartner ? '服务进行中，完成后请点击"完成履约"' : '服务进行中，等待' + partnerLabel + '完成服务';
    else if (status === 'S5') statusTip = isPartner ? '服务已完成，等待' + userLabel + '评价' : '服务已完成，请及时评价';

    return {
      ...o,
      aa_tier: aaTierLabel(o.aa_tier),
      location_lat: (o.location && o.location.latitude) || null,
      location_lng: (o.location && o.location.longitude) || null,
      status_name: st.name,
      status_color: st.color,
      status_tip: statusTip,
      time_str: fmtTime(o.start_time),
      content_str: (o.content_options || []).join('、'),
      location_name: (o.location && o.location.name) || '待确认',
      total_yuan: formatMoney(o.total_fen),
      fee_yuan: formatMoney(o.fee_fen),
      income_yuan: formatMoney(o.partner_income_fen),
      tip_yuan: formatMoney(o.tip_total_fen || 0),
      tip_total_fen: o.tip_total_fen || 0,
      pay_expire_str: o.pay_expire_at ? fmtTime(o.pay_expire_at) : '',
      eval_stars: o.evaluation ? this.buildStars(o.evaluation.star) : [],
      confirm_items: confirmItems,
      confirmed_count: o.confirm ? o.confirm.confirmed_count : 0,
      is_partner: isPartner,
      role_name: isPartner ? '耍伴' : '发单人',
      // 双方显示名(注册昵称, 四确认勾选位/安全横幅/等待文案使用)
      user_label: userLabel,
      partner_label: partnerLabel,
      // 操作权限布尔位
      can_confirm: status === 'S1' && myConfirmedCount < 4,
      wait_confirm: status === 'S1' && myConfirmedCount >= 4,
      can_pay: status === 'S0' && !isPartner,
      wait_pay: status === 'S0' && isPartner,
      can_cancel: status === 'S1' || (status === 'S0' && !isPartner),
      can_start: status === 'S2' && isPartner,
      wait_start: status === 'S2' && !isPartner,
      can_complete: status === 'S3' && isPartner,
      wait_complete: status === 'S3' && !isPartner,
      can_eval: status === 'S5' && !isPartner,
      wait_eval: status === 'S5' && isPartner,
      // 打赏: 发单人对已履约完成订单(S5/S8/S9/S10)可打赏, 可多次
      can_tip: !isPartner && ['S5', 'S8', 'S9', 'S10'].indexOf(status) >= 0,
      // 等待提示文案(带对方昵称)
      wait_pay_tip: userLabel + '支付中，支付后即可开始履约',
      wait_start_tip: '已支付，等待' + partnerLabel + '到达并开始服务',
      wait_complete_tip: '服务进行中，完成后' + partnerLabel + '将提交完成',
      wait_eval_tip: '服务已完成，等待' + userLabel + '评价',
      // 安全中心:赴约~待评价阶段可见(S1/S0/S2/S3/S3.5/S4/S5)
      can_safety: ['S1', 'S0', 'S2', 'S3', 'S3.5', 'S4', 'S5'].indexOf(status) >= 0
    };
  },

  buildStars(n) {
    return [1, 2, 3, 4, 5].map((i) => ({ n: i, on: i <= n }));
  },

  // ───────── 通勤(耍伴:当前位置 → 履约地点) ─────────
  // 首次调用由微信官方隐私弹窗自动处理授权
  calcToSite(d) {
    wx.getLocation({
      type: 'gcj02',
      success: (loc) => {
        if (!d.location_lat || !d.location_lng) return;
        const km = haversineKm(loc.latitude, loc.longitude, d.location_lat, d.location_lng);
        const est = estimateCommute(km);
        if (d.start_time > Date.now()) {
          const depart = new Date(d.start_time - est.drive_min * 60000);
          const pad = (n) => n < 10 ? '0' + n : '' + n;
          est.depart_str = `${pad(depart.getHours())}:${pad(depart.getMinutes())}`;
        }
        this.setData({ toSite: est, hasLocation: true, locationTried: true });
      },
      fail: () => this.setData({ hasLocation: false, locationTried: true })
    });
  },

  openLocationSetting() {
    wx.openSetting({
      success: (res) => {
        if (res.authSetting && res.authSetting['scope.userLocation'] && this.data.d) {
          this.calcToSite(this.data.d);
        }
      }
    });
  },

  // ───────── 订单操作(order-action) ─────────
  callAction(action, okMsg, confirmContent) {
    const run = () => {
      if (this.data.acting) return;
      this.setData({ acting: true });
      wx.showLoading({ title: '处理中', mask: true });
      wx.cloud.callFunction({
        name: 'order-action',
        data: { action, order_id: this.data.orderId },
        success: (res) => {
          wx.hideLoading();
          this.setData({ acting: false });
          if (res.result && res.result.ok) {
            wx.showToast({ title: okMsg || '操作成功', icon: 'success' });
            this.loadDetail(true);
          } else {
            wx.showModal({ title: '操作失败', content: (res.result && res.result.msg) || '请稍后重试', showCancel: false });
          }
        },
        fail: () => {
          wx.hideLoading();
          this.setData({ acting: false });
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      });
    };
    if (confirmContent) {
      wx.showModal({
        title: '提示',
        content: confirmContent,
        success: (r) => { if (r.confirm) run(); }
      });
    } else {
      run();
    }
  },

  onConfirmAll() {
    this.callAction('confirm_all', '已确认');
  },

  onCancel() {
    this.callAction('cancel', '订单已取消', '确定取消该订单吗？取消后需求将重新开放给其他耍伴。');
  },

  onStart() {
    this.callAction('start_service', '服务已开始', '确认已到达服务地点并开始服务？');
  },

  onComplete() {
    this.callAction('complete_service', '服务已完成', '确认服务已全部完成？完成后发单人即可评价。');
  },

  goPay() {
    wx.navigateTo({ url: `/pages/cashier/cashier?order_id=${this.data.orderId}` });
  },

  // ───────── 打赏(已履约完成订单, 发单人) ─────────
  onTip() {
    const amounts = [500, 1000, 2000, 5000];   // 5/10/20/50 元(分)
    wx.showActionSheet({
      itemList: ['打赏 5 元', '打赏 10 元', '打赏 20 元', '打赏 50 元'],
      success: (r) => {
        const amountFen = amounts[r.tapIndex];
        if (!amountFen) return;
        const partnerLabel = (this.data.d && this.data.d.partner_label) || '耍伴';
        wx.showModal({
          title: '确认打赏',
          content: `模拟支付，不产生真实扣款。\n确认向${partnerLabel}打赏 ${amountFen / 100} 元？`,
          confirmText: '确认打赏',
          success: (m) => { if (m.confirm) this.doTip(amountFen); }
        });
      }
    });
  },

  doTip(amountFen) {
    if (this.data.acting) return;
    this.setData({ acting: true });
    wx.showLoading({ title: '处理中', mask: true });
    wx.cloud.callFunction({
      name: 'payment-mock',
      data: { action: 'mock_tip', order_id: this.data.orderId, amount_fen: amountFen },
      success: (res) => {
        wx.hideLoading();
        this.setData({ acting: false });
        if (res.result && res.result.ok) {
          wx.showToast({ title: '打赏成功', icon: 'success' });
          this.loadDetail(true);
        } else {
          wx.showModal({ title: '打赏失败', content: (res.result && res.result.msg) || '请稍后重试', showCancel: false });
        }
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ acting: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  goChat() {
    wx.navigateTo({ url: `/pages/chat-detail/chat-detail?order_id=${this.data.orderId}` });
  },

  // ───────── 安全中心(safety-report) ─────────
  loadSafety() {
    wx.cloud.callFunction({
      name: 'safety-report',
      data: { action: 'status', order_id: this.data.orderId },
      success: (res) => {
        if (res.result && res.result.ok) {
          const s = res.result.data;
          const dd = this.data.d || {};
          const nameOf = (r) => r === 'partner' ? (dd.partner_label || '耍伴') : (dd.user_label || '发单人');
          const pad = (n) => n < 10 ? '0' + n : '' + n;
          const fmt = (ts) => {
            const d = new Date(ts);
            return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
          };
          const checkins = (s.checkins || []).map((c) => ({
            key: c.reporter_role + '_' + c.created_at,
            role_label: nameOf(c.reporter_role),
            time_str: fmt(c.created_at)
          }));
          this.setData({
            safety: {
              help_flag: !!s.help_flag,
              active_sos: s.active_sos ? {
                reporter_label: nameOf(s.active_sos.reporter_role),
                time_str: fmt(s.active_sos.created_at)
              } : null,
              checkins,
              contacts: s.my_contacts || []
            }
          });
        }
      }
    });
  },

  // 取定位(失败不阻断,SOS/报备位置为可选; 首次调用由官方隐私弹窗自动处理授权)
  getLocation() {
    return new Promise((resolve) => {
      wx.getLocation({
        type: 'gcj02',
        success: (loc) => resolve({ latitude: loc.latitude, longitude: loc.longitude }),
        fail: () => resolve(null)
      });
    });
  },

  // 紧急求助
  onSos() {
    if (this.data.safetyBusy) return;
    wx.showModal({
      title: '⚠️ 确认紧急求助？',
      content: '将立即记录你的位置并通知平台，随后可一键拨打紧急联系人或 110/120。非紧急情况请勿误触。',
      confirmText: '确认求助',
      confirmColor: '#B03A2E',
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ safetyBusy: true });
        wx.showLoading({ title: '提交中', mask: true });
        this.getLocation().then((location) => {
          wx.cloud.callFunction({
            name: 'safety-report',
            data: { action: 'sos', order_id: this.data.orderId, location },
            success: (res) => {
              wx.hideLoading();
              this.setData({ safetyBusy: false });
              if (res.result && res.result.ok) {
                this.loadSafety();
                this.offerCall(res.result.data.my_contacts || []);
              } else {
                wx.showModal({
                  title: '求助提交失败',
                  content: (res.result && res.result.msg) || '请直接拨打 110 报警',
                  confirmText: '拨打110',
                  success: (m) => { if (m.confirm) wx.makePhoneCall({ phoneNumber: '110' }); }
                });
              }
            },
            fail: () => {
              wx.hideLoading();
              this.setData({ safetyBusy: false });
              wx.showToast({ title: '网络异常，请直接拨打110', icon: 'none' });
            }
          });
        });
      }
    });
  },

  // 求助成功后弹拨号选择
  offerCall(contacts) {
    const items = contacts.map((c) => `📞 ${c.name}（${c.relation || '联系人'}）`);
    items.push('🚨 报警 110', '🚑 急救 120');
    wx.showActionSheet({
      itemList: items,
      success: (r) => {
        const idx = r.tapIndex;
        let phone = '';
        if (idx < contacts.length) phone = contacts[idx].phone;
        else if (idx === contacts.length) phone = '110';
        else phone = '120';
        if (phone) wx.makePhoneCall({ phoneNumber: phone });
      },
      fail: () => {
        // 用户未选择:提示仍可拨号
        if (!contacts.length) {
          wx.showModal({
            title: '未设置紧急联系人',
            content: '可到「我的」页面设置 1-2 名紧急联系人；紧急情况请直接拨打 110/120。',
            confirmText: '拨打110',
            success: (m) => { if (m.confirm) wx.makePhoneCall({ phoneNumber: '110' }); }
          });
        }
      }
    });
  },

  // 解除求助(双方均可)
  onResolveSos() {
    if (this.data.safetyBusy) return;
    wx.showModal({
      title: '解除紧急求助？',
      content: '确认本人已安全，解除后平台将关闭本次求助记录。',
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ safetyBusy: true });
        wx.cloud.callFunction({
          name: 'safety-report',
          data: { action: 'resolve', order_id: this.data.orderId },
          success: (res) => {
            this.setData({ safetyBusy: false });
            if (res.result && res.result.ok) {
              wx.showToast({ title: '已解除，请注意安全', icon: 'success' });
              this.loadSafety();
              this.loadDetail(true);
            } else {
              wx.showToast({ title: (res.result && res.result.msg) || '解除失败', icon: 'none' });
            }
          },
          fail: () => {
            this.setData({ safetyBusy: false });
            wx.showToast({ title: '网络异常', icon: 'none' });
          }
        });
      }
    });
  },

  // 安全报备(报平安,带位置)
  onCheckin() {
    if (this.data.safetyBusy) return;
    this.setData({ safetyBusy: true });
    wx.showLoading({ title: '报备中', mask: true });
    this.getLocation().then((location) => {
      wx.cloud.callFunction({
        name: 'safety-report',
        data: { action: 'checkin', order_id: this.data.orderId, location },
        success: (res) => {
          wx.hideLoading();
          this.setData({ safetyBusy: false });
          if (res.result && res.result.ok) {
            wx.showToast({ title: '报备成功', icon: 'success' });
            this.loadSafety();
          } else {
            wx.showToast({ title: (res.result && res.result.msg) || '报备失败', icon: 'none' });
          }
        },
        fail: () => {
          wx.hideLoading();
          this.setData({ safetyBusy: false });
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      });
    });
  },

  // ───────── 评价(S5 发单人) ─────────
  pickStar(e) {
    const n = Number(e.currentTarget.dataset.star);
    this.setData({ star: n, stars: this.buildStars(n) });
  },

  onEvalInput(e) {
    this.setData({ evalContent: e.detail.value });
  },

  submitEval() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中', mask: true });
    wx.cloud.callFunction({
      name: 'evaluation-submit',
      data: {
        action: 'submit',
        order_id: this.data.orderId,
        star: this.data.star,
        content: this.data.evalContent
      },
      success: (res) => {
        wx.hideLoading();
        this.setData({ submitting: false });
        if (res.result && res.result.ok) {
          wx.showToast({ title: '评价成功', icon: 'success' });
          this.setData({ evalContent: '' });
          this.loadDetail(true);
        } else {
          wx.showModal({ title: '评价失败', content: (res.result && res.result.msg) || '请稍后重试', showCancel: false });
        }
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ submitting: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  }
});
