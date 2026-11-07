// 用户详情（只读）— F5(2026-11-04)：消费 admin-action user_detail（入参 target_openid）
// 处置类写操作（封禁/信用调整/紧急联系人改写）不在本页，后置 A2
const { callCloud } = require('../../utils/cloud.js');

const fmt = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const p = (n) => ('0' + n).slice(-2);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};

const STATUS_TX = { normal: '正常', frozen: '冻结', banned: '封禁' };
const ROLE_TX = { user: '需求方', partner: '耍伴' };

Page({
  data: { isAdmin: false, loading: true, d: null, errMsg: '' },

  onLoad(options) {
    const target = (options && options.target_openid) || '';
    if (!target) { this.setData({ loading: false, errMsg: '缺少用户标识' }); return; }
    this.target = target;
    callCloud('admin-action', { action: 'admin_list' }).then((r) => {
      if (!r.ok) {
        wx.showToast({ title: '无权限', icon: 'none' });
        setTimeout(() => wx.reLaunch({ url: '/pages-v2/index/index', fail: () => wx.showToast({ title: '返回首页失败', icon: 'none' }) }), 800);
        return;
      }
      this.setData({ isAdmin: true });
      this.loadDetail();
    }).catch(() => this.setData({ loading: false, errMsg: '网络异常' }));
  },

  loadDetail() {
    callCloud('admin-action', { action: 'user_detail', target_openid: this.target }).then((r) => {
      if (!r.ok || !r.data || !r.data.user) {
        this.setData({ loading: false, errMsg: (r && r.msg) || '加载失败' });
        return;
      }
      const u = r.data.user;
      const st = r.data.stats || {};
      const logs = (r.data.credit_logs || []).map((l) => ({
        type: l.type,
        delta: (l.delta > 0 ? '+' : '') + (l.delta || 0),
        up: (l.delta || 0) > 0,
        score: l.score,
        reason: l.reason || (l.is_system ? '系统调整' : ''),
        time: fmt(l.created_at)
      }));
      const p = r.data.partner;
      this.setData({
        loading: false,
        d: {
          nickname: u.nickname || '未设置昵称',
          avatar: u.avatar || '',
          openid: u.openid,
          roles: (u.roles || []).map((x) => ROLE_TX[x] || x).join(' · ') || '—',
          status: u.status,
          statusTx: STATUS_TX[u.status] || u.status,
          age: u.age || '—',
          realnameTx: u.is_realname_done ? '已实名' : '未实名',
          userScore: u.user_credit_score,
          partnerScore: u.partner_credit_score,
          phone: u.phone || '—',
          created: fmt(u.created_at),
          bannedReason: u.banned_reason || '',
          ec: r.data.emergency_contact || null,
          demandCount: st.demand_count || 0,
          orderAsUser: st.order_as_user || 0,
          orderAsPartner: st.order_as_partner || 0,
          partner: p ? {
            status: p.status,
            sceneCount: (p.accept_scenes || []).length,
            acceptSwitch: p.accept_switch ? '接单中' : '已暂停',
            appliedAt: fmt(p.applied_at)
          } : null,
          logs
        }
      });
    }).catch(() => this.setData({ loading: false, errMsg: '网络异常' }));
  },

  onShareAppMessage() { return { title: '用户详情', path: '/pages-v2/index/index' }; }
});
