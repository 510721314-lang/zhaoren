// pages-v2/my-demands/my-demands.js · 我的发布
// 数据源: demand-publish my_demands(含懒过期, 最多 50 条)
const { SCENES, DEMAND_STATUS } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtTime(ts) {
  if (!ts) return '时间待定';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtFen(fen) {
  const v = Number(fen) || 0;
  return (v / 100).toFixed(v % 100 === 0 ? 0 : 2);
}

// 状态点配色(与订单状态色系一致)
const STATUS_STYLE = {
  matching: { color: 'var(--func-success)', bg: 'var(--func-success-light)' },
  matched: { color: 'var(--func-info)', bg: 'var(--func-info-light)' },
  cancelled: { color: 'var(--text-4)', bg: 'var(--bg-segment)' },
  expired: { color: 'var(--text-4)', bg: 'var(--bg-segment)' }
};

Page({
  data: {
    list: [],
    loading: false,
    loaded: false
  },

  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  },

  onShow() {
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList(() => wx.stopPullDownRefresh());
  },

  loadList(done) {
    this.setData({ loading: true });
    callCloud('demand-publish', { action: 'my_demands' }).then((r) => {
      const list = ((r.ok && r.data && r.data.list) || []).map((d) => {
        const scene = SCENES.find((s) => s.code === d.scene) || {};
        const style = STATUS_STYLE[d.status] || STATUS_STYLE.expired;
        return {
          ...d,
          scene_name: scene.name || d.scene,
          scene_icon: scene.icon || '📋',
          status_name: DEMAND_STATUS[d.status] || d.status,
          status_color: style.color,
          status_bg: style.bg,
          time_str: fmtTime(d.start_time),
          total_yuan: fmtFen(d.total_fen)
        };
      });
      this.setData({ list, loading: false, loaded: true });
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败,下拉重试', icon: 'none' });
    }).then(() => { if (done) done(); });
  },

  goDetail(e) {
    wx.navigateTo({
      url: `/pages-v2/demand-detail/demand-detail?id=${e.currentTarget.dataset.id}`,
      fail: () => wx.showToast({ title: '详情页暂不可用', icon: 'none' })
    });
  },

  reload() {
    this.loadList();
  },

  goPublish() {
    wx.navigateTo({ url: '/pages-v2/publish/publish' });
  }
});
