// pages/admin/admin.js - 管理后台 V2(九模块: 看板/用户/耍伴/需求/订单/财务/风控/配置/管理员)
// 进入即调 dashboard 校验身份: 非管理员显示无权限; 白名单为空时首个用户可自助初始化。
// 所有写操作均 wx.showModal 二次确认; 备注/原因类输入用 editable modal。
// WXML 仅做属性访问与三元: 状态名/颜色 class/布尔标记/文本拼接全部在本文件预处理。
const { formatMoney } = require('../../utils/util.js');
const { ORDER_STATUS, SCENE_LIST } = require('../../utils/constants.js');
const app = getApp();

const PAGE_TABS = [
  { key: 'dash', name: '看板' },
  { key: 'user', name: '用户' },
  { key: 'partner', name: '耍伴' },
  { key: 'demand', name: '需求' },
  { key: 'order', name: '订单' },
  { key: 'finance', name: '财务' },
  { key: 'risk', name: '风控' },
  { key: 'blog', name: '动态' },
  { key: 'config', name: '配置' },
  { key: 'admin', name: '管理员' }
];

const USER_STATUS_OPTS = [
  { code: '', name: '全部状态' },
  { code: 'normal', name: '正常' },
  { code: 'frozen', name: '冻结' },
  { code: 'banned', name: '封禁' },
  { code: 'closed', name: '已注销' }
];
const USER_PARTNER_OPTS = [
  { code: '', name: '全部身份' },
  { code: '1', name: '仅耍伴' }
];
const USER_SORT_OPTS = [
  { code: 'new', name: '最新注册' },
  { code: 'credit', name: '信用分优先' }
];
const PARTNER_STATUS_OPTS = [
  { code: '', name: '全部状态' },
  { code: 'pending_review', name: '待审核' },
  { code: 'approved', name: '已通过' },
  { code: 'rejected', name: '已驳回' }
];
const DEMAND_SCENE_OPTS = [{ code: '', name: '全部场景' }].concat(
  SCENE_LIST.map((s) => ({ code: s.code, name: s.icon + ' ' + s.name }))
);
const DEMAND_STATUS_OPTS = [
  { code: '', name: '全部状态' },
  { code: 'matching', name: '匹配中' },
  { code: 'matched', name: '已匹配' },
  { code: 'expired', name: '已过期' },
  { code: 'cancelled', name: '已取消' }
];
const ORDER_STATUS_OPTS = [{ code: '', name: '全部状态' }].concat(
  Object.keys(ORDER_STATUS).map((k) => ({ code: ORDER_STATUS[k].code, name: ORDER_STATUS[k].code + ' ' + ORDER_STATUS[k].name }))
);
const FIN_TYPE_OPTS = [
  { code: '', name: '全部类型' },
  { code: 'pay', name: '支付' },
  { code: 'refund', name: '退款' },
  { code: 'tip', name: '打赏' }
];
const FIN_STATUS_OPTS = [
  { code: '', name: '全部状态' },
  { code: 'success', name: '成功' }
];
const REPORT_STATUS_OPTS = [
  { code: '', name: '全部' },
  { code: 'active', name: '处理中' },
  { code: 'resolved', name: '已解决' },
  { code: 'done', name: '已结束' }
];
const EVENT_LEVEL_OPTS = [
  { code: '', name: '全部级别' },
  { code: 'P0', name: 'P0 紧急' },
  { code: 'P1', name: 'P1 安全' },
  { code: 'P2', name: 'P2 运营' },
  { code: 'P3', name: 'P3 异常' }
];

const USER_STATUS_TEXT = { normal: '正常', frozen: '冻结', banned: '封禁', closed: '已注销' };
const PARTNER_STATUS_TEXT = { pending_review: '待审核', approved: '已通过', rejected: '已驳回' };
const DEMAND_STATUS_TEXT = { matching: '匹配中', matched: '已匹配', expired: '已过期', cancelled: '已取消' };
const TX_TYPE_TEXT = { pay: '支付', refund: '退款', tip: '打赏' };
const CONFIRM_KEY_TEXT = { time: '服务时间', location: '服务地点', content: '服务内容', fee: '费用明细' };
const BLOG_STATUS_OPTS = [
  { code: '', name: '全部状态' },
  { code: 'normal', name: '正常' },
  { code: 'offline', name: '已下架' },
  { code: 'deleted', name: '已删除' }
];
const BLOG_STATUS_TEXT = { normal: '正常', offline: '已下架', deleted: '已删除' };
const BLOG_SCENE_MAP = {};
SCENE_LIST.forEach((s) => { BLOG_SCENE_MAP[s.code] = s.icon + ' ' + s.name; });

