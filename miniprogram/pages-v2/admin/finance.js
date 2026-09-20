// 财务流水
function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => ({ ok: false, code: 'cloud_error', msg: '网络异常' }));
}

const TYPE_MAP = { pay: '支付', refund: '退款', tip: '打赏', withdraw: '提现' };

Page({
  data: { isAdmin: false, list: [], page: 1, hasMore: true, loading: false },

  onLoad() {
    callCloud('admin-action', { action: 'admin_list' }).then((r) => {
      if (!r.ok) { wx.showToast({ title: '无权限', icon: 'none' }); setTimeout(() => wx.redirectTo({ url: '/pages-v2/index/index' }), 800); return; }
      this.setData({ isAdmin: true }); this.loadList();
    });
  },

  loadList() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    callCloud('admin-action', { action: 'finance_list', page: this.data.page }).then((r) => {
      if (r.ok) {
        const list = (this.data.page === 1 ? r.data.list : this.data.list.concat(r.data.list)).map((t) =>
          Object.assign({}, t, { typeText: TYPE_MAP[t.type] || t.type, amountYuan: (t.amount_fen / 100).toFixed(2) }));
        this.setData({ list, hasMore: r.data.has_more, loading: false });
      } else this.setData({ loading: false });
    });
  },

  onReachBottom() { if (this.data.hasMore) { this.setData({ page: this.data.page + 1 }); this.loadList(); } },
  onShareAppMessage() { return { title: '财务流水', path: '/pages-v2/index/index' }; }
});
