// PRD章节: 1.6.1 双身份 / 3.1.2 双信用分 / 3.11 账号注销 / 3.10 耍伴专区
// P1: 接云端 user-login, 删除 mock CURRENT_USER 依赖
const redline = require('../../utils/redline.js');
const { maskPhone } = require('../../utils/util.js');
const CONFIG = require('../../config/index.js');
const { CREDIT_LEVEL, ORDER_STATUS, normalizeStatus } = require('../../config/enums.js');

const { callCloud } = require('../../utils/cloud.js');

// showModal fail 兜底(部分真机弹窗静默失败时给反馈)
function modalFail() {
  wx.showToast({ title: '弹窗调用失败', icon: 'none' });
}

function getLevel(score) {
  if (!score) return '未开通';
  const lv = CREDIT_LEVEL.find((l) => score >= l.min && score <= l.max);
  return lv ? `${lv.level} ${lv.name}` : '未评级';
}

// 菜单单一数据源(2026-10-27 归类改版): 按身份生成分组菜单, 消除多处硬编码漂移
// C 段「学习与资质」仅耍伴可见: 学习中心 → 考试认证 → 实名认证(形成 学习→考试→资质 链路)
function buildMenu(identity, opts) {
  const o = opts || {};
  const items = {
    notices: { key: 'notices', icon: '🔔', name: '消息通知', badge: o.unread > 0 ? o.unread : '' },
    study: { key: 'study', icon: '📚', name: '学习中心' },
    examCert: { key: 'examCert', icon: '🎓', name: '考试认证', badge: o.examBadge || '' },
    realname: { key: 'realname', icon: '🪪', name: '实名认证', badge: o.realnameDone ? '' : '待认证' },
    myBlog: { key: 'myBlog', icon: '📝', name: '我的动态' },
    emergency: { key: 'emergency', icon: '🆘', name: '紧急联系人' },
    help: { key: 'help', icon: '🎧', name: '联系客服' },
    about: { key: 'about', icon: 'ℹ️', name: '关于我们' }
  };
  if (identity === 'partner') {
    return [
      { key: 'growth', title: '学习与资质', items: [items.study, items.examCert, items.realname] },
      { key: 'tools', title: '服务与设置', items: [items.notices, items.myBlog, items.emergency, items.help, items.about] }
    ];
  }
  return [
    { key: 'tools', title: '服务与设置', items: [items.notices, items.realname, items.myBlog, items.emergency, items.help, items.about] }
  ];
}

// 重建菜单(角标变化/身份切换时统一走这里)