Page({
  data: {
    bootState: 'loading',   // loading / admin / empty / forbidden
    activeTab: 'dash',
    tabs: PAGE_TABS,
    badges: { partner: 0, order: 0, risk: 0 },
    selfOpenid: '',

    // ① 看板
    dash: null,
    trendRows: [],

    // ② 用户
    userKw: '',
    userStatusIdx: 0, userStatusOpts: USER_STATUS_OPTS,
    userPartnerIdx: 0, userPartnerOpts: USER_PARTNER_OPTS,
    userSortIdx: 0, userSortOpts: USER_SORT_OPTS,
    users: [], userPage: 0, userHasMore: false, userLoading: false, userTotal: 0,
    userDetail: null,

    // ③ 耍伴
    partnerStatusIdx: 0, partnerStatusOpts: PARTNER_STATUS_OPTS,
    partners: [], partnerPage: 0, partnerHasMore: false, partnerLoading: false, partnerTotal: 0,
    partnerDetail: null,

    // ④ 需求
    demandKw: '',
    demandSceneIdx: 0, demandSceneOpts: DEMAND_SCENE_OPTS,
    demandStatusIdx: 0, demandStatusOpts: DEMAND_STATUS_OPTS,
    demands: [], demandPage: 0, demandHasMore: false, demandLoading: false, demandTotal: 0,

    // ⑤ 订单
    orderKw: '',
    orderStatusIdx: 0, orderStatusOpts: ORDER_STATUS_OPTS,
    orders: [], orderPage: 0, orderHasMore: false, orderLoading: false, orderTotal: 0,
    orderDetail: null,
    disputes: [],

    // ⑥ 财务
    finTypeIdx: 0, finTypeOpts: FIN_TYPE_OPTS,
    finStatusIdx: 0, finStatusOpts: FIN_STATUS_OPTS,
    finances: [], finPage: 0, finHasMore: false, finLoading: false, finTotal: 0,

    // ⑦ 风控
    reportStatusIdx: 0, reportStatusOpts: REPORT_STATUS_OPTS,
    reports: [], reportPage: 0, reportHasMore: false, reportLoading: false,
    eventLevelIdx: 0, eventLevelOpts: EVENT_LEVEL_OPTS,
    events: [], eventPage: 0, eventHasMore: false, eventLoading: false,

    // ⑦.5 服务动态
    blogStatusIdx: 0, blogStatusOpts: BLOG_STATUS_OPTS,
    blogs: [], blogPage: 0, blogHasMore: false, blogLoading: false, blogTotal: 0,
    blogCommentVisible: false, blogCommentPostId: '', blogCommentPostTitle: '',
    blogComments: [], blogCommentLoading: false, blogCommentEmpty: false,

    // ⑧ 配置
    cfg: null,
    cfgSceneOpts: [],
    feeInput: '',
    wordInput: '', cityInput: '',
    tmoInputs: { s0: '', s1: '', interrupt: '', eval: '' },
    creditInputs: { take: '', place: '', freeze: '' },
    rateInputs: { min: '', max: '' },
    cfgSceneIdx: 0, sceneOptInput: '', tplInput: '',

    // ⑨ 管理员
    admins: [], adminInput: '',
    banOpenid: '', banReason: '', unbanOpenid: ''
  },

  onLoad() {
    const ui = app.globalData && app.globalData.userInfo;
    this.setData({ selfOpenid: (ui && ui.openid) || '' });
    this.boot();
  },

  onPullDownRefresh() {
    this.reloadActiveTab();
  },

  // ───────── 基础工具 ─────────
  call(action, data) {
    return new Promise((resolve) => {
      wx.cloud.callFunction({
        name: 'admin-action',
        data: Object.assign({ action }, data || {}),
        success: (res) => resolve(res.result),
        fail: () => resolve({ ok: false, msg: '网络异常，请重试' })
      });
    });
  },

  toast(msg, icon) {
    wx.showToast({ title: msg || '操作失败', icon: icon || 'none' });
  },

  // 空事件占位(弹层 catchtap 阻止冒泡)
  noop() {},

  // 二次确认弹窗; editable=true 时 cb 接收输入文本
  confirm(title, content, opts, cb) {
    const o = opts || {};
    wx.showModal({
      title,
      content,
      editable: !!o.editable,
      placeholderText: o.placeholder || '',
      confirmText: o.confirmText || '确认',
      confirmColor: o.danger ? '#d9534f' : '#D4875A',
      success: (res) => {
        if (!res.confirm) return;
        cb(o.editable ? (res.content || '') : '');
      }
    });
  },

  fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => n < 10 ? '0' + n : '' + n;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },
  shortOpenid(o) {
    if (!o) return '';
    return o.length > 12 ? o.slice(0, 10) + '…' : o;
  },
  sceneName(code) {
    const s = SCENE_LIST.find((x) => x.code === code);
    return s ? s.icon + s.name : (code || '');
  },
  orderStatus(code) {
    const key = code === 'S3.5' ? 'S3_5' : (code === 'S10.5' ? 'S10_5' : code);
    const st = ORDER_STATUS[key];
    return st ? { name: code + ' ' + st.name, cls: 'st-' + st.color } : { name: code || '', cls: 'st-muted' };
  },
  creditCls(score) {
    const s = Number(score) || 0;
    if (s >= 800) return 'credit-high';
    if (s >= 600) return 'credit-mid';
    return 'credit-low';
  },

  // ───────── 启动鉴权 ─────────
  async boot() {
    this.setData({ bootState: 'loading' });
    const r = await this.call('dashboard');
    if (r && r.ok) {
      this.setData({ bootState: 'admin' });
      this.decoDash(r.data);
      this.loadDisputes();
    } else if (r && r.code === 'admin_empty') {
      this.setData({ bootState: 'empty' });
    } else {
      this.setData({ bootState: 'forbidden' });
    }
  },

  claimAdmin() {
    this.confirm('初始化管理员', '当前后台未配置管理员。确认将当前微信账号初始化为管理员吗？（仅此一次，操作会被记录）', { confirmText: '初始化' }, async () => {
      const r = await this.call('claim_admin');
      if (r && r.ok) {
        this.toast('初始化成功', 'success');
        this.boot();
      } else {
        this.toast((r && r.msg) || '初始化失败');
      }
    });
  },

  decoDash(d) {
    const maxGmv = Math.max.apply(null, d.trend.gmv_fen.concat([1]));
    const trendRows = d.trend.days.map((day, i) => ({
      label: day.slice(5).replace('-', '/'),
      users: d.trend.users[i],
      demands: d.trend.demands[i],
      orders: d.trend.orders[i],
      gmvText: formatMoney(d.trend.gmv_fen[i]),
      barH: Math.max(6, Math.round(d.trend.gmv_fen[i] / maxGmv * 100))
    }));
    this.setData({
      dash: {
        user_count: d.user_count,
        partner_count: d.partner_count,
        today_demand_count: d.today_demand_count,
        active_order_count: d.active_order_count,
        pending_review_count: d.pending_review_count,
        dispute_count: d.dispute_count,
        gmvText: formatMoney(d.gmv_fen),
        todo: d.todo,
        finGmvText: formatMoney(d.finance.gmv_fen),
        finRefundText: formatMoney(d.finance.refund_fen),
        finTipText: formatMoney(d.finance.tip_fen),
        finFeeText: formatMoney(d.finance.fee_fen)
      },
      trendRows,
      badges: {
        partner: d.todo.pending_review || 0,
        order: d.todo.dispute || 0,
        risk: d.todo.report_active || 0
      },
      tabs: this.data.tabs.map((t) => ({
        key: t.key,
        name: t.name,
        cls: t.key === this.data.activeTab ? 'tab-on' : '',
        badge: t.key === 'partner' ? (d.todo.pending_review || 0)
          : t.key === 'order' ? (d.todo.dispute || 0)
          : t.key === 'risk' ? (d.todo.report_active || 0) : 0
      }))
    });
  },

  async loadDash() {
    const r = await this.call('dashboard');
    if (r && r.ok) this.decoDash(r.data);
  },

  // ───────── Tab 切换 ─────────
  switchTab(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.activeTab) return;
    this.setData({
      activeTab: key,
      tabs: this.data.tabs.map((t) => Object.assign({}, t, { cls: t.key === key ? 'tab-on' : '' }))
    });
    this.ensureTabLoaded(key);
  },

  ensureTabLoaded(key) {
    if (key === 'dash' && !this.data.dash) this.loadDash();
    else if (key === 'user' && !this.data.users.length && !this.data.userLoading) this.loadUsers(true);
    else if (key === 'partner' && !this.data.partners.length && !this.data.partnerLoading) this.loadPartners(true);
    else if (key === 'demand' && !this.data.demands.length && !this.data.demandLoading) this.loadDemands(true);
    else if (key === 'order' && !this.data.orders.length && !this.data.orderLoading) this.loadOrders(true);
    else if (key === 'finance' && !this.data.finances.length && !this.data.finLoading) this.loadFinance(true);
    else if (key === 'risk' && !this.data.reports.length && !this.data.reportLoading) { this.loadReports(true); this.loadEvents(true); }
    else if (key === 'blog' && !this.data.blogs.length && !this.data.blogLoading) this.loadBlogs(true);
    else if (key === 'config' && !this.data.cfg) this.loadConfig();
    else if (key === 'admin' && !this.data.admins.length) this.loadAdmins();
  },

  reloadActiveTab() {
    const key = this.data.activeTab;
    if (key === 'dash') this.loadDash();
    else if (key === 'user') this.loadUsers(true);
    else if (key === 'partner') this.loadPartners(true);
    else if (key === 'demand') this.loadDemands(true);
    else if (key === 'order') { this.loadOrders(true); this.loadDisputes(); }
    else if (key === 'finance') this.loadFinance(true);
    else if (key === 'risk') { this.loadReports(true); this.loadEvents(true); }
    else if (key === 'blog') this.loadBlogs(true);
    else if (key === 'config') this.loadConfig();
    else if (key === 'admin') this.loadAdmins();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    const key = this.data.activeTab;
    if (key === 'user' && this.data.userHasMore) this.loadUsers(false);
    else if (key === 'partner' && this.data.partnerHasMore) this.loadPartners(false);
    else if (key === 'demand' && this.data.demandHasMore) this.loadDemands(false);
    else if (key === 'order' && this.data.orderHasMore) this.loadOrders(false);
    else if (key === 'finance' && this.data.finHasMore) this.loadFinance(false);
    else if (key === 'blog' && this.data.blogHasMore) this.loadBlogs(false);
  },

  // ───────── ② 用户管理 ─────────
  decoUser(u) {
    const roles = u.roles || [];
    return Object.assign({}, u, {
      openidShort: this.shortOpenid(u.openid),
      creditCls: this.creditCls(u.user_credit_score),
      creditTagCls: this.creditTagCls(u.user_credit_score),
      statusText: USER_STATUS_TEXT[u.status] || u.status,
      statusTagCls: u.status === 'normal' ? 'tag-success' : 'tag-danger',
      isPartner: roles.indexOf('partner') >= 0,
      isNormal: u.status === 'normal',
      isFrozen: u.status === 'frozen',
      isBanned: u.status === 'banned',
      isClosed: u.status === 'closed',
      realText: u.is_realname_done ? '🛡️ 已实名' : '未实名',
      createdText: this.fmtTime(u.created_at)
    });
  },

  // 信用分 → 标签颜色 class(与 creditCls 文本色对应)
  creditTagCls(score) {
    const s = Number(score) || 0;
    if (s >= 800) return 'tag-success';
    if (s >= 600) return 'tag-warn';
    return 'tag-danger';
  },

  async loadUsers(reset) {
    if (this.data.userLoading) return;
    const doReset = reset === true;
    const page = doReset ? 1 : this.data.userPage + 1;
    this.setData({ userLoading: true });
    const r = await this.call('user_list', {
      page,
      keyword: this.data.userKw.trim(),
      status: this.data.userStatusOpts[this.data.userStatusIdx].code,
      is_partner: this.data.userPartnerIdx === 1 ? true : undefined,
      sort: this.data.userSortIdx === 1 ? 'credit' : 'new'
    });
    this.setData({ userLoading: false });
    if (r && r.ok) {
      const rows = (r.data.list || []).map(this.decoUser.bind(this));
      this.setData({
        users: doReset ? rows : this.data.users.concat(rows),
        userPage: page, userHasMore: r.data.has_more, userTotal: r.data.total
      });
    } else this.toast(r && r.msg);
  },

  onUserKwInput(e) { this.setData({ userKw: e.detail.value }); },
  onUserStatusChange(e) { this.setData({ userStatusIdx: Number(e.detail.value) }); },
  onUserPartnerChange(e) { this.setData({ userPartnerIdx: Number(e.detail.value) }); },
  onUserSortChange(e) { this.setData({ userSortIdx: Number(e.detail.value) }); },
  searchUsers() { this.loadUsers(true); },

  async openUserDetail(e) {
    const openid = e.currentTarget.dataset.openid;
    wx.showLoading({ title: '加载中' });
    const r = await this.call('user_detail', { target_openid: openid });
    wx.hideLoading();
    if (!r || !r.ok) { this.toast(r && r.msg); return; }
    const d = r.data;
    const u = d.user;
    const logs = (d.credit_logs || []).map((l) => ({
      typeText: l.type === 'admin_adjust' ? '人工调整' : (l.is_system ? '系统变动' : '交易变动'),
      scoreTypeText: l.score_type === 'partner' ? '耍伴' : '发单',
      deltaText: (l.delta > 0 ? '+' : '') + l.delta,
      deltaCls: l.delta > 0 ? 'credit-high' : 'credit-low',
      score: l.score,
      reason: l.reason || '',
      timeText: this.fmtTime(l.created_at)
    }));
    this.setData({
      userDetail: {
        user: Object.assign({}, u, {
          openidShort: this.shortOpenid(u.openid),
          creditCls: this.creditCls(u.user_credit_score),
          partnerCreditCls: this.creditCls(u.partner_credit_score),
          statusText: USER_STATUS_TEXT[u.status] || u.status,
          statusTagCls: u.status === 'normal' ? 'tag-success' : 'tag-danger',
          isPartner: (u.roles || []).indexOf('partner') >= 0,
          isFrozen: u.status === 'frozen',
          isBanned: u.status === 'banned',
          isNormal: u.status === 'normal',
          realText: u.is_realname_done ? '🛡️ 已实名' : '未实名',
          createdText: this.fmtTime(u.created_at)
        }),
        partner: d.partner ? {
          statusText: PARTNER_STATUS_TEXT[d.partner.status] || d.partner.status,
          scenesText: (d.partner.accept_scenes || []).join('、'),
          onlineText: d.partner.accept_switch ? '接单中' : '已停止接单'
        } : null,
        ec: d.emergency_contact,
        stats: d.stats,
        logs
      }
    });
  },
  closeUserDetail() { this.setData({ userDetail: null }); },

  onFreezeToggle(e) {
    const { openid, nickname, freeze } = e.currentTarget.dataset;
    const isFreeze = freeze === '1' || freeze === true;
    this.confirm(
      isFreeze ? '冻结用户' : '解冻用户',
      isFreeze ? `确认冻结「${nickname}」吗？冻结后其发单与接单均被拦截。` : `确认解除「${nickname}」的冻结吗？`,
      isFreeze ? { editable: true, placeholder: '冻结原因（可选，留档）', danger: true } : { confirmText: '解冻' },
      async (text) => {
        const r = await this.call(isFreeze ? 'user_freeze' : 'user_unfreeze', {
          target_openid: openid, reason: (text || '').trim()
        });
        if (r && r.ok) {
          this.toast(isFreeze ? '已冻结' : '已解冻', 'success');
          this.refreshUserSide(openid);
        } else this.toast(r && r.msg);
      }
    );
  },

  onBanToggle(e) {
    const { openid, nickname, ban } = e.currentTarget.dataset;
    const isBan = ban === '1' || ban === true;
    if (!isBan) {
      this.confirm('解封用户', `确认解除「${nickname}」的封禁吗？`, { confirmText: '解封' }, async () => {
        const r = await this.call('user_unban', { target_openid: openid });
        if (r && r.ok) { this.toast('已解封', 'success'); this.refreshUserSide(openid); }
        else this.toast(r && r.msg);
      });
      return;
    }
    this.confirm('封禁用户', `确认封禁「${nickname}」吗？封禁后无法登录、发单与接单。`, {
      editable: true, placeholder: '封禁原因（必填，留档）', danger: true, confirmText: '封禁'
    }, (text) => {
      const reason = (text || '').trim();
      if (!reason) { this.toast('请填写封禁原因'); return; }
      this.confirm('再次确认封禁', `封禁原因：${reason}\n该操作会被记录，确认执行？`, { danger: true, confirmText: '确认封禁' }, async () => {
        const r = await this.call('user_ban', { target_openid: openid, reason });
        if (r && r.ok) { this.toast('已封禁', 'success'); this.refreshUserSide(openid); }
        else this.toast(r && r.msg);
      });
    });
  },

  onCreditAdjust(e) {
    const { openid, nickname, type } = e.currentTarget.dataset;
    const typeText = type === 'partner' ? '耍伴信用分' : '发单信用分';
    this.confirm('调整' + typeText, `对「${nickname}」的${typeText}进行人工调整（单次 -100 ~ +100）。`, {
      editable: true, placeholder: '调整分值，如 +10 或 -15'
    }, (text1) => {
      const delta = parseInt(text1, 10);
      if (!Number.isInteger(delta) || delta === 0 || delta < -100 || delta > 100) {
        this.toast('分值须为 -100 ~ 100 的非零整数');
        return;
      }
      this.confirm('调整原因', '该调整将记入信用流水并留痕。', {
        editable: true, placeholder: '调整原因（必填）'
      }, (text2) => {
        const reason = (text2 || '').trim();
        if (!reason) { this.toast('请填写调整原因'); return; }
        this.confirm('确认调整', `${typeText} ${delta > 0 ? '+' : ''}${delta} 分\n原因：${reason}`, {
          confirmText: '确认调整'
        }, async () => {
          const r = await this.call('user_credit_adjust', {
            target_openid: openid, score_type: type, delta, reason
          });
          if (r && r.ok) {
            this.toast(`已调整：${r.data.before} → ${r.data.after}`, 'success');
            this.refreshUserSide(openid);
          } else this.toast(r && r.msg);
        });
      });
    });
  },

  async refreshUserSide(openid) {
    this.loadUsers(true);
    if (this.data.userDetail) {
      await this.openUserDetail({ currentTarget: { dataset: { openid: openid || this.data.userDetail.user.openid } } });
    }
    this.loadDash();
  },

  // ───────── ③ 耍伴管理 ─────────
  decoPartner(p) {
    const u = p.user || {};
    return Object.assign({}, p, {
      openidShort: this.shortOpenid(p.openid),
      statusText: PARTNER_STATUS_TEXT[p.status] || p.status,
      scenesText: (p.accept_scenes || []).join('、') || '未设置',
      isPending: p.status === 'pending_review',
      isApproved: p.status === 'approved',
      isRejected: p.status === 'rejected',
      appliedText: this.fmtTime(p.applied_at),
      userCredit: u.user_credit_score || 800,
      userCreditCls: this.creditCls(u.user_credit_score || 800),
      userStatusText: USER_STATUS_TEXT[u.status] || '',
      onlineText: p.accept_switch ? '接单中' : '已停接'
    });
  },

  async loadPartners(reset) {
    if (this.data.partnerLoading) return;
    const doReset = reset === true;
    const page = doReset ? 1 : this.data.partnerPage + 1;
    this.setData({ partnerLoading: true });
    const r = await this.call('partner_list', {
      page,
      status: this.data.partnerStatusOpts[this.data.partnerStatusIdx].code
    });
    this.setData({ partnerLoading: false });
    if (r && r.ok) {
      const rows = (r.data.list || []).map(this.decoPartner.bind(this));
      this.setData({
        partners: doReset ? rows : this.data.partners.concat(rows),
        partnerPage: page, partnerHasMore: r.data.has_more, partnerTotal: r.data.total
      });
    } else this.toast(r && r.msg);
  },

  onPartnerStatusChange(e) { this.setData({ partnerStatusIdx: Number(e.detail.value) }); },
  searchPartners() { this.loadPartners(true); },

  async openPartnerDetail(e) {
    const openid = e.currentTarget.dataset.openid;
    wx.showLoading({ title: '加载中' });
    const r = await this.call('partner_detail', { target_openid: openid });
    wx.hideLoading();
    if (!r || !r.ok) { this.toast(r && r.msg); return; }
    const d = r.data;
    const p = d.profile;
    const u = d.user || {};
    this.setData({
      partnerDetail: {
        profile: Object.assign({}, p, {
          openidShort: this.shortOpenid(p.openid),
          statusText: PARTNER_STATUS_TEXT[p.status] || p.status,
          scenesText: (p.accept_scenes || []).join('、') || '未设置',
          cityText: (p.city || []).join('、') || '未设置',
          isPending: p.status === 'pending_review',
          isApproved: p.status === 'approved',
          online: !!p.accept_switch,
          onlineText: p.accept_switch ? '🟢 接单中' : '🔴 已停止接单',
          appliedText: this.fmtTime(p.applied_at),
          reviewedText: this.fmtTime(p.reviewed_at)
        }),
        user: {
          nickname: u.nickname || '',
          statusText: USER_STATUS_TEXT[u.status] || '',
          userCredit: u.user_credit_score || 800,
          userCreditCls: this.creditCls(u.user_credit_score || 800),
          partnerCredit: u.partner_credit_score || 800,
          partnerCreditCls: this.creditCls(u.partner_credit_score || 800),
          realText: u.is_realname_done ? '🛡️ 已实名' : '未实名',
          phone: u.phone || ''
        },
        stats: d.stats,
        avgStarText: d.stats.avg_star ? d.stats.avg_star.toFixed(1) : '暂无'
      }
    });
  },
  closePartnerDetail() { this.setData({ partnerDetail: null }); },

  onReview(e) {
    const { openid, nickname, decision } = e.currentTarget.dataset;
    const approve = decision === 'approve';
    this.confirm(
      approve ? '通过耍伴申请' : '驳回耍伴申请',
      `确认${approve ? '通过' : '驳回'}「${nickname}」的耍伴申请吗？`,
      { editable: true, placeholder: '审核备注（可选）', danger: !approve, confirmText: approve ? '通过' : '驳回' },
      async (text) => {
        const r = await this.call('review', { target_openid: openid, decision, note: (text || '').trim() });
        if (r && r.ok) {
          this.toast(approve ? '已通过' : '已驳回', 'success');
          this.loadPartners(true);
          this.loadDash();
          if (this.data.partnerDetail) this.setData({ partnerDetail: null });
        } else this.toast(r && r.msg);
      }
    );
  },

  onPartnerSwitch(e) {
    const { openid, nickname, online } = e.currentTarget.dataset;
    const goOnline = online === '1' || online === true;
    this.confirm(
      goOnline ? '恢复接单' : '停止接单',
      goOnline ? `确认恢复「${nickname}」的接单资格吗？` : `确认强制「${nickname}」停止接单吗？（不影响其发单）`,
      goOnline ? { confirmText: '恢复' } : { editable: true, placeholder: '下架原因（可选，留档）', danger: true, confirmText: '停止接单' },
      async (text) => {
        const r = await this.call(goOnline ? 'partner_online' : 'partner_offline', {
          target_openid: openid, reason: (text || '').trim()
        });
        if (r && r.ok) {
          this.toast(goOnline ? '已恢复' : '已停止接单', 'success');
          this.loadPartners(true);
          if (this.data.partnerDetail) {
            this.openPartnerDetail({ currentTarget: { dataset: { openid } } });
          }
        } else this.toast(r && r.msg);
      }
    );
  },

  // ───────── ④ 需求管理 ─────────
  decoDemand(d) {
    return Object.assign({}, d, {
      sceneText: this.sceneName(d.scene),
      statusText: DEMAND_STATUS_TEXT[d.status] || d.status,
      isMatching: d.status === 'matching',
      optionsText: (d.content_options || []).join('、'),
      rateText: formatMoney(d.rate_fen),
      totalText: formatMoney(d.total_fen),
      timeText: this.fmtTime(d.start_time),
      createdText: this.fmtTime(d.created_at),
      creatorShort: this.shortOpenid(d.creator_openid),
      modeText: d.broadcast ? '广场广播' : '定向邀约'
    });
  },

  async loadDemands(reset) {
    if (this.data.demandLoading) return;
    const doReset = reset === true;
    const page = doReset ? 1 : this.data.demandPage + 1;
    this.setData({ demandLoading: true });
    const r = await this.call('demand_list', {
      page,
      keyword: this.data.demandKw.trim(),
      scene: this.data.demandSceneOpts[this.data.demandSceneIdx].code,
      status: this.data.demandStatusOpts[this.data.demandStatusIdx].code
    });
    this.setData({ demandLoading: false });
    if (r && r.ok) {
      const rows = (r.data.list || []).map(this.decoDemand.bind(this));
      this.setData({
        demands: doReset ? rows : this.data.demands.concat(rows),
        demandPage: page, demandHasMore: r.data.has_more, demandTotal: r.data.total
      });
    } else this.toast(r && r.msg);
  },

  onDemandKwInput(e) { this.setData({ demandKw: e.detail.value }); },
  onDemandSceneChange(e) { this.setData({ demandSceneIdx: Number(e.detail.value) }); },
  onDemandStatusChange(e) { this.setData({ demandStatusIdx: Number(e.detail.value) }); },
  searchDemands() { this.loadDemands(true); },

  onDemandOffline(e) {
    const { id, no } = e.currentTarget.dataset;
    this.confirm('下架需求', `确认强制下架需求 ${no} 吗？下架后状态变为已取消，不可恢复。`, {
      editable: true, placeholder: '下架原因（必填，留档）', danger: true, confirmText: '下架'
    }, (text) => {
      const note = (text || '').trim();
      if (!note) { this.toast('请填写下架原因'); return; }
      this.confirm('再次确认', `下架原因：${note}\n确认执行？`, { danger: true, confirmText: '确认下架' }, async () => {
        const r = await this.call('demand_offline', { demand_id: id, note });
        if (r && r.ok) { this.toast('已下架', 'success'); this.loadDemands(true); }
        else this.toast(r && r.msg);
      });
    });
  },

  // ───────── ⑤ 订单管理 ─────────
  decoOrder(o) {
    const st = this.orderStatus(o.status);
    return Object.assign({}, o, {
      statusText: st.name,
      statusCls: st.cls,
      sceneText: this.sceneName(o.scene),
      userShort: this.shortOpenid(o.user_openid),
      partnerShort: this.shortOpenid(o.partner_openid),
      totalText: formatMoney(o.total_fen),
      tipText: formatMoney(o.tip_total_fen),
      hasTip: (o.tip_total_fen || 0) > 0,
      timeText: this.fmtTime(o.start_time),
      createdText: this.fmtTime(o.created_at),
      canCancel: o.status === 'S1' || o.status === 'S0'
    });
  },

  async loadOrders(reset) {
    if (this.data.orderLoading) return;
    const doReset = reset === true;
    const page = doReset ? 1 : this.data.orderPage + 1;
    this.setData({ orderLoading: true });
    const r = await this.call('order_list', {
      page,
      keyword: this.data.orderKw.trim(),
      status: this.data.orderStatusOpts[this.data.orderStatusIdx].code
    });
    this.setData({ orderLoading: false });
    if (r && r.ok) {
      const rows = (r.data.list || []).map(this.decoOrder.bind(this));
      this.setData({
        orders: doReset ? rows : this.data.orders.concat(rows),
        orderPage: page, orderHasMore: r.data.has_more, orderTotal: r.data.total
      });
    } else this.toast(r && r.msg);
  },

  onOrderKwInput(e) { this.setData({ orderKw: e.detail.value }); },
  onOrderStatusChange(e) { this.setData({ orderStatusIdx: Number(e.detail.value) }); },
  searchOrders() { this.loadOrders(true); },

  async openOrderDetail(e) {
    const orderId = e.currentTarget.dataset.id;
    wx.showLoading({ title: '加载中' });
    const r = await this.call('order_detail', { order_id: orderId });
    wx.hideLoading();
    if (!r || !r.ok) { this.toast(r && r.msg); return; }
    const d = r.data;
    const o = d.order;
    const st = this.orderStatus(o.status);
    const loc = o.location || {};
    this.setData({
      orderDetail: {
        order: Object.assign({}, o, {
          statusText: st.name,
          statusCls: st.cls,
          sceneText: this.sceneName(o.scene),
          optionsText: (o.content_options || []).join('、') || '—',
          locationText: loc.name || '—',
          totalText: formatMoney(o.total_fen),
          feeText: formatMoney(o.fee_fen),
          incomeText: formatMoney(o.partner_income_fen),
          tipText: formatMoney(o.tip_total_fen),
          hasTip: (o.tip_total_fen || 0) > 0,
          timeText: this.fmtTime(o.start_time),
          createdText: this.fmtTime(o.created_at),
          expireText: this.fmtTime(o.pay_expire_at),
          userShort: this.shortOpenid(o.user_openid),
          partnerShort: this.shortOpenid(o.partner_openid),
          canCancel: o.status === 'S1' || o.status === 'S0',
          canOpenDispute: o.status === 'S10',
          canJudge: o.status === 'S10.5'
        }),
        logs: (d.status_logs || []).map((l) => ({
          text: (l.from || '—') + ' → ' + (l.to || '—'),
          actionText: l.action || '',
          actorText: l.actor === 'admin' ? '管理员' : this.shortOpenid(l.actor),
          timeText: this.fmtTime(l.created_at)
        })),
        txs: (d.transactions || []).map((t) => ({
          typeText: TX_TYPE_TEXT[t.type] || t.type,
          payNo: t.pay_no,
          amountText: formatMoney(t.amount_fen),
          feeText: formatMoney(t.fee_fen),
          timeText: this.fmtTime(t.created_at)
        })),
        evals: (d.evaluations || []).map((ev) => ({
          starText: '★'.repeat(ev.star || 0) + '☆'.repeat(5 - (ev.star || 0)),
          content: ev.content || (ev.is_system ? '（系统默认评价）' : ''),
          fromShort: this.shortOpenid(ev.from_openid),
          timeText: this.fmtTime(ev.created_at)
        })),
        confirms: d.confirmations ? {
          version: d.confirmations.version,
          items: (d.confirmations.items || []).map((it) => ({
            keyText: CONFIRM_KEY_TEXT[it.key] || it.key,
            userOk: !!it.user_ok,
            partnerOk: !!it.partner_ok
          }))
        } : null,
        hasTxs: (d.transactions || []).length > 0,
        hasEvals: (d.evaluations || []).length > 0
      }
    });
  },
  closeOrderDetail() { this.setData({ orderDetail: null }); },

  onForceCancel(e) {
    const { id, no } = e.currentTarget.dataset;
    this.confirm('强制取消订单', `确认强制取消订单 ${no} 吗？待确认订单取消后需求将释放回匹配池。`, {
      editable: true, placeholder: '取消原因（必填，留档）', danger: true, confirmText: '强制取消'
    }, (text) => {
      const note = (text || '').trim();
      if (!note) { this.toast('请填写取消原因'); return; }
      this.confirm('再次确认', `取消原因：${note}\n该操作不可恢复，确认执行？`, { danger: true, confirmText: '确认取消' }, async () => {
        const r = await this.call('order_force_cancel', { order_id: id, note });
        if (r && r.ok) {
          this.toast('已取消', 'success');
          this.loadOrders(true);
          this.loadDash();
          this.setData({ orderDetail: null });
        } else this.toast(r && r.msg);
      });
    });
  },

  // 争议处置(订单列表/详情/争议区共用)
  async loadDisputes() {
    const r = await this.call('dispute_list');
    if (r && r.ok) {
      this.setData({
        disputes: (r.data.list || []).map((o) => Object.assign(this.decoOrder(o), {
          updatedText: this.fmtTime(o.updated_at)
        }))
      });
    }
  },

  onDispute(e) {
    const { id, no, decision } = e.currentTarget.dataset;
    const cfgs = {
      open: { title: '登记争议', content: `确认将订单 ${no} 标记为「争议处理中」吗？`, confirm: '登记' },
      refund: { title: '裁决：全额退款', content: `确认裁决订单 ${no} 为全额退款（S7 已退款）吗？`, confirm: '裁决退款' },
      complete: { title: '裁决：维持完成', content: `确认裁决订单 ${no} 维持完成（S5 已完成）吗？`, confirm: '裁决完成' }
    };
    const cfg = cfgs[decision];
    this.confirm(cfg.title, cfg.content, {
      editable: true, placeholder: '处置说明（必填，留档）', danger: decision === 'refund', confirmText: cfg.confirm
    }, (text) => {
      const note = (text || '').trim();
      if (!note) { this.toast('请填写处置说明'); return; }
      this.confirm('再次确认', `处置说明：${note}\n确认执行？`, { danger: decision === 'refund', confirmText: '确认' }, async () => {
        const r = await this.call('dispute_handle', { order_id: id, decision, note });
        if (r && r.ok) {
          this.toast('处置完成', 'success');
          this.loadDisputes();
          this.loadOrders(true);
          this.loadDash();
          if (this.data.orderDetail) {
            this.openOrderDetail({ currentTarget: { dataset: { id } } });
          }
        } else this.toast(r && r.msg);
      });
    });
  },

  // ───────── ⑥ 财务流水 ─────────
  decoFinance(t) {
    const isRefund = t.type === 'refund';
    return Object.assign({}, t, {
      typeText: TX_TYPE_TEXT[t.type] || t.type,
      amountText: formatMoney(t.amount_fen),
      feeText: formatMoney(t.fee_fen),
      amtSign: isRefund ? '-' : '+',
      amtCls: isRefund ? 'fin-danger' : '',
      timeText: this.fmtTime(t.created_at),
      orderShort: this.shortOpenid(t.order_id),
      userShort: this.shortOpenid(t.user_openid),
      partnerShort: this.shortOpenid(t.partner_openid)
    });
  },

  async loadFinance(reset) {
    if (this.data.finLoading) return;
    const doReset = reset === true;
    const page = doReset ? 1 : this.data.finPage + 1;
    this.setData({ finLoading: true });
    const r = await this.call('finance_list', {
      page,
      type: this.data.finTypeOpts[this.data.finTypeIdx].code,
      status: this.data.finStatusOpts[this.data.finStatusIdx].code
    });
    this.setData({ finLoading: false });
    if (r && r.ok) {
      const rows = (r.data.list || []).map(this.decoFinance.bind(this));
      this.setData({
        finances: doReset ? rows : this.data.finances.concat(rows),
        finPage: page, finHasMore: r.data.has_more, finTotal: r.data.total
      });
    } else this.toast(r && r.msg);
  },

  onFinTypeChange(e) { this.setData({ finTypeIdx: Number(e.detail.value) }); },
  onFinStatusChange(e) { this.setData({ finStatusIdx: Number(e.detail.value) }); },
  searchFinance() { this.loadFinance(true); },

  // ───────── ⑦ 风控安全 ─────────
  decoReport(rp) {
    return Object.assign({}, rp, {
      typeText: rp.type === 'sos' ? '🆘 紧急求助' : '📍 安全报备',
      isSos: rp.type === 'sos',
      statusText: rp.status === 'active' ? '🔴 处理中' : (rp.status === 'resolved' ? '已解决' : '已结束'),
      isActive: rp.status === 'active',
      reporterShort: this.shortOpenid(rp.reporter_openid),
      roleText: rp.reporter_role === 'partner' ? '耍伴' : '发单人',
      timeText: this.fmtTime(rp.created_at),
      resolvedText: this.fmtTime(rp.resolved_at)
    });
  },

  async loadReports(reset) {
    if (this.data.reportLoading) return;
    const doReset = reset === true;
    const page = doReset ? 1 : this.data.reportPage + 1;
    this.setData({ reportLoading: true });
    const r = await this.call('report_list', {
      page,
      status: this.data.reportStatusOpts[this.data.reportStatusIdx].code
    });
    this.setData({ reportLoading: false });
    if (r && r.ok) {
      const rows = (r.data.list || []).map(this.decoReport.bind(this));
      this.setData({
        reports: doReset ? rows : this.data.reports.concat(rows),
        reportPage: page, reportHasMore: r.data.has_more
      });
    } else this.toast(r && r.msg);
  },
  onReportStatusChange(e) { this.setData({ reportStatusIdx: Number(e.detail.value) }); },
  searchReports() { this.loadReports(true); },

  onReportHandle(e) {
    const id = e.currentTarget.dataset.id;
    this.confirm('处理安全求助', '确认将该求助/报备标记为「已解决」吗？', {
      editable: true, placeholder: '处理说明（必填，留档）', confirmText: '标记已解决'
    }, (text) => {
      const note = (text || '').trim();
      if (!note) { this.toast('请填写处理说明'); return; }
      this.call('report_handle', { report_id: id, note }).then((r) => {
        if (r && r.ok) { this.toast('已处理', 'success'); this.loadReports(true); this.loadDash(); }
        else this.toast(r && r.msg);
      });
    });
  },

  decoEvent(ev) {
    const levelCls = ev.level === 'P0' || ev.level === 'P1' ? 'credit-low'
      : ev.level === 'P2' ? 'credit-mid' : 'st-muted';
    let payloadText = '';
    try { payloadText = JSON.stringify(ev.payload || {}); } catch (e) { payloadText = ''; }
    return Object.assign({}, ev, {
      levelCls,
      openidShort: this.shortOpenid(ev.openid),
      payloadText,
      timeText: this.fmtTime(ev.created_at)
    });
  },

  async loadEvents(reset) {
    if (this.data.eventLoading) return;
    const doReset = reset === true;
    const page = doReset ? 1 : this.data.eventPage + 1;
    this.setData({ eventLoading: true });
    const r = await this.call('event_list', {
      page,
      level: this.data.eventLevelOpts[this.data.eventLevelIdx].code
    });
    this.setData({ eventLoading: false });
    if (r && r.ok) {
      const rows = (r.data.list || []).map(this.decoEvent.bind(this));
      this.setData({
        events: doReset ? rows : this.data.events.concat(rows),
        eventPage: page, eventHasMore: r.data.has_more
      });
    } else this.toast(r && r.msg);
  },
  onEventLevelChange(e) { this.setData({ eventLevelIdx: Number(e.detail.value) }); },
  searchEvents() { this.loadEvents(true); },

  // ───────── ⑦.5 服务动态管理 ─────────
  decoBlog(p) {
    return Object.assign({}, p, {
      openidShort: this.shortOpenid(p.author_openid),
      statusText: BLOG_STATUS_TEXT[p.status] || p.status,
      statusTagCls: p.status === 'normal' ? 'tag-success' : (p.status === 'offline' ? 'tag-warn' : 'tag-danger'),
      isNormal: p.status === 'normal',
      isOffline: p.status === 'offline',
      sceneName: BLOG_SCENE_MAP[p.scene] || '',
      hasScene: !!BLOG_SCENE_MAP[p.scene],
      timeText: this.fmtTime(p.created_at)
    });
  },

  onBlogStatusChange(e) {
    this.setData({ blogStatusIdx: Number(e.detail.value) });
    this.loadBlogs(true);
  },

  async loadBlogs(reset) {
    const doReset = reset === true;
    const page = doReset ? 1 : this.data.blogPage + 1;
    this.setData({ blogLoading: true });
    const status = this.data.blogStatusOpts[this.data.blogStatusIdx].code;
    const r = await this.call('blog_list', { status, page });
    if (r && r.ok) {
      const rows = (r.data.list || []).map(this.decoBlog.bind(this));
      this.setData({
        blogs: doReset ? rows : this.data.blogs.concat(rows),
        blogPage: page, blogHasMore: !!r.data.has_more, blogTotal: r.data.total || 0, blogLoading: false
      });
    } else { this.setData({ blogLoading: false }); this.toast(r && r.msg); }
  },

  blogOffline(e) {
    const post_id = e.currentTarget.dataset.id;
    this.confirm('下架动态', '下架后用户将看不到该动态，请填写下架原因（会记录到平台日志）：',
      { editable: true, placeholder: '如：含导流信息 / 违规内容', danger: true, confirmText: '下架' },
      async (note) => {
        if (!note.trim()) { this.toast('请填写下架原因'); return; }
        const r = await this.call('blog_offline', { post_id, note: note.trim() });
        if (r && r.ok) { this.toast('已下架', 'success'); this.loadBlogs(true); } else this.toast(r && r.msg);
      });
  },

  blogRestore(e) {
    const post_id = e.currentTarget.dataset.id;
    this.confirm('恢复动态', '确定恢复该动态，使其重新对用户可见吗？', { confirmText: '恢复' }, async () => {
      const r = await this.call('blog_restore', { post_id });
      if (r && r.ok) { this.toast('已恢复', 'success'); this.loadBlogs(true); } else this.toast(r && r.msg);
    });
  },

  blogDelete(e) {
    const post_id = e.currentTarget.dataset.id;
    this.confirm('删除动态', '删除后该动态对所有人不可见，请填写删除原因：',
      { editable: true, placeholder: '删除原因', danger: true, confirmText: '删除' },
      async (note) => {
        if (!note.trim()) { this.toast('请填写删除原因'); return; }
        const r = await this.call('blog_delete', { post_id, note: note.trim() });
        if (r && r.ok) { this.toast('已删除', 'success'); this.loadBlogs(true); } else this.toast(r && r.msg);
      });
  },

  async openBlogComments(e) {
    const post_id = e.currentTarget.dataset.id;
    const post = this.data.blogs.find((x) => x._id === post_id);
    this.setData({
      blogCommentVisible: true, blogCommentPostId: post_id, blogComments: [], blogCommentLoading: true,
      blogCommentEmpty: false,
      blogCommentPostTitle: post ? post.content.slice(0, 20) : ''
    });
    const r = await this.call('blog_comment_list', { post_id, page: 1 });
    if (r && r.ok) {
      const rows = (r.data.list || []).map((c) => ({
        _id: c._id, openidShort: this.shortOpenid(c.author_openid),
        author_nickname: c.author_nickname, content: c.content,
        deleted: c.status === 'deleted', timeText: this.fmtTime(c.created_at)
      }));
      this.setData({ blogComments: rows, blogCommentLoading: false, blogCommentEmpty: rows.length === 0 });
    } else { this.setData({ blogCommentLoading: false, blogCommentEmpty: true }); this.toast(r && r.msg); }
  },

  closeBlogComments() { this.setData({ blogCommentVisible: false, blogComments: [], blogCommentPostId: '' }); },

  adminBlogCommentDelete(e) {
    const comment_id = e.currentTarget.dataset.id;
    this.confirm('删除评论', '请填写删除该评论的原因：',
      { editable: true, placeholder: '删除原因', danger: true, confirmText: '删除' },
      async (note) => {
        if (!note.trim()) { this.toast('请填写删除原因'); return; }
        const r = await this.call('blog_comment_delete', { comment_id, note: note.trim() });
        if (r && r.ok) {
          this.setData({ blogComments: this.data.blogComments.filter((c) => c._id !== comment_id) });
          this.toast('评论已删除', 'success');
        } else this.toast(r && r.msg);
      });
  },

  // ───────── ⑧ 参数配置 ─────────
  async loadConfig() {
    const r = await this.call('config_get');
    if (!r || !r.ok) { this.toast(r && r.msg); return; }
    const d = r.data;
    this.setData({
      cfg: d,
      cfgSceneOpts: (d.scene_list || []).map((s) => ({ code: s.code, name: (s.icon ? s.icon + ' ' : '') + (s.name || s.code) })),
      feeInput: String(d.platform_fee_rate_fen),
      tmoInputs: {
        s0: String(d.timeouts.s0_timeout_min),
        s1: String(d.timeouts.s1_timeout_min),
        interrupt: String(d.timeouts.interrupt_timeout_h),
        eval: String(d.timeouts.eval_window_h)
      },
      creditInputs: {
        take: String(d.credits.min_credit_take_order),
        place: String(d.credits.min_credit_place_order),
        freeze: String(d.credits.credit_freeze_line)
      },
      rateInputs: {
        min: (d.rate_range.rate_min_fen / 100).toFixed(0),
        max: (d.rate_range.rate_max_fen / 100).toFixed(0)
      }
    });
  },

  onFeeInput(e) { this.setData({ feeInput: e.detail.value }); },
  onWordInput(e) { this.setData({ wordInput: e.detail.value }); },
  onCityInput(e) { this.setData({ cityInput: e.detail.value }); },
  onTmoInput(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ ['tmoInputs.' + k]: e.detail.value });
  },
  onCreditInput(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ ['creditInputs.' + k]: e.detail.value });
  },
  onRateInput(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ ['rateInputs.' + k]: e.detail.value });
  },
  onCfgSceneChange(e) { this.setData({ cfgSceneIdx: Number(e.detail.value) }); },
  onSceneOptInput(e) { this.setData({ sceneOptInput: e.detail.value }); },
  onTplInput(e) { this.setData({ tplInput: e.detail.value }); },

  saveFee() {
    const fee = Number(this.data.feeInput);
    if (!Number.isInteger(fee) || fee < 0 || fee > 10000) {
      this.toast('抽成需为 0-10000 整数（万分之）');
      return;
    }
    this.confirm('修改平台抽成', `确认将平台抽成改为 ${fee}（万分之，即 ${(fee / 100).toFixed(2)}%）吗？`, { confirmText: '保存' }, async () => {
      const r = await this.call('config_set', { platform_fee_rate_fen: fee });
      if (r && r.ok) { this.toast('已保存', 'success'); this.loadConfig(); }
      else this.toast(r && r.msg);
    });
  },

  toggleAutoApprove() {
    const next = !this.data.cfg.auto_approve_partner;
    this.confirm(next ? '开启自动审核' : '关闭自动审核',
      next ? '开启后耍伴申请将自动通过，确认吗？' : '关闭后耍伴申请需人工审核，确认吗？',
      { confirmText: next ? '开启' : '关闭' }, async () => {
        const r = await this.call('config_set', { auto_approve_partner: next });
        if (r && r.ok) { this.toast('已更新', 'success'); this.loadConfig(); }
        else this.toast(r && r.msg);
      });
  },

  addWord() {
    const w = this.data.wordInput.trim();
    if (!w) return;
    this.confirm('新增屏蔽词', `确认添加屏蔽词「${w}」吗？`, { confirmText: '添加' }, async () => {
      const r = await this.call('config_set', { block_words_add: [w] });
      if (r && r.ok) { this.toast('已添加', 'success'); this.setData({ wordInput: '' }); this.loadConfig(); }
      else this.toast(r && r.msg);
    });
  },
  removeWord(e) {
    const w = e.currentTarget.dataset.word;
    this.confirm('删除屏蔽词', `确认删除屏蔽词「${w}」吗？`, { danger: true, confirmText: '删除' }, async () => {
      const r = await this.call('config_set', { block_words_remove: [w] });
      if (r && r.ok) { this.toast('已删除', 'success'); this.loadConfig(); }
      else this.toast(r && r.msg);
    });
  },

  addCity() {
    const c = this.data.cityInput.trim();
    if (!c) return;
    this.confirm('开通城市', `确认新增开通城市「${c}」吗？`, { confirmText: '添加' }, async () => {
      const r = await this.call('config_set', { city_add: [c] });
      if (r && r.ok) { this.toast('已添加', 'success'); this.setData({ cityInput: '' }); this.loadConfig(); }
      else this.toast(r && r.msg);
    });
  },
  removeCity(e) {
    const c = e.currentTarget.dataset.city;
    this.confirm('移除城市', `确认移除开通城市「${c}」吗？`, { danger: true, confirmText: '移除' }, async () => {
      const r = await this.call('config_set', { city_remove: [c] });
      if (r && r.ok) { this.toast('已移除', 'success'); this.loadConfig(); }
      else this.toast(r && r.msg);
    });
  },

  saveTimeouts() {
    const t = this.data.tmoInputs;
    const vals = {
      s0_timeout_min: parseInt(t.s0, 10),
      s1_timeout_min: parseInt(t.s1, 10),
      interrupt_timeout_h: parseInt(t.interrupt, 10),
      eval_window_h: parseInt(t.eval, 10)
    };
    if (!Number.isInteger(vals.s0_timeout_min) || !Number.isInteger(vals.s1_timeout_min) ||
        !Number.isInteger(vals.interrupt_timeout_h) || !Number.isInteger(vals.eval_window_h)) {
      this.toast('超时参数须全部为整数');
      return;
    }
    this.confirm('保存超时参数', `支付时限 ${vals.s0_timeout_min} 分钟\n确认时限 ${vals.s1_timeout_min} 分钟\n中断时限 ${vals.interrupt_timeout_h} 小时\n评价时限 ${vals.eval_window_h} 小时`, { confirmText: '保存' }, async () => {
      const r = await this.call('config_set', vals);
      if (r && r.ok) { this.toast('已保存', 'success'); this.loadConfig(); }
      else this.toast(r && r.msg);
    });
  },

  saveCredits() {
    const c = this.data.creditInputs;
    const vals = {
      min_credit_take_order: parseInt(c.take, 10),
      min_credit_place_order: parseInt(c.place, 10),
      credit_freeze_line: parseInt(c.freeze, 10)
    };
    if (!Number.isInteger(vals.min_credit_take_order) || !Number.isInteger(vals.min_credit_place_order) ||
        !Number.isInteger(vals.credit_freeze_line)) {
      this.toast('信用参数须全部为整数');
      return;
    }
    this.confirm('保存信用参数', `接单下限 ${vals.min_credit_take_order} 分\n发单下限 ${vals.min_credit_place_order} 分\n冻结线 ${vals.credit_freeze_line} 分`, { confirmText: '保存' }, async () => {
      const r = await this.call('config_set', vals);
      if (r && r.ok) { this.toast('已保存', 'success'); this.loadConfig(); }
      else this.toast(r && r.msg);
    });
  },

  saveRateRange() {
    const minY = Number(this.data.rateInputs.min);
    const maxY = Number(this.data.rateInputs.max);
    if (!Number.isFinite(minY) || !Number.isFinite(maxY) || minY <= 0 || maxY <= 0) {
      this.toast('时薪须为正数（元/小时）');
      return;
    }
    this.confirm('保存时薪范围', `确认平台时薪范围改为 ${minY} ~ ${maxY} 元/小时吗？`, { confirmText: '保存' }, async () => {
      const r = await this.call('config_set', {
        rate_min_fen: Math.round(minY * 100),
        rate_max_fen: Math.round(maxY * 100)
      });
      if (r && r.ok) { this.toast('已保存', 'success'); this.loadConfig(); }
      else this.toast(r && r.msg);
    });
  },

  addSceneOption() {
    const opt = this.data.sceneOptInput.trim();
    const sc = this.data.cfgSceneOpts[this.data.cfgSceneIdx];
    if (!sc) { this.toast('请选择场景'); return; }
    if (!opt) return;
    this.confirm('新增服务项', `确认给「${sc.name}」新增服务项「${opt}」吗？（发版后才会在发布页显示）`, { confirmText: '添加' }, async () => {
      const r = await this.call('config_set', { scene_option_add: { scene: sc.code, option: opt } });
      if (r && r.ok) { this.toast('已添加', 'success'); this.setData({ sceneOptInput: '' }); this.loadConfig(); }
      else this.toast(r && r.msg);
    });
  },
  removeSceneOption(e) {
    const { scene, option } = e.currentTarget.dataset;
    this.confirm('删除服务项', `确认删除服务项「${option}」吗？`, { danger: true, confirmText: '删除' }, async () => {
      const r = await this.call('config_set', { scene_option_remove: { scene, option } });
      if (r && r.ok) { this.toast('已删除', 'success'); this.loadConfig(); }
      else this.toast(r && r.msg);
    });
  },

  addTemplate() {
    const text = this.data.tplInput.trim();
    if (!text) return;
    this.confirm('新增 IM 模板', `确认新增系统模板「${text}」吗？`, { confirmText: '添加' }, async () => {
      const r = await this.call('config_set', { template_add: text });
      if (r && r.ok) { this.toast('已添加', 'success'); this.setData({ tplInput: '' }); this.loadConfig(); }
      else this.toast(r && r.msg);
    });
  },
  removeTemplate(e) {
    const id = e.currentTarget.dataset.id;
    this.confirm('删除 IM 模板', `确认删除模板 ${id} 吗？`, { danger: true, confirmText: '删除' }, async () => {
      const r = await this.call('config_set', { template_remove: id });
      if (r && r.ok) { this.toast('已删除', 'success'); this.loadConfig(); }
      else this.toast(r && r.msg);
    });
  },

  // ───────── ⑨ 管理员 + 快速封禁 ─────────
  async loadAdmins() {
    const r = await this.call('admin_list');
    if (r && r.ok) {
      this.setData({
        admins: (r.data.admins || []).map((o) => ({
          openid: o,
          openidShort: this.shortOpenid(o),
          isSelf: o === this.data.selfOpenid
        }))
      });
    } else this.toast(r && r.msg);
  },
  onAdminInput(e) { this.setData({ adminInput: e.detail.value }); },
  onBanOpenidInput(e) { this.setData({ banOpenid: e.detail.value }); },
  onBanReasonInput(e) { this.setData({ banReason: e.detail.value }); },
  onUnbanOpenidInput(e) { this.setData({ unbanOpenid: e.detail.value }); },

  adminAdd() {
    const openid = this.data.adminInput.trim();
    if (!/^[a-zA-Z0-9_-]{20,40}$/.test(openid)) { this.toast('openid 格式不正确'); return; }
    this.confirm('添加管理员', `确认将该 openid 加入管理员白名单吗？\n${openid}`, { confirmText: '添加' }, async () => {
      const r = await this.call('admin_add', { target_openid: openid });
      if (r && r.ok) { this.toast('已添加', 'success'); this.setData({ adminInput: '' }); this.loadAdmins(); }
      else this.toast(r && r.msg);
    });
  },

  adminRemove(e) {
    const openid = e.currentTarget.dataset.openid;
    this.confirm('移除管理员', `确认将该 openid 移出管理员白名单吗？\n${openid}`, { danger: true, confirmText: '移除' }, async () => {
      const r = await this.call('admin_remove', { target_openid: openid });
      if (r && r.ok) { this.toast('已移除', 'success'); this.loadAdmins(); }
      else this.toast(r && r.msg);
    });
  },

  doBan() {
    const openid = this.data.banOpenid.trim();
    const reason = this.data.banReason.trim();
    if (!/^[a-zA-Z0-9_-]{20,40}$/.test(openid)) { this.toast('openid 格式不正确'); return; }
    if (!reason) { this.toast('请填写封禁原因'); return; }
    this.confirm('封禁用户', `确认封禁该用户吗？\n${openid}\n封禁后无法登录、发单与接单。`, { danger: true, confirmText: '确认封禁' }, async () => {
      const r = await this.call('user_ban', { target_openid: openid, reason });
      if (r && r.ok) {
        this.toast('已封禁', 'success');
        this.setData({ banOpenid: '', banReason: '' });
      } else this.toast(r && r.msg);
    });
  },

  doUnban() {
    const openid = this.data.unbanOpenid.trim();
    if (!/^[a-zA-Z0-9_-]{20,40}$/.test(openid)) { this.toast('openid 格式不正确'); return; }
    this.confirm('解封用户', `确认解除该用户的封禁吗？\n${openid}`, { confirmText: '解封' }, async () => {
      const r = await this.call('user_unban', { target_openid: openid });
      if (r && r.ok) {
        this.toast('已解封', 'success');
        this.setData({ unbanOpenid: '' });
      } else this.toast(r && r.msg);
    });
  }
});
