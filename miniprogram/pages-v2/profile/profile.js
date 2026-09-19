// PRD章节: 1.6.1 双身份 / 3.1.2 双信用分 / 3.11 账号注销 / 3.10 耍伴专区
// P1: 接云端 user-login, 删除 mock CURRENT_USER 依赖
const redline = require('../../utils/redline.js');
const { maskPhone } = require('../../utils/util.js');
const CONFIG = require('../../config/index.js');
const { CREDIT_LEVEL, normalizeStatus } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

// showModal fail 兜底(部分真机弹窗静默失败时给反馈)
function modalFail() {
  wx.showToast({ title: '弹窗调用失败', icon: 'none' });
}

function getLevel(score) {
  if (!score) return '未开通';
  const lv = CREDIT_LEVEL.find((l) => score >= l.min && score <= l.max);
  return lv ? `${lv.level} ${lv.name}` : '未评级';
}

Page({
  data: {
    // 初始空壳, onLoad 调云端后覆盖
    user: { avatar: '', nickname: '', phone: '', roles: [], is_realname_done: false, user_credit_score: 0, partner_credit_score: 0 },
    identity: 'user',       // user | partner
    userLevel: '',
    partnerLevel: '',
    orderEntries: [
      { key: 'pay', icon: '💳', name: '待支付', count: 0 },
      { key: 'doing', icon: '🧭', name: '进行中', count: 0 },
      { key: 'eval', icon: '⭐', name: '待评价', count: 0 },
      { key: 'after', icon: '🛟', name: '售后', count: 0 }
    ],
    funcList: [
      { key: 'emergency', icon: '🆘', name: '紧急联系人' },
      { key: 'myPublish', icon: '📋', name: '我的发布' },
      { key: 'help', icon: '🎧', name: '联系客服' },
      { key: 'about', icon: 'ℹ️', name: '关于我们' }
    ],
    partnerEntries: [
      { key: 'accept-config', icon: '⚙️', name: '接单配置' },
      { key: 'wallet', icon: '💰', name: '收入钱包' }
    ],
    partnerRecentOrders: [],
    userRecentDemands: [],
    version: CONFIG.VERSION,
    isRedline: false
  },
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  },


  onLoad() {
    this.fetchUser();
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    // 防抖: 距上次 fetchUser > 30s 才刷新, 避免 onLoad+onShow 双拉 ≈10 次云调用
    const now = Date.now();
    if (!this.__lastFetch || (now - this.__lastFetch > 30000)) {
      this.fetchUser();
    }
  },

  fetchUser() {
    this.__lastFetch = Date.now();
    callCloud('user-login', { action: 'peek_login' }).then((r) => {
      if (!r.ok || !r.data || !r.data.user) {
        wx.showToast({ title: r.msg || '登录失败', icon: 'none' });
        return;
      }
      const u = r.data.user;
      const isPartner = (u.roles || []).indexOf('partner') >= 0;
      // 身份粘性: 优先读 storage, 否则按角色默认
      // 如果刚被开通 partner 角色(storage 还是空或 user), 默认切 partner 让用户看到新身份权益
      let identity = wx.getStorageSync('current_identity');
      if (identity === 'partner' && !isPartner) identity = 'user';
      if (identity !== 'partner' && identity !== 'user') {
        identity = isPartner ? 'partner' : 'user';
      }
      // 显式映射, 不透传后端敏感字段(openid 等)
      const uiUser = {
        _id: u._id,
        nickname: u.nickname || '微信用户',
        avatar: (u.avatar && /^https?:/.test(u.avatar)) ? u.avatar : '', // 只接受 http(s) URL, 否则兜底
        phone: maskPhone(u.phone) || '',
        roles: u.roles || [],
        is_realname_done: !!u.is_realname_done,
        user_credit_score: u.user_credit_score || 0,
        partner_credit_score: u.partner_credit_score || 0,
        is_partner: isPartner
      };
      this.setData({
        user: uiUser,
        identity,
        userLevel: getLevel(u.user_credit_score),
        partnerLevel: getLevel(u.partner_credit_score),
        // "我的发布" 仅用户身份有意义(耍伴是接单方)
        funcList: [
          { key: 'notices', icon: '🔔', name: '消息通知', badge: '' },
          { key: 'myBlog', icon: '📝', name: '我的动态' },
          ...(identity === 'partner'
            ? [
                { key: 'blogPublish', icon: '✍️', name: '发布动态' },
                { key: 'emergency', icon: '🆘', name: '紧急联系人' },
                { key: 'help', icon: '🎧', name: '联系客服' },
                { key: 'about', icon: 'ℹ️', name: '关于我们' }
              ]
            : [
                { key: 'emergency', icon: '🆘', name: '紧急联系人' },
                { key: 'myPublish', icon: '📋', name: '我的发布' },
                { key: 'help', icon: '🎧', name: '联系客服' },
                { key: 'about', icon: 'ℹ️', name: '关于我们' }
              ])
        ]
      });
      // 并行拉订单计数(按当前身份过滤)
      this.loadCounts();
    }).catch(() => {
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },

  loadCounts() {
    // 并行拉: 四宫格计数 + 通知未读数
    callCloud('order-action', { action: 'my_counts', role: this.data.identity }).then((cr) => {
      if (!cr || !cr.ok || !cr.data) return;
      const c = cr.data;
      this.setData({
        orderEntries: [
          { key: 'pay', icon: '💳', name: '待支付', count: c.pending_pay || 0 },
          { key: 'doing', icon: '🧭', name: '进行中', count: c.in_progress || 0 },
          { key: 'eval', icon: '⭐', name: '待评价', count: c.pending_eval || 0 },
          { key: 'after', icon: '🛟', name: '售后', count: c.after_sales || 0 }
        ]
      });
    }).catch(() => {});

    // 工作台概览: 耍伴拉承接订单, 用户拉发布需求
    const pad = (n) => n < 10 ? '0' + n : '' + n;
    const fmtDate = (ts) => {
      if (!ts) return '时间待定';
      const d = new Date(ts);
      return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    if (this.data.identity === 'partner') {
      callCloud('order-action', { action: 'my_orders', role: 'partner' }).then((r) => {
        if (!r || !r.ok || !r.data) return;
        const list = (r.data.list || [])
          .filter((o) => o.item_type === 'order')
          .slice(0, 3)
          .map((o) => ({
            order_id: o.order_id,
            scene_name: o.scene_name || o.scene,
            time_str: fmtDate(o.start_time),
            location_name: o.location_name || '地点待确认',
            status: o.status,
            status_name: ({ S1: '待确认', S2: '待履约', S2_5: '改期中', S3: '履约中', S3_5: '中断', S5: '待评价' })[normalizeStatus(o.status)] || o.status,
            total_fen: o.total_fen || 0,
            price_str: Math.round((o.total_fen || 0) / 100)
          }));
        this.setData({ partnerRecentOrders: list });
      }).catch(() => {});
    } else {
      // 用户视角: 合并 my_orders 里的已接单订单 + demand-publish my_demands
      Promise.all([
        callCloud('order-action', { action: 'my_orders', role: 'user' }),
        callCloud('demand-publish', { action: 'my_demands' })
      ]).then(([ordersR, demandsR]) => {
        // 活跃订单: 排除已取消(S6)/已完成(S7)/售后(S10/S10.5)终态
        const ACTIVE_ORDER_STATUSES = ['S0', 'S1', 'S2', 'S2_5', 'S3', 'S3_5', 'S4', 'S5'];
        const orderList = (ordersR && ordersR.ok && ordersR.data && ordersR.data.list || [])
          .filter((o) => o.item_type === 'order' && ACTIVE_ORDER_STATUSES.indexOf(normalizeStatus(o.status)) >= 0)
          .slice(0, 3)
          .map((o) => ({
            item_type: 'order',
            order_id: o.order_id,
            demand_id: o.order_id,
            scene_name: o.scene_name || o.scene,
            time_str: fmtDate(o.start_time),
            location_name: o.location_name || '地点待确认',
            status_name: ({ S0: '待支付', S1: '待确认', S2: '待履约', S2_5: '改期中', S3: '履约中', S3_5: '中断', S5: '待评价' })[o.status] || o.status,
            price_str: Math.round((o.total_fen || 0) / 100)
          }));
        // 活跃需求: 只显示 matching(等待接单) 状态
        const demandList = (demandsR && demandsR.ok && demandsR.data && demandsR.data.list || [])
          .filter((d) => d.status === 'matching')
          .slice(0, 3 - orderList.length)
          .map((d) => ({
            item_type: 'demand',
            demand_id: d._id || d.demand_id,
            scene_name: d.scene_name || d.scene,
            time_str: fmtDate(d.start_time),
            location_name: (d.location && d.location.name) || '地点待确认',
            status_name: '等待接单',
            price_str: d.duration_h ? Math.round(((d.total_fen || 0) / 100) / d.duration_h) : Math.round((d.total_fen || 0) / 100)
          }));
        this.setData({ userRecentDemands: [...orderList, ...demandList].slice(0, 3) });
      }).catch(() => {});
    }
    // 通知未读数(始终拉, 与身份无关)
    callCloud('order-action', { action: 'notice_list', limit: 1 }).then((nr) => {
      if (!nr || !nr.ok) return;
      const unread = nr.data ? nr.data.unread : 0;
      const funcList = this.data.funcList.map((f) => f.key === 'notices' ? { ...f, badge: unread > 0 ? unread : '' } : f);
      this.setData({ notice_unread: unread, funcList });
      // 轻量弹窗提示有新通知 (仅首次从 tabBar 进入"我的"时触发)
      if (unread > 0 && !this._toastNotified) {
        this._toastNotified = true;
        setTimeout(() => wx.showToast({ title: `您有 ${unread} 条新通知`, icon: 'none', duration: 2000 }), 300);
      }
    }).catch(() => {});
  },

  // U1 身份切换
  switchIdentity(e) {
    const target = e.currentTarget.dataset.role;
    if (target === this.data.identity) return;
    if (target === 'partner' && !this.data.user.is_partner) {
      wx.showToast({ title: '请先完成耍伴认证', icon: 'none' });
      return;
    }
    wx.setStorageSync('current_identity', target);
    this.setData({
      identity: target,
      funcList: [
        { key: 'notices', icon: '🔔', name: '消息通知', badge: this.data.notice_unread > 0 ? this.data.notice_unread : '' },
        { key: 'myBlog', icon: '📝', name: '我的动态' },
        ...(target === 'partner'
          ? [
              { key: 'blogPublish', icon: '✍️', name: '发布动态' },
              { key: 'emergency', icon: '🆘', name: '紧急联系人' },
              { key: 'help', icon: '🎧', name: '联系客服' },
              { key: 'about', icon: 'ℹ️', name: '关于我们' }
            ]
          : [
              { key: 'emergency', icon: '🆘', name: '紧急联系人' },
              { key: 'myPublish', icon: '📋', name: '我的发布' },
              { key: 'help', icon: '🎧', name: '联系客服' },
              { key: 'about', icon: 'ℹ️', name: '关于我们' }
            ])
      ]
    });
    this.loadCounts();
    wx.showToast({ title: target === 'partner' ? '已切换为耍伴身份' : '已切换为用户身份', icon: 'none' });
  },

  // U2 信用明细
  onScoreDetail() {
    wx.navigateTo({
      url: '/pages-v2/credit/credit',
      fail: modalFail
    });
  },

  // U3 订单入口(四宫格 → v2 订单列表, 带 tab 过滤与当前身份)
  onOrderEntry(e) {
    const tab = e.currentTarget.dataset.key || 'all';
    const role = this.data.identity === 'partner' ? 'partner' : 'user';
    wx.navigateTo({
      url: `/pages-v2/orders/orders?tab=${tab}&role=${role}`,
      fail: modalFail
    });
  },

  // U4 功能列表(help 项在 wxml 中为 open-type=contact 按钮, 不会进入此处理)
  onFuncTap(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'notices') {
      wx.navigateTo({ url: '/pages-v2/notices/notices', fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' }) });
    } else if (key === 'myBlog') {
      wx.navigateTo({ url: '/pages/blog/blog?scope=my', fail: (err) => { console.error('[profile] nav myBlog fail:', err); wx.showToast({ title: '动态页暂不可用', icon: 'none' }); } });
    } else if (key === 'blogPublish') {
      wx.navigateTo({ url: '/pages/blog-publish/blog-publish', fail: (err) => { console.error('[profile] nav blogPublish fail:', err); wx.showToast({ title: '发布页暂不可用', icon: 'none' }); } });
    } else if (key === 'emergency') {
      wx.navigateTo({ url: '/pages-v2/contacts/contacts', fail: modalFail });
    } else if (key === 'myPublish') {
      wx.navigateTo({ url: '/pages-v2/my-demands/my-demands', fail: modalFail });
    } else if (key === 'about') {
      wx.showModal({
        title: '关于找个人帮忙',
        content: `版本 ${this.data.version}\n安全第一 · 合规先行`,
        showCancel: false,
        fail: modalFail
      });
    }
  },

  // 微信客服会话不可用时的兜底
  onContactError() {
    wx.showToast({ title: '客服会话暂不可用', icon: 'none' });
  },

  // U5 耍伴专区 / 认证引导
  onPartnerEntry(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    if (key === 'myTakeOrders') {
      wx.navigateTo({ url: '/pages-v2/orders/orders?role=partner', fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' }) });
      return;
    }
    wx.navigateTo({
      url: `/pages-v2/${key}/${key}`,
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    });
  },

  // 耍伴工作台 → 订单详情
  goOrderDetail(e) {
    const oid = e.currentTarget.dataset.oid;
    if (!oid) return;
    wx.navigateTo({ url: `/pages-v2/order-detail/order-detail?orderId=${oid}`, fail: () => wx.showToast({ title: '详情页暂不可用', icon: 'none' }) });
  },

  // 用户工作台 → 需求/订单详情(按 item_type 区分跳转)
  goDemandDetail(e) {
    const it = e.currentTarget.dataset.item;
    if (!it) return;
    if (it.item_type === 'order' || it.order_id) {
      wx.navigateTo({ url: `/pages-v2/order-detail/order-detail?orderId=${it.order_id || it.demand_id}`, fail: () => wx.showToast({ title: '详情页暂不可用', icon: 'none' }) });
    } else {
      wx.navigateTo({ url: `/pages-v2/demand-detail/demand-detail?id=${it.demand_id}`, fail: () => wx.showToast({ title: '详情页暂不可用', icon: 'none' }) });
    }
  },

  // 用户工作台空态 → 去发布
  goPublish() {
    wx.navigateTo({ url: '/pages-v2/publish/publish' });
  },
  becomePartner() {
    wx.navigateTo({
      url: '/pages-v2/partner-apply/partner-apply',
      fail: () => wx.showToast({ title: '申请页暂不可用', icon: 'none' })
    });
  },

  // U6 退出登录 (清本地登录态 + 跳登录页)
  onExitLogin() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      confirmText: '退出',
      fail: modalFail,
      success: (res) => {
        if (!res.confirm) return;
        try {
          wx.removeStorageSync('v2_login_ok');
          wx.removeStorageSync('user_info');
          wx.removeStorageSync('partner_local_cfg');
          wx.removeStorageSync('current_identity');
        } catch (e) {}
        wx.showToast({ title: '已退出登录', icon: 'success' });
        setTimeout(() => {
          wx.reLaunch({ url: '/pages-v2/login/login', fail: () => {} });
        }, 800);
      }
    });
  },

  // U6 注销账号(接 user-login close_account: 有进行中订单拒绝; 通过后匿名化+置 closed)
  onLogout() {
    wx.showModal({
      title: '账号注销',
      content: '注销后昵称、头像、手机号等个人信息将被匿名化清除且不可恢复；有进行中订单时需先完结。确认注销吗？',
      confirmText: '确认注销',
      confirmColor: '#fa5151',
      fail: modalFail,
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        callCloud('user-login', { action: 'close_account' }).then((r) => {
          wx.hideLoading();
          if (r.ok) {
            try {
              wx.removeStorageSync('v2_login_ok');
              wx.removeStorageSync('user_info');
              wx.removeStorageSync('partner_local_cfg');
              wx.removeStorageSync('current_identity');
            } catch (e) {}
            wx.showToast({ title: '账号已注销', icon: 'success' });
            setTimeout(() => {
              wx.reLaunch({ url: '/pages-v2/login/login', fail: () => {} });
            }, 800);
          } else {
            // 典型: close_has_active_orders(还有 N 笔进行中订单)
            wx.showToast({ title: r.msg || '注销失败', icon: 'none', duration: 2500 });
          }
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        });
      }
    });
  },
  onReserve() { wx.showModal({ title: 'Rest', content: 'Please stay safe', showCancel: false }); }
});
