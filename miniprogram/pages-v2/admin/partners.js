// 耍伴管理列表
function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => ({ ok: false, code: 'cloud_error', msg: '网络异常' }));
}

Page({
  data: { isAdmin: false, list: [], page: 1, hasMore: true, loading: false, statusFilter: '' },

  onLoad() {
    callCloud('admin-action', { action: 'admin_list' }).then((r) => {
      if (!r.ok) { wx.showToast({ title: '无权限', icon: 'none' }); setTimeout(() => wx.redirectTo({ url: '/pages-v2/index/index' }), 800); return; }
      this.setData({ isAdmin: true }); this.loadList();
    });
  },

  loadList() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    callCloud('admin-action', { action: 'partner_list', page: this.data.page, status: this.data.statusFilter }).then((r) => {
      if (r.ok) {
        const list = this.data.page === 1 ? r.data.list : this.data.list.concat(r.data.list);
        this.setData({ list, hasMore: r.data.has_more, loading: false });
      } else this.setData({ loading: false });
    });
  },

  filterStatus(e) { this.setData({ statusFilter: e.currentTarget.dataset.status, page: 1, list: [], hasMore: true }); this.loadList(); },
  onReachBottom() { if (this.data.hasMore) { this.setData({ page: this.data.page + 1 }); this.loadList(); } },

  review(e) {
    const openid = e.currentTarget.dataset.openid;
    const decision = e.currentTarget.dataset.decision;
    wx.showModal({
      title: decision === 'approve' ? '通过审核' : '驳回申请',
      content: decision === 'approve' ? '确认通过该耍伴申请?' : '确认驳回该耍伴申请?',
      success: (res) => {
        if (!res.confirm) return;
        callCloud('admin-action', { action: 'review', target_openid: openid, decision }).then((r) => {
          wx.showToast({ title: r.ok ? '操作成功' : (r.msg || '失败'), icon: 'none' });
          if (r.ok) { this.setData({ page: 1, list: [], hasMore: true }); this.loadList(); }
        });
      }
    });
  },

  onShareAppMessage() { return { title: '耍伴管理', path: '/pages-v2/index/index' }; }
});
