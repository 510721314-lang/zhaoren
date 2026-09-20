// 需求管理列表
function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => ({ ok: false, code: 'cloud_error', msg: '网络异常' }));
}

Page({
  data: { isAdmin: false, list: [], page: 1, hasMore: true, loading: false, sceneFilter: '' },

  onLoad() {
    callCloud('admin-action', { action: 'admin_list' }).then((r) => {
      if (!r.ok) { wx.showToast({ title: '无权限', icon: 'none' }); setTimeout(() => wx.redirectTo({ url: '/pages-v2/index/index' }), 800); return; }
      this.setData({ isAdmin: true }); this.loadList();
    });
  },

  loadList() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    callCloud('admin-action', { action: 'demand_list', page: this.data.page, scene: this.data.sceneFilter }).then((r) => {
      if (r.ok) {
        const list = this.data.page === 1 ? r.data.list : this.data.list.concat(r.data.list);
        this.setData({ list, hasMore: r.data.has_more, loading: false });
      } else this.setData({ loading: false });
    });
  },

  onReachBottom() { if (this.data.hasMore) { this.setData({ page: this.data.page + 1 }); this.loadList(); } },

  offline(e) {
    const demandId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '下架需求',
      editable: true,
      placeholderText: '请填写下架原因',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        callCloud('admin-action', { action: 'demand_offline', demand_id: demandId, note: res.content }).then((r) => {
          wx.showToast({ title: r.ok ? '已下架' : (r.msg || '失败'), icon: 'none' });
          if (r.ok) { this.setData({ page: 1, list: [], hasMore: true }); this.loadList(); }
        });
      }
    });
  },

  onShareAppMessage() { return { title: '需求管理', path: '/pages-v2/index/index' }; }
});
