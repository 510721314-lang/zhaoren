// pages-v2/credit/credit.js · 双信用分与流水明细
// 数据源: user-login get_my_credit(最近 20 条 credit_score_log)
const { CREDIT_LEVEL } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

function getLevel(score) {
  if (!score) return '未开通';
  const lv = CREDIT_LEVEL.find((l) => score >= l.min && score <= l.max);
  return lv ? `${lv.level} ${lv.name}` : '未评级';
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 流水类型中文(未知类型原样回退展示)
const TYPE_NAME = {
  evaluation: '评价变动',
  admin_adjust: '平台调整'
};

Page({
  data: {
    userScore: 0,
    partnerScore: 0,
    userLevel: '',
    partnerLevel: '',
    logs: [],
    loading: false,
    loaded: false
  },

  onShow() {
    this.loadCredit();
  },

  onPullDownRefresh() {
    this.loadCredit(() => wx.stopPullDownRefresh());
  },

  loadCredit(done) {
    this.setData({ loading: true });
    callCloud('user-login', { action: 'get_my_credit' }).then((r) => {
      if (!r.ok || !r.data) {
        wx.showToast({ title: r.msg || '查询失败', icon: 'none' });
        this.setData({ loading: false, loaded: true });
        return;
      }
      const d = r.data;
      const logs = (d.logs || []).map((l) => ({
        ...l,
        type_name: TYPE_NAME[l.type] || l.type || '信用变动',
        delta_text: (l.delta > 0 ? '+' : '') + l.delta,
        is_up: l.delta > 0,
        time_str: fmtTime(l.created_at)
      }));
      this.setData({
        userScore: d.user_credit_score || 0,
        partnerScore: d.partner_credit_score || 0,
        userLevel: getLevel(d.user_credit_score),
        partnerLevel: getLevel(d.partner_credit_score),
        logs,
        loading: false,
        loaded: true
      });
    }).catch(() => {
      this.setData({ loading: false, loaded: true });
      wx.showToast({ title: '网络异常', icon: 'none' });
    }).then(() => { if (done) done(); });
  },

  reload() {
    this.loadCredit();
  }
});
