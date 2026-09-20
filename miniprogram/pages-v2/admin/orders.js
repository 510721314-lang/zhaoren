// 订单管理列表
function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => ({ ok: false, code: 'cloud_error', msg: '网络异常' }));
}

const STATUS_MAP = {
  S0: '待支付', S1: '待确认', S2: '履约中', S3: '待确认完成',
  'S3.5': '平台介入', S5: '已完成', S6: '已取消', S7: '已退款',
  S8: '已评价', S9: '已结束', S10: '已关闭', 'S10.5': '争议处理中'
};

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
    callCloud('admin-action', { action: 'order_list', page: this.data.page }).then((r) => {
      if (r.ok) {
        const list = (this.data.page === 1 ? r.data.list : this.data.list.concat(r.data.list)).map((o) =>
          Object.assign({}, o, { statusText: STATUS_MAP[o.status] || o.status }));
        this.setData({ list, hasMore: r.data.has_more, loading: false });
      } else this.setData({ loading: false });
    });
  },

  onReachBottom() { if (this.data.hasMore) { this.setData({ page: this.data.page + 1 }); this.loadList(); } },

  forceCancel(e) {
    const orderId = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    if (status !== 'S0' && status !== 'S1') { wx.showToast({ title: '仅待支付/待确认可取消', icon: 'none' }); return; }
    wx.showModal({ title: '强制取消订单', editable: true, placeholderText: '请填写取消原因', success: (res) => {
      if (!res.confirm || !res.content) return;
      callCloud('admin-action', { action: 'order_force_cancel', order_id: orderId, note: res.content }).then((r) => {
        wx.showToast({ title: r.ok ? '已取消' : (r.msg || '失败'), icon: 'none' });
        if (r.ok) { this.setData({ page: 1, list: [], hasMore: true }); this.loadList(); }
      });
    }});
  },

  onShareAppMessage() { return { title: '订单管理', path: '/pages-v2/index/index' }; }
});