Page({
  data: {
    // 初始空壳, onLoad 调云端后覆盖
    user: { avatar: '', nickname: '', phone: '', roles: [], is_realname_done: false, user_credit_score: 0, partner_credit_score: 0 },
    notice_unread: 0,
    identity: 'user',       // user | partner
    userLevel: '',
    partnerLevel: '',
    examBadge: '',          // 考试认证角标(耍伴拉 exam_scores 计算)
    orderEntries: [
      { key: 'pay', icon: '💳', name: '待支付', count: 0 },
      { key: 'doing', icon: '🧭', name: '进行中', count: 0 },
      { key: 'eval', icon: '⭐', name: '待评价', count: 0 },
      { key: 'after', icon: '🛟', name: '售后', count: 0 }
    ],
    menuGroups: [],          // 分组菜单: [{ key, title, items[] }], 由 buildMenu(identity) 生成
    partnerEntries: [
      { key: 'accept-config', icon: '⚙️', name: '接单配置' },
      { key: 'partner-profile-edit', icon: '📝', name: '资料维护' },
      { key: 'wallet', icon: '💰', name: '收入钱包' }
    ],
    partnerRecentOrders: [],
    userRecentDemands: [],
    version: CONFIG.VERSION,
    isRedline: false,
    isGuest: false,         // 未登录访客: 头部改为登录引导卡(2026-10-21 Q2 方案)
    // 耍伴入驻进度卡(2026-10-21): 未满足接单手续时展示, 四步=实名→申请→审核→考试
    onboarding: null,       // { step, status, rejectNote, basePassed, switchOff }
    // P3-18(2026-10-27): 昵称/头像自助编辑弹层
    editOpen: false,
    editSaving: false,
    editNick: '',
    editAvatar: '',         // 弹层内预览(当前头像或新选临时图)
    editAvatarTemp: ''      // 新选图片临时路径, 保存时才上传
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
    try {
      this.setData({ isGuest: !require('../../utils/bootstrap.js').isLoggedIn() });
    } catch (e) {}
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    // 入驻进度卡(独立于 fetchUser 30s 防抖, 审核通过/考完试返回即可见状态变化)
    this.fetchOnboarding();
    // 防抖: 距上次 fetchUser > 30s 才刷新, 避免 onLoad+onShow 双拉 ≈10 次云调用
    const now = Date.now();
    if (!this.__lastFetch || (now - this.__lastFetch > 30000)) {
      this.fetchUser();
    } else {
      // fetchUser 防抖跳过时仍刷新考试角标(考完试返回可即时看到状态变化)
      this.fetchExamBadge();
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
        // 只接受 http(s) URL 或云存储 fileID(cloud://), 否则兜底(防 openid 等脏值渲染)
        avatar: (u.avatar && /^(https?:|cloud:\/\/)/.test(u.avatar)) ? u.avatar : '',
        phone: maskPhone(u.phone) || '',
        roles: u.roles || [],
        is_realname_done: !!u.is_realname_done,
        user_credit_score: u.user_credit_score || 0,
        partner_credit_score: u.partner_credit_score || 0,
        allow_map_share: u.allow_map_share === true,
        is_partner: isPartner
      };
      this.setData({
        user: uiUser,
        identity,
        userLevel: getLevel(u.user_credit_score),
        partnerLevel: getLevel(u.partner_credit_score),
        // 分组菜单(单一数据源): 学习与资质(仅耍伴) + 服务与设置
        menuGroups: buildMenu(identity, {
          unread: this.data.notice_unread,
          realnameDone: uiUser.is_realname_done,
          examBadge: this.data.examBadge
        })
      });
      // 并行拉订单计数(按当前身份过滤)
      this.loadCounts();
      // 耍伴拉考试认证角标
      this.fetchExamBadge();
    }).catch(() => {
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },

  // 耍伴入驻/接单资格进度: 服务端探针一次拿全(实名/申请/审核/考试/开关)
  // 未登录或已可接单时不展示卡片(减少无效 UI)
  fetchOnboarding() {
    let logged = false;
    try { logged = require('../../utils/bootstrap.js').isLoggedIn(); } catch (e) {}
    if (!logged) { this.setData({ onboarding: null }); return; }
    require('../../utils/take-order.js').fetchTakeReadiness('', true).then((rd) => {
      if (!rd || rd.can_take === true) { this.setData({ onboarding: null }); return; }
      const miss = rd.missing || [];
      const first = miss[0] || '';
      // 批3c(2026-10-23): 进度卡改为八步链口径(与 utils/onboard-chain.js 同源), 直达首缺步
      const chain = require('../../utils/onboard-chain.js');
      const key = chain.entryKey(rd);
      const st = chain.stepOf(key) || { index: 1, total: chain.TOTAL, label: '' };
      let status = 'todo';
      if (first === 'reapply') status = 'rejected';
      else if (first === 'review_pending' || key === 'review') status = 'pending';
      else if (rd.profile_status === 'draft') status = 'draft';
      this.setData({
        onboarding: {
          key,
          step8: st.index,
          total: st.total,
          label: st.label,
          status,
          rejectNote: rd.review_note || '',
          basePassed: rd.base_passed !== false,
          switchOff: !rd.accept_switch,
          sceneExam: (miss || []).indexOf('scene_exam') >= 0
        }
      });
    }).catch(() => { this.setData({ onboarding: null }); });
  },

  // 进度卡按钮: 批3c 起统一走进驻链(直达首缺步)
  onOnboardingTap() {
    const ob = this.data.onboarding || {};
    const bs = require('../../utils/bootstrap.js');
    if (ob.key === 'realname') { bs.showRealnameGuide('完成实名认证后即可继续申请耍伴。'); return; }
    if (ob.key === 'review' || ob.status === 'pending') {
      wx.showModal({ title: '申请审核中', content: '已提交，平台通常在 24 小时内完成审核，通过后会自动开通接单权限。', showCancel: false, confirmText: '我知道了' });
      return;
    }
    if (!require('../../utils/onboard-chain.js').open(ob.key)) {
      wx.showToast({ title: '页面暂不可用', icon: 'none' });
    }
  },

  // 考试认证角标: 拉 exam_subjects 科目配置 + exam_scores, 通用计算已通过科数(含前置链)
  fetchExamBadge() {
    if (!this.data.user.is_partner) return;
    Promise.all([
      callCloud('partner-action', { action: 'my_profile' }),
      callCloud('partner-action', { action: 'exam_subjects' }).catch(() => ({ ok: false }))
    ]).then(([r, ex]) => {
      if (!r || !r.ok || !r.data || !r.data.profile) return;
      const s = r.data.profile.exam_scores || {};
      const defs = (ex && ex.ok && ex.data && ex.data.list && ex.data.list.length > 0)
        ? ex.data.list
        : [{ code: 'base', pass_line: 100, requires: [] }, { code: 'W1', pass_line: 100, requires: ['base'] }];
      const passedOf = (code) => {
        const m = defs.find((d) => d.code === code);
        return Number(s[code] || 0) >= (m ? m.pass_line : 100);
      };
      let passed = 0;
      for (const d of defs) {
        const prereqOk = !(d.requires || []).some((rr) => !passedOf(rr));
        if (prereqOk && passedOf(d.code)) passed++;
      }
      const examBadge = passed > 0 ? `已过${passed}科` : '待考试';
      this.setData({
        examBadge,
        menuGroups: buildMenu(this.data.identity, {
          unread: this.data.notice_unread,
          realnameDone: !!(this.data.user && this.data.user.is_realname_done),
          examBadge
        })
      });
    }).catch(() => {});
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
        // my_orders 已按 created_at 倒序且分页; 工作台只取最近 3 条
        const list = (r.data.list || [])
          .filter((o) => o.item_type === 'order')
          .slice(0, 3)
          .map((o) => {
            const st = ORDER_STATUS[normalizeStatus(o.status)];
            return {
              order_id: o.order_id,
              scene_name: o.scene_name || o.scene,
              time_str: fmtDate(o.start_time),
              location_name: o.location_name || '地点待确认',
              status: o.status,
              status_name: st ? st.name : o.status,
              total_fen: o.total_fen || 0,
              price_str: Math.round((o.total_fen || 0) / 100)
            };
          });
        this.setData({ partnerRecentOrders: list });
      }).catch(() => {});
    } else {
      // 用户视角: 展示最近发布的 3 个需求(created_at 倒序), 含自身状态
      callCloud('demand-publish', { action: 'my_demands' }).then((r) => {
        if (!r || !r.ok || !r.data) return;
        const DEMAND_STATUS_NAME = { matching: '等待接单', matched: '已被接单', cancelled: '已取消', expired: '已过期' };
        const list = (r.data.list || [])
          .slice(0, 3)
          .map((d) => ({
            item_type: 'demand',
            demand_id: d._id || d.demand_id,
            scene_name: d.scene_name || d.scene,
            time_str: fmtDate(d.start_time),
            location_name: (d.location && d.location.name) || '地点待确认',
            status: d.status,
            status_name: DEMAND_STATUS_NAME[d.status] || d.status,
            price_str: d.duration_h ? Math.round(((d.total_fen || 0) / 100) / d.duration_h) : Math.round((d.total_fen || 0) / 100)
          }));
        this.setData({ userRecentDemands: list });
      }).catch(() => {});
    }
    // 通知未读数(始终拉, 与身份无关; 放宽超时防冷启动误判)
    callCloud('order-action', { action: 'notice_list', limit: 1 }, { timeout: 12000 }).then((nr) => {
      if (!nr || !nr.ok) return;
      const unread = nr.data ? nr.data.unread : 0;
      this.setData({
        notice_unread: unread,
        menuGroups: buildMenu(this.data.identity, {
          unread,
          realnameDone: !!(this.data.user && this.data.user.is_realname_done),
          examBadge: this.data.examBadge
        })
      });
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
      menuGroups: buildMenu(target, {
        unread: this.data.notice_unread,
        realnameDone: !!(this.data.user && this.data.user.is_realname_done),
        examBadge: this.data.examBadge
      })
    });
    // 切换身份后刷新四宫格计数与考试角标(原实现遗漏: 计数停留在旧身份)
    this.loadCounts();
    this.fetchExamBadge();
    wx.showToast({ title: target === 'partner' ? '已切换为耍伴身份' : '已切换为用户身份', icon: 'none' });
  },

  // U2 信用明细
  onScoreDetail() {
    wx.navigateTo({
      url: '/pages-v2/pkg-low/credit/credit',
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

  // U4 功能列表(help 项跳自建客服会话)
  onFuncTap(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'help') {
      wx.navigateTo({ url: '/pages-v2/pkg-low/kefu/kefu', fail: modalFail });
    } else if (key === 'notices') {
      wx.navigateTo({ url: '/pages-v2/pkg-low/notices/notices', fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' }) });
    } else if (key === 'emergency') {
      wx.navigateTo({ url: '/pages-v2/pkg-low/contacts/contacts', fail: modalFail });
    } else if (key === 'realname') {
      wx.navigateTo({ url: '/pages-v2/pkg-low/realname/realname', fail: modalFail });
    } else if (key === 'examCert') {
      wx.navigateTo({ url: '/pages-v2/pkg-low/exam-status/exam-status', fail: modalFail });
    } else if (key === 'study') {
      wx.navigateTo({ url: '/pages-v2/pkg-low/study/study', fail: modalFail });
    } else if (key === 'myBlog') {
      wx.navigateTo({ url: '/pages-v2/blog/blog?scope=my', fail: modalFail });
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

  // U5 耍伴专区 / 认证引导
  onPartnerEntry(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    if (key === 'myTakeOrders') {
      wx.navigateTo({ url: '/pages-v2/orders/orders?role=partner', fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' }) });
      return;
    }
    // 分包后低频页位于 pkg-low, 动态 key 需经路由表映射(主包页面保持原路径)
    const LOW_PKG_KEYS = { wallet: 1, 'accept-config': 1, 'partner-profile-edit': 1 };
    const urlBase = LOW_PKG_KEYS[key] ? `/pages-v2/pkg-low/${key}/${key}` : `/pages-v2/${key}/${key}`;
    wx.navigateTo({
      url: urlBase,
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    });
  },

  // 耍伴工作台 → 订单详情
  goOrderDetail(e) {
    const oid = e.currentTarget.dataset.oid;
    if (!oid) return;
    wx.navigateTo({ url: `/pages-v2/order-detail/order-detail?orderId=${oid}`, fail: () => wx.showToast({ title: '详情页暂不可用', icon: 'none' }) });
  },

  // 地图找TA: 进入附近地图(位置共享开关在地图页内管理)
  goNearbyMap() {
    wx.navigateTo({ url: '/pages-v2/nearby-map/nearby-map', fail: () => wx.showToast({ title: '地图页暂不可用', icon: 'none' }) });
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

  // 用户工作台空态 → 去发布(访客/未实名先走登录·实名引导)
  goPublish() {
    try {
      const { gateOnboard } = require('../../utils/bootstrap.js');
      if (!gateOnboard('publish', '发布需求')) return;
    } catch (e) {}
    wx.navigateTo({ url: '/pages-v2/publish/publish' });
  },
  // 访客登录引导入口(头部卡片)
  onGuestLogin() {
    try {
      require('../../utils/bootstrap.js').goLogin({ kind: 'partner', label: '使用个人中心', stage: 'login' });
    } catch (e) {
      wx.navigateTo({ url: '/pages-v2/login/login', fail: () => wx.reLaunch({ url: '/pages-v2/login/login' }) });
    }
  },
  becomePartner() {
    try {
      const { gateOnboard } = require('../../utils/bootstrap.js');
      if (!gateOnboard('partner', '申请成为耍伴')) return;
    } catch (e) {}
    wx.navigateTo({
      url: '/pages-v2/pkg-low/partner-apply/partner-apply',
      fail: () => wx.showToast({ title: '申请页暂不可用', icon: 'none' })
    });
  },

  // P3-18(2026-10-27): 昵称/头像自助编辑(此前 update_profile 云函数存在但前端零入口)
  onEditProfile() {
    const u = this.data.user || {};
    const nick = String(u.nickname || '');
    this.setData({
      editOpen: true,
      editSaving: false,
      editNick: nick === '微信用户' ? '',   // 默认昵称视为未设置, 直接给出空输入框
      editAvatar: u.avatar || '',
      editAvatarTemp: ''
    });
  },
  onEditClose() {
    if (this.data.editSaving) return;
    this.setData({ editOpen: false });
  },
  onSheetTap() {},   // 阻止点击弹层内部冒泡到遮罩
  onNickInput(e) {
    this.setData({ editNick: e.detail.value });
  },
  onPickAvatar() {
    if (this.data.editSaving) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f || !f.tempFilePath) return;
        this.setData({ editAvatar: f.tempFilePath, editAvatarTemp: f.tempFilePath });
      },
      fail: () => {}
    });
  },
  // 保存: 新头像先传云存储取 fileID, 再调 update_profile(昵称过服务端安全检测)
  onEditSave() {
    if (this.data.editSaving) return;
    const nick = String(this.data.editNick || '').trim();
    const temp = this.data.editAvatarTemp;
    if (!nick && !temp) {
      wx.showToast({ title: '请填写昵称或更换头像', icon: 'none' });
      return;
    }
    if (nick.length > 20) {
      wx.showToast({ title: '昵称长度需 1-20 字', icon: 'none' });
      return;
    }
    this.setData({ editSaving: true });
    const submit = (avatarFileID) => {
      const payload = { action: 'update_profile' };
      if (nick) payload.nickname = nick;
      if (avatarFileID) payload.avatar = avatarFileID;
      callCloud('user-login', payload).then((r) => {
        this.setData({ editSaving: false });
        if (!r || !r.ok) {
          wx.showToast({ title: (r && r.msg) || '保存失败', icon: 'none' });
          return;
        }
        this.setData({ editOpen: false, editAvatarTemp: '' });
        wx.showToast({ title: '资料已更新', icon: 'success' });
        this.fetchUser();   // 直接刷新, 绕过 onShow 的 30s 防抖
      }).catch(() => {
        this.setData({ editSaving: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      });
    };
    if (!temp) { submit(''); return; }
    const m = /\.(\w+)$/.exec(temp);
    const ext = m ? m[1].toLowerCase() : 'jpg';
    wx.showLoading({ title: '上传中', mask: true });
    wx.cloud.uploadFile({
      cloudPath: `avatar/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`,
      filePath: temp
    }).then((up) => {
      wx.hideLoading();
      submit((up && up.fileID) || '');
    }).catch(() => {
      wx.hideLoading();
      this.setData({ editSaving: false });
      wx.showToast({ title: '头像上传失败,请重试', icon: 'none' });
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
          wx.removeStorageSync('userInfo');
          wx.removeStorageSync('partner_local_cfg');
          wx.removeStorageSync('current_identity');
        } catch (e) {}
        // 同步 globalData, 避免退出后 bootstrap.isLoggedIn() 短暂仍返回 true (clearLoginUser 已存在于 app.js L120)
        try { getApp().clearLoginUser(); } catch (e) {}
        // 导航先行、反馈后置: toast 放 success 回调, 消灭「toast+导航」竞态(灰度基础库回归过)
        wx.reLaunch({
          url: '/pages-v2/login/login',
          success: () => wx.showToast({ title: '已退出登录', icon: 'success' }),
          fail: (err) => {
            console.error('[profile] reLaunch login fail:', err && err.errMsg);
            wx.showToast({ title: '已退出登录', icon: 'success' });
          }
        });
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
              wx.removeStorageSync('userInfo');
              wx.removeStorageSync('partner_local_cfg');
              wx.removeStorageSync('current_identity');
            } catch (e) {}
            // 同步 globalData, 避免注销后 bootstrap.isLoggedIn() 短暂仍返回 true
            try { getApp().clearLoginUser(); } catch (e) {}
            // 导航先行、反馈后置: toast 放 success 回调, 消灭「toast+导航」竞态(灰度基础库回归过)
            wx.reLaunch({
              url: '/pages-v2/login/login',
              success: () => wx.showToast({ title: '账号已注销', icon: 'success' }),
              fail: (err) => {
                console.error('[profile] reLaunch login fail:', err && err.errMsg);
                wx.showToast({ title: '账号已注销', icon: 'success' });
              }
            });
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
  onReserve() { require('../../utils/redline.js').reserveNotice(); }
});
