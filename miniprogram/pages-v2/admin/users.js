// 用户管理列表
function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => ({ ok: false, code: 'cloud_error', msg: '网络异常' }));
}

Page({
  data: { isAdmin: false, list: [], page: 1, hasMore: true, loading: false, keyword: '' },

  onLoad() {
    callCloud('admin-action', { action: 'admin_list' }).then((r) => {
      if (!r.ok) { wx.showToast({ title: '无权限', icon: 'none' }); setTimeout(() => wx.redirectTo({ url: '/pages-v2/index/index' }), 800); return; }
      this.setData({ isAdmin: true });
      this.loadList();
    });
  },

  loadList() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    callCloud('admin-action', { action: 'user_list', page: this.data.page, keyword: this.data.keyword }).then((r) => {
      if (r.ok) {
        const list = this.data.page === 1 ? r.data.list : this.data.list.concat(r.data.list);
        this.setData({ list, hasMore: r.data.has_more, loading: false });
      } else { this.setData({ loading: false }); }
    });
  },

  onSearch(e) { this.setData({ keyword: e.detail.value, page: 1, list: [], hasMore: true }); this.loadList(); },
  onReachBottom() { if (this.data.hasMore) { this.setData({ page: this.data.page + 1 }); this.loadList(); } },

  goDetail(e) {
    const openid = e.currentTarget.dataset.openid;
    wx.navigateTo({ url: '/pages-v2/admin/user-detail?openid=' + openid });
  },

  onShareAppMessage() { return { title: '用户管理', path: '/pages-v2/index/index' }; }
});
